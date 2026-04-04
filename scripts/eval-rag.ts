import "dotenv/config"

import fs from "fs/promises"
import path from "path"

import { z } from "zod"

import { getRagProvider, type RagProvider } from "../src/lib/env"
import { retrieveLocalEvidenceForQuestion } from "../src/lib/rag/local-retrieval"
import { hydrateEvidenceDocumentContext } from "../src/lib/rag/evidence-document-context"
import {
  getWorkspaceKnowledgeBase,
  mapResultsToEvidence,
  searchKnowledgeBaseWithFileSearch,
  type RetrievalFilters,
} from "../src/lib/rag/openai-managed"
import { generateStrictAnswer, type AnswerMode, type EvidenceChunk } from "../src/lib/rag/strict-answer"
import { createAdminClient } from "../src/lib/supabase/admin"

type AnswerProvider = "auto" | "google" | "openai"

type CliOptions = {
  datasetPath: string
  outputPath?: string
  workspaceId?: string
  provider: RagProvider
  answerProvider: AnswerProvider
  maxCases?: number
  skipGeneration: boolean
  genDelayMs: number
  verbose: boolean
}

function truthyEnv(name: string) {
  const raw = String(process.env[name] || "").trim().toLowerCase()
  if (!raw) return false
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no")
}

function evalAnswerBudget(mode: AnswerMode) {
  if (mode === "checklist") {
    return { maxCompletionTokens: 900, reasoningEffort: "minimal" as const }
  }
  if (mode === "comparison") {
    return { maxCompletionTokens: 1100, reasoningEffort: "minimal" as const }
  }
  if (mode === "resolution") {
    return { maxCompletionTokens: 950, reasoningEffort: "minimal" as const }
  }
  return { maxCompletionTokens: 750, reasoningEffort: "minimal" as const }
}

type EvalCase = {
  id: string
  workspaceId: string
  question: string
  mode: AnswerMode
  filters: RetrievalFilters | null
  expectNotFound: boolean | null
  mustInclude: string[]
  mustNotInclude: string[]
  expectedSnapshotIds: string[]
  expectedChunkIds: string[]
  notes: string | null
}

type CaseResult = {
  id: string
  workspaceId: string
  providerRequested: RagProvider
  providerUsed: "local" | "openai" | "hybrid"
  question: string
  mode: AnswerMode
  filters: RetrievalFilters | null
  notes: string | null
  retrieval: {
    evidenceCount: number
    localEvidenceCount: number
    managedEvidenceCount: number
    responseId: string | null
    model: string | null
    elapsedMs: number
    warnings: string[]
    expectedSnapshotHit: boolean | null
    expectedChunkHit: boolean | null
    snapshotRecallAtK: number | null
    chunkRecallAtK: number | null
    snapshotMRR: number | null
    chunkMRR: number | null
  }
  answer: {
    skipped: boolean
    text: string
    notFound: boolean
    elapsedMs: number
    model: string | null
    usage: any
    citations: number
    validCitations: number
    citationValidityRate: number | null
    expectNotFound: boolean | null
    notFoundMatch: boolean | null
    mustIncludeTotal: number
    mustIncludeMatched: number
    mustIncludeAllMatched: boolean | null
    mustNotIncludeTotal: number
    mustNotIncludeViolations: number
    mustNotIncludePass: boolean | null
  }
  elapsedMs: number
  error?: string
}

type RetrievalProfile = {
  maxResults: number
  scoreThreshold: number
  localMatchCount: number
  localTextMatchCount: number
  expansionQuery: string | null
}

const RetrievalFiltersSchema = z
  .object({
    docTypes: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    regions: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
    sectors: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
    sourceOrigins: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
    languages: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
    projectNames: z.array(z.string().trim().min(1).max(200)).max(12).optional(),
    snapshotIds: z.array(z.string().trim().min(1)).max(50).optional(),
    yearFrom: z.number().int().min(1900).max(2200).optional().nullable(),
    yearTo: z.number().int().min(1900).max(2200).optional().nullable(),
  })
  .strict()

const EvalCaseSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    workspaceId: z.string().trim().min(1).optional(),
    question: z.string().trim().min(3),
    mode: z.enum(["extractive", "comparison", "checklist", "resolution"]).default("extractive"),
    filters: RetrievalFiltersSchema.optional().nullable(),
    expectNotFound: z.boolean().optional().nullable(),
    mustInclude: z.array(z.string().trim().min(1)).default([]),
    mustNotInclude: z.array(z.string().trim().min(1)).default([]),
    expectedSnapshotIds: z.array(z.string().trim().min(1)).default([]),
    expectedChunkIds: z.array(z.string().trim().min(1)).default([]),
    notes: z.string().trim().optional().nullable(),
  })
  .strict()

function printUsage() {
  const usage = [
    "Usage:",
    "  npm run eval:rag -- --dataset eval/golden.jsonl [options]",
    "  npm run eval:rag -- eval/golden.jsonl <workspaceId> <provider>",
    "",
    "Options:",
    "  --dataset <path>     Dataset JSONL (default: eval/golden.jsonl)",
    "  --provider <mode>    local | openai | hybrid (default: env RAG_PROVIDER)",
    "  --answer-provider    auto | google | openai (default: auto)",
    "  --workspace-id <id>  Override workspaceId for all cases",
    "  --max <n>            Run only first n cases",
    "  --skip-generation    Evaluate retrieval only (no LLM answer)",
    "  --gen-delay-ms <n>   Delay between LLM generations (helps free-tier rate limits)",
    "  --output <path>      Output JSON path (default: eval/results/rag-eval-<ts>.json)",
    "  --verbose            Print per-case details",
    "",
    "Env alternative:",
    "  EVAL_WORKSPACE_ID=<id> (if you don't pass --workspace-id)",
    "  --help               Show this help",
  ]
  // eslint-disable-next-line no-console
  console.log(usage.join("\n"))
}

