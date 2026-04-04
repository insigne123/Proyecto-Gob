import { NextResponse } from "next/server"
import { z } from "zod"

import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getRagProvider } from "@/lib/env"
import { getRuntimeCached } from "@/lib/runtime-cache"
import { buildAgenticCorrectiveQueries } from "@/lib/rag/agent-corrective"
import { loadWorkspaceRetrievalFeedbackSignals, type RetrievalFeedbackSignals } from "@/lib/rag/feedback-signals"
import { buildAgenticRetrievalJobs } from "@/lib/rag/agent-tool-loop"
import { executeAgenticRetrievalJobs } from "@/lib/rag/agent-tool-runner"
import { buildStrategicAgentPlan } from "@/lib/rag/agent-orchestrator"
import { verifyRetrievalSufficiency } from "@/lib/rag/retrieval-verifier"
import { loadPersistedOnboardingArtifacts, type PersistedOnboardingArtifacts } from "@/lib/onboarding/artifacts"
import { evaluateEvidenceQuality } from "@/lib/rag/evidence-quality"
import { buildDeterministicFactualAnswer } from "@/lib/rag/factual-answer"
import { buildHyDEExpansion } from "@/lib/rag/hyde"
import {
  buildStructuredOnboardingMemoryFromArtifacts,
  extractStructuredOnboardingMemoryFromMetadata,
  normalizeStructuredOnboardingMemory,
  type StructuredOnboardingMemory,
} from "@/lib/onboarding/structured-memory"
import {
  buildCauseInventoryBlock,
  buildStrategicProfilesBlock,
  extractStrategicRoleTokens,
} from "@/lib/onboarding/strategic-memory"
import { loadOnboardingCauseProfiles, loadOnboardingDocumentProfiles } from "@/lib/onboarding/defense-pool"
import { resolveOpenAIRescueModel } from "@/lib/openai-models"
import { retrieveLocalEvidenceForQuestion, retrieveReferencedSnapshotEvidence } from "@/lib/rag/local-retrieval"
import {
  listKnowledgeBasesForWorkspaces,
  mapResultsToEvidence,
  searchKnowledgeBaseWithFileSearch,
  shouldUseManagedRetrieval,
} from "@/lib/rag/openai-managed"
import { getAccessibleWorkspaceIdsForUser } from "@/lib/workspaces/access"
import { recordRetrievalTrace } from "@/lib/rag/retrieval-trace"
import { inferRagQueryIntent, inferRagQueryIntentWithLlm, type RagQueryIntent } from "@/lib/rag/query-intent"
import {
  buildDefenseAnswerPolicy,
  shouldForceDefenseAbstention,
  summarizeDefenseEvidenceCoverage,
} from "@/lib/rag/defense-answer-policy"
import { hydrateEvidenceDocumentContext } from "@/lib/rag/evidence-document-context"
import { selectDefenseDocumentMix } from "@/lib/tribunal/defense-document-policy"
import { buildFactSnapshotReferences, fetchTribunalDocumentFacts } from "@/lib/tribunal/document-facts"
import { loadLegalGraphContext, loadLegalGraphSnapshotReferences } from "@/lib/tribunal/graph-retrieval"
import { classifyTribunalDocumentRole } from "@/lib/tribunal/document-role"
import { resolveFinalAnswerSupport } from "@/lib/rag/final-support"
import { rerankEvidenceForAnswering } from "@/lib/rag/rerank"
import { buildPersistedThreadMemory, buildThreadMemory } from "@/lib/rag/thread-memory"
import {
  classifyRagQuestionDifficulty as classifyQuestionDifficultyCore,
  decideRagExecutionPlan,
  type RagPipeline,
  resolveRagResponseProfile as resolveResponseProfileCore,
  type ResolvedResponseProfile as RagResolvedResponseProfile,
} from "@/lib/rag/router"
import {
  generateStrictAnswer,
  type AnswerResponseProfile,
  type EvidenceChunk,
  type QuestionDifficulty,
} from "@/lib/rag/strict-answer"
import { generateOpenAIJson } from "@/lib/llm/openai-json"

const RetrievalFiltersSchema = z
  .object({
    docTypes: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    regions: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
    sectors: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
    sourceOrigins: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
    languages: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
    projectNames: z.array(z.string().trim().min(1).max(200)).max(12).optional(),
    snapshotIds: z.array(z.string().uuid()).max(30).optional(),
    yearFrom: z.number().int().min(1900).max(2200).optional(),
    yearTo: z.number().int().min(1900).max(2200).optional(),
  })
  .strict()

const AskSchema = z.object({
  question: z.string().trim().min(3).max(4000),
  threadId: z.string().uuid().nullable().optional(),
  sourceId: z.string().uuid().nullable().optional(),
  mode: z.enum(["extractive", "comparison", "checklist", "resolution"]).optional(),
  responseProfile: z.enum(["auto", "fast", "balanced", "deep"]).optional(),
  filters: RetrievalFiltersSchema.nullish(),
})

const CHITCHAT_WORDS = new Set([
  "hola",
  "holi",
  "hi",
  "hello",
  "hey",
  "buenas",
  "buenos",
  "dias",
  "tardes",
  "noches",
  "gracias",
  "thanks",
  "ok",
  "okay",
  "dale",
  "perfecto",
  "listo",
  "como",
  "estas",
  "que",
  "tal",
  "agente",
  "asistente",
  "ia",
  "bot",
])

const GREETING_PREFIXES = ["hola", "holi", "hi", "hello", "hey", "buenas", "buenos dias", "buenas tardes", "buenas noches"]

const META_ASSISTANT_SIGNALS = [
  "quien eres",
  "que puedes hacer",
  "como funcionas",
  "eres ia",
  "eres una ia",
  "que haces",
  "en que ayudas",
]

function normalizeIntentText(input: string) {
  return String(input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[!?.,;:()[\]{}"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function isGreetingLike(normalized: string) {
  const firstWord = normalized.split(" ").filter(Boolean)[0] || ""
  if (!firstWord) return false

  if (/^h?ola+$/i.test(firstWord)) return true
  if (/^holi+$/i.test(firstWord)) return true
  if (/^wen(a|as|ass|azz)$/i.test(firstWord)) return true

  return false
}

function isSmallTalkQuestion(input: string) {
  const normalized = normalizeIntentText(input)
  if (!normalized) return false

  if (isGreetingLike(normalized)) return true

  if (GREETING_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true

  const words = normalized.split(" ").filter(Boolean)
  if (!words.length || words.length > 8) return false
  const meaningful = words.filter((w) => !CHITCHAT_WORDS.has(w))
  return meaningful.length === 0
}

function isMetaAssistantQuestion(input: string) {
  const normalized = normalizeIntentText(input)
  if (!normalized) return false
  return META_ASSISTANT_SIGNALS.some((signal) => normalized.includes(signal))
}

function defaultRetrievalProvider(): "local" | "openai" | "hybrid" {
  const provider = getRagProvider()
  if (provider === "openai") return "openai"
  if (provider === "hybrid") return "hybrid"
  return "local"
}

function withAssistantReport(params: { usage: any; report: Record<string, any> }) {
  const base = params.usage && typeof params.usage === "object" ? params.usage : {}
  return {
    ...base,
    assistantReport: params.report,
  }
}

function buildAssistantWorklog(params: {
  skipReason?: "smalltalk" | "meta_assistant"
  retrievalProvider: "local" | "openai" | "hybrid"
  pipeline?: string | null
  effectiveMode: "extractive" | "comparison" | "checklist" | "resolution"
  requestedResponseProfile: AnswerResponseProfile
  resolvedResponseProfile: ResolvedResponseProfile
  questionDifficulty: QuestionDifficulty
  evidenceCount: number
  citationsCount: number
  retrievalExpandedToMemberWorkspaces?: boolean
  retrievalDeepened?: boolean
  retrievalRerankApplied?: boolean
  retrievalHydeApplied?: boolean
  retrievalHydeQueries?: string[]
  correctiveApplied?: boolean
  correctiveEarlyExit?: boolean
  correctiveReason?: string | null
  answerVerificationApplied?: boolean
  answerVerificationDroppedParagraphs?: number
  answerReflectionApplied?: boolean
  answerReflectionIssues?: string[]
  answerRescueApplied?: boolean
  defenseCoverageStatus?: string | null
  defenseMissingRoles?: string[]
  retrievalQueries?: string[]
  graphRelatedRoles?: string[]
  graphRelatedQueries?: string[]
  agentPlanTools?: string[]
  agentToolBudget?: number
  agentToolStepsUsed?: number
  agentBudgetExhausted?: boolean
  agentCorrectiveRationale?: string[]
  agentStopReason?: string | null
  attachedSourceTitle?: string | null
  preferredDocRoles?: string[]
  questionType?: string | null
  intentComplexity?: string | null
  intentUsedLlm?: boolean
  supportStrength?: string | null
  supportReason?: string | null
}) {
  if (params.skipReason === "meta_assistant") {
    return [
      {
        label: "Consulta de sistema detectada",
        detail: "Respondi directo porque la pregunta era sobre el propio asistente y no requeria buscar evidencia.",
      },
      {
        label: "Respuesta breve preparada",
        detail: "Explique capacidades, limites y el uso de fuentes verificables.",
      },
    ]
  }

  if (params.skipReason === "smalltalk") {
    return [
      {
        label: "Saludo o consulta ligera detectada",
        detail: "Evite retrieval para responder rapido y mantener una experiencia conversacional natural.",
      },
      {
        label: "Asistente listo",
        detail: "Quedo preparado para pasar a analisis con fuentes cuando llegue una consulta juridica o documental.",
      },
    ]
  }

  const scopeDetail = params.attachedSourceTitle
    ? `Analice primero el documento adjunto ${params.attachedSourceTitle}.`
    : params.retrievalExpandedToMemberWorkspaces
      ? "Amplie la busqueda al workspace actual y expedientes relacionados del usuario."
      : "Mantube la busqueda dentro del workspace actual para reducir ruido."

  const refinementDetail = [
    params.retrievalDeepened ? "descompuse la consulta" : null,
    params.retrievalRerankApplied ? "reordene evidencia con rerank" : null,
    params.retrievalHydeApplied ? "agregue expansion semantica" : null,
    params.correctiveApplied ? "corrigi retrieval antes de responder" : null,
    params.answerVerificationApplied ? "verifique la salida final" : null,
    params.answerReflectionApplied ? "hice una revision final de relevancia y coherencia" : null,
    params.answerRescueApplied ? "active salida de rescate con evidencia parcial" : null,
  ]
    .filter(Boolean)
    .join(", ")

  return [
    {
      label: "Interprete la consulta",
      detail:
        `Mode ${params.effectiveMode}, pipeline ${params.pipeline || "standard"}, dificultad ${params.questionDifficulty}, perfil pedido ${params.requestedResponseProfile} y perfil usado ${params.resolvedResponseProfile}.` +
        (params.questionType ? ` Tipo ${params.questionType}.` : "") +
        (params.intentComplexity ? ` Complejidad inferida ${params.intentComplexity}.` : "") +
        (params.intentUsedLlm ? " Clasificacion reforzada con LLM." : ""),
    },
    {
      label: "Planifique la busqueda",
      detail:
        `${scopeDetail} Provider ${params.retrievalProvider}. ${Math.max(1, params.retrievalQueries?.length || 0)} consulta(s) de retrieval preparadas.` +
        (Array.isArray(params.preferredDocRoles) && params.preferredDocRoles.length
          ? ` Priorice documentos tipo ${params.preferredDocRoles.join(", ")}.`
          : "") +
        (Array.isArray(params.graphRelatedRoles) && params.graphRelatedRoles.length
          ? ` Grafo legal sugirio ${params.graphRelatedRoles.join(", ")}.`
          : "") +
        (Array.isArray(params.agentPlanTools) && params.agentPlanTools.length
          ? ` Planner uso ${params.agentPlanTools.join(" -> ")}.`
          : "") +
        (typeof params.agentToolStepsUsed === "number" && typeof params.agentToolBudget === "number"
          ? ` Presupuesto agentico ${params.agentToolStepsUsed}/${params.agentToolBudget}.`
          : "") +
        (params.agentStopReason ? ` Criterio de parada: ${params.agentStopReason}.` : ""),
    },
    {
      label: "Consolide evidencia",
      detail:
        `${params.evidenceCount} evidencia(s) candidatas y ${params.citationsCount} cita(s) finales.` +
        (params.retrievalHydeApplied && params.retrievalHydeQueries?.length
          ? ` HyDE agrego ${params.retrievalHydeQueries.length} variante(s) semanticas.`
          : "") +
        (params.defenseCoverageStatus && params.defenseCoverageStatus !== "ready"
          ? ` Cobertura documental ${params.defenseCoverageStatus}.`
          : "") +
        (params.defenseMissingRoles?.length
          ? ` Faltaron roles clave: ${params.defenseMissingRoles.join(", ")}.`
          : "") +
        (Array.isArray(params.agentCorrectiveRationale) && params.agentCorrectiveRationale.length
          ? ` Ajustes agenticos: ${params.agentCorrectiveRationale.slice(0, 2).join(" | ")}.`
          : "") +
        (params.agentBudgetExhausted
          ? " Se agoto el presupuesto agentico y se detuvo la profundizacion adicional."
          : "") +
        (refinementDetail ? ` Ademas ${refinementDetail}.` : "") +
        (params.correctiveReason ? ` ${params.correctiveReason}` : ""),
    },
    {
      label: "Redacte respuesta experta",
      detail:
        params.answerVerificationApplied && (params.answerVerificationDroppedParagraphs || 0) > 0
          ? `Ajuste la respuesta despues de validar sustento y descarte ${params.answerVerificationDroppedParagraphs} parrafo(s) sin respaldo suficiente.`
          : "Cerre la respuesta priorizando ayuda practica, trazabilidad y citas verificables.",
    },
    ...(params.answerReflectionApplied && params.answerReflectionIssues?.length
      ? [
          {
            label: "Revise foco final",
            detail: params.answerReflectionIssues.slice(0, 2).join(" | "),
          },
        ]
      : []),
    ...(params.supportStrength && params.supportStrength !== "strong"
      ? [
          {
            label: "Calibre la solidez del sustento",
            detail: params.supportReason || "La respuesta final tiene soporte parcial o debil y conviene validarla con mas evidencia.",
          },
        ]
      : []),
  ]
}

function buildAssistantReport(params: {
  skipReason?: "smalltalk" | "meta_assistant"
  retrievalProvider: "local" | "openai" | "hybrid"
  pipeline?: string | null
  effectiveMode: "extractive" | "comparison" | "checklist" | "resolution"
  requestedResponseProfile: AnswerResponseProfile
  resolvedResponseProfile: ResolvedResponseProfile
  questionDifficulty: QuestionDifficulty
  retrievalMs: number
  generationMs: number
  totalMs: number
  evidenceCount: number
  citationsCount: number
  retrievalExpandedToMemberWorkspaces?: boolean
  retrievalDeepened?: boolean
  retrievalRerankApplied?: boolean
  retrievalHydeApplied?: boolean
  retrievalHydeQueries?: string[]
  retrievalQueries?: string[]
  correctiveApplied?: boolean
  correctiveEarlyExit?: boolean
  correctiveReason?: string | null
  answerVerificationApplied?: boolean
  answerVerificationDroppedParagraphs?: number
  answerReflectionApplied?: boolean
  answerReflectionIssues?: string[]
  answerRescueApplied?: boolean
  defenseCoverageStatus?: string | null
  defenseMissingRoles?: string[]
  defenseRoleCounts?: Record<string, number> | null
  attachedSourceTitle?: string | null
  model?: string | null
  preferredDocRoles?: string[]
  retrievalIntentHints?: string[]
  graphRelatedRoles?: string[]
  graphRelatedQueries?: string[]
  agentPlanTools?: string[]
  agentPlanRationale?: string[]
  agentPlanModel?: string | null
  agentToolBudget?: number
  agentToolStepsUsed?: number
  agentBudgetExhausted?: boolean
  agentCorrectiveRationale?: string[]
  agentStopReason?: string | null
  agentVerificationReports?: Array<Record<string, unknown>>
  questionType?: string | null
  intentComplexity?: string | null
  intentUsedLlm?: boolean
  intentModel?: string | null
  correctiveIterations?: number
  supportStrength?: string | null
  supportReason?: string | null
  supportParagraphRatio?: number
  supportCandidateParagraphs?: number
  supportSupportedParagraphs?: number
  supportUniqueCitationChunks?: number
}) {
  const worklog = buildAssistantWorklog(params)

  return {
    mode: params.effectiveMode,
    requestedProfile: params.requestedResponseProfile,
    resolvedProfile: params.resolvedResponseProfile,
    difficulty: params.questionDifficulty,
    pipeline: params.pipeline ?? null,
    retrievalProvider: params.retrievalProvider,
    sourceScope: params.attachedSourceTitle
      ? "attached_source"
      : params.retrievalExpandedToMemberWorkspaces
        ? "workspace_plus_members"
        : "workspace_only",
    evidenceCount: params.evidenceCount,
    citationsCount: params.citationsCount,
    retrievalMs: params.retrievalMs,
    generationMs: params.generationMs,
    totalMs: params.totalMs,
    expandedScope: Boolean(params.retrievalExpandedToMemberWorkspaces),
    deepened: Boolean(params.retrievalDeepened),
    rerankApplied: Boolean(params.retrievalRerankApplied),
    hydeApplied: Boolean(params.retrievalHydeApplied),
    hydeQueryCount: Array.isArray(params.retrievalHydeQueries) ? params.retrievalHydeQueries.length : 0,
    hydeQueries: Array.isArray(params.retrievalHydeQueries) ? params.retrievalHydeQueries.slice(0, 3) : [],
    correctiveApplied: Boolean(params.correctiveApplied),
    correctiveEarlyExit: Boolean(params.correctiveEarlyExit),
    correctiveReason: params.correctiveReason ?? null,
    verificationApplied: Boolean(params.answerVerificationApplied),
    verificationDroppedParagraphs: Math.max(0, Number(params.answerVerificationDroppedParagraphs || 0)),
    reflectionApplied: Boolean(params.answerReflectionApplied),
    reflectionIssues: Array.isArray(params.answerReflectionIssues) ? params.answerReflectionIssues.slice(0, 4) : [],
    rescueApplied: Boolean(params.answerRescueApplied),
    defenseCoverageStatus: params.defenseCoverageStatus ?? null,
    defenseMissingRoles: Array.isArray(params.defenseMissingRoles) ? params.defenseMissingRoles.slice(0, 4) : [],
    defenseRoleCounts: params.defenseRoleCounts ?? null,
    retrievalQueryCount: Array.isArray(params.retrievalQueries) ? params.retrievalQueries.length : 0,
    retrievalQueries: Array.isArray(params.retrievalQueries) ? params.retrievalQueries.slice(0, 6) : [],
    graphRelatedRoles: Array.isArray(params.graphRelatedRoles) ? params.graphRelatedRoles.slice(0, 6) : [],
    graphRelatedQueries: Array.isArray(params.graphRelatedQueries) ? params.graphRelatedQueries.slice(0, 4) : [],
    agentPlanTools: Array.isArray(params.agentPlanTools) ? params.agentPlanTools.slice(0, 5) : [],
    agentPlanRationale: Array.isArray(params.agentPlanRationale) ? params.agentPlanRationale.slice(0, 5) : [],
    agentPlanModel: params.agentPlanModel ?? null,
    agentToolBudget: typeof params.agentToolBudget === "number" ? params.agentToolBudget : null,
    agentToolStepsUsed: typeof params.agentToolStepsUsed === "number" ? params.agentToolStepsUsed : null,
    agentBudgetExhausted: Boolean(params.agentBudgetExhausted),
    agentCorrectiveRationale: Array.isArray(params.agentCorrectiveRationale)
      ? params.agentCorrectiveRationale.slice(0, 4)
      : [],
    agentStopReason: params.agentStopReason ?? null,
    agentVerificationReports: Array.isArray(params.agentVerificationReports)
      ? params.agentVerificationReports.slice(0, 6)
      : [],
    preferredDocRoles: Array.isArray(params.preferredDocRoles) ? params.preferredDocRoles.slice(0, 4) : [],
    retrievalIntentHints: Array.isArray(params.retrievalIntentHints) ? params.retrievalIntentHints.slice(0, 4) : [],
    questionType: params.questionType ?? null,
    intentComplexity: params.intentComplexity ?? null,
    intentUsedLlm: Boolean(params.intentUsedLlm),
    intentModel: params.intentModel ?? null,
    correctiveIterations: Math.max(0, Number(params.correctiveIterations || 0)),
    supportStrength: params.supportStrength ?? null,
    supportReason: params.supportReason ?? null,
    supportParagraphRatio: typeof params.supportParagraphRatio === "number" ? params.supportParagraphRatio : null,
    supportCandidateParagraphs:
      typeof params.supportCandidateParagraphs === "number" ? params.supportCandidateParagraphs : null,
    supportSupportedParagraphs:
      typeof params.supportSupportedParagraphs === "number" ? params.supportSupportedParagraphs : null,
    supportUniqueCitationChunks:
      typeof params.supportUniqueCitationChunks === "number" ? params.supportUniqueCitationChunks : null,
    attachedSourceTitle: params.attachedSourceTitle ?? null,
    model: params.model ?? null,
    skipReason: params.skipReason ?? null,
    worklog,
  }
}

type ResolvedResponseProfile = RagResolvedResponseProfile

function classifyQuestionDifficulty(
  question: string,
  mode: "extractive" | "comparison" | "checklist" | "resolution"
): QuestionDifficulty {
  return classifyQuestionDifficultyCore(question, mode)
}

function resolveResponseProfile(
  requested: AnswerResponseProfile,
  difficulty: QuestionDifficulty
): ResolvedResponseProfile {
  return resolveResponseProfileCore(requested, difficulty)
}

function retrievalProfile(
  mode: "extractive" | "comparison" | "checklist" | "resolution",
  responseProfile: ResolvedResponseProfile,
  difficulty: QuestionDifficulty,
  pipeline: RagPipeline
) {
  if (pipeline === "factual") {
    return {
      maxResults: responseProfile === "fast" ? 5 : 6,
      scoreThreshold: responseProfile === "fast" ? 0.2 : 0.18,
    }
  }
  if (mode === "checklist") {
    const base = { maxResults: 16, scoreThreshold: 0.08 }
    if (responseProfile === "fast") return { maxResults: 12, scoreThreshold: 0.12 }
    if (responseProfile === "deep" || difficulty === "complex") {
      return { maxResults: 22, scoreThreshold: 0.05 }
    }
    return base
  }
  if (mode === "comparison") {
    const base = { maxResults: 14, scoreThreshold: 0.1 }
    if (responseProfile === "fast") return { maxResults: 10, scoreThreshold: 0.13 }
    if (responseProfile === "deep" || difficulty === "complex") {
      return { maxResults: 18, scoreThreshold: 0.07 }
    }
    return base
  }
  if (mode === "resolution") {
    const base = { maxResults: 12, scoreThreshold: 0.12 }
    if (responseProfile === "fast") return { maxResults: 9, scoreThreshold: 0.16 }
    if (responseProfile === "deep" || difficulty === "complex") {
      return { maxResults: 16, scoreThreshold: 0.09 }
    }
    return base
  }
  if (responseProfile === "fast") return { maxResults: 7, scoreThreshold: 0.18 }
  if (responseProfile === "deep" || difficulty === "complex") {
    return { maxResults: 12, scoreThreshold: 0.12 }
  }
  return { maxResults: 10, scoreThreshold: 0.15 }
}

type EvidenceSeed = {
  chunk: EvidenceChunk
  origin: "attached" | "managed" | "local" | "onboarding" | "facts"
  rank: number
  score: number
  workspaceId: string | null
}

function extractRoleToken(question: string) {
  const match = String(question || "").match(/\bR-\d{1,5}-\d{4}\b/i)
  if (!match) return ""
  return String(match[0]).toUpperCase()
}

function normalizeRankingText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function lexicalTokensForRanking(question: string) {
  const stopWords = new Set([
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
    "causa",
    "documento",
    "fuentes",
    "existe",
    "aparece",
  ])

  return normalizeRankingText(question)
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x.length >= 3)
    .filter((x) => !stopWords.has(x))
    .filter((x) => !/^\d+$/.test(x))
    .slice(0, 24)
}

function lexicalCoverage(content: string, tokens: string[]) {
  const hay = normalizeRankingText(content)
  if (!hay || tokens.length === 0) return 0

  let matched = 0
  for (const token of tokens) {
    if (!token) continue
    if (hay.includes(token)) matched += 1
  }
  return matched
}

function buildRetrievalQueryVariants(params: {
  question: string
  mode: "extractive" | "comparison" | "checklist" | "resolution"
  difficulty: QuestionDifficulty
}) {
  const base = String(params.question || "").trim()
  if (!base) return [] as string[]

  const normalized = normalizeRankingText(base)
  const roleToken = extractRoleToken(base)

  let focus = ""
  if (normalized.includes("fojas")) focus = "fojas"
  else if (normalized.includes("sentencia") || normalized.includes("fallo")) focus = "sentencia"
  else if (normalized.includes("informe") || normalized.includes("evacua")) focus = "informe"
  else if (normalized.includes("reclamante") || normalized.includes("escrito inicial")) {
    focus = "reclamacion"
  } else if (normalized.includes("desistim")) {
    focus = "desistimiento"
  }

  const variants = [
    base,
    roleToken && focus ? `${roleToken} ${focus}` : "",
    roleToken && params.mode === "comparison" ? `${roleToken} comparacion diferencias` : "",
    params.mode === "checklist" ? `${base}. lista completa y verificable` : "",
    params.difficulty === "complex" ? `${base}. evidencia principal y antecedentes` : "",
  ]

  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of variants) {
    const clean = String(raw || "").trim()
    if (!clean) continue
    const norm = normalizeRankingText(clean)
    if (!norm || seen.has(norm)) continue
    seen.add(norm)
    out.push(clean)
  }

  return out.slice(0, 4)
}

function boolEnv(name: string, fallback = false) {
  const raw = String(process.env[name] || "")
    .trim()
    .toLowerCase()
  if (!raw) return fallback
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false
  return fallback
}

function numberEnv(name: string, fallback: number, min: number, max: number) {
  const raw = String(process.env[name] || "").trim()
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim()
  )
}

