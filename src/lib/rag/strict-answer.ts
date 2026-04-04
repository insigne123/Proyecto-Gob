import { z } from "genkit"

import { ai } from "@/ai/genkit"
import { resolveRagAnswerProvider } from "@/lib/env"
import { generateOpenAIJson } from "@/lib/llm/openai-json"
import {
  resolveOpenAIAnswerModel,
  resolveOpenAIBalancedModel,
  resolveOpenAIDeepModel,
  resolveOpenAIFastModel,
} from "@/lib/openai-models"

export type EvidenceChunk = {
  chunkId: string
  content: string
  sourceUrl: string | null
  snapshotId: string | null
  page: number | null
  section: string | null
  docRole?: string | null
  documentType?: string | null
  documentTitle?: string | null
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

type GroundedParagraph = {
  text: string
  citations: VerifiedCitation[]
  notFound: boolean
  paragraph: number
}

type AnswerSupportStrength = "none" | "weak" | "partial" | "strong"

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

const GroundingReviewJsonSchema = {
  type: "object",
  properties: {
    paragraphs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          paragraph: { type: "integer" },
          grounded: { type: "boolean" },
          revisedText: { type: "string" },
        },
        required: ["paragraph", "grounded", "revisedText"],
        additionalProperties: false,
      },
    },
  },
  required: ["paragraphs"],
  additionalProperties: false,
} as const

const ReflectionReviewJsonSchema = {
  type: "object",
  properties: {
    relevant: { type: "boolean" },
    complete: { type: "boolean" },
    coherent: { type: "boolean" },
    issues: { type: "array", items: { type: "string" } },
    revisedParagraphs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          paragraph: { type: "integer" },
          text: { type: "string" },
        },
        required: ["paragraph", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["relevant", "complete", "coherent", "issues", "revisedParagraphs"],
  additionalProperties: false,
} as const

function normalize(s: string) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function fallbackChunkQuote(content: string, max = 220) {
  const clean = String(content || "").replace(/\s+/g, " ").trim()
  if (!clean) return ""
  const first = clean.split(/(?<=[\.!?;])\s+/).find((s) => s.trim().length >= 16)
  const chosen = first || clean
  return chosen.length > max ? `${chosen.slice(0, max)}...` : chosen
}

const EVIDENCE_SUMMARY_STOP_WORDS = new Set([
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "en",
  "por",
  "para",
  "con",
  "que",
  "como",
  "sobre",
  "segun",
  "respecto",
  "cual",
  "cuales",
  "quien",
  "quienes",
  "y",
  "o",
  "a",
  "un",
  "una",
  "al",
])

function summaryTokensFromQuestion(question: string) {
  return normalize(question)
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x.length >= 3)
    .filter((x) => !EVIDENCE_SUMMARY_STOP_WORDS.has(x))
    .slice(0, 30)
}

function splitSentencesForSummary(text: string) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[\.!?;])\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 20)
}

function summarizeEvidencePassage(question: string, content: string, maxChars: number) {
  const clean = String(content || "").replace(/\s+/g, " ").trim()
  if (!clean) return ""
  if (clean.length <= maxChars) return clean

  const tokens = summaryTokensFromQuestion(question)
  const sentences = splitSentencesForSummary(clean)
  if (!sentences.length) return clean.slice(0, maxChars)

  const ranked = sentences
    .map((sentence, idx) => {
      const normalizedSentence = normalize(sentence)
      let overlap = 0
      for (const token of tokens) {
        if (!token) continue
        if (normalizedSentence.includes(token)) overlap += 1
      }
      const hasNumber = /\d/.test(sentence) ? 1 : 0
      return {
        sentence,
        idx,
        score: overlap * 1.2 + hasNumber * 0.35,
      }
    })
    .sort((a, b) => b.score - a.score || a.idx - b.idx)

  const picked = ranked.slice(0, Math.min(4, Math.max(2, Math.floor(maxChars / 220))))
  const selectedByIndex = picked.sort((a, b) => a.idx - b.idx)

  const summary = selectedByIndex.map((row) => row.sentence).join(" ").trim()
  if (!summary) return clean.slice(0, maxChars)
  if (summary.length <= maxChars) return summary

  return summary.slice(0, maxChars)
}

