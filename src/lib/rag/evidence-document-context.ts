import type { EvidenceChunk } from "@/lib/rag/strict-answer"
import { inferDefenseDocumentRole } from "@/lib/tribunal/defense-document-policy"

export async function hydrateEvidenceDocumentContext(params: {
  supabase: any
  evidence: EvidenceChunk[]
}) {
  const evidence = Array.isArray(params.evidence) ? params.evidence : []
  const snapshotIds = Array.from(
    new Set(
      evidence
        .map((chunk) => String(chunk.snapshotId || "").trim())
        .filter(Boolean)
    )
  ).slice(0, 240)

  if (!snapshotIds.length) return evidence

  const { data: snapshots, error: snapshotErr } = await params.supabase
    .from("gob_source_snapshots")
    .select("id,source_id")
    .in("id", snapshotIds)

  if (snapshotErr || !Array.isArray(snapshots) || !snapshots.length) return evidence

  const sourceIds = Array.from(
    new Set(
      snapshots
        .map((row: any) => String(row?.source_id || "").trim())
        .filter(Boolean)
    )
  )

  const sourceById = new Map<string, any>()
  if (sourceIds.length) {
    const { data: sources, error: sourceErr } = await params.supabase
      .from("gob_sources")
      .select("id,title,doc_type,attributes")
      .in("id", sourceIds)

    if (!sourceErr) {
      for (const row of sources || []) {
        sourceById.set(String((row as any)?.id || ""), row)
      }
    }
  }

  const sourceIdBySnapshot = new Map<string, string>()
  for (const row of snapshots) {
    const snapshotId = String((row as any)?.id || "")
    const sourceId = String((row as any)?.source_id || "")
    if (snapshotId && sourceId) sourceIdBySnapshot.set(snapshotId, sourceId)
  }

  return evidence.map((chunk) => {
    const snapshotId = String(chunk.snapshotId || "")
    const sourceId = sourceIdBySnapshot.get(snapshotId) || ""
    const source = sourceById.get(sourceId)
    const attrs = source?.attributes && typeof source.attributes === "object" ? source.attributes : {}
    const documentTitle = chunk.documentTitle || (source?.title ? String(source.title) : null)
    const documentType = chunk.documentType || (source?.doc_type ? String(source.doc_type) : null)
    const docRole =
      chunk.docRole ||
      inferDefenseDocumentRole({
        docRole: attrs?.doc_role ? String(attrs.doc_role) : null,
        documentType,
        name: documentTitle,
        title: documentType,
        section: chunk.section,
      })

    return {
      ...chunk,
      docRole: docRole || null,
      documentType,
      documentTitle,
      section:
        chunk.section || [documentTitle, documentType].filter(Boolean).join(" | ") || null,
    }
  })
}