function citationTypeFromChunkId(chunkIdRaw: string) {
  const chunkId = String(chunkIdRaw || "").trim()
  if (!chunkId) return "synthetic"
  if (isUuidLike(chunkId)) return "db_chunk"
  if (chunkId.startsWith("file-") || chunkId.startsWith("openai:") || chunkId.includes(":")) {
    return "managed_file_span"
  }
  return "managed_file_span"
}

function enrichCitationMetadata(citation: any) {
  const chunkId = String(citation?.chunkId || "").trim()
  const citationType = citationTypeFromChunkId(chunkId)
  const verification = citationType === "db_chunk" ? "db_chunk_text" : "retrieval_snippet"

  return {
    ...citation,
    citationType,
    verification,
  }
}

function countAnswerBullets(text: string) {
  const matches = String(text || "").match(/(^|\n)\s*(?:[-*]|\d+\.)\s+/g)
  return matches ? matches.length : 0
}

function splitAnswerSegments(text: string) {
  const clean = String(text || "").replace(/\s+/g, " ").trim()
  if (!clean) return [] as string[]

  const paragraphs = clean
    .split(/\n\n+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 24)

  if (paragraphs.length >= 2) return paragraphs

  return clean
    .split(/(?<=[\.!?;:])\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 24)
}

function bulletizeAnswerText(text: string, maxBullets: number) {
  const segments = splitAnswerSegments(text)
  const picked = segments.slice(0, Math.max(1, maxBullets))
  if (!picked.length) return String(text || "").trim()
  return picked.map((segment, idx) => `${idx + 1}. ${segment}`).join("\n")
}

const ANSWER_CONTRACT_STOP_WORDS = new Set([
  "que",
  "como",
  "sobre",
  "este",
  "esta",
  "estas",
  "estos",
  "caso",
  "fuentes",
  "disponibles",
  "precedentes",
  "precedente",
  "especificos",
  "especificas",
  "existen",
  "existe",
  "indicalo",
  "explicitamente",
  "documentacion",
  "falta",
  "cargar",
  "lineas",
  "defensa",
  "riesgo",
  "sustento",
  "documental",
  "base",
  "adjunta",
  "resume",
  "maximo",
  "bullets",
  "cita",
  "citas",
])

type AnswerContract = {
  maxBullets: number | null
  minCitations: number
  requireExplicitNoEvidenceIfMissing: boolean
  isSpecificPrecedentQuery: boolean
  entityTokens: string[]
}

function extractAnswerContract(question: string): AnswerContract {
  const normalized = normalizeRankingText(question)
  const bulletMatch = normalized.match(/(?:maximo|maximo de|hasta)\s*(\d{1,2})\s*(?:bullets?|puntos?|items?)/)
  const minCitationsMatch = normalized.match(/(?:al menos|minimo|minimo de)\s*(\d{1,2})\s*(?:citas?|fragmentos?)/)
  const twoLineDefenseHint =
    (normalized.includes("dos lineas") || normalized.includes("2 lineas") || normalized.includes("dos lineas de defensa"))
      ? 2
      : null

  const maxBullets = bulletMatch
    ? Math.max(1, Math.min(12, Number(bulletMatch[1] || 0)))
    : twoLineDefenseHint
  const minCitations = minCitationsMatch ? Math.max(0, Math.min(8, Number(minCitationsMatch[1] || 0))) : 0

  const isSpecificPrecedentQuery =
    normalized.includes("precedente") ||
    normalized.includes("precedentes") ||
    (normalized.includes("hay") && normalized.includes("fuentes disponibles"))

  const requireExplicitNoEvidenceIfMissing =
    (normalized.includes("si no") || normalized.includes("si no existen")) &&
    (normalized.includes("indicalo explicitamente") ||
      normalized.includes("indica explicitamente") ||
      normalized.includes("dilo explicitamente"))

  const entityTokens = normalizeRankingText(question)
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x.length >= 4)
    .filter((x) => !ANSWER_CONTRACT_STOP_WORDS.has(x))
    .filter((x) => !/^\d+$/.test(x))
    .slice(0, 6)

  return {
    maxBullets,
    minCitations,
    requireExplicitNoEvidenceIfMissing,
    isSpecificPrecedentQuery,
    entityTokens,
  }
}

function tuneAnswerContract(params: {
  contract: AnswerContract
  mode: "extractive" | "comparison" | "checklist" | "resolution"
  responseProfile: ResolvedResponseProfile
  intent: ReturnType<typeof inferRagQueryIntent>
  pipeline: RagPipeline
}) {
  const contract = { ...params.contract }

  const strategicMode = params.mode === "checklist" || params.mode === "comparison" || params.mode === "resolution"
  const strategicQuestion =
    strategicMode ||
    params.intent.asksForDefenseCriteria ||
    params.intent.asksForOutcome ||
    params.intent.asksForDocumentPriority ||
    params.intent.asksForContextUse

  if (strategicQuestion && contract.minCitations < 3) {
    contract.minCitations = params.responseProfile === "deep" ? 4 : 3
  }

  if (params.pipeline === "factual") {
    contract.minCitations = Math.max(contract.minCitations, 1)
  }

  if (strategicMode && contract.maxBullets == null) {
    contract.maxBullets = params.mode === "resolution" ? 3 : 4
  }

  return contract
}

function entityCoverageStats(entityTokens: string[], evidence: EvidenceChunk[]) {
  const tokenSet = Array.from(new Set(entityTokens.map((x) => normalizeRankingText(x)).filter(Boolean)))
  if (!tokenSet.length || !evidence.length) {
    return {
      matchedChunks: 0,
      snapshotCount: 0,
    }
  }

  let matchedChunks = 0
  const snapshots = new Set<string>()

  for (const row of evidence) {
    const hay = normalizeRankingText(`${row.content || ""} ${row.section || ""}`)
    if (!hay) continue
    const hit = tokenSet.some((token) => hay.includes(token))
    if (!hit) continue
    matchedChunks += 1
    if (row.snapshotId) snapshots.add(String(row.snapshotId))
  }

  return {
    matchedChunks,
    snapshotCount: snapshots.size,
  }
}

function buildNoSpecificPrecedentAnswer(params: { entityTokens: string[] }) {
  const entity = params.entityTokens.length ? params.entityTokens[0] : "la entidad consultada"
  const displayEntity = entity.toUpperCase() === entity ? entity : entity[0].toUpperCase() + entity.slice(1)

  return (
    `No identifico precedentes específicos de ${displayEntity} en las fuentes disponibles del workspace.` +
    "\n\nOrientacion sin respaldo documental especifico:" +
    "\n1. Cargar sentencias/resoluciones donde la entidad figure en caratula o cuerpo principal." +
    "\n2. Cargar piezas del procedimiento sancionatorio (formulacion de cargos, PDC, resolucion sancionatoria)." +
    "\n3. Repetir consulta al terminar indexacion para confirmar precedentes comparables."
  )
}

function applyAnswerContract(params: {
  contract: AnswerContract
  answer: string
  citations: any[]
  evidence: EvidenceChunk[]
}) {
  const contract = params.contract
  let answer = String(params.answer || "").trim()
  let citations = Array.isArray(params.citations) ? [...params.citations] : []
  const adjustments: string[] = []

  const dedupeKey = (cite: any) => {
    const chunk = String(cite?.chunkId || "")
    const quote = normalizeQuoteText(String(cite?.quote || ""))
    return `${chunk}|${quote}`
  }

  citations = Array.from(new Map(citations.map((cite: any) => [dedupeKey(cite), cite])).values())

  if (contract.maxBullets && contract.maxBullets > 0) {
    const bulletCount = countAnswerBullets(answer)
    if (bulletCount === 0 || (contract.maxBullets >= 3 && bulletCount < 2)) {
      const bulletized = bulletizeAnswerText(answer, contract.maxBullets)
      if (bulletized && bulletized !== answer) {
        answer = bulletized
        adjustments.push("answer_bulletized")
      }
    } else if (bulletCount > contract.maxBullets) {
      const bulletLines = String(answer || "")
        .split(/\n+/)
        .map((x) => x.trim())
        .filter((x) => /^([-*]|\d+\.)\s+/.test(x))
        .slice(0, contract.maxBullets)
      if (bulletLines.length) {
        answer = bulletLines.join("\n")
        adjustments.push("answer_bullets_trimmed")
      }
    }
  }

  if (contract.minCitations > 0 && citations.length < contract.minCitations) {
    const existingKeys = new Set(citations.map((cite: any) => dedupeKey(cite)))
    const target = contract.minCitations
    const added: any[] = []

    for (const chunk of params.evidence) {
      if (citations.length + added.length >= target) break
      const quote = safeSentenceQuote(chunk.content, 220)
      if (!quote || quote.length < 12) continue

      const candidate = enrichCitationMetadata({
        chunkId: chunk.chunkId,
        quote,
        paragraph: Math.max(0, countAnswerBullets(answer) - 1),
        sourceUrl: chunk.sourceUrl ?? null,
        snapshotId: chunk.snapshotId ?? null,
        page: chunk.page ?? null,
        section: chunk.section ?? null,
      })

      const key = dedupeKey(candidate)
      if (existingKeys.has(key)) continue
      existingKeys.add(key)
      added.push(candidate)
    }

    if (added.length > 0) {
      citations.push(...added)
      const quoteLines = added.map((cite: any) => `- "${String(cite.quote || "")}"`)
      answer = `${answer}\n\nCitas textuales adicionales:\n${quoteLines.join("\n")}`
      adjustments.push("citations_augmented_from_evidence")
    }
  }

  if (
    contract.requireExplicitNoEvidenceIfMissing &&
    citations.length === 0 &&
    !normalizeRankingText(answer).includes("no identifico") &&
    !normalizeRankingText(answer).includes("no se encuentra")
  ) {
    answer = `No identifico evidencia directa en las fuentes disponibles.\n\n${answer}`
    adjustments.push("explicit_no_evidence_added")
  }

  return {
    answer,
    citations,
    adjustments,
  }
}

function splitQuestionClauses(question: string) {
  const clean = String(question || "").replace(/\s+/g, " ").trim()
  if (!clean) return [] as string[]

  const bySentence = clean
    .split(/(?<=[\.!?;:])\s+/)
    .map((x) => x.trim())
    .filter(Boolean)

  const byConjunction = bySentence.flatMap((sentence) =>
    sentence
      .split(/\b(?:y|e|o|pero|ademas|luego|mientras|donde|cuando)\b/gi)
      .map((x) => x.trim())
      .filter((x) => x.length >= 14)
  )

  return [...bySentence, ...byConjunction]
}

function buildDecompositionQueries(params: {
  question: string
  mode: "extractive" | "comparison" | "checklist" | "resolution"
  difficulty: QuestionDifficulty
}) {
  const base = String(params.question || "").trim()
  if (!base) return [] as string[]

  const roleToken = extractRoleToken(base)
  const clauses = splitQuestionClauses(base)

  const starters = clauses.map((clause) => {
    if (roleToken && !normalizeRankingText(clause).includes(normalizeRankingText(roleToken))) {
      return `${roleToken} ${clause}`
    }
    return clause
  })

  const modeHint =
    params.mode === "comparison"
      ? `${base}. identifica diferencias y coincidencias con citas`
      : params.mode === "checklist"
        ? `${base}. enumera requisitos verificables`
        : params.mode === "resolution"
          ? `${base}. fundamentos y resoluciones citables`
          : ""

  const candidates = [
    ...starters,
    modeHint,
    params.difficulty === "complex" ? `${base}. evidencia principal, antecedentes y excepciones` : "",
  ]

  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of candidates) {
    const clean = String(raw || "").trim()
    if (!clean) continue
    const norm = normalizeRankingText(clean)
    if (!norm || seen.has(norm)) continue
    seen.add(norm)
    out.push(clean)
  }

  const defaultLimit = params.difficulty === "complex" ? 6 : params.mode === "extractive" ? 2 : 4
  const limit = numberEnv("RAG_DECOMPOSITION_MAX_QUERIES", defaultLimit, 1, 12)
  return out.slice(0, limit)
}

function retrievalCoverageScore(question: string, evidence: EvidenceChunk[]) {
  if (!evidence.length) return 0

  const tokens = lexicalTokensForRanking(question).slice(0, 14)
  const sampled = evidence.slice(0, 12)
  const roleToken = normalizeRankingText(extractRoleToken(question))

  const tokenScore =
    tokens.length === 0
      ? 0
      : sampled.reduce((acc, row) => acc + lexicalCoverage(row.content, tokens) / tokens.length, 0) /
        sampled.length

  const roleScore =
    roleToken &&
    sampled.some((row) => {
      const content = normalizeRankingText(row.content)
      const section = normalizeRankingText(row.section || "")
      return content.includes(roleToken) || section.includes(roleToken)
    })
      ? 1
      : 0

  const snapshotCount = new Set(
    sampled.map((row) => String(row.snapshotId || "")).filter(Boolean)
  ).size
  const diversityScore = sampled.length ? Math.min(1, snapshotCount / sampled.length) : 0

  return Math.max(
    0,
    Math.min(1, tokenScore * 0.68 + roleScore * 0.17 + Math.min(0.15, diversityScore * 0.3))
  )
}

function shouldDeepenRetrieval(params: {
  evidenceCount: number
  targetEvidenceCount: number
  coverageScore: number
  difficulty: QuestionDifficulty
  mode: "extractive" | "comparison" | "checklist" | "resolution"
}) {
  const { evidenceCount, targetEvidenceCount, coverageScore, difficulty, mode } = params

  if (evidenceCount < Math.max(8, Math.floor(targetEvidenceCount * 0.66))) return true

  const threshold =
    difficulty === "complex" ? 0.28 : difficulty === "medium" ? 0.22 : mode === "extractive" ? 0.16 : 0.2
  if (coverageScore < threshold) return true

  if ((mode === "comparison" || mode === "checklist" || mode === "resolution") && coverageScore < 0.24) {
    return true
  }

  return false
}

function buildHeuristicContextPack(params: {
  question: string
  evidence: EvidenceChunk[]
  maxOut: number
  mode: "extractive" | "comparison" | "checklist" | "resolution"
  difficulty: QuestionDifficulty
}) {
  const { question, evidence, maxOut, mode, difficulty } = params
  if (!evidence.length) return [] as EvidenceChunk[]

  const tokens = lexicalTokensForRanking(question)
  const roleToken = normalizeRankingText(extractRoleToken(question))
  const perSnapshotCap =
    mode === "extractive"
      ? difficulty === "complex"
        ? 4
        : 3
      : difficulty === "complex"
        ? 5
        : 4

  const ranked = evidence
    .map((row, idx) => {
      const lexical = lexicalCoverage(row.content, tokens)
      const contentNorm = normalizeRankingText(row.content)
      const sectionNorm = normalizeRankingText(row.section || "")
      const roleHit = roleToken && (contentNorm.includes(roleToken) || sectionNorm.includes(roleToken)) ? 1 : 0
      const numbered = /\b\d{1,5}\b/.test(row.content) ? 1 : 0
      const sectionBoost = sectionNorm ? 1 : 0

      const score = lexical * 0.65 + roleHit * 2 + numbered * 0.35 + sectionBoost * 0.15 - idx * 0.002
      return { row, score }
    })
    .sort((a, b) => b.score - a.score)

  const picked: EvidenceChunk[] = []
  const snapshotCounts = new Map<string, number>()
  const seen = new Set<string>()

  for (const entry of ranked) {
    const row = entry.row
    if (seen.has(row.chunkId)) continue

    const key = String(row.snapshotId || `chunk:${row.chunkId}`)
    const count = snapshotCounts.get(key) || 0
    if (count >= perSnapshotCap && picked.length < Math.floor(maxOut * 0.75)) {
      continue
    }

    seen.add(row.chunkId)
    snapshotCounts.set(key, count + 1)
    picked.push(row)
    if (picked.length >= maxOut) break
  }

  if (picked.length < maxOut) {
    for (const entry of ranked) {
      if (seen.has(entry.row.chunkId)) continue
      seen.add(entry.row.chunkId)
      picked.push(entry.row)
      if (picked.length >= maxOut) break
    }
  }

  return picked
}

async function llmRerankEvidence(params: {
  question: string
  evidence: EvidenceChunk[]
  maxOut: number
  mode: "extractive" | "comparison" | "checklist" | "resolution"
  difficulty: QuestionDifficulty
  responseProfile: ResolvedResponseProfile
  intent?: RagQueryIntent | null
  feedbackSignals?: RetrievalFeedbackSignals | null
}) {
  return rerankEvidenceForAnswering(params)
}

