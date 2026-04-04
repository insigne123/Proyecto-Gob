import { toVectorLiteral } from "@/lib/pgvector"
import { embedTextWithOpenAI, openAIEmbeddingsEnabled } from "@/lib/rag/openai-embeddings"
import { inferRagQueryIntent, type RagQueryIntent } from "@/lib/rag/query-intent"
import { classifyTribunalDocumentRole } from "@/lib/tribunal/document-role"

import type { EvidenceChunk } from "@/lib/rag/strict-answer"

function toEvidenceChunk(m: any): EvidenceChunk {
  const documentType = m.document_type ? String(m.document_type) : m.doc_type ? String(m.doc_type) : null
  const documentTitle = m.title ? String(m.title) : m.name ? String(m.name) : null
  const docRole =
    m.doc_role
      ? String(m.doc_role)
      : classifyTribunalDocumentRole({
          documentType,
          name: documentTitle || (m.section ? String(m.section) : null),
          title: documentType,
        })
  return {
    chunkId: String(m.chunk_id ?? m.chunkId ?? m.id),
    content: String(m.content ?? ""),
    sourceUrl: m.source_url ? String(m.source_url) : null,
    snapshotId: m.snapshot_id ? String(m.snapshot_id) : null,
    page: typeof m.page === "number" ? m.page : m.page ? Number(m.page) : null,
    section: m.section ? String(m.section) : null,
    docRole: docRole && docRole !== "documento" ? docRole : null,
    documentType,
    documentTitle,
  }
}

function dedupeByChunkId(list: EvidenceChunk[]) {
  const seen = new Set<string>()
  const out: EvidenceChunk[] = []
  for (const x of list) {
    if (!x.chunkId || seen.has(x.chunkId)) continue
    seen.add(x.chunkId)
    out.push(x)
  }
  return out
}

const LOCAL_QUERY_STOP_WORDS = new Set([
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "en",
  "por",
  "para",
  "con",
  "que",
  "cual",
  "cuales",
  "quien",
  "quienes",
  "como",
  "sobre",
  "segun",
  "según",
  "causa",
  "documento",
  "fuentes",
  "existe",
  "aparece",
  "respecto",
])

function normalizeSearchText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function buildKeywordFallbackQueries(question: string) {
  const raw = String(question || "")
  const normalized = normalizeSearchText(raw)
  if (!normalized) return []

  const roleTokens = Array.from(new Set(Array.from(raw.matchAll(/\bR-\d{1,5}-\d{4}\b/gi)).map((m) => m[0])))

  let primaryToken = ""
  if (normalized.includes("fojas")) primaryToken = "fojas"
  else if (normalized.includes("sentencia") || normalized.includes("fallo")) primaryToken = "sentencia"
  else if (normalized.includes("informe") || normalized.includes("evacua")) primaryToken = "informe"
  else if (normalized.includes("reclamante")) primaryToken = "reclamante"
  else if (normalized.includes("desistim")) primaryToken = "desistimiento"
  else if (normalized.includes("reclamacion") || normalized.includes("demanda")) primaryToken = "reclamacion"
  else if (normalized.includes("escrito")) primaryToken = "escrito"

  const lexicalTokens = normalized
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x.length >= 3)
    .filter((x) => !LOCAL_QUERY_STOP_WORDS.has(x))
    .filter((x) => !/^\d+$/.test(x))

  if (!primaryToken) {
    primaryToken = lexicalTokens.find((x) => x.length >= 5) || lexicalTokens[0] || ""
  }

  const role = roleTokens[0] || ""
  const queries = Array.from(
    new Set(
      [
        role && primaryToken ? `${role} ${primaryToken}` : "",
        role && normalized.includes("fojas") ? `${role} fojas` : "",
        role,
        primaryToken,
      ]
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    )
  )

  return queries
}

function extractRoleToken(question: string, intent?: RagQueryIntent | null) {
  return intent?.roleToken || inferRagQueryIntent(question).roleToken || ""
}

function lexicalTokensForScore(question: string) {
  return normalizeSearchText(question)
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x.length >= 3)
    .filter((x) => !LOCAL_QUERY_STOP_WORDS.has(x))
    .slice(0, 20)
}

function lexicalScore(content: string, tokens: string[]) {
  const hay = normalizeSearchText(content)
  if (!hay) return 0
  let score = 0
  for (const token of tokens) {
    if (!token) continue
    if (hay.includes(token)) score += 1
  }
  return score
}

