import { classifyTribunalDocumentRole } from "@/lib/tribunal/document-role"
import { selectDefenseDocumentMix } from "@/lib/tribunal/defense-document-policy"

export type StructuredOnboardingCauseMemory = {
  causeId: string
  rol: string | null
  score: number | null
  confidence: string | null
  riskLevel: string | null
  reason: string | null
  defenseSummary: string | null
}

export type StructuredOnboardingDocumentMemory = {
  causeId: string | null
  rol: string | null
  name: string | null
  url: string | null
  docRole: string | null
  contribution: string | null
}

export type StructuredOnboardingMemory = {
  version: number
  summary: string | null
  defenseHypothesis: string | null
  defenseCriteria: string[]
  documentPriorityRules: string[]
  outcomeLessons: string[]
  misuseRisks: string[]
  contextFacts: string[]
  precedentRationales: string[]
  preferredCauses: StructuredOnboardingCauseMemory[]
  keyDocuments: StructuredOnboardingDocumentMemory[]
}

type StructuredMemoryArtifactNote = {
  title?: string | null
  content?: string | null
}

type StructuredMemoryArtifactReference = {
  causeId?: string | null
  rol?: string | null
  sourceTitle?: string | null
  documentName?: string | null
  docRole?: string | null
  documentUrl?: string | null
}

function safeText(value: unknown, max = 500) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function uniqueStrings(values: unknown[], max = 10) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = safeText(value, 700)
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
    if (out.length >= max) break
  }
  return out
}

function normalizeCauseMemory(value: any): StructuredOnboardingCauseMemory | null {
  const causeId = String(value?.causeId || "").trim()
  if (!causeId) return null
  return {
    causeId,
    rol: value?.rol ? String(value.rol) : null,
    score: typeof value?.score === "number" ? Number(value.score) : null,
    confidence: value?.confidence ? String(value.confidence) : null,
    riskLevel: value?.riskLevel ? String(value.riskLevel) : null,
    reason: value?.reason ? safeText(value.reason, 300) : null,
    defenseSummary: value?.defenseSummary ? safeText(value.defenseSummary, 500) : null,
  }
}

function normalizeDocumentMemory(value: any): StructuredOnboardingDocumentMemory | null {
  const name = value?.name ? String(value.name) : null
  const url = value?.url ? String(value.url) : null
  const contribution = value?.contribution ? safeText(value.contribution, 400) : null
  const docRoleRaw = value?.docRole ? String(value.docRole) : null
  const docRole =
    docRoleRaw ||
    classifyTribunalDocumentRole({
      documentType: value?.documentType ? String(value.documentType) : name,
      name: name || value?.title || null,
      title: value?.title ? String(value.title) : value?.documentType ? String(value.documentType) : name,
    })
  if (!name && !url && !contribution) return null
  return {
    causeId: value?.causeId ? String(value.causeId) : null,
    rol: value?.rol ? String(value.rol) : null,
    name,
    url,
    docRole: docRole && docRole !== "documento" ? docRole : null,
    contribution,
  }
}

function extractRecommendationDocuments(recommendations: any[]) {
  return (Array.isArray(recommendations) ? recommendations : [])
    .flatMap((row: any) => {
      const causeId = row?.causeId ? String(row.causeId) : null
      const rol = row?.rol ? String(row.rol) : null
      const documents = Array.isArray(row?.selectedDocuments)
        ? row.selectedDocuments
        : Array.isArray(row?.interestingDocuments)
          ? row.interestingDocuments
          : []
      return documents.map((document: any) =>
        normalizeDocumentMemory({
          causeId,
          rol,
          name: document?.name,
          url: document?.url,
          docRole: document?.docRole,
          documentType: document?.documentType,
          contribution: document?.contribution || row?.defenseSummary || null,
        })
      )
    })
    .filter((row: StructuredOnboardingDocumentMemory | null): row is StructuredOnboardingDocumentMemory => Boolean(row))
}

function extractSectionBlock(content: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regex = new RegExp(`##\\s+${escaped}\\s*([\\s\\S]*?)(?=##\\s+|$)`, "i")
  const match = String(content || "").match(regex)
  return match?.[1] ? String(match[1]).trim() : ""
}

function extractBulletLines(section: string, max = 8) {
  const raw = String(section || "")
  const pieces = raw.includes("\n")
    ? raw.split(/\r?\n/)
    : raw.split(/\s+-\s+/)

  return pieces
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) || /^\d+[\.)]\s+/.test(line) || line.length > 12)
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+[\.)]\s+/, "").trim())
    .filter(Boolean)
    .slice(0, max)
}

