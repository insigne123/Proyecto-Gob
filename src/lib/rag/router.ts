import type { RagQueryIntent } from "@/lib/rag/query-intent"
import { isLikelyFactualQuestion } from "@/lib/rag/factual-answer"
import type { AnswerMode, AnswerResponseProfile, QuestionDifficulty } from "@/lib/rag/strict-answer"

export type ResolvedResponseProfile = Exclude<AnswerResponseProfile, "auto">
export type RagPipeline = "factual" | "direct" | "standard" | "corrective" | "deep"

export type RagExecutionPlan = {
  pipeline: RagPipeline
  allowHyDE: boolean
  allowCorrectiveRetrieval: boolean
  allowSelfReflection: boolean
  correctiveQueryLimit: number
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

export function classifyRagQuestionDifficulty(
  question: string,
  mode: AnswerMode
): QuestionDifficulty {
  const q = normalize(question)
  const words = q.split(" ").filter(Boolean)

  let score = 0
  if (words.length >= 18) score += 1
  if (words.length >= 30) score += 1
  if (mode === "comparison" || mode === "checklist" || mode === "resolution") score += 2

  const complexSignals = [
    "compara",
    "comparar",
    "diferencias",
    "similitudes",
    "enumera",
    "lista",
    "paso a paso",
    "analiza",
    "evalua",
    "riesgos",
    "mitigaciones",
    "prioriza",
    "justifica",
    "precedentes",
    "marco teorico",
    "jurisprudencia",
    "multi fuente",
  ]

  const simpleSignals = ["que es", "define", "resumen corto", "hola", "gracias"]

  for (const signal of complexSignals) {
    if (q.includes(signal)) score += 1
  }
  for (const signal of simpleSignals) {
    if (q.includes(signal)) score -= 1
  }

  if (score <= 1) return "simple"
  if (score >= 4) return "complex"
  return "medium"
}

export function resolveRagResponseProfile(
  requested: AnswerResponseProfile,
  difficulty: QuestionDifficulty
): ResolvedResponseProfile {
  if (requested === "fast" || requested === "balanced" || requested === "deep") {
    return requested
  }
  if (difficulty === "simple") return "fast"
  if (difficulty === "complex") return "deep"
  return "balanced"
}

export function decideRagExecutionPlan(params: {
  question: string
  mode: AnswerMode
  difficulty: QuestionDifficulty
  responseProfile: ResolvedResponseProfile
  intent: RagQueryIntent
  hasAttachedSource?: boolean
}): RagExecutionPlan {
  const normalized = normalize(params.question)

  let pipeline: RagPipeline = "standard"

  if (params.hasAttachedSource) {
    pipeline = "direct"
  } else if (
    params.mode === "extractive" &&
    params.responseProfile !== "deep" &&
    isLikelyFactualQuestion(params.question) &&
    !params.intent.asksForDefenseCriteria &&
    !params.intent.asksForDocumentPriority &&
    !params.intent.asksForContextUse &&
    !params.intent.asksForComparison
  ) {
    pipeline = "factual"
  } else if (
    params.responseProfile === "deep" ||
    params.difficulty === "complex" ||
    params.intent.asksForComparison ||
    params.intent.needsMultiCause ||
    params.intent.needsGraphLookup ||
    params.intent.questionType === "comparative" ||
    normalized.includes("marco teorico") ||
    normalized.includes("precedente") ||
    normalized.includes("jurisprudencia")
  ) {
    pipeline = "deep"
  } else if (
    params.mode !== "extractive" ||
    params.intent.asksForDefenseCriteria ||
    params.intent.asksForOutcome ||
    params.intent.asksForProcedureState ||
    params.intent.questionType === "strategic"
  ) {
    pipeline = "corrective"
  } else if (params.difficulty === "simple") {
    pipeline = "direct"
  }

  return {
    pipeline,
    allowHyDE:
      !params.hasAttachedSource &&
      (pipeline === "deep" ||
        (pipeline === "corrective" &&
          (params.intent.asksForComparison ||
            params.intent.asksForOutcome ||
            params.intent.needsMultiCause ||
            params.intent.needsGraphLookup))),
    allowCorrectiveRetrieval: pipeline === "corrective" || pipeline === "deep",
    allowSelfReflection:
      params.responseProfile !== "fast" &&
      (pipeline === "corrective" || pipeline === "deep" || params.mode !== "extractive"),
    correctiveQueryLimit:
      pipeline === "deep"
        ? params.intent.needsMultiCause || params.intent.needsGraphLookup
          ? 3
          : 2
        : pipeline === "corrective"
          ? 2
          : 1,
  }
}