const GROUNDING_STOP_WORDS = new Set([
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "en",
  "por",
  "para",
  "con",
  "que",
  "como",
  "sobre",
  "segun",
  "respecto",
  "cual",
  "cuales",
  "quien",
  "quienes",
  "y",
  "o",
  "a",
  "un",
  "una",
  "al",
  "se",
])

function groundingEnabled() {
  const raw = String(process.env.RAG_ENABLE_FACT_VERIFIER || "")
    .trim()
    .toLowerCase()
  if (!raw) return true
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false
  return true
}

function reflectionEnabled(profile: Exclude<AnswerResponseProfile, "auto">) {
  if (profile === "fast") return false
  const raw = String(process.env.RAG_ENABLE_SELF_REFLECTION || "")
    .trim()
    .toLowerCase()
  if (!raw) return true
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false
  return true
}

function supportPolicy(mode: AnswerMode) {
  if (mode === "resolution") {
    return {
      suspectRatioDefault: 0.24,
      minRatioDefault: 0.2,
      weakParagraphRatio: 0.5,
      strongParagraphRatio: 0.84,
      minUniqueChunksStrong: 2,
      strongFallbackParagraphRatio: 0.5,
      strongFallbackUniqueChunks: 3,
    }
  }
  if (mode === "comparison") {
    return {
      suspectRatioDefault: 0.22,
      minRatioDefault: 0.18,
      weakParagraphRatio: 0.5,
      strongParagraphRatio: 0.8,
      minUniqueChunksStrong: 2,
      strongFallbackParagraphRatio: 0.5,
      strongFallbackUniqueChunks: 3,
    }
  }
  if (mode === "checklist") {
    return {
      suspectRatioDefault: 0.2,
      minRatioDefault: 0.16,
      weakParagraphRatio: 0.46,
      strongParagraphRatio: 0.76,
      minUniqueChunksStrong: 2,
      strongFallbackParagraphRatio: 0.5,
      strongFallbackUniqueChunks: 3,
    }
  }
  return {
    suspectRatioDefault: 0.22,
    minRatioDefault: 0.18,
    weakParagraphRatio: 0.5,
    strongParagraphRatio: 0.82,
    minUniqueChunksStrong: 2,
    strongFallbackParagraphRatio: 0.66,
    strongFallbackUniqueChunks: 3,
  }
}

function inferSupportStrength(params: {
  mode: AnswerMode
  candidateParagraphs: number
  supportedParagraphs: number
  uniqueChunks: number
}) {
  const policy = supportPolicy(params.mode)
  if (params.supportedParagraphs <= 0 || params.uniqueChunks <= 0) {
    return {
      strength: "none" as AnswerSupportStrength,
      paragraphRatio: 0,
      reason: "No quedo ningun parrafo completamente sustentado por la evidencia citada.",
    }
  }

  const paragraphRatio = params.supportedParagraphs / Math.max(1, params.candidateParagraphs)

  if (
    paragraphRatio >= policy.strongParagraphRatio &&
    params.uniqueChunks >= policy.minUniqueChunksStrong
  ) {
    return {
      strength: "strong" as AnswerSupportStrength,
      paragraphRatio,
      reason: "La respuesta conserva suficiente cobertura y diversidad de evidencia para responder con confianza alta.",
    }
  }

  if (
    paragraphRatio >= policy.strongFallbackParagraphRatio &&
    params.uniqueChunks >= policy.strongFallbackUniqueChunks
  ) {
    return {
      strength: "strong" as AnswerSupportStrength,
      paragraphRatio,
      reason: "La respuesta conserva suficiente diversidad de evidencia y una cobertura util para responder con confianza alta.",
    }
  }

  if (paragraphRatio >= policy.weakParagraphRatio && params.uniqueChunks >= 1) {
    return {
      strength: "partial" as AnswerSupportStrength,
      paragraphRatio,
      reason: "La respuesta quedo sustentada, pero con cobertura parcial del material disponible.",
    }
  }

  return {
    strength: "weak" as AnswerSupportStrength,
    paragraphRatio,
    reason: "La evidencia disponible solo respalda una parte limitada de la respuesta final.",
  }
}