function pickLatestMarcoNote(notes: StructuredMemoryArtifactNote[]) {
  return notes.find((note) => /marco teorico|informe automatico de marco teorico/i.test(String(note.title || ""))) || null
}

export function buildStructuredOnboardingMemory(payload: any): StructuredOnboardingMemory {
  const recommendations = Array.isArray(payload?.recommendations) ? payload.recommendations : []
  const matrix = Array.isArray(payload?.matrix) ? payload.matrix : []
  const structured = payload?.report?.structured && typeof payload.report.structured === "object" ? payload.report.structured : {}

  const preferredCauses = recommendations
    .map((row: any) => {
      const matrixRow = matrix.find((candidate: any) => String(candidate?.causeId || "") === String(row?.causeId || "")) || null
      return normalizeCauseMemory({
        causeId: row?.causeId,
        rol: row?.rol || matrixRow?.rol,
        score: row?.score,
        confidence: matrixRow?.confidence,
        riskLevel: matrixRow?.riskLevel,
        reason: row?.reason,
        defenseSummary: row?.defenseSummary || matrixRow?.document?.contribution || null,
      })
    })
    .filter((row: StructuredOnboardingCauseMemory | null): row is StructuredOnboardingCauseMemory => Boolean(row))
    .slice(0, 10)

  const recommendationDocuments = extractRecommendationDocuments(recommendations)
  const matrixDocuments = matrix
    .map((row: any) => {
      const document = row?.document || null
      if (!document) return null
      return normalizeDocumentMemory({
        causeId: row?.causeId,
        rol: row?.rol,
        name: document?.name,
        url: document?.url,
        docRole: document?.docRole,
        documentType: document?.documentType,
        contribution: document?.contribution,
      })
    })
    .filter((row: StructuredOnboardingDocumentMemory | null): row is StructuredOnboardingDocumentMemory => Boolean(row))
  const prioritizedKeyDocuments = prioritizeStructuredDocuments([
    ...recommendationDocuments,
    ...matrixDocuments,
  ]).slice(0, 16)

  const defenseCriteria = uniqueStrings(
    [
      ...(Array.isArray((structured as any)?.usefulCriteria) ? (structured as any).usefulCriteria : []),
      ...prioritizedKeyDocuments
        .filter((doc: StructuredOnboardingDocumentMemory) => doc.docRole === "informe")
        .map((doc: StructuredOnboardingDocumentMemory) => `${doc.rol || "Precedente"}: ${doc.contribution || "Criterio defensivo identificado en informe del SEA."}`),
    ],
    10
  )

  const outcomeLessons = uniqueStrings(
    [
      ...(Array.isArray((structured as any)?.misuseRisks) ? (structured as any).misuseRisks : []),
      ...prioritizedKeyDocuments
        .filter((doc: StructuredOnboardingDocumentMemory) => doc.docRole === "sentencia")
        .map((doc: StructuredOnboardingDocumentMemory) => `${doc.rol || "Precedente"}: ${doc.contribution || "Resultado relevante del precedente para evaluar si la estrategia funciono."}`),
    ],
    10
  )

  const contextFacts = uniqueStrings(
    [
      ...(Array.isArray((structured as any)?.comparableFacts) ? (structured as any).comparableFacts : []),
      ...preferredCauses.map((cause: StructuredOnboardingCauseMemory) => `${cause.rol || "Precedente"}: ${cause.reason || cause.defenseSummary || "Causa priorizada como contexto util."}`),
    ],
    10
  )

  const documentPriorityRules = uniqueStrings(
    [
      ...(Array.isArray((structured as any)?.documentPriorityRules) ? (structured as any).documentPriorityRules : []),
      prioritizedKeyDocuments.some((doc: StructuredOnboardingDocumentMemory) => doc.docRole === "informe")
        ? "Priorizar informes del SEA para sostener criterios tecnicos y lineas defensivas antes de usar otros documentos como soporte principal."
        : "",
      prioritizedKeyDocuments.some((doc: StructuredOnboardingDocumentMemory) => doc.docRole === "sentencia")
        ? "Usar sentencias para validar resultado, ratio y limites de extrapolacion del precedente."
        : "",
      prioritizedKeyDocuments.some((doc: StructuredOnboardingDocumentMemory) => doc.docRole === "reclamacion")
        ? "Usar reclamaciones como contexto factual y argumental, no como prueba principal, salvo requerimiento expreso."
        : "",
    ],
    8
  )

  const misuseRisks = uniqueStrings(
    [
      ...(Array.isArray((structured as any)?.misuseRisks) ? (structured as any).misuseRisks : []),
      ...outcomeLessons,
    ],
    10
  )

  const precedentRationales = uniqueStrings(
    [
      ...preferredCauses.map(
        (cause: StructuredOnboardingCauseMemory) =>
          `${cause.rol || "Precedente"}: ${cause.reason || cause.defenseSummary || "precedente util para sostener una linea de defensa comparable."}`
      ),
      ...prioritizedKeyDocuments.map(
        (doc: StructuredOnboardingDocumentMemory) =>
          `${doc.rol || doc.causeId || "Documento"} - ${doc.docRole || "documento"}: ${doc.contribution || "aporte relevante para la estrategia defensiva."}`
      ),
    ],
    10
  )

  return {
    version: 1,
    summary: payload?.summary ? safeText(payload.summary, 1200) : null,
    defenseHypothesis: (structured as any)?.defenseHypothesis ? safeText((structured as any).defenseHypothesis, 900) : null,
    defenseCriteria,
    documentPriorityRules,
    outcomeLessons,
    misuseRisks,
    contextFacts,
    precedentRationales,
    preferredCauses,
    keyDocuments: prioritizedKeyDocuments,
  }
}

