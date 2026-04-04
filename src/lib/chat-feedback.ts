export type AssistantFeedbackVote = "useful" | "not_useful"

export type EvidenceFeedback = {
  chunkId: string
  vote: AssistantFeedbackVote
  reason: string | null
  traceId?: string | null
}

export type AssistantFeedback = {
  vote: AssistantFeedbackVote
  reason: string | null
  at: string
  byUser: string | null
}

export function applyAssistantFeedbackUsage(params: {
  usage: unknown
  feedback: AssistantFeedback
  evidenceFeedback?: EvidenceFeedback[]
}) {
  const base = params.usage && typeof params.usage === "object" && !Array.isArray(params.usage) ? params.usage : {}
  const evidenceFeedback = Array.isArray(params.evidenceFeedback)
    ? params.evidenceFeedback
        .map((item) => ({
          chunkId: String(item.chunkId || "").trim(),
          vote: item.vote,
          reason: item.reason ?? null,
          traceId: item.traceId ?? null,
        }))
        .filter((item) => item.chunkId)
        .slice(0, 8)
    : []
  return {
    ...(base as Record<string, unknown>),
    assistantFeedback: {
      vote: params.feedback.vote,
      reason: params.feedback.reason,
      at: params.feedback.at,
      byUser: params.feedback.byUser,
    },
    evidenceFeedback,
  }
}
