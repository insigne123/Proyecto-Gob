import test from "node:test"
import assert from "node:assert/strict"

import { verifyRetrievalSufficiency } from "@/lib/rag/retrieval-verifier"

test("verifyRetrievalSufficiency stops loop when coverage is already sufficient", () => {
  const result = verifyRetrievalSufficiency({
    evidence: [
      { chunkId: "c1", content: "a", sourceUrl: null, snapshotId: "s1", page: 1, section: null, docRole: "informe", documentType: "informe", documentTitle: "a" },
      { chunkId: "c2", content: "b", sourceUrl: null, snapshotId: "s2", page: 2, section: null, docRole: "sentencia", documentType: "sentencia", documentTitle: "b" },
      { chunkId: "c3", content: "c", sourceUrl: null, snapshotId: "s3", page: 3, section: null, docRole: "sentencia", documentType: "sentencia", documentTitle: "c" },
      { chunkId: "c4", content: "d", sourceUrl: null, snapshotId: "s4", page: 4, section: null, docRole: "informe", documentType: "informe", documentTitle: "d" },
    ],
    coverageScore: 0.4,
    targetEvidenceCount: 4,
    profileMaxResults: 6,
    isFactualPipeline: false,
    defenseCoverage: { status: "ready", missingRequiredRoles: [] },
  })

  assert.equal(result.continueLoop, false)
  assert.equal(result.reason, "coverage_sufficient")
})

test("verifyRetrievalSufficiency asks for more evidence when roles are still missing", () => {
  const result = verifyRetrievalSufficiency({
    evidence: [{ chunkId: "c1", content: "a", sourceUrl: null, snapshotId: "s1", page: 1, section: null, docRole: "reclamacion", documentType: "reclamacion", documentTitle: "a" }],
    coverageScore: 0.05,
    targetEvidenceCount: 5,
    profileMaxResults: 6,
    isFactualPipeline: false,
    defenseCoverage: { status: "partial", missingRequiredRoles: ["sentencia"] },
  })

  assert.equal(result.continueLoop, true)
  assert.equal(result.reason, "need_more_evidence")
})