export function normalizeStructuredOnboardingMemory(value: any): StructuredOnboardingMemory | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const preferredCauses = Array.isArray(value.preferredCauses)
    ? value.preferredCauses.map(normalizeCauseMemory).filter((row: StructuredOnboardingCauseMemory | null): row is StructuredOnboardingCauseMemory => Boolean(row)).slice(0, 10)
    : []
  const keyDocuments = Array.isArray(value.keyDocuments)
    ? value.keyDocuments.map(normalizeDocumentMemory).filter((row: StructuredOnboardingDocumentMemory | null): row is StructuredOnboardingDocumentMemory => Boolean(row)).slice(0, 16)
    : []

  return {
    version: typeof value.version === "number" ? value.version : 1,
    summary: value.summary ? safeText(value.summary, 1200) : null,
    defenseHypothesis: value.defenseHypothesis ? safeText(value.defenseHypothesis, 900) : null,
    defenseCriteria: uniqueStrings(Array.isArray(value.defenseCriteria) ? value.defenseCriteria : [], 10),
    documentPriorityRules: uniqueStrings(
      Array.isArray(value.documentPriorityRules) ? value.documentPriorityRules : [],
      8
    ),
    outcomeLessons: uniqueStrings(Array.isArray(value.outcomeLessons) ? value.outcomeLessons : [], 10),
    misuseRisks: uniqueStrings(Array.isArray(value.misuseRisks) ? value.misuseRisks : [], 10),
    contextFacts: uniqueStrings(Array.isArray(value.contextFacts) ? value.contextFacts : [], 10),
    precedentRationales: uniqueStrings(
      Array.isArray(value.precedentRationales) ? value.precedentRationales : [],
      10
    ),
    preferredCauses,
    keyDocuments: prioritizeStructuredDocuments(keyDocuments).slice(0, 16),
  }
}

