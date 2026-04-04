import test from "node:test"
import assert from "node:assert/strict"

import { classifyTribunalDocumentRole, isStrictTribunalKeyDocument } from "@/lib/tribunal/document-role"

test("classifyTribunalDocumentRole detects reclamacion from accented titles", () => {
  const role = classifyTribunalDocumentRole({
    title: "Recurso de reclamacion presentado por la comunidad",
    documentType: "Escrito inicial",
  })

  assert.equal(role, "reclamacion")
})

test("classifyTribunalDocumentRole detects informe before generic document", () => {
  const role = classifyTribunalDocumentRole({
    documentType: "Evacua el informe",
    name: "respuesta-municipal.pdf",
  })

  assert.equal(role, "informe")
})

test("classifyTribunalDocumentRole avoids sentencia false positives from certificates", () => {
  const role = classifyTribunalDocumentRole({
    title: "Certificado de notificacion de sentencia definitiva",
    name: "acuse.pdf",
  })

  assert.equal(role, "documento")
  assert.equal(isStrictTribunalKeyDocument({ title: "Sentencia definitiva" }), true)
})

test("classifyTribunalDocumentRole detects informe from evacuation-style resolutions", () => {
  const role = classifyTribunalDocumentRole({
    title: "Resolucion que tiene por evacuado informe",
    documentType: "Por evacuado informe",
  })

  assert.equal(role, "informe")
})

test("classifyTribunalDocumentRole detects reclamacion from desistimiento", () => {
  const role = classifyTribunalDocumentRole({
    title: "Desistimiento de reclamacion",
    documentType: "Escrito",
  })

  assert.equal(role, "reclamacion")
})

test("classifyTribunalDocumentRole treats resolution with ruling verbs as sentencia", () => {
  const role = classifyTribunalDocumentRole({
    title: "Resolucion que acoge el recurso",
    documentType: "Resolucion",
  })

  assert.equal(role, "sentencia")
})
