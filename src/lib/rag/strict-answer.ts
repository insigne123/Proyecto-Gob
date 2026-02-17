import { z } from "genkit"

import { ai } from "@/ai/genkit"
import { resolveRagAnswerProvider } from "@/lib/env"
import { generateOpenAIJson } from "@/lib/llm/openai-json"

export type EvidenceChunk = {
  chunkId: string
  content: string
  sourceUrl: string | null
  snapshotId: string | null
  page: number | null
  section: string | null
}

export type AnswerMode = "extractive" | "comparison" | "checklist" | "resolution"
export type AnswerResponseProfile = "auto" | "fast" | "balanced" | "deep"
export type QuestionDifficulty = "simple" | "medium" | "complex"

type VerifiedCitation = {
  chunkId: string
  quote: string
}

type VerifiedParagraph = {
  text: string
  citations: VerifiedCitation[]
  notFound: boolean
  paragraph: number
}

type AnswerBudget = {
  maxEvidence: number
  maxChunkChars: number
  maxParagraphs: number
  maxCompletionTokens: number
  reasoningEffort: "minimal" | "medium"
  modelCandidates: string[]
}

const ParagraphSchema = z.object({
  text: z.string(),
  citations: z
    .array(
      z.object({
        chunkId: z.string(),
        quote: z.string(),
      })
    )
    .default([]),
  notFound: z.boolean().default(false),
})

const AnswerSchema = z.object({
  paragraphs: z.array(ParagraphSchema).default([]),
  notFound: z.boolean().default(false),
  suggestions: z.array(z.string()).default([]),
})

const AnswerJsonSchema = {
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
} as const

function normalize(s: string) {
  return s
    .replace(/\s+/g, " ")
    .replace(/\u00A0/g, " ")
    .trim()
    .toLowerCase()
}

function modeBudget(mode: AnswerMode) {
  if (mode === "checklist") {
    return { maxEvidence: 10, maxChunkChars: 1100, maxParagraphs: 8, maxCompletionTokens: 1200 }
  }
  if (mode === "comparison") {
    return { maxEvidence: 8, maxChunkChars: 1000, maxParagraphs: 4, maxCompletionTokens: 900 }
  }
  if (mode === "resolution") {
    return { maxEvidence: 7, maxChunkChars: 950, maxParagraphs: 4, maxCompletionTokens: 850 }
  }
  return { maxEvidence: 6, maxChunkChars: 900, maxParagraphs: 3, maxCompletionTokens: 700 }
}

function defaultAnswerModel() {
  return String(process.env.OPENAI_ANSWER_MODEL || process.env.OPENAI_RAG_MODEL || "gpt-5-nano").trim()
}

function uniqueNonEmpty(values: string[]) {
  const set = new Set<string>()
  for (const value of values) {
    const clean = String(value || "").trim()
    if (!clean) continue
    set.add(clean)
  }
  return Array.from(set)
}

function isModelAvailabilityError(message: string) {
  const m = String(message || "").toLowerCase()
  return (
    m.includes("model") &&
    (m.includes("not found") ||
      m.includes("does not exist") ||
      m.includes("not available") ||
      m.includes("access") ||
      m.includes("permission"))
  )
}

function isInvalidStructuredOutputError(message: string) {
  const m = String(message || "").toLowerCase()
  return (
    m.includes("valid json output") ||
    m.includes("invalid json") ||
    m.includes("json output") ||
    m.includes("response_format")
  )
}

function isTransientOpenAIError(message: string) {
  const m = String(message || "").toLowerCase()
  return (
    m.includes("timeout") ||
    m.includes("timed out") ||
    m.includes("rate limit") ||
    m.includes("too many requests") ||
    m.includes("server error") ||
    m.includes("bad gateway") ||
    m.includes("service unavailable")
  )
}

function resolveResponseProfile(
  profile: AnswerResponseProfile,
  difficulty: QuestionDifficulty
): Exclude<AnswerResponseProfile, "auto"> {
  if (profile === "fast" || profile === "balanced" || profile === "deep") {
    return profile
  }
  if (difficulty === "simple") return "fast"
  if (difficulty === "complex") return "deep"
  return "balanced"
}

