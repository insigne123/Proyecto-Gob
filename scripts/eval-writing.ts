import "dotenv/config"

import fs from "node:fs/promises"
import path from "node:path"

import { createServerClient } from "@supabase/ssr"
import { z } from "zod"

type WritingTask = "proofread" | "counterargue"

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
  task: WritingTask
  text: string
  context: string | null
  mustInclude: string[]
  mustNotInclude: string[]
  notes: string | null
}

type CaseResult = {
  id: string
  workspaceId: string
  task: WritingTask
  textLength: number
  mustIncludeTotal: number
  mustIncludeMatched: number
  mustIncludeAllMatched: boolean | null
  mustNotIncludeTotal: number
  mustNotIncludeViolations: number
  mustNotIncludePass: boolean | null
  model: string | null
  evidenceChunks: number | null
  structuredMemory: boolean | null
  outputPreview: string
  elapsedMs: number
  notes: string | null
  error?: string
}

const EvalCaseSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    workspaceId: z.string().trim().min(1).optional(),
    task: z.enum(["proofread", "counterargue"]),
    text: z.string().trim().min(10),
    context: z.string().trim().max(5000).optional().nullable(),
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
    datasetPath: "eval/writing-golden.jsonl",
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
      task: parsed.task,
      text: parsed.text,
      context: parsed.context || null,
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
      const res = await fetch(`${opts.appUrl.replace(/\/+$/, "")}/api/workspaces/${item.workspaceId}/writing-assistant`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          cookie,
        },
        body: JSON.stringify({
          task: item.task,
          text: item.text,
          context: item.context,
        }),
      })

      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(JSON.stringify(json || { status: res.status }))

      const outputText = [
        String(json?.revisedText || ""),
        ...(Array.isArray(json?.observations) ? json.observations.map(String) : []),
        ...(Array.isArray(json?.suggestions) ? json.suggestions.map(String) : []),
        ...(Array.isArray(json?.counterArguments) ? json.counterArguments.map(String) : []),
      ].join("\n")

      const mustIncludeMatched = countMatches(outputText, item.mustInclude)
      const mustNotIncludeViolations = countMatches(outputText, item.mustNotInclude)

      results.push({
        id: item.id,
        workspaceId: item.workspaceId,
        task: item.task,
        textLength: item.text.length,
        mustIncludeTotal: item.mustInclude.length,
        mustIncludeMatched,
        mustIncludeAllMatched: item.mustInclude.length ? mustIncludeMatched === item.mustInclude.length : null,
        mustNotIncludeTotal: item.mustNotInclude.length,
        mustNotIncludeViolations,
        mustNotIncludePass: item.mustNotInclude.length ? mustNotIncludeViolations === 0 : null,
        model: json?.meta?.model ? String(json.meta.model) : null,
        evidenceChunks: typeof json?.meta?.evidenceChunks === "number" ? json.meta.evidenceChunks : null,
        structuredMemory: typeof json?.meta?.structuredMemory === "boolean" ? json.meta.structuredMemory : null,
        outputPreview: String(json?.revisedText || "").slice(0, 600),
        elapsedMs: Date.now() - startedAt,
        notes: item.notes,
      })
    } catch (err: any) {
      results.push({
        id: item.id,
        workspaceId: item.workspaceId,
        task: item.task,
        textLength: item.text.length,
        mustIncludeTotal: item.mustInclude.length,
        mustIncludeMatched: 0,
        mustIncludeAllMatched: null,
        mustNotIncludeTotal: item.mustNotInclude.length,
        mustNotIncludeViolations: 0,
        mustNotIncludePass: null,
        model: null,
        evidenceChunks: null,
        structuredMemory: null,
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
  const outPath = opts.outputPath ? path.resolve(opts.outputPath) : path.resolve(`eval/results/writing-eval-${Date.now()}.json`)
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8")
  console.log(JSON.stringify({ outputPath: outPath, summary }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
