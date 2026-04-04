import type { AnswerMode, EvidenceChunk, QuestionDifficulty } from "@/lib/rag/strict-answer"

import { generateOpenAIJson } from "@/lib/llm/openai-json"
import type { ResolvedResponseProfile } from "@/lib/rag/router"

export type EvidenceQuality = "sufficient" | "partial" | "insufficient"

export type EvidenceQualityResult = {
  quality: EvidenceQuality
  reason: string
  reformulatedQueries: string[]
  model: string | null
  evaluatedWithModel: boolean
  lexicalCoverage: number
  evidenceCount: number
  snapshotCount: number
  shouldEarlyExit: boolean
}

const STOP_WORDS = new Set([
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
  "caso",
  "causa",
  "documento",
  "fuentes",
])

function boolEnv(name: string, fallback: boolean) {
  const raw = String(process.env[name] || "")
    .trim()
    .toLowerCase()
  if (!raw) return fallback
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false
  return fallback
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

function questionTokens(question: string) {
  return normalize(question)
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.length >= 4)
    .filter((item) => !STOP_WORDS.has(item))
    .slice(0, 18)
}

function lexicalCoverageForEvidence(question: string, evidence: EvidenceChunk[]) {
  const tokens = questionTokens(question)
  if (!tokens.length || !evidence.length) return 0

  const matched = new Set<string>()
  for (const chunk of evidence.slice(0, 12)) {
    const hay = normalize(`${chunk.content || ""} ${chunk.section || ""}`)
    if (!hay) continue
    for (const token of tokens) {
      if (hay.includes(token)) matched.add(token)
    }
  }

  return matched.size / Math.max(1, tokens.length)
}

function inferHeuristicQuality(params: {
  evidenceCount: number
  snapshotCount: number
  coverageScore: number
  lexicalCoverage: number
  difficulty: QuestionDifficulty
  mode: AnswerMode
}): { quality: EvidenceQuality; reason: string; shouldEarlyExit: boolean } {
  const blendedCoverage = Math.max(params.coverageScore, params.lexicalCoverage * 0.92)
  const minEvidenceForStrong =
    params.mode === "extractive" ? 3 : params.difficulty === "complex" ? 4 : 4
  const minSnapshotsForStrong = params.mode === "extractive" ? 1 : 2

  const strongThreshold =
    params.difficulty === "complex"
      ? 0.32
      : params.mode === "extractive"
        ? 0.24
        : 0.28
  const partialThreshold =
    params.difficulty === "complex"
      ? 0.18
      : params.mode === "extractive"
        ? 0.14
        : 0.17

  if (params.evidenceCount === 0 || blendedCoverage < 0.08) {
    return {
      quality: "insufficient",
      reason: "La evidencia recuperada casi no cubre los terminos centrales de la pregunta.",
      shouldEarlyExit: true,
    }
  }

  if (
    params.evidenceCount >= minEvidenceForStrong &&
    params.snapshotCount >= minSnapshotsForStrong &&
    blendedCoverage >= strongThreshold
  ) {
    return {
      quality: "sufficient",
      reason: "La evidencia recuperada cubre bien la consulta y tiene diversidad suficiente para generar una respuesta sustentada.",
      shouldEarlyExit: false,
    }
  }

  if (params.evidenceCount >= 4 && blendedCoverage >= partialThreshold) {
    return {
      quality: "partial",
      reason: "La evidencia recuperada es util, pero aun parece incompleta para responder con cobertura alta.",
      shouldEarlyExit: false,
    }
  }

  return {
    quality: "insufficient",
    reason: "La evidencia recuperada es escasa o tangencial para una respuesta estricta con citas confiables.",
    shouldEarlyExit: params.evidenceCount < 4 && blendedCoverage < 0.12,
  }
}

