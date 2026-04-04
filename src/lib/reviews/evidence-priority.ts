import { inferRagQueryIntent } from "@/lib/rag/query-intent"
import { classifyTribunalDocumentRole } from "@/lib/tribunal/document-role"

export type ReviewEvidenceContext = {
  title: string | null
  docType: string | null
  docRole: string | null
  rol: string | null
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)))
}

function roleRank(role: string | null | undefined, preferredRoles: string[]) {
  const normalized = String(role || "").trim().toLowerCase()
  const idx = preferredRoles.findIndex((candidate) => candidate === normalized)
  return idx >= 0 ? idx : 99
}

export async function loadReviewEvidenceContext(params: {
  supabase: any
  snapshotIds: string[]
}) {
  const snapshotIds = uniqueStrings(params.snapshotIds).slice(0, 240)
  const contextBySnapshotId = new Map<string, ReviewEvidenceContext>()
  if (!snapshotIds.length) return contextBySnapshotId

  const { data: snapshots, error: snapshotErr } = await params.supabase
    .from("gob_source_snapshots")
    .select("id,source_id")
    .in("id", snapshotIds)

  if (snapshotErr || !Array.isArray(snapshots) || !snapshots.length) {
    return contextBySnapshotId
  }

  const sourceIds = uniqueStrings(snapshots.map((row: any) => String(row?.source_id || "")))
  const { data: sources, error: sourceErr } = sourceIds.length
    ? await params.supabase
        .from("gob_sources")
        .select("id,title,doc_type,attributes")
        .in("id", sourceIds)
    : { data: [], error: null as any }

  if (sourceErr) {
    return contextBySnapshotId
  }

  const sourceById = new Map<string, any>()
  for (const row of sources || []) {
    sourceById.set(String((row as any)?.id || ""), row)
  }

  for (const row of snapshots) {
    const snapshotId = String((row as any)?.id || "")
    const sourceId = String((row as any)?.source_id || "")
    if (!snapshotId || !sourceId) continue
    const source = sourceById.get(sourceId)
    const attrs = source?.attributes && typeof source.attributes === "object" ? source.attributes : {}
    const title = source?.title ? String(source.title) : null
    const docType = source?.doc_type ? String(source.doc_type) : null
    const docRole = attrs?.doc_role
      ? String(attrs.doc_role)
      : classifyTribunalDocumentRole({ documentType: docType, name: title, title: docType })

    contextBySnapshotId.set(snapshotId, {
      title,
      docType,
      docRole,
      rol: attrs?.rol ? String(attrs.rol) : null,
    })
  }

  return contextBySnapshotId
}

export function prioritizeReviewEvidence<T extends { snapshotId: string | null; section: string | null; rank: number }>(params: {
  chunks: T[]
  contextBySnapshotId: Map<string, ReviewEvidenceContext>
  question: string
  limit: number
}) {
  const intent = inferRagQueryIntent(params.question)

  return params.chunks
    .map((chunk) => {
      const context = chunk.snapshotId ? params.contextBySnapshotId.get(String(chunk.snapshotId)) : null
      const docRole =
        context?.docRole ||
        classifyTribunalDocumentRole({
          documentType: context?.docType || null,
          name: context?.title || chunk.section || null,
          title: context?.docType || context?.title || null,
        })

      return {
        ...chunk,
        section:
          [chunk.section, context?.title || null, context?.docType || null, context?.rol || null]
            .filter(Boolean)
            .join(" | ") || chunk.section,
        _docRole: docRole,
        _docRoleRank: roleRank(docRole, intent.preferredDocRoles),
      }
    })
    .sort((a, b) => {
      if (a._docRoleRank !== b._docRoleRank) return a._docRoleRank - b._docRoleRank
      return b.rank - a.rank
    })
    .slice(0, Math.max(1, params.limit))
    .map(({ _docRole, _docRoleRank, ...chunk }) => chunk as T)
}
