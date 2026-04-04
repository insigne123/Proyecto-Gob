import type { EvidenceChunk } from "@/lib/rag/strict-answer"

type CrossEncoderProvider = "cohere" | "jina" | "mock"

export type CrossEncoderRerankResult = {
  orderedChunkIds: string[]
  applied: boolean
  provider: CrossEncoderProvider | null
  model: string | null
}

function boolEnv(name: string, fallback: boolean) {
  const raw = String(process.env[name] || "")
    .trim()
    .toLowerCase()
  if (!raw) return fallback
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false
  return fallback
}

function normalize(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function lexicalScore(question: string, row: EvidenceChunk) {
  const tokens = normalize(question)
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.length >= 4)
    .slice(0, 18)
  if (!tokens.length) return 0

  const hay = normalize(
    [
      row.documentTitle || "",
      row.documentType || "",
      row.docRole || "",
      row.section || "",
      row.content || "",
    ].join(" ")
  )
  if (!hay) return 0

  let score = 0
  for (const token of tokens) {
    if (hay.includes(token)) score += 1
  }

  const role = String(row.docRole || "").toLowerCase()
  if (normalize(question).includes("informe") && role === "informe") score += 2
  if (normalize(question).includes("sentencia") && role === "sentencia") score += 2
  if (normalize(question).includes("reclamacion") && role === "reclamacion") score += 1
  return score
}

function providerFromEnv(): CrossEncoderProvider | null {
  const explicit = String(process.env.RAG_CROSS_ENCODER_PROVIDER || "")
    .trim()
    .toLowerCase()
  if (explicit === "cohere" || explicit === "jina" || explicit === "mock") return explicit
  if (String(process.env.COHERE_API_KEY || "").trim()) return "cohere"
  if (String(process.env.JINA_API_KEY || "").trim()) return "jina"
  return null
}

function candidateDocument(row: EvidenceChunk) {
  const meta = [
    row.documentTitle ? `title=${row.documentTitle}` : "",
    row.documentType ? `doctype=${row.documentType}` : "",
    row.docRole ? `role=${row.docRole}` : "",
    row.section ? `section=${row.section}` : "",
    typeof row.page === "number" ? `page=${row.page}` : "",
  ]
    .filter(Boolean)
    .join(" | ")

  const content = String(row.content || "").replace(/\s+/g, " ").trim().slice(0, 1600)
  return [meta, content].filter(Boolean).join("\n")
}

async function callCohere(params: {
  question: string
  evidence: EvidenceChunk[]
  topN: number
}): Promise<CrossEncoderRerankResult> {
  const apiKey = String(process.env.COHERE_API_KEY || "").trim()
  if (!apiKey) return { orderedChunkIds: [], applied: false, provider: null, model: null }

  const model = String(process.env.RAG_CROSS_ENCODER_MODEL || "rerank-v3.5").trim()
  const res = await fetch("https://api.cohere.com/v2/rerank", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      query: params.question,
      documents: params.evidence.map((row) => candidateDocument(row)),
      top_n: Math.max(1, Math.min(params.topN, params.evidence.length)),
    }),
  })

  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(String(payload?.message || payload?.error || `Cohere rerank failed (${res.status})`))
  }

  const results = Array.isArray(payload?.results) ? payload.results : []
  const orderedChunkIds = results
    .map((row: any) => {
      const idx = Number(row?.index)
      if (!Number.isFinite(idx) || idx < 0 || idx >= params.evidence.length) return ""
      return String(params.evidence[idx].chunkId || "")
    })
    .filter(Boolean)

  return {
    orderedChunkIds,
    applied: orderedChunkIds.length > 0,
    provider: orderedChunkIds.length > 0 ? "cohere" : null,
    model,
  }
}

async function callJina(params: {
  question: string
  evidence: EvidenceChunk[]
  topN: number
}): Promise<CrossEncoderRerankResult> {
  const apiKey = String(process.env.JINA_API_KEY || "").trim()
  if (!apiKey) return { orderedChunkIds: [], applied: false, provider: null, model: null }

  const model = String(process.env.RAG_CROSS_ENCODER_MODEL || "jina-reranker-v2-base-multilingual").trim()
  const res = await fetch("https://api.jina.ai/v1/rerank", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      query: params.question,
      documents: params.evidence.map((row) => candidateDocument(row)),
      top_n: Math.max(1, Math.min(params.topN, params.evidence.length)),
    }),
  })

  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(String(payload?.detail || payload?.error || `Jina rerank failed (${res.status})`))
  }

  const results = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload?.data) ? payload.data : []
  const orderedChunkIds = results
    .map((row: any) => {
      const idx = Number(row?.index)
      if (!Number.isFinite(idx) || idx < 0 || idx >= params.evidence.length) return ""
      return String(params.evidence[idx].chunkId || "")
    })
    .filter(Boolean)

  return {
    orderedChunkIds,
    applied: orderedChunkIds.length > 0,
    provider: orderedChunkIds.length > 0 ? "jina" : null,
    model,
  }
}

function callMock(params: { question: string; evidence: EvidenceChunk[]; topN: number }): CrossEncoderRerankResult {
  const orderedChunkIds = params.evidence
    .slice()
    .map((row, index) => ({ row, index, score: lexicalScore(params.question, row) - index * 0.001 }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(1, Math.min(params.topN, params.evidence.length)))
    .map((row) => String(row.row.chunkId || ""))
    .filter(Boolean)

  return {
    orderedChunkIds,
    applied: orderedChunkIds.length > 0,
    provider: orderedChunkIds.length > 0 ? "mock" : null,
    model: orderedChunkIds.length > 0 ? "mock:lexical-cross-encoder" : null,
  }
}

export async function crossEncoderRerankEvidence(params: {
  question: string
  evidence: EvidenceChunk[]
  topN: number
}): Promise<CrossEncoderRerankResult> {
  const enabled = boolEnv("RAG_ENABLE_CROSS_ENCODER_RERANK", false)
  if (!enabled || params.evidence.length === 0) {
    return { orderedChunkIds: [], applied: false, provider: null, model: null }
  }

  const provider = providerFromEnv()
  if (!provider) {
    return { orderedChunkIds: [], applied: false, provider: null, model: null }
  }

  try {
    if (provider === "mock") return callMock(params)
    if (provider === "cohere") return await callCohere(params)
    if (provider === "jina") return await callJina(params)
  } catch {
    return { orderedChunkIds: [], applied: false, provider: null, model: null }
  }

  return { orderedChunkIds: [], applied: false, provider: null, model: null }
}
