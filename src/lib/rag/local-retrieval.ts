import { ai } from "@/ai/genkit"
import { toVectorLiteral } from "@/lib/pgvector"

import type { EvidenceChunk } from "@/lib/rag/strict-answer"

function toEvidenceChunk(m: any): EvidenceChunk {
  return {
    chunkId: String(m.chunk_id ?? m.chunkId ?? m.id),
    content: String(m.content ?? ""),
    sourceUrl: m.source_url ? String(m.source_url) : null,
    snapshotId: m.snapshot_id ? String(m.snapshot_id) : null,
    page: typeof m.page === "number" ? m.page : m.page ? Number(m.page) : null,
    section: m.section ? String(m.section) : null,
  }
}

function dedupeByChunkId(list: EvidenceChunk[]) {
  const seen = new Set<string>()
  const out: EvidenceChunk[] = []
  for (const x of list) {
    if (!x.chunkId || seen.has(x.chunkId)) continue
    seen.add(x.chunkId)
    out.push(x)
  }
  return out
}

function rankOfRow(row: any) {
  const bySimilarity =
    typeof row?.similarity === "number"
      ? row.similarity
      : row?.similarity
        ? Number(row.similarity)
        : null
  if (typeof bySimilarity === "number" && Number.isFinite(bySimilarity)) return bySimilarity

  const byRank = typeof row?.rank === "number" ? row.rank : row?.rank ? Number(row.rank) : null
  if (typeof byRank === "number" && Number.isFinite(byRank)) return byRank
  return 0
}

export async function retrieveLocalEvidenceForQuestion(params: {
  supabase: any
  workspaceId?: string
  workspaceIds?: string[]
  question: string
  matchCount?: number
  minSimilarity?: number
  textMatchCount?: number
}) {
  const matchCount = Math.max(1, Math.min(30, Number(params.matchCount ?? 10)))
  const minSimilarity = Number(params.minSimilarity ?? 0.25)
  const textMatchCount = Math.max(1, Math.min(40, Number(params.textMatchCount ?? 12)))

  const scopeWorkspaceIds = Array.from(
    new Set(
      (Array.isArray(params.workspaceIds) ? params.workspaceIds : [])
        .concat(params.workspaceId ? [params.workspaceId] : [])
        .map((x) => String(x || ""))
        .filter(Boolean)
    )
  ).slice(0, 60)

  if (!scopeWorkspaceIds.length) return []

  let evidence: EvidenceChunk[] = []
  const maxOut = Math.max(12, Math.min(120, matchCount * 3))

  const perWorkspaceMatchCount = Math.max(
    3,
    Math.min(20, Math.ceil(maxOut / Math.max(1, scopeWorkspaceIds.length)))
  )

  const perWorkspaceTextCount = Math.max(
    4,
    Math.min(30, Math.ceil((textMatchCount * 3) / Math.max(1, scopeWorkspaceIds.length)))
  )

  const embeddings = await ai.embed({
    embedder: "googleai/gemini-embedding-001",
    content: params.question,
    options: { taskType: "RETRIEVAL_QUERY", outputDimensionality: 768 },
  })

  const vec = embeddings?.[0]?.embedding
  if (Array.isArray(vec) && vec.length > 0) {
    const vectorBatches = await Promise.all(
      scopeWorkspaceIds.map((workspaceId) =>
        params.supabase.rpc("gob_search_chunks", {
          p_workspace_id: workspaceId,
          p_query_embedding: toVectorLiteral(vec),
          p_match_count: perWorkspaceMatchCount,
          p_min_similarity: minSimilarity,
        })
      )
    )

    const merged = vectorBatches
      .flatMap((batch: any) => {
        if (!batch || batch.error || !Array.isArray(batch.data)) return []
        return batch.data
      })
      .sort((a: any, b: any) => rankOfRow(b) - rankOfRow(a))

    if (merged.length > 0) {
      evidence = dedupeByChunkId(merged.map(toEvidenceChunk)).slice(0, maxOut)
    }
  }

  if (evidence.length < 6) {
    const textBatches = await Promise.all(
      scopeWorkspaceIds.map((workspaceId) =>
        params.supabase.rpc("gob_search_chunks_text", {
          p_workspace_id: workspaceId,
          p_query_text: params.question,
          p_match_count: perWorkspaceTextCount,
        })
      )
    )

    const mergedText = textBatches
      .flatMap((batch: any) => {
        if (!batch || batch.error || !Array.isArray(batch.data)) return []
        return batch.data
      })
      .sort((a: any, b: any) => rankOfRow(b) - rankOfRow(a))

    if (mergedText.length > 0) {
      evidence = dedupeByChunkId([...evidence, ...mergedText.map(toEvidenceChunk)]).slice(0, maxOut)
    }
  }

  return evidence.slice(0, Math.max(10, Math.min(90, maxOut)))
}
