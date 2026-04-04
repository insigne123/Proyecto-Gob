import test from "node:test"
import assert from "node:assert/strict"

import { normalizePersistedOnboardingArtifacts } from "@/lib/onboarding/artifacts"

test("normalizePersistedOnboardingArtifacts restores structured memory and tribunal references", () => {
  const artifacts = normalizePersistedOnboardingArtifacts({
    workspace_id: "workspace-1",
    run_id: "run-1",
    claim_snapshot_id: "snapshot-1",
    version: 2,
    summary: "Resumen del marco teorico",
    report_content: "Informe automatico del marco teorico",
    structured_memory: {
      version: 1,
      summary: "Resumen",
      defenseHypothesis: "Hipotesis",
      defenseCriteria: ["criterio 1"],
      documentPriorityRules: ["priorizar informe"],
      outcomeLessons: ["leccion 1"],
      misuseRisks: ["riesgo 1"],
      contextFacts: ["hecho 1"],
      precedentRationales: ["rationale 1"],
      preferredCauses: [{ causeId: "c1", rol: "R-1-2017" }],
      keyDocuments: [{ causeId: "c1", rol: "R-1-2017", name: "Evacua informe", docRole: "informe" }],
    },
    tribunal_references: [
      {
        snapshotId: "snap-1",
        sourceTitle: "Evacua informe",
        docRole: "informe",
        rol: "R-1-2017",
      },
    ],
    recommendations: [{ causeId: "c1" }],
    matrix: [{ causeId: "c1" }],
    metadata: { source: "onboarding_complete" },
  })

  assert.ok(artifacts)
  assert.equal(artifacts?.workspaceId, "workspace-1")
  assert.equal(artifacts?.structuredMemory?.documentPriorityRules[0], "priorizar informe")
  assert.equal(artifacts?.tribunalReferences[0]?.snapshotId, "snap-1")
  assert.equal(artifacts?.recommendations.length, 1)
})

test("normalizePersistedOnboardingArtifacts keeps version metadata when available", () => {
  const artifacts = normalizePersistedOnboardingArtifacts({
    workspace_id: "workspace-2",
    version: 3,
    version_id: "6d1542f2-49e9-4ce6-b2d1-7b0efbe1a2ab",
    version_count: 5,
    structured_memory: {},
    tribunal_references: [],
    recommendations: [],
    matrix: [],
    metadata: {},
  })

  assert.equal(artifacts?.versionId, "6d1542f2-49e9-4ce6-b2d1-7b0efbe1a2ab")
  assert.equal(artifacts?.versionCount, 5)
})
