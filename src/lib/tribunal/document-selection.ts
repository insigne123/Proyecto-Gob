import { classifyTribunalDocumentRole, type TribunalDocumentRole } from "@/lib/tribunal/document-role"

type StrictTribunalDocumentRole = Exclude<TribunalDocumentRole, "documento">

export const DEFAULT_DEFENSE_DOCUMENT_ROLE_ORDER: StrictTribunalDocumentRole[] = [
  "informe",
  "sentencia",
  "reclamacion",
]

type DefenseDocumentLike = {
  id?: string | null
  document_type?: string | null
  date?: string | null
  name?: string | null
}

function parseDateMs(value: string | null | undefined) {
  if (!value) return 0
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizePreferredRoleOrder(preferredRoles?: string[] | null) {
  const requested = Array.isArray(preferredRoles)
    ? preferredRoles
        .map((role) => String(role || "").trim().toLowerCase())
        .filter((role): role is StrictTribunalDocumentRole =>
          role === "informe" || role === "sentencia" || role === "reclamacion"
        )
    : []

  const ordered: StrictTribunalDocumentRole[] = []
  for (const role of DEFAULT_DEFENSE_DOCUMENT_ROLE_ORDER) {
    if (requested.includes(role) || !requested.length) {
      ordered.push(role)
    }
  }
  for (const role of requested) {
    if (!ordered.includes(role)) ordered.push(role)
  }
  return ordered
}

function roleOrderIndex(role: TribunalDocumentRole, preferredRoles?: string[] | null) {
  if (role === "documento") return 999
  const ordered = normalizePreferredRoleOrder(preferredRoles)
  const idx = ordered.indexOf(role)
  return idx >= 0 ? idx : 999
}

export function defenseRoleWeight(role: TribunalDocumentRole) {
  if (role === "informe") return 1.18
  if (role === "sentencia") return 1.12
  if (role === "reclamacion") return 0.92
  return 0.5
}

export function sortDocumentsForDefense<T extends DefenseDocumentLike>(
  docs: T[],
  options?: {
    preferredRoles?: string[] | null
    matchedDocIds?: Set<string>
    relevanceById?: Map<string, number>
  }
) {
  const matchedDocIds = options?.matchedDocIds || new Set<string>()
  const relevanceById = options?.relevanceById || new Map<string, number>()

  return docs.slice().sort((a, b) => {
    const roleA = classifyTribunalDocumentRole({
      documentType: a.document_type,
      name: a.name,
      title: a.document_type,
    })
    const roleB = classifyTribunalDocumentRole({
      documentType: b.document_type,
      name: b.name,
      title: b.document_type,
    })

    const roleDiff = roleOrderIndex(roleA, options?.preferredRoles) - roleOrderIndex(roleB, options?.preferredRoles)
    if (roleDiff !== 0) return roleDiff

    const matchedA = matchedDocIds.has(String(a.id || ""))
    const matchedB = matchedDocIds.has(String(b.id || ""))
    if (matchedA !== matchedB) return matchedA ? -1 : 1

    const relevanceA = Number(relevanceById.get(String(a.id || "")) || 0)
    const relevanceB = Number(relevanceById.get(String(b.id || "")) || 0)
    if (relevanceA !== relevanceB) return relevanceB - relevanceA

    const dateA = parseDateMs(a.date)
    const dateB = parseDateMs(b.date)
    if (roleA === roleB && roleA === "reclamacion") {
      if (dateA !== dateB) return dateA - dateB
    } else if (dateA !== dateB) {
      return dateB - dateA
    }

    return String(a.id || a.name || "").localeCompare(String(b.id || b.name || ""))
  })
}

export function pickDocumentsForDefense<T extends DefenseDocumentLike>(
  docs: T[],
  options?: {
    preferredRoles?: string[] | null
    matchedDocIds?: Set<string>
    relevanceById?: Map<string, number>
    limit?: number
  }
) {
  const limit = Math.max(1, Number(options?.limit || 3))
  const ordered = sortDocumentsForDefense(docs, options)
  const preferredRoles = normalizePreferredRoleOrder(options?.preferredRoles)
  const out: T[] = []
  const usedIds = new Set<string>()

  for (const preferredRole of preferredRoles) {
    const match = ordered.find((doc) => {
      const id = String(doc.id || "")
      if (usedIds.has(id)) return false
      return (
        classifyTribunalDocumentRole({
          documentType: doc.document_type,
          name: doc.name,
          title: doc.document_type,
        }) === preferredRole
      )
    })
    if (match) {
      out.push(match)
      usedIds.add(String(match.id || ""))
    }
    if (out.length >= limit) return out.slice(0, limit)
  }

  for (const doc of ordered) {
    const id = String(doc.id || "")
    if (usedIds.has(id)) continue
    out.push(doc)
    usedIds.add(id)
    if (out.length >= limit) break
  }

  return out.slice(0, limit)
}
