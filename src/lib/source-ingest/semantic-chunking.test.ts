import test from "node:test"
import assert from "node:assert/strict"

import {
  extractPdfSemanticBlocks,
  isLikelySectionHeading,
  splitTextSemantically,
  topSectionLabels,
} from "@/lib/source-ingest/semantic-chunking"

test("isLikelySectionHeading detects numbered and uppercase headings", () => {
  assert.equal(isLikelySectionHeading("2.1 Marco Normativo"), true)
  assert.equal(isLikelySectionHeading("ANTECEDENTES DEL PROYECTO"), true)
  assert.equal(isLikelySectionHeading("Este parrafo explica hechos relevantes."), false)
})

test("extractPdfSemanticBlocks preserves section labels by page", () => {
  const blocks = extractPdfSemanticBlocks(
    "1. Hechos relevantes\nLa reclamacion cuestiona la motivacion del acto.\n\n2. Marco normativo\nEl SEA evacuo informe tecnico con respuesta detallada.",
    3
  )

  assert.equal(blocks.length, 2)
  assert.equal(blocks[0]?.section, "p.3 | 1. Hechos relevantes")
  assert.equal(blocks[1]?.section, "p.3 | 2. Marco normativo")
})

test("splitTextSemantically keeps meaningful chunks and drops low-value noise", () => {
  const pieces = splitTextSemantically(
    "ANEXO\n\n" +
      "El SEA evacuo informe con fundamentos tecnicos suficientes para rechazar la reclamacion y responder cada observacion ciudadana con respaldo documental. ".repeat(4) +
      "La sentencia recogio esos criterios y confirmo la resolucion administrativa con una motivacion extensa y verificable. ".repeat(4),
    { maxChars: 520, overlap: 80 }
  )

  assert.ok(pieces.length >= 2)
  assert.ok(pieces.every((piece) => piece.length >= 40))
  assert.ok(topSectionLabels([{ section: "p.3 | Marco normativo" }, { section: "p.4 | Sentencia" }], 5).length === 2)
})
