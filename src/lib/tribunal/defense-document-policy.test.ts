import test from "node:test"
import assert from "node:assert/strict"

import {
  inferDefenseDocumentRole,
  selectDefenseDocumentMix,
  selectRoleBalancedItems,
  summarizeDefenseDocumentCoverage,
} from "@/lib/tribunal/defense-document-policy"

test("summarizeDefenseDocumentCoverage detects missing sentencia in weak mixes", () => {
  const coverage = summarizeDefenseDocumentCoverage([
    { id: "1", document_type: "Evacua informe", name: "Informe SEA" },
    { id: "2", document_type: "Escrito inicial", name: "Reclamacion" },
  ])

  assert.equal(coverage.counts.informe, 1)
  assert.equal(coverage.counts.sentencia, 0)
  assert.equal(coverage.hasCorePair, false)
  assert.deepEqual(coverage.missingCoreRoles, ["sentencia"])
})

test("selectDefenseDocumentMix forces informe and sentencia before extra reclamaciones", () => {
  const docs = [
    { id: "1", document_type: "Escrito inicial", name: "Reclamacion 1", date: "2024-01-10" },
    { id: "2", document_type: "Escrito inicial", name: "Reclamacion 2", date: "2024-01-11" },
    { id: "3", document_type: "Evacua informe", name: "Informe SEA", date: "2024-03-12" },
    { id: "4", document_type: "Sentencia", name: "Sentencia definitiva", date: "2025-01-10" },
  ]

  const result = selectDefenseDocumentMix(docs, {
    limit: 3,
    preferredRoles: ["informe", "sentencia", "reclamacion"],
  })

  assert.deepEqual(
    result.selected.map((doc) => doc.id),
    ["3", "4", "1"]
  )
  assert.deepEqual(result.coverage.selectedRoles, ["informe", "sentencia", "reclamacion"])
})

test("selectRoleBalancedItems ensures required roles appear when present", () => {
  const selected = selectRoleBalancedItems(
    [
      { docRole: "reclamacion", name: "Reclamacion" },
      { docRole: "informe", name: "Informe" },
      { docRole: "sentencia", name: "Sentencia" },
      { docRole: "reclamacion", name: "Reclamacion 2" },
    ],
    {
      limit: 3,
      preferredRoles: ["informe", "sentencia", "reclamacion"],
      requiredRoles: ["informe", "sentencia"],
    }
  )

  assert.deepEqual(selected.map((item) => item.name), ["Informe", "Sentencia", "Reclamacion"])
})

test("inferDefenseDocumentRole falls back to section/title context", () => {
  const role = inferDefenseDocumentRole({
    section: "Sentencia definitiva | R-44-2021",
    title: "Documento tribunal",
  })

  assert.equal(role, "sentencia")
})
