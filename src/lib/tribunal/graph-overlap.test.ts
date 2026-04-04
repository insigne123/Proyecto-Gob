import test from "node:test"
import assert from "node:assert/strict"

import { buildGraphOverlapSignal, graphEntityTypeLabel, graphEntityWeight } from "@/lib/tribunal/graph-overlap"

test("graphEntityWeight prioritizes legal norms over generic entities", () => {
  assert.ok(graphEntityWeight("norma_legal") > graphEntityWeight("materia"))
  assert.equal(graphEntityTypeLabel("autoridad"), "autoridad")
})

test("buildGraphOverlapSignal combines matched entities and similarity score", () => {
  const signal = buildGraphOverlapSignal({
    matchedEntities: [
      { entityType: "norma_legal", entityValue: "Ley 19.300", normalizedValue: "ley 19.300" },
      { entityType: "autoridad", entityValue: "SEA", normalizedValue: "sea" },
      { entityType: "autoridad", entityValue: "SEA", normalizedValue: "sea" },
    ],
    similarityScore: 0.6,
    relatedRoles: ["R-44-2021"],
  })

  assert.ok(signal.score > 0.8)
  assert.deepEqual(signal.matchedEntityTypes, ["norma", "autoridad"])
  assert.deepEqual(signal.relatedRoles, ["R-44-2021"])
})
