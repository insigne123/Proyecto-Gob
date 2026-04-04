import test from "node:test"
import assert from "node:assert/strict"

import { pickDocumentsForDefense, sortDocumentsForDefense } from "@/lib/tribunal/document-selection"

test("pickDocumentsForDefense prioritizes informe and sentencia before reclamacion", () => {
  const docs = [
    { id: "1", document_type: "Escrito Inicial", name: "Reclamacion", date: "2024-01-10" },
    { id: "2", document_type: "Evacua informe", name: "Informe SEA", date: "2024-03-12" },
    { id: "3", document_type: "Sentencia", name: "Sentencia definitiva", date: "2025-01-10" },
  ]

  const selected = pickDocumentsForDefense(docs, { limit: 3 })

  assert.deepEqual(
    selected.map((doc) => doc.id),
    ["2", "3", "1"]
  )
})

test("sortDocumentsForDefense respects matched docs inside preferred role order", () => {
  const docs = [
    { id: "a", document_type: "Sentencia", name: "Sentencia", date: "2025-01-10" },
    { id: "b", document_type: "Evacua informe", name: "Informe SEA", date: "2024-03-12" },
    { id: "c", document_type: "Evacua informe", name: "Informe SEA 2", date: "2024-04-12" },
  ]

  const ordered = sortDocumentsForDefense(docs, {
    matchedDocIds: new Set(["c"]),
    preferredRoles: ["informe", "sentencia", "reclamacion"],
  })

  assert.deepEqual(
    ordered.map((doc) => doc.id),
    ["c", "b", "a"]
  )
})
