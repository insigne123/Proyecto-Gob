import { generateOpenAIJson } from "@/lib/llm/openai-json"
import { resolveOpenAIFastModel } from "@/lib/openai-models"
import type { RagQueryIntent } from "@/lib/rag/query-intent"
import type { AnswerMode, QuestionDifficulty } from "@/lib/rag/strict-answer"
import type { ResolvedResponseProfile } from "@/lib/rag/router"
import type { StructuredOnboardingMemory } from "@/lib/onboarding/structured-memory"

export type StrategicAgentPlan = {
  applied: boolean
  toolOrder: Array<"memory" | "facts" | "graph" | "local" | "managed">
  subqueries: string[]
  rationale: string[]
  model: string | null
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

function uniqueStrings(values: unknown[], max = 8) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = String(value ?? "").replace(/\s+/g, " ").trim()
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
    if (out.length >= max) break
  }
  return out
}

function heuristicPlan(params: {
  question: string
  intent: RagQueryIntent
  structuredMemory?: StructuredOnboardingMemory | null
  graphRelatedRoles?: string[]
}) {
  const toolOrder: StrategicAgentPlan["toolOrder"] = ["memory"]
  if (params.intent.needsFactsFirst) toolOrder.push("facts")
  if (params.intent.needsGraphLookup || (params.graphRelatedRoles || []).length) toolOrder.push("graph")
  toolOrder.push("local", "managed")

  const memoryRoleHints = (params.structuredMemory?.preferredCauses || [])
    .slice(0, 3)
    .map((row) => String(row.rol || "").trim())
    .filter(Boolean)

  const subqueries = uniqueStrings([
    params.question,
    ...(params.intent.preferredDocRoles.map((role) => `${params.question} ${role}`) || []),
    ...(params.graphRelatedRoles || []).slice(0, 2).map((rol) => `${rol} ${params.question}`),
    ...memoryRoleHints.slice(0, 2).map((rol) => `${rol} ${params.question}`),
  ], 6)

  const rationale = uniqueStrings([
    params.intent.needsFactsFirst ? "Resolver primero hechos directos y luego complementar con contexto." : "Usar memoria y evidencia contextual antes de profundizar retrieval.",
    params.intent.needsGraphLookup ? "Consultar relaciones entre causas, normas y materias comparables." : "",
    params.intent.preferredDocRoles.length
      ? `Priorizar roles documentales ${params.intent.preferredDocRoles.join(", ")}.`
      : "",
  ], 4)

  return {
    applied: toolOrder.length > 0,
    toolOrder: uniqueStrings(toolOrder, 5) as StrategicAgentPlan["toolOrder"],
    subqueries,
    rationale,
    model: null,
  }
}

export async function buildStrategicAgentPlan(params: {
  question: string
  mode: AnswerMode
  difficulty: QuestionDifficulty
  responseProfile: ResolvedResponseProfile
  intent: RagQueryIntent
  structuredMemory?: StructuredOnboardingMemory | null
  graphRelatedRoles?: string[]
}) {
  const base = heuristicPlan(params)
  const enabled = boolEnv("RAG_ENABLE_AGENT_PLANNER", true)
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim()
  const shouldApply =
    params.responseProfile === "deep" ||
    params.mode === "comparison" ||
    params.intent.needsMultiCause ||
    params.intent.needsGraphLookup ||
    params.difficulty === "complex"

  if (!enabled || !apiKey || !shouldApply) {
    return {
      ...base,
      applied: shouldApply && base.subqueries.length > 0,
    }
  }

  try {
    const generated = await generateOpenAIJson({
      system:
        "Eres un planner de retrieval juridico. Diseñas un plan corto y conservador para responder preguntas complejas con herramientas memory, facts, graph, local y managed.",
      prompt:
        `Pregunta: ${params.question}\n` +
        `Modo: ${params.mode}\n` +
        `Dificultad: ${params.difficulty}\n` +
        `Perfil: ${params.responseProfile}\n` +
        `Intent heuristico: ${JSON.stringify({
          questionType: params.intent.questionType,
          complexity: params.intent.complexity,
          preferredDocRoles: params.intent.preferredDocRoles,
          needsFactsFirst: params.intent.needsFactsFirst,
          needsMultiCause: params.intent.needsMultiCause,
          needsGraphLookup: params.intent.needsGraphLookup,
        })}\n` +
        `Plan base: ${JSON.stringify(base)}\n` +
        `Roles desde grafo: ${(params.graphRelatedRoles || []).join(", ") || "ninguno"}`,
      schemaName: "strategic_agent_plan",
      schema: {
        type: "object",
        properties: {
          toolOrder: {
            type: "array",
            items: { type: "string", enum: ["memory", "facts", "graph", "local", "managed"] },
          },
          subqueries: { type: "array", items: { type: "string" } },
          rationale: { type: "array", items: { type: "string" } },
        },
        required: ["toolOrder", "subqueries", "rationale"],
        additionalProperties: false,
      },
      model: String(process.env.OPENAI_AGENT_PLANNER_MODEL || resolveOpenAIFastModel()),
      maxCompletionTokens: 320,
      reasoningEffort: "minimal",
    })

    return {
      applied: true,
      toolOrder: uniqueStrings((generated.output as any)?.toolOrder || base.toolOrder, 5) as StrategicAgentPlan["toolOrder"],
      subqueries: uniqueStrings((generated.output as any)?.subqueries || base.subqueries, 6),
      rationale: uniqueStrings((generated.output as any)?.rationale || base.rationale, 5),
      model: generated.model,
    }
  } catch {
    return {
      ...base,
      applied: true,
    }
  }
}
