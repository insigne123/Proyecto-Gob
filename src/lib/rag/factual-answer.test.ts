import test from "node:test"
import assert from "node:assert/strict"

import { buildDeterministicFactualAnswer, isLikelyFactualQuestion } from "@/lib/rag/factual-answer"

test("isLikelyFactualQuestion detects extractive factual prompts", () => {
  assert.equal(isLikelyFactualQuestion("En R-27-2019, que fojas se mencionan en el documento de desistimiento?"), true)
  assert.equal(isLikelyFactualQuestion("Que norma cita la sentencia en R-44-2021?"), true)
  assert.equal(isLikelyFactualQuestion("Segun el marco teorico, que estrategia conviene seguir?"), false)
})

test("buildDeterministicFactualAnswer extracts fojas deterministically", () => {
  const out = buildDeterministicFactualAnswer({
    question: "En R-27-2019, que fojas se mencionan en el documento de desistimiento?",
    evidence: [
      {
        chunkId: "c1",
        content: "Por esta razon, esta parte viene en desistirse pura y simplemente de la presente reclamacion. Fojas 3691 tres mil seiscientos noventa y uno.",
        sourceUrl: null,
        snapshotId: "s1",
        page: 1,
        section: "R-27-2019 - Desistimiento",
        docRole: "reclamacion",
        documentType: "reclamacion",
        documentTitle: "R-27-2019 - Desistimiento",
      },
      {
        chunkId: "c2",
        content: "Fojas 3692 tres mil seiscientos noventa y dos.",
        sourceUrl: null,
        snapshotId: "s2",
        page: 1,
        section: "R-27-2019 - DESISTIMIENTO DE RECLAMACION",
        docRole: "reclamacion",
        documentType: "reclamacion",
        documentTitle: "R-27-2019 - DESISTIMIENTO DE RECLAMACION",
      },
    ],
  })

  assert.equal(out.applied, true)
  assert.equal(out.kind, "fojas")
  assert.match(out.answer, /3691/)
  assert.match(out.answer, /3692/)
  assert.equal(out.citations.length, 2)
})

test("buildDeterministicFactualAnswer extracts claimant from written complaint", () => {
  const out = buildDeterministicFactualAnswer({
    question: "En R-113-2024, quien figura como reclamante segun el escrito inicial?",
    evidence: [
      {
        chunkId: "c1",
        content:
          "Juan Perez, abogado, en representacion de la reclamante, Comunidad Indigena de Taira, comparece ante el Tribunal.",
        sourceUrl: null,
        snapshotId: "s1",
        page: 1,
        section: "R-113-2024 - escrito inicial",
        docRole: "reclamacion",
        documentType: "reclamacion",
        documentTitle: "R-113-2024 - escrito inicial",
      },
    ],
  })

  assert.equal(out.applied, true)
  assert.equal(out.kind, "claimant")
  assert.match(out.answer, /Comunidad Indigena de Taira/)
  assert.equal(out.citations.length, 1)
})

test("buildDeterministicFactualAnswer confirms document existence with exact citation", () => {
  const out = buildDeterministicFactualAnswer({
    question: "Para R-107-2024, existe una sentencia en el corpus?",
    evidence: [
      {
        chunkId: "c1",
        content: "Fecha de la sentencia: 2 de marzo de 2026. Primer Tribunal Ambiental.",
        sourceUrl: null,
        snapshotId: "s1",
        page: 1,
        section: "R-107-2024 - Sentencia",
        docRole: "sentencia",
        documentType: "sentencia",
        documentTitle: "R-107-2024 - Sentencia",
      },
    ],
  })

  assert.equal(out.applied, true)
  assert.equal(out.kind, "existence")
  assert.match(out.answer, /Sí, existe una sentencia/)
  assert.equal(out.citations.length, 1)
})

test("buildDeterministicFactualAnswer extracts cited norms deterministically", () => {
  const out = buildDeterministicFactualAnswer({
    question: "Que norma cita la sentencia en R-44-2021?",
    evidence: [
      {
        chunkId: "c1",
        content: "La sentencia aplica el articulo 11 de la Ley 19.300 para resolver el conflicto.",
        sourceUrl: null,
        snapshotId: "s1",
        page: 4,
        section: "R-44-2021 - Sentencia",
        docRole: "sentencia",
        documentType: "sentencia",
        documentTitle: "R-44-2021 - Sentencia",
      },
    ],
  })

  assert.equal(out.applied, true)
  assert.equal(out.kind, "norms")
  assert.match(out.answer, /art/i)
  assert.equal(out.citations.length, 1)
})

test("buildDeterministicFactualAnswer extracts authority, outcome, and holding deterministically", () => {
  const evidence = [
    {
      chunkId: "c1",
      content: "El Servicio de Evaluacion Ambiental sostuvo que no se advierte ilegalidad en la RCA.",
      sourceUrl: null,
      snapshotId: "s1",
      page: 3,
      section: "R-44-2021 - Informe",
      docRole: "informe",
      documentType: "informe",
      documentTitle: "R-44-2021 - Informe",
    },
    {
      chunkId: "c2",
      content: "La sentencia rechaza la reclamacion y esta magistratura concluye que no se advierte ilegalidad.",
      sourceUrl: null,
      snapshotId: "s2",
      page: 7,
      section: "R-44-2021 - Sentencia",
      docRole: "sentencia",
      documentType: "sentencia",
      documentTitle: "R-44-2021 - Sentencia",
    },
  ]

  const authority = buildDeterministicFactualAnswer({
    question: "Que autoridad aparece en R-44-2021?",
    evidence,
  })
  assert.equal(authority.kind, "authority")
  assert.match(authority.answer, /Servicio de Evaluacion Ambiental|SEA/)

  const outcome = buildDeterministicFactualAnswer({
    question: "Cual fue el resultado en R-44-2021?",
    evidence,
  })
  assert.equal(outcome.kind, "outcome")
  assert.match(outcome.answer, /rechaza/i)

  const holding = buildDeterministicFactualAnswer({
    question: "Que conclusion relevante aparece en R-44-2021?",
    evidence,
  })
  assert.equal(holding.kind, "holding")
  assert.match(holding.answer, /no se advierte ilegalidad|esta magistratura/i)
})
