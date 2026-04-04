import { sortDocumentsForDefense } from "@/lib/tribunal/document-selection"
import { classifyTribunalDocumentRole, type TribunalDocumentRole } from "@/lib/tribunal/document-role"

export type StrictDefenseDocumentRole = Exclude<TribunalDocumentRole, "documento">

type DefenseDocumentLike = {
  id?: string | null
  document_type?: string | null
  date?: string | null
  name?: string | null
  title?: string | null
  docRole?: string | null
  section?: string | null
}

type RoleCoverageSummary = {
  counts: Record<StrictDefenseDocumentRole, number>
  availableRoles: StrictDefenseDocumentRole[]
  hasCorePair: boolean
  missingCoreRoles: StrictDefenseDocumentRole[]
}

export type DefenseDocumentMixResult<T> = {
  selected: T[]
  coverage: RoleCoverageSummary & {
    selectedCounts: Record<StrictDefenseDocumentRole, number>
    selectedRoles: StrictDefenseDocumentRole[]
  }
}

const DEFENSE_ROLE_ORDER: StrictDefenseDocumentRole[] = ["informe", "sentencia", "reclamacion"]

function normalizeRole(value: string | null | undefined): StrictDefenseDocumentRole | null {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "informe" || normalized === "sentencia" || normalized === "reclamacion") {
    return normalized
  }
  return null
}

export function inferDefenseDocumentRole(value: {
  docRole?: string | null
  documentType?: string | null
  name?: string | null
  title?: string | null
  section?: string | null
}) {
  const explicit = normalizeRole(value.docRole)
  if (explicit) return explicit

  const classified = classifyTribunalDocumentRole({
    documentType: value.documentType || value.title || null,
    name: value.name || value.section || null,
    title: value.title || value.documentType || null,
  })

  return classified === "documento" ? null : classified
}