function numberEnv(name: string, fallback: number, min: number, max: number) {
  const raw = String(process.env[name] || "").trim()
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function groundingTokens(text: string) {
  return normalize(text)
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x.length >= 4)
    .filter((x) => !GROUNDING_STOP_WORDS.has(x))
    .slice(0, 26)
}

function lexicalGroundingRatio(text: string, supportText: string) {
  const tokens = groundingTokens(text)
  if (!tokens.length) return 0

  const hay = normalize(supportText)
  if (!hay) return 0

  let hits = 0
  for (const token of tokens) {
    if (!token) continue
    if (hay.includes(token)) hits += 1
  }

  return hits / tokens.length
}

function citationsSupportText(citations: VerifiedCitation[], allowed: Map<string, EvidenceChunk>) {
  return citations
    .map((citation) => {
      const chunk = allowed.get(citation.chunkId)
      if (!chunk) return ""
      return String(chunk.content || "")
    })
    .filter(Boolean)
    .join("\n\n")
}

function extractQuestionRoleToken(question: string) {
  const match = String(question || "").match(/\bR-\d{1,5}-\d{4}\b/i)
  return match ? String(match[0]).toUpperCase() : ""
}

function evidenceMatchesRoleToken(chunk: EvidenceChunk, roleToken: string) {
  const needle = normalize(roleToken)
  if (!needle) return true
  const hay = normalize(
    [chunk.content, chunk.section, chunk.documentTitle, chunk.documentType]
      .filter(Boolean)
      .join(" ")
  )
  return hay.includes(needle)
}

function collectFojasFromEvidence(params: {
  question: string
  evidence: EvidenceChunk[]
}) {
  const roleToken = extractQuestionRoleToken(params.question)
  const normalizedQuestion = normalize(params.question)
  const needsDesistimiento = normalizedQuestion.includes("desistim")

  const seenNumbers = new Set<string>()
  const matches: Array<{ number: string; chunkId: string; quote: string }> = []

  for (const chunk of params.evidence) {
    if (roleToken && !evidenceMatchesRoleToken(chunk, roleToken)) continue

    const context = normalize(
      [chunk.section, chunk.documentTitle, chunk.documentType, chunk.content]
        .filter(Boolean)
        .join(" ")
    )
    if (needsDesistimiento && !context.includes("desist")) continue

    for (const match of String(chunk.content || "").matchAll(/fojas?\s+(\d{1,6})/gi)) {
      const number = String(match[1] || "").trim()
      const content = String(chunk.content || "")
      const index = typeof match.index === "number" ? match.index : content.toLowerCase().indexOf(String(match[0] || "").toLowerCase())
      const full =
        index >= 0
          ? content.slice(index, index + 120).replace(/\s+/g, " ").trim()
          : String(match[0] || "").trim()
      if (!number || seenNumbers.has(number)) continue
      seenNumbers.add(number)
      matches.push({
        number,
        chunkId: chunk.chunkId,
        quote: full,
      })
      if (matches.length >= 4) break
    }
    if (matches.length >= 4) break
  }

  return matches
}

function formatFojasList(numbers: string[]) {
  if (numbers.length <= 1) return numbers[0] || ""
  if (numbers.length === 2) return `${numbers[0]} y ${numbers[1]}`
  return `${numbers.slice(0, -1).join(", ")} y ${numbers[numbers.length - 1]}`
}

function inferExplicitQuestionDocType(question: string) {
  const normalizedQuestion = normalize(question)
  if (normalizedQuestion.includes("sentencia") || normalizedQuestion.includes("fallo")) return "sentencia"
  if (normalizedQuestion.includes("informe") || normalizedQuestion.includes("evacua")) return "informe"
  if (
    normalizedQuestion.includes("reclamacion") ||
    normalizedQuestion.includes("reclamante") ||
    normalizedQuestion.includes("escrito inicial") ||
    normalizedQuestion.includes("desistim")
  ) {
    return "reclamacion"
  }
  return null
}

function docTypeWithArticle(docType: string) {
  return docType === "informe" ? "un informe" : `una ${docType}`
}