function fuseEvidenceSeeds(params: {
  seeds: EvidenceSeed[]
  question: string
  workspaceId: string
  maxOut: number
  perSnapshotCap: number
}) {
  const tokens = lexicalTokensForRanking(params.question)
  const roleToken = normalizeRankingText(extractRoleToken(params.question))

  const byChunk = new Map<
    string,
    {
      chunk: EvidenceChunk
      score: number
      managedHits: number
      localHits: number
      attachedHits: number
      workspaceHits: number
      bestRank: number
    }
  >()

  for (const seed of params.seeds) {
    if (!seed.chunk.chunkId) continue

    const existing = byChunk.get(seed.chunk.chunkId)
    const current =
      existing ||
      {
        chunk: seed.chunk,
        score: 0,
        managedHits: 0,
        localHits: 0,
        attachedHits: 0,
        workspaceHits: 0,
        bestRank: Math.max(1, seed.rank),
      }

    if (!existing) {
      byChunk.set(seed.chunk.chunkId, current)
    }

    const rank = Math.max(1, Number(seed.rank) || 1)
    const rrf = 1 / (55 + rank)
    const originWeight =
      seed.origin === "attached"
        ? 1.9
        : seed.origin === "facts"
          ? 1.7
        : seed.origin === "onboarding"
          ? 1.55
          : seed.origin === "managed"
            ? 1.2
            : 1.0

    current.score += originWeight * rrf
    current.score += Math.max(0, seed.score) * (seed.origin === "managed" ? 0.09 : 0.03)
    current.bestRank = Math.min(current.bestRank, rank)

    if (seed.origin === "managed") current.managedHits += 1
    if (seed.origin === "local") current.localHits += 1
    if (seed.origin === "attached") current.attachedHits += 1
    if (seed.workspaceId && seed.workspaceId === params.workspaceId) current.workspaceHits += 1
  }

  const scored = Array.from(byChunk.values())
    .map((row) => {
      const lexical = lexicalCoverage(row.chunk.content, tokens)
      const section = normalizeRankingText(row.chunk.section || "")
      const roleHit = Boolean(
        roleToken &&
          (normalizeRankingText(row.chunk.content).includes(roleToken) || section.includes(roleToken))
      )

      const overlapBonus = row.managedHits > 0 && row.localHits > 0 ? 0.14 : 0
      const homeWorkspaceBonus = row.workspaceHits > 0 ? 0.09 : 0

      const finalScore =
        row.score +
        Math.min(9, lexical) * 0.05 +
        overlapBonus +
        homeWorkspaceBonus +
        (roleHit ? 0.2 : 0) +
        (row.attachedHits > 0 ? 0.25 : 0)

      return {
        chunk: row.chunk,
        score: finalScore,
      }
    })
    .sort((a, b) => b.score - a.score)

  const capped: EvidenceChunk[] = []
  const snapshotCounts = new Map<string, number>()
  const cap = Math.max(1, Math.min(6, params.perSnapshotCap))

  for (const row of scored) {
    const key = row.chunk.snapshotId || `chunk:${row.chunk.chunkId}`
    const count = snapshotCounts.get(key) || 0
    if (count >= cap) continue
    snapshotCounts.set(key, count + 1)
    capped.push(row.chunk)
    if (capped.length >= params.maxOut) break
  }

  if (capped.length < params.maxOut) {
    const seen = new Set(capped.map((x) => x.chunkId))
    for (const row of scored) {
      if (seen.has(row.chunk.chunkId)) continue
      seen.add(row.chunk.chunkId)
      capped.push(row.chunk)
      if (capped.length >= params.maxOut) break
    }
  }

  return capped
}

async function buildCaseMemoryContext(params: {
  supabase: any
  workspaceId: string
  onboardingReferences?: OnboardingTribunalReference[]
  structuredMemory?: StructuredOnboardingMemory | null
}) {
  const { supabase, workspaceId } = params

  const [profileRes, notesRes] = await Promise.all([
    supabase
      .from("gob_workspace_profiles")
      .select("cause_type,tribunal_role,region,comuna,procedural_status,key_dates,metadata")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    supabase
      .from("gob_notes")
      .select("title,content")
      .eq("workspace_id", workspaceId)
      .or("title.ilike.%marco teorico%,title.ilike.%hechos clave%")
      .order("created_at", { ascending: false })
      .limit(3),
  ])

  const profile = profileRes?.data || null
  const notes = Array.isArray(notesRes?.data) ? notesRes.data : []

  const lines: string[] = []
  if (profile) {
    if (profile.cause_type) lines.push(`tipo_causa: ${profile.cause_type}`)
    if (profile.tribunal_role) lines.push(`rol_tribunal: ${profile.tribunal_role}`)
    if (profile.region || profile.comuna) {
      lines.push(`territorio: ${[profile.region, profile.comuna].filter(Boolean).join(", ")}`)
    }
    if (profile.procedural_status) lines.push(`estado_procedimental: ${profile.procedural_status}`)

    const keyDates = profile.key_dates && typeof profile.key_dates === "object" ? profile.key_dates : null
    if (keyDates) {
      const dateEntries = Object.entries(keyDates)
        .slice(0, 4)
        .map(([k, v]) => `${k}: ${String(v)}`)
      if (dateEntries.length) lines.push(`fechas_clave: ${dateEntries.join(" | ")}`)
    }
  }

  for (const note of notes) {
    const title = String(note?.title || "nota")
    const content = String(note?.content || "").replace(/\s+/g, " ").trim().slice(0, 520)
    if (content) {
      lines.push(`${title}: ${content}`)
    }
  }

  const refs = Array.isArray(params.onboardingReferences) ? params.onboardingReferences : []
  if (refs.length) {
    const refLines = refs
      .slice(0, 6)
      .map((ref) => {
        const parts = [ref.rol, ref.docType || ref.docRole || null, ref.sourceTitle || ref.documentName || null]
          .filter(Boolean)
          .join(" · ")
        return parts
      })
      .filter(Boolean)
    if (refLines.length) {
      lines.push(`documentos_marco_teorico: ${refLines.join(" | ")}`)
    }
  }

  const structuredMemory = params.structuredMemory
  if (structuredMemory) {
    if (structuredMemory.defenseHypothesis) {
      lines.push(`hipotesis_defensa: ${structuredMemory.defenseHypothesis}`)
    }
    if (structuredMemory.defenseCriteria.length) {
      lines.push(`criterios_defensa: ${structuredMemory.defenseCriteria.slice(0, 4).join(" | ")}`)
    }
    if (structuredMemory.outcomeLessons.length) {
      lines.push(`lecciones_resultado: ${structuredMemory.outcomeLessons.slice(0, 3).join(" | ")}`)
    }
    if (structuredMemory.preferredCauses.length) {
      const causes = structuredMemory.preferredCauses
        .slice(0, 4)
        .map((cause) => `${cause.rol || "sin rol"}${cause.defenseSummary ? `: ${cause.defenseSummary}` : ""}`)
      lines.push(`precedentes_prioritarios: ${causes.join(" | ")}`)
    }
    if (structuredMemory.keyDocuments.length) {
      const docs = structuredMemory.keyDocuments
        .slice(0, 4)
        .map((doc) => [doc.rol, doc.docRole, doc.name].filter(Boolean).join(" · "))
        .filter(Boolean)
      if (docs.length) {
        lines.push(`documentos_clave_estructurados: ${docs.join(" | ")}`)
      }
    }
  }

  return lines.slice(0, 8).join("\n")
}

type RecentThreadMemoryMessage = {
  role: string | null
  content: string | null
  citations?: unknown
  usage?: unknown
  createdAt?: string | null
}

async function loadRecentThreadMemoryMessages(params: {
  supabase: any
  workspaceId: string
  threadId: string | null
}) {
  if (!params.threadId) return [] as RecentThreadMemoryMessage[]

  const { data } = await params.supabase
    .from("gob_chat_messages")
    .select("role,content,citations,usage,created_at")
    .eq("workspace_id", params.workspaceId)
    .eq("thread_id", params.threadId)
    .order("created_at", { ascending: false })
    .limit(10)

  return (Array.isArray(data) ? data : [])
    .slice()
    .reverse()
    .map((row: any) => ({
      role: row?.role ? String(row.role) : null,
      content: row?.content ? String(row.content) : null,
      citations: Array.isArray(row?.citations) ? row.citations : [],
      usage: row?.usage ?? null,
      createdAt: row?.created_at ? String(row.created_at) : null,
    }))
}

async function buildStrategicProfileContext(params: {
  admin: any
  question: string
  structuredMemory?: StructuredOnboardingMemory | null
  onboardingReferences?: OnboardingTribunalReference[]
  threadRoleTokens?: string[]
}) {
  const strategicRoleTokens = extractStrategicRoleTokens({
    question: params.question,
    threadRoleTokens: params.threadRoleTokens,
    structuredMemory: params.structuredMemory,
    onboardingReferences: params.onboardingReferences,
  })

  const causeIdByRole = new Map<string, string>()
  for (const row of params.structuredMemory?.preferredCauses || []) {
    const causeId = String(row?.causeId || "").trim()
    const rol = String(row?.rol || "").trim().toUpperCase()
    if (causeId && rol && !causeIdByRole.has(rol)) causeIdByRole.set(rol, causeId)
  }
  for (const row of params.onboardingReferences || []) {
    const causeId = String(row?.causeId || "").trim()
    const rol = String(row?.rol || "").trim().toUpperCase()
    if (causeId && rol && !causeIdByRole.has(rol)) causeIdByRole.set(rol, causeId)
  }

  const causeIds = Array.from(
    new Set(
      strategicRoleTokens
        .map((token) => causeIdByRole.get(token) || "")
        .filter(Boolean)
        .concat(
          (params.structuredMemory?.preferredCauses || [])
            .slice(0, 4)
            .map((row) => String(row?.causeId || ""))
            .filter(Boolean)
        )
    )
  ).slice(0, 6)

  const documentIds = Array.from(
    new Set(
      (params.onboardingReferences || [])
        .map((row) => String(row?.documentId || "").trim())
        .filter(Boolean)
    )
  ).slice(0, 24)

  const [causeRows, documentRows] = causeIds.length
    ? await Promise.all([
        params.admin
          .from("gob_tribunal_causes")
          .select("id,rol,caratula,estado")
          .in("id", causeIds),
        params.admin
          .from("gob_tribunal_documents")
          .select("id,cause_id,document_type,name")
          .in("cause_id", causeIds)
          .limit(400),
      ])
    : [{ data: [], error: null }, { data: [], error: null }]

  const [causeProfilesById, documentProfilesById] = await Promise.all([
    loadOnboardingCauseProfiles(params.admin, causeIds),
    loadOnboardingDocumentProfiles(params.admin, documentIds),
  ])

  const causeProfiles = causeIds
    .map((causeId) => {
      const profile = causeProfilesById.get(causeId)
      if (!profile) return null
      const role =
        (params.structuredMemory?.preferredCauses || []).find((row) => String(row?.causeId || "") === causeId)?.rol ||
        (params.onboardingReferences || []).find((row) => String(row?.causeId || "") === causeId)?.rol ||
        null
      return {
        rol: role ? String(role) : null,
        summary: profile?.summary ? String(profile.summary) : null,
        interestingIf: Array.isArray(profile?.interesting_if) ? profile.interesting_if.map(String) : [],
        riskyIf: Array.isArray(profile?.risky_if) ? profile.risky_if.map(String) : [],
        keySignals: Array.isArray(profile?.key_signals) ? profile.key_signals.map(String) : [],
        recommendedDocRoles: Array.isArray(profile?.recommended_doc_roles)
          ? profile.recommended_doc_roles.map(String)
          : [],
      }
    })
    .filter(Boolean) as Array<{
    rol?: string | null
    summary?: string | null
    interestingIf?: string[] | null
    riskyIf?: string[] | null
    keySignals?: string[] | null
    recommendedDocRoles?: string[] | null
  }>

  const documentProfiles = (params.onboardingReferences || [])
    .slice(0, 10)
    .map((ref) => {
      const documentId = String(ref?.documentId || "").trim()
      if (!documentId) return null
      const profile = documentProfilesById.get(documentId)
      if (!profile) return null
      return {
        rol: ref?.rol ? String(ref.rol) : null,
        docRole: ref?.docRole ? String(ref.docRole) : null,
        name: ref?.documentName ? String(ref.documentName) : ref?.sourceTitle ? String(ref.sourceTitle) : null,
        summary: profile?.summary ? String(profile.summary) : null,
        keyPoints: Array.isArray(profile?.key_points) ? profile.key_points.map(String) : [],
      }
    })
    .filter(Boolean) as Array<{
    rol?: string | null
    docRole?: string | null
    name?: string | null
    summary?: string | null
    keyPoints?: string[] | null
  }>

  const documentCountsByCause = new Map<string, { informe: number; sentencia: number; reclamacion: number }>()
  for (const row of Array.isArray(documentRows?.data) ? documentRows.data : []) {
    const causeId = String((row as any)?.cause_id || "")
    if (!causeId) continue
    const current = documentCountsByCause.get(causeId) || { informe: 0, sentencia: 0, reclamacion: 0 }
    const role = classifyTribunalDocumentRole({
      documentType: (row as any)?.document_type ? String((row as any).document_type) : null,
      name: (row as any)?.name ? String((row as any).name) : null,
      title: (row as any)?.document_type ? String((row as any).document_type) : (row as any)?.name ? String((row as any).name) : null,
    })
    if (role === "informe") current.informe += 1
    if (role === "sentencia") current.sentencia += 1
    if (role === "reclamacion") current.reclamacion += 1
    documentCountsByCause.set(causeId, current)
  }

  const causeInventoryBlock = buildCauseInventoryBlock({
    causes: (Array.isArray(causeRows?.data) ? causeRows.data : []).map((row: any) => ({
      rol: row?.rol ? String(row.rol) : null,
      estado: row?.estado ? String(row.estado) : null,
      caratula: row?.caratula ? String(row.caratula) : null,
      counts: documentCountsByCause.get(String(row?.id || "")) || { informe: 0, sentencia: 0, reclamacion: 0 },
    })),
  })

  return {
    roleTokens: strategicRoleTokens,
    block: [
      causeInventoryBlock,
      buildStrategicProfilesBlock({
        structuredMemory: params.structuredMemory,
        causeProfiles,
        documentProfiles,
      }),
    ]
      .filter(Boolean)
      .join("\n"),
  }
}

async function getCachedLocalEvidence(params: {
  supabase: any
  workspaceIds: string[]
  question: string
  matchCount: number
  textMatchCount: number
  filters?: { docTypes?: string[] } | null
  preferTextOnly?: boolean
  intent?: RagQueryIntent | null
}) {
  return getRuntimeCached({
    namespace: "chat-local-retrieval",
    key: JSON.stringify({
      workspaceIds: params.workspaceIds.slice().sort(),
      question: params.question,
      matchCount: params.matchCount,
      textMatchCount: params.textMatchCount,
      filters: params.filters || null,
      preferTextOnly: Boolean(params.preferTextOnly),
      intent: params.intent
        ? {
            roleToken: params.intent.roleToken,
            preferredDocRoles: params.intent.preferredDocRoles,
            retrievalHints: params.intent.retrievalHints,
            questionType: params.intent.questionType,
          }
        : null,
    }),
    ttlMs: 5 * 60 * 1000,
    loader: async () =>
      retrieveLocalEvidenceForQuestion({
        supabase: params.supabase,
        workspaceIds: params.workspaceIds,
        question: params.question,
        matchCount: params.matchCount,
        minSimilarity: 0.25,
        textMatchCount: params.textMatchCount,
        filters: params.filters,
        preferTextOnly: params.preferTextOnly,
        intent: params.intent,
      }),
  })
}

async function getCachedReferencedEvidence(params: {
  supabase: any
  references: Array<{
    snapshotId: string
    title?: string | null
    docType?: string | null
    docRole?: string | null
    rol?: string | null
  }>
  question: string
  maxOut: number
  perSnapshotCap: number
}) {
  return getRuntimeCached({
    namespace: "chat-reference-retrieval",
    key: JSON.stringify({
      references: params.references.map((ref) => [ref.snapshotId, ref.docRole, ref.rol]),
      question: params.question,
      maxOut: params.maxOut,
      perSnapshotCap: params.perSnapshotCap,
    }),
    ttlMs: 5 * 60 * 1000,
    loader: async () =>
      retrieveReferencedSnapshotEvidence({
        supabase: params.supabase,
        references: params.references,
        question: params.question,
        maxOut: params.maxOut,
        perSnapshotCap: params.perSnapshotCap,
      }),
  })
}

function evidenceSignature(evidence: EvidenceChunk[]) {
  return evidence
    .slice(0, 16)
    .map((row) => `${row.chunkId}:${row.snapshotId || ""}:${row.page ?? ""}`)
    .join("|")
}

async function getCachedStrictAnswer(params: {
  workspaceId: string
  question: string
  generationQuestion: string
  evidence: EvidenceChunk[]
  mode: "extractive" | "comparison" | "checklist" | "resolution"
  responseProfile: ResolvedResponseProfile
  difficulty: QuestionDifficulty
  skipReflection: boolean
}) {
  return getRuntimeCached({
    namespace: "chat-grounded-answer",
    key: JSON.stringify({
      workspaceId: params.workspaceId,
      question: params.question,
      generationQuestion: params.generationQuestion,
      evidence: evidenceSignature(params.evidence),
      mode: params.mode,
      responseProfile: params.responseProfile,
      difficulty: params.difficulty,
      skipReflection: params.skipReflection,
    }),
    ttlMs: 5 * 60 * 1000,
    loader: async () =>
      generateStrictAnswer({
        question: params.generationQuestion,
        evidence: params.evidence,
        mode: params.mode,
        responseProfile: params.responseProfile,
        difficulty: params.difficulty,
        skipReflection: params.skipReflection,
      }),
  })
}

type OnboardingTribunalReference = {
  snapshotId: string
  sourceId: string | null
  sourceTitle: string | null
  docType: string | null
  docRole: string | null
  rol: string | null
  causeId: string | null
  documentId: string | null
  documentName: string | null
  documentUrl: string | null
  sampleQuote: string | null
  sourceUrl: string | null
}

function normalizeOnboardingTribunalReference(value: any): OnboardingTribunalReference | null {
  const snapshotId = String(value?.snapshotId || "").trim()
  if (!snapshotId) return null
  return {
    snapshotId,
    sourceId: value?.sourceId ? String(value.sourceId) : null,
    sourceTitle: value?.sourceTitle ? String(value.sourceTitle) : null,
    docType: value?.docType ? String(value.docType) : null,
    docRole: value?.docRole ? String(value.docRole) : null,
    rol: value?.rol ? String(value.rol) : null,
    causeId: value?.causeId ? String(value.causeId) : null,
    documentId: value?.documentId ? String(value.documentId) : null,
    documentName: value?.documentName ? String(value.documentName) : null,
    documentUrl: value?.documentUrl ? String(value.documentUrl) : null,
    sampleQuote: value?.sampleQuote ? String(value.sampleQuote) : null,
    sourceUrl: value?.sourceUrl ? String(value.sourceUrl) : null,
  }
}

function prioritizeOnboardingReferences(references: OnboardingTribunalReference[]) {
  const rows = (Array.isArray(references) ? references : []).map((ref) => ({
    ...ref,
    id: ref.snapshotId,
    document_type: ref.docType,
    name: ref.documentName || ref.sourceTitle,
    title: ref.sourceTitle || ref.documentName,
  }))

  const prioritized = selectDefenseDocumentMix(rows, {
    preferredRoles: ["informe", "sentencia", "reclamacion"],
    limit: Math.min(8, rows.length || 8),
    requireCorePair: true,
    maxContextReclamaciones: 1,
  }).selected

  const prioritizedIds = new Set(prioritized.map((row: any) => String(row.id || "")))
  return [...prioritized, ...rows.filter((row) => !prioritizedIds.has(String(row.id || "")))]
    .slice(0, 20)
    .map(({ id, document_type, name, title, ...ref }) => ref)
}

async function loadStrategicBundleReferences(params: {
  admin: any
  workspaceId: string
  question: string
  structuredMemory?: StructuredOnboardingMemory | null
  onboardingReferences?: OnboardingTribunalReference[]
  roleTokens?: string[]
  preferredDocRoles?: string[]
}) {
  return getRuntimeCached({
    namespace: "strategic-bundles",
    key: JSON.stringify({
      workspaceId: params.workspaceId,
      question: params.question,
      roleTokens: params.roleTokens || [],
      preferredDocRoles: params.preferredDocRoles || [],
      preferredCauses: (params.structuredMemory?.preferredCauses || []).slice(0, 6).map((row) => [row?.causeId, row?.rol]),
    }),
    ttlMs: 5 * 60 * 1000,
    loader: async () => {
      const preferredCauseIds = Array.from(
        new Set(
          [
            ...(params.structuredMemory?.preferredCauses || [])
              .slice(0, 6)
              .map((row) => String(row?.causeId || "").trim())
              .filter(Boolean),
            ...(params.onboardingReferences || [])
              .filter((row) => String(row?.rol || "") && (params.roleTokens || []).includes(String(row?.rol || "").toUpperCase()))
              .map((row) => String(row?.causeId || "").trim())
              .filter(Boolean),
          ].filter(Boolean)
        )
      ).slice(0, 8)

      const roleTokens = Array.from(
        new Set(
          (Array.isArray(params.roleTokens) ? params.roleTokens : [])
            .map((item) => String(item || "").toUpperCase())
            .filter(Boolean)
        )
      ).slice(0, 8)

      if (!preferredCauseIds.length && !roleTokens.length) {
        return [] as Array<{ snapshotId: string; title?: string | null; docType?: string | null; docRole?: string | null; rol?: string | null }>
      }

      const preferredRoles = Array.from(
        new Set(
          [
            ...(Array.isArray(params.preferredDocRoles) ? params.preferredDocRoles : []),
            "informe",
            "sentencia",
          ]
            .map((item) => String(item || "").trim().toLowerCase())
            .filter(Boolean)
        )
      )
      const roleRank = (role: string | null) => {
        const normalized = String(role || "").trim().toLowerCase()
        const idx = preferredRoles.indexOf(normalized)
        return idx >= 0 ? idx : 9
      }
      const causeRank = (causeId: string | null, rol: string | null) => {
        const byId = preferredCauseIds.indexOf(String(causeId || ""))
        if (byId >= 0) return byId
        const byRol = roleTokens.indexOf(String(rol || "").toUpperCase())
        return byRol >= 0 ? byRol : 9
      }

      const { data: corpusSources } = await params.admin
        .from("gob_sources")
        .select("id,title,doc_type,attributes,url")
        .eq("source_origin", "tribunal-corpus")
        .limit(5000)

      const matchingSources = (corpusSources || [])
        .filter((row: any) => {
          const attrs = row?.attributes && typeof row.attributes === "object" ? row.attributes : {}
          const causeId = String(attrs?.tribunal_cause_id || "")
          const rol = String(attrs?.rol || "").toUpperCase()
          if (!preferredCauseIds.includes(causeId) && !roleTokens.includes(rol)) return false
          const docRole = attrs?.doc_role
            ? String(attrs.doc_role)
            : classifyTribunalDocumentRole({
                documentType: row?.doc_type ? String(row.doc_type) : null,
                name: row?.title ? String(row.title) : null,
                title: row?.doc_type ? String(row.doc_type) : row?.title ? String(row.title) : null,
              })
          return preferredRoles.includes(String(docRole || "").toLowerCase())
        })
        .sort((a: any, b: any) => {
          const attrsA = a?.attributes && typeof a.attributes === "object" ? a.attributes : {}
          const attrsB = b?.attributes && typeof b.attributes === "object" ? b.attributes : {}
          const diffCause =
            causeRank(String(attrsA?.tribunal_cause_id || ""), String(attrsA?.rol || "")) -
            causeRank(String(attrsB?.tribunal_cause_id || ""), String(attrsB?.rol || ""))
          if (diffCause !== 0) return diffCause
          const diffRole = roleRank(String(attrsA?.doc_role || "")) - roleRank(String(attrsB?.doc_role || ""))
          if (diffRole !== 0) return diffRole
          return String(a?.title || "").localeCompare(String(b?.title || ""))
        })
        .slice(0, 24)

      if (!matchingSources.length) {
        return [] as Array<{ snapshotId: string; title?: string | null; docType?: string | null; docRole?: string | null; rol?: string | null }>
      }

      const sourceIds = matchingSources.map((row: any) => String(row.id)).filter(Boolean)
      const { data: snapshots } = await params.admin
        .from("gob_source_snapshots")
        .select("id,source_id,status")
        .in("source_id", sourceIds)
        .eq("status", "ready")
        .order("created_at", { ascending: false })

      const snapshotBySourceId = new Map<string, string>()
      for (const row of snapshots || []) {
        const sourceId = String((row as any)?.source_id || "")
        if (sourceId && !snapshotBySourceId.has(sourceId)) {
          snapshotBySourceId.set(sourceId, String((row as any)?.id || ""))
        }
      }

      return matchingSources
        .map((source: any) => {
          const snapshotId = snapshotBySourceId.get(String(source.id)) || ""
          if (!snapshotId) return null
          const attrs = source?.attributes && typeof source.attributes === "object" ? source.attributes : {}
          return {
            snapshotId,
            title: source?.title ? String(source.title) : null,
            docType: source?.doc_type ? String(source.doc_type) : null,
            docRole: attrs?.doc_role ? String(attrs.doc_role) : null,
            rol: attrs?.rol ? String(attrs.rol) : null,
          }
        })
        .filter(Boolean)
        .slice(0, 12) as Array<{ snapshotId: string; title?: string | null; docType?: string | null; docRole?: string | null; rol?: string | null }>
    },
  })
}