function applyResponseProfile(
  base: ReturnType<typeof modeBudget>,
  profile: Exclude<AnswerResponseProfile, "auto">
): AnswerBudget {
  const baseModel = defaultAnswerModel()

  if (profile === "fast") {
    return {
      maxEvidence: Math.max(4, Math.min(base.maxEvidence, base.maxEvidence - 2)),
      maxChunkChars: Math.max(650, Math.floor(base.maxChunkChars * 0.78)),
      maxParagraphs: Math.max(2, Math.min(base.maxParagraphs, 3)),
      maxCompletionTokens: Math.max(420, Math.floor(base.maxCompletionTokens * 0.68)),
      reasoningEffort: "minimal",
      modelCandidates: uniqueNonEmpty([baseModel, "gpt-5-nano", "gpt-4o-mini"]),
    }
  }

  if (profile === "deep") {
    return {
      maxEvidence: Math.min(18, base.maxEvidence + 4),
      maxChunkChars: Math.min(1800, Math.floor(base.maxChunkChars * 1.2)),
      maxParagraphs: Math.min(10, base.maxParagraphs + 2),
      maxCompletionTokens: Math.min(2200, Math.floor(base.maxCompletionTokens * 1.45)),
      reasoningEffort: "medium",
      modelCandidates: uniqueNonEmpty(["gpt-5", "gpt-5-mini", baseModel, "gpt-4o-mini"]),
    }
  }

  return {
    ...base,
    reasoningEffort: "minimal",
    modelCandidates: uniqueNonEmpty(["gpt-5-mini", baseModel, "gpt-5-nano", "gpt-4o-mini"]),
  }
}