function applyExtractiveFactOverrides(params: {
  question: string
  evidence: EvidenceChunk[]
  paragraphs: GroundedParagraph[]
}) {
  const normalizedQuestion = normalize(params.question)
  const roleToken = extractQuestionRoleToken(params.question)
  const paragraphs = params.paragraphs.map((row) => ({ ...row, citations: row.citations.map((c) => ({ ...c })) }))

  if (normalizedQuestion.includes("fojas")) {
    const fojas = collectFojasFromEvidence(params)
    if (fojas.length > 0) {
      const numbers = fojas.map((item) => item.number)
      return [
        {
          paragraph: 0,
          notFound: false,
          text: `En ${roleToken || "el documento consultado"}, se mencionan las fojas ${formatFojasList(numbers)}.`,
          citations: fojas.map((item) => ({ chunkId: item.chunkId, quote: item.quote })),
        },
      ] satisfies GroundedParagraph[]
    }
  }

  if (normalizedQuestion.includes("existe") || normalizedQuestion.includes("hay")) {
    const explicitDocType = inferExplicitQuestionDocType(params.question)
    const matchingChunk = explicitDocType
      ? params.evidence.find((chunk) => {
          if (roleToken && !evidenceMatchesRoleToken(chunk, roleToken)) return false
          const hay = normalize(
            [chunk.content, chunk.section, chunk.documentTitle, chunk.documentType, chunk.docRole]
              .filter(Boolean)
              .join(" ")
          )
          return hay.includes(normalize(explicitDocType))
        })
      : null

    if (explicitDocType && matchingChunk) {
      const quote = fallbackChunkQuote(matchingChunk.content)
      if (quote) {
        return [
          {
            paragraph: 0,
            notFound: false,
            text: `Sí, existe ${docTypeWithArticle(explicitDocType)} en el corpus${roleToken ? ` para ${roleToken}` : ""}.`,
            citations: [{ chunkId: matchingChunk.chunkId, quote }],
          },
        ]
      }
    }
  }

  if (roleToken && paragraphs.length > 0) {
    const first = paragraphs[0]
    if (!normalize(first.text).includes(normalize(roleToken))) {
      first.text = `En ${roleToken}, ${first.text}`
    }
  }

  return paragraphs
}

