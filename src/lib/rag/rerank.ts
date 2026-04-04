import { generateOpenAIJson } from "@/lib/llm/openai-json"
import { crossEncoderRerankEvidence } from "@/lib/rag/cross-encoder"
import type { RetrievalFeedbackSignals } from "@/lib/rag/feedback-signals"
import { inferRagQueryIntent, type RagQueryIntent } from "@/lib/rag/query-intent"
import type { AnswerMode, EvidenceChunk, QuestionDifficulty } from "@/lib/rag/strict-answer"
import type { ResolvedResponseProfile } from "@/lib/rag/router"

function boolEnv(name: string, fallback: boolean) {
  const raw = String(process.env[name] || "")
    .trim()
    .toLowerCase()
  if (!raw) return fallback
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false
  return fallback
}

function numberEnv(name: string, fallback: number, min: number, max: number) {
  const raw = Number(process.env[name] || fallback)
  if (!Number.isFinite(raw)) return fallback
  return Math.max(min, Math.min(max, Math.floor(raw)))
}

function normalizeText(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function extractCauseRoleToken(question: string) {
  const match = String(question || "").match(/\bR-\d{1,5}-\d{4}\b/i)
  return match ? String(match[0]).toUpperCase() : ""
}

function inferEvidenceRoleToken(row: EvidenceChunk) {
  const hay = [row.section, row.documentTitle, row.documentType, row.content]
    .filter(Boolean)
    .join(" ")
  const match = hay.match(/\bR-\d{1,5}-\d{4}\b/i)
  return match ? String(match[0]).toUpperCase() : ""
}

function strategicRoleRank(role: string | null, preferredRoles: string[]) {
  const normalized = String(role || "").trim().toLowerCase()
  const idx = preferredRoles.indexOf(normalized)
  return idx >= 0 ? idx : 9
}

function reorderEvidence(params: {
  orderedChunkIds: string[]
  candidates: EvidenceChunk[]
  fallback: EvidenceChunk[]
  maxOut: number
}) {
  const byId = new Map(params.candidates.map((row) => [row.chunkId, row]))
  const ordered: EvidenceChunk[] = []
  const seen = new Set<string>()

  for (const id of params.orderedChunkIds) {
    const row = byId.get(String(id || ""))
    if (!row || seen.has(row.chunkId)) continue
    seen.add(row.chunkId)
    ordered.push(row)
    if (ordered.length >= params.maxOut) break
  }

  if (ordered.length < params.maxOut) {
    for (const row of params.fallback) {
      if (seen.has(row.chunkId)) continue
      seen.add(row.chunkId)
      ordered.push(row)
      if (ordered.length >= params.maxOut) break
    }
  }

  return ordered.slice(0, params.maxOut)
}

export function heuristicRerankEvidenceForAnswering(params: {
  question: string
  evidence: EvidenceChunk[]
  maxOut: number
  mode: AnswerMode
  difficulty: QuestionDifficulty
  intent?: RagQueryIntent | null
  feedbackSignals?: RetrievalFeedbackSignals | null
}) {
  const questionRole = extractCauseRoleToken(params.question)
  const intent = params.intent || inferRagQueryIntent(params.question)
  const preferredRoles = Array.from(
    new Set(
      [
        ...intent.preferredDocRoles,
        ...(params.mode === "checklist" || params.mode === "resolution" ? ["informe", "sentencia"] : []),
      ]
        .map((item) => String(item || "").trim().toLowerCase())
        .filter(Boolean)
    )
  )
  const causeCoverage = new Map<string, { informe: number; sentencia: number; reclamacion: number }>()
  const causeBundleStats = new Map<string, { snapshots: Set<string>; roleSet: Set<string>; totalDocs: number }>()
  for (const row of params.evidence) {
    const roleToken = inferEvidenceRoleToken(row)
    if (!roleToken) continue
    const current = causeCoverage.get(roleToken) || { informe: 0, sentencia: 0, reclamacion: 0 }
    const role = String(row.docRole || "").toLowerCase()
    if (role === "informe") current.informe += 1
    if (role === "sentencia") current.sentencia += 1
    if (role === "reclamacion") current.reclamacion += 1
    causeCoverage.set(roleToken, current)

    const bundle = causeBundleStats.get(roleToken) || { snapshots: new Set<string>(), roleSet: new Set<string>(), totalDocs: 0 }
    if (row.snapshotId) bundle.snapshots.add(String(row.snapshotId))
    if (role) bundle.roleSet.add(role)
    bundle.totalDocs += 1
    causeBundleStats.set(roleToken, bundle)
  }

  const questionNorm = normalizeText(params.question)
  const ordered = params.evidence
    .slice()
    .map((row, index) => {
      const roleToken = inferEvidenceRoleToken(row)
      const cause = causeCoverage.get(roleToken) || { informe: 0, sentencia: 0, reclamacion: 0 }
      const hasCorePair = cause.informe > 0 && cause.sentencia > 0
      const bundle = causeBundleStats.get(roleToken) || { snapshots: new Set<string>(), roleSet: new Set<string>(), totalDocs: 0 }
      const role = String(row.docRole || "").toLowerCase()
      const roleRank = strategicRoleRank(role || null, preferredRoles)
      const roleScore =
        role === "informe"
          ? 40
          : role === "sentencia"
            ? 34
            : role === "reclamacion"
              ? 12
              : 0
      const coverageBonus = hasCorePair && role !== "reclamacion" ? 22 : 0
      const bundleBonus =
        (hasCorePair ? 10 : 0) +
        Math.min(8, bundle.snapshots.size * 2) +
        Math.min(6, bundle.roleSet.size * 2) +
        Math.min(4, Math.max(0, bundle.totalDocs - 1))
      const causeBonus = questionRole && roleToken === questionRole ? 18 : 0
      const contextBonus =
        questionNorm.includes("sea") && role === "informe"
          ? 8
          : questionNorm.includes("precedente") && role === "sentencia"
            ? 6
            : 0
      const feedbackChunkScore = Number(params.feedbackSignals?.chunkScores?.[row.chunkId] || 0)
      const feedbackSnapshotScore = row.snapshotId
        ? Number(params.feedbackSignals?.snapshotScores?.[String(row.snapshotId)] || 0)
        : 0
      const feedbackBonus = feedbackChunkScore * 10 + feedbackSnapshotScore * 4
      const multiCauseBonus = intent.needsMultiCause && roleToken ? Math.min(6, bundle.roleSet.size + bundle.snapshots.size) : 0
      const score =
        roleScore + coverageBonus + bundleBonus + causeBonus + contextBonus + feedbackBonus + multiCauseBonus - roleRank * 2 - index * 0.01
      return { row, score, index }
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.row)

  return ordered.slice(0, params.maxOut)
}

export async function rerankEvidenceForAnswering(params: {
  question: string
  evidence: EvidenceChunk[]
  maxOut: number
  mode: AnswerMode
  difficulty: QuestionDifficulty
  responseProfile: ResolvedResponseProfile
  intent?: RagQueryIntent | null
  feedbackSignals?: RetrievalFeedbackSignals | null
}) {
  const llmEnabled = boolEnv("RAG_ENABLE_LLM_RERANK", true)
  const heuristicOrdered = heuristicRerankEvidenceForAnswering(params)
  if (params.evidence.length <= 8) {
    return { evidence: heuristicOrdered.slice(0, params.maxOut), applied: false, model: null as string | null }
  }

  if (params.responseProfile === "fast" && params.evidence.length <= 22) {
    return { evidence: heuristicOrdered.slice(0, params.maxOut), applied: false, model: null as string | null }
  }

  const candidateLimit = numberEnv(
    "RAG_RERANK_CANDIDATE_LIMIT",
    params.responseProfile === "fast"
      ? Math.max(8, Math.min(18, params.maxOut + 6))
      : Math.max(10, Math.min(32, params.maxOut + 12)),
    8,
    64
  )
  const candidates = heuristicOrdered.slice(0, candidateLimit)

  const crossEncoder = await crossEncoderRerankEvidence({
    question: params.question,
    evidence: candidates,
    topN:
      params.responseProfile === "deep"
        ? Math.max(params.maxOut, Math.min(candidates.length, params.maxOut + 8))
        : params.maxOut,
  })

  if (crossEncoder.applied && (!llmEnabled || params.responseProfile !== "deep")) {
    return {
      evidence: reorderEvidence({
        orderedChunkIds: crossEncoder.orderedChunkIds,
        candidates,
        fallback: heuristicOrdered,
        maxOut: params.maxOut,
      }),
      applied: true,
      model: crossEncoder.model,
    }
  }

  if (!llmEnabled) {
    return { evidence: heuristicOrdered.slice(0, params.maxOut), applied: false, model: null as string | null }
  }

  const llmCandidates = crossEncoder.applied
    ? reorderEvidence({
        orderedChunkIds: crossEncoder.orderedChunkIds,
        candidates,
        fallback: heuristicOrdered,
        maxOut: Math.max(params.maxOut, Math.min(candidateLimit, params.maxOut + 8)),
      })
    : candidates

  const candidateBlock = llmCandidates
    .map((row, idx) => {
      const excerpt = String(row.content || "").replace(/\s+/g, " ").trim().slice(0, 420)
      const tags = [
        row.snapshotId ? `snapshot=${row.snapshotId}` : "",
        typeof row.page === "number" ? `page=${row.page}` : "",
        row.section ? `section=${row.section}` : "",
        row.docRole ? `role=${row.docRole}` : "",
        row.documentType ? `doctype=${row.documentType}` : "",
      ]
        .filter(Boolean)
        .join(", ")
      const meta = tags ? ` (${tags})` : ""
      return `CANDIDATE ${idx + 1}: chunkId=${row.chunkId}${meta}\n${excerpt}`
    })
    .join("\n\n---\n\n")

  try {
    const reranked = await generateOpenAIJson({
      system:
        "Eres un reranker experto en retrieval juridico. Ordena evidencias por relevancia factual, cobertura de la pregunta y utilidad para responder con citas verificables.",
      prompt:
        `Pregunta:\n${params.question}\n\n` +
        `Modo: ${params.mode}\nDificultad: ${params.difficulty}\n\n` +
        `Candidatos:\n\n${candidateBlock}\n\n` +
        "Instrucciones:\n" +
        "- Devuelve orderedChunkIds con los mejores chunkId en orden descendente de utilidad.\n" +
        "- Prioriza cobertura, precision y diversidad de snapshots.\n" +
        "- No inventes ids; usa solo chunkId entregados.\n",
      schemaName: "chat_rag_llm_rerank",
      schema: {
        type: "object",
        properties: {
          orderedChunkIds: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["orderedChunkIds"],
        additionalProperties: false,
      },
      maxCompletionTokens: 600,
      reasoningEffort: "minimal",
      model: String(
        process.env.OPENAI_RERANK_MODEL ||
          process.env.OPENAI_ANSWER_MODEL ||
          process.env.OPENAI_RAG_MODEL ||
          "gpt-5-nano"
      ),
    })

    const ids = Array.isArray((reranked.output as any)?.orderedChunkIds)
      ? ((reranked.output as any).orderedChunkIds as unknown[])
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : []

    if (!ids.length) {
      if (crossEncoder.applied) {
        return {
          evidence: reorderEvidence({
            orderedChunkIds: crossEncoder.orderedChunkIds,
            candidates,
            fallback: heuristicOrdered,
            maxOut: params.maxOut,
          }),
          applied: true,
          model: crossEncoder.model,
        }
      }
      return { evidence: heuristicOrdered.slice(0, params.maxOut), applied: false, model: reranked.model }
    }

    return {
      evidence: reorderEvidence({
        orderedChunkIds: ids,
        candidates: llmCandidates,
        fallback: heuristicOrdered,
        maxOut: params.maxOut,
      }),
      applied: true,
      model: reranked.model,
    }
  } catch {
    if (crossEncoder.applied) {
      return {
        evidence: reorderEvidence({
          orderedChunkIds: crossEncoder.orderedChunkIds,
          candidates,
          fallback: heuristicOrdered,
          maxOut: params.maxOut,
        }),
        applied: true,
        model: crossEncoder.model,
      }
    }
    return { evidence: heuristicOrdered.slice(0, params.maxOut), applied: false, model: null as string | null }
  }
}
