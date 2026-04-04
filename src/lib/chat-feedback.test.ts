import test from "node:test"
import assert from "node:assert/strict"

import { applyAssistantFeedbackUsage } from "@/lib/chat-feedback"

test("applyAssistantFeedbackUsage preserves prior usage fields and writes assistant feedback", () => {
  const next = applyAssistantFeedbackUsage({
    usage: {
      totalTokens: 120,
      assistantReport: { mode: "checklist" },
    },
    feedback: {
      vote: "useful",
      reason: null,
      at: "2026-03-13T12:00:00.000Z",
      byUser: "user-1",
    },
    evidenceFeedback: [
      {
        chunkId: "chunk-1",
        vote: "useful",
        reason: "Fue la cita mas util",
        traceId: "trace-1",
      },
    ],
  })

  assert.equal((next as any).totalTokens, 120)
  assert.equal((next as any).assistantReport.mode, "checklist")
  assert.deepEqual((next as any).assistantFeedback, {
    vote: "useful",
    reason: null,
    at: "2026-03-13T12:00:00.000Z",
    byUser: "user-1",
  })
  assert.deepEqual((next as any).evidenceFeedback, [
    {
      chunkId: "chunk-1",
      vote: "useful",
      reason: "Fue la cita mas util",
      traceId: "trace-1",
    },
  ])
})
