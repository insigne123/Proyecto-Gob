import test from "node:test"
import assert from "node:assert/strict"

import { resolveFinalAnswerSupport } from "@/lib/rag/final-support"

test("resolveFinalAnswerSupport upgrades null support to partial when rescue answer keeps multiple citations", () => {
  const out = resolveFinalAnswerSupport({
    initialStrength: null,
    rescueApplied: true,
    citations: [{ chunkId: "c1" }, { chunkId: "c2" }],
    defenseCoverageStatus: "partial",
    mode: "checklist",
  })

  assert.equal(out.strength, "partial")
  assert.equal(out.uniqueCitationChunks, 2)
})

test("resolveFinalAnswerSupport can promote rescued strategic answers to strong when coverage is ready", () => {
  const out = resolveFinalAnswerSupport({
    initialStrength: null,
    rescueApplied: true,
    citations: [{ chunkId: "c1" }, { chunkId: "c2" }, { chunkId: "c3" }],
    defenseCoverageStatus: "ready",
    mode: "checklist",
  })

  assert.equal(out.strength, "strong")
})

test("resolveFinalAnswerSupport can promote robust partial support to strong", () => {
  const out = resolveFinalAnswerSupport({
    initialStrength: "partial",
    rescueApplied: false,
    citations: [{ chunkId: "c1" }, { chunkId: "c2" }, { chunkId: "c3" }],
    defenseCoverageStatus: "ready",
    mode: "checklist",
  })

  assert.equal(out.strength, "strong")
})

test("resolveFinalAnswerSupport marks single-citation answers as weak when there was no prior support", () => {
  const out = resolveFinalAnswerSupport({
    initialStrength: null,
    rescueApplied: false,
    citations: [{ chunkId: "c1" }],
    defenseCoverageStatus: "ready",
    mode: "comparison",
  })

  assert.equal(out.strength, "weak")
})