async function loadOnboardingTribunalReferences(params: {
  supabase: any
  admin: any
  workspaceId: string
  persistedArtifacts?: PersistedOnboardingArtifacts | null
}) {
  const { supabase, admin, workspaceId } = params
  const refsBySnapshot = new Map<string, OnboardingTribunalReference>()

  const persistedRefs = Array.isArray(params.persistedArtifacts?.tribunalReferences)
    ? params.persistedArtifacts!.tribunalReferences
    : []

  for (const rawRef of persistedRefs) {
    const normalized = normalizeOnboardingTribunalReference(rawRef)
    if (!normalized) continue
    refsBySnapshot.set(normalized.snapshotId, normalized)
  }

  const { data: profile } = await supabase
    .from("gob_workspace_profiles")
    .select("metadata")
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  const metadata = profile?.metadata && typeof profile.metadata === "object" && !Array.isArray(profile.metadata)
    ? profile.metadata
    : {}
  const onboarding = metadata?.onboarding && typeof metadata.onboarding === "object" ? metadata.onboarding : {}
  const rawRefs = Array.isArray((onboarding as any)?.tribunal_references) ? (onboarding as any).tribunal_references : []

  for (const rawRef of rawRefs) {
    const normalized = normalizeOnboardingTribunalReference(rawRef)
    if (!normalized) continue
    refsBySnapshot.set(normalized.snapshotId, normalized)
  }

  const { data: notes } = await supabase
    .from("gob_notes")
    .select("title,content,citations")
    .eq("workspace_id", workspaceId)
    .or("title.eq.Marco teorico inicial,title.eq.Borrador inicial de informe (auto)")
    .order("created_at", { ascending: false })
    .limit(4)

  const roleTokens = new Set<string>()

  for (const note of Array.isArray(notes) ? notes : []) {
    const content = String((note as any)?.content || "")
    for (const match of content.matchAll(/\bR-\d{1,5}-\d{4}\b/gi)) {
      const rol = String(match[0] || "").toUpperCase()
      if (rol) roleTokens.add(rol)
    }

    const citations = Array.isArray((note as any)?.citations) ? (note as any).citations : []
    for (const citation of citations) {
      const snapshotId = String(citation?.snapshotId || "").trim()
      if (!snapshotId) continue
      const existing = refsBySnapshot.get(snapshotId)
      refsBySnapshot.set(snapshotId, {
        snapshotId,
        sourceId: existing?.sourceId || null,
        sourceTitle: existing?.sourceTitle || null,
        docType: existing?.docType || null,
        docRole: existing?.docRole || null,
        rol: existing?.rol || null,
        causeId: existing?.causeId || null,
        documentId: existing?.documentId || null,
        documentName: existing?.documentName || null,
        documentUrl: existing?.documentUrl || null,
        sampleQuote: existing?.sampleQuote || (citation?.quote ? String(citation.quote) : null),
        sourceUrl: existing?.sourceUrl || (citation?.sourceUrl ? String(citation.sourceUrl) : null),
      })
    }
  }

  if (roleTokens.size > 0) {
    const { data: corpusSources } = await admin
      .from("gob_sources")
      .select("id,title,doc_type,attributes,url")
      .eq("source_origin", "tribunal-corpus")
      .limit(4000)

    const matchedRoleSources = (corpusSources || [])
      .filter((row: any) => {
        const attrs = row?.attributes && typeof row.attributes === "object" ? row.attributes : {}
        const rol = String(attrs?.rol || "").toUpperCase()
        return roleTokens.has(rol)
      })
      .sort((a: any, b: any) => {
        const attrsA = a?.attributes && typeof a.attributes === "object" ? a.attributes : {}
        const attrsB = b?.attributes && typeof b.attributes === "object" ? b.attributes : {}
        const rank = (role: string) =>
          role === "informe" ? 0 : role === "sentencia" ? 1 : role === "reclamacion" ? 2 : 9
        const diff = rank(String(attrsA?.doc_role || "")) - rank(String(attrsB?.doc_role || ""))
        if (diff !== 0) return diff
        return String(a?.title || "").localeCompare(String(b?.title || ""))
      })

    const roleSourceIds = matchedRoleSources.map((row: any) => String(row.id)).filter(Boolean)
    if (roleSourceIds.length) {
      const { data: roleSnapshots } = await admin
        .from("gob_source_snapshots")
        .select("id,source_id,status")
        .in("source_id", roleSourceIds)
        .eq("status", "ready")
        .order("created_at", { ascending: false })

      const snapshotBySourceId = new Map<string, string>()
      for (const row of roleSnapshots || []) {
        const sourceId = String((row as any)?.source_id || "")
        if (sourceId && !snapshotBySourceId.has(sourceId)) {
          snapshotBySourceId.set(sourceId, String((row as any)?.id || ""))
        }
      }

      for (const source of matchedRoleSources) {
        const snapshotId = snapshotBySourceId.get(String(source.id)) || ""
        if (!snapshotId || refsBySnapshot.has(snapshotId)) continue
        const attrs = source?.attributes && typeof source.attributes === "object" ? source.attributes : {}
        refsBySnapshot.set(snapshotId, {
          snapshotId,
          sourceId: String(source.id),
          sourceTitle: source?.title ? String(source.title) : null,
          docType: source?.doc_type ? String(source.doc_type) : null,
          docRole: attrs?.doc_role ? String(attrs.doc_role) : null,
          rol: attrs?.rol ? String(attrs.rol) : null,
          causeId: attrs?.tribunal_cause_id ? String(attrs.tribunal_cause_id) : null,
          documentId: attrs?.tribunal_document_id ? String(attrs.tribunal_document_id) : null,
          documentName: source?.title ? String(source.title) : null,
          documentUrl: source?.url ? String(source.url) : null,
          sampleQuote: null,
          sourceUrl: null,
        })
      }
    }
  }

  const snapshotIds = Array.from(refsBySnapshot.keys()).slice(0, 20)
  if (!snapshotIds.length) return [] as OnboardingTribunalReference[]

  const { data: snapshots, error: snapshotErr } = await admin
    .from("gob_source_snapshots")
    .select("id,source_id")
    .in("id", snapshotIds)

  if (snapshotErr) {
    return prioritizeOnboardingReferences(Array.from(refsBySnapshot.values()))
  }

  const sourceIds = Array.from(
    new Set((snapshots || []).map((row: any) => String(row?.source_id || "")).filter(Boolean))
  )

  const sourceById = new Map<string, any>()
  if (sourceIds.length) {
    const { data: sources } = await admin
      .from("gob_sources")
      .select("id,title,doc_type,attributes,url")
      .in("id", sourceIds)

    for (const row of sources || []) {
      sourceById.set(String((row as any)?.id || ""), row)
    }
  }

  for (const row of snapshots || []) {
    const snapshotId = String((row as any)?.id || "")
    const sourceId = String((row as any)?.source_id || "")
    const source = sourceById.get(sourceId)
    const attrs = source?.attributes && typeof source.attributes === "object" ? source.attributes : {}
    const existing = refsBySnapshot.get(snapshotId)
    refsBySnapshot.set(snapshotId, {
      snapshotId,
      sourceId: sourceId || existing?.sourceId || null,
      sourceTitle: source?.title ? String(source.title) : existing?.sourceTitle || null,
      docType: source?.doc_type ? String(source.doc_type) : existing?.docType || null,
      docRole: attrs?.doc_role ? String(attrs.doc_role) : existing?.docRole || null,
      rol: attrs?.rol ? String(attrs.rol) : existing?.rol || null,
      causeId: attrs?.tribunal_cause_id ? String(attrs.tribunal_cause_id) : existing?.causeId || null,
      documentId: attrs?.tribunal_document_id ? String(attrs.tribunal_document_id) : existing?.documentId || null,
      documentName: existing?.documentName || (source?.title ? String(source.title) : null),
      documentUrl: existing?.documentUrl || (source?.url ? String(source.url) : null),
      sampleQuote: existing?.sampleQuote || null,
      sourceUrl: existing?.sourceUrl || null,
    })
  }

  return prioritizeOnboardingReferences(Array.from(refsBySnapshot.values()))
}

async function loadStructuredOnboardingMemory(params: {
  supabase: any
  workspaceId: string
  onboardingReferences?: OnboardingTribunalReference[]
  persistedArtifacts?: PersistedOnboardingArtifacts | null
}) {
  const { data: profile } = await params.supabase
    .from("gob_workspace_profiles")
    .select("metadata")
    .eq("workspace_id", params.workspaceId)
    .maybeSingle()

  const { data: notes } = await params.supabase
    .from("gob_notes")
    .select("title,content")
    .eq("workspace_id", params.workspaceId)
    .or("title.ilike.%marco teorico%,title.ilike.%informe automatico de marco teorico%")
    .order("created_at", { ascending: false })
    .limit(4)

  return buildStructuredOnboardingMemoryFromArtifacts({
    metadataMemory:
      params.persistedArtifacts?.structuredMemory || extractStructuredOnboardingMemoryFromMetadata(profile?.metadata),
    notes: Array.isArray(notes) ? notes : [],
    tribunalReferences: Array.isArray(params.onboardingReferences) ? params.onboardingReferences : [],
  })
}

function usageTotalTokens(usage: any): number | null {
  if (!usage || typeof usage !== "object") return null
  const direct = (usage as any).total_tokens
  if (typeof direct === "number" && Number.isFinite(direct)) return Math.floor(direct)
  const nested = (usage as any).totalTokens
  if (typeof nested === "number" && Number.isFinite(nested)) return Math.floor(nested)
  return null
}

function usagePromptTokens(usage: any): number | null {
  if (!usage || typeof usage !== "object") return null
  const direct = (usage as any).prompt_tokens
  if (typeof direct === "number" && Number.isFinite(direct)) return Math.floor(direct)
  const nested = (usage as any).promptTokens
  if (typeof nested === "number" && Number.isFinite(nested)) return Math.floor(nested)
  const alt = (usage as any).input_tokens ?? (usage as any).inputTokens
  if (typeof alt === "number" && Number.isFinite(alt)) return Math.floor(alt)
  return null
}

function usageCompletionTokens(usage: any): number | null {
  if (!usage || typeof usage !== "object") return null
  const direct = (usage as any).completion_tokens
  if (typeof direct === "number" && Number.isFinite(direct)) return Math.floor(direct)
  const nested = (usage as any).completionTokens
  if (typeof nested === "number" && Number.isFinite(nested)) return Math.floor(nested)
  const alt = (usage as any).output_tokens ?? (usage as any).outputTokens
  if (typeof alt === "number" && Number.isFinite(alt)) return Math.floor(alt)
  return null
}

function normalizeQuoteText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function safeSentenceQuote(text: string, max = 220) {
  const clean = String(text || "").replace(/\s+/g, " ").trim()
  if (!clean) return ""
  const first = clean.split(/(?<=[\.!?;])\s+/).find((s) => s.trim().length >= 16)
  const chosen = first || clean
  return chosen.length > max ? `${chosen.slice(0, max)}...` : chosen
}

type AttachmentReviewItem = {
  severity: "critical" | "major" | "minor"
  finding: string
  recommendation: string
  chunkId: string
  quote: string
}

type GeneralRescuePoint = {
  point: string
  chunkId: string
  quote: string
}

async function generateAttachedReviewRescue(params: {
  question: string
  evidence: EvidenceChunk[]
}) {
  const shortlisted = params.evidence.slice(0, 10)
  const byChunkId = new Map(shortlisted.map((row) => [row.chunkId, row]))

  const evidenceBlock = shortlisted
    .map((row, index) => {
      const loc = [
        row.sourceUrl ? `url=${row.sourceUrl}` : null,
        row.snapshotId ? `snapshot=${row.snapshotId}` : null,
        typeof row.page === "number" ? `page=${row.page}` : null,
        row.section ? `section=${row.section}` : null,
      ]
        .filter(Boolean)
        .join(", ")
      const locSuffix = loc ? ` (${loc})` : ""
      const content = row.content.length > 900 ? `${row.content.slice(0, 900)}...` : row.content
      return `EVIDENCE ${index + 1}: chunkId=${row.chunkId}${locSuffix}\n${content}`
    })
    .join("\n\n---\n\n")

  const schema = {
    type: "object",
    properties: {
      summary: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            severity: {
              type: "string",
              enum: ["critical", "major", "minor"],
            },
            finding: { type: "string" },
            recommendation: { type: "string" },
            chunkId: { type: "string" },
            quote: { type: "string" },
          },
          required: ["severity", "finding", "recommendation", "chunkId", "quote"],
          additionalProperties: false,
        },
      },
    },
    required: ["summary", "items"],
    additionalProperties: false,
  } as const

  let model: string | null = null
  let usage: any = null
  let rawItems: any[] = []
  let summary = ""

  try {
    const generated = await generateOpenAIJson({
      system:
        "Eres un revisor profesional de escritos juridicos. Debes responder SOLO con evidencia del bloque EVIDENCE y citas literales.",
      prompt:
        `Pregunta del usuario:\n${params.question}\n\n` +
        `EVIDENCE:\n\n${evidenceBlock}\n\n` +
        "Instrucciones:\n" +
        "- Devuelve entre 3 y 6 items concretos.\n" +
        "- Cada item debe incluir chunkId valido y quote literal exacta desde ese chunk.\n" +
        "- recommendation debe ser accionable y breve.\n" +
        "- No inventes hechos ni normas.\n",
      schemaName: "chat_attachment_review_rescue",
      schema,
      maxCompletionTokens: 1200,
      reasoningEffort: "minimal",
      model: resolveOpenAIRescueModel(),
    })

    model = generated.model
    usage = generated.usage
    summary = String((generated.output as any)?.summary || "").trim()
    rawItems = Array.isArray((generated.output as any)?.items) ? (generated.output as any).items : []
  } catch {
    // fallback deterministic below
  }

  const verified: AttachmentReviewItem[] = rawItems
    .map((item: any) => {
      const chunkId = String(item?.chunkId || "").trim()
      const quote = String(item?.quote || "").trim()
      const finding = String(item?.finding || "").trim()
      const recommendation = String(item?.recommendation || "").trim()
      const severityRaw = String(item?.severity || "minor").trim().toLowerCase()
      const severity: "critical" | "major" | "minor" =
        severityRaw === "critical" || severityRaw === "major" ? severityRaw : "minor"

      const chunk = byChunkId.get(chunkId)
      if (!chunk) return null
      if (!quote || quote.length < 12) return null
      const hay = normalizeQuoteText(chunk.content)
      const needle = normalizeQuoteText(quote)
      if (!needle || !hay.includes(needle)) return null

      return {
        severity,
        finding: finding || "Observacion relevante detectada en el documento.",
        recommendation:
          recommendation || "Ajusta este punto en el escrito para mejorar su sustento.",
        chunkId,
        quote,
      }
    })
    .filter((item): item is AttachmentReviewItem => Boolean(item))
    .slice(0, 6)

  if (!verified.length) {
    const fallback = shortlisted
      .slice(0, 3)
      .map((chunk, idx) => {
        const quote = safeSentenceQuote(chunk.content, 220)
        if (!quote || quote.length < 12) return null
        const severity: AttachmentReviewItem["severity"] = idx === 0 ? "major" : "minor"
        return {
          severity,
          finding:
            idx === 0
              ? "Punto con carga argumental que conviene reforzar con evidencia y precision tecnica."
              : "Fragmento relevante a revisar por claridad y sustento.",
          recommendation:
            idx === 0
              ? "Explicita mejor la premisa, su evidencia y el efecto juridico esperado."
              : "Reescribe este tramo con afirmaciones verificables y formula mas directa.",
          chunkId: chunk.chunkId,
          quote,
        }
      })
      .filter(Boolean) as AttachmentReviewItem[]

    return {
      summary:
        summary ||
        "Se detecto contenido util en el adjunto. Entrego observaciones iniciales para una revision profesional rapida.",
      items: fallback,
      model,
      usage,
    }
  }

  return {
    summary: summary || "Revision inicial del documento adjunto con observaciones priorizadas.",
    items: verified,
    model,
    usage,
  }
}

async function generateGeneralAnswerRescue(params: {
  question: string
  evidence: EvidenceChunk[]
}) {
  const shortlisted = params.evidence.slice(0, 12)
  const byChunkId = new Map(shortlisted.map((row) => [row.chunkId, row]))

  const evidenceBlock = shortlisted
    .map((row, index) => {
      const loc = [
        row.sourceUrl ? `url=${row.sourceUrl}` : null,
        row.snapshotId ? `snapshot=${row.snapshotId}` : null,
        typeof row.page === "number" ? `page=${row.page}` : null,
        row.section ? `section=${row.section}` : null,
      ]
        .filter(Boolean)
        .join(", ")
      const locSuffix = loc ? ` (${loc})` : ""
      const content = row.content.length > 900 ? `${row.content.slice(0, 900)}...` : row.content
      return `EVIDENCE ${index + 1}: chunkId=${row.chunkId}${locSuffix}\n${content}`
    })
    .join("\n\n---\n\n")

  const schema = {
    type: "object",
    properties: {
      summary: { type: "string" },
      points: {
        type: "array",
        items: {
          type: "object",
          properties: {
            point: { type: "string" },
            chunkId: { type: "string" },
            quote: { type: "string" },
          },
          required: ["point", "chunkId", "quote"],
          additionalProperties: false,
        },
      },
    },
    required: ["summary", "points"],
    additionalProperties: false,
  } as const

  let model: string | null = null
  let usage: any = null
  let summary = ""
  let rawPoints: any[] = []

  try {
    const generated = await generateOpenAIJson({
      system:
        "Eres un asistente juridico-documental. Responde solo con evidencia del bloque EVIDENCE. No inventes hechos.",
      prompt:
        `Pregunta del usuario:\n${params.question}\n\n` +
        `EVIDENCE:\n\n${evidenceBlock}\n\n` +
        "Instrucciones:\n" +
        "- Entrega entre 2 y 5 puntos concretos que respondan la pregunta.\n" +
        "- Cada punto debe incluir chunkId valido y quote literal exacta.\n" +
        "- Si la evidencia es limitada, dilo en summary pero igual entrega lo mas util posible.\n",
      schemaName: "chat_general_rescue_answer",
      schema,
      maxCompletionTokens: 900,
      reasoningEffort: "minimal",
      model: resolveOpenAIRescueModel(),
    })

    model = generated.model
    usage = generated.usage
    summary = String((generated.output as any)?.summary || "").trim()
    rawPoints = Array.isArray((generated.output as any)?.points) ? (generated.output as any).points : []
  } catch {
    // fallback deterministic below
  }

  const verified: GeneralRescuePoint[] = rawPoints
    .map((item: any) => {
      const chunkId = String(item?.chunkId || "").trim()
      const quote = String(item?.quote || "").trim()
      const point = String(item?.point || "").trim()

      const chunk = byChunkId.get(chunkId)
      if (!chunk) return null
      if (!quote || quote.length < 12) return null

      const hay = normalizeQuoteText(chunk.content)
      const needle = normalizeQuoteText(quote)
      if (!needle || !hay.includes(needle)) return null

      return {
        point: point || "Hallazgo relevante con base en evidencia disponible.",
        chunkId,
        quote,
      }
    })
    .filter((item): item is GeneralRescuePoint => Boolean(item))
    .slice(0, 5)

  if (!verified.length) {
    const fallback = shortlisted
      .slice(0, 3)
      .map((chunk) => {
        const quote = safeSentenceQuote(chunk.content, 220)
        if (!quote || quote.length < 12) return null
        return {
          point: "Se identifica evidencia relacionada que puede apoyar la respuesta, pero requiere validacion final humana.",
          chunkId: chunk.chunkId,
          quote,
        } satisfies GeneralRescuePoint
      })
      .filter((item): item is GeneralRescuePoint => Boolean(item))

    return {
      summary:
        summary ||
        "Encontré evidencia parcial para esta consulta. Te comparto los puntos más útiles y citables disponibles.",
      points: fallback,
      model,
      usage,
    }
  }

  return {
    summary:
      summary ||
      "Encontré evidencia útil para responder tu consulta. Te dejo los puntos clave con citas verificables.",
    points: verified,
    model,
    usage,
  }
}

