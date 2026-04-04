import test from "node:test"
import assert from "node:assert/strict"

import { heuristicRerankEvidenceForAnswering, rerankEvidenceForAnswering } from "@/lib/rag/rerank"

test("heuristicRerankEvidenceForAnswering prioritizes informe and sentencia core pair over reclamacion", () => {
  const ordered = heuristicRerankEvidenceForAnswering({
    question: "Segun el marco teorico, que documentos deberian priorizarse para la defensa del SEA y por que?",
    mode: "checklist",
    difficulty: "complex",
    maxOut: 4,
    evidence: [
      {
        chunkId: "c1",
        content: "Texto de la reclamacion R-44-2021.",
        sourceUrl: null,
        snapshotId: "s1",
        page: 1,
        section: "R-44-2021 - Reclamacion",
        docRole: "reclamacion",
        documentType: "reclamacion",
        documentTitle: "R-44-2021 - Reclamacion",
      },
      {
        chunkId: "c2",
        content: "Evacua informe con criterios tecnicos del SEA.",
        sourceUrl: null,
        snapshotId: "s2",
        page: 3,
        section: "R-44-2021 - Informe",
        docRole: "informe",
        documentType: "informe",
        documentTitle: "R-44-2021 - Informe",
      },
      {
        chunkId: "c3",
        content: "Sentencia definitiva que valora dichos criterios.",
        sourceUrl: null,
        snapshotId: "s3",
        page: 12,
        section: "R-44-2021 - Sentencia",
        docRole: "sentencia",
        documentType: "sentencia",
        documentTitle: "R-44-2021 - Sentencia",
      },
    ],
  })

  assert.deepEqual(ordered.slice(0, 3).map((row) => row.chunkId), ["c2", "c3", "c1"])
})

test("heuristicRerankEvidenceForAnswering boosts chunks with positive feedback signals", () => {
  const ordered = heuristicRerankEvidenceForAnswering({
    question: "Que criterio del SEA sirve como precedente?",
    mode: "comparison",
    difficulty: "complex",
    maxOut: 2,
    feedbackSignals: {
      chunkScores: { c1: 2 },
      snapshotScores: {},
    },
    evidence: [
      {
        chunkId: "c1",
        content: "Texto util con feedback positivo.",
        sourceUrl: null,
        snapshotId: "s1",
        page: 1,
        section: "Otros",
        docRole: null,
        documentType: "memo",
        documentTitle: "Memo",
      },
      {
        chunkId: "c2",
        content: "Otro texto parecido pero sin feedback.",
        sourceUrl: null,
        snapshotId: "s2",
        page: 1,
        section: "Otros",
        docRole: null,
        documentType: "memo",
        documentTitle: "Memo 2",
      },
    ],
  })

  assert.deepEqual(ordered.map((row) => row.chunkId), ["c1", "c2"])
})

test("heuristicRerankEvidenceForAnswering rewards richer cause bundles over isolated chunks", () => {
  const ordered = heuristicRerankEvidenceForAnswering({
    question: "Compara precedentes del SEA y explica cuales sirven mejor",
    mode: "comparison",
    difficulty: "complex",
    maxOut: 3,
    evidence: [
      {
        chunkId: "iso",
        content: "R-1-2020 sentencia aislada con poca cobertura.",
        sourceUrl: null,
        snapshotId: "s1",
        page: 1,
        section: "R-1-2020 sentencia",
        docRole: "sentencia",
        documentType: "sentencia",
        documentTitle: "R-1-2020 sentencia",
      },
      {
        chunkId: "bundle-informe",
        content: "R-44-2021 informe del SEA con criterios defensivos.",
        sourceUrl: null,
        snapshotId: "s2",
        page: 2,
        section: "R-44-2021 informe",
        docRole: "informe",
        documentType: "informe",
        documentTitle: "R-44-2021 informe",
      },
      {
        chunkId: "bundle-sentencia",
        content: "R-44-2021 sentencia que confirma el resultado final.",
        sourceUrl: null,
        snapshotId: "s3",
        page: 8,
        section: "R-44-2021 sentencia",
        docRole: "sentencia",
        documentType: "sentencia",
        documentTitle: "R-44-2021 sentencia",
      },
    ],
  })

  assert.deepEqual(ordered.map((row) => row.chunkId), ["bundle-informe", "bundle-sentencia", "iso"])
})

