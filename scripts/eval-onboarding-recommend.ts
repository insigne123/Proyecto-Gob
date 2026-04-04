import "dotenv/config"

import fs from "node:fs/promises"
import path from "node:path"

import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"
import { z } from "zod"

type CliOptions = {
  datasetPath: string
  appUrl: string
  workspaceId?: string
  maxCases?: number
  outputPath?: string
}

type EvalCase = {
  id: string
  workspaceId: string
  snapshotId: string
  question: string | null
  filters: Record<string, unknown> | null
  maxCauses: number | null
  expectedRoles: string[]
  expectedCauseIds: string[]
  notes: string | null
}

type CaseResult = {
  id: string
  workspaceId: string
  snapshotId: string
  recommendationCount: number
  expectedRoleHitRate: number | null
  expectedCauseHitRate: number | null
  topRoles: string[]
  topCauseIds: string[]
  elapsedMs: number
  notes: string | null
  error?: string
}

const EvalCaseSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    workspaceId: z.string().trim().min(1).optional(),
    snapshotId: z.string().uuid(),
    question: z.string().trim().max(4000).optional().nullable(),
    filters: z.record(z.string(), z.unknown()).optional().nullable(),
    maxCauses: z.number().int().min(3).max(20).optional().nullable(),
    expectedRoles: z.array(z.string().trim().min(1)).default([]),
    expectedCauseIds: z.array(z.string().trim().min(1)).default([]),
    notes: z.string().trim().optional().nullable(),
  })
  .strict()

function normalizeText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    datasetPath: "eval/onboarding-recommend.smoke.jsonl",
    appUrl: process.env.EVAL_APP_URL || "http://localhost:9002",
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === "--dataset" && next) {
      opts.datasetPath = next
      i += 1
      continue
    }
    if (arg === "--app-url" && next) {
      opts.appUrl = next
      i += 1
      continue
    }
    if (arg === "--workspace-id" && next) {
      opts.workspaceId = next
      i += 1
      continue
    }
    if (arg === "--max" && next) {
      const value = Number(next)
      if (Number.isFinite(value) && value > 0) opts.maxCases = Math.floor(value)
      i += 1
      continue
    }
    if (arg === "--output" && next) {
      opts.outputPath = next
      i += 1
      continue
    }
  }

  return opts
}

async function readDataset(datasetPath: string, overrideWorkspaceId?: string) {
  const raw = await fs.readFile(datasetPath, "utf8")
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const cases: EvalCase[] = []

  for (let idx = 0; idx < lines.length; idx += 1) {
    const parsed = EvalCaseSchema.parse(JSON.parse(lines[idx]))
    const workspaceId = overrideWorkspaceId || parsed.workspaceId || process.env.EVAL_WORKSPACE_ID || ""
    if (!workspaceId) throw new Error(`Case ${idx + 1} is missing workspaceId`)
    cases.push({
      id: parsed.id || `onboarding-${idx + 1}`,
      workspaceId,
      snapshotId: parsed.snapshotId,
      question: parsed.question || null,
      filters: parsed.filters || null,
      maxCauses: parsed.maxCauses ?? null,
      expectedRoles: parsed.expectedRoles,
      expectedCauseIds: parsed.expectedCauseIds,
      notes: parsed.notes || null,
    })
  }

  return cases
}

async function buildCookie() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ""
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
  const email = process.env.E2E_USER_EMAIL || "e2e.proyectos@local.test"
  const password = process.env.E2E_USER_PASSWORD || "E2E_Proyecto_2026!"
  if (!supabaseUrl || !anonKey) throw new Error("Missing Supabase env for evaluation")

  const jar = new Map<string, string>()
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return Array.from(jar.entries()).map(([name, value]) => ({ name, value }))
      },
      setAll(cookies) {
        for (const cookie of cookies) {
          if (cookie.value) jar.set(cookie.name, cookie.value)
          else jar.delete(cookie.name)
        }
      },
    },
  })

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error

  return {
    cookie: Array.from(jar.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; "),
    userId: data.user?.id ? String(data.user.id) : null,
  }
}