function summarizeChunk(chunk: EvidenceChunk, maxChars = 280) {
  const text = String(chunk.content || "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars).trim()}...`
}

export function inferHeuristicEvidenceQuality(params: {
  question: string
  evidence: EvidenceChunk[]
  coverageScore: number
  difficulty: QuestionDifficulty
  mode: AnswerMode
}) {
  const lexicalCoverage = lexicalCoverageForEvidence(params.question, params.evidence)
  const snapshotCount = new Set(
    params.evidence.map((chunk) => String(chunk.snapshotId || "")).filter(Boolean)
  ).size
  const inferred = inferHeuristicQuality({
    evidenceCount: params.evidence.length,
    snapshotCount,
    coverageScore: Math.max(0, Math.min(1, Number(params.coverageScore || 0))),
    lexicalCoverage,
    difficulty: params.difficulty,
    mode: params.mode,
  })

  return {
    ...inferred,
    lexicalCoverage,
    evidenceCount: params.evidence.length,
    snapshotCount,
  }
}

export async function evaluateEvidenceQuality(params: {
  question: string
  evidence: EvidenceChunk[]
  coverageScore: number
  mode: AnswerMode
  difficulty: QuestionDifficulty
  responseProfile: ResolvedResponseProfile
}): Promise<EvidenceQualityResult> {
  const heuristic = inferHeuristicEvidenceQuality(params)
  const modelEnabled =
    boolEnv("RAG_ENABLE_EVIDENCE_QUALITY_LLM", true) &&
    params.responseProfile !== "fast" &&
    params.evidence.length > 0 &&
    heuristic.quality !== "sufficient"

  if (!modelEnabled) {
    return {
      quality: heuristic.quality,
      reason: heuristic.reason,
      reformulatedQueries: [],
      model: null,
      evaluatedWithModel: false,
      lexicalCoverage: heuristic.lexicalCoverage,
      evidenceCount: heuristic.evidenceCount,
      snapshotCount: heuristic.snapshotCount,
      shouldEarlyExit: heuristic.shouldEarlyExit,
    }
  }

  try {
    const evidenceBlock = params.evidence
      .slice(0, 6)
      .map((chunk, index) => `EVIDENCE ${index + 1}: chunkId=${chunk.chunkId}\n${summarizeChunk(chunk)}`)
      .join("\n\n---\n\n")

    const generated = await generateOpenAIJson({
      system:
        "Eres un evaluador estricto de retrieval juridico. Clasifica la evidencia como sufficient, partial o insufficient. Si es partial o insufficient, sugiere hasta 2 queries reformuladas que ayuden a recuperar evidencia mas directa. No inventes hechos del caso.",
      prompt:
        `Pregunta: ${params.question}\n` +
        `Modo: ${params.mode}\n` +
        `Dificultad: ${params.difficulty}\n` +
        `Coverage score heuristico: ${params.coverageScore.toFixed(3)}\n` +
        `Lexical coverage: ${heuristic.lexicalCoverage.toFixed(3)}\n\n` +
        `Evidencia:\n\n${evidenceBlock}`,
      schemaName: "rag_evidence_quality",
      schema: {
        type: "object",
        properties: {
          quality: {
            type: "string",
            enum: ["sufficient", "partial", "insufficient"],
          },
          reason: { type: "string" },
          reformulatedQueries: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["quality", "reason", "reformulatedQueries"],
        additionalProperties: false,
      },
      maxCompletionTokens: 320,
      reasoningEffort: "minimal",
      model: String(
        process.env.OPENAI_EVIDENCE_QUALITY_MODEL ||
          process.env.OPENAI_FAST_MODEL ||
          process.env.OPENAI_ANSWER_MODEL ||
          "gpt-5-nano"
      ),
    })

    const qualityRaw = String((generated.output as any)?.quality || heuristic.quality)
    const quality: EvidenceQuality =
      qualityRaw === "sufficient" || qualityRaw === "partial" || qualityRaw === "insufficient"
        ? qualityRaw
        : heuristic.quality
    const reformulatedQueries = uniqueStrings(
      Array.isArray((generated.output as any)?.reformulatedQueries)
        ? ((generated.output as any).reformulatedQueries as unknown[]).map((item) => String(item || ""))
        : [],
      2
    )

    const shouldEarlyExit = quality === "insufficient" && heuristic.shouldEarlyExit && reformulatedQueries.length === 0

    return {
      quality,
      reason: String((generated.output as any)?.reason || heuristic.reason).trim() || heuristic.reason,
      reformulatedQueries,
      model: generated.model,
      evaluatedWithModel: true,
      lexicalCoverage: heuristic.lexicalCoverage,
      evidenceCount: heuristic.evidenceCount,
      snapshotCount: heuristic.snapshotCount,
      shouldEarlyExit,
    }
  } catch {
    return {
      quality: heuristic.quality,
      reason: heuristic.reason,
      reformulatedQueries: [],
      model: null,
      evaluatedWithModel: false,
      lexicalCoverage: heuristic.lexicalCoverage,
      evidenceCount: heuristic.evidenceCount,
      snapshotCount: heuristic.snapshotCount,
      shouldEarlyExit: heuristic.shouldEarlyExit,
    }
  }
}
