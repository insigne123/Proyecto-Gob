import "dotenv/config"

import fs from "node:fs/promises"
import path from "node:path"

import { createServerClient } from "@supabase/ssr"
import { z } from "zod"

type ReviewRoute = "professional" | "inline"

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
  route: ReviewRoute
  sourceId: string
  focus: string[]
  mustInclude: string[]
  mustNotInclude: string[]
  notes: string | null
}

type CaseResult = {
  id: string
  workspaceId: string
  route: ReviewRoute
  sourceId: string
  focus: string[]
  mustIncludeTotal: number
  mustIncludeMatched: number
  mustIncludeAllMatched: boolean | null
  mustNotIncludeTotal: number
  mustNotIncludeViolations: number
  mustNotIncludePass: boolean | null
  model: string | null
  evidenceCount: number | null
  findingsCount: number | null
  outputPreview: string
  elapsedMs: number
  notes: string | null
  error?: string
}

const EvalCaseSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    workspaceId: z.string().trim().min(1).optional(),
    route: z.enum(["professional", "inline"]).default("professional"),
    sourceId: z.string().trim().uuid(),
    focus: z.array(z.string().trim().min(1)).max(4).default([]),
    mustInclude: z.array(z.string().trim().min(1)).default([]),
    mustNotInclude: z.array(z.string().trim().min(1)).default([]),
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
    datasetPath: "eval/review-golden.jsonl",
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
    if (!workspaceId) {
      throw new Error(`Case ${idx + 1} is missing workspaceId`)
    }
    cases.push({
      id: parsed.id || `case-${idx + 1}`,
      workspaceId,
      route: parsed.route,
      sourceId: parsed.sourceId,
      focus: parsed.focus,
      mustInclude: parsed.mustInclude,
      mustNotInclude: parsed.mustNotInclude,
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

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error

  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ")
}

function countMatches(text: string, terms: string[]) {
  const normalized = normalizeText(text)
  let matched = 0
  for (const term of terms) {
    if (normalized.includes(normalizeText(term))) matched += 1
  }
  return matched
}

function previewReviewOutput(route: ReviewRoute, payload: any) {
  if (route === "professional") {
    const summary = payload?.review?.summary || {}
    const findings = Array.isArray(payload?.review?.findings) ? payload.review.findings : []
    const checklist = Array.isArray(payload?.review?.checklist) ? payload.review.checklist : []
    return [
      String(summary?.verdict || ""),
      ...findings.slice(0, 3).map((item: any) => `${item?.title || "Hallazgo"}: ${item?.recommendation || item?.issue || ""}`),
      ...checklist.slice(0, 3).map((item: any) => String(item || "")),
    ]
      .filter(Boolean)
      .join("\n")
  }

  const summary = payload?.review?.summary || {}
  const suggestions = Array.isArray(payload?.review?.suggestions) ? payload.review.suggestions : []
  const strategyInsights = Array.isArray(payload?.review?.strategyInsights) ? payload.review.strategyInsights : []
  return [
    String(summary?.overallVerdict || ""),
    ...suggestions.slice(0, 3).map((item: any) => `${item?.issue || "Sugerencia"}: ${item?.recommendation || ""}`),
    ...strategyInsights.slice(0, 3).map((item: any) => `${item?.title || "Insight"}: ${item?.recommendation || item?.insight || ""}`),
  ]
    .filter(Boolean)
    .join("\n")
}

function extractReviewStats(route: ReviewRoute, payload: any) {
  const stats = payload?.review?.stats || {}
  if (route === "professional") {
    return {
      model: stats?.model ? String(stats.model) : null,
      evidenceCount: typeof stats?.externalEvidenceChunks === "number" ? stats.externalEvidenceChunks : null,
      findingsCount: typeof stats?.findingsCount === "number" ? stats.findingsCount : null,
    }
  }
  return {
    model: stats?.model ? String(stats.model) : null,
    evidenceCount: typeof stats?.crossEvidence === "number" ? stats.crossEvidence : null,
    findingsCount: typeof stats?.suggestions === "number" ? stats.suggestions : null,
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const datasetPath = path.resolve(opts.datasetPath)
  const cases = await readDataset(datasetPath, opts.workspaceId)
  const cookie = await buildCookie()
  const sliced = typeof opts.maxCases === "number" ? cases.slice(0, opts.maxCases) : cases
  const results: CaseResult[] = []

  for (const item of sliced) {
    const startedAt = Date.now()
    try {
      const routePath =
        item.route === "professional"
          ? `/api/workspaces/${item.workspaceId}/reviews/professional`
          : `/api/workspaces/${item.workspaceId}/reviews/inline`
      const body =
        item.route === "professional"
          ? { sourceId: item.sourceId, focus: item.focus.length ? item.focus : undefined }
          : { sourceId: item.sourceId }

      const res = await fetch(`${opts.appUrl.replace(/\/+$/, "")}${routePath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          cookie,
        },
        body: JSON.stringify(body),
      })

      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(JSON.stringify(json || { status: res.status }))

      const preview = previewReviewOutput(item.route, json)
      const mustIncludeMatched = countMatches(preview, item.mustInclude)
      const mustNotIncludeViolations = countMatches(preview, item.mustNotInclude)
      const stats = extractReviewStats(item.route, json)

      results.push({
        id: item.id,
        workspaceId: item.workspaceId,
        route: item.route,
        sourceId: item.sourceId,
        focus: item.focus,
        mustIncludeTotal: item.mustInclude.length,
        mustIncludeMatched,
        mustIncludeAllMatched: item.mustInclude.length ? mustIncludeMatched === item.mustInclude.length : null,
        mustNotIncludeTotal: item.mustNotInclude.length,
        mustNotIncludeViolations,
        mustNotIncludePass: item.mustNotInclude.length ? mustNotIncludeViolations === 0 : null,
        model: stats.model,
        evidenceCount: stats.evidenceCount,
        findingsCount: stats.findingsCount,
        outputPreview: preview.slice(0, 800),
        elapsedMs: Date.now() - startedAt,
        notes: item.notes,
      })
    } catch (err: any) {
      results.push({
        id: item.id,
        workspaceId: item.workspaceId,
        route: item.route,
        sourceId: item.sourceId,
        focus: item.focus,
        mustIncludeTotal: item.mustInclude.length,
        mustIncludeMatched: 0,
        mustIncludeAllMatched: null,
        mustNotIncludeTotal: item.mustNotInclude.length,
        mustNotIncludeViolations: 0,
        mustNotIncludePass: null,
        model: null,
        evidenceCount: null,
        findingsCount: null,
        outputPreview: "",
        elapsedMs: Date.now() - startedAt,
        notes: item.notes,
        error: String(err?.message || err),
      })
    }
  }

  const summary = {
    cases: results.length,
    avgLatencyMs:
      results.length > 0 ? Math.round(results.reduce((acc, row) => acc + row.elapsedMs, 0) / results.length) : 0,
    mustIncludeAllMatchedRate:
      results.filter((row) => row.mustIncludeAllMatched !== null).length > 0
        ? Number(
            (
              results.filter((row) => row.mustIncludeAllMatched === true).length /
              results.filter((row) => row.mustIncludeAllMatched !== null).length
            ).toFixed(4)
          )
        : null,
    mustNotIncludePassRate:
      results.filter((row) => row.mustNotIncludePass !== null).length > 0
        ? Number(
            (
              results.filter((row) => row.mustNotIncludePass === true).length /
              results.filter((row) => row.mustNotIncludePass !== null).length
            ).toFixed(4)
          )
        : null,
  }

  const payload = { summary, results }
  const outPath = opts.outputPath ? path.resolve(opts.outputPath) : path.resolve(`eval/results/review-eval-${Date.now()}.json`)
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8")
  console.log(JSON.stringify({ outputPath: outPath, summary }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
