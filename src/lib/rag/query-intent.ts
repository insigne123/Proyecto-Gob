import { generateOpenAIJson } from "@/lib/llm/openai-json"
import { resolveOpenAIFastModel } from "@/lib/openai-models"

export type PreferredTribunalDocRole = "informe" | "sentencia" | "reclamacion"

export type RagQuestionType = "factual" | "strategic" | "comparative" | "procedural" | "writing"
export type RagQueryComplexity = "simple" | "medium" | "complex"

export type RagQueryIntent = {
  roleToken: string | null
  preferredDocRoles: PreferredTribunalDocRole[]
  questionType: RagQuestionType
  complexity: RagQueryComplexity
  asksForDefenseCriteria: boolean
  asksForOutcome: boolean
  asksForProcedureState: boolean
  asksForWriting: boolean
  asksForComparison: boolean
  asksForDocumentPriority: boolean
  asksForContextUse: boolean
  needsFactsFirst: boolean
  needsMultiCause: boolean
  needsGraphLookup: boolean
  retrievalHints: string[]
  usedLlm?: boolean
  model?: string | null
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

function uniqueStrings(values: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = String(value || "").trim()
    if (!clean) continue
    const key = normalize(clean)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(clean)
  }
  return out
}

export function extractRoleToken(question: string) {
  const match = String(question || "").match(/\bR-\d{1,5}-\d{4}\b/i)
  if (!match) return null
  return String(match[0]).toUpperCase()
}