async function generateNoEvidenceHybridAnswer(params: { question: string }) {
  try {
    const generated = await generateOpenAIJson({
      system:
        "Eres un asistente juridico experto. No hay evidencia documental disponible en este momento. Debes ayudar de forma util pero dejando claro que es orientacion sin respaldo documental.",
      prompt:
        `Consulta del usuario:\n${params.question}\n\n` +
        "Instrucciones:\n" +
        "- Responde en 3 a 6 lineas, de forma practica.\n" +
        "- Incluye un encabezado breve: 'Orientacion sin respaldo documental'.\n" +
        "- No inventes hechos del caso.\n",
      schemaName: "chat_no_evidence_guidance",
      schema: {
        type: "object",
        properties: {
          answer: { type: "string" },
        },
        required: ["answer"],
        additionalProperties: false,
      } as const,
      maxCompletionTokens: 420,
      reasoningEffort: "minimal",
      model: resolveOpenAIRescueModel(),
    })

    return {
      answer: String((generated.output as any)?.answer || "").trim(),
      model: generated.model,
      usage: generated.usage,
    }
  } catch {
    return {
      answer:
        "Orientacion sin respaldo documental:\nNo encuentro fuentes indexadas para sustentar una respuesta con citas. Si quieres, te ayudo con estructura y checklist de defensa mientras cargas fuentes o esperas procesamiento.",
      model: null,
      usage: null,
    }
  }
}

async function generateEvidenceRescueAnswer(params: {
  question: string
  evidence: EvidenceChunk[]
  attachedSourceId: string | null
}) {
  const evidenceById = new Map(params.evidence.map((item) => [item.chunkId, item]))

  if (params.attachedSourceId) {
    const rescued = await generateAttachedReviewRescue({
      question: params.question,
      evidence: params.evidence,
    })

    if (Array.isArray(rescued.items) && rescued.items.length > 0) {
      const severityLabel = (severity: "critical" | "major" | "minor") => {
        if (severity === "critical") return "CRITICO"
        if (severity === "major") return "MAYOR"
        return "MENOR"
      }

      return {
        applied: true,
        kind: "attached_review" as const,
        answer:
          `${rescued.summary}\n\n` +
          rescued.items
            .map(
              (item, idx) =>
                `${idx + 1}. [${severityLabel(item.severity)}] ${item.finding}\nRecomendacion: ${item.recommendation}`
            )
            .join("\n\n"),
        citations: rescued.items.map((item, idx) => {
          const meta = evidenceById.get(item.chunkId)
          return enrichCitationMetadata({
            chunkId: item.chunkId,
            quote: item.quote,
            paragraph: idx,
            sourceUrl: meta?.sourceUrl ?? null,
            snapshotId: meta?.snapshotId ?? null,
            page: meta?.page ?? null,
            section: meta?.section ?? null,
          })
        }),
        model: rescued.model ?? null,
        usage: rescued.usage ?? null,
      }
    }
  }

  const rescued = await generateGeneralAnswerRescue({
    question: params.question,
    evidence: params.evidence,
  })

  return {
    applied: Array.isArray(rescued.points) && rescued.points.length > 0,
    kind: "general_evidence" as const,
    answer:
      `${rescued.summary}\n\n` +
      rescued.points.map((item, idx) => `${idx + 1}. ${item.point}`).join("\n\n"),
    citations: rescued.points.map((item, idx) => {
      const meta = evidenceById.get(item.chunkId)
      return enrichCitationMetadata({
        chunkId: item.chunkId,
        quote: item.quote,
        paragraph: idx,
        sourceUrl: meta?.sourceUrl ?? null,
        snapshotId: meta?.snapshotId ?? null,
        page: meta?.page ?? null,
        section: meta?.section ?? null,
      })
    }),
    model: rescued.model ?? null,
    usage: rescued.usage ?? null,
  }
}