async function preflightWorkspaceMembership(params: { userId: string | null; workspaceIds: string[] }) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  const userId = String(params.userId || "").trim()
  const workspaceIds = Array.from(new Set(params.workspaceIds.map((item) => String(item || "").trim()).filter(Boolean)))
  if (!supabaseUrl || !serviceKey || !userId || !workspaceIds.length) return null

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const { data } = await admin.from("gob_workspace_members").select("workspace_id").eq("user_id", userId).in("workspace_id", workspaceIds)
  return new Set<string>((data || []).map((row: any) => String(row.workspace_id || "")).filter(Boolean))
}

function ratio(matches: number, total: number) {
  if (!total) return null
  return Number((matches / total).toFixed(4))
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const datasetPath = path.resolve(opts.datasetPath)
  const cases = await readDataset(datasetPath, opts.workspaceId)
  const auth = await buildCookie()
  const sliced = typeof opts.maxCases === "number" ? cases.slice(0, opts.maxCases) : cases
  const accessible = await preflightWorkspaceMembership({ userId: auth.userId, workspaceIds: sliced.map((item) => item.workspaceId) })
  const results: CaseResult[] = []

  for (const item of sliced) {
    const startedAt = Date.now()
    try {
      if (accessible && !accessible.has(item.workspaceId)) {
        throw new Error(`Eval user is not a member of workspace ${item.workspaceId}`)
      }

      const res = await fetch(`${opts.appUrl.replace(/\/+$/, "")}/api/workspaces/${item.workspaceId}/onboarding/recommend`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          cookie: auth.cookie,
        },
        body: JSON.stringify({
          snapshotId: item.snapshotId,
          question: item.question,
          filters: item.filters,
          maxCauses: item.maxCauses,
        }),
      })

      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(JSON.stringify(json || { status: res.status }))

      const recommendations = Array.isArray(json?.recommendations) ? json.recommendations : []
      const topRoles = recommendations.map((rec: any) => String(rec?.rol || "").trim()).filter(Boolean)
      const topCauseIds = recommendations.map((rec: any) => String(rec?.causeId || "").trim()).filter(Boolean)

      const matchedRoles = item.expectedRoles.filter((role) => topRoles.some((candidate) => normalizeText(candidate) === normalizeText(role))).length
      const matchedCauseIds = item.expectedCauseIds.filter((causeId) => topCauseIds.includes(causeId)).length

      results.push({
        id: item.id,
        workspaceId: item.workspaceId,
        snapshotId: item.snapshotId,
        recommendationCount: recommendations.length,
        expectedRoleHitRate: ratio(matchedRoles, item.expectedRoles.length),
        expectedCauseHitRate: ratio(matchedCauseIds, item.expectedCauseIds.length),
        topRoles: topRoles.slice(0, 8),
        topCauseIds: topCauseIds.slice(0, 8),
        elapsedMs: Date.now() - startedAt,
        notes: item.notes,
      })
    } catch (err: any) {
      results.push({
        id: item.id,
        workspaceId: item.workspaceId,
        snapshotId: item.snapshotId,
        recommendationCount: 0,
        expectedRoleHitRate: null,
        expectedCauseHitRate: null,
        topRoles: [],
        topCauseIds: [],
        elapsedMs: Date.now() - startedAt,
        notes: item.notes,
        error: String(err?.message || err),
      })
    }
  }

  const roleRows = results.filter((row) => row.expectedRoleHitRate !== null)
  const causeRows = results.filter((row) => row.expectedCauseHitRate !== null)
  const summary = {
    cases: results.length,
    avgLatencyMs: results.length ? Math.round(results.reduce((acc, row) => acc + row.elapsedMs, 0) / results.length) : 0,
    avgRecommendations: results.length ? Number((results.reduce((acc, row) => acc + row.recommendationCount, 0) / results.length).toFixed(2)) : 0,
    expectedRoleHitRate: roleRows.length ? Number((roleRows.reduce((acc, row) => acc + Number(row.expectedRoleHitRate || 0), 0) / roleRows.length).toFixed(4)) : null,
    expectedCauseHitRate: causeRows.length ? Number((causeRows.reduce((acc, row) => acc + Number(row.expectedCauseHitRate || 0), 0) / causeRows.length).toFixed(4)) : null,
    errorCases: results.filter((row) => row.error).length,
  }

  const payload = { summary, results }
  const outPath = opts.outputPath ? path.resolve(opts.outputPath) : path.resolve(`eval/results/onboarding-recommend-${Date.now()}.json`)
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8")
  console.log(JSON.stringify({ outputPath: outPath, summary }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