export function inferRagQueryIntent(question: string): RagQueryIntent {
  const normalized = normalize(question)
  const roleToken = extractRoleToken(question)

  const asksForDefenseCriteria =
    normalized.includes("criterio") ||
    normalized.includes("criterios") ||
    normalized.includes("defensa") ||
    normalized.includes("estrategia") ||
    normalized.includes("argumento") ||
    normalized.includes("argumentacion") ||
    normalized.includes("sea")

  const asksForOutcome =
    normalized.includes("terminaron") ||
    normalized.includes("termino") ||
    normalized.includes("resultado") ||
    normalized.includes("fallo") ||
    normalized.includes("sentencia") ||
    normalized.includes("resolucion") ||
    normalized.includes("acog") ||
    normalized.includes("rechaz")

  const asksForProcedureState =
    normalized.includes("estado") ||
    normalized.includes("movimiento") ||
    normalized.includes("tramite") ||
    normalized.includes("tramitacion") ||
    normalized.includes("alegato")

  const asksForWriting =
    normalized.includes("redaccion") ||
    normalized.includes("escribir") ||
    normalized.includes("borrador") ||
    normalized.includes("mejorar") ||
    normalized.includes("revisar")

  const asksForComparison =
    normalized.includes("compar") ||
    normalized.includes("diferencia") ||
    normalized.includes("versus") ||
    normalized.includes("similares") ||
    normalized.includes("precedentes")

  const factualSignals =
    normalized.includes("foja") ||
    normalized.includes("reclamante") ||
    normalized.includes("fecha") ||
    normalized.includes("cuando") ||
    normalized.includes("existe") ||
    normalized.includes("hay") ||
    normalized.includes("que resolucion") ||
    normalized.includes("se resuelve")

  const asksForDocumentPriority =
    normalized.includes("prioriz") ||
    (normalized.includes("que documentos") &&
      (normalized.includes("defensa") || normalized.includes("marco teorico")))

  const asksForContextUse =
    (normalized.includes("contexto") && explicitReclamacionLike(normalized)) ||
    (normalized.includes("prueba principal") && explicitReclamacionLike(normalized)) ||
    normalized.includes("como debe usarse la reclamacion")

  const explicitInforme = normalized.includes("informe") || normalized.includes("evacua")
  const explicitSentencia =
    normalized.includes("sentencia") || normalized.includes("fallo") || normalized.includes("resolucion")
  const explicitReclamacion =
    normalized.includes("reclamacion") || normalized.includes("demanda") || normalized.includes("escrito inicial")

  const needsMultiCause =
    asksForComparison ||
    normalized.includes("precedente") ||
    normalized.includes("precedentes") ||
    normalized.includes("similares") ||
    normalized.includes("varias causas") ||
    normalized.includes("otras causas") ||
    normalized.includes("jurisprudencia")

  const needsGraphLookup =
    needsMultiCause ||
    normalized.includes("norma") ||
    normalized.includes("articulo") ||
    normalized.includes("autoridad") ||
    normalized.includes("materia") ||
    normalized.includes("criterio consistente")

  const needsFactsFirst = factualSignals && !asksForComparison && !asksForWriting && !asksForDefenseCriteria

  const questionType: RagQuestionType = asksForWriting
    ? "writing"
    : asksForProcedureState
      ? "procedural"
      : asksForComparison || needsMultiCause
        ? "comparative"
        : needsFactsFirst
          ? "factual"
          : "strategic"

  const complexity: RagQueryComplexity =
    questionType === "factual" && !needsMultiCause
      ? "simple"
      : questionType === "comparative" || normalized.includes("marco teorico") || normalized.includes("jurisprudencia")
        ? "complex"
        : "medium"

  const preferredDocRoles: PreferredTribunalDocRole[] = []
  const pushRole = (role: PreferredTribunalDocRole) => {
    if (!preferredDocRoles.includes(role)) preferredDocRoles.push(role)
  }

  if (asksForDocumentPriority) {
    pushRole("informe")
    pushRole("sentencia")
  }

  if (asksForContextUse) {
    pushRole("sentencia")
    pushRole("informe")
    pushRole("reclamacion")
  } else {
    if (explicitInforme || asksForDefenseCriteria) pushRole("informe")
    if (explicitSentencia || asksForOutcome || asksForDocumentPriority) pushRole("sentencia")
    if (explicitReclamacion || (!preferredDocRoles.length && asksForComparison)) pushRole("reclamacion")
  }

  if (!preferredDocRoles.length) {
    pushRole("informe")
    pushRole("sentencia")
    pushRole("reclamacion")
  }

  const retrievalHints = uniqueStrings([
    asksForDefenseCriteria ? "evacua informe defensa sea criterios argumentos tecnicos" : "",
    asksForOutcome ? "sentencia resolucion final resultado fundamentos decision" : "",
    asksForProcedureState ? "estado procesal movimiento tramitacion" : "",
    asksForComparison ? "precedentes comparables criterios consistentes" : "",
    asksForDocumentPriority ? "priorizar informe sentencia antes que reclamacion para marco teorico de defensa" : "",
    asksForContextUse ? "reclamacion como contexto secundario no como prueba principal" : "",
    asksForWriting ? "estructura del escrito defensa observaciones mejora redaccion" : "",
  ]).slice(0, 4)

  return {
    roleToken,
    preferredDocRoles,
    questionType,
    complexity,
    asksForDefenseCriteria,
    asksForOutcome,
    asksForProcedureState,
    asksForWriting,
    asksForComparison,
    asksForDocumentPriority,
    asksForContextUse,
    needsFactsFirst,
    needsMultiCause,
    needsGraphLookup,
    retrievalHints,
    usedLlm: false,
    model: null,
  }
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

function normalizeQuestionType(value: unknown): RagQuestionType | null {
  const normalized = normalize(String(value || ""))
  if (normalized === "factual") return "factual"
  if (normalized === "strategic") return "strategic"
  if (normalized === "comparative") return "comparative"
  if (normalized === "procedural") return "procedural"
  if (normalized === "writing") return "writing"
  return null
}

function normalizeComplexity(value: unknown): RagQueryComplexity | null {
  const normalized = normalize(String(value || ""))
  if (normalized === "simple") return "simple"
  if (normalized === "medium") return "medium"
  if (normalized === "complex") return "complex"
  return null
}

function normalizePreferredRoles(values: unknown, fallback: PreferredTribunalDocRole[]) {
  const out: PreferredTribunalDocRole[] = []
  for (const raw of Array.isArray(values) ? values : []) {
    const normalized = normalize(String(raw || ""))
    if (normalized === "informe" || normalized === "sentencia" || normalized === "reclamacion") {
      if (!out.includes(normalized)) out.push(normalized)
    }
  }
  return out.length ? out : fallback
}

function mergeRagQueryIntent(base: RagQueryIntent, override: Partial<RagQueryIntent>): RagQueryIntent {
  return {
    ...base,
    ...override,
    preferredDocRoles: normalizePreferredRoles(override.preferredDocRoles, base.preferredDocRoles),
    questionType: normalizeQuestionType(override.questionType) || base.questionType,
    complexity: normalizeComplexity(override.complexity) || base.complexity,
    retrievalHints: uniqueStrings([
      ...(Array.isArray(override.retrievalHints) ? override.retrievalHints.map((item) => String(item || "")) : []),
      ...base.retrievalHints,
    ]).slice(0, 6),
    usedLlm: typeof override.usedLlm === "boolean" ? override.usedLlm : base.usedLlm,
    model: typeof override.model === "string" ? override.model : base.model ?? null,
  }
}

export async function inferRagQueryIntentWithLlm(question: string): Promise<RagQueryIntent> {
  const heuristic = inferRagQueryIntent(question)
  const enabled = boolEnv("RAG_ENABLE_LLM_QUERY_INTENT", true)
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim()
  if (!enabled || !apiKey) return heuristic

  try {
    const generated = await generateOpenAIJson({
      system:
        "Eres un clasificador de intent para un sistema RAG juridico chileno. Clasifica la pregunta de forma conservadora. No inventes roles documentales no pedidos.",
      prompt:
        `Pregunta del usuario:\n${question}\n\n` +
        `Base heuristica:\n${JSON.stringify({
          roleToken: heuristic.roleToken,
          preferredDocRoles: heuristic.preferredDocRoles,
          questionType: heuristic.questionType,
          complexity: heuristic.complexity,
          asksForDefenseCriteria: heuristic.asksForDefenseCriteria,
          asksForOutcome: heuristic.asksForOutcome,
          asksForProcedureState: heuristic.asksForProcedureState,
          asksForWriting: heuristic.asksForWriting,
          asksForComparison: heuristic.asksForComparison,
          asksForDocumentPriority: heuristic.asksForDocumentPriority,
          asksForContextUse: heuristic.asksForContextUse,
          needsFactsFirst: heuristic.needsFactsFirst,
          needsMultiCause: heuristic.needsMultiCause,
          needsGraphLookup: heuristic.needsGraphLookup,
          retrievalHints: heuristic.retrievalHints,
        })}\n\n` +
        "Devuelve una clasificacion estructurada. Si la heuristica ya es correcta, puedes mantenerla.",
      schemaName: "rag_query_intent_v2",
      schema: {
        type: "object",
        properties: {
          preferredDocRoles: {
            type: "array",
            items: { type: "string", enum: ["informe", "sentencia", "reclamacion"] },
          },
          questionType: {
            type: "string",
            enum: ["factual", "strategic", "comparative", "procedural", "writing"],
          },
          complexity: {
            type: "string",
            enum: ["simple", "medium", "complex"],
          },
          asksForDefenseCriteria: { type: "boolean" },
          asksForOutcome: { type: "boolean" },
          asksForProcedureState: { type: "boolean" },
          asksForWriting: { type: "boolean" },
          asksForComparison: { type: "boolean" },
          asksForDocumentPriority: { type: "boolean" },
          asksForContextUse: { type: "boolean" },
          needsFactsFirst: { type: "boolean" },
          needsMultiCause: { type: "boolean" },
          needsGraphLookup: { type: "boolean" },
          retrievalHints: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: [
          "preferredDocRoles",
          "questionType",
          "complexity",
          "asksForDefenseCriteria",
          "asksForOutcome",
          "asksForProcedureState",
          "asksForWriting",
          "asksForComparison",
          "asksForDocumentPriority",
          "asksForContextUse",
          "needsFactsFirst",
          "needsMultiCause",
          "needsGraphLookup",
          "retrievalHints",
        ],
        additionalProperties: false,
      },
      model: String(process.env.OPENAI_QUERY_INTENT_MODEL || resolveOpenAIFastModel()),
      maxCompletionTokens: 320,
      reasoningEffort: "minimal",
    })

    return mergeRagQueryIntent(heuristic, {
      ...((generated.output as any) || {}),
      usedLlm: true,
      model: generated.model,
    })
  } catch {
    return heuristic
  }
}

function explicitReclamacionLike(normalized: string) {
  return (
    normalized.includes("reclamacion") ||
    normalized.includes("demanda") ||
    normalized.includes("escrito inicial")
  )
}