function applyDefenseIntentOverrides(params: {
  text: string
  question: string
  intent: ReturnType<typeof inferRagQueryIntent>
  roleCounts: Record<string, number>
  defenseCoverageStatus: string
  structuredMemory?: StructuredOnboardingMemory | null
}) {
  let text = String(params.text || "").trim()
  const adjustments: string[] = []
  let clearCitations = false
  const normalizedQuestion = normalizeIntentText(params.question)
  const normalizedText = normalizeIntentText(text)

  if (params.intent.asksForContextUse && normalizedQuestion.includes("marco teorico")) {
    const opening =
      params.defenseCoverageStatus === "ready"
        ? "En el marco teorico, la reclamacion debe usarse como contexto, no como prueba principal."
        : "En el marco teorico, la recomendacion operativa es usar la reclamacion como contexto, no como prueba principal; la evidencia recuperada para esta respuesta sigue siendo parcial y conviene verificarla contra informe y sentencia antes de cerrar el escrito."
    if (!text.startsWith(opening)) {
      text = `${opening}\n\n${text}`.trim()
      adjustments.push("defense_context_override")
    }
  }

  if (params.intent.asksForDocumentPriority && normalizedQuestion.includes("marco teorico")) {
    const hasInforme = Number(params.roleCounts.informe || 0) > 0
    const hasSentencia = Number(params.roleCounts.sentencia || 0) > 0
    let opening = ""

    if (hasInforme && hasSentencia) {
      opening = "Orden recomendado para la defensa: 1) informe, 2) sentencia, 3) reclamacion solo como contexto."
    } else if (hasInforme) {
      opening =
        "Orden recomendado con la evidencia recuperada: 1) informe; aun falta una sentencia mas directa para cerrar el segundo lugar con plena seguridad."
    } else if (hasSentencia) {
      opening =
        "Orden recomendado con la evidencia recuperada: la sentencia ya aporta utilidad, pero aun falta un informe mas directo para fundamentar la defensa tecnica."
    }

    if (
      opening &&
      (!normalizedText.includes("informe") ||
        !normalizedText.includes("sentencia"))
    ) {
      text = `${opening}\n\n${text}`.trim()
      adjustments.push("defense_priority_override")
    }
  }

  if (normalizedQuestion.includes("precedente") && normalizedQuestion.includes("mas util")) {
    const preferredCause = params.structuredMemory?.preferredCauses?.[0] || null
    const preferredRole = preferredCause?.rol ? String(preferredCause.rol) : null
    const opening = preferredRole
      ? `El precedente mas util para mantener criterios consistentes del SEA es ${preferredRole}.`
      : "El precedente mas util para mantener criterios consistentes del SEA debe elegirse por su capacidad de sostener una linea tecnica y juridica coherente del SEA."
    if (!text.startsWith(opening)) {
      text = `${opening}\n\n${text}`.trim()
      adjustments.push("defense_precedent_override")
    }
  }

  if (
    normalizedQuestion.includes("riesgo") &&
    (normalizedQuestion.includes("precedente") || normalizedQuestion.includes("sentencia"))
  ) {
    const memoryRisk = Array.isArray(params.structuredMemory?.outcomeLessons)
      ? params.structuredMemory!.outcomeLessons.find((item) => {
          const normalizedItem = normalizeIntentText(item)
          return (
            normalizedItem.includes("precedente") ||
            normalizedItem.includes("ratio decidendi") ||
            normalizedItem.includes("sobregeneralizacion") ||
            normalizedItem.includes("comparable")
          )
        })
      : null

    const riskLine = [
      "Riesgo principal: extrapolar un precedente o una sentencia favorable fuera de su contexto factico, normativo y procesal.",
      memoryRisk ? `Cautela adicional: ${memoryRisk}` : "",
    ]
      .filter(Boolean)
      .join(" ")

    if (!normalizedText.includes("precedente") || !normalizedText.includes("riesgo")) {
      text = `${riskLine}\n\n${text}`.trim()
      adjustments.push("defense_risk_override")
    }
  }

  if (
    params.intent.asksForDefenseCriteria &&
    normalizedQuestion.includes("defensa") &&
    normalizedQuestion.includes("sea")
  ) {
    const criteriaLine =
      "Criterio util para la defensa del SEA: priorizar criterios tecnicos y de evaluacion ambiental que aparezcan en informes y documentos evacuados, y usar esos criterios como base de la respuesta."
    if (!normalizedText.includes("sea") || !normalizedText.includes("criterio")) {
      text = `${criteriaLine}\n\n${text}`.trim()
      adjustments.push("defense_criteria_override")
    }
  }

  if (
    normalizedQuestion.includes("lineas de defensa") ||
    normalizedQuestion.includes("dos lineas") ||
    normalizedQuestion.includes("2 lineas")
  ) {
    if (!normalizedText.includes("defensa")) {
      text = `Lineas de defensa prioritarias:\n${text}`.trim()
      adjustments.push("defense_lines_prefix")
    }

    if (countAnswerBullets(text) < 2) {
      const bulletized = bulletizeAnswerText(text, 2)
      if (bulletized && bulletized !== text) {
        text = `Lineas de defensa prioritarias:\n${bulletized.replace(/^Lineas de defensa prioritarias:\s*/i, "")}`.trim()
        adjustments.push("defense_lines_bulletized")
      }
    }
  }

  if (params.defenseCoverageStatus === "insufficient" && !normalizedText.includes("evidencia recuperada no cubre")) {
    text = `La evidencia recuperada no cubre plenamente todos los documentos clave para esta consulta.\n\n${text}`.trim()
    adjustments.push("defense_insufficient_prefix")
  }

  text = text.replace(/^(Lineas de defensa prioritarias:\s*){2,}/i, "Lineas de defensa prioritarias:\n")

  return {
    text,
    adjustments,
    clearCitations,
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const url = new URL(request.url)
  const threadIdRaw = (url.searchParams.get("threadId") || "").trim()
  const threadId = threadIdRaw && threadIdRaw !== "legacy" ? threadIdRaw : null

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let q = supabase
    .from("gob_chat_messages")
    .select("id,role,content,created_at,citations,model,usage")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true })
    .limit(80)

  q = threadId ? q.eq("thread_id", threadId) : q.is("thread_id", null)

  const { data: messages, error } = await q

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ messages: messages ?? [] })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: member } = await supabase
    .from("gob_workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (member.role === "viewer") {
    return NextResponse.json({ error: "Read-only role" }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = AskSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const now = new Date().toISOString()
  const requestStartedAt = Date.now()
  const question = parsed.data.question
  let answerContract = extractAnswerContract(question)
  const threadId = parsed.data.threadId ?? null
  const attachedSourceIdRaw = parsed.data.sourceId ? String(parsed.data.sourceId) : null
  const requestedResponseProfile: AnswerResponseProfile = parsed.data.responseProfile ?? "auto"
  const retrievalFilters = parsed.data.filters ?? null
  const admin = createAdminClient()
  let retrievalElapsedMs = 0
  let generationElapsedMs = 0
  let attachedSourceId: string | null = null
  let attachedSnapshotId: string | null = null
  let attachedSourceTitle: string | null = null
  let attachedEvidence: EvidenceChunk[] = []

  let effectiveMode: "extractive" | "comparison" | "checklist" | "resolution" =
    parsed.data.mode ?? "extractive"
  let persistedThreadMemoryBlock = ""
  let persistedThreadRoleTokens: string[] = []

  if (threadId) {
    const { data: thread } = await supabase
      .from("gob_chat_threads")
      .select("id,mode,memory_summary,memory_role_tokens")
      .eq("id", threadId)
      .eq("workspace_id", workspaceId)
      .maybeSingle()

    if (!thread) {
      return NextResponse.json({ error: "Invalid thread" }, { status: 400 })
    }

    if (!parsed.data.mode && thread.mode) {
      effectiveMode = thread.mode
    }

    if (thread?.memory_summary) {
      persistedThreadMemoryBlock = `Memoria persistida del hilo:\n${String(thread.memory_summary)}`
    }
    if (Array.isArray((thread as any)?.memory_role_tokens)) {
      persistedThreadRoleTokens = (thread as any).memory_role_tokens.map(String).filter(Boolean).slice(0, 8)
    }
  }

  const questionDifficulty = classifyQuestionDifficulty(question, effectiveMode)
  const resolvedResponseProfile = resolveResponseProfile(
    requestedResponseProfile,
    questionDifficulty
  )
  const queryIntent = await inferRagQueryIntentWithLlm(question)
  const ragExecutionPlan = decideRagExecutionPlan({
    question,
    mode: effectiveMode,
    difficulty: questionDifficulty,
    responseProfile: resolvedResponseProfile,
    intent: queryIntent,
    hasAttachedSource: Boolean(attachedSourceIdRaw),
  })
  const isFactualPipeline = ragExecutionPlan.pipeline === "factual"
  const isSlimExtractivePipeline =
    effectiveMode === "extractive" &&
    !isFactualPipeline &&
    resolvedResponseProfile !== "deep" &&
    (ragExecutionPlan.pipeline === "direct" || ragExecutionPlan.pipeline === "standard")
  answerContract = tuneAnswerContract({
    contract: answerContract,
    mode: effectiveMode,
    responseProfile: resolvedResponseProfile,
    intent: queryIntent,
    pipeline: ragExecutionPlan.pipeline,
  })

  let caseMemory = ""
  let onboardingTribunalReferences: OnboardingTribunalReference[] = []
  let onboardingStructuredMemory: StructuredOnboardingMemory | null = null
  let recentThreadMessages: RecentThreadMemoryMessage[] = []
  let threadMemoryBlock = persistedThreadMemoryBlock
  let strategicProfileMemoryBlock = ""
  let graphContextBlock = ""
  let graphRelatedRoles: string[] = []
  let graphRelatedQueries: string[] = []
  let graphSnapshotReferences: Array<{ snapshotId: string; title?: string | null; docType?: string | null; docRole?: string | null; rol?: string | null }> = []
  let retrievalFeedbackSignals: RetrievalFeedbackSignals | null = null
  let agentPlanQueries: string[] = []
  let agentPlanRationale: string[] = []
  let agentPlanTools: string[] = []
  let agentPlanModel: string | null = null
  let threadRoleTokens: string[] = persistedThreadRoleTokens
  let strategicBundleReferences: Array<{
    snapshotId: string
    title?: string | null
    docType?: string | null
    docRole?: string | null
    rol?: string | null
  }> = []
  let tribunalFacts: Array<{
    snapshotId: string | null
    sourceTitle: string | null
    documentType: string | null
    docRole: string | null
    rol: string | null
    claimants: string[]
    fojas: string[]
    dates: string[]
    citedNorms: string[]
    authorities: string[]
    outcomeSignals: string[]
    holdings: string[]
    resolutionSnippets: string[]
    keySignals: string[]
  }> = []
  let persistedOnboardingArtifacts: PersistedOnboardingArtifacts | null = null
  if (!isSmallTalkQuestion(question) && !isMetaAssistantQuestion(question)) {
    persistedOnboardingArtifacts = await loadPersistedOnboardingArtifacts({
      supabase,
      workspaceId,
    }).catch(() => null as PersistedOnboardingArtifacts | null)
    retrievalFeedbackSignals = (await loadWorkspaceRetrievalFeedbackSignals({
      admin,
      workspaceId,
      limit: 120,
    }).catch(() => null)) as RetrievalFeedbackSignals | null

    onboardingTribunalReferences = await loadOnboardingTribunalReferences({
      supabase,
      admin,
      workspaceId,
      persistedArtifacts: persistedOnboardingArtifacts,
    }).catch(() => [] as OnboardingTribunalReference[])
    onboardingStructuredMemory = await loadStructuredOnboardingMemory({
      supabase,
      workspaceId,
      onboardingReferences: onboardingTribunalReferences,
      persistedArtifacts: persistedOnboardingArtifacts,
    }).catch(() => null as StructuredOnboardingMemory | null)
    caseMemory = await buildCaseMemoryContext({
      supabase,
      workspaceId,
      onboardingReferences: onboardingTribunalReferences,
      structuredMemory: onboardingStructuredMemory,
    }).catch(() => "")

    recentThreadMessages = await loadRecentThreadMemoryMessages({
      supabase,
      workspaceId,
      threadId,
    }).catch(() => [] as RecentThreadMemoryMessage[])
    const threadMemory = buildThreadMemory({
      messages: recentThreadMessages,
      currentQuestion: question,
    })
    threadMemoryBlock = threadMemory.block
    threadRoleTokens = threadMemory.roleTokens

    const strategicProfileMemory = await buildStrategicProfileContext({
      admin,
      question,
      structuredMemory: onboardingStructuredMemory,
      onboardingReferences: onboardingTribunalReferences,
      threadRoleTokens,
    }).catch(() => ({ roleTokens: threadRoleTokens, block: "" }))
    strategicProfileMemoryBlock = strategicProfileMemory.block
    if (Array.isArray(strategicProfileMemory.roleTokens) && strategicProfileMemory.roleTokens.length) {
      threadRoleTokens = strategicProfileMemory.roleTokens
    }

    const graphContext = await loadLegalGraphContext({
      admin,
      workspaceId,
      question,
      roleTokens: threadRoleTokens,
      limit: isFactualPipeline ? 4 : 6,
    }).catch(() => ({ block: "", relatedRoles: [] as string[], relatedQueries: [] as string[] }))
    graphContextBlock = graphContext.block
    graphRelatedRoles = graphContext.relatedRoles
    graphRelatedQueries = graphContext.relatedQueries
    graphSnapshotReferences = await loadLegalGraphSnapshotReferences({
      admin,
      workspaceId,
      question,
      roleTokens: threadRoleTokens,
      preferredDocRoles: queryIntent.preferredDocRoles,
      limit: isFactualPipeline ? 4 : 6,
    }).catch(() => [] as Array<{ snapshotId: string; title?: string | null; docType?: string | null; docRole?: string | null; rol?: string | null }>)
    if (graphRelatedRoles.length) {
      threadRoleTokens = Array.from(new Set([...threadRoleTokens, ...graphRelatedRoles])).slice(0, 8)
    }

    const agentPlan = await buildStrategicAgentPlan({
      question,
      mode: effectiveMode,
      difficulty: questionDifficulty,
      responseProfile: resolvedResponseProfile,
      intent: queryIntent,
      structuredMemory: onboardingStructuredMemory,
      graphRelatedRoles,
    }).catch(() => ({ applied: false, toolOrder: [] as string[], subqueries: [] as string[], rationale: [] as string[], model: null }))
    agentPlanQueries = agentPlan.subqueries
    agentPlanRationale = agentPlan.rationale
    agentPlanTools = agentPlan.toolOrder
    agentPlanModel = agentPlan.model

    tribunalFacts = (await fetchTribunalDocumentFacts({
      admin,
      question,
      roleTokens: threadRoleTokens,
      limit: isFactualPipeline ? 6 : 8,
    }).catch(() => [])) as typeof tribunalFacts

    strategicBundleReferences = (await loadStrategicBundleReferences({
      admin,
      workspaceId,
      question,
      structuredMemory: onboardingStructuredMemory,
      onboardingReferences: onboardingTribunalReferences,
      roleTokens: threadRoleTokens,
      preferredDocRoles: queryIntent.preferredDocRoles,
    }).catch(() => [])) as typeof strategicBundleReferences
  }

  const defenseAnswerPolicy = buildDefenseAnswerPolicy({
    question,
    intent: queryIntent,
    mode: effectiveMode,
    responseProfile: resolvedResponseProfile,
    structuredMemory: onboardingStructuredMemory,
  })

  const tribunalFactsBlock = tribunalFacts.length
    ? `Hechos documentales extraidos:\n${tribunalFacts
        .slice(0, 4)
        .map((fact) => {
          const label = [fact.rol, fact.docRole, fact.sourceTitle || fact.documentType].filter(Boolean).join(" · ")
          const evidence = [
            fact.claimants?.length ? `reclamante=${fact.claimants.slice(0, 2).join(", ")}` : "",
            fact.fojas?.length ? `fojas=${fact.fojas.slice(0, 4).join(", ")}` : "",
            fact.dates?.length ? `fechas=${fact.dates.slice(0, 2).join(", ")}` : "",
            fact.citedNorms?.length ? `normas=${fact.citedNorms.slice(0, 2).join(", ")}` : "",
            fact.authorities?.length ? `autoridades=${fact.authorities.slice(0, 2).join(", ")}` : "",
            fact.outcomeSignals?.[0] ? `resultado=${String(fact.outcomeSignals[0]).slice(0, 160)}` : "",
            fact.holdings?.[0] ? `holding=${String(fact.holdings[0]).slice(0, 160)}` : "",
            fact.resolutionSnippets?.[0] ? `resolucion=${String(fact.resolutionSnippets[0]).slice(0, 180)}` : "",
            fact.keySignals?.[0] ? `senal=${String(fact.keySignals[0]).slice(0, 160)}` : "",
          ]
            .filter(Boolean)
            .join(" | ")
          return [label, evidence].filter(Boolean).join(": ")
        })
        .filter(Boolean)
        .join("\n")}`
    : ""

  const intentGuidance = [
    queryIntent.asksForDocumentPriority
      ? "Si te piden priorizar documentos para la defensa o el marco teorico, menciona explicitamente cuales van primero y por que. Si la evidencia lo permite, prioriza informe y sentencia; usa la reclamacion solo como contexto."
      : "",
    queryIntent.asksForContextUse
      ? "Si la consulta contrasta 'contexto' versus 'prueba principal', responde explicitamente con una de esas categorias en la primera oracion y justificala con evidencia."
      : "",
    ...defenseAnswerPolicy.instructions,
  ]
    .filter(Boolean)
    .join("\n")

  const expertQuestion =
    "Actua como asesor experto en marco teorico, estrategia de defensa ambiental chilena, redaccion tecnica y correccion de documentos. " +
    "Responde de forma practica y fundamentada. " +
    "Si una recomendacion no tiene respaldo documental directo, indicarlo explicitamente como 'sin respaldo'.\n\n" +
    (caseMemory ? `Memoria del caso:\n${caseMemory}\n\n` : "") +
    (threadMemoryBlock ? `Memoria de conversacion:\n${threadMemoryBlock}\n\n` : "") +
    (strategicProfileMemoryBlock ? `Perfiles estrategicos:\n${strategicProfileMemoryBlock}\n\n` : "") +
    (graphContextBlock ? `${graphContextBlock}\n\n` : "") +
    (agentPlanRationale.length ? `Plan estrategico de retrieval:\n${agentPlanRationale.map((item) => `- ${item}`).join("\n")}\n\n` : "") +
    (tribunalFactsBlock ? `${tribunalFactsBlock}\n\n` : "") +
    (intentGuidance ? `Instrucciones de foco:\n${intentGuidance}\n\n` : "") +
    "Consulta del usuario:\n" +
    question

  if (!isSmallTalkQuestion(question) && !isMetaAssistantQuestion(question) && attachedSourceIdRaw) {
    const { data: attachedSource, error: attachedSourceErr } = await supabase
      .from("gob_sources")
      .select("id,workspace_id,title,filename,status")
      .eq("id", attachedSourceIdRaw)
      .eq("workspace_id", workspaceId)
      .maybeSingle()

    if (attachedSourceErr) {
      return NextResponse.json({ error: attachedSourceErr.message }, { status: 500 })
    }

    if (!attachedSource) {
      return NextResponse.json({ error: "Attached source not found in this workspace" }, { status: 404 })
    }

    attachedSourceId = String(attachedSource.id)
    attachedSourceTitle = attachedSource.title
      ? String(attachedSource.title)
      : attachedSource.filename
        ? String(attachedSource.filename)
        : "Documento adjunto"

    const { data: attachedSnapshot, error: attachedSnapshotErr } = await supabase
      .from("gob_source_snapshots")
      .select("id,status")
      .eq("workspace_id", workspaceId)
      .eq("source_id", attachedSourceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (attachedSnapshotErr) {
      return NextResponse.json({ error: attachedSnapshotErr.message }, { status: 500 })
    }

    if (!attachedSnapshot || String(attachedSnapshot.status || "") !== "ready") {
      return NextResponse.json(
        {
          error: "Attached source is still processing. Try again in a moment.",
          sourceId: attachedSourceId,
          status: attachedSnapshot?.status || "pending",
        },
        { status: 409 }
      )
    }

    attachedSnapshotId = String(attachedSnapshot.id)

    const { data: attachedChunks, error: attachedChunksErr } = await supabase
      .from("gob_chunks")
      .select("id,content,source_url,snapshot_id,page,section")
      .eq("workspace_id", workspaceId)
      .eq("snapshot_id", attachedSnapshotId)
      .order("created_at", { ascending: true })
      .limit(120)

    if (attachedChunksErr) {
      return NextResponse.json({ error: attachedChunksErr.message }, { status: 500 })
    }

    if (!attachedChunks?.length) {
      return NextResponse.json(
        {
          error: "Attached source has no extracted text yet. Wait until processing completes.",
          sourceId: attachedSourceId,
        },
        { status: 409 }
      )
    }

    attachedEvidence = attachedChunks.map((row: any) => ({
      chunkId: String(row.id),
      content: String(row.content ?? ""),
      sourceUrl: row.source_url ? String(row.source_url) : null,
      snapshotId: row.snapshot_id ? String(row.snapshot_id) : null,
      page: typeof row.page === "number" ? row.page : row.page ? Number(row.page) : null,
      section: row.section ? String(row.section) : null,
    }))
  }

  const { data: userMessage, error: umErr } = await supabase
    .from("gob_chat_messages")
    .insert({
      thread_id: threadId,
      workspace_id: workspaceId,
      role: "user",
      content: question,
      created_at: now,
      created_by: user.id,
    })
    .select("id,role,content,created_at,citations,model,usage")
    .single()

  if (umErr) return NextResponse.json({ error: umErr.message }, { status: 500 })

  const isSmallTalk = isSmallTalkQuestion(question)
  const isMetaQuestion = isMetaAssistantQuestion(question)

  if (isSmallTalk || isMetaQuestion) {
    const assistantText = isMetaQuestion
      ? "Trabajo como asistente juridico con RAG: busco evidencia, cito fuentes verificables y puedo ayudarte a analizar documentos, marco teorico y estrategia de defensa."
      : "Hola. Ya tengo contexto del proyecto y puedo ayudarte a leer el marco teorico, revisar documentos, contrastar precedentes y proponer estrategia de defensa con citas." 

    const assistantReport = buildAssistantReport({
      skipReason: isMetaQuestion ? "meta_assistant" : "smalltalk",
      retrievalProvider: defaultRetrievalProvider(),
      effectiveMode,
      requestedResponseProfile,
      resolvedResponseProfile,
      questionDifficulty,
      retrievalMs: 0,
      generationMs: 0,
      totalMs: Date.now() - requestStartedAt,
      evidenceCount: 0,
      citationsCount: 0,
      retrievalQueries: [],
      model: null,
      preferredDocRoles: queryIntent.preferredDocRoles,
      retrievalIntentHints: queryIntent.retrievalHints,
      graphRelatedRoles,
      graphRelatedQueries,
      agentPlanTools,
      agentPlanRationale,
      agentPlanModel,
      questionType: queryIntent.questionType,
      intentComplexity: queryIntent.complexity,
      intentUsedLlm: Boolean(queryIntent.usedLlm),
      intentModel: queryIntent.model ?? null,
    })

    await recordRetrievalTrace({
      supabase,
      workspaceId,
      stage: "chat",
      provider: defaultRetrievalProvider(),
      query: question,
      filters: retrievalFilters,
      results: [],
      responseId: null,
      model: null,
      createdBy: user.id,
      threadId,
      messageId: userMessage.id,
      metadata: {
        mode: effectiveMode,
        response_profile_requested: requestedResponseProfile,
        response_profile_resolved: resolvedResponseProfile,
        question_difficulty: questionDifficulty,
        evidence_count: 0,
        skip_reason: isMetaQuestion ? "meta_assistant" : "smalltalk",
        retrieval_ms: 0,
        generation_ms: 0,
        total_ms: Date.now() - requestStartedAt,
        answer_contract_max_bullets: answerContract.maxBullets,
        answer_contract_min_citations: answerContract.minCitations,
        answer_contract_specific_precedent_query: answerContract.isSpecificPrecedentQuery,
      },
    }).catch(() => null)

    const { data: assistantMessage, error: amErr } = await supabase
      .from("gob_chat_messages")
      .insert({
        thread_id: threadId,
        workspace_id: workspaceId,
        role: "assistant",
        content: assistantText,
        citations: [],
        created_at: new Date().toISOString(),
        model: null,
        usage: withAssistantReport({ usage: null, report: assistantReport }),
      })
      .select("id,role,content,created_at,citations,model,usage")
      .single()

    if (amErr) return NextResponse.json({ error: amErr.message }, { status: 500 })

    if (threadId) {
      const persistedThreadMemory = buildPersistedThreadMemory({
        messages: recentThreadMessages,
        currentQuestion: question,
        assistantAnswer: assistantText,
      })
      await supabase
        .from("gob_chat_threads")
        .update({
          updated_at: new Date().toISOString(),
          memory_summary: persistedThreadMemory.summary,
          memory_role_tokens: persistedThreadMemory.roleTokens,
          memory_updated_at: new Date().toISOString(),
        })
        .eq("id", threadId)
        .eq("workspace_id", workspaceId)
    }

    await supabase.from("gob_audit_logs").insert({
      user_id: user.id,
      action: "chat.ask",
      target_resource: "gob_chat_messages",
      details: {
        workspace_id: workspaceId,
        thread_id: threadId,
        mode: effectiveMode,
        question,
        retrieval_provider: defaultRetrievalProvider(),
        retrieval_response_id: null,
        retrieval_model: null,
        retrieval_filters: retrievalFilters,
        evidence_count: 0,
        cited_chunks: [],
        intent: isMetaQuestion ? "meta_assistant" : "smalltalk",
        response_profile_requested: requestedResponseProfile,
        response_profile_resolved: resolvedResponseProfile,
        question_difficulty: questionDifficulty,
      },
      timestamp: now,
    })

    return NextResponse.json({ userMessage, assistantMessage })
  }

  // Retrieve evidence (workspace-first + adaptive hybrid fusion)
  let evidence: EvidenceChunk[] = []
  let retrievalProvider: "local" | "openai" | "hybrid" = defaultRetrievalProvider()
  let retrievalResponseId: string | null = null
  let retrievalModel: string | null = null
  const retrievalWorkspaceIdsUsed = [workspaceId]
  let retrievalExpandedToMemberWorkspaces = false
  let retrievalCoverageBefore = 0
  let retrievalCoverageAfter = 0
  let retrievalDeepened = false
  let retrievalRerankApplied = false
  let retrievalRerankModel: string | null = null
  const retrievalExtraQueriesUsed: string[] = []
  let retrievalHydeApplied = false
  let retrievalHydeModel: string | null = null
  let retrievalHydeQueries: string[] = []
  let correctiveApplied = false
  let correctiveEarlyExit = false
  let correctiveReason: string | null = null
  let correctiveModel: string | null = null
  let correctiveQuality: string | null = null
  let correctiveIterations = 0
  const correctiveQueriesUsed: string[] = []
  const agentCorrectiveRationale: string[] = []
  const agentVerificationReports: Array<Record<string, unknown>> = []
  const agentToolBudget = numberEnv(
    "RAG_AGENT_MAX_TOOL_STEPS",
    resolvedResponseProfile === "deep" ? 10 : resolvedResponseProfile === "balanced" ? 7 : 4,
    2,
    12
  )
  let agentToolStepsUsed = 0
  let agentBudgetExhausted = false
  let agentStopReason: string | null = null
  let defenseCoverageStatus: "not_applicable" | "ready" | "partial" | "insufficient" = "not_applicable"
  let defenseMissingRoles: string[] = []
  let defenseRoleCounts: Record<string, number> = {}

  const consumeAgentToolBudget = (label: string) => {
    if (agentToolStepsUsed >= agentToolBudget) {
      agentBudgetExhausted = true
      if (!correctiveReason) {
        correctiveReason = `Se agoto el presupuesto agentico antes de ejecutar ${label}.`
      }
      return false
    }
    agentToolStepsUsed += 1
    return true
  }

  const traceResults: any[] = attachedEvidence.map((row) => ({
    chunkId: row.chunkId,
    content: row.content,
    sourceUrl: row.sourceUrl,
    snapshotId: row.snapshotId,
    page: row.page,
    section: row.section,
    origin: "attached_source",
    rank: null,
  }))

  const profile = retrievalProfile(
    effectiveMode,
    resolvedResponseProfile,
    questionDifficulty,
    ragExecutionPlan.pipeline
  )
  const contextualRoleQueries = !answerContract.entityTokens.length && threadRoleTokens.length
    ? threadRoleTokens.slice(0, 2).map((token) => `${token} ${question}`)
    : []
  const contextualGraphQueries = graphRelatedQueries.slice(0, 2)
  const strategicAgentQueries = agentPlanQueries.slice(0, 3)

  const retrievalSeedQueries = Array.from(
    new Set(
      [
        ...buildRetrievalQueryVariants({
          question,
          mode: effectiveMode,
          difficulty: questionDifficulty,
        }),
        ...contextualRoleQueries,
        ...contextualGraphQueries,
        ...strategicAgentQueries,
      ]
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  )
  const retrievalDecompositionQueries = buildDecompositionQueries({
    question,
    mode: effectiveMode,
    difficulty: questionDifficulty,
  })
  const hydeExpansion = !attachedEvidence.length
    ? await buildHyDEExpansion({
        question,
        mode: effectiveMode,
        difficulty: questionDifficulty,
        responseProfile: resolvedResponseProfile,
        intent: queryIntent,
        allowHyDE: ragExecutionPlan.allowHyDE,
      })
    : { applied: false, model: null, hypotheticalDocument: null, queries: [] as string[] }

  retrievalHydeApplied = hydeExpansion.applied
  retrievalHydeModel = hydeExpansion.model
  retrievalHydeQueries = hydeExpansion.queries.slice(0, 3)

  const retrievalFastMode = resolvedResponseProfile === "fast"
  const maxRetrievalQueries = numberEnv("RAG_MAX_RETRIEVAL_QUERIES", retrievalFastMode ? 4 : 6, 2, 12)

  let retrievalQueries = Array.from(
    new Set(
      [
        ...retrievalSeedQueries,
        ...hydeExpansion.queries,
        ...queryIntent.retrievalHints,
        ...defenseAnswerPolicy.targetedQueries,
        ...(questionDifficulty === "complex" || effectiveMode !== "extractive"
          ? retrievalDecompositionQueries.slice(0, retrievalFastMode ? 1 : 2)
          : []),
      ]
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    )
  ).slice(0, maxRetrievalQueries)

  if (isFactualPipeline) {
    retrievalQueries = Array.from(
      new Set(
        [question, retrievalSeedQueries[0], queryIntent.retrievalHints[0]]
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      )
    ).slice(0, 2)
  }

  const targetEvidenceCount = Math.max(
    isFactualPipeline ? 6 : retrievalFastMode ? 8 : 10,
    profile.maxResults +
      (isFactualPipeline ? 1 : retrievalFastMode ? 2 : resolvedResponseProfile === "deep" ? 10 : 6) +
      (questionDifficulty === "complex" ? 4 : 0)
  )
  const maxContextEvidence = numberEnv(
    "RAG_MAX_CONTEXT_EVIDENCE",
    isFactualPipeline
      ? Math.max(8, Math.min(14, profile.maxResults + 4))
      : retrievalFastMode
      ? Math.max(12, Math.min(28, profile.maxResults * 2 + 6))
      : Math.max(18, Math.min(72, profile.maxResults * 3 + 14)),
    10,
    120
  )
  const perSnapshotCap = isFactualPipeline
    ? 2
    : effectiveMode === "extractive"
      ? retrievalFastMode
        ? 2
        : 3
      : retrievalFastMode
        ? 3
        : 4

  const factSnapshotReferences = buildFactSnapshotReferences({
    question,
    facts: tribunalFacts as any,
    maxRefs: isFactualPipeline ? 6 : 8,
  })
  const combinedSnapshotReferences = Array.from(
    new Map(
      [...factSnapshotReferences, ...strategicBundleReferences, ...onboardingTribunalReferences, ...graphSnapshotReferences].map((ref) => [String((ref as any)?.snapshotId || ""), ref])
    ).values()
  ).filter((ref: any) => String(ref?.snapshotId || "").trim())

  const onboardingReferenceEvidence: EvidenceChunk[] = ((
    !attachedEvidence.length && combinedSnapshotReferences.length
      ? await getCachedReferencedEvidence({
          supabase: admin,
          references: combinedSnapshotReferences as any,
          question,
          maxOut: isFactualPipeline
            ? Math.max(6, Math.min(14, profile.maxResults + 2))
            : Math.max(8, Math.min(22, profile.maxResults + 6)),
          perSnapshotCap: isFactualPipeline ? 2 : retrievalFastMode ? 2 : 3,
        }).catch(() => [] as EvidenceChunk[])
      : []) ?? []) as EvidenceChunk[]

  const retrievalSeeds: EvidenceSeed[] = [
    ...attachedEvidence.slice(0, 42).map(
      (chunk, idx): EvidenceSeed => ({
        chunk,
        origin: "attached",
        rank: idx + 1,
        score: 1,
        workspaceId,
      })
    ),
    ...onboardingReferenceEvidence.slice(0, 24).map(
      (chunk, idx): EvidenceSeed => {
        const origin: EvidenceSeed["origin"] = factSnapshotReferences.some(
          (ref) => String((ref as any)?.snapshotId || "") === String(chunk.snapshotId || "")
        )
          ? "facts"
          : graphSnapshotReferences.some(
                (ref) => String((ref as any)?.snapshotId || "") === String(chunk.snapshotId || "")
              )
            ? "managed"
          : "onboarding"
        return {
          chunk,
          origin,
          rank: idx + 1,
          score: 1,
          workspaceId: null,
        }
      }
    ),
  ]

  for (const [idx, chunk] of onboardingReferenceEvidence.slice(0, 24).entries()) {
    traceResults.push({
      chunkId: chunk.chunkId,
      content: chunk.content,
      sourceUrl: chunk.sourceUrl,
      snapshotId: chunk.snapshotId,
      page: chunk.page,
      section: chunk.section,
      origin: factSnapshotReferences.some((ref) => String((ref as any)?.snapshotId || "") === String(chunk.snapshotId || ""))
        ? "facts_reference"
        : graphSnapshotReferences.some((ref) => String((ref as any)?.snapshotId || "") === String(chunk.snapshotId || ""))
          ? "graph_reference"
        : "onboarding_reference",
      rank: idx + 1,
    })
  }

  const retrievalStartedAt = Date.now()

  try {
    const configuredProvider = defaultRetrievalProvider()

    if (attachedEvidence.length > 0) {
      retrievalProvider = "local"
      evidence = fuseEvidenceSeeds({
        seeds: retrievalSeeds,
        question,
        workspaceId,
        maxOut: Math.max(14, Math.min(42, maxContextEvidence)),
        perSnapshotCap,
      })
    } else {
      let memberWorkspaceIds = [workspaceId]
      try {
        memberWorkspaceIds = await getAccessibleWorkspaceIdsForUser({
          supabase,
          userId: user.id,
          requiredWorkspaceId: workspaceId,
        })
      } catch {
        memberWorkspaceIds = [workspaceId]
      }

      const secondaryWorkspaceIds = memberWorkspaceIds.filter((id) => id !== workspaceId).slice(0, 20)
      const scopeExpansionEnabled = boolEnv("RAG_ENABLE_SCOPE_EXPANSION", true)
      const allowScopeExpansion =
        !isFactualPipeline &&
        scopeExpansionEnabled &&
        secondaryWorkspaceIds.length > 0 &&
        (questionDifficulty === "complex" ||
          queryIntent.needsMultiCause ||
          queryIntent.needsGraphLookup ||
          effectiveMode === "comparison" ||
          effectiveMode === "checklist" ||
          resolvedResponseProfile === "deep")

      const responseIds: string[] = []
      const models: string[] = []
      const managedEnabled = shouldUseManagedRetrieval()

      const managedMaxResults = Math.max(8, Math.min(32, profile.maxResults + 2))
      const localMatchCount = Math.max(10, Math.min(28, profile.maxResults + 4))
      const localTextMatchCount = Math.max(12, Math.min(34, profile.maxResults + 8))

      const executedManaged = new Set<string>()
      const executedLocal = new Set<string>()

      const runManagedForScope = async (scopeWorkspaceIds: string[], queries: string[]) => {
        if (!managedEnabled || !scopeWorkspaceIds.length || !queries.length) return

        const kbs = (await listKnowledgeBasesForWorkspaces({
          supabase,
          workspaceIds: scopeWorkspaceIds,
        }).catch(() => [])) as Array<{
          id: string
          workspaceId: string
          name: string
          vectorStoreId: string
        }>

        if (!kbs.length) return
        const kbByWorkspace = new Map<string, (typeof kbs)[number]>(
          kbs.map((kb: (typeof kbs)[number]) => [kb.workspaceId, kb])
        )

        for (const scopeWorkspaceId of scopeWorkspaceIds) {
          const kb = kbByWorkspace.get(scopeWorkspaceId)
          if (!kb?.vectorStoreId) continue

          for (const queryVariant of queries) {
            const normQuery = normalizeRankingText(queryVariant)
            const dedupeKey = `${scopeWorkspaceId}|${normQuery}`
            if (!normQuery || executedManaged.has(dedupeKey)) continue
            executedManaged.add(dedupeKey)

            try {
              const managed = await searchKnowledgeBaseWithFileSearch({
                vectorStoreId: kb.vectorStoreId,
                query: queryVariant,
                filters: retrievalFilters,
                maxResults: managedMaxResults,
                scoreThreshold: profile.scoreThreshold,
              })

              if (managed.responseId) responseIds.push(String(managed.responseId))
              if (managed.model) models.push(String(managed.model))

              const mapped = await mapResultsToEvidence({
                supabase,
                workspaceIds: [scopeWorkspaceId],
                results: managed.results,
              })

              for (let i = 0; i < mapped.length; i += 1) {
                const row: any = mapped[i]
                const chunk: EvidenceChunk = {
                  chunkId: String(row.chunkId),
                  content: String(row.content ?? ""),
                  sourceUrl: row.sourceUrl ? String(row.sourceUrl) : null,
                  snapshotId: row.snapshotId ? String(row.snapshotId) : null,
                  page: typeof row.page === "number" ? row.page : null,
                  section: row.section ? String(row.section) : null,
                  docRole: row.docRole ? String(row.docRole) : null,
                  documentType: row.documentType ? String(row.documentType) : null,
                  documentTitle: row.documentTitle ? String(row.documentTitle) : null,
                }

                retrievalSeeds.push({
                  chunk,
                  origin: "managed",
                  rank: i + 1,
                  score: typeof row?._meta?.score === "number" ? row._meta.score : 0,
                  workspaceId: scopeWorkspaceId,
                })

                traceResults.push({
                  chunkId: chunk.chunkId,
                  content: chunk.content,
                  sourceUrl: chunk.sourceUrl,
                  snapshotId: chunk.snapshotId,
                  page: chunk.page,
                  section: chunk.section,
                  ...(row._meta || {}),
                  origin: "managed",
                  rank: i + 1,
                  query_variant: queryVariant,
                  kb_workspace_id: kb.workspaceId,
                })
              }
            } catch {
              traceResults.push({
                origin: "managed",
                kb_workspace_id: kb.workspaceId,
                query_variant: queryVariant,
                error: "managed_query_failed",
              })
            }

            if (retrievalSeeds.length >= targetEvidenceCount * 2) {
              break
            }
          }
        }
      }

      const runLocalForScope = async (scopeWorkspaceIds: string[], queryVariant: string) => {
        if (!scopeWorkspaceIds.length) return

        const scopeKey = scopeWorkspaceIds.slice().sort().join(",")
        const normQuery = normalizeRankingText(queryVariant)
        const dedupeKey = `${scopeKey}|${normQuery}`
        if (!normQuery || executedLocal.has(dedupeKey)) return
        executedLocal.add(dedupeKey)

        let localEvidence: EvidenceChunk[] = []
        try {
          localEvidence =
            ((await getCachedLocalEvidence({
              supabase,
              workspaceIds: scopeWorkspaceIds,
              question: queryVariant,
              matchCount: localMatchCount,
              textMatchCount: localTextMatchCount,
              filters: retrievalFilters,
              preferTextOnly: isFactualPipeline,
              intent: queryIntent,
            })) ?? []) as EvidenceChunk[]
        } catch {
          traceResults.push({
            origin: "local",
            query_variant: queryVariant,
            error: "local_query_failed",
          })
          return
        }

        for (let i = 0; i < localEvidence.length; i += 1) {
          const row = localEvidence[i]
          retrievalSeeds.push({
            chunk: row,
            origin: "local",
            rank: i + 1,
            score: 0,
            workspaceId: scopeWorkspaceIds.length === 1 ? scopeWorkspaceIds[0] : null,
          })

          traceResults.push({
            chunkId: row.chunkId,
            content: row.content,
            sourceUrl: row.sourceUrl,
            snapshotId: row.snapshotId,
            page: row.page,
            section: row.section,
            origin: "local",
            rank: i + 1,
            query_variant: queryVariant,
          })
        }
      }

      const primaryQueries = retrievalQueries.length ? retrievalQueries : [question]
      const secondaryQueries = primaryQueries.slice(0, 2)
      const graphQueries = Array.from(new Set([...contextualGraphQueries, ...graphRelatedQueries.slice(0, 2)])).filter(Boolean)

      const allowLocalFallbackInOpenAI =
        configuredProvider !== "openai" || retrievalSeeds.length < targetEvidenceCount

      let provisionalEvidence = fuseEvidenceSeeds({
        seeds: retrievalSeeds,
        question,
        workspaceId,
        maxOut: maxContextEvidence,
        perSnapshotCap,
      })

      retrievalCoverageBefore = retrievalCoverageScore(question, provisionalEvidence)

      const extraQueries = retrievalDecompositionQueries
        .map((q) => String(q || "").trim())
        .filter(Boolean)
        .filter((q) => !primaryQueries.some((base) => normalizeRankingText(base) === normalizeRankingText(q)))
        .slice(0, numberEnv("RAG_DEEPEN_MAX_EXTRA_QUERIES", 4, 1, 10))

      const deepRetrievalEnabled = boolEnv("RAG_ENABLE_DEEP_RETRIEVAL", true)
      const deepRetrievalAllowedForProfile =
        !isFactualPipeline &&
        (!retrievalFastMode ||
          questionDifficulty === "complex" ||
          queryIntent.needsMultiCause ||
          queryIntent.needsGraphLookup)

      const needsDepth =
        deepRetrievalEnabled &&
        deepRetrievalAllowedForProfile &&
        shouldDeepenRetrieval({
          evidenceCount: provisionalEvidence.length,
          targetEvidenceCount,
          coverageScore: retrievalCoverageBefore,
          difficulty: questionDifficulty,
          mode: effectiveMode,
        })

      const retrievalJobs = buildAgenticRetrievalJobs({
        isFactualPipeline,
        primaryWorkspaceId: workspaceId,
        secondaryWorkspaceIds,
        toolOrder: agentPlanTools,
        primaryQueries,
        secondaryQueries,
        graphQueries,
        extraQueries,
        allowScopeExpansion,
        needsDepth,
        allowLocalFallbackInOpenAI,
      })

      const retrievalLoop = await executeAgenticRetrievalJobs({
        jobs: retrievalJobs,
        evidenceLimit: targetEvidenceCount * 2,
        consumeBudget: consumeAgentToolBudget,
        getEvidenceCount: () => retrievalSeeds.length,
        runManaged: runManagedForScope,
        runLocal: runLocalForScope,
        verifyAfterJob: async (job) => {
          const loopEvidence = fuseEvidenceSeeds({
            seeds: retrievalSeeds,
            question,
            workspaceId,
            maxOut: maxContextEvidence,
            perSnapshotCap,
          })
          const coverageScore = retrievalCoverageScore(question, loopEvidence)
          const coverage = summarizeDefenseEvidenceCoverage({
            evidence: loopEvidence,
            requiredRoles: defenseAnswerPolicy.requiredRoles,
          })

          const verification = verifyRetrievalSufficiency({
            evidence: loopEvidence,
            coverageScore,
            targetEvidenceCount,
            profileMaxResults: profile.maxResults,
            isFactualPipeline,
            defenseCoverage: {
              status: coverage.status,
              missingRequiredRoles: coverage.missingRequiredRoles,
            },
          })

          return {
            continueLoop: verification.continueLoop,
            reason: verification.reason,
            metadata: {
              jobId: job.id,
              phase: job.phase,
              ...(verification.metadata || {}),
            },
          }
        },
        onJobStarted(job) {
          if (job.phase === "depth") {
            retrievalDeepened = true
            retrievalExtraQueriesUsed.push(...job.queries)
          }
          if (job.workspaceIds.some((id) => id !== workspaceId)) {
            retrievalExpandedToMemberWorkspaces = true
            retrievalWorkspaceIdsUsed.push(
              ...job.workspaceIds.filter((id) => !retrievalWorkspaceIdsUsed.includes(id))
            )
          }
        },
      })

      if (retrievalLoop.budgetExhausted) {
        correctiveReason =
          correctiveReason ||
          `Se agoto el presupuesto agentico antes de ejecutar ${retrievalLoop.exhaustedLabel || "un paso de retrieval"}.`
      }
      agentStopReason = retrievalLoop.stopReason
      agentVerificationReports.push(...retrievalLoop.verificationReports)

      provisionalEvidence = fuseEvidenceSeeds({
        seeds: retrievalSeeds,
        question,
        workspaceId,
        maxOut: maxContextEvidence,
        perSnapshotCap,
      })

      retrievalResponseId = responseIds.length ? responseIds[0] : null
      retrievalModel = models.length ? models[0] : null

      const hasManaged = retrievalSeeds.some((seed) => seed.origin === "managed")
      const hasLocal = retrievalSeeds.some((seed) => seed.origin === "local")

      if (hasManaged && hasLocal) retrievalProvider = "hybrid"
      else if (hasManaged) retrievalProvider = "openai"
      else retrievalProvider = "local"

      provisionalEvidence = buildHeuristicContextPack({
        question,
        evidence: provisionalEvidence,
        maxOut: maxContextEvidence,
        mode: effectiveMode,
        difficulty: questionDifficulty,
      })

      retrievalCoverageAfter = retrievalCoverageScore(question, provisionalEvidence)

      const shouldUseLlmRerank =
        !isFactualPipeline &&
        !(
          isSlimExtractivePipeline &&
          provisionalEvidence.length <= Math.max(10, profile.maxResults + 2) &&
          retrievalCoverageAfter >= 0.22
        )

      const reranked = shouldUseLlmRerank
        ? await llmRerankEvidence({
            question,
            evidence: provisionalEvidence,
            maxOut: maxContextEvidence,
            mode: effectiveMode,
            difficulty: questionDifficulty,
            responseProfile: resolvedResponseProfile,
            intent: queryIntent,
            feedbackSignals: retrievalFeedbackSignals,
          })
        : { evidence: provisionalEvidence.slice(0, maxContextEvidence), applied: false, model: null as string | null }

      retrievalRerankApplied = reranked.applied
      retrievalRerankModel = reranked.model
      evidence = reranked.evidence
      evidence = await hydrateEvidenceDocumentContext({
        supabase: admin,
        evidence,
      }).catch(() => evidence)

      if (retrievalCoverageAfter <= 0) {
        retrievalCoverageAfter = retrievalCoverageScore(question, evidence)
      }

      let defenseCoverage = summarizeDefenseEvidenceCoverage({
        evidence,
        requiredRoles: defenseAnswerPolicy.requiredRoles,
      })
      defenseCoverageStatus = defenseCoverage.status
      defenseMissingRoles = defenseCoverage.missingRequiredRoles.slice(0, 4)
      defenseRoleCounts = defenseCoverage.counts
      const triedCorrectiveQueries = new Set<string>()

      if (
        ragExecutionPlan.allowCorrectiveRetrieval &&
        resolvedResponseProfile !== "fast" &&
        defenseCoverage.missingRequiredRoles.length > 0 &&
        defenseAnswerPolicy.targetedQueries.length > 0
      ) {
        const roleCorrectiveQueryPlan = buildAgenticCorrectiveQueries({
          question,
          intent: queryIntent,
          missingRoles: defenseCoverage.missingRequiredRoles,
          graphRelatedRoles,
          graphRelatedQueries,
          agentPlanQueries,
          evidenceQualityQueries: [...defenseAnswerPolicy.targetedQueries, ...defenseCoverage.targetedQueries],
          toolOrder: agentPlanTools,
          maxQueries: Math.max(2, ragExecutionPlan.correctiveQueryLimit + 1),
        })
        agentCorrectiveRationale.push(...roleCorrectiveQueryPlan.rationale)
        for (const query of roleCorrectiveQueryPlan.queries) {
          triedCorrectiveQueries.add(normalizeRankingText(query))
        }

        correctiveApplied = true
        correctiveIterations += 1
        const roleCorrectiveQueries = roleCorrectiveQueryPlan.queries

        correctiveQueriesUsed.push(...roleCorrectiveQueries)
        retrievalQueries = Array.from(new Set([...retrievalQueries, ...roleCorrectiveQueries])).slice(
          0,
          Math.max(maxRetrievalQueries, retrievalQueries.length + roleCorrectiveQueries.length)
        )

        const toolStepsBeforeRoleCorrective = agentToolStepsUsed
        if (consumeAgentToolBudget("managed")) {
          await runManagedForScope([workspaceId], roleCorrectiveQueries)
        }
        for (const correctiveQuery of roleCorrectiveQueries.slice(0, 2)) {
          if (!consumeAgentToolBudget(`local:${correctiveQuery}`)) break
          await runLocalForScope([workspaceId], correctiveQuery)
        }

        if (allowScopeExpansion && secondaryWorkspaceIds.length > 0) {
          retrievalExpandedToMemberWorkspaces = true
          retrievalWorkspaceIdsUsed.push(
            ...secondaryWorkspaceIds.filter((id) => !retrievalWorkspaceIdsUsed.includes(id))
          )
          if (consumeAgentToolBudget("managed:scope_expansion")) {
            await runManagedForScope(secondaryWorkspaceIds, roleCorrectiveQueries.slice(0, 2))
          }
          if (roleCorrectiveQueries[0] && consumeAgentToolBudget("local:scope_expansion")) {
            await runLocalForScope(secondaryWorkspaceIds, roleCorrectiveQueries[0])
          }
        }

        if (agentBudgetExhausted && agentToolStepsUsed === toolStepsBeforeRoleCorrective) {
          correctiveEarlyExit = true
          correctiveReason = correctiveReason || "Se agoto el presupuesto agentico antes de ampliar retrieval."
        }

        let roleCorrectiveEvidence = fuseEvidenceSeeds({
          seeds: retrievalSeeds,
          question,
          workspaceId,
          maxOut: maxContextEvidence,
          perSnapshotCap,
        })

        roleCorrectiveEvidence = buildHeuristicContextPack({
          question,
          evidence: roleCorrectiveEvidence,
          maxOut: maxContextEvidence,
          mode: effectiveMode,
          difficulty: questionDifficulty,
        })

        const roleCorrectiveReranked = await llmRerankEvidence({
          question,
          evidence: roleCorrectiveEvidence,
          maxOut: maxContextEvidence,
          mode: effectiveMode,
          difficulty: questionDifficulty,
          responseProfile: resolvedResponseProfile,
          feedbackSignals: retrievalFeedbackSignals,
        })

        if (roleCorrectiveReranked.applied) {
          retrievalRerankApplied = true
          retrievalRerankModel = roleCorrectiveReranked.model
        }

        evidence = await hydrateEvidenceDocumentContext({
          supabase: admin,
          evidence: roleCorrectiveReranked.evidence,
        }).catch(() => roleCorrectiveReranked.evidence)
        retrievalCoverageAfter = retrievalCoverageScore(question, evidence)
        defenseCoverage = summarizeDefenseEvidenceCoverage({
          evidence,
          requiredRoles: defenseAnswerPolicy.requiredRoles,
        })
        defenseCoverageStatus = defenseCoverage.status
        defenseMissingRoles = defenseCoverage.missingRequiredRoles.slice(0, 4)
        defenseRoleCounts = defenseCoverage.counts
        if (defenseCoverage.missingRequiredRoles.length > 0) {
          correctiveReason = `Sigue faltando cobertura documental clave (${defenseCoverage.missingRequiredRoles.join(", ")}) para una respuesta estrategica completa.`
        }
      }

      if (ragExecutionPlan.allowCorrectiveRetrieval && resolvedResponseProfile !== "fast" && evidence.length > 0) {
        let evidenceQuality = await evaluateEvidenceQuality({
          question,
          evidence,
          coverageScore: retrievalCoverageAfter,
          mode: effectiveMode,
          difficulty: questionDifficulty,
          responseProfile: resolvedResponseProfile,
        })

        correctiveQuality = evidenceQuality.quality
        correctiveReason = evidenceQuality.reason
        correctiveModel = evidenceQuality.model

        const maxCorrectiveIterations = Math.max(1, Math.min(3, ragExecutionPlan.correctiveQueryLimit))

        while (
          evidenceQuality.quality !== "sufficient" &&
          evidenceQuality.reformulatedQueries.length > 0 &&
          correctiveIterations < maxCorrectiveIterations
        ) {
          const correctiveQueryPlan = buildAgenticCorrectiveQueries({
            question,
            intent: queryIntent,
            missingRoles: defenseCoverage.missingRequiredRoles,
            graphRelatedRoles,
            graphRelatedQueries,
            agentPlanQueries,
            evidenceQualityQueries: evidenceQuality.reformulatedQueries,
            triedQueries: Array.from(triedCorrectiveQueries),
            toolOrder: agentPlanTools,
            maxQueries: ragExecutionPlan.correctiveQueryLimit,
          })
          agentCorrectiveRationale.push(...correctiveQueryPlan.rationale)
          const correctiveQueries = correctiveQueryPlan.queries
          for (const query of correctiveQueries) {
            triedCorrectiveQueries.add(normalizeRankingText(query))
          }

          if (!correctiveQueries.length) break

          correctiveApplied = true
          correctiveIterations += 1
          correctiveQueriesUsed.push(...correctiveQueries)
          retrievalQueries = Array.from(new Set([...retrievalQueries, ...correctiveQueries])).slice(
            0,
            Math.max(maxRetrievalQueries, retrievalQueries.length + correctiveQueries.length)
          )

          const toolStepsBeforeCorrectiveLoop = agentToolStepsUsed
          if (consumeAgentToolBudget("managed")) {
            await runManagedForScope([workspaceId], correctiveQueries)
          }
          for (const correctiveQuery of correctiveQueries.slice(0, 2)) {
            if (!consumeAgentToolBudget(`local:${correctiveQuery}`)) break
            await runLocalForScope([workspaceId], correctiveQuery)
          }

          if (allowScopeExpansion && secondaryWorkspaceIds.length > 0) {
            retrievalExpandedToMemberWorkspaces = true
            retrievalWorkspaceIdsUsed.push(
              ...secondaryWorkspaceIds.filter((id) => !retrievalWorkspaceIdsUsed.includes(id))
            )
            if (consumeAgentToolBudget("managed:scope_expansion")) {
              await runManagedForScope(secondaryWorkspaceIds, correctiveQueries.slice(0, 2))
            }
            if (correctiveQueries[0] && consumeAgentToolBudget("local:scope_expansion")) {
              await runLocalForScope(secondaryWorkspaceIds, correctiveQueries[0])
            }
          }

          if (agentBudgetExhausted && agentToolStepsUsed === toolStepsBeforeCorrectiveLoop) {
            correctiveEarlyExit = true
            correctiveReason = correctiveReason || "Se agoto el presupuesto agentico durante el loop correctivo."
            break
          }

          let correctiveEvidence = fuseEvidenceSeeds({
            seeds: retrievalSeeds,
            question,
            workspaceId,
            maxOut: maxContextEvidence,
            perSnapshotCap,
          })

          correctiveEvidence = buildHeuristicContextPack({
            question,
            evidence: correctiveEvidence,
            maxOut: maxContextEvidence,
            mode: effectiveMode,
            difficulty: questionDifficulty,
          })

          const correctiveReranked = await llmRerankEvidence({
            question,
            evidence: correctiveEvidence,
            maxOut: maxContextEvidence,
            mode: effectiveMode,
            difficulty: questionDifficulty,
            responseProfile: resolvedResponseProfile,
            intent: queryIntent,
            feedbackSignals: retrievalFeedbackSignals,
          })

          if (correctiveReranked.applied) {
            retrievalRerankApplied = true
            retrievalRerankModel = correctiveReranked.model
          }

          evidence = await hydrateEvidenceDocumentContext({
            supabase: admin,
            evidence: correctiveReranked.evidence,
          }).catch(() => correctiveReranked.evidence)
          retrievalCoverageAfter = retrievalCoverageScore(question, evidence)
          defenseCoverage = summarizeDefenseEvidenceCoverage({
            evidence,
            requiredRoles: defenseAnswerPolicy.requiredRoles,
          })
          defenseCoverageStatus = defenseCoverage.status
          defenseMissingRoles = defenseCoverage.missingRequiredRoles.slice(0, 4)
          defenseRoleCounts = defenseCoverage.counts
          evidenceQuality = await evaluateEvidenceQuality({
            question,
            evidence,
            coverageScore: retrievalCoverageAfter,
            mode: effectiveMode,
            difficulty: questionDifficulty,
            responseProfile: resolvedResponseProfile,
          })

          correctiveQuality = evidenceQuality.quality
          correctiveReason = evidenceQuality.reason
          correctiveModel = evidenceQuality.model
        }

        const strictMissingDefenseCoverage =
          defenseAnswerPolicy.strict && defenseCoverage.missingRequiredRoles.length > 0
        correctiveEarlyExit =
          (evidenceQuality.quality === "insufficient" && evidenceQuality.shouldEarlyExit) ||
          (strictMissingDefenseCoverage && evidenceQuality.quality !== "sufficient")
        if (strictMissingDefenseCoverage) {
          correctiveReason =
            correctiveReason ||
            `La evidencia no cubre todos los documentos clave requeridos (${defenseCoverage.missingRequiredRoles.join(", ")}).`
        }
      }
    }
  } catch {
    evidence = attachedEvidence.slice(0, 20)
    retrievalProvider = "local"
  } finally {
    retrievalElapsedMs = Date.now() - retrievalStartedAt
  }

  if (evidence.length > 0 && retrievalCoverageAfter <= 0) {
    retrievalCoverageAfter = retrievalCoverageScore(question, evidence)
  }

  if (evidence.length > 0) {
    evidence = await hydrateEvidenceDocumentContext({
      supabase: admin,
      evidence,
    }).catch(() => evidence)
    const defenseCoverage = summarizeDefenseEvidenceCoverage({
      evidence,
      requiredRoles: defenseAnswerPolicy.requiredRoles,
    })
    defenseCoverageStatus = defenseCoverage.status
    defenseMissingRoles = defenseCoverage.missingRequiredRoles.slice(0, 4)
    defenseRoleCounts = defenseCoverage.counts
  }

  let assistantText = "No se encuentra en las fuentes disponibles."
  let citations: any[] = []
  let generationError: string | null = null

  let model: string | null = null
  let usage: any = null
  let answerVerificationApplied = false
  let answerVerificationModel: string | null = null
  let answerVerificationDroppedParagraphs = 0
  let answerReflectionApplied = false
  let answerReflectionModel: string | null = null
  let answerReflectionIssues: string[] = []
  let answerSupportStrength: string | null = null
  let answerSupportReason: string | null = null
  let answerSupportParagraphRatio: number | null = null
  let answerSupportCandidateParagraphs: number | null = null
  let answerSupportSupportedParagraphs: number | null = null
  let answerSupportUniqueCitationChunks: number | null = null
  let answerRescueApplied = false
  let answerRescueKind: string | null = null
  let answerContractAdjustments: string[] = []

  const generationQuestion =
    expertQuestion +
    (defenseAnswerPolicy.instructions.length || defenseAnswerPolicy.requiredRoles.length
      ? `\n\nContrato estrategico:\n` +
        [
          defenseAnswerPolicy.instructions.join(" | "),
          defenseAnswerPolicy.requiredRoles.length
            ? `Roles documentales requeridos para esta respuesta: ${defenseAnswerPolicy.requiredRoles.join(", ")}.`
            : "",
          `Cobertura recuperada: informe=${Number(defenseRoleCounts.informe || 0)}, sentencia=${Number(defenseRoleCounts.sentencia || 0)}, reclamacion=${Number(defenseRoleCounts.reclamacion || 0)}.`,
          defenseMissingRoles.length
            ? `Faltan documentos clave recuperados: ${defenseMissingRoles.join(", ")}. Si eso impide responder con seguridad, debes decirlo explicitamente.`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "")

  const specificCoverage = entityCoverageStats(answerContract.entityTokens, evidence)
  const deterministicFactualAnswer =
    isFactualPipeline && evidence.length > 0
      ? buildDeterministicFactualAnswer({
          question,
          evidence,
        })
      : { applied: false, kind: "none", answer: "", citations: [] as Array<{ chunkId: string; quote: string; paragraph: number | null }> }
  const shouldShortCircuitSpecificPrecedent =
    evidence.length > 0 &&
    answerContract.isSpecificPrecedentQuery &&
    answerContract.entityTokens.length > 0 &&
    (specificCoverage.matchedChunks === 0 || specificCoverage.snapshotCount <= 1)

  if (deterministicFactualAnswer.applied) {
    const generationStartedAt = Date.now()
    const evidenceById = new Map(evidence.map((row) => [row.chunkId, row]))
    assistantText = deterministicFactualAnswer.answer
    citations = deterministicFactualAnswer.citations.map((citation, index) => {
      const meta = evidenceById.get(citation.chunkId)
      return enrichCitationMetadata({
        chunkId: citation.chunkId,
        quote: citation.quote,
        paragraph: typeof citation.paragraph === "number" ? citation.paragraph : index,
        sourceUrl: meta?.sourceUrl ?? null,
        snapshotId: meta?.snapshotId ?? null,
        page: meta?.page ?? null,
        section: meta?.section ?? null,
      })
    })
    model = "deterministic:factual"
    usage = null
    answerSupportStrength = citations.length >= 1 ? "strong" : null
    answerSupportReason = "Respuesta factual resuelta con extraccion determinista sobre evidencia citada."
    generationElapsedMs = Date.now() - generationStartedAt
  } else if (shouldShortCircuitSpecificPrecedent) {
    const generationStartedAt = Date.now()
    assistantText = buildNoSpecificPrecedentAnswer({
      entityTokens: answerContract.entityTokens,
    })
    citations = []
    model = null
    usage = null
    generationElapsedMs = Date.now() - generationStartedAt
    answerContractAdjustments.push("specific_precedent_short_circuit")
  } else if (correctiveEarlyExit && evidence.length > 0) {
    const generationStartedAt = Date.now()
    const rescued = await generateEvidenceRescueAnswer({
      question: generationQuestion,
      evidence,
      attachedSourceId,
    })
    assistantText = rescued.answer
    citations = rescued.citations
    model = rescued.model
    usage = rescued.usage
    answerRescueApplied = rescued.applied
    answerRescueKind = rescued.kind
    answerContractAdjustments.push("corrective_early_exit")
    generationElapsedMs = Date.now() - generationStartedAt
  } else if (evidence.length > 0) {
    const generationStartedAt = Date.now()
    try {
      const out = await getCachedStrictAnswer({
        workspaceId,
        question,
        generationQuestion,
        evidence,
        mode: effectiveMode,
        responseProfile: resolvedResponseProfile,
        difficulty: questionDifficulty,
        skipReflection: isSlimExtractivePipeline || isFactualPipeline,
      })
      if (!out) {
        throw new Error("Strict answer generation returned empty output")
      }
      assistantText = out.answer
      model = out.model ?? null
      usage = out.usage ?? null
      answerVerificationApplied = Boolean((out as any)?.verification?.applied)
      answerVerificationModel =
        typeof (out as any)?.verification?.model === "string"
          ? String((out as any).verification.model)
          : null
      answerVerificationDroppedParagraphs = Number((out as any)?.verification?.dropped_paragraphs || 0)
      answerReflectionApplied = Boolean((out as any)?.verification?.reflection_applied)
      answerReflectionModel =
        typeof (out as any)?.verification?.reflection_model === "string"
          ? String((out as any).verification.reflection_model)
          : null
      answerReflectionIssues = Array.isArray((out as any)?.verification?.reflection_issues)
        ? ((out as any).verification.reflection_issues as unknown[])
            .map((item) => String(item || "").trim())
            .filter(Boolean)
        : []
      answerSupportStrength =
        typeof (out as any)?.verification?.support_strength === "string"
          ? String((out as any).verification.support_strength)
          : null
      answerSupportReason =
        typeof (out as any)?.verification?.support_reason === "string"
          ? String((out as any).verification.support_reason)
          : null
      answerSupportParagraphRatio =
        typeof (out as any)?.verification?.support_paragraph_ratio === "number"
          ? Number((out as any).verification.support_paragraph_ratio)
          : null
      answerSupportCandidateParagraphs =
        typeof (out as any)?.verification?.candidate_paragraphs === "number"
          ? Number((out as any).verification.candidate_paragraphs)
          : null
      answerSupportSupportedParagraphs =
        typeof (out as any)?.verification?.supported_paragraphs === "number"
          ? Number((out as any).verification.supported_paragraphs)
          : null
      answerSupportUniqueCitationChunks =
        typeof (out as any)?.verification?.unique_citation_chunks === "number"
          ? Number((out as any).verification.unique_citation_chunks)
          : null
      const evidenceById = new Map(evidence.map((e) => [e.chunkId, e]))
      citations = out.citations.map((c: any) => {
        const meta = evidenceById.get(c.chunkId)
        return enrichCitationMetadata({
          chunkId: c.chunkId,
          quote: c.quote,
          paragraph: typeof c.paragraph === "number" ? c.paragraph : null,
          sourceUrl: meta?.sourceUrl ?? null,
          snapshotId: meta?.snapshotId ?? null,
          page: meta?.page ?? null,
          section: meta?.section ?? null,
        })
      })

      const forceDefenseAbstention = shouldForceDefenseAbstention({
        policy: defenseAnswerPolicy,
        coverage: {
          counts: {
            informe: Number(defenseRoleCounts.informe || 0),
            sentencia: Number(defenseRoleCounts.sentencia || 0),
            reclamacion: Number(defenseRoleCounts.reclamacion || 0),
          },
          requiredRoles: defenseAnswerPolicy.requiredRoles,
          missingRequiredRoles: defenseMissingRoles.filter(Boolean) as Array<"informe" | "sentencia" | "reclamacion">,
          status: defenseCoverageStatus,
          targetedQueries: [],
        },
        supportStrength:
          answerSupportStrength === "none" ||
          answerSupportStrength === "weak" ||
          answerSupportStrength === "partial" ||
          answerSupportStrength === "strong"
            ? answerSupportStrength
            : null,
      })

      if (!out.notFound && forceDefenseAbstention && evidence.length > 0) {
        const rescued = await generateEvidenceRescueAnswer({
          question: generationQuestion,
          evidence,
          attachedSourceId,
        })

        assistantText =
          `La evidencia recuperada no cubre suficientemente los documentos clave requeridos (${defenseMissingRoles.join(", ")}) para responder con seguridad plena.\n\n` +
          rescued.answer
        citations = rescued.citations
        model = rescued.model ?? model
        usage = rescued.usage ?? usage
        answerRescueApplied = rescued.applied
        answerRescueKind = `${rescued.kind}_defense_gate`
        answerContractAdjustments.push("defense_role_gate")
      }

      if (!forceDefenseAbstention && out.notFound && evidence.length > 0) {
        const rescued = await generateEvidenceRescueAnswer({
          question: generationQuestion,
          evidence,
          attachedSourceId,
        })

        assistantText = rescued.answer
        citations = rescued.citations
        model = rescued.model ?? model
        usage = rescued.usage ?? usage
        answerRescueApplied = rescued.applied
        answerRescueKind = rescued.kind
      }

      generationElapsedMs = Date.now() - generationStartedAt
    } catch (err: any) {
      generationElapsedMs = Date.now() - generationStartedAt
      generationError = err?.message ?? String(err)
      assistantText =
        "Tu consulta fue recibida, pero hubo un problema interno al generar la respuesta. Intenta nuevamente o cambia el perfil a 'Rapida'."
      citations = []
      model = null
      usage = null
    }
  } else {
    const generationStartedAt = Date.now()
    const hybrid = await generateNoEvidenceHybridAnswer({
      question: generationQuestion,
    })
    assistantText = hybrid.answer
    model = hybrid.model
    usage = hybrid.usage
    citations = []
    generationElapsedMs = Date.now() - generationStartedAt
  }

  const defenseIntentAdjusted = applyDefenseIntentOverrides({
    text: assistantText,
    question,
    intent: queryIntent,
    roleCounts: defenseRoleCounts,
    defenseCoverageStatus,
    structuredMemory: onboardingStructuredMemory,
  })
  assistantText = defenseIntentAdjusted.text
  if (defenseIntentAdjusted.clearCitations) {
    citations = []
  }
  answerContractAdjustments = Array.from(
    new Set([...answerContractAdjustments, ...(defenseIntentAdjusted.adjustments || [])])
  )

  const contractAdjusted = applyAnswerContract({
    contract: answerContract,
    answer: assistantText,
    citations,
    evidence,
  })
  assistantText = contractAdjusted.answer
  citations = contractAdjusted.citations.map((cite: any) => enrichCitationMetadata(cite))
  answerContractAdjustments = Array.from(
    new Set([...answerContractAdjustments, ...(contractAdjusted.adjustments || [])])
  )

  if (resolvedResponseProfile === "fast") {
    const maxChars = numberEnv("RAG_FAST_MAX_ANSWER_CHARS", 1700, 600, 4000)
    if (assistantText.length > maxChars) {
      assistantText = `${assistantText.slice(0, maxChars).trim()}...`
      answerContractAdjustments = Array.from(
        new Set([...answerContractAdjustments, "answer_trimmed_fast_profile"])
      )
    }
  }

  const finalSupport = resolveFinalAnswerSupport({
    initialStrength: answerSupportStrength,
    defenseCoverageStatus,
    citations,
    rescueApplied: answerRescueApplied,
    mode: effectiveMode,
  })
  if (finalSupport.strength) {
    answerSupportStrength = finalSupport.strength
  }
  if (finalSupport.reason) {
    answerSupportReason = finalSupport.reason
  }
  if (finalSupport.uniqueCitationChunks > 0) {
    answerSupportUniqueCitationChunks = Math.max(
      Number(answerSupportUniqueCitationChunks || 0),
      finalSupport.uniqueCitationChunks
    )
    if (answerSupportSupportedParagraphs == null && citations.length > 0) {
      answerSupportSupportedParagraphs = citations.length
    }
    if (answerSupportCandidateParagraphs == null && citations.length > 0) {
      answerSupportCandidateParagraphs = citations.length
    }
    if (answerSupportParagraphRatio == null && citations.length > 0) {
      answerSupportParagraphRatio = 1
    }
  }

  const totalElapsedMs = Date.now() - requestStartedAt
  const assistantReport = buildAssistantReport({
    retrievalProvider,
    pipeline: ragExecutionPlan.pipeline,
    effectiveMode,
    requestedResponseProfile,
    resolvedResponseProfile,
    questionDifficulty,
    retrievalMs: retrievalElapsedMs,
    generationMs: generationElapsedMs,
    totalMs: totalElapsedMs,
    evidenceCount: evidence.length,
    citationsCount: citations.length,
    retrievalExpandedToMemberWorkspaces,
    retrievalDeepened,
    retrievalRerankApplied,
    retrievalHydeApplied,
    retrievalHydeQueries,
    retrievalQueries,
    correctiveApplied,
    correctiveEarlyExit,
    correctiveReason,
    answerVerificationApplied,
    answerVerificationDroppedParagraphs,
    answerReflectionApplied,
    answerReflectionIssues,
    answerRescueApplied,
    defenseCoverageStatus,
    defenseMissingRoles,
    defenseRoleCounts,
    attachedSourceTitle,
    model,
    preferredDocRoles: queryIntent.preferredDocRoles,
    retrievalIntentHints: queryIntent.retrievalHints,
    graphRelatedRoles,
    graphRelatedQueries,
    agentPlanTools,
    agentPlanRationale,
    agentPlanModel,
    agentToolBudget,
    agentToolStepsUsed,
    agentBudgetExhausted,
    agentCorrectiveRationale,
    agentStopReason,
    agentVerificationReports,
    questionType: queryIntent.questionType,
    intentComplexity: queryIntent.complexity,
    intentUsedLlm: Boolean(queryIntent.usedLlm),
    intentModel: queryIntent.model ?? null,
    correctiveIterations,
    supportStrength: answerSupportStrength,
    supportReason: answerSupportReason,
    supportParagraphRatio: answerSupportParagraphRatio ?? undefined,
    supportCandidateParagraphs: answerSupportCandidateParagraphs ?? undefined,
    supportSupportedParagraphs: answerSupportSupportedParagraphs ?? undefined,
    supportUniqueCitationChunks: answerSupportUniqueCitationChunks ?? undefined,
  })

  const { data: assistantMessage, error: amErr } = await supabase
    .from("gob_chat_messages")
    .insert({
      thread_id: threadId,
      workspace_id: workspaceId,
      role: "assistant",
      content: assistantText,
      citations,
      created_at: new Date().toISOString(),
      model,
      usage: withAssistantReport({ usage, report: assistantReport }),
    })
    .select("id,role,content,created_at,citations,model,usage")
    .single()

  if (amErr) return NextResponse.json({ error: amErr.message }, { status: 500 })

  await recordRetrievalTrace({
    supabase,
    workspaceId,
    stage: "chat",
    provider: retrievalProvider,
    query: question,
    filters: retrievalFilters,
    results: traceResults,
    responseId: retrievalResponseId,
    model: retrievalModel,
    createdBy: user.id,
    threadId,
    messageId: assistantMessage.id,
    metadata: {
      user_message_id: userMessage.id,
      assistant_message_id: assistantMessage.id,
      mode: effectiveMode,
      response_profile_requested: requestedResponseProfile,
      response_profile_resolved: resolvedResponseProfile,
      question_difficulty: questionDifficulty,
      rag_pipeline: ragExecutionPlan.pipeline,
      evidence_count: evidence.length,
      retrieval_ms: retrievalElapsedMs,
      generation_ms: generationElapsedMs,
      total_ms: totalElapsedMs,
      retrieval_profile: profile,
      source_scope: retrievalExpandedToMemberWorkspaces
        ? "workspace_plus_members"
        : "workspace_only",
      retrieval_workspace_ids: retrievalWorkspaceIdsUsed,
      retrieval_workspace_count: retrievalWorkspaceIdsUsed.length,
      retrieval_queries: retrievalQueries,
      retrieval_intent_hints: queryIntent.retrievalHints,
      retrieval_preferred_doc_roles: queryIntent.preferredDocRoles,
      retrieval_graph_related_roles: graphRelatedRoles,
      retrieval_graph_related_queries: graphRelatedQueries,
      retrieval_agent_plan_tools: agentPlanTools,
      retrieval_agent_plan_rationale: agentPlanRationale,
      retrieval_agent_plan_model: agentPlanModel,
      retrieval_agent_tool_budget: agentToolBudget,
      retrieval_agent_tool_steps_used: agentToolStepsUsed,
      retrieval_agent_budget_exhausted: agentBudgetExhausted,
      retrieval_agent_corrective_rationale: Array.from(new Set(agentCorrectiveRationale)).slice(0, 6),
      retrieval_agent_stop_reason: agentStopReason,
      retrieval_agent_verification_reports: agentVerificationReports.slice(0, 6),
      retrieval_question_type: queryIntent.questionType,
      retrieval_intent_complexity: queryIntent.complexity,
      retrieval_intent_used_llm: Boolean(queryIntent.usedLlm),
      retrieval_intent_model: queryIntent.model,
      retrieval_hyde_applied: retrievalHydeApplied,
      retrieval_hyde_model: retrievalHydeModel,
      retrieval_hyde_queries: retrievalHydeQueries,
      retrieval_query_count: retrievalQueries.length,
      retrieval_target_count: targetEvidenceCount,
      retrieval_expanded_scope: retrievalExpandedToMemberWorkspaces,
      retrieval_deepened: retrievalDeepened,
      retrieval_extra_queries: Array.from(new Set(retrievalExtraQueriesUsed)),
      retrieval_corrective_applied: correctiveApplied,
      retrieval_corrective_quality: correctiveQuality,
      retrieval_corrective_reason: correctiveReason,
      retrieval_corrective_model: correctiveModel,
      retrieval_corrective_iterations: correctiveIterations,
      retrieval_corrective_queries: Array.from(new Set(correctiveQueriesUsed)),
      retrieval_corrective_early_exit: correctiveEarlyExit,
      retrieval_coverage_before: retrievalCoverageBefore,
      retrieval_coverage_after: retrievalCoverageAfter,
      retrieval_rerank_applied: retrievalRerankApplied,
      retrieval_rerank_model: retrievalRerankModel,
      attached_source_id: attachedSourceId,
      attached_snapshot_id: attachedSnapshotId,
      attached_source_title: attachedSourceTitle,
      attached_chunks: attachedEvidence.length,
      answer_model: model,
      answer_tokens: usageTotalTokens(usage),
      answer_prompt_tokens: usagePromptTokens(usage),
      answer_completion_tokens: usageCompletionTokens(usage),
      answer_verification_applied: answerVerificationApplied,
      answer_verification_model: answerVerificationModel,
      answer_verification_dropped_paragraphs: answerVerificationDroppedParagraphs,
      answer_reflection_applied: answerReflectionApplied,
      answer_reflection_model: answerReflectionModel,
      answer_reflection_issues: answerReflectionIssues,
      answer_support_strength: answerSupportStrength,
      answer_support_reason: answerSupportReason,
      answer_support_paragraph_ratio: answerSupportParagraphRatio,
      answer_support_candidate_paragraphs: answerSupportCandidateParagraphs,
      answer_support_supported_paragraphs: answerSupportSupportedParagraphs,
      answer_support_unique_citation_chunks: answerSupportUniqueCitationChunks,
      answer_rescue_applied: answerRescueApplied,
      answer_rescue_kind: answerRescueKind,
      answer_contract_max_bullets: answerContract.maxBullets,
      answer_contract_min_citations: answerContract.minCitations,
      answer_contract_specific_precedent_query: answerContract.isSpecificPrecedentQuery,
      answer_contract_entity_tokens: answerContract.entityTokens,
      answer_contract_entity_matched_chunks: specificCoverage.matchedChunks,
      answer_contract_entity_snapshot_count: specificCoverage.snapshotCount,
      answer_contract_adjustments: answerContractAdjustments,
      generation_error: generationError,
      cited_chunks: citations.map((c) => c.chunkId),
      cited_chunks_count: citations.length,
    },
  }).catch(() => null)

  if (threadId) {
    const persistedThreadMemory = buildPersistedThreadMemory({
      messages: recentThreadMessages,
      currentQuestion: question,
      assistantAnswer: contractAdjusted.answer,
    })
    await supabase
      .from("gob_chat_threads")
      .update({
        updated_at: new Date().toISOString(),
        memory_summary: persistedThreadMemory.summary,
        memory_role_tokens: persistedThreadMemory.roleTokens,
        memory_updated_at: new Date().toISOString(),
      })
      .eq("id", threadId)
      .eq("workspace_id", workspaceId)
  }

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "chat.ask",
    target_resource: "gob_chat_messages",
    details: {
      workspace_id: workspaceId,
      thread_id: threadId,
      mode: effectiveMode,
      question,
      retrieval_provider: retrievalProvider,
      retrieval_response_id: retrievalResponseId,
      retrieval_model: retrievalModel,
      retrieval_filters: retrievalFilters,
      retrieval_intent_hints: queryIntent.retrievalHints,
      retrieval_preferred_doc_roles: queryIntent.preferredDocRoles,
      retrieval_graph_related_roles: graphRelatedRoles,
      retrieval_graph_related_queries: graphRelatedQueries,
      retrieval_agent_plan_tools: agentPlanTools,
      retrieval_agent_plan_rationale: agentPlanRationale,
      retrieval_agent_plan_model: agentPlanModel,
      retrieval_agent_tool_budget: agentToolBudget,
      retrieval_agent_tool_steps_used: agentToolStepsUsed,
      retrieval_agent_budget_exhausted: agentBudgetExhausted,
      retrieval_agent_corrective_rationale: Array.from(new Set(agentCorrectiveRationale)).slice(0, 6),
      retrieval_agent_stop_reason: agentStopReason,
      retrieval_agent_verification_reports: agentVerificationReports.slice(0, 6),
      retrieval_question_type: queryIntent.questionType,
      retrieval_intent_complexity: queryIntent.complexity,
      retrieval_intent_used_llm: Boolean(queryIntent.usedLlm),
      retrieval_intent_model: queryIntent.model,
      response_profile_requested: requestedResponseProfile,
      response_profile_resolved: resolvedResponseProfile,
      question_difficulty: questionDifficulty,
      rag_pipeline: ragExecutionPlan.pipeline,
      retrieval_ms: retrievalElapsedMs,
      generation_ms: generationElapsedMs,
      total_ms: totalElapsedMs,
      answer_model: model,
      answer_tokens: usageTotalTokens(usage),
      answer_prompt_tokens: usagePromptTokens(usage),
      answer_completion_tokens: usageCompletionTokens(usage),
      answer_verification_applied: answerVerificationApplied,
      answer_verification_model: answerVerificationModel,
      answer_verification_dropped_paragraphs: answerVerificationDroppedParagraphs,
      answer_reflection_applied: answerReflectionApplied,
      answer_reflection_model: answerReflectionModel,
      answer_reflection_issues: answerReflectionIssues,
      defense_coverage_status: defenseCoverageStatus,
      defense_missing_roles: defenseMissingRoles,
      defense_role_counts: defenseRoleCounts,
      answer_support_strength: answerSupportStrength,
      answer_support_reason: answerSupportReason,
      answer_support_paragraph_ratio: answerSupportParagraphRatio,
      answer_support_candidate_paragraphs: answerSupportCandidateParagraphs,
      answer_support_supported_paragraphs: answerSupportSupportedParagraphs,
      answer_support_unique_citation_chunks: answerSupportUniqueCitationChunks,
      answer_rescue_applied: answerRescueApplied,
      answer_rescue_kind: answerRescueKind,
      answer_contract_max_bullets: answerContract.maxBullets,
      answer_contract_min_citations: answerContract.minCitations,
      answer_contract_specific_precedent_query: answerContract.isSpecificPrecedentQuery,
      answer_contract_entity_tokens: answerContract.entityTokens,
      answer_contract_entity_matched_chunks: specificCoverage.matchedChunks,
      answer_contract_entity_snapshot_count: specificCoverage.snapshotCount,
      answer_contract_adjustments: answerContractAdjustments,
      generation_error: generationError,
      evidence_count: evidence.length,
      cited_chunks: citations.map((c) => c.chunkId),
      cited_chunks_count: citations.length,
      source_scope: retrievalExpandedToMemberWorkspaces
        ? "workspace_plus_members"
        : "workspace_only",
      retrieval_workspace_ids: retrievalWorkspaceIdsUsed,
      retrieval_workspace_count: retrievalWorkspaceIdsUsed.length,
      retrieval_queries: retrievalQueries,
      retrieval_query_count: retrievalQueries.length,
      retrieval_target_count: targetEvidenceCount,
      retrieval_expanded_scope: retrievalExpandedToMemberWorkspaces,
      retrieval_deepened: retrievalDeepened,
      retrieval_extra_queries: Array.from(new Set(retrievalExtraQueriesUsed)),
      retrieval_hyde_applied: retrievalHydeApplied,
      retrieval_hyde_model: retrievalHydeModel,
      retrieval_hyde_queries: retrievalHydeQueries,
      retrieval_corrective_applied: correctiveApplied,
      retrieval_corrective_quality: correctiveQuality,
      retrieval_corrective_reason: correctiveReason,
      retrieval_corrective_model: correctiveModel,
      retrieval_corrective_iterations: correctiveIterations,
      retrieval_corrective_queries: Array.from(new Set(correctiveQueriesUsed)),
      retrieval_corrective_early_exit: correctiveEarlyExit,
      retrieval_coverage_before: retrievalCoverageBefore,
      retrieval_coverage_after: retrievalCoverageAfter,
      retrieval_rerank_applied: retrievalRerankApplied,
      retrieval_rerank_model: retrievalRerankModel,
      attached_source_id: attachedSourceId,
      attached_snapshot_id: attachedSnapshotId,
      attached_source_title: attachedSourceTitle,
      attached_chunks: attachedEvidence.length,
    },
    timestamp: now,
  })

  return NextResponse.json({ userMessage, assistantMessage })
}
