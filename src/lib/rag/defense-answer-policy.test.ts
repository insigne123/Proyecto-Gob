import test from "node:test"
import assert from "node:assert/strict"

import {
  buildDefenseAnswerPolicy,
  shouldForceDefenseAbstention,
  summarizeDefenseEvidenceCoverage,
} from "@/lib/rag/defense-answer-policy"
import { inferRagQueryIntent } from "@/lib/rag/query-intent"

test("buildDefenseAnswerPolicy requires informe and sentencia for document-priority questions", () => {
  const question = "Segun el marco teorico, que documentos deberian priorizarse para la defensa del SEA?"
  const policy = buildDefenseAnswerPolicy({
    question,
    intent: inferRagQueryIntent(question),
    mode: "checklist",
    responseProfile: "deep",
  })

  assert.deepEqual(policy.requiredRoles, ["informe", "sentencia"])
  assert.equal(policy.strict, true)
  assert.ok(policy.targetedQueries.some((query) => query.includes("sentencia")))
})

test("summarizeDefenseEvidenceCoverage marks partial coverage when sentencia is missing", () => {
  const coverage = summarizeDefenseEvidenceCoverage({
    requiredRoles: ["informe", "sentencia"],
    evidence: [
      {
        chunkId: "c1",
        content: "criterios del SEA",
        sourceUrl: null,
        snapshotId: "s1",
        page: 4,
        section: "Informe | defensa",
        docRole: "informe",
      },
    ],
  })

  assert.equal(coverage.status, "partial")
  assert.deepEqual(coverage.missingRequiredRoles, ["sentencia"])
})

test("shouldForceDefenseAbstention activates for strict partial coverage plus weak support", () => {
  const question = "Como debe usarse la reclamacion: como contexto o como prueba principal?"
  const policy = buildDefenseAnswerPolicy({
    question,
    intent: inferRagQueryIntent(question),
    mode: "extractive",
    responseProfile: "balanced",
  })
  const coverage = summarizeDefenseEvidenceCoverage({
    requiredRoles: policy.requiredRoles,
    evidence: [
      {
        chunkId: "c1",
        content: "texto de reclamacion",
        sourceUrl: null,
        snapshotId: "s1",
        page: 1,
        section: "Escrito inicial",
        docRole: "reclamacion",
      },
    ],
  })

  assert.equal(shouldForceDefenseAbstention({ policy, coverage, supportStrength: "weak" }), true)
})