function normalizeDocTypeHint(value: string | null | undefined) {
  const normalized = normalizeSearchText(String(value || ""))
  if (!normalized) return null
  if (normalized.includes("reclam")) return "reclamacion" as const
  if (normalized.includes("inform") || normalized.includes("evacua")) return "informe" as const
  if (normalized.includes("sentenc") || normalized.includes("fallo")) return "sentencia" as const
  return null
}

export function inferDocTypeHintFromQuestion(params: {
  question: string
  filters?: { docTypes?: string[] } | null
  intent?: RagQueryIntent | null
}): "reclamacion" | "informe" | "sentencia" | null {
  const filteredDocTypes = Array.from(
    new Set(
      (Array.isArray(params.filters?.docTypes) ? params.filters!.docTypes : [])
        .map((item) => normalizeDocTypeHint(item))
        .filter((item): item is "reclamacion" | "informe" | "sentencia" => Boolean(item))
    )
  )

  if (filteredDocTypes.length === 1) {
    return filteredDocTypes[0]
  }

  const normalized = normalizeSearchText(params.question)
  if (!normalized) return null

  if (
    normalized.includes("reclamante") ||
    normalized.includes("escrito inicial") ||
    normalized.includes("desistim") ||
    normalized.includes("reclamacion") ||
    normalized.includes("demanda")
  ) {
    return "reclamacion"
  }
  if (normalized.includes("sentencia") || normalized.includes("fallo")) {
    return "sentencia"
  }
  if (normalized.includes("informe") || normalized.includes("evacua")) {
    return "informe"
  }

  const explicit = (params.intent || inferRagQueryIntent(params.question)).preferredDocRoles
    .map((item) => normalizeDocTypeHint(item))
    .filter((item): item is "reclamacion" | "informe" | "sentencia" => Boolean(item))
  return explicit[0] || null
}

async function getRoleScopedEvidence(params: {
  supabase: any
  workspaceIds: string[]
  roleToken: string
  question: string
  maxOut: number
  filters?: { docTypes?: string[] } | null
  intent?: RagQueryIntent | null
}) {
  const { supabase, workspaceIds, roleToken, question, maxOut } = params
  if (!roleToken || workspaceIds.length === 0) return [] as EvidenceChunk[]

  const inferredDocType = inferDocTypeHintFromQuestion({
    question,
    filters: params.filters,
    intent: params.intent,
  })
  const q = normalizeSearchText(question)

  let sourcesQuery = supabase
    .from("gob_sources")
    .select("id,title")
    .in("workspace_id", workspaceIds)
    .filter("attributes->>rol", "eq", roleToken)
    .limit(120)

  if (inferredDocType) {
    sourcesQuery = sourcesQuery.eq("doc_type", inferredDocType)
  }

  if (q.includes("desistim")) {
    sourcesQuery = sourcesQuery.ilike("title", "%desist%")
  } else if (q.includes("escrito inicial")) {
    sourcesQuery = sourcesQuery.ilike("title", "%escrito inicial%")
  } else if (q.includes("sentencia")) {
    sourcesQuery = sourcesQuery.ilike("title", "%sentencia%")
  } else if (q.includes("informe") || q.includes("evacua")) {
    sourcesQuery = sourcesQuery.ilike("title", "%informe%")
  }

  const { data: sources, error: srcErr } = await sourcesQuery

  if (srcErr) return []
  const sourceIds = Array.from(
    new Set(
      (Array.isArray(sources) ? sources : [])
        .map((row: any) => String(row?.id || ""))
        .filter(Boolean)
    )
  )
  if (!sourceIds.length) return [] as EvidenceChunk[]

  const sourceTitleById = new Map<string, string>()
  for (const row of Array.isArray(sources) ? sources : []) {
    const id = String((row as any)?.id || "")
    const title = String((row as any)?.title || "").trim()
    if (id && title) sourceTitleById.set(id, title)
  }

  const { data: snapshots, error: snapErr } = await supabase
    .from("gob_source_snapshots")
    .select("id,source_id")
    .in("source_id", sourceIds)
    .eq("status", "ready")
    .limit(120)

  if (snapErr) return []
  const snapshotIds = Array.from(
    new Set(
      (Array.isArray(snapshots) ? snapshots : [])
        .map((row: any) => String(row?.id || ""))
        .filter(Boolean)
    )
  )
  if (!snapshotIds.length) return [] as EvidenceChunk[]

  const sourceTitleBySnapshotId = new Map<string, string>()
  for (const row of Array.isArray(snapshots) ? snapshots : []) {
    const sid = String((row as any)?.id || "")
    const sourceId = String((row as any)?.source_id || "")
    const title = sourceTitleById.get(sourceId) || ""
    if (sid && title) sourceTitleBySnapshotId.set(sid, title)
  }

  const { data: chunks, error: chunkErr } = await supabase
    .from("gob_chunks")
    .select("id,content,source_url,snapshot_id,page,section")
    .in("snapshot_id", snapshotIds.slice(0, 120))
    .limit(4000)

  if (chunkErr) return []

  const tokens = lexicalTokensForScore(question)
  const ranked = (Array.isArray(chunks) ? chunks : [])
    .map((row: any) => ({
      row,
      score: lexicalScore(String(row?.content || ""), tokens),
    }))
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, Math.max(6, Math.min(60, maxOut)))

  return ranked
    .map((entry: any) => {
      const snapshotId = String(entry.row?.snapshot_id || "")
      const titleHint = sourceTitleBySnapshotId.get(snapshotId) || ""
      const section = [String(entry.row?.section || "").trim(), titleHint].filter(Boolean).join(" | ")

      return toEvidenceChunk({
        chunk_id: entry.row.id,
        content: entry.row.content,
        source_url: entry.row.source_url,
        snapshot_id: entry.row.snapshot_id,
        page: entry.row.page,
        section: section || null,
      })
    })
    .filter((row: EvidenceChunk) => Boolean(row.chunkId) && Boolean(String(row.content || "").trim()))
}