async function verifyGroundingWithOpenAI(params: {
  question: string
  mode: AnswerMode
  paragraphs: VerifiedParagraph[]
  allowed: Map<string, EvidenceChunk>
}) {
  if (!groundingEnabled() || params.paragraphs.length === 0) {
    return {
      paragraphs: params.paragraphs.map((p) => ({ ...p })),
      model: null as string | null,
      applied: false,
    }
  }

  const candidates = params.paragraphs
    .map((row) => {
      const supportText = citationsSupportText(row.citations, params.allowed)
      const ratio = lexicalGroundingRatio(row.text, supportText)
      return {
        row,
        supportText,
        ratio,
      }
    })
    .filter((x) => x.row.citations.length > 0)

  if (!candidates.length) {
    return {
      paragraphs: params.paragraphs.map((p) => ({ ...p })),
      model: null as string | null,
      applied: false,
    }
  }

  const policy = supportPolicy(params.mode)
  const suspectRatio = numberEnv("RAG_FACT_VERIFIER_SUSPECT_RATIO", policy.suspectRatioDefault, 0.05, 0.6)
  const suspicious = candidates
    .filter((x) => x.ratio < suspectRatio)
    .slice(0, numberEnv("RAG_FACT_VERIFIER_MAX_PARAGRAPHS", 5, 1, 12))
  if (!suspicious.length) {
    return {
      paragraphs: params.paragraphs.map((p) => ({ ...p })),
      model: null as string | null,
      applied: false,
    }
  }

  const citedChunks = Array.from(
    new Set(
      suspicious.flatMap((entry) => entry.row.citations.map((citation) => String(citation.chunkId || "")))
    )
  )
    .map((chunkId) => params.allowed.get(chunkId))
    .filter((row): row is EvidenceChunk => Boolean(row))
    .slice(0, numberEnv("RAG_FACT_VERIFIER_MAX_EVIDENCE", 18, 6, 40))

  const evidenceBlock = citedChunks
    .map((chunk, idx) => {
      const excerpt = summarizeEvidencePassage(params.question, chunk.content, 520)
      return `EVIDENCE ${idx + 1}: chunkId=${chunk.chunkId}\n${excerpt}`
    })
    .join("\n\n---\n\n")

  const paragraphBlock = suspicious
    .map((entry) => {
      const citationIds = entry.row.citations.map((citation) => citation.chunkId).join(", ")
      return `PARAGRAPH ${entry.row.paragraph}:\ntext=${entry.row.text}\ncitations=${citationIds}`
    })
    .join("\n\n")

  try {
    const verified = await generateOpenAIJson({
      system:
        "Eres un verificador factual estricto. Revisa si cada parrafo esta completamente sustentado por la evidencia citada. Si hay afirmaciones no soportadas, reescribe el parrafo de forma estrictamente sustentada o marca grounded=false.",
      prompt:
        `Pregunta:\n${params.question}\n\n` +
        `Modo: ${params.mode}\n\n` +
        `Parrafos a verificar:\n\n${paragraphBlock}\n\n` +
        `EVIDENCE disponible:\n\n${evidenceBlock}\n\n` +
        "Instrucciones:\n" +
        "- Devuelve un objeto por cada paragraph indicado.\n" +
        "- grounded=true solo si todo el texto queda sustentado por las evidencias citadas.\n" +
        "- revisedText debe ser concreto, sin agregar hechos no presentes.\n",
      schemaName: "strict_answer_grounding_review",
      schema: GroundingReviewJsonSchema,
      maxCompletionTokens: 800,
      reasoningEffort: "minimal",
      model: String(
        process.env.OPENAI_FACT_VERIFIER_MODEL ||
          process.env.OPENAI_ANSWER_MODEL ||
          process.env.OPENAI_RAG_MODEL ||
          "gpt-5-nano"
      ),
    })

    const reviewRows = Array.isArray((verified.output as any)?.paragraphs)
      ? ((verified.output as any).paragraphs as any[])
      : []

    const reviewByParagraph = new Map<
      number,
      {
        grounded: boolean
        revisedText: string
      }
    >()

    for (const row of reviewRows) {
      const paragraph = Number(row?.paragraph)
      if (!Number.isFinite(paragraph)) continue
      reviewByParagraph.set(Math.floor(paragraph), {
        grounded: Boolean(row?.grounded),
        revisedText: String(row?.revisedText || "").trim(),
      })
    }

    const grounded: GroundedParagraph[] = params.paragraphs.map((row) => {
      const review = reviewByParagraph.get(row.paragraph)
      if (!review) return { ...row }

      const supportText = citationsSupportText(row.citations, params.allowed)
      const revised = review.revisedText || row.text
      const revisedRatio = lexicalGroundingRatio(revised, supportText)
       const minRatio = numberEnv("RAG_FACT_VERIFIER_MIN_RATIO", policy.minRatioDefault, 0.05, 0.5)
      const groundedEnough = review.grounded && revisedRatio >= minRatio

      if (!groundedEnough) {
        return {
          ...row,
          text: "No se encuentra en las fuentes disponibles.",
          notFound: true,
        }
      }

      return {
        ...row,
        text: revised,
        notFound: false,
      }
    })

    return {
      paragraphs: grounded,
      model: verified.model,
      applied: true,
    }
  } catch {
    return {
      paragraphs: params.paragraphs.map((p) => ({ ...p })),
      model: null as string | null,
      applied: false,
    }
  }
}