test("rerankEvidenceForAnswering can use cross-encoder mock provider when llm rerank is disabled", async () => {
  const prevCross = process.env.RAG_ENABLE_CROSS_ENCODER_RERANK
  const prevProvider = process.env.RAG_CROSS_ENCODER_PROVIDER
  const prevLlm = process.env.RAG_ENABLE_LLM_RERANK

  process.env.RAG_ENABLE_CROSS_ENCODER_RERANK = "true"
  process.env.RAG_CROSS_ENCODER_PROVIDER = "mock"
  process.env.RAG_ENABLE_LLM_RERANK = "false"

  try {
    const result = await rerankEvidenceForAnswering({
      question: "Que dice la sentencia sobre los criterios del SEA?",
      mode: "comparison",
      difficulty: "complex",
      responseProfile: "balanced",
      maxOut: 2,
      evidence: [
        {
          chunkId: "c1",
          content: "Reclamacion inicial con argumentos generales.",
          sourceUrl: null,
          snapshotId: "s1",
          page: 1,
          section: "Reclamacion",
          docRole: "reclamacion",
          documentType: "reclamacion",
          documentTitle: "Escrito inicial",
        },
        {
          chunkId: "c2",
          content: "La sentencia confirma criterios tecnicos del SEA y el resultado final.",
          sourceUrl: null,
          snapshotId: "s2",
          page: 8,
          section: "Sentencia",
          docRole: "sentencia",
          documentType: "sentencia",
          documentTitle: "Sentencia definitiva",
        },
        {
          chunkId: "c3",
          content: "El informe desarrolla los criterios de defensa del SEA.",
          sourceUrl: null,
          snapshotId: "s3",
          page: 4,
          section: "Informe",
          docRole: "informe",
          documentType: "informe",
          documentTitle: "Evacua informe",
        },
        {
          chunkId: "c4",
          content: "Otro antecedente contextual.",
          sourceUrl: null,
          snapshotId: "s4",
          page: 2,
          section: "Contexto",
          docRole: null,
          documentType: "memo",
          documentTitle: "Memo",
        },
        {
          chunkId: "c5",
          content: "Fragmento adicional de la sentencia con decision final.",
          sourceUrl: null,
          snapshotId: "s5",
          page: 12,
          section: "Sentencia complementaria",
          docRole: "sentencia",
          documentType: "sentencia",
          documentTitle: "Sentencia complementaria",
        },
        {
          chunkId: "c6",
          content: "Otro texto menos relevante.",
          sourceUrl: null,
          snapshotId: "s6",
          page: 3,
          section: "Otros",
          docRole: null,
          documentType: "otros",
          documentTitle: "Otros",
        },
        {
          chunkId: "c7",
          content: "Antecedente adicional menos importante.",
          sourceUrl: null,
          snapshotId: "s7",
          page: 7,
          section: "Otros",
          docRole: null,
          documentType: "otros",
          documentTitle: "Otros 2",
        },
        {
          chunkId: "c8",
          content: "Antecedente 8.",
          sourceUrl: null,
          snapshotId: "s8",
          page: 7,
          section: "Otros",
          docRole: null,
          documentType: "otros",
          documentTitle: "Otros 3",
        },
        {
          chunkId: "c9",
          content: "Antecedente 9.",
          sourceUrl: null,
          snapshotId: "s9",
          page: 7,
          section: "Otros",
          docRole: null,
          documentType: "otros",
          documentTitle: "Otros 4",
        },
      ],
    })

    assert.equal(result.applied, true)
    assert.ok(result.model?.includes("mock"))
    assert.deepEqual(result.evidence.map((row) => row.chunkId), ["c2", "c3"])
  } finally {
    if (typeof prevCross === "string") process.env.RAG_ENABLE_CROSS_ENCODER_RERANK = prevCross
    else delete process.env.RAG_ENABLE_CROSS_ENCODER_RERANK

    if (typeof prevProvider === "string") process.env.RAG_CROSS_ENCODER_PROVIDER = prevProvider
    else delete process.env.RAG_CROSS_ENCODER_PROVIDER

    if (typeof prevLlm === "string") process.env.RAG_ENABLE_LLM_RERANK = prevLlm
    else delete process.env.RAG_ENABLE_LLM_RERANK
  }
})