function emptyCounts(): Record<StrictDefenseDocumentRole, number> {
  return {
    informe: 0,
    sentencia: 0,
    reclamacion: 0,
  }
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

function normalizePreferredRoles(preferredRoles?: string[] | null) {
  const requested = Array.isArray(preferredRoles)
    ? preferredRoles.map((role) => normalizeRole(role)).filter((role): role is StrictDefenseDocumentRole => Boolean(role))
    : []

  const ordered = uniqueRoles([...requested, ...DEFENSE_ROLE_ORDER])
  return ordered.length ? ordered : DEFENSE_ROLE_ORDER.slice()
}

export function summarizeDefenseDocumentCoverage<T extends DefenseDocumentLike>(docs: T[]): RoleCoverageSummary {
  const counts = emptyCounts()

  for (const doc of Array.isArray(docs) ? docs : []) {
    const role = inferDefenseDocumentRole({
      docRole: doc.docRole,
      documentType: doc.document_type,
      name: doc.name,
      title: doc.title,
      section: doc.section,
    })
    if (!role) continue
    counts[role] += 1
  }

  const availableRoles = DEFENSE_ROLE_ORDER.filter((role) => counts[role] > 0)
  const hasCorePair = counts.informe > 0 && counts.sentencia > 0
  const missingCoreRoles = DEFENSE_ROLE_ORDER.slice(0, 2).filter((role) => counts[role] <= 0)

  return {
    counts,
    availableRoles,
    hasCorePair,
    missingCoreRoles,
  }
}

function pickFirstUnused<T extends DefenseDocumentLike>(
  docs: T[],
  params: {
    usedIds: Set<string>
    selectedCounts: Record<StrictDefenseDocumentRole, number>
    maxContextReclamaciones: number
  }
) {
  for (const doc of docs) {
    const id = String(doc.id || "")
    if (!id || params.usedIds.has(id)) continue

    const role = inferDefenseDocumentRole({
      docRole: doc.docRole,
      documentType: doc.document_type,
      name: doc.name,
      title: doc.title,
      section: doc.section,
    })
    if (!role) continue

    if (role === "reclamacion" && params.selectedCounts.reclamacion >= params.maxContextReclamaciones) {
      continue
    }

    params.usedIds.add(id)
    params.selectedCounts[role] += 1
    return doc
  }

  return null
}

export function selectDefenseDocumentMix<T extends DefenseDocumentLike>(
  docs: T[],
  options?: {
    preferredRoles?: string[] | null
    matchedDocIds?: Set<string>
    relevanceById?: Map<string, number>
    limit?: number
    requireCorePair?: boolean
    maxContextReclamaciones?: number
  }
): DefenseDocumentMixResult<T> {
  const limit = Math.max(1, Number(options?.limit || 3))
  const ordered = sortDocumentsForDefense(docs, {
    preferredRoles: options?.preferredRoles,
    matchedDocIds: options?.matchedDocIds,
    relevanceById: options?.relevanceById,
  })
  const baseCoverage = summarizeDefenseDocumentCoverage(ordered)
  const preferredRoles = normalizePreferredRoles(options?.preferredRoles)
  const requireCorePair = options?.requireCorePair !== false
  const maxContextReclamaciones = Math.max(
    0,
    Number(options?.maxContextReclamaciones ?? (baseCoverage.hasCorePair ? 1 : 2))
  )

  const byRole = new Map<StrictDefenseDocumentRole, T[]>()
  for (const role of DEFENSE_ROLE_ORDER) byRole.set(role, [])
  for (const doc of ordered) {
    const role = inferDefenseDocumentRole({
      docRole: doc.docRole,
      documentType: doc.document_type,
      name: doc.name,
      title: doc.title,
      section: doc.section,
    })
    if (!role) continue
    byRole.get(role)!.push(doc)
  }

  const requiredRoles = uniqueRoles([
    ...(requireCorePair && baseCoverage.hasCorePair ? (["informe", "sentencia"] as StrictDefenseDocumentRole[]) : []),
    ...preferredRoles.filter((role) => baseCoverage.counts[role] > 0),
  ])

  const selected: T[] = []
  const usedIds = new Set<string>()
  const selectedCounts = emptyCounts()

  const pushDoc = (doc: T | null) => {
    if (!doc) return false
    selected.push(doc)
    return selected.length >= limit
  }

  for (const role of requiredRoles) {
    if (selected.length >= limit) break
    if (pushDoc(
      pickFirstUnused(byRole.get(role) || [], {
        usedIds,
        selectedCounts,
        maxContextReclamaciones,
      })
    )) {
      break
    }
  }

  for (const role of preferredRoles) {
    if (selected.length >= limit) break
    while (selected.length < limit) {
      const picked = pickFirstUnused(byRole.get(role) || [], {
        usedIds,
        selectedCounts,
        maxContextReclamaciones,
      })
      if (!picked) break
      if (pushDoc(picked)) break
      if (role === "reclamacion") break
      if (role !== "informe" && role !== "sentencia") break
      const hasMissingCore = DEFENSE_ROLE_ORDER.slice(0, 2).some((coreRole) => {
        return baseCoverage.counts[coreRole] > 0 && selectedCounts[coreRole] <= 0
      })
      if (hasMissingCore) break
    }
  }

  if (selected.length < limit) {
    for (const doc of ordered) {
      const picked = pickFirstUnused([doc], {
        usedIds,
        selectedCounts,
        maxContextReclamaciones,
      })
      if (!picked) continue
      selected.push(picked)
      if (selected.length >= limit) break
    }
  }

  return {
    selected: selected.slice(0, limit),
    coverage: {
      ...baseCoverage,
      selectedCounts,
      selectedRoles: DEFENSE_ROLE_ORDER.filter((role) => selectedCounts[role] > 0),
    },
  }
}

export function selectRoleBalancedItems<T extends { docRole?: string | null; documentType?: string | null; name?: string | null; title?: string | null; section?: string | null }>(
  items: T[],
  options?: {
    limit?: number
    preferredRoles?: string[] | null
    requiredRoles?: StrictDefenseDocumentRole[]
    maxContextReclamaciones?: number
  }
) {
  const limit = Math.max(1, Number(options?.limit || 8))
  const preferredRoles = normalizePreferredRoles(options?.preferredRoles)
  const requiredRoles = uniqueRoles(options?.requiredRoles || [])
  const counts = emptyCounts()
  const maxContextReclamaciones = Math.max(
    0,
    Number(options?.maxContextReclamaciones ?? 1)
  )
  const ordered = Array.isArray(items) ? items.slice() : []
  const selected: T[] = []

  const usedIdx = new Set<number>()
  const roleForIndex = (idx: number) =>
    inferDefenseDocumentRole({
      docRole: ordered[idx]?.docRole,
      documentType: ordered[idx]?.documentType,
      name: ordered[idx]?.name,
      title: ordered[idx]?.title,
      section: ordered[idx]?.section,
    })

  const tryPickRole = (role: StrictDefenseDocumentRole) => {
    for (let idx = 0; idx < ordered.length; idx += 1) {
      if (usedIdx.has(idx)) continue
      const inferred = roleForIndex(idx)
      if (inferred !== role) continue
      if (role === "reclamacion" && counts.reclamacion >= maxContextReclamaciones) continue
      usedIdx.add(idx)
      counts[role] += 1
      selected.push(ordered[idx])
      return true
    }
    return false
  }

  for (const role of requiredRoles) {
    if (selected.length >= limit) break
    tryPickRole(role)
  }

  for (const role of preferredRoles) {
    if (selected.length >= limit) break
    tryPickRole(role)
  }

  for (let idx = 0; idx < ordered.length && selected.length < limit; idx += 1) {
    if (usedIdx.has(idx)) continue
    const role = roleForIndex(idx)
    if (role === "reclamacion" && counts.reclamacion >= maxContextReclamaciones) continue
    usedIdx.add(idx)
    if (role) counts[role] += 1
    selected.push(ordered[idx])
  }

  return selected.slice(0, limit)
}