export async function generateStrictAnswer(params: {
  question: string
  evidence: EvidenceChunk[]
  mode?: AnswerMode
  responseProfile?: AnswerResponseProfile
  difficulty?: QuestionDifficulty
}) {
  const {
    question,
    evidence,
    mode = "extractive",
    responseProfile = "auto",
    difficulty = "medium",
  } = params

  const resolvedProfile = resolveResponseProfile(responseProfile, difficulty)
  const budget = applyResponseProfile(modeBudget(mode), resolvedProfile)

  const evidenceBlock = evidence
    .slice(0, budget.maxEvidence)
    .map((c, idx) => {
      const locParts = [
        c.sourceUrl ? `url=${c.sourceUrl}` : null,
        c.snapshotId ? `snapshot=${c.snapshotId}` : null,
        typeof c.page === "number" ? `page=${c.page}` : null,
        c.section ? `section=${c.section}` : null,
      ].filter(Boolean)
      const loc = locParts.length ? ` (${locParts.join(", ")})` : ""

      const content =
        c.content.length > budget.maxChunkChars
          ? `${c.content.slice(0, budget.maxChunkChars)}...`
          : c.content
      return `EVIDENCE ${idx + 1}: chunkId=${c.chunkId}${loc}\n${content}`
    })
    .join("\n\n---\n\n")

  const system =
    "Eres un asistente documental para el Tribunal Ambiental de Chile. Regla critica: NO inventes. Responde SOLO usando el bloque EVIDENCE entregado. No uses conocimiento externo. Si no hay evidencia suficiente para responder con certeza, responde con notFound=true y la frase exacta: 'No se encuentra en las fuentes disponibles.'"

  const modeGuide =
    mode === "checklist"
      ? "- Modo Checklist: cada parrafo debe ser un item (comienza con '- [ ]' o '-').\n"
      : mode === "comparison"
        ? "- Modo Comparacion: compara versiones/snapshots SOLO si la evidencia lo permite. Menciona snapshot_id cuando corresponda.\n"
        : mode === "resolution"
          ? "- Modo Resolucion: redaccion formal, sin inferir, sin completar vacios.\n"
          : "- Modo Extractivo: sintesis minima, directa y verificable.\n"

  const prompt =
    `Modo: ${mode}\n\n` +
    `Pregunta del usuario:\n${question}\n\n` +
    `Bloque EVIDENCE (unico material permitido):\n\n${evidenceBlock}\n\n` +
    "Instrucciones:\n" +
    modeGuide +
    `- Responde en 1 a ${budget.maxParagraphs} parrafos (paragraphs).\n` +
    "- Cada parrafo debe tener al menos 1 cita verificable.\n" +
    "- En citations, incluye quotes copiadas literalmente desde el chunk citado.\n" +
    "- En citations, solo puedes usar chunkId presentes en EVIDENCE.\n" +
    "- Si no puedes citar, debes marcar notFound=true y usar exactamente: 'No se encuentra en las fuentes disponibles.'\n"

  const answerProvider = resolveRagAnswerProvider()
  let out: any = null
  let model: string | null = null
  let usage: any = null

  if (answerProvider === "openai") {
    let lastErr: unknown = null
    for (let i = 0; i < budget.modelCandidates.length; i++) {
      const candidate = budget.modelCandidates[i]
      try {
        const openai = await generateOpenAIJson({
          system,
          prompt,
          schemaName: "strict_answer",
          schema: AnswerJsonSchema,
          maxCompletionTokens: budget.maxCompletionTokens,
          reasoningEffort: budget.reasoningEffort,
          model: candidate,
        })
        out = openai.output
        model = openai.model
        usage = openai.usage
        lastErr = null
        break
      } catch (err: any) {
        lastErr = err
        const msg = err?.message ?? String(err)
        const retryable =
          isModelAvailabilityError(msg) ||
          isInvalidStructuredOutputError(msg) ||
          isTransientOpenAIError(msg)
        const isLast = i === budget.modelCandidates.length - 1
        if (!retryable) {
          throw err
        }

        if (isLast) {
          // Graceful fallback to strict "not found" answer below.
          out = null
          model = null
          usage = null
          break
        }
      }
    }
  } else {
    const resp = await ai.generate({
      system,
      prompt,
      output: { schema: AnswerSchema, format: "json", constrained: true },
      config: {
        temperature: 0.1,
        topP: 0.9,
      },
    })
    out = resp.output
    model = resp.model ?? null
    usage = resp.usage
  }

  if (!out) {
    return {
      answer: "No se encuentra en las fuentes disponibles.",
      paragraphs: [
        {
          text: "No se encuentra en las fuentes disponibles.",
          citations: [],
          notFound: true,
        },
      ],
      citations: [],
      notFound: true,
      suggestions: ["Agrega una fuente (URL/PDF) que contenga la informacion requerida."],
      model,
      usage,
    }
  }

  const allowed = new Map(evidence.map((c) => [c.chunkId, c]))

  const rawParagraphs = Array.isArray((out as any).paragraphs)
    ? ((out as any).paragraphs as any[])
    : []

  const verifiedParagraphs: VerifiedParagraph[] = rawParagraphs
    .slice(0, budget.maxParagraphs)
    .map((p, idx) => {
      const rawText = String(p?.text ?? "").trim()
      const rawNotFound = Boolean(p?.notFound)
      const rawCitations = Array.isArray(p?.citations) ? p.citations : []

      const citations: VerifiedCitation[] = rawCitations
        .map((c: any) => ({ chunkId: String(c.chunkId), quote: String(c.quote) }))
        .filter((c: any) => allowed.has(c.chunkId))
        .filter((c: any) => {
          const chunk = allowed.get(c.chunkId)!
          const hay = normalize(chunk.content)
          const needle = normalize(c.quote)
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

  const supported = verifiedParagraphs.filter((p) => !p.notFound)

  const flat = supported.flatMap((p, paragraph) =>
    p.citations.map((c: VerifiedCitation) => ({ ...c, paragraph }))
  )

  const notFound = Boolean(out.notFound) || flat.length === 0
  const answer = notFound
    ? "No se encuentra en las fuentes disponibles."
    : supported.map((p) => p.text).join("\n\n")

  return {
    answer,
    paragraphs: supported.map((p) => ({
      text: p.text,
      citations: p.citations,
      notFound: p.notFound,
    })),
    citations: flat,
    notFound,
    suggestions: Array.isArray((out as any).suggestions) ? (out as any).suggestions.map(String) : [],
    model,
    usage,
  }
}
