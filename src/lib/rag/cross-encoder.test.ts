import test from "node:test"
import assert from "node:assert/strict"

import { crossEncoderRerankEvidence } from "@/lib/rag/cross-encoder"

test("crossEncoderRerankEvidence supports mock provider for deterministic reranking", async () => {
  const prevEnabled = process.env.RAG_ENABLE_CROSS_ENCODER_RERANK
  const prevProvider = process.env.RAG_CROSS_ENCODER_PROVIDER

  process.env.RAG_ENABLE_CROSS_ENCODER_RERANK = "true"
  process.env.RAG_CROSS_ENCODER_PROVIDER = "mock"

  try {
    const result = await crossEncoderRerankEvidence({
      question: "Que dice la sentencia sobre los criterios del SEA?",
      topN: 2,
      evidence: [
        {
          chunkId: "c1",
          content: "La reclamacion describe hechos generales sin resolver el fondo.",
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
          content: "La sentencia confirma criterios tecnicos del SEA y explica el resultado final.",
          sourceUrl: null,
          snapshotId: "s2",
          page: 10,
          section: "Sentencia definitiva",
          docRole: "sentencia",
          documentType: "sentencia",
          documentTitle: "Sentencia",
        },
      ],
    })

    assert.equal(result.applied, true)
    assert.equal(result.provider, "mock")
    assert.deepEqual(result.orderedChunkIds, ["c2", "c1"])
  } finally {
    if (typeof prevEnabled === "string") process.env.RAG_ENABLE_CROSS_ENCODER_RERANK = prevEnabled
    else delete process.env.RAG_ENABLE_CROSS_ENCODER_RERANK

    if (typeof prevProvider === "string") process.env.RAG_CROSS_ENCODER_PROVIDER = prevProvider
    else delete process.env.RAG_CROSS_ENCODER_PROVIDER
  }
})
