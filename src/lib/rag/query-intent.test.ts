import test from "node:test"
import assert from "node:assert/strict"

import { extractRoleToken, inferRagQueryIntent } from "@/lib/rag/query-intent"

test("inferRagQueryIntent prioritizes informe and sentencia for defense outcome questions", () => {
  const intent = inferRagQueryIntent(
    "Que criterios defensivos del SEA aparecen en los evacua informes y como terminaron esas causas?"
  )

  assert.deepEqual(intent.preferredDocRoles, ["informe", "sentencia"])
  assert.equal(intent.asksForDefenseCriteria, true)
  assert.equal(intent.asksForOutcome, true)
  assert.equal(intent.questionType, "strategic")
  assert.equal(intent.complexity, "medium")
  assert.ok(intent.retrievalHints.some((hint) => hint.includes("evacua informe")))
  assert.ok(intent.retrievalHints.some((hint) => hint.includes("sentencia resolucion final")))
})

test("inferRagQueryIntent keeps reclamacion as contextual role when explicitly requested", () => {
  const intent = inferRagQueryIntent("Compara la reclamacion inicial de la causa R-44-2021 con sus precedentes")

  assert.equal(extractRoleToken("Compara la causa R-44-2021"), "R-44-2021")
  assert.equal(intent.roleToken, "R-44-2021")
  assert.ok(intent.preferredDocRoles.includes("reclamacion"))
  assert.equal(intent.asksForComparison, true)
  assert.equal(intent.needsMultiCause, true)
  assert.equal(intent.questionType, "comparative")
})

test("inferRagQueryIntent prioritizes informe and sentencia for marco teorico document-priority questions", () => {
  const intent = inferRagQueryIntent(
    "Segun el marco teorico, que documentos deberian priorizarse para construir la defensa del SEA y por que?"
  )

  assert.equal(intent.asksForDocumentPriority, true)
  assert.deepEqual(intent.preferredDocRoles.slice(0, 2), ["informe", "sentencia"])
  assert.equal(intent.complexity, "complex")
  assert.ok(intent.retrievalHints.some((hint) => hint.includes("priorizar informe sentencia")))
})

test("inferRagQueryIntent treats reclamacion as context when the question contrasts context vs proof", () => {
  const intent = inferRagQueryIntent(
    "Como debe usarse la reclamacion dentro del marco teorico: como prueba principal o como contexto?"
  )

  assert.equal(intent.asksForContextUse, true)
  assert.deepEqual(intent.preferredDocRoles, ["sentencia", "informe", "reclamacion"])
  assert.ok(intent.retrievalHints.some((hint) => hint.includes("contexto secundario")))
})

test("inferRagQueryIntent marks direct factual existence questions as facts-first", () => {
  const intent = inferRagQueryIntent("Para R-107-2024, existe una sentencia en el corpus?")

  assert.equal(intent.questionType, "factual")
  assert.equal(intent.complexity, "simple")
  assert.equal(intent.needsFactsFirst, true)
  assert.equal(intent.preferredDocRoles[0], "sentencia")
})
