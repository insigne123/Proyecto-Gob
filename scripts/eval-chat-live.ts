import "dotenv/config"

import fs from "node:fs/promises"
import path from "node:path"

import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"
import { z } from "zod"

type ResponseProfile = "fast" | "balanced" | "deep" | "auto"
type ChatMode = "extractive" | "comparison" | "checklist" | "resolution"

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
  question: string
  mode: ChatMode
  responseProfile: ResponseProfile
  mustInclude: string[]
  mustNotInclude: string[]
  notes: string | null
}

type CaseResult = {
  id: string
  workspaceId: string
  question: string
  mode: ChatMode
  responseProfile: ResponseProfile
  mustIncludeTotal: number
  mustIncludeMatched: number
  mustIncludeAllMatched: boolean | null
  mustNotIncludeTotal: number
  mustNotIncludeViolations: number
  mustNotIncludePass: boolean | null
  citations: number
  supportStrength: string | null
  preferredDocRoles: string[]
  model: string | null
  totalTokens: number | null
  elapsedMs: number
  preview: string
  notes: string | null
  error?: string
}

const EvalCaseSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    workspaceId: z.string().trim().min(1).optional(),
    question: z.string().trim().min(6),
    mode: z.enum(["extractive", "comparison", "checklist", "resolution"]).default("checklist"),
    responseProfile: z.enum(["fast", "balanced", "deep", "auto"]).default("balanced"),
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
    datasetPath: "eval/chat-live.sea-smoke.jsonl",
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
      id: parsed.id || `chat-${idx + 1}`,
      workspaceId,
      question: parsed.question,
      mode: parsed.mode,
      responseProfile: parsed.responseProfile,
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

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error

  return {
    cookie: Array.from(jar.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; "),
    userId: data.user?.id ? String(data.user.id) : null,
  }
}

async function preflightWorkspaceMembership(params: {
  userId: string | null
  workspaceIds: string[]
}) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  const userId = String(params.userId || "").trim()
  const workspaceIds = Array.from(new Set(params.workspaceIds.map((item) => String(item || "").trim()).filter(Boolean)))

  if (!supabaseUrl || !serviceKey || !userId || !workspaceIds.length) {
    return null as { accessible: Set<string>; checked: boolean } | null
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const { data, error } = await admin
    .from("gob_workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .in("workspace_id", workspaceIds)

  if (error) {
    return { accessible: new Set<string>(), checked: false }
  }

  return {
    accessible: new Set<string>((data || []).map((row: any) => String(row.workspace_id || "")).filter(Boolean)),
    checked: true,
  }
}

function countMatches(text: string, terms: string[]) {
  const normalized = normalizeText(text)
  let matched = 0
  for (const term of terms) {
    if (normalized.includes(normalizeText(term))) matched += 1
  }
  return matched
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const datasetPath = path.resolve(opts.datasetPath)
  const cases = await readDataset(datasetPath, opts.workspaceId)
  const auth = await buildCookie()
  const sliced = typeof opts.maxCases === "number" ? cases.slice(0, opts.maxCases) : cases
  const membership = await preflightWorkspaceMembership({
    userId: auth.userId,
    workspaceIds: sliced.map((item) => item.workspaceId),
  })
  const results: CaseResult[] = []

  for (const item of sliced) {
    const startedAt = Date.now()
    try {
      if (membership?.checked && !membership.accessible.has(item.workspaceId)) {
        throw new Error(`Eval user is not a member of workspace ${item.workspaceId}`)
      }

      const res = await fetch(`${opts.appUrl.replace(/\/+$/, "")}/api/workspaces/${item.workspaceId}/chat`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          cookie: auth.cookie,
        },
        body: JSON.stringify({
          question: item.question,
          mode: item.mode,
          responseProfile: item.responseProfile,
        }),
      })

      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(JSON.stringify(json || { status: res.status }))

      const assistantMessage = json?.assistantMessage || json?.messages?.[json.messages.length - 1] || null
      const text = String(assistantMessage?.content || "")
      const mustIncludeMatched = countMatches(text, item.mustInclude)
      const mustNotIncludeViolations = countMatches(text, item.mustNotInclude)
      const report = assistantMessage?.usage?.assistantReport || {}

      results.push({
        id: item.id,
        workspaceId: item.workspaceId,
        question: item.question,
        mode: item.mode,
        responseProfile: item.responseProfile,
        mustIncludeTotal: item.mustInclude.length,
        mustIncludeMatched,
        mustIncludeAllMatched: item.mustInclude.length ? mustIncludeMatched === item.mustInclude.length : null,
        mustNotIncludeTotal: item.mustNotInclude.length,
        mustNotIncludeViolations,
        mustNotIncludePass: item.mustNotInclude.length ? mustNotIncludeViolations === 0 : null,
        citations: Array.isArray(assistantMessage?.citations) ? assistantMessage.citations.length : 0,
        supportStrength: report?.supportStrength ? String(report.supportStrength) : null,
        preferredDocRoles: Array.isArray(report?.preferredDocRoles) ? report.preferredDocRoles.map(String) : [],
        model: assistantMessage?.model ? String(assistantMessage.model) : report?.model ? String(report.model) : null,
        totalTokens: typeof assistantMessage?.usage?.total_tokens === "number"
          ? assistantMessage.usage.total_tokens
          : typeof assistantMessage?.usage?.totalTokens === "number"
            ? assistantMessage.usage.totalTokens
            : null,
        elapsedMs: Date.now() - startedAt,
        preview: text.slice(0, 900),
        notes: item.notes,
      })
    } catch (err: any) {
      results.push({
        id: item.id,
        workspaceId: item.workspaceId,
        question: item.question,
        mode: item.mode,
        responseProfile: item.responseProfile,
        mustIncludeTotal: item.mustInclude.length,
        mustIncludeMatched: 0,
        mustIncludeAllMatched: null,
        mustNotIncludeTotal: item.mustNotInclude.length,
        mustNotIncludeViolations: 0,
        mustNotIncludePass: null,
        citations: 0,
        supportStrength: null,
        preferredDocRoles: [],
        model: null,
        totalTokens: null,
        elapsedMs: Date.now() - startedAt,
        preview: "",
        notes: item.notes,
        error: String(err?.message || err),
      })
    }
  }

  const summary = {
    cases: results.length,
    avgLatencyMs: results.length ? Math.round(results.reduce((acc, row) => acc + row.elapsedMs, 0) / results.length) : 0,
    avgCitations: results.length ? Number((results.reduce((acc, row) => acc + row.citations, 0) / results.length).toFixed(2)) : 0,
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
    supportStrengths: results.reduce((acc, row) => {
      const key = row.supportStrength || "unknown"
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {} as Record<string, number>),
    totalTokens: results.reduce((acc, row) => acc + (row.totalTokens || 0), 0),
  }

  const payload = { summary, results }
  const outPath = opts.outputPath ? path.resolve(opts.outputPath) : path.resolve(`eval/results/chat-live-${Date.now()}.json`)
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8")
  console.log(JSON.stringify({ outputPath: outPath, summary }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