export function buildStructuredOnboardingMemoryFromArtifacts(params: {
  metadataMemory?: StructuredOnboardingMemory | null
  notes?: StructuredMemoryArtifactNote[]
  tribunalReferences?: StructuredMemoryArtifactReference[]
}) {
  const primary = params.metadataMemory || null
  const notes = Array.isArray(params.notes) ? params.notes : []
  const tribunalReferences = Array.isArray(params.tribunalReferences) ? params.tribunalReferences : []
  const marcoNote = pickLatestMarcoNote(notes)
  const content = String(marcoNote?.content || "")

  const summarySection = extractSectionBlock(content, "Resumen ejecutivo")
  const hypothesisSection = extractSectionBlock(content, "Hipotesis de defensa")
  const factsSection = extractSectionBlock(content, "Hechos comparables")
  const criteriaSection = extractSectionBlock(content, "Criterios utiles")
  const risksSection = extractSectionBlock(content, "Riesgos por mal uso")

  const fallbackKeyDocuments = tribunalReferences
    .map((ref) =>
      normalizeDocumentMemory({
        causeId: ref.causeId,
        rol: ref.rol,
        name: ref.documentName || ref.sourceTitle,
        url: ref.documentUrl,
        docRole: ref.docRole,
        contribution: ref.docRole === "informe"
          ? "Documento útil para mantener criterios defensivos del SEA."
          : ref.docRole === "sentencia"
            ? "Documento útil para evaluar cómo terminó la causa y qué criterio prevaleció."
            : "Documento contextual del precedente.",
      })
    )
    .filter((row: StructuredOnboardingDocumentMemory | null): row is StructuredOnboardingDocumentMemory => Boolean(row))
    .slice(0, 16)

  const merged: StructuredOnboardingMemory = {
    version: primary?.version || 1,
    summary: primary?.summary || (summarySection ? safeText(summarySection, 1200) : null),
    defenseHypothesis:
      primary?.defenseHypothesis || (hypothesisSection ? safeText(hypothesisSection, 900) : null),
    defenseCriteria: uniqueStrings([
      ...(primary?.defenseCriteria || []),
      ...extractBulletLines(criteriaSection, 8),
    ], 10),
    documentPriorityRules: uniqueStrings(primary?.documentPriorityRules || [], 8),
    outcomeLessons: uniqueStrings([
      ...(primary?.outcomeLessons || []),
      ...extractBulletLines(risksSection, 8),
    ], 10),
    misuseRisks: uniqueStrings([...(primary?.misuseRisks || []), ...extractBulletLines(risksSection, 8)], 10),
    contextFacts: uniqueStrings([
      ...(primary?.contextFacts || []),
      ...extractBulletLines(factsSection, 8),
    ], 10),
    precedentRationales: uniqueStrings(primary?.precedentRationales || [], 10),
    preferredCauses: (primary?.preferredCauses || []).slice(0, 10),
    keyDocuments: prioritizeStructuredDocuments(uniqueStructuredDocuments([...(primary?.keyDocuments || []), ...fallbackKeyDocuments])).slice(0, 16),
  }

  if (
    !merged.summary &&
    !merged.defenseHypothesis &&
    !merged.defenseCriteria.length &&
    !merged.documentPriorityRules.length &&
    !merged.outcomeLessons.length &&
    !merged.misuseRisks.length &&
    !merged.contextFacts.length &&
    !merged.precedentRationales.length &&
    !merged.keyDocuments.length
  ) {
    return null
  }

  return merged
}

