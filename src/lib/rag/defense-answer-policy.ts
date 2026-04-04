import type { StructuredOnboardingMemory } from "@/lib/onboarding/structured-memory"
import type { RagQueryIntent } from "@/lib/rag/query-intent"
import type { AnswerMode, EvidenceChunk } from "@/lib/rag/strict-answer"
import {
  inferDefenseDocumentRole,
  summarizeDefenseDocumentCoverage,
  type StrictDefenseDocumentRole,
} from "@/lib/tribunal/defense-document-policy"

export type DefenseAnswerPolicy = {
  requiredRoles: StrictDefenseDocumentRole[]
  targetedQueries: string[]
  instructions: string[]
  strict: boolean
}

export type DefenseEvidenceCoverage = {
  counts: Record<StrictDefenseDocumentRole, number>
  requiredRoles: StrictDefenseDocumentRole[]
  missingRequiredRoles: StrictDefenseDocumentRole[]
  status: "not_applicable" | "ready" | "partial" | "insufficient"
  targetedQueries: string[]
}

function uniqueRoles(roles: Array<StrictDefenseDocumentRole | null | undefined>) {
  const seen = new Set<StrictDefenseDocumentRole>()
  const out: StrictDefenseDocumentRole[] = []
  for (const role of roles) {
    if (!role || seen.has(role)) continue
    seen.add(role)
    out.push(role)
  }
  return out
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = String(value || "").replace(/\s+/g, " ").trim()
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
  }
  return out
}

function roleQueries(role: StrictDefenseDocumentRole, question: string) {
  const base = String(question || "").trim()
  if (role === "informe") {
    return [
      `${base} evacua informe criterios defensa SEA`,
      "evacua informe defensa sea fundamentos tecnicos",
    ]
  }
  if (role === "sentencia") {
    return [
      `${base} sentencia resolucion final`,
      "sentencia resultado final ratio decidendi fundamentos decision",
    ]
  }
  return [
    `${base} reclamacion escrito inicial contexto`,
    "reclamacion escrito inicial hechos y pretensiones",
  ]
}

export function buildDefenseAnswerPolicy(params: {
  question: string
  intent: RagQueryIntent
  mode: AnswerMode
  responseProfile: "fast" | "balanced" | "deep"
  structuredMemory?: StructuredOnboardingMemory | null
}) {
  const requiredRoles = uniqueRoles([
    params.intent.asksForDocumentPriority ? "informe" : null,
    params.intent.asksForDocumentPriority ? "sentencia" : null,
    params.intent.asksForContextUse ? "informe" : null,
    params.intent.asksForContextUse ? "sentencia" : null,
    params.intent.asksForDefenseCriteria ? "informe" : null,
    params.intent.asksForOutcome ? "sentencia" : null,
    params.intent.asksForComparison && params.mode !== "extractive" ? "sentencia" : null,
  ])

  const memoryRoles = uniqueRoles(
    Array.isArray(params.structuredMemory?.keyDocuments)
      ? params.structuredMemory!.keyDocuments.map((doc) => inferDefenseDocumentRole({ docRole: doc.docRole, name: doc.name }))
      : []
  )

  const strict =
    params.responseProfile !== "fast" &&
    (params.intent.asksForDocumentPriority ||
      params.intent.asksForContextUse ||
      params.intent.asksForOutcome ||
      (params.intent.asksForDefenseCriteria && params.intent.asksForComparison))

  const instructions = uniqueStrings([
    params.intent.asksForDocumentPriority
      ? "Abre con el orden documental recomendado. Si la evidencia lo permite, nombra explicitamente informe y sentencia antes de cualquier reclamacion."
      : "",
    params.intent.asksForContextUse
      ? "En la primera oracion responde de forma binaria: 'contexto' o 'prueba principal'. Si no tienes respaldo suficiente, dilo explicitamente."
      : "",
    params.intent.asksForOutcome
      ? "Si la pregunta pide resultado o resolucion, apoya la respuesta en sentencia o resolucion final; no extrapoles desde la reclamacion."
      : "",
    params.intent.asksForDefenseCriteria
      ? "Si la pregunta pide criterios defensivos del SEA, privilegia informes o documentos equivalentes del SEA antes que escritos de parte."
      : "",
    memoryRoles.includes("sentencia")
      ? "La memoria estructurada ya identifica sentencias utiles; incluyelas si la evidencia recuperada las sostiene."
      : "",
  ])

  const targetedQueries = uniqueStrings(requiredRoles.flatMap((role) => roleQueries(role, params.question))).slice(0, 6)

  return {
    requiredRoles,
    targetedQueries,
    instructions,
    strict,
  } satisfies DefenseAnswerPolicy
}

export function summarizeDefenseEvidenceCoverage(params: {
  evidence: EvidenceChunk[]
  requiredRoles: StrictDefenseDocumentRole[]
}) {
  const docs = (Array.isArray(params.evidence) ? params.evidence : []).map((chunk) => ({
    docRole: chunk.docRole,
    document_type: chunk.documentType,
    name: chunk.documentTitle,
    title: chunk.documentType,
    section: chunk.section,
  }))

  const coverage = summarizeDefenseDocumentCoverage(docs)
  const missingRequiredRoles = params.requiredRoles.filter((role) => coverage.counts[role] <= 0)

  let status: DefenseEvidenceCoverage["status"] = "not_applicable"
  if (params.requiredRoles.length > 0) {
    if (missingRequiredRoles.length === 0) status = "ready"
    else if (missingRequiredRoles.length < params.requiredRoles.length) status = "partial"
    else status = "insufficient"
  }

  return {
    counts: coverage.counts,
    requiredRoles: params.requiredRoles,
    missingRequiredRoles,
    status,
    targetedQueries: uniqueStrings(missingRequiredRoles.flatMap((role) => roleQueries(role, ""))).slice(0, 4),
  } satisfies DefenseEvidenceCoverage
}

export function shouldForceDefenseAbstention(params: {
  policy: DefenseAnswerPolicy
  coverage: DefenseEvidenceCoverage
  supportStrength: "none" | "weak" | "partial" | "strong" | null
}) {
  if (!params.policy.strict || params.coverage.requiredRoles.length === 0) return false
  if (params.coverage.status === "insufficient") return true
  if (params.coverage.status === "partial") {
    return params.supportStrength === "none" || params.supportStrength === "weak"
  }
  return false
}