async function reflectOnAnswerWithOpenAI(params: {
  question: string
  mode: AnswerMode
  responseProfile: Exclude<AnswerResponseProfile, "auto">
  paragraphs: GroundedParagraph[]
  evidence: EvidenceChunk[]
  allowed: Map<string, EvidenceChunk>
}) {
  if (!reflectionEnabled(params.responseProfile) || params.paragraphs.length === 0) {
    return {
      paragraphs: params.paragraphs.map((row) => ({ ...row })),
      model: null as string | null,
      applied: false,
      issues: [] as string[],
      revisedParagraphs: 0,
      relevant: null as boolean | null,
      complete: null as boolean | null,
      coherent: null as boolean | null,
    }
  }

  const paragraphBlock = params.paragraphs
    .map((row) => {
      const citationIds = row.citations.map((citation) => citation.chunkId).join(", ")
      return `PARAGRAPH ${row.paragraph}:\ntext=${row.text}\ncitations=${citationIds}`
    })
    .join("\n\n")

  const evidenceBlock = params.evidence
    .slice(0, 8)
    .map((chunk, idx) => {
      const excerpt = summarizeEvidencePassage(params.question, chunk.content, 360)
      return `EVIDENCE ${idx + 1}: chunkId=${chunk.chunkId}\n${excerpt}`
    })
    .join("\n\n---\n\n")

  try {
    const reflection = await generateOpenAIJson({
      system:
        "Eres un revisor critico de respuestas juridico-documentales. Evalua si la respuesta es relevante, completa y coherente para la pregunta. Si puedes mejorar algun parrafo sin agregar hechos no respaldados por las mismas citas, devuelve revisedParagraphs.",
      prompt:
        `Pregunta:\n${params.question}\n\n` +
        `Modo: ${params.mode}\n\n` +
        `Parrafos actuales:\n\n${paragraphBlock}\n\n` +
        `Evidencia disponible:\n\n${evidenceBlock}\n\n` +
        "Instrucciones:\n" +
        "- relevant=true solo si la respuesta responde de forma directa la pregunta.\n" +
        "- complete=true solo si cubre los aspectos principales soportados por la evidencia.\n" +
        "- coherent=true solo si no hay saltos o contradicciones internas.\n" +
        "- Usa revisedParagraphs solo cuando puedas mejorar claridad o foco sin agregar hechos nuevos.\n",
      schemaName: "strict_answer_reflection_review",
      schema: ReflectionReviewJsonSchema,
      maxCompletionTokens: 700,
      reasoningEffort: "minimal",
      model: String(
        process.env.OPENAI_SELF_REFLECTION_MODEL ||
          process.env.OPENAI_FACT_VERIFIER_MODEL ||
          process.env.OPENAI_ANSWER_MODEL ||
          "gpt-5-nano"
      ),
    })

    const revisedRows = Array.isArray((reflection.output as any)?.revisedParagraphs)
      ? ((reflection.output as any).revisedParagraphs as any[])
      : []
    const revisedByParagraph = new Map<number, string>()
    for (const row of revisedRows) {
      const paragraph = Number(row?.paragraph)
      const text = String(row?.text || "").trim()
      if (!Number.isFinite(paragraph) || !text) continue
      revisedByParagraph.set(Math.floor(paragraph), text)
    }

    const policy = supportPolicy(params.mode)
    const minRatio = numberEnv("RAG_FACT_VERIFIER_MIN_RATIO", policy.minRatioDefault, 0.05, 0.5)
    let revisedCount = 0

    const paragraphs = params.paragraphs.map((row) => {
      const candidate = revisedByParagraph.get(row.paragraph)
      if (!candidate) return { ...row }

      const supportText = citationsSupportText(row.citations, params.allowed)
      if (lexicalGroundingRatio(candidate, supportText) < minRatio) {
        return { ...row }
      }

      revisedCount += 1
      return {
        ...row,
        text: candidate,
      }
    })

    const issues = Array.isArray((reflection.output as any)?.issues)
      ? ((reflection.output as any).issues as unknown[])
          .map((item) => String(item || "").trim())
          .filter(Boolean)
          .slice(0, 6)
      : []

    return {
      paragraphs,
      model: reflection.model,
      applied: true,
      issues,
      revisedParagraphs: revisedCount,
      relevant:
        typeof (reflection.output as any)?.relevant === "boolean"
          ? Boolean((reflection.output as any).relevant)
          : null,
      complete:
        typeof (reflection.output as any)?.complete === "boolean"
          ? Boolean((reflection.output as any).complete)
          : null,
      coherent:
        typeof (reflection.output as any)?.coherent === "boolean"
          ? Boolean((reflection.output as any).coherent)
          : null,
    }
  } catch {
    return {
      paragraphs: params.paragraphs.map((row) => ({ ...row })),
      model: null as string | null,
      applied: false,
      issues: [] as string[],
      revisedParagraphs: 0,
      relevant: null as boolean | null,
      complete: null as boolean | null,
      coherent: null as boolean | null,
    }
  }
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
  return resolveOpenAIAnswerModel()
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
  profile: Exclude<AnswerResponseProfile, "auto">,
  mode: AnswerMode
): AnswerBudget {
  const baseModel = defaultAnswerModel()
  const fastModel = resolveOpenAIFastModel()
  const balancedModel = resolveOpenAIBalancedModel()
  const deepModel = resolveOpenAIDeepModel()

  if (profile === "fast") {
    return {
      maxEvidence: Math.max(4, Math.min(base.maxEvidence, base.maxEvidence - 2)),
      maxChunkChars: Math.max(650, Math.floor(base.maxChunkChars * 0.78)),
      maxParagraphs: Math.max(2, Math.min(base.maxParagraphs, 3)),
      maxCompletionTokens: Math.max(420, Math.floor(base.maxCompletionTokens * 0.68)),
      reasoningEffort: "minimal",
      modelCandidates: uniqueNonEmpty([fastModel, baseModel, "gpt-4.1-nano", "gpt-5-nano", "gpt-5-mini"]),
    }
  }

  if (profile === "deep") {
    return {
      maxEvidence: Math.min(18, base.maxEvidence + 4),
      maxChunkChars: Math.min(1800, Math.floor(base.maxChunkChars * 1.2)),
      maxParagraphs: Math.min(10, base.maxParagraphs + 2),
      maxCompletionTokens: Math.min(2200, Math.floor(base.maxCompletionTokens * 1.45)),
      reasoningEffort: "medium",
      modelCandidates: uniqueNonEmpty([deepModel, baseModel, "gpt-5-nano", "gpt-5-mini", "gpt-4.1-nano"]),
    }
  }

  if (mode === "extractive") {
    return {
      ...base,
      maxEvidence: Math.max(5, Math.min(base.maxEvidence, 6)),
      maxChunkChars: Math.max(760, Math.min(base.maxChunkChars, 840)),
      maxParagraphs: Math.max(2, Math.min(base.maxParagraphs, 3)),
      maxCompletionTokens: Math.max(520, Math.min(base.maxCompletionTokens, 640)),
      reasoningEffort: "minimal",
      modelCandidates: uniqueNonEmpty([fastModel, balancedModel, baseModel, "gpt-4.1-nano", "gpt-5-nano"]),
    }
  }

  return {
    ...base,
    reasoningEffort: "minimal",
    modelCandidates: uniqueNonEmpty([balancedModel, baseModel, "gpt-5-nano", "gpt-4.1-nano", "gpt-5-mini"]),
  }
}

