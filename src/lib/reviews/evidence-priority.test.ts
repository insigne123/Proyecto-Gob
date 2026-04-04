import test from "node:test"
import assert from "node:assert/strict"

import { prioritizeReviewEvidence } from "@/lib/reviews/evidence-priority"

test("prioritizeReviewEvidence favors informe over sentencia for defense-oriented review", () => {
  const chunks = [
    { snapshotId: "s1", section: "sec", rank: 5 },
    { snapshotId: "s2", section: "sec", rank: 10 },
    { snapshotId: "s3", section: "sec", rank: 20 },
  ]

  const context = new Map([
    ["s1", { title: "Escrito inicial", docType: "reclamacion", docRole: "reclamacion", rol: "R-1-2024" }],
    ["s2", { title: "Sentencia", docType: "sentencia", docRole: "sentencia", rol: "R-1-2024" }],
    ["s3", { title: "Evacua informe", docType: "informe", docRole: "informe", rol: "R-1-2024" }],
  ])

  const ordered = prioritizeReviewEvidence({
    chunks,
    contextBySnapshotId: context,
    question: "Revisa la estrategia de defensa del SEA y los criterios del evacua informe",
    limit: 3,
  })

  assert.deepEqual(
    ordered.map((chunk) => chunk.snapshotId),
    ["s3", "s2", "s1"]
  )
})