function rankOfRow(row: any) {
  const bySimilarity =
    typeof row?.similarity === "number"
      ? row.similarity
      : row?.similarity
        ? Number(row.similarity)
        : null
  if (typeof bySimilarity === "number" && Number.isFinite(bySimilarity)) return bySimilarity

  const byRank = typeof row?.rank === "number" ? row.rank : row?.rank ? Number(row.rank) : null
  if (typeof byRank === "number" && Number.isFinite(byRank)) return byRank
  return 0
}

let queryEmbeddingBackoffUntil = 0

function queryEmbeddingsEnabled() {
  const disabledByEnv = [
    String(process.env.RAG_DISABLE_QUERY_EMBEDDINGS || ""),
    String(process.env.LOCAL_QUERY_EMBEDDINGS_DISABLED || ""),
  ]
    .map((x) => x.trim().toLowerCase())
    .some((x) => x === "1" || x === "true" || x === "yes" || x === "on")

  if (disabledByEnv) return false
  if (!openAIEmbeddingsEnabled()) return false
  if (Date.now() < queryEmbeddingBackoffUntil) return false
  return true
}

function maybeBackoffQueryEmbeddings(err: unknown) {
  const msg = String((err as any)?.message || err || "").toLowerCase()
  const rateLimited = msg.includes("429") || msg.includes("too many requests") || msg.includes("quota")
  if (!rateLimited) return

  queryEmbeddingBackoffUntil = Date.now() + 10 * 60 * 1000
}

type RetrievalCandidate = {
  chunk: EvidenceChunk
  vectorRanks: number[]
  textRanks: number[]
  bestVectorScore: number
  bestTextScore: number
  lexicalScore: number
  roleHit: boolean
  docTypeHit: boolean
}

function ensureCandidate(map: Map<string, RetrievalCandidate>, row: any) {
  const chunk = toEvidenceChunk(row)
  if (!chunk.chunkId || !String(chunk.content || "").trim()) return null

  const existing = map.get(chunk.chunkId)
  if (existing) return existing

  const created: RetrievalCandidate = {
    chunk,
    vectorRanks: [],
    textRanks: [],
    bestVectorScore: 0,
    bestTextScore: 0,
    lexicalScore: 0,
    roleHit: false,
    docTypeHit: false,
  }
  map.set(chunk.chunkId, created)
  return created
}

function rrfScore(ranks: number[], k = 60) {
  if (!Array.isArray(ranks) || ranks.length === 0) return 0
  return ranks.reduce((sum, rank) => {
    const n = Number(rank)
    if (!Number.isFinite(n) || n <= 0) return sum
    return sum + 1 / (k + n)
  }, 0)
}

