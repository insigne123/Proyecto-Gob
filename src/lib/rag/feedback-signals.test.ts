import test from "node:test"
import assert from "node:assert/strict"

import { collectRetrievalFeedbackSignals } from "@/lib/rag/feedback-signals"

test("collectRetrievalFeedbackSignals aggregates chunk and snapshot votes", () => {
  const signals = collectRetrievalFeedbackSignals([
    {
      results: [
        { chunkId: "c1", snapshotId: "s1" },
        { chunkId: "c2", snapshotId: "s2" },
      ],
      metadata: {
        evidence_feedback: [
          { chunkId: "c1", vote: "useful" },
          { chunkId: "c2", vote: "not_useful" },
        ],
      },
    },
    {
      results: [{ chunkId: "c1", snapshotId: "s1" }],
      metadata: {
        evidenceFeedback: [{ chunkId: "c1", vote: "useful" }],
      },
    },
  ])

  assert.equal(signals.chunkScores.c1, 2)
  assert.equal(signals.chunkScores.c2, -1)
  assert.equal(signals.snapshotScores.s1, 2)
  assert.equal(signals.snapshotScores.s2, -1)
})