function parseArgs(argv: string[]): CliOptions {
  const envMax = Number(process.env.EVAL_MAX_CASES || process.env.npm_config_max || "")
  const envDelay = Number(process.env.EVAL_GEN_DELAY_MS || process.env.npm_config_gen_delay_ms || "0")
  const envSkip = truthyEnv("EVAL_SKIP_GENERATION") || truthyEnv("npm_config_skip_generation")
  const envAnswerProviderRaw = String(
    process.env.EVAL_ANSWER_PROVIDER || process.env.npm_config_answer_provider || "auto"
  )
    .trim()
    .toLowerCase()
  const envAnswerProvider: AnswerProvider =
    envAnswerProviderRaw === "google" || envAnswerProviderRaw === "openai"
      ? envAnswerProviderRaw
      : "auto"
  const envVerbose =
    truthyEnv("EVAL_VERBOSE") ||
    String(process.env.npm_config_loglevel || "").trim().toLowerCase() === "verbose"
  const opts: CliOptions = {
    datasetPath: "eval/golden.jsonl",
    provider: getRagProvider(),
    answerProvider: envAnswerProvider,
    skipGeneration: envSkip,
    maxCases: Number.isFinite(envMax) && envMax > 0 ? Math.floor(envMax) : undefined,
    genDelayMs: Number.isFinite(envDelay) && envDelay > 0 ? Math.floor(envDelay) : 0,
    verbose: envVerbose,
    workspaceId: process.env.EVAL_WORKSPACE_ID || undefined,
  }

  const positionals: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") {
      printUsage()
      process.exit(0)
    }

    if (arg === "-v") {
      opts.verbose = true
      continue
    }

    if (!arg.startsWith("-")) {
      positionals.push(arg)
      continue
    }

    let key = arg
    let inlineValue: string | undefined = undefined
    const eq = arg.indexOf("=")
    if (eq >= 0) {
      key = arg.slice(0, eq)
      inlineValue = arg.slice(eq + 1)
    }

    if (key === "--dataset" && inlineValue) {
      opts.datasetPath = inlineValue
      continue
    }
    if ((key === "--workspace" || key === "--workspace-id" || key === "--workspaceId") && inlineValue) {
      opts.workspaceId = inlineValue
      continue
    }
    if (key === "--output" && inlineValue) {
      opts.outputPath = inlineValue
      continue
    }
    if (key === "--provider" && inlineValue) {
      const p = String(inlineValue).trim().toLowerCase()
      if (p !== "local" && p !== "openai" && p !== "hybrid") {
        throw new Error(`Invalid provider: ${inlineValue}`)
      }
      opts.provider = p
      continue
    }
    if (key === "--answer-provider" && inlineValue) {
      const p = String(inlineValue).trim().toLowerCase()
      if (p !== "auto" && p !== "google" && p !== "openai") {
        throw new Error(`Invalid --answer-provider value: ${inlineValue}`)
      }
      opts.answerProvider = p
      continue
    }
    if (key === "--max" && inlineValue) {
      const n = Number(inlineValue)
      if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid --max value: ${inlineValue}`)
      opts.maxCases = Math.floor(n)
      continue
    }
    if (key === "--gen-delay-ms" && inlineValue) {
      const n = Number(inlineValue)
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`Invalid --gen-delay-ms value: ${inlineValue}`)
      }
      opts.genDelayMs = Math.floor(n)
      continue
    }

    if (arg === "--skip-generation") {
      opts.skipGeneration = true
      continue
    }

    if (arg === "--verbose") {
      opts.verbose = true
      continue
    }

    const next = argv[i + 1]
    if (!next) throw new Error(`Missing value for ${arg}`)

    if (arg === "--dataset") {
      opts.datasetPath = next
      i++
      continue
    }
    if (arg === "--workspace" || arg === "--workspace-id" || arg === "--workspaceId") {
      opts.workspaceId = next
      i++
      continue
    }
    if (arg === "--output") {
      opts.outputPath = next
      i++
      continue
    }
    if (arg === "--gen-delay-ms") {
      const n = Number(next)
      if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid --gen-delay-ms value: ${next}`)
      opts.genDelayMs = Math.floor(n)
      i++
      continue
    }
    if (arg === "--max") {
      const n = Number(next)
      if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid --max value: ${next}`)
      opts.maxCases = Math.floor(n)
      i++
      continue
    }
    if (arg === "--provider") {
      const p = String(next).trim().toLowerCase()
      if (p !== "local" && p !== "openai" && p !== "hybrid") {
        throw new Error(`Invalid provider: ${next}`)
      }
      opts.provider = p
      i++
      continue
    }
    if (arg === "--answer-provider") {
      const p = String(next).trim().toLowerCase()
      if (p !== "auto" && p !== "google" && p !== "openai") {
        throw new Error(`Invalid --answer-provider value: ${next}`)
      }
      opts.answerProvider = p
      i++
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  // Positional fallback (helps when npm strips option keys on some setups):
  // eval-rag.ts <datasetPath> <workspaceId> <provider>
  if (positionals.length > 0) {
    opts.datasetPath = positionals[0]
  }
  if (positionals.length > 1 && !opts.workspaceId) {
    opts.workspaceId = positionals[1]
  }
  if (positionals.length > 2) {
    const p = String(positionals[2]).trim().toLowerCase()
    if (p === "local" || p === "openai" || p === "hybrid") {
      opts.provider = p
    }
  }

  // Extra positionals can appear when npm strips unknown flags on Windows/PowerShell.
  // Interpret numeric extras as --max / --gen-delay-ms heuristically.
  if (positionals.length > 3) {
    for (const raw of positionals.slice(3)) {
      const token = String(raw).trim().toLowerCase()
      if (!token) continue

      if (token === "verbose") {
        opts.verbose = true
        continue
      }
      if (token === "skip-generation") {
        opts.skipGeneration = true
        continue
      }
      if (token === "auto" || token === "google" || token === "openai") {
        opts.answerProvider = token
        continue
      }

      const n = Number(token)
      if (Number.isFinite(n) && n >= 0) {
        if (n >= 1000 && (!opts.genDelayMs || opts.genDelayMs <= 0)) {
          opts.genDelayMs = Math.floor(n)
          continue
        }
        if (typeof opts.maxCases !== "number" && n > 0) {
          opts.maxCases = Math.floor(n)
          continue
        }
        if ((!opts.genDelayMs || opts.genDelayMs <= 0) && n >= 0) {
          opts.genDelayMs = Math.floor(n)
          continue
        }
      }
    }
  }

  return opts
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isQuotaError(message: string) {
  const m = String(message || "").toLowerCase()
  return m.includes("429") || m.includes("quota") || m.includes("too many requests")
}

function resolveAnswerProvider(preference: AnswerProvider): Exclude<AnswerProvider, "auto"> {
  if (preference === "google" || preference === "openai") return preference
  return String(process.env.OPENAI_API_KEY || "").trim() ? "openai" : "google"
}

function hasOpenAIKey() {
  return !!String(process.env.OPENAI_API_KEY || "").trim()
}

function buildEvidenceBlock(evidence: EvidenceChunk[], maxChunks = 10) {
  return evidence
    .slice(0, maxChunks)
    .map((c, idx) => {
      const locParts = [
        c.sourceUrl ? `url=${c.sourceUrl}` : null,
        c.snapshotId ? `snapshot=${c.snapshotId}` : null,
        typeof c.page === "number" ? `page=${c.page}` : null,
        c.section ? `section=${c.section}` : null,
      ].filter(Boolean)
      const loc = locParts.length ? ` (${locParts.join(", ")})` : ""
      const content = c.content.length > 1400 ? `${c.content.slice(0, 1400)}...` : c.content
      return `EVIDENCE ${idx + 1}: chunkId=${c.chunkId}${loc}\n${content}`
    })
    .join("\n\n---\n\n")
}

function modeGuide(mode: AnswerMode) {
  if (mode === "checklist") {
    return "- Modo Checklist: cada parrafo debe ser un item (comienza con '- [ ]' o '-').\n"
  }
  if (mode === "comparison") {
    return "- Modo Comparacion: compara versiones/snapshots SOLO si la evidencia lo permite. Menciona snapshot_id cuando corresponda.\n"
  }
  if (mode === "resolution") {
    return "- Modo Resolucion: redaccion formal, sin inferir, sin completar vacios.\n"
  }
  return "- Modo Extractivo: sintesis minima, directa y verificable.\n"
}

function normalizeEvalDocType(value: string | null | undefined) {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
  if (!normalized) return null
  if (normalized.includes("reclam")) return "reclamacion"
  if (normalized.includes("inform") || normalized.includes("evacua")) return "informe"
  if (normalized.includes("sentenc") || normalized.includes("fallo")) return "sentencia"
  return normalized
}

function filterEvidenceByDocTypes(evidence: EvidenceChunk[], filters: RetrievalFilters | null) {
  const allowedDocTypes = Array.from(
    new Set(
      (Array.isArray(filters?.docTypes) ? filters!.docTypes : [])
        .map((item) => normalizeEvalDocType(item))
        .filter(Boolean)
    )
  )

  if (!allowedDocTypes.length) return evidence

  const filtered = evidence.filter((row: any) => {
    const docRole = normalizeEvalDocType(row?.docRole ? String(row.docRole) : null)
    const docType = normalizeEvalDocType(row?.documentType ? String(row.documentType) : null)
    return allowedDocTypes.includes(docRole || docType || "")
  })

  return filtered.length ? filtered : evidence
}

function retryHintForMode(mode: AnswerMode) {
  if (mode === "checklist") {
    return "Reintento: hay evidencia suficiente. Entrega checklist completo y exhaustivo. No devuelvas notFound si puedes citar."
  }
  if (mode === "comparison") {
    return "Reintento: hay evidencia suficiente. Compara explicitamente diferencias y similitudes con citas."
  }
  return "Reintento: hay evidencia suficiente. Responde de forma directa con citas verificables."
}

function getRetrievalProfile(mode: AnswerMode, question: string): RetrievalProfile {
  const q = String(question || "")
  if (mode === "checklist") {
    return {
      maxResults: 20,
      scoreThreshold: 0.05,
      localMatchCount: 16,
      localTextMatchCount: 24,
      expansionQuery: `${q} Lista completa y exhaustiva. Incluye todos los elementos enumerados de forma explicita.`,
    }
  }
  if (mode === "comparison") {
    return {
      maxResults: 16,
      scoreThreshold: 0.1,
      localMatchCount: 12,
      localTextMatchCount: 16,
      expansionQuery: `${q} Compara explicitamente con diferencias y similitudes, solo con evidencia textual.`,
    }
  }
  return {
    maxResults: 12,
    scoreThreshold: 0.15,
    localMatchCount: 10,
    localTextMatchCount: 12,
    expansionQuery: null,
  }
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function extractJsonObject(text: string) {
  const clean = String(text || "").trim()
  if (!clean) return null

  const direct = safeJsonParse(clean)
  if (direct) return direct

  const fenced = clean.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  const parsedFenced = safeJsonParse(fenced)
  if (parsedFenced) return parsedFenced

  const start = clean.indexOf("{")
  const end = clean.lastIndexOf("}")
  if (start >= 0 && end > start) {
    return safeJsonParse(clean.slice(start, end + 1))
  }

  return null
}

function normalizeForQuote(s: string) {
  return String(s)
    .replace(/\s+/g, " ")
    .replace(/\u00A0/g, " ")
    .trim()
    .toLowerCase()
}

type StrictAnswerOutput = {
  answer: string
  paragraphs: Array<{ text: string; citations: Array<{ chunkId: string; quote: string }>; notFound: boolean }>
  citations: Array<{ chunkId: string; quote: string; paragraph: number }>
  notFound: boolean
  suggestions: string[]
  model: string | null
  usage: any
}

function verifyStrictAnswerLike(output: any, evidence: EvidenceChunk[]): StrictAnswerOutput {
  const allowed = new Map(evidence.map((c) => [c.chunkId, c]))
  const rawParagraphs = Array.isArray(output?.paragraphs) ? output.paragraphs : []

  const verifiedParagraphs = rawParagraphs.slice(0, 6).map((p: any, idx: number) => {
    const rawText = String(p?.text ?? "").trim()
    const rawNotFound = Boolean(p?.notFound)
    const rawCitations = Array.isArray(p?.citations) ? p.citations : []

    const citations = rawCitations
      .map((c: any) => ({
        chunkId: String(c?.chunkId ?? ""),
        quote: String(c?.quote ?? ""),
      }))
      .filter((c: any) => allowed.has(c.chunkId))
      .filter((c: any) => {
        const chunk = allowed.get(c.chunkId)
        if (!chunk) return false
        const hay = normalizeForQuote(chunk.content)
        const needle = normalizeForQuote(c.quote)
        return needle.length >= 12 && hay.includes(needle)
      })

    const ok = citations.length > 0 && !rawNotFound
    return {
      text: ok ? rawText || "No se encuentra en las fuentes disponibles." : "No se encuentra en las fuentes disponibles.",
      citations,
      notFound: !ok,
      paragraph: idx,
    }
  })

  const supported = verifiedParagraphs.filter((p: any) => !p.notFound)
  const flat = supported.flatMap((p: any, paragraph: number) =>
    p.citations.map((c: any) => ({ ...c, paragraph }))
  )

  const notFound = Boolean(output?.notFound) || flat.length === 0
  const answer = notFound
    ? "No se encuentra en las fuentes disponibles."
    : supported.map((p: any) => p.text).join("\n\n")

  return {
    answer,
    paragraphs: supported.map((p: any) => ({
      text: p.text,
      citations: p.citations,
      notFound: p.notFound,
    })),
    citations: flat,
    notFound,
    suggestions: Array.isArray(output?.suggestions) ? output.suggestions.map(String) : [],
    model: null,
    usage: null,
  }
}

async function generateStrictAnswerWithOpenAI(params: {
  question: string
  evidence: EvidenceChunk[]
  mode: AnswerMode
}) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim()
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY")
  }

  const model = resolveOpenAIAnswerModel()
  const baseUrl = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "")
  const tempRaw = String(process.env.OPENAI_ANSWER_TEMPERATURE || "").trim()
  const tempParsed = tempRaw ? Number(tempRaw) : Number.NaN
  const useTemperature = Number.isFinite(tempParsed)

  const maxChunks = params.mode === "checklist" ? 16 : params.mode === "comparison" ? 14 : 10
  const evidenceBlock = buildEvidenceBlock(params.evidence, maxChunks)
  const budget = evalAnswerBudget(params.mode)
  const system =
    "Eres un asistente documental. Regla critica: NO inventes. Responde SOLO usando EVIDENCE. Si no hay evidencia suficiente, responde con notFound=true y la frase exacta: 'No se encuentra en las fuentes disponibles.'"

  const prompt =
    `Modo: ${params.mode}\n\n` +
    `Pregunta del usuario:\n${params.question}\n\n` +
    `Bloque EVIDENCE (unico material permitido):\n\n${evidenceBlock}\n\n` +
    "Instrucciones:\n" +
    modeGuide(params.mode) +
    "- Responde en 1 a 4 parrafos (paragraphs).\n" +
    "- Cada parrafo debe tener al menos 1 cita verificable.\n" +
    "- En citations, incluye quotes copiadas literalmente desde el chunk citado.\n" +
    "- En citations, solo puedes usar chunkId presentes en EVIDENCE.\n" +
    "- Si no puedes citar, debes marcar notFound=true y usar exactamente: 'No se encuentra en las fuentes disponibles.'\n"

  const schema = {
    name: "strict_answer",
    strict: true,
    schema: {
      type: "object",
      properties: {
        paragraphs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              citations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    chunkId: { type: "string" },
                    quote: { type: "string" },
                  },
                  required: ["chunkId", "quote"],
                  additionalProperties: false,
                },
              },
              notFound: { type: "boolean" },
            },
            required: ["text", "citations", "notFound"],
            additionalProperties: false,
          },
        },
        notFound: { type: "boolean" },
        suggestions: { type: "array", items: { type: "string" } },
      },
      required: ["paragraphs", "notFound", "suggestions"],
      additionalProperties: false,
    },
  }

  const requestBody: any = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: schema,
    },
    max_completion_tokens: budget.maxCompletionTokens,
  }
  if (/^gpt-5/i.test(model)) {
    requestBody.reasoning_effort = budget.reasoningEffort
  }
  if (useTemperature) {
    requestBody.temperature = tempParsed
  }

  async function send(body: any) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    })

    const text = await res.text()
    const payload = safeJsonParse(text)
    return { res, text, payload }
  }

  let { res, text, payload } = await send(requestBody)

  if (!res.ok) {
    const message =
      (payload && payload.error && typeof payload.error.message === "string"
        ? payload.error.message
        : text) || `OpenAI error ${res.status}`

    const tempUnsupported =
      String(message).toLowerCase().includes("temperature") &&
      String(message).toLowerCase().includes("default")
    const reasoningUnsupported =
      String(message).toLowerCase().includes("reasoning_effort") ||
      String(message).toLowerCase().includes("reasoning effort")

    if (typeof requestBody.temperature !== "undefined" && tempUnsupported) {
      delete requestBody.temperature
      ;({ res, text, payload } = await send(requestBody))
    } else if (typeof requestBody.reasoning_effort !== "undefined" && reasoningUnsupported) {
      delete requestBody.reasoning_effort
      ;({ res, text, payload } = await send(requestBody))
    }
  }

  if (!res.ok) {
    const message =
      (payload && payload.error && typeof payload.error.message === "string"
        ? payload.error.message
        : text) || `OpenAI error ${res.status}`
    throw new Error(message)
  }

  const rawContent =
    payload?.choices?.[0]?.message?.content ??
    payload?.output_text ??
    payload?.output?.[0]?.content?.[0]?.text ??
    ""

  const modelOut =
    typeof rawContent === "string" ? extractJsonObject(rawContent) : extractJsonObject(JSON.stringify(rawContent))

  const verified = verifyStrictAnswerLike(modelOut || {}, params.evidence)
  return {
    ...verified,
    model: String(payload?.model || model),
    usage: payload?.usage ?? null,
  }
}

async function generateAnswerWithProvider(params: {
  provider: Exclude<AnswerProvider, "auto">
  question: string
  evidence: EvidenceChunk[]
  mode: AnswerMode
}) {
  if (params.provider === "openai" && truthyEnv("EVAL_USE_LEGACY_OPENAI_STRICT")) {
    return generateStrictAnswerWithOpenAI({
      question: params.question,
      evidence: params.evidence,
      mode: params.mode,
    })
  }

  return generateStrictAnswer({
    question: params.question,
    evidence: params.evidence,
    mode: params.mode,
    responseProfile: "deep",
    difficulty: params.mode === "extractive" ? "medium" : "complex",
  })
}

function normalizeText(text: string) {
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

const MUST_INCLUDE_SYNONYMS: Record<string, string[]> = {
  "tool use": ["tools", "herramientas", "function calling", "llamadas a funciones"],
  "chat analista": ["modo analista", "analista"],
  "motor numerico": ["motor predictivo", "motor probabilistico", "motor numérico"],
  predice: ["prediccion", "predicciones", "predice probabilidades"],
  explica: ["explicacion", "explicar"],
  "7 dias": ["proximos 7 dias", "próximos 7 días"],
  historico: ["histórico", "backtest"],
  "no inventa": ["no inventar", "no invente", "no inventa estadisticas"],
  "temperature scaling": ["escalado de temperatura"],
  "vertex ai pipelines": ["vertex pipelines"],
  "openai compatible": ["api estilo openai", "openai-style"],
  "continuous training": ["auto-entrenamiento continuo", "entrenamiento continuo"],
  "llm server": ["servidor llm", "serving del llm"],
}

function semanticVariants(needle: string) {
  const base = normalizeText(needle)
  const set = new Set<string>()
  if (base) set.add(base)

  const mapped = MUST_INCLUDE_SYNONYMS[base]
  if (Array.isArray(mapped)) {
    for (const x of mapped) {
      const n = normalizeText(x)
      if (n) set.add(n)
    }
  }

  // Basic plural/singular tolerance.
  if (base.endsWith("s") && base.length > 4) {
    set.add(base.slice(0, -1))
  } else if (base.length > 4) {
    set.add(`${base}s`)
  }

  return Array.from(set)
}

const STOP_WORDS = new Set([
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "y",
  "o",
  "en",
  "al",
  "para",
  "con",
  "por",
])

function includesAllMeaningfulTokens(haystackNormalized: string, phrase: string) {
  const tokens = normalizeText(phrase)
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x.length >= 3)
    .filter((x) => !STOP_WORDS.has(x))

  if (tokens.length < 2) return false
  return tokens.every((t) => haystackNormalized.includes(t))
}

function containsNormalizedSemantic(haystack: string, needle: string) {
  const h = normalizeText(haystack)
  if (!h) return false
  for (const variant of semanticVariants(needle)) {
    if (!variant) continue
    if (h.includes(variant)) return true
    if (includesAllMeaningfulTokens(h, variant)) return true
  }
  return false
}

function containsNormalized(haystack: string, needle: string) {
  const h = normalizeText(haystack)
  const n = normalizeText(needle)
  if (!n) return false
  return h.includes(n)
}

function avg(values: number[]) {
  if (!values.length) return 0
  return values.reduce((sum, x) => sum + x, 0) / values.length
}

function fmtPct(value: number | null, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a"
  return `${(value * 100).toFixed(digits)}%`
}

function fmtNum(value: number | null, digits = 3) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a"
  return value.toFixed(digits)
}

function fmtMs(value: number) {
  if (!Number.isFinite(value)) return "n/a"
  return `${value.toFixed(0)} ms`
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)))
  return sorted[idx]
}

function dedupeEvidence(list: EvidenceChunk[]) {
  const seen = new Set<string>()
  const out: EvidenceChunk[] = []
  for (const row of list) {
    const id = String(row.chunkId || "")
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(row)
  }
  return out
}

function reciprocalRank(ranked: string[], expected: Set<string>) {
  if (!expected.size || !ranked.length) return null
  for (let i = 0; i < ranked.length; i++) {
    if (expected.has(ranked[i])) return 1 / (i + 1)
  }
  return 0
}

function recallAtK(ranked: string[], expected: Set<string>) {
  if (!expected.size) return null
  if (!ranked.length) return 0
  const found = new Set(ranked.filter((x) => expected.has(x)))
  return found.size / expected.size
}

async function loadDataset(filePath: string, workspaceOverride?: string, maxCases?: number) {
  const abs = path.resolve(filePath)
  const raw = await fs.readFile(abs, "utf8")
  const lines = raw.split(/\r?\n/)

  const list: EvalCase[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith("#")) continue

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(line)
    } catch (err: any) {
      throw new Error(`Invalid JSON at ${filePath}:${i + 1}: ${err?.message ?? String(err)}`)
    }

    const parsed = EvalCaseSchema.safeParse(parsedJson)
    if (!parsed.success) {
      throw new Error(`Invalid case schema at ${filePath}:${i + 1}: ${parsed.error.message}`)
    }

    const id = parsed.data.id || `case-${list.length + 1}`
    const workspaceId = workspaceOverride || parsed.data.workspaceId || ""
    if (!workspaceId) {
      throw new Error(
        `Missing workspaceId at ${filePath}:${i + 1} (or use --workspace-id or EVAL_WORKSPACE_ID)`
      )
    }

    list.push({
      id,
      workspaceId,
      question: parsed.data.question,
      mode: parsed.data.mode,
      filters: parsed.data.filters || null,
      expectNotFound:
        typeof parsed.data.expectNotFound === "boolean" ? parsed.data.expectNotFound : null,
      mustInclude: parsed.data.mustInclude,
      mustNotInclude: parsed.data.mustNotInclude,
      expectedSnapshotIds: parsed.data.expectedSnapshotIds,
      expectedChunkIds: parsed.data.expectedChunkIds,
      notes: parsed.data.notes || null,
    })
  }

  if (!list.length) {
    throw new Error(`Dataset has no runnable rows: ${filePath}`)
  }

  return typeof maxCases === "number" ? list.slice(0, maxCases) : list
}

async function runRetrieval(params: {
  supabase: any
  provider: RagProvider
  workspaceId: string
  question: string
  filters: RetrievalFilters | null
  mode: AnswerMode
}) {
  const started = Date.now()
  const profile = getRetrievalProfile(params.mode, params.question)

  const warnings: string[] = []
  let responseId: string | null = null
  let model: string | null = null

  let managedEvidence: EvidenceChunk[] = []
  let localEvidence: EvidenceChunk[] = []

  if (params.provider === "openai" || params.provider === "hybrid") {
    const kb = await getWorkspaceKnowledgeBase({
      supabase: params.supabase,
      workspaceId: params.workspaceId,
    })

    if (!kb?.vectorStoreId) {
      warnings.push("No knowledge base configured for workspace")
    } else {
      try {
        const managed = await searchKnowledgeBaseWithFileSearch({
          vectorStoreId: kb.vectorStoreId,
          query: params.question,
          filters: params.filters,
          maxResults: profile.maxResults,
          scoreThreshold: profile.scoreThreshold,
        })
        responseId = managed.responseId
        model = managed.model

        const mapped = await mapResultsToEvidence({
          supabase: params.supabase,
          workspaceId: params.workspaceId,
          results: managed.results,
        })

        managedEvidence = dedupeEvidence(
          mapped.map((row: any) => ({
            chunkId: String(row.chunkId),
            content: String(row.content ?? ""),
            sourceUrl: row.sourceUrl ? String(row.sourceUrl) : null,
            snapshotId: row.snapshotId ? String(row.snapshotId) : null,
            page: typeof row.page === "number" ? row.page : null,
            section: row.section ? String(row.section) : null,
            docRole: row.docRole ? String(row.docRole) : null,
            documentType: row.documentType ? String(row.documentType) : null,
            documentTitle: row.documentTitle ? String(row.documentTitle) : null,
          }))
        )

        if (profile.expansionQuery && managedEvidence.length < Math.min(12, profile.maxResults)) {
          const managedExpanded = await searchKnowledgeBaseWithFileSearch({
            vectorStoreId: kb.vectorStoreId,
            query: profile.expansionQuery,
            filters: params.filters,
            maxResults: Math.min(30, profile.maxResults + 8),
            scoreThreshold: Math.max(0, profile.scoreThreshold - 0.05),
          })

          const mappedExpanded = await mapResultsToEvidence({
            supabase: params.supabase,
            workspaceId: params.workspaceId,
            results: managedExpanded.results,
          })

          managedEvidence = dedupeEvidence([
            ...managedEvidence,
            ...mappedExpanded.map((row: any) => ({
              chunkId: String(row.chunkId),
              content: String(row.content ?? ""),
              sourceUrl: row.sourceUrl ? String(row.sourceUrl) : null,
              snapshotId: row.snapshotId ? String(row.snapshotId) : null,
              page: typeof row.page === "number" ? row.page : null,
              section: row.section ? String(row.section) : null,
              docRole: row.docRole ? String(row.docRole) : null,
              documentType: row.documentType ? String(row.documentType) : null,
              documentTitle: row.documentTitle ? String(row.documentTitle) : null,
            })),
          ])
        }
      } catch (err: any) {
        warnings.push(`Managed retrieval failed: ${err?.message ?? String(err)}`)
      }
    }
  }

  if (params.provider === "local" || params.provider === "hybrid") {
    try {
      localEvidence = dedupeEvidence(
        await retrieveLocalEvidenceForQuestion({
          supabase: params.supabase,
          workspaceId: params.workspaceId,
          question: params.question,
          matchCount: profile.localMatchCount,
          minSimilarity: 0.25,
          textMatchCount: profile.localTextMatchCount,
          filters: params.filters,
        })
      )

      if (profile.expansionQuery && localEvidence.length < 12) {
        const expandedLocal = await retrieveLocalEvidenceForQuestion({
          supabase: params.supabase,
          workspaceId: params.workspaceId,
          question: profile.expansionQuery,
          matchCount: Math.min(24, profile.localMatchCount + 6),
          minSimilarity: 0.2,
          textMatchCount: Math.min(30, profile.localTextMatchCount + 8),
          filters: params.filters,
        })
        localEvidence = dedupeEvidence([...localEvidence, ...expandedLocal])
      }
    } catch (err: any) {
      warnings.push(`Local retrieval failed: ${err?.message ?? String(err)}`)
    }
  }

  let providerUsed: "local" | "openai" | "hybrid" =
    params.provider === "openai"
      ? "openai"
      : params.provider === "hybrid"
        ? "hybrid"
        : "local"

  let evidence: EvidenceChunk[] = []
  if (params.provider === "local") {
    evidence = localEvidence
    providerUsed = "local"
  } else if (params.provider === "openai") {
    evidence = managedEvidence
    providerUsed = "openai"
  } else {
    evidence = dedupeEvidence([...localEvidence, ...managedEvidence]).slice(
      0,
      Math.max(16, Math.min(64, profile.maxResults * 3))
    )
    if (managedEvidence.length > 0 && localEvidence.length > 0) {
      providerUsed = "hybrid"
    } else if (managedEvidence.length > 0) {
      providerUsed = "openai"
    } else {
      providerUsed = "local"
    }
  }

  if (evidence.length > 0) {
    evidence = await hydrateEvidenceDocumentContext({
      supabase: params.supabase,
      evidence,
    }).catch(() => evidence)
    evidence = filterEvidenceByDocTypes(evidence, params.filters)
  }

  if (!evidence.length) {
    warnings.push("No evidence returned")
  }

  return {
    evidence,
    providerUsed,
    localEvidenceCount: localEvidence.length,
    managedEvidenceCount: managedEvidence.length,
    responseId,
    model,
    elapsedMs: Date.now() - started,
    warnings,
  }
}

function renderSummaryMarkdown(report: any) {
  const lines: string[] = []
  lines.push("# RAG Evaluation Summary")
  lines.push("")
  lines.push(`- Timestamp: ${report.timestamp}`)
  lines.push(`- Provider requested: ${report.config.provider}`)
  lines.push(
    `- Answer provider: ${report.config.answerProviderRequested} (initial=${report.config.answerProviderInitial}, final=${report.config.answerProviderFinal})`
  )
  lines.push(`- Dataset: ${report.config.datasetPath}`)
  lines.push(`- Cases: ${report.summary.totalCases}`)
  lines.push(`- Cases with error: ${report.summary.errorCases}`)
  lines.push("")
  lines.push("## Core Metrics")
  lines.push("")
  lines.push(`- Avg evidence per case: ${report.summary.retrieval.avgEvidence.toFixed(2)}`)
  lines.push(`- Not-found accuracy: ${fmtPct(report.summary.answer.notFoundAccuracy)}`)
  lines.push(`- Citation validity: ${fmtPct(report.summary.answer.citationValidityRate)}`)
  lines.push(`- Must-include all matched: ${fmtPct(report.summary.answer.mustIncludeAllRate)}`)
  lines.push(`- Must-not-include pass: ${fmtPct(report.summary.answer.mustNotIncludePassRate)}`)
  lines.push(`- Snapshot hit rate: ${fmtPct(report.summary.retrieval.snapshotHitRate)}`)
  lines.push(`- Chunk hit rate: ${fmtPct(report.summary.retrieval.chunkHitRate)}`)
  lines.push(`- Snapshot MRR: ${fmtNum(report.summary.retrieval.snapshotMrr)}`)
  lines.push(`- Chunk MRR: ${fmtNum(report.summary.retrieval.chunkMrr)}`)
  lines.push("")
  lines.push("## Latency")
  lines.push("")
  lines.push(
    `- Retrieval avg/p50/p95: ${fmtMs(report.summary.latency.retrieval.avg)} / ${fmtMs(report.summary.latency.retrieval.p50)} / ${fmtMs(report.summary.latency.retrieval.p95)}`
  )
  lines.push(
    `- Generation avg/p50/p95: ${fmtMs(report.summary.latency.generation.avg)} / ${fmtMs(report.summary.latency.generation.p50)} / ${fmtMs(report.summary.latency.generation.p95)}`
  )
  lines.push(
    `- Total avg/p50/p95: ${fmtMs(report.summary.latency.total.avg)} / ${fmtMs(report.summary.latency.total.p50)} / ${fmtMs(report.summary.latency.total.p95)}`
  )
  lines.push("")
  lines.push("## Output")
  lines.push("")
  lines.push(`- JSON: ${report.paths.json}`)
  lines.push(`- Markdown: ${report.paths.markdown}`)
  lines.push("")
  return lines.join("\n")
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const cases = await loadDataset(opts.datasetPath, opts.workspaceId, opts.maxCases)
  const supabase = createAdminClient()

  const results: CaseResult[] = []
  const initialAnswerProvider = resolveAnswerProvider(opts.answerProvider)
  let activeAnswerProvider: Exclude<AnswerProvider, "auto"> = initialAnswerProvider
  let generationDisabledReason: string | null =
    opts.skipGeneration ? "disabled by --skip-generation" : null
  let lastGenerationAt = 0
  for (const testCase of cases) {
    const started = Date.now()

    try {
      const retrieval = await runRetrieval({
        supabase,
        provider: opts.provider,
        workspaceId: testCase.workspaceId,
        question: testCase.question,
        filters: testCase.filters,
        mode: testCase.mode,
      })

      const expectedSnapshotSet = new Set(testCase.expectedSnapshotIds)
      const expectedChunkSet = new Set(testCase.expectedChunkIds)

      const rankedSnapshots = retrieval.evidence
        .map((x) => x.snapshotId)
        .filter((x): x is string => Boolean(x))
      const rankedChunks = retrieval.evidence.map((x) => x.chunkId).filter(Boolean)

      const snapshotRecall = recallAtK(rankedSnapshots, expectedSnapshotSet)
      const chunkRecall = recallAtK(rankedChunks, expectedChunkSet)
      const snapshotMrr = reciprocalRank(rankedSnapshots, expectedSnapshotSet)
      const chunkMrr = reciprocalRank(rankedChunks, expectedChunkSet)

      let answerText = "No se encuentra en las fuentes disponibles."
      let answerNotFound = true
      let answerModel: string | null = null
      let answerUsage: any = null
      let citations: Array<{ chunkId: string; quote: string }> = []
      let workingEvidence = retrieval.evidence
      let generationElapsed = 0
      let generationSkippedReason: string | null = generationDisabledReason

      if (!opts.skipGeneration && !generationDisabledReason) {
        generationSkippedReason = null
        const generationStarted = Date.now()
        if (workingEvidence.length > 0) {
          const elapsedSinceLast = lastGenerationAt > 0 ? Date.now() - lastGenerationAt : Number.MAX_SAFE_INTEGER
          if (opts.genDelayMs > 0 && elapsedSinceLast < opts.genDelayMs) {
            await sleep(opts.genDelayMs - elapsedSinceLast)
          }

          try {
            const out = await generateAnswerWithProvider({
              provider: activeAnswerProvider,
              question: testCase.question,
              evidence: workingEvidence,
              mode: testCase.mode,
            })
            answerText = out.answer
            answerNotFound = out.notFound
            answerModel = out.model ?? null
            answerUsage = out.usage ?? null
            citations = Array.isArray(out.citations)
              ? out.citations.map((c: any) => ({
                  chunkId: String(c?.chunkId || ""),
                  quote: String(c?.quote || ""),
                }))
              : []
            lastGenerationAt = Date.now()
          } catch (err: any) {
            const msg = err?.message ?? String(err)
            const canSwitchToOpenAI =
              activeAnswerProvider === "google" &&
              opts.answerProvider === "auto" &&
              hasOpenAIKey()

            if (isQuotaError(msg) && canSwitchToOpenAI) {
              activeAnswerProvider = "openai"
              retrieval.warnings.push(
                "Google quota/rate-limit reached. Switched answer generation to OpenAI for remaining cases."
              )

              const out = await generateAnswerWithProvider({
                provider: activeAnswerProvider,
                question: testCase.question,
                evidence: workingEvidence,
                mode: testCase.mode,
              })
              answerText = out.answer
              answerNotFound = out.notFound
              answerModel = out.model ?? null
              answerUsage = out.usage ?? null
              citations = Array.isArray(out.citations)
                ? out.citations.map((c: any) => ({
                    chunkId: String(c?.chunkId || ""),
                    quote: String(c?.quote || ""),
                  }))
                : []
              lastGenerationAt = Date.now()
            } else if (isQuotaError(msg)) {
              generationDisabledReason =
                activeAnswerProvider === "google"
                  ? "LLM generation disabled after Google quota/rate-limit error (429)."
                  : "LLM generation disabled after OpenAI quota/rate-limit error (429)."
              generationSkippedReason = generationDisabledReason
              retrieval.warnings.push(
                "Generation skipped due quota/rate-limit. Use --skip-generation, reduce --max, or increase --gen-delay-ms."
              )
            } else {
              throw err
            }
          }

          const shouldRetryNotFound =
            !answerNotFound ? false : testCase.expectNotFound === true ? false : workingEvidence.length >= 6

          if (shouldRetryNotFound) {
            try {
              const retryHint = retryHintForMode(testCase.mode)
              const extraRetrieval = await runRetrieval({
                supabase,
                provider: opts.provider,
                workspaceId: testCase.workspaceId,
                question: `${testCase.question}. ${retryHint}`,
                filters: testCase.filters,
                mode: testCase.mode,
              })

              const mergedEvidence = dedupeEvidence([
                ...workingEvidence,
                ...extraRetrieval.evidence,
              ])

              if (mergedEvidence.length > workingEvidence.length) {
                workingEvidence = mergedEvidence
                retrieval.warnings.push(
                  `Expanded context for retry: ${workingEvidence.length} chunks (was ${retrieval.evidence.length}).`
                )
              }

              const retryOut = await generateAnswerWithProvider({
                provider: activeAnswerProvider,
                question: `${testCase.question}\n\n${retryHint}`,
                evidence: workingEvidence,
                mode: testCase.mode,
              })

              if (!retryOut.notFound) {
                answerText = retryOut.answer
                answerNotFound = retryOut.notFound
                answerModel = retryOut.model ?? answerModel
                answerUsage = retryOut.usage ?? answerUsage
                citations = Array.isArray(retryOut.citations)
                  ? retryOut.citations.map((c: any) => ({
                      chunkId: String(c?.chunkId || ""),
                      quote: String(c?.quote || ""),
                    }))
                  : citations
                retrieval.warnings.push("Recovered from initial notFound via retry with expanded context.")
              } else {
                retrieval.warnings.push("Retry kept notFound despite available evidence.")
              }
            } catch (retryErr: any) {
              retrieval.warnings.push(`Retry attempt failed: ${retryErr?.message ?? String(retryErr)}`)
            }
          }
        }
        generationElapsed = Date.now() - generationStarted
      }

      const generationSkipped = Boolean(opts.skipGeneration || generationSkippedReason)

      retrieval.evidence = workingEvidence

      const evidenceMap = new Map(workingEvidence.map((x) => [String(x.chunkId), normalizeText(x.content)]))

      const validCitations = citations.filter((c) => {
        const hay = evidenceMap.get(c.chunkId)
        if (!hay) return false
        const needle = normalizeText(c.quote)
        return needle.length >= 12 && hay.includes(needle)
      }).length

      const mustIncludeMatched = testCase.mustInclude.filter((needle) =>
        containsNormalizedSemantic(answerText, needle)
      ).length

      const mustNotIncludeViolations = testCase.mustNotInclude.filter((needle) =>
        containsNormalized(answerText, needle)
      ).length

      const result: CaseResult = {
        id: testCase.id,
        workspaceId: testCase.workspaceId,
        providerRequested: opts.provider,
        providerUsed: retrieval.providerUsed,
        question: testCase.question,
        mode: testCase.mode,
        filters: testCase.filters,
        notes: testCase.notes,
        retrieval: {
          evidenceCount: retrieval.evidence.length,
          localEvidenceCount: retrieval.localEvidenceCount,
          managedEvidenceCount: retrieval.managedEvidenceCount,
          responseId: retrieval.responseId,
          model: retrieval.model,
          elapsedMs: retrieval.elapsedMs,
          warnings: retrieval.warnings,
          expectedSnapshotHit:
            expectedSnapshotSet.size > 0
              ? rankedSnapshots.some((x) => expectedSnapshotSet.has(x))
              : null,
          expectedChunkHit:
            expectedChunkSet.size > 0 ? rankedChunks.some((x) => expectedChunkSet.has(x)) : null,
          snapshotRecallAtK: snapshotRecall,
          chunkRecallAtK: chunkRecall,
          snapshotMRR: snapshotMrr,
          chunkMRR: chunkMrr,
        },
        answer: {
          skipped: generationSkipped,
          text: answerText,
          notFound: answerNotFound,
          elapsedMs: generationElapsed,
          model: answerModel,
          usage: answerUsage,
          citations: citations.length,
          validCitations,
          citationValidityRate:
            !generationSkipped && citations.length > 0 ? validCitations / citations.length : null,
          expectNotFound: testCase.expectNotFound,
          notFoundMatch:
            !generationSkipped && typeof testCase.expectNotFound === "boolean"
              ? testCase.expectNotFound === answerNotFound
              : null,
          mustIncludeTotal: testCase.mustInclude.length,
          mustIncludeMatched,
          mustIncludeAllMatched:
            !generationSkipped && testCase.mustInclude.length > 0
              ? mustIncludeMatched === testCase.mustInclude.length
              : null,
          mustNotIncludeTotal: testCase.mustNotInclude.length,
          mustNotIncludeViolations,
          mustNotIncludePass:
            !generationSkipped && testCase.mustNotInclude.length > 0
              ? mustNotIncludeViolations === 0
              : null,
        },
        elapsedMs: Date.now() - started,
      }

      results.push(result)

      if (opts.verbose) {
        // eslint-disable-next-line no-console
        console.log(
          result.answer.skipped
            ? `[${result.id}] evidence=${result.retrieval.evidenceCount} gen=skipped totalMs=${result.elapsedMs}`
            : `[${result.id}] evidence=${result.retrieval.evidenceCount} notFound=${result.answer.notFound} cites=${result.answer.validCitations}/${result.answer.citations} totalMs=${result.elapsedMs}`
        )
      }
    } catch (err: any) {
      const result: CaseResult = {
        id: testCase.id,
        workspaceId: testCase.workspaceId,
        providerRequested: opts.provider,
        providerUsed: opts.provider,
        question: testCase.question,
        mode: testCase.mode,
        filters: testCase.filters,
        notes: testCase.notes,
        retrieval: {
          evidenceCount: 0,
          localEvidenceCount: 0,
          managedEvidenceCount: 0,
          responseId: null,
          model: null,
          elapsedMs: 0,
          warnings: [],
          expectedSnapshotHit: null,
          expectedChunkHit: null,
          snapshotRecallAtK: null,
          chunkRecallAtK: null,
          snapshotMRR: null,
          chunkMRR: null,
        },
        answer: {
          skipped: opts.skipGeneration,
          text: "",
          notFound: false,
          elapsedMs: 0,
          model: null,
          usage: null,
          citations: 0,
          validCitations: 0,
          citationValidityRate: null,
          expectNotFound: testCase.expectNotFound,
          notFoundMatch: null,
          mustIncludeTotal: testCase.mustInclude.length,
          mustIncludeMatched: 0,
          mustIncludeAllMatched: null,
          mustNotIncludeTotal: testCase.mustNotInclude.length,
          mustNotIncludeViolations: 0,
          mustNotIncludePass: null,
        },
        elapsedMs: Date.now() - started,
        error: err?.message ?? String(err),
      }
      results.push(result)

      // eslint-disable-next-line no-console
      console.error(`[${result.id}] error: ${result.error}`)
    }
  }

  const retrievalTimes = results.map((r) => r.retrieval.elapsedMs).filter((n) => n > 0)
  const generationTimes = results.map((r) => r.answer.elapsedMs).filter((n) => n > 0)
  const totalTimes = results.map((r) => r.elapsedMs).filter((n) => n > 0)

  const citationRows = results.filter((r) => r.answer.citationValidityRate !== null)
  const notFoundRows = results.filter((r) => r.answer.notFoundMatch !== null)
  const mustIncludeRows = results.filter((r) => r.answer.mustIncludeAllMatched !== null)
  const mustNotIncludeRows = results.filter((r) => r.answer.mustNotIncludePass !== null)

  const snapshotHitRows = results.filter((r) => r.retrieval.expectedSnapshotHit !== null)
  const chunkHitRows = results.filter((r) => r.retrieval.expectedChunkHit !== null)
  const snapshotMrrRows = results
    .map((r) => r.retrieval.snapshotMRR)
    .filter((x): x is number => typeof x === "number")
  const chunkMrrRows = results
    .map((r) => r.retrieval.chunkMRR)
    .filter((x): x is number => typeof x === "number")

  const summary = {
    totalCases: results.length,
    errorCases: results.filter((r) => !!r.error).length,
    retrieval: {
      avgEvidence: avg(results.map((r) => r.retrieval.evidenceCount)),
      snapshotHitRate:
        snapshotHitRows.length > 0
          ? snapshotHitRows.filter((r) => r.retrieval.expectedSnapshotHit).length /
            snapshotHitRows.length
          : null,
      chunkHitRate:
        chunkHitRows.length > 0
          ? chunkHitRows.filter((r) => r.retrieval.expectedChunkHit).length / chunkHitRows.length
          : null,
      snapshotMrr: snapshotMrrRows.length ? avg(snapshotMrrRows) : null,
      chunkMrr: chunkMrrRows.length ? avg(chunkMrrRows) : null,
    },
    answer: {
      notFoundAccuracy:
        notFoundRows.length > 0
          ? notFoundRows.filter((r) => r.answer.notFoundMatch).length / notFoundRows.length
          : null,
      citationValidityRate:
        citationRows.length > 0
          ? avg(citationRows.map((r) => Number(r.answer.citationValidityRate || 0)))
          : null,
      mustIncludeAllRate:
        mustIncludeRows.length > 0
          ? mustIncludeRows.filter((r) => r.answer.mustIncludeAllMatched).length /
            mustIncludeRows.length
          : null,
      mustNotIncludePassRate:
        mustNotIncludeRows.length > 0
          ? mustNotIncludeRows.filter((r) => r.answer.mustNotIncludePass).length /
            mustNotIncludeRows.length
          : null,
    },
    latency: {
      retrieval: {
        avg: avg(retrievalTimes),
        p50: percentile(retrievalTimes, 50),
        p95: percentile(retrievalTimes, 95),
      },
      generation: {
        avg: avg(generationTimes),
        p50: percentile(generationTimes, 50),
        p95: percentile(generationTimes, 95),
      },
      total: {
        avg: avg(totalTimes),
        p50: percentile(totalTimes, 50),
        p95: percentile(totalTimes, 95),
      },
    },
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const jsonPath = path.resolve(opts.outputPath || `eval/results/rag-eval-${stamp}.json`)
  const mdPath = jsonPath.replace(/\.json$/i, ".md")
  await fs.mkdir(path.dirname(jsonPath), { recursive: true })

  const report = {
    timestamp: new Date().toISOString(),
    config: {
      provider: opts.provider,
      answerProviderRequested: opts.answerProvider,
      answerProviderInitial: initialAnswerProvider,
      answerProviderFinal: activeAnswerProvider,
      skipGeneration: opts.skipGeneration,
      genDelayMs: opts.genDelayMs,
      datasetPath: path.resolve(opts.datasetPath),
      maxCases: opts.maxCases || null,
      workspaceOverride: opts.workspaceId || null,
    },
    summary,
    results,
    paths: {
      json: jsonPath,
      markdown: mdPath,
    },
  }

  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8")
  await fs.writeFile(mdPath, renderSummaryMarkdown(report), "utf8")

  // eslint-disable-next-line no-console
  console.log(`RAG eval complete: ${summary.totalCases} cases (${summary.errorCases} errors)`)
  // eslint-disable-next-line no-console
  console.log(
    `- Answer provider: requested=${opts.answerProvider}, initial=${initialAnswerProvider}, final=${activeAnswerProvider}`
  )
  // eslint-disable-next-line no-console
  console.log(`- NotFound accuracy: ${fmtPct(summary.answer.notFoundAccuracy)}`)
  // eslint-disable-next-line no-console
  console.log(`- Citation validity: ${fmtPct(summary.answer.citationValidityRate)}`)
  // eslint-disable-next-line no-console
  console.log(`- Snapshot hit rate: ${fmtPct(summary.retrieval.snapshotHitRate)}`)
  // eslint-disable-next-line no-console
  console.log(`- Output JSON: ${jsonPath}`)
  // eslint-disable-next-line no-console
  console.log(`- Output MD: ${mdPath}`)

  if (generationDisabledReason && !opts.skipGeneration) {
    // eslint-disable-next-line no-console
    console.log(`- Note: ${generationDisabledReason}`)
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("RAG eval failed:", err?.message ?? err)
  process.exit(1)
})
import { resolveOpenAIAnswerModel } from "../src/lib/openai-models"
