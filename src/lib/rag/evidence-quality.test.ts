import test from "node:test"
import assert from "node:assert/strict"

import { inferHeuristicEvidenceQuality } from "@/lib/rag/evidence-quality"

test("inferHeuristicEvidenceQuality marks well-covered evidence as sufficient", () => {
  const result = inferHeuristicEvidenceQuality({
    question: "Cuales fueron los criterios de defensa del SEA en el informe y que dijo la sentencia",
    evidence: [
      {
        chunkId: "c1",
        content:
          "El evacua informe del SEA desarrolla criterios de defensa sobre trazabilidad, linea de base y evaluacion de impactos acumulativos.",
        sourceUrl: null,
        snapshotId: "s1",
        page: 4,
        section: "informe",
      },
      {
        chunkId: "c2",
        content:
          "La sentencia analiza esos criterios y concluye que la evaluacion ambiental fue suficiente respecto de los impactos y la participacion ciudadana.",
        sourceUrl: null,
        snapshotId: "s2",
        page: 18,
        section: "sentencia",
      },
      {
        chunkId: "c3",
        content:
          "Otro pasaje del informe detalla la defensa del SEA sobre suficiencia metodologica, participacion ciudadana y consistencia tecnica del expediente.",
        sourceUrl: null,
        snapshotId: "s1",
        page: 6,
        section: "informe",
      },
      {
        chunkId: "c4",
        content:
          "La sentencia final descarta varios reproches de la reclamacion y explica el resultado final a partir de esos criterios defensivos y del estandar de evaluacion aplicado.",
        sourceUrl: null,
        snapshotId: "s2",
        page: 21,
        section: "sentencia",
      },
    ],
    coverageScore: 0.39,
    difficulty: "complex",
    mode: "comparison",
  })

  assert.equal(result.quality, "sufficient")
  assert.equal(result.shouldEarlyExit, false)
  assert.ok(result.lexicalCoverage > 0.2)
})

test("inferHeuristicEvidenceQuality marks weak evidence as insufficient", () => {
  const result = inferHeuristicEvidenceQuality({
    question: "Que argumentos de defensa uso el SEA y cual fue el resultado final",
    evidence: [
      {
        chunkId: "c1",
        content: "Documento administrativo de contexto general sin referencia al informe ni a la sentencia.",
        sourceUrl: null,
        snapshotId: "s1",
        page: 1,
        section: "contexto",
      },
    ],
    coverageScore: 0.05,
    difficulty: "medium",
    mode: "extractive",
  })

  assert.equal(result.quality, "insufficient")
  assert.equal(result.shouldEarlyExit, true)
})
