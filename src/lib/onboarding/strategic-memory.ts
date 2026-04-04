import type { StructuredOnboardingMemory } from "@/lib/onboarding/structured-memory"

function safeText(value: unknown, maxLen = 260) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > maxLen ? `${text.slice(0, maxLen).trim()}...` : text
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function uniqueStrings(values: string[], max = 8) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = String(value || "").trim()
    if (!clean) continue
    const key = normalizeText(clean)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(clean)
    if (out.length >= max) break
  }
  return out
}

export function buildStrategicProfilesBlock(params: {
  structuredMemory?: StructuredOnboardingMemory | null
  causeProfiles?: Array<{
    rol?: string | null
    summary?: string | null
    interestingIf?: string[] | null
    riskyIf?: string[] | null
    keySignals?: string[] | null
    recommendedDocRoles?: string[] | null
  }>
  documentProfiles?: Array<{
    rol?: string | null
    docRole?: string | null
    name?: string | null
    summary?: string | null
    keyPoints?: string[] | null
  }>
}) {
  const lines: string[] = []
  const causeProfiles = Array.isArray(params.causeProfiles) ? params.causeProfiles : []
  const documentProfiles = Array.isArray(params.documentProfiles) ? params.documentProfiles : []

  if (causeProfiles.length) {
    const summaries = uniqueStrings(
      causeProfiles.map((row) => {
        const rol = row.rol ? String(row.rol) : "precedente"
        const summary = safeText(row.summary || "", 220)
        return summary ? `${rol}: ${summary}` : ""
      }),
      4
    )
    if (summaries.length) {
      lines.push(`perfiles_estrategicos: ${summaries.join(" | ")}`)
    }

    const signals = uniqueStrings(
      causeProfiles.flatMap((row) => Array.isArray(row.keySignals) ? row.keySignals.map((item) => safeText(item, 140)) : []),
      6
    )
    if (signals.length) {
      lines.push(`senales_clave: ${signals.join(" | ")}`)
    }

    const risks = uniqueStrings(
      causeProfiles.flatMap((row) => Array.isArray(row.riskyIf) ? row.riskyIf.map((item) => safeText(item, 160)) : []),
      4
    )
    if (risks.length) {
      lines.push(`riesgos_perfilados: ${risks.join(" | ")}`)
    }
  }

  if (documentProfiles.length) {
    const docs = uniqueStrings(
      documentProfiles.map((row) => {
        const label = [row.rol, row.docRole, row.name].filter(Boolean).join(" · ")
        const summary = safeText(row.summary || (Array.isArray(row.keyPoints) ? row.keyPoints[0] : ""), 160)
        return label && summary ? `${label}: ${summary}` : label
      }),
      4
    )
    if (docs.length) {
      lines.push(`documentos_perfilados: ${docs.join(" | ")}`)
    }
  }

  if (!lines.length && params.structuredMemory?.preferredCauses?.length) {
    const fallback = params.structuredMemory.preferredCauses
      .slice(0, 4)
      .map((row) => `${row.rol || "precedente"}${row.defenseSummary ? `: ${safeText(row.defenseSummary, 180)}` : ""}`)
      .filter(Boolean)
    if (fallback.length) {
      lines.push(`precedentes_estructurados: ${fallback.join(" | ")}`)
    }
  }

  return lines.slice(0, 4).join("\n")
}

export function buildCauseInventoryBlock(params: {
  causes?: Array<{
    rol?: string | null
    estado?: string | null
    caratula?: string | null
    counts?: { informe?: number; sentencia?: number; reclamacion?: number }
  }>
}) {
  const causes = Array.isArray(params.causes) ? params.causes : []
  const lines = uniqueStrings(
    causes.map((row) => {
      const rol = row.rol ? String(row.rol) : "causa"
      const counts = row.counts || {}
      const status = row.estado ? `estado=${safeText(row.estado, 80)}` : ""
      const docs = `docs[informe=${Number(counts.informe || 0)}, sentencia=${Number(counts.sentencia || 0)}, reclamacion=${Number(counts.reclamacion || 0)}]`
      const caratula = row.caratula ? safeText(row.caratula, 120) : ""
      return [rol, status, docs, caratula].filter(Boolean).join(" · ")
    }),
    4
  )

  return lines.length ? `inventario_causas: ${lines.join(" | ")}` : ""
}

export function extractStrategicRoleTokens(params: {
  question?: string | null
  threadRoleTokens?: string[] | null
  structuredMemory?: StructuredOnboardingMemory | null
  onboardingReferences?: Array<{ rol?: string | null }> | null
}) {
  const roleTokens = uniqueStrings(
    [
      ...(Array.isArray(params.threadRoleTokens) ? params.threadRoleTokens : []),
      ...(Array.isArray(params.structuredMemory?.preferredCauses)
        ? params.structuredMemory!.preferredCauses.map((row) => String(row.rol || ""))
        : []),
      ...(Array.isArray(params.onboardingReferences)
        ? params.onboardingReferences!.map((row) => String(row?.rol || ""))
        : []),
      ...String(params.question || "").match(/\bR-\d{1,5}-\d{4}\b/gi)?.map((item) => item.toUpperCase()) || [],
    ],
    6
  )
  return roleTokens
}