function uniqueStructuredDocuments(values: StructuredOnboardingDocumentMemory[]) {
  const seen = new Set<string>()
  const out: StructuredOnboardingDocumentMemory[] = []
  for (const value of values) {
    const key = `${String(value.rol || "")}|${String(value.docRole || "")}|${String(value.name || "")}`.toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function prioritizeStructuredDocuments(values: StructuredOnboardingDocumentMemory[]) {
  const unique = uniqueStructuredDocuments(values)
  const docs = unique.map((doc, idx) => ({
    ...doc,
    id: `${doc.causeId || "cause"}-${doc.docRole || "doc"}-${idx}`,
    document_type: doc.docRole,
    _idx: idx,
  }))

  const countsByCause = new Map<string, { informe: number; sentencia: number; reclamacion: number }>()
  for (const doc of docs) {
    const causeKey = String(doc.causeId || doc.rol || "")
    if (!causeKey) continue
    const current = countsByCause.get(causeKey) || { informe: 0, sentencia: 0, reclamacion: 0 }
    if (doc.docRole === "informe") current.informe += 1
    if (doc.docRole === "sentencia") current.sentencia += 1
    if (doc.docRole === "reclamacion") current.reclamacion += 1
    countsByCause.set(causeKey, current)
  }

  const coreDocCount = docs.filter((doc) => doc.docRole === "informe" || doc.docRole === "sentencia").length
  const orderedDocs = docs
    .slice()
    .sort((a, b) => {
      const aCause = countsByCause.get(String(a.causeId || a.rol || "")) || { informe: 0, sentencia: 0, reclamacion: 0 }
      const bCause = countsByCause.get(String(b.causeId || b.rol || "")) || { informe: 0, sentencia: 0, reclamacion: 0 }
      const score = (doc: typeof a, cause: typeof aCause) => {
        const hasCorePair = cause.informe > 0 && cause.sentencia > 0
        const roleScore =
          doc.docRole === "informe"
            ? 500
            : doc.docRole === "sentencia"
              ? 460
              : doc.docRole === "reclamacion"
                ? 120
                : 0
        const pairBonus = hasCorePair && doc.docRole !== "reclamacion" ? 120 : 0
        const incompletePenalty = !hasCorePair && doc.docRole === "reclamacion" ? 140 : 0
        const contextPenalty = coreDocCount >= 4 && doc.docRole === "reclamacion" ? 90 : 0
        return roleScore + pairBonus - incompletePenalty - contextPenalty
      }

      const diff = score(b, bCause) - score(a, aCause)
      if (diff !== 0) return diff
      return Number(a._idx || 0) - Number(b._idx || 0)
    })

  const selected = selectDefenseDocumentMix(orderedDocs, {
    limit: Math.min(4, docs.length || 4),
    preferredRoles: ["informe", "sentencia", "reclamacion"],
    requireCorePair: true,
    maxContextReclamaciones: coreDocCount >= 4 ? 0 : 1,
  }).selected

  const selectedKeys = new Set(selected.map((doc) => String(doc.id || "")))
  const rest = orderedDocs.filter((doc) => !selectedKeys.has(String(doc.id || "")))
  return [...selected, ...rest].map(({ id, document_type, _idx, ...doc }) => doc)
}

export function buildStructuredOnboardingMemoryBlock(memory: StructuredOnboardingMemory | null | undefined) {
  if (!memory) return ""

  const lines: string[] = []
  if (memory.summary) lines.push(`Resumen: ${memory.summary}`)
  if (memory.defenseHypothesis) lines.push(`Hipotesis de defensa: ${memory.defenseHypothesis}`)
  if (memory.defenseCriteria.length) lines.push(`Criterios de defensa: ${memory.defenseCriteria.slice(0, 4).join(" | ")}`)
  if (memory.documentPriorityRules.length) lines.push(`Prioridad documental: ${memory.documentPriorityRules.slice(0, 3).join(" | ")}`)
  if (memory.outcomeLessons.length) lines.push(`Lecciones de resultado: ${memory.outcomeLessons.slice(0, 3).join(" | ")}`)
  if (memory.misuseRisks.length) lines.push(`Riesgos de uso: ${memory.misuseRisks.slice(0, 3).join(" | ")}`)
  if (memory.contextFacts.length) lines.push(`Hechos comparables: ${memory.contextFacts.slice(0, 3).join(" | ")}`)
  if (memory.precedentRationales.length) lines.push(`Racionales de precedentes: ${memory.precedentRationales.slice(0, 2).join(" | ")}`)
  if (memory.preferredCauses.length) {
    lines.push(
      `Precedentes priorizados: ${memory.preferredCauses
        .slice(0, 4)
        .map((cause) => `${cause.rol || "sin rol"}${cause.defenseSummary ? ` - ${cause.defenseSummary}` : ""}`)
        .join(" | ")}`
    )
  }
  return lines.join("\n")
}

export function extractStructuredOnboardingMemoryFromMetadata(metadata: any) {
  const metadataRecord = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {}
  const onboarding =
    metadataRecord?.onboarding && typeof metadataRecord.onboarding === "object" ? metadataRecord.onboarding : {}
  return normalizeStructuredOnboardingMemory((onboarding as any)?.structured_memory)
}

export function buildWritingGuidanceFromStructuredMemory(memory: StructuredOnboardingMemory | null | undefined) {
  if (!memory) return ""

  const lines: string[] = []
  if (memory.defenseHypothesis) lines.push(`Hipotesis de defensa SEA: ${memory.defenseHypothesis}`)
  if (memory.defenseCriteria.length) lines.push(`Criterios a mantener: ${memory.defenseCriteria.slice(0, 5).join(" | ")}`)
  if (memory.documentPriorityRules.length) lines.push(`Prioridad documental: ${memory.documentPriorityRules.slice(0, 3).join(" | ")}`)
  if (memory.outcomeLessons.length) lines.push(`Lecciones de resultado: ${memory.outcomeLessons.slice(0, 4).join(" | ")}`)
  if (memory.misuseRisks.length) lines.push(`Riesgos por mal uso: ${memory.misuseRisks.slice(0, 4).join(" | ")}`)
  if (memory.preferredCauses.length) {
    lines.push(
      `Precedentes utiles: ${memory.preferredCauses
        .slice(0, 4)
        .map((cause) => `${cause.rol || "sin rol"}${cause.defenseSummary ? ` - ${cause.defenseSummary}` : ""}`)
        .join(" | ")}`
    )
  }
  if (memory.keyDocuments.length) {
    lines.push(
      `Documentos prioritarios: ${memory.keyDocuments
        .slice(0, 5)
        .map((doc) => `${doc.docRole || "documento"}: ${doc.name || "sin nombre"}`)
        .join(" | ")}`
    )
  }
  return lines.join("\n")
}
