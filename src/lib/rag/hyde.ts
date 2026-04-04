import type { RagQueryIntent } from "@/lib/rag/query-intent"
import type { AnswerMode, QuestionDifficulty } from "@/lib/rag/strict-answer"

import { generateOpenAIJson } from "@/lib/llm/openai-json"
import type { ResolvedResponseProfile } from "@/lib/rag/router"

type HyDEResult = {
  applied: boolean
  model: string | null
  hypotheticalDocument: string | null
  queries: string[]
}

function boolEnv(name: string, fallback: boolean) {
  const raw = String(process.env[name] || "")
    .trim()
    .toLowerCase()
  if (!raw) return fallback
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false
  return fallback
}

function numberEnv(name: string, fallback: number, min: number, max: number) {
  const raw = Number(process.env[name] || fallback)
  if (!Number.isFinite(raw)) return fallback
  return Math.max(min, Math.min(max, Math.floor(raw)))
}

function normalize(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function shorten(text: string, maxChars: number) {
  const clean = String(text || "").replace(/\s+/g, " ").trim()
  if (!clean) return ""
  if (clean.length <= maxChars) return clean
  return `${clean.slice(0, maxChars).trim()}...`
}

function uniqueStrings(values: string[], max: number) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = String(value || "").replace(/\s+/g, " ").trim()
    if (!clean) continue
    const key = normalize(clean)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(clean)
    if (out.length >= max) break
  }
  return out
}

export async function buildHyDEExpansion(params: {
  question: string
  mode: AnswerMode
  difficulty: QuestionDifficulty
  responseProfile: ResolvedResponseProfile
  intent: RagQueryIntent
  allowHyDE: boolean
}): Promise<HyDEResult> {
  const enabled = boolEnv("RAG_ENABLE_HYDE", true)
  if (!enabled || !params.allowHyDE) {
    return { applied: false, model: null, hypotheticalDocument: null, queries: [] }
  }

  if (params.responseProfile === "fast" || params.difficulty === "simple") {
    return { applied: false, model: null, hypotheticalDocument: null, queries: [] }
  }

  try {
    const generated = await generateOpenAIJson({
      system:
        "Eres un asistente juridico experto en derecho ambiental chileno. Genera un mini documento hipotetico para retrieval. No inventes hechos especificos del caso; usa solo vocabulario tecnico, tipos de argumentos, resultados y conceptos probables del dominio.",
      prompt:
        `Pregunta: ${params.question}\n` +
        `Modo: ${params.mode}\n` +
        `Dificultad: ${params.difficulty}\n` +
        `Roles preferidos: ${params.intent.preferredDocRoles.join(", ") || "sin preferencia"}\n\n` +
        "Devuelve un documento hipotetico corto y 1-2 queries semanticas que ayuden a recuperar mejor evidencia relevante.",
      schemaName: "rag_hyde_query_pack",
      schema: {
        type: "object",
        properties: {
          hypotheticalDocument: { type: "string" },
          searchQueries: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["hypotheticalDocument", "searchQueries"],
        additionalProperties: false,
      },
      maxCompletionTokens: 520,
      reasoningEffort: "minimal",
      model: String(
        process.env.OPENAI_HYDE_MODEL ||
          process.env.OPENAI_FAST_MODEL ||
          process.env.OPENAI_ANSWER_MODEL ||
          "gpt-5-nano"
      ),
    })

    const hypotheticalDocument = shorten(
      String((generated.output as any)?.hypotheticalDocument || ""),
      620
    )
    const searchQueriesRaw = Array.isArray((generated.output as any)?.searchQueries)
      ? ((generated.output as any).searchQueries as unknown[]).map((item) => String(item || ""))
      : []

    const maxQueries = numberEnv("RAG_HYDE_MAX_QUERIES", 2, 1, 4)
    const queries = uniqueStrings(
      [hypotheticalDocument, ...searchQueriesRaw.map((item) => shorten(item, 220))],
      Math.max(1, maxQueries + 1)
    )

    if (!queries.length) {
      return { applied: false, model: generated.model, hypotheticalDocument, queries: [] }
    }

    return {
      applied: true,
      model: generated.model,
      hypotheticalDocument: hypotheticalDocument || null,
      queries,
    }
  } catch {
    return { applied: false, model: null, hypotheticalDocument: null, queries: [] }
  }
}