function hasTokenNormalized(haystack: string, token: string) {
  if (!haystack || !token) return false
  return haystack.includes(token)
}

function buildAdaptiveQueryVariants(question: string, intent?: RagQueryIntent | null, maxQueries = 4) {
  const base = String(question || "").trim()
  if (!base) return [] as string[]

  const intentHints = Array.isArray(intent?.retrievalHints)
    ? intent!.retrievalHints.flatMap((hint) => {
        const clean = String(hint || "").trim()
        if (!clean) return [] as string[]
        return [clean, intent?.roleToken ? `${intent.roleToken} ${clean}` : ""]
      })
    : []

  const variants = [base, ...buildKeywordFallbackQueries(base), ...intentHints]
  const seen = new Set<string>()
  const out: string[] = []

  for (const raw of variants) {
    const clean = String(raw || "").trim()
    if (!clean) continue
    const normalized = normalizeSearchText(clean)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(clean)
  }

  return out.slice(0, Math.max(1, Math.min(8, maxQueries)))
}

function rankCandidates(params: {
  candidates: Map<string, RetrievalCandidate>
  question: string
  roleToken: string
  inferredDocType: "reclamacion" | "informe" | "sentencia" | null
  maxOut: number
}) {
  const { candidates, question, roleToken, inferredDocType, maxOut } = params
  const lexicalTokens = lexicalTokensForScore(question)

  const roleNeedle = normalizeSearchText(roleToken)
  const docTypeNeedle = inferredDocType ? normalizeSearchText(inferredDocType) : ""

  const scored = Array.from(candidates.values())
    .map((candidate) => {
      const hay = normalizeSearchText(candidate.chunk.content)

      const lexical = lexicalTokens.length ? lexicalScore(candidate.chunk.content, lexicalTokens) : 0
      candidate.lexicalScore = lexical

      const sectionNormalized = normalizeSearchText(candidate.chunk.section || "")
      const roleHit = Boolean(
        roleNeedle &&
          (hasTokenNormalized(hay, roleNeedle) || hasTokenNormalized(sectionNormalized, roleNeedle))
      )
      const docTypeHit = Boolean(
        docTypeNeedle &&
          (hasTokenNormalized(hay, docTypeNeedle) || hasTokenNormalized(sectionNormalized, docTypeNeedle))
      )

      candidate.roleHit = roleHit
      candidate.docTypeHit = docTypeHit

      const score =
        rrfScore(candidate.vectorRanks, 45) * 1.25 +
        rrfScore(candidate.textRanks, 55) * 1.0 +
        Math.max(0, candidate.bestVectorScore) * 0.25 +
        Math.max(0, candidate.bestTextScore) * 0.08 +
        Math.min(8, lexical) * 0.05 +
        (roleHit ? 0.22 : 0) +
        (docTypeHit ? 0.1 : 0)

      return {
        candidate,
        score,
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(10, Math.min(120, maxOut)))

  return scored.map((x) => x.candidate.chunk)
}

async function expandNeighborhoodEvidence(params: {
  supabase: any
  seedEvidence: EvidenceChunk[]
  question: string
  roleToken: string
  maxOut: number
}) {
  const { supabase, seedEvidence, question, roleToken, maxOut } = params
  if (!seedEvidence.length) return [] as EvidenceChunk[]

  const snapshotIds = Array.from(
    new Set(
      seedEvidence
        .map((row) => String(row.snapshotId || "").trim())
        .filter(Boolean)
    )
  ).slice(0, 6)

  if (!snapshotIds.length) return [] as EvidenceChunk[]

  const lexicalTokens = lexicalTokensForScore(question)
  const roleNeedle = normalizeSearchText(roleToken)

  const anchorsBySnapshot = new Map<
    string,
    {
      pages: number[]
      sections: string[]
    }
  >()

  for (const row of seedEvidence.slice(0, 24)) {
    const snapshotId = String(row.snapshotId || "").trim()
    if (!snapshotId) continue

    const existing = anchorsBySnapshot.get(snapshotId) || { pages: [], sections: [] }
    if (typeof row.page === "number" && Number.isFinite(row.page)) {
      existing.pages.push(Math.floor(row.page))
    }
    if (row.section) {
      const section = normalizeSearchText(row.section)
      if (section) existing.sections.push(section)
    }
    anchorsBySnapshot.set(snapshotId, existing)
  }

  const { data, error } = await supabase
    .from("gob_chunks")
    .select("id,content,source_url,snapshot_id,page,section")
    .in("snapshot_id", snapshotIds)
    .limit(2400)

  if (error || !Array.isArray(data) || data.length === 0) return [] as EvidenceChunk[]

  const seenSeedIds = new Set(seedEvidence.map((row) => row.chunkId))

  const ranked = data
    .map((row: any) => {
      const chunkId = String(row?.id || "")
      if (!chunkId || seenSeedIds.has(chunkId)) return null

      const content = String(row?.content || "")
      if (!content.trim()) return null

      const snapshotId = String(row?.snapshot_id || "")
      const anchor = anchorsBySnapshot.get(snapshotId)
      const lexical = lexicalScore(content, lexicalTokens)

      let pageProximity = 0
      if (anchor?.pages?.length && typeof row?.page === "number" && Number.isFinite(Number(row.page))) {
        const page = Math.floor(Number(row.page))
        const minDiff = Math.min(...anchor.pages.map((p) => Math.abs(p - page)))
        if (minDiff <= 1) pageProximity = 3
        else if (minDiff <= 2) pageProximity = 2
        else if (minDiff <= 4) pageProximity = 1
      }

      const sectionNorm = normalizeSearchText(String(row?.section || ""))
      const sectionHit = anchor?.sections?.some((s) => sectionNorm && s && sectionNorm.includes(s))
        ? 2
        : 0

      const roleHit =
        roleNeedle &&
        (normalizeSearchText(content).includes(roleNeedle) ||
          (sectionNorm && sectionNorm.includes(roleNeedle)))
          ? 2
          : 0

      const score = lexical * 1.0 + pageProximity * 0.8 + sectionHit * 0.6 + roleHit * 0.7

      return {
        row,
        score,
      }
    })
    .filter((row): row is { row: any; score: number } => Boolean(row))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(4, Math.min(24, maxOut / 2)))

  return ranked.map((entry) => toEvidenceChunk(entry.row))
}

export async function retrieveLocalEvidenceForQuestion(params: {
  supabase: any
  workspaceId?: string
  workspaceIds?: string[]
  question: string
  matchCount?: number
  minSimilarity?: number
  textMatchCount?: number
  filters?: { docTypes?: string[] } | null
  preferTextOnly?: boolean
  intent?: RagQueryIntent | null
}) {
  const matchCount = Math.max(1, Math.min(30, Number(params.matchCount ?? 10)))
  const minSimilarity = Number(params.minSimilarity ?? 0.25)
  const textMatchCount = Math.max(1, Math.min(40, Number(params.textMatchCount ?? 12)))

  const scopeWorkspaceIds = Array.from(
    new Set(
      (Array.isArray(params.workspaceIds) ? params.workspaceIds : [])
        .concat(params.workspaceId ? [params.workspaceId] : [])
        .map((x) => String(x || ""))
        .filter(Boolean)
    )
  ).slice(0, 60)

  if (!scopeWorkspaceIds.length) return []

  const intent = params.intent || inferRagQueryIntent(params.question)
  const roleToken = extractRoleToken(params.question, intent)
  const inferredDocType = inferDocTypeHintFromQuestion({
    question: params.question,
    filters: params.filters,
    intent,
  })
  const preferTextOnly = Boolean(params.preferTextOnly)
  const queryVariants = buildAdaptiveQueryVariants(params.question, intent, preferTextOnly ? 2 : 6)
  const vectorQueries = preferTextOnly ? [] : queryVariants.slice(0, roleToken ? 2 : 1)
  const textQueries = queryVariants.slice(0, preferTextOnly ? (roleToken ? 2 : 1) : queryVariants.length)

  const maxOut = preferTextOnly
    ? Math.max(8, Math.min(24, matchCount * 2))
    : Math.max(12, Math.min(120, matchCount * 3))
  const candidates = new Map<string, RetrievalCandidate>()

  const perWorkspaceMatchCount = Math.max(
    3,
    Math.min(20, Math.ceil(maxOut / Math.max(1, scopeWorkspaceIds.length)))
  )

  const perWorkspaceTextCount = Math.max(
    4,
    Math.min(30, Math.ceil((textMatchCount * 3) / Math.max(1, scopeWorkspaceIds.length)))
  )

  let vec: number[] | null = null

  if (!preferTextOnly && queryEmbeddingsEnabled()) {
    for (const vectorQuery of vectorQueries) {
      try {
        const candidate = await embedTextWithOpenAI(vectorQuery, {
          task: "query",
          maxRetries: 2,
          batchSize: 1,
        })
        if (Array.isArray(candidate) && candidate.length > 0) {
          vec = candidate as number[]
        } else {
          vec = null
        }
      } catch (err) {
        maybeBackoffQueryEmbeddings(err)
        vec = null
      }

      if (!Array.isArray(vec) || vec.length === 0) continue
      const vector = vec

      const vectorBatches = await Promise.all(
        scopeWorkspaceIds.map((workspaceId) =>
          params.supabase.rpc("gob_search_chunks", {
            p_workspace_id: workspaceId,
            p_query_embedding: toVectorLiteral(vector),
            p_match_count: perWorkspaceMatchCount,
            p_min_similarity: minSimilarity,
          })
        )
      )

      const merged = vectorBatches
        .flatMap((batch: any) => {
          if (!batch || batch.error || !Array.isArray(batch.data)) return []
          return batch.data
        })
        .sort((a: any, b: any) => rankOfRow(b) - rankOfRow(a))

      for (let i = 0; i < merged.length; i += 1) {
        const row = merged[i]
        const candidate = ensureCandidate(candidates, row)
        if (!candidate) continue
        candidate.vectorRanks.push(i + 1)
        candidate.bestVectorScore = Math.max(candidate.bestVectorScore, rankOfRow(row))
      }
    }
  }

  for (const textQuery of textQueries) {
    const textBatches = await Promise.all(
      scopeWorkspaceIds.map((workspaceId) =>
        params.supabase.rpc("gob_search_chunks_text", {
          p_workspace_id: workspaceId,
          p_query_text: textQuery,
          p_match_count: perWorkspaceTextCount,
        })
      )
    )

    const mergedText = textBatches
      .flatMap((batch: any) => {
        if (!batch || batch.error || !Array.isArray(batch.data)) return []
        return batch.data
      })
      .sort((a: any, b: any) => rankOfRow(b) - rankOfRow(a))

    for (let i = 0; i < mergedText.length; i += 1) {
      const row = mergedText[i]
      const candidate = ensureCandidate(candidates, row)
      if (!candidate) continue
      candidate.textRanks.push(i + 1)
      candidate.bestTextScore = Math.max(candidate.bestTextScore, rankOfRow(row))
    }
  }

  let evidence = rankCandidates({
    candidates,
    question: params.question,
    roleToken,
    inferredDocType,
    maxOut,
  })

  if (roleToken) {
    const roleScoped = await getRoleScopedEvidence({
      supabase: params.supabase,
      workspaceIds: scopeWorkspaceIds,
      roleToken,
      question: params.question,
      maxOut,
      filters: params.filters,
      intent,
    })
    if (roleScoped.length > 0) {
      const boostCount = Math.max(3, Math.min(18, Math.floor(maxOut * 0.4)))
      const boosted = roleScoped.slice(0, boostCount)
      evidence = dedupeByChunkId([...boosted, ...evidence]).slice(0, maxOut)
    }
  }

  const shouldExpandNeighborhood = preferTextOnly
    ? evidence.length < Math.max(4, Math.min(8, maxOut / 2))
    : evidence.length < Math.max(14, Math.min(30, maxOut)) || Boolean(roleToken)
  if (shouldExpandNeighborhood) {
    const expanded = await expandNeighborhoodEvidence({
      supabase: params.supabase,
      seedEvidence: evidence,
      question: params.question,
      roleToken,
      maxOut,
    })

    if (expanded.length > 0) {
      evidence = dedupeByChunkId([...evidence, ...expanded]).slice(0, maxOut)
    }
  }

  return evidence.slice(0, preferTextOnly ? Math.max(6, Math.min(18, maxOut)) : Math.max(10, Math.min(90, maxOut)))
}

export async function retrieveReferencedSnapshotEvidence(params: {
  supabase: any
  references: Array<{
    snapshotId: string
    title?: string | null
    docType?: string | null
    docRole?: string | null
    rol?: string | null
  }>
  question: string
  maxOut?: number
  perSnapshotCap?: number
}) {
  const rawSnapshotRefs = Array.from(
    new Map(
      (Array.isArray(params.references) ? params.references : [])
        .map((ref) => ({
          snapshotId: String(ref?.snapshotId || "").trim(),
          title: ref?.title ? String(ref.title) : null,
          docType: ref?.docType ? String(ref.docType) : null,
          docRole: ref?.docRole ? String(ref.docRole) : null,
          rol: ref?.rol ? String(ref.rol) : null,
        }))
        .filter((ref) => ref.snapshotId)
        .map((ref) => [ref.snapshotId, ref])
    ).values()
  ).slice(0, 24)

  const queryIntent = inferRagQueryIntent(params.question)
  const preferredRoles = new Set<string>(queryIntent.preferredDocRoles)

  const preferredSnapshotRefs = preferredRoles.size
    ? rawSnapshotRefs.filter((ref) => preferredRoles.has(String(ref.docRole || classifyTribunalDocumentRole({ documentType: ref.docType, name: ref.title, title: ref.docType }))))
    : rawSnapshotRefs

  const snapshotRefs = preferredSnapshotRefs.length > 0 ? preferredSnapshotRefs : rawSnapshotRefs

  if (!snapshotRefs.length) return [] as EvidenceChunk[]

  const snapshotIds = snapshotRefs.map((ref) => ref.snapshotId)
  const maxOut = Math.max(4, Math.min(40, Number(params.maxOut || 16)))
  const perSnapshotCap = Math.max(1, Math.min(5, Number(params.perSnapshotCap || 3)))
  const lexicalTokens = lexicalTokensForScore(params.question)
  const roleToken = extractRoleToken(params.question)
  const inferredDocType = inferDocTypeHintFromQuestion({ question: params.question })
  const refBySnapshotId = new Map(snapshotRefs.map((ref) => [ref.snapshotId, ref]))

  const { data, error } = await params.supabase
    .from("gob_chunks")
    .select("id,content,source_url,snapshot_id,page,section")
    .in("snapshot_id", snapshotIds)
    .limit(Math.max(400, Math.min(5000, snapshotIds.length * 260)))

  if (error || !Array.isArray(data) || data.length === 0) return [] as EvidenceChunk[]

  const snapshotCounts = new Map<string, number>()

  return data
    .map((row: any) => {
      const snapshotId = String(row?.snapshot_id || "")
      const ref = refBySnapshotId.get(snapshotId)
      const content = String(row?.content || "")
      const section = String(row?.section || "")
      const title = String(ref?.title || "")
      const docType = String(ref?.docType || "")
      const docRole = String(
        ref?.docRole || classifyTribunalDocumentRole({ documentType: docType, name: title, title: docType })
      )
      const mergedContext = normalizeSearchText(`${section} ${title} ${docType} ${ref?.rol || ""}`)
      const lexical = lexicalScore(content, lexicalTokens)
      const roleHit = roleToken ? (mergedContext.includes(normalizeSearchText(roleToken)) ? 1 : 0) : 0
      const docTypeHit = inferredDocType
        ? docRole === inferredDocType || mergedContext.includes(inferredDocType)
          ? 1
          : 0
        : 0
      const score =
        lexical * 1.15 +
        roleHit * 1.3 +
        docTypeHit * 1.7 +
        (docRole === "informe" ? 0.18 : docRole === "sentencia" ? 0.12 : 0.04)

      const chunk = toEvidenceChunk({
        id: row?.id,
        content,
        source_url: row?.source_url,
        snapshot_id: snapshotId,
        page: row?.page,
        section: [section, title, docType, ref?.rol || null].filter(Boolean).join(" | ") || null,
        title,
        document_type: docType,
        doc_role: docRole,
      })

      return {
        chunk,
        snapshotId,
        score,
      }
    })
    .filter((row) => Boolean(row.chunk.chunkId) && Boolean(String(row.chunk.content || "").trim()))
    .sort((a, b) => b.score - a.score)
    .filter((row) => {
      const count = snapshotCounts.get(row.snapshotId) || 0
      if (count >= perSnapshotCap) return false
      snapshotCounts.set(row.snapshotId, count + 1)
      return true
    })
    .slice(0, maxOut)
    .map((row) => row.chunk)
}