export async function generateStrictAnswer(params: {
  question: string
  evidence: EvidenceChunk[]
  mode?: AnswerMode
  responseProfile?: AnswerResponseProfile
  difficulty?: QuestionDifficulty
  skipReflection?: boolean
}) {
  const {
    question,
    evidence,
    mode = "extractive",
    responseProfile = "auto",
    difficulty = "medium",
    skipReflection = false,
  } = params

  const resolvedProfile = resolveResponseProfile(responseProfile, difficulty)
  const budget = applyResponseProfile(modeBudget(mode), resolvedProfile, mode)

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

      const content = summarizeEvidencePassage(question, c.content, budget.maxChunkChars)
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
        .map((c: any) => {
          const chunk = allowed.get(c.chunkId)!
          const hay = normalize(chunk.content)
          const needle = normalize(c.quote)
          if (needle.length >= 12 && hay.includes(needle)) {
            return {
              chunkId: c.chunkId,
              quote: c.quote,
            } as VerifiedCitation
          }

          const fallback = fallbackChunkQuote(chunk.content)
          if (!fallback) return null
          return {
            chunkId: c.chunkId,
            quote: fallback,
          } as VerifiedCitation
        })
        .filter((c: VerifiedCitation | null): c is VerifiedCitation => Boolean(c))

      const dedupCitations = Array.from(
        new Map(citations.map((c) => [`${c.chunkId}|${normalize(c.quote)}`, c])).values()
      )

      if (dedupCitations.length === 0 && !rawNotFound && rawText) {
        const seed = evidence[idx] || evidence[0]
        if (seed?.chunkId) {
          const quote = fallbackChunkQuote(seed.content)
          if (quote) {
            dedupCitations.push({
              chunkId: seed.chunkId,
              quote,
            })
          }
        }
      }

      const ok = dedupCitations.length > 0 && !rawNotFound
      return {
        text: ok ? rawText || "No se encuentra en las fuentes disponibles." : "No se encuentra en las fuentes disponibles.",
        citations: dedupCitations,
        notFound: !ok,
        paragraph: idx,
      }
    })

  const supportedSeed = verifiedParagraphs.filter((p) => !p.notFound)

  const grounding = await verifyGroundingWithOpenAI({
    question,
    mode,
    paragraphs: supportedSeed,
    allowed,
  })

  const supported = grounding.paragraphs.filter((p) => !p.notFound && p.citations.length > 0)

  const reflection = skipReflection
    ? {
        paragraphs: supported.map((row) => ({ ...row })),
        model: null as string | null,
        applied: false,
        issues: [] as string[],
        revisedParagraphs: 0,
        relevant: null as boolean | null,
        complete: null as boolean | null,
        coherent: null as boolean | null,
      }
    : await reflectOnAnswerWithOpenAI({
        question,
        mode,
        responseProfile: resolvedProfile,
        paragraphs: supported,
        evidence,
        allowed,
      })

  const reflectedParagraphs = applyExtractiveFactOverrides({
    question,
    evidence,
    paragraphs: reflection.paragraphs.filter((p) => !p.notFound && p.citations.length > 0),
  })

  const flat = reflectedParagraphs.flatMap((p, paragraph) =>
    p.citations.map((c: VerifiedCitation) => ({ ...c, paragraph }))
  )

  const uniqueCitationChunks = Array.from(new Set(flat.map((c) => c.chunkId))).length
  const support = inferSupportStrength({
    mode,
    candidateParagraphs: Math.max(1, supportedSeed.length),
    supportedParagraphs: reflectedParagraphs.length,
    uniqueChunks: uniqueCitationChunks,
  })

  const notFound = Boolean(out.notFound) || support.strength === "none"
  const answerBody = notFound
    ? "No se encuentra en las fuentes disponibles."
    : reflectedParagraphs.map((p) => p.text).join("\n\n")
  const answer =
    support.strength === "weak" && !notFound
      ? `La evidencia disponible es parcial y la respuesta debe leerse como preliminar.\n\n${answerBody}`
      : answerBody
  const suggestions = Array.isArray((out as any).suggestions) ? (out as any).suggestions.map(String) : []
  if (support.strength === "weak" || support.strength === "none") {
    suggestions.unshift("Agrega mas fuentes o documentos mas directos si necesitas una respuesta con mayor respaldo.")
  }
  if (
    reflection.applied &&
    reflection.issues.length > 0 &&
    !notFound &&
    (reflection.complete === false || reflection.relevant === false)
  ) {
    suggestions.unshift(
      "La respuesta cubre solo parte de la consulta soportada por la evidencia disponible; si necesitas cerrar la estrategia, conviene recuperar mas fuentes directas."
    )
  }

  return {
    answer,
    paragraphs: reflectedParagraphs.map((p) => ({
      text: p.text,
      citations: p.citations,
      notFound: p.notFound,
    })),
    citations: flat,
    notFound,
    suggestions: Array.from(new Set(suggestions.filter(Boolean))),
    model,
    usage,
    verification: {
      applied: grounding.applied,
      model: grounding.model,
      dropped_paragraphs: Math.max(0, supportedSeed.length - supported.length),
      support_strength: support.strength,
      support_reason: support.reason,
      support_paragraph_ratio: Number(support.paragraphRatio.toFixed(3)),
      supported_paragraphs: reflectedParagraphs.length,
      candidate_paragraphs: supportedSeed.length,
      unique_citation_chunks: uniqueCitationChunks,
      reflection_applied: reflection.applied,
      reflection_model: reflection.model,
      reflection_issues: reflection.issues,
      reflection_revised_paragraphs: reflection.revisedParagraphs,
      reflection_relevant: reflection.relevant,
      reflection_complete: reflection.complete,
      reflection_coherent: reflection.coherent,
    },
  }
}
