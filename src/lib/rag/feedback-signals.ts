import { getRuntimeCached } from "@/lib/runtime-cache"

export type RetrievalFeedbackSignals = {
  chunkScores: Record<string, number>
  snapshotScores: Record<string, number>
}

function addScore(target: Record<string, number>, key: string, delta: number) {
  const clean = String(key || "").trim()
  if (!clean) return
  target[clean] = Number(((target[clean] || 0) + delta).toFixed(4))
}

export function collectRetrievalFeedbackSignals(traces: any[]): RetrievalFeedbackSignals {
  const chunkScores: Record<string, number> = {}
  const snapshotScores: Record<string, number> = {}

  for (const trace of Array.isArray(traces) ? traces : []) {
    const metadata = trace?.metadata && typeof trace.metadata === "object" && !Array.isArray(trace.metadata) ? trace.metadata : {}
    const results = Array.isArray(trace?.results) ? trace.results : []
    const byChunkId = new Map<string, string>()
    for (const result of results) {
      const chunkId = String(result?.chunkId || "").trim()
      const snapshotId = String(result?.snapshotId || "").trim()
      if (chunkId && snapshotId && !byChunkId.has(chunkId)) byChunkId.set(chunkId, snapshotId)
    }

    const evidenceFeedback = Array.isArray((metadata as any)?.evidence_feedback)
      ? (metadata as any).evidence_feedback
      : Array.isArray((metadata as any)?.evidenceFeedback)
        ? (metadata as any).evidenceFeedback
        : []

    for (const item of evidenceFeedback) {
      const chunkId = String(item?.chunkId || "").trim()
      if (!chunkId) continue
      const vote = String(item?.vote || "").trim().toLowerCase()
      const delta = vote === "useful" ? 1 : vote === "not_useful" ? -1 : 0
      if (!delta) continue
      addScore(chunkScores, chunkId, delta)
      const snapshotId = byChunkId.get(chunkId)
      if (snapshotId) addScore(snapshotScores, snapshotId, delta)
    }
  }

  return { chunkScores, snapshotScores }
}

export async function loadWorkspaceRetrievalFeedbackSignals(params: {
  admin: any
  workspaceId: string
  limit?: number
}) {
  return getRuntimeCached({
    namespace: "rag-feedback-signals",
    key: JSON.stringify({ workspaceId: params.workspaceId, limit: Number(params.limit || 120) }),
    ttlMs: 3 * 60 * 1000,
    loader: async () => {
      const { data } = await params.admin
        .from("gob_rag_retrieval_traces")
        .select("results,metadata")
        .eq("workspace_id", params.workspaceId)
        .eq("stage", "chat")
        .order("created_at", { ascending: false })
        .limit(Math.max(20, Math.min(300, Number(params.limit || 120))))

      return collectRetrievalFeedbackSignals(data || [])
    },
  })
}
