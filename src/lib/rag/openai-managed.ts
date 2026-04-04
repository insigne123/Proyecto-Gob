import { getRagProvider } from "@/lib/env"
import { resolveOpenAIRagModel } from "@/lib/openai-models"
import { inferDefenseDocumentRole } from "@/lib/tribunal/defense-document-policy"

type ScalarAttr = string | number | boolean

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[]

export type SourceMetadata = {
  docType?: string | null
  year?: number | null
  region?: string | null
  sector?: string | null
  projectName?: string | null
  sourceOrigin?: string | null
  language?: string | null
}

export type RetrievalFilters = {
  docTypes?: string[]
  regions?: string[]
  sectors?: string[]
  sourceOrigins?: string[]
  languages?: string[]
  projectNames?: string[]
  snapshotIds?: string[]
  yearFrom?: number | null
  yearTo?: number | null
}

export type ManagedSearchResult = {
  id: string
  fileId: string | null
  filename: string | null
  score: number | null
  text: string
  attributes: Record<string, ScalarAttr>
  raw: any
}

export type ManagedSearchResponse = {
  responseId: string | null
  model: string | null
  provider: "openai"
  vectorStoreId: string
  query: string
  filters: JsonValue | null
  results: ManagedSearchResult[]
}

type KnowledgeBaseRow = {
  id: string
  workspace_id: string
  openai_vector_store_id: string
  name: string
}

function openAIKey() {
  const key = String(process.env.OPENAI_API_KEY || "").trim()
  if (!key) {
    throw new Error("Missing OPENAI_API_KEY")
  }
  return key
}

function openAIBaseUrl() {
  return String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "")
}

function ragModel() {
  return resolveOpenAIRagModel()
}

function indexFilePurpose() {
  return String(process.env.OPENAI_FILE_PURPOSE || "assistants").trim()
}

function sanitizeText(value: unknown, maxLen = 200) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > maxLen ? text.slice(0, maxLen) : text
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

function envBool(name: string, fallback = false) {
  const raw = String(process.env[name] || "")
    .trim()
    .toLowerCase()
  if (!raw) return fallback
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false
  return fallback
}

function envNumber(name: string): number | null {
  const raw = String(process.env[name] || "").trim()
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return n
}

function hybridSearchWeights() {
  const embeddingWeight = envNumber("OPENAI_FILE_SEARCH_EMBEDDING_WEIGHT")
  const textWeight = envNumber("OPENAI_FILE_SEARCH_TEXT_WEIGHT")
  if (embeddingWeight === null && textWeight === null) return null

  const normalizedEmbedding = Math.max(0, Math.min(1, Number(embeddingWeight ?? 0)))
  const normalizedText = Math.max(0, Math.min(1, Number(textWeight ?? 0)))
  if (normalizedEmbedding === 0 && normalizedText === 0) return null

  return {
    embedding_weight: normalizedEmbedding,
    text_weight: normalizedText,
  }
}

function toArray(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return values
    .map((x) => sanitizeText(x, 120))
    .filter(Boolean)
    .slice(0, 25)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function cleanAttributes(input: Record<string, unknown>) {
  const out: Record<string, ScalarAttr> = {}
  const entries = Object.entries(input)
  for (const [keyRaw, value] of entries) {
    const key = sanitizeText(keyRaw, 64)
    if (!key || Object.keys(out).length >= 16) break

    if (typeof value === "string") {
      const clean = sanitizeText(value, 240)
      if (clean) out[key] = clean
      continue
    }

    if (typeof value === "boolean") {
      out[key] = value
      continue
    }

    const n = toFiniteNumber(value)
    if (n !== null) {
      out[key] = n
    }
  }
  return out
}

function parseJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function openAIRequest(path: string, init?: { method?: string; body?: any; form?: FormData }) {
  const method = init?.method || "GET"
  const headers: Record<string, string> = {
    Authorization: `Bearer ${openAIKey()}`,
  }

  let body: BodyInit | undefined
  if (init?.form) {
    body = init.form
  } else if (typeof init?.body !== "undefined") {
    headers["content-type"] = "application/json"
    body = JSON.stringify(init.body)
  }

  const res = await fetch(`${openAIBaseUrl()}/${path.replace(/^\/+/, "")}`, {
    method,
    headers,
    body,
  })

  const text = await res.text()
  const data = text ? parseJson(text) : null

  if (!res.ok) {
    const msg =
      (isObject(data) && isObject(data.error) && String(data.error.message || "")) ||
      text ||
      `OpenAI request failed (${res.status})`
    throw new Error(msg)
  }

  return data
}

function buildEqOrFilter(key: string, values: string[]) {
  const list = toArray(values)
  if (!list.length) return null
  if (list.length === 1) {
    return { type: "eq", key, value: list[0] }
  }
  return {
    type: "or",
    filters: list.map((value) => ({ type: "eq", key, value })),
  }
}

export function buildAttributeFilter(filters?: RetrievalFilters | null): JsonValue | null {
  if (!filters) return null

  const clauses: any[] = []
  const mappings: Array<[string, string[] | undefined]> = [
    ["doc_type", filters.docTypes],
    ["region", filters.regions],
    ["sector", filters.sectors],
    ["source", filters.sourceOrigins],
    ["language", filters.languages],
    ["project_name", filters.projectNames],
    ["snapshot_id", filters.snapshotIds],
  ]

  for (const [key, values] of mappings) {
    const node = buildEqOrFilter(key, values || [])
    if (node) clauses.push(node)
  }

  if (typeof filters.yearFrom === "number" && Number.isFinite(filters.yearFrom)) {
    clauses.push({ type: "gte", key: "year", value: Math.floor(filters.yearFrom) })
  }
  if (typeof filters.yearTo === "number" && Number.isFinite(filters.yearTo)) {
    clauses.push({ type: "lte", key: "year", value: Math.floor(filters.yearTo) })
  }

  if (!clauses.length) return null
  if (clauses.length === 1) return clauses[0]
  return { type: "and", filters: clauses }
}

function findResultsNodes(node: unknown, acc: unknown[]) {
  if (Array.isArray(node)) {
    for (const item of node) findResultsNodes(item, acc)
    return
  }
  if (!isObject(node)) return

  if (Array.isArray((node as any).results)) {
    acc.push(...((node as any).results as unknown[]))
  }

  for (const value of Object.values(node)) {
    findResultsNodes(value, acc)
  }
}

function extractTextFromUnknown(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    return value
      .map((x) => extractTextFromUnknown(x))
      .filter(Boolean)
      .join("\n")
  }
  if (!isObject(value)) return ""

  if (typeof value.text === "string") return value.text
  if (typeof value.value === "string") return value.value
  if (typeof value.output_text === "string") return value.output_text
  if (Array.isArray(value.content)) return extractTextFromUnknown(value.content)

  return ""
}

function toManagedResult(raw: any, idx: number): ManagedSearchResult | null {
  const fileId = sanitizeText(raw?.file_id ?? raw?.fileId ?? raw?.file?.id, 120) || null
  const filename =
    sanitizeText(raw?.filename ?? raw?.file_name ?? raw?.file?.filename, 200) || null
  const score = toFiniteNumber(raw?.score ?? raw?.ranking_score)

  const text =
    sanitizeText(raw?.text, 4000) ||
    sanitizeText(raw?.content?.text, 4000) ||
    sanitizeText(raw?.snippet, 4000) ||
    sanitizeText(extractTextFromUnknown(raw?.content), 4000)

  if (!text) return null

  const id =
    sanitizeText(raw?.id, 160) ||
    (fileId ? `${fileId}:${idx}` : `openai-result:${idx}`)

  const attrs = cleanAttributes(isObject(raw?.attributes) ? raw.attributes : {})

  return {
    id,
    fileId,
    filename,
    score,
    text,
    attributes: attrs,
    raw,
  }
}

function uniqueResults(list: ManagedSearchResult[]) {
  const seen = new Set<string>()
  const out: ManagedSearchResult[] = []
  for (const item of list) {
    const key = `${item.fileId || "nofile"}|${item.id}|${item.text.slice(0, 80)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

async function searchVectorStoreFallback(params: {
  vectorStoreId: string
  query: string
  filters: JsonValue | null
  maxResults: number
  scoreThreshold: number
}) {
  const hybridWeights = hybridSearchWeights()

  const body: any = {
    query: params.query,
    max_num_results: params.maxResults,
    rewrite_query: envBool("OPENAI_FILE_SEARCH_REWRITE_QUERY", true),
    ranking_options: {
      ranker: process.env.OPENAI_FILE_SEARCH_RANKER || "auto",
      score_threshold: params.scoreThreshold,
    },
  }

  if (hybridWeights) {
    body.ranking_options.hybrid_search = hybridWeights
  }

  if (params.filters) {
    body.filters = params.filters
  }

  const data = await openAIRequest(`vector_stores/${params.vectorStoreId}/search`, {
    method: "POST",
    body,
  })

  const rows = Array.isArray((data as any)?.data) ? ((data as any).data as any[]) : []
  const parsed = rows
    .map((row, idx) => toManagedResult(row, idx))
    .filter((x): x is ManagedSearchResult => Boolean(x))

  return uniqueResults(parsed)
}

function openaiEnabled() {
  return !!String(process.env.OPENAI_API_KEY || "").trim()
}

export function shouldUseManagedRetrieval() {
  const provider = getRagProvider()
  return openaiEnabled() && (provider === "openai" || provider === "hybrid")
}

export function shouldUseManagedIndexing() {
  const provider = getRagProvider()
  return openaiEnabled() && (provider === "openai" || provider === "hybrid")
}

export function isHybridRagMode() {
  return getRagProvider() === "hybrid"
}

export async function ensureWorkspaceKnowledgeBase(params: {
  supabase: any
  workspaceId: string
  workspaceTitle?: string | null
}) {
  const { supabase, workspaceId, workspaceTitle } = params

  const { data: existing, error: existingErr } = await supabase
    .from("gob_knowledge_bases")
    .select("id,workspace_id,name,openai_vector_store_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (existingErr) throw new Error(existingErr.message)
  if (existing?.openai_vector_store_id) {
    const row = existing as KnowledgeBaseRow
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      name: String(row.name),
      vectorStoreId: String(row.openai_vector_store_id),
    }
  }

  const vsName = sanitizeText(
    workspaceTitle ? `KB ${workspaceTitle}` : `KB workspace ${workspaceId}`,
    120
  )

  const vectorStore = await openAIRequest("vector_stores", {
    method: "POST",
    body: { name: vsName },
  })

  const vectorStoreId = sanitizeText((vectorStore as any)?.id, 120)
  if (!vectorStoreId) throw new Error("OpenAI vector store creation returned no id")

  const now = new Date().toISOString()
  const insertPayload = {
    workspace_id: workspaceId,
    name: vsName,
    provider: "openai",
    openai_vector_store_id: vectorStoreId,
    status: "ready",
    last_error: null,
    updated_at: now,
    created_at: now,
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("gob_knowledge_bases")
    .insert(insertPayload)
    .select("id,workspace_id,name,openai_vector_store_id")
    .maybeSingle()

  if (insertErr) {
    const { data: raceWinner } = await supabase
      .from("gob_knowledge_bases")
      .select("id,workspace_id,name,openai_vector_store_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle()

    if (!raceWinner?.openai_vector_store_id) {
      throw new Error(insertErr.message)
    }

    return {
      id: String(raceWinner.id),
      workspaceId: String(raceWinner.workspace_id),
      name: String(raceWinner.name),
      vectorStoreId: String(raceWinner.openai_vector_store_id),
    }
  }

  return {
    id: String(inserted.id),
    workspaceId: String(inserted.workspace_id),
    name: String(inserted.name),
    vectorStoreId: String(inserted.openai_vector_store_id),
  }
}

export function buildSnapshotAttributes(params: {
  workspaceId: string
  sourceId: string
  snapshotId: string
  metadata?: SourceMetadata | null
}) {
  const m = params.metadata || {}
  return cleanAttributes({
    workspace_id: params.workspaceId,
    source_id: params.sourceId,
    snapshot_id: params.snapshotId,
    doc_type: m.docType,
    year: m.year,
    region: m.region,
    sector: m.sector,
    project_name: m.projectName,
    source: m.sourceOrigin,
    language: m.language || "es",
  })
}

async function waitForVectorStoreFile(params: {
  vectorStoreId: string
  vectorStoreFileId: string
  timeoutMs?: number
}) {
  const timeoutMs = params.timeoutMs ?? 180_000
  const pollMs = 2_000
  const started = Date.now()

  let lastStatus = "in_progress"
  while (Date.now() - started < timeoutMs) {
    const row = await openAIRequest(
      `vector_stores/${params.vectorStoreId}/files/${params.vectorStoreFileId}`
    )
    const status = sanitizeText((row as any)?.status, 32).toLowerCase()
    if (status) lastStatus = status

    if (status === "completed" || status === "ready") {
      return row
    }
    if (status === "failed" || status === "cancelled" || status === "canceled") {
      throw new Error(`OpenAI vector_store.file status=${status}`)
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }

  throw new Error(`OpenAI vector_store.file timeout (last_status=${lastStatus})`)
}

export async function indexSnapshotToOpenAI(params: {
  supabase: any
  workspaceId: string
  workspaceTitle?: string | null
  sourceId: string
  snapshotId: string
  filename: string
  contentType: string | null
  bytes: Buffer
  metadata?: SourceMetadata | null
}) {
  const kb = await ensureWorkspaceKnowledgeBase({
    supabase: params.supabase,
    workspaceId: params.workspaceId,
    workspaceTitle: params.workspaceTitle,
  })

  const attrs = buildSnapshotAttributes({
    workspaceId: params.workspaceId,
    sourceId: params.sourceId,
    snapshotId: params.snapshotId,
    metadata: params.metadata,
  })

  const form = new FormData()
  form.set("purpose", indexFilePurpose())
  form.set(
    "file",
    new Blob([params.bytes], {
      type: params.contentType || "application/octet-stream",
    }),
    sanitizeText(params.filename, 200) || `snapshot-${params.snapshotId}`
  )

  const uploaded = await openAIRequest("files", {
    method: "POST",
    form,
  })

  const openaiFileId = sanitizeText((uploaded as any)?.id, 120)
  if (!openaiFileId) throw new Error("OpenAI file upload returned no id")

  const attached = await openAIRequest(`vector_stores/${kb.vectorStoreId}/files`, {
    method: "POST",
    body: {
      file_id: openaiFileId,
      attributes: attrs,
    },
  })

  const openaiVectorStoreFileId = sanitizeText((attached as any)?.id, 120)
  if (!openaiVectorStoreFileId) {
    throw new Error("OpenAI vector store attach returned no id")
  }

  await openAIRequest(
    `vector_stores/${kb.vectorStoreId}/files/${openaiVectorStoreFileId}`,
    {
      method: "POST",
      body: { attributes: attrs },
    }
  ).catch(() => null)

  await waitForVectorStoreFile({
    vectorStoreId: kb.vectorStoreId,
    vectorStoreFileId: openaiVectorStoreFileId,
  })

  return {
    vectorStoreId: kb.vectorStoreId,
    openaiFileId,
    openaiVectorStoreFileId,
    attributes: attrs,
  }
}

export async function searchKnowledgeBaseWithFileSearch(params: {
  vectorStoreId: string
  query: string
  filters?: RetrievalFilters | null
  maxResults?: number
  scoreThreshold?: number
}) {
  const maxResults = Math.max(1, Math.min(50, Number(params.maxResults || 12)))
  const scoreThreshold = Math.max(0, Math.min(1, Number(params.scoreThreshold ?? 0.15)))
  const attributeFilter = buildAttributeFilter(params.filters)
  const hybridWeights = hybridSearchWeights()

  const tool: any = {
    type: "file_search",
    vector_store_ids: [params.vectorStoreId],
    max_num_results: maxResults,
    ranking_options: {
      ranker: process.env.OPENAI_FILE_SEARCH_RANKER || "auto",
      score_threshold: scoreThreshold,
    },
  }

  if (hybridWeights) {
    tool.ranking_options.hybrid_search = hybridWeights
  }

  if (attributeFilter) {
    tool.filters = attributeFilter
  }

  let responseData: any = null
  try {
    responseData = await openAIRequest("responses", {
      method: "POST",
      body: {
        model: ragModel(),
        input: params.query,
        tools: [tool],
        include: ["file_search_call.results"],
        temperature: 0,
      },
    })
  } catch {
    responseData = null
  }

  const resultNodes: unknown[] = []
  if (responseData) {
    findResultsNodes(responseData, resultNodes)
  }

  let results = resultNodes
    .map((row, idx) => toManagedResult(row, idx))
    .filter((x): x is ManagedSearchResult => Boolean(x))

  if (!results.length) {
    results = await searchVectorStoreFallback({
      vectorStoreId: params.vectorStoreId,
      query: params.query,
      filters: attributeFilter,
      maxResults,
      scoreThreshold,
    })
  }

  return {
    responseId: sanitizeText(responseData?.id, 120) || null,
    model: sanitizeText(responseData?.model, 80) || ragModel(),
    provider: "openai" as const,
    vectorStoreId: params.vectorStoreId,
    query: params.query,
    filters: attributeFilter,
    results: uniqueResults(results),
  } satisfies ManagedSearchResponse
}

export async function getWorkspaceKnowledgeBase(params: {
  supabase: any
  workspaceId: string
}) {
  const { data, error } = await params.supabase
    .from("gob_knowledge_bases")
    .select("id,workspace_id,name,openai_vector_store_id")
    .eq("workspace_id", params.workspaceId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data?.openai_vector_store_id) return null

  const row = data as KnowledgeBaseRow
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    vectorStoreId: String(row.openai_vector_store_id),
  }
}

export async function listKnowledgeBasesForWorkspaces(params: {
  supabase: any
  workspaceIds: string[]
}) {
  const ids = Array.from(
    new Set((params.workspaceIds || []).map((id) => String(id || "")).filter(Boolean))
  ).slice(0, 60)

  if (!ids.length) return []

  const { data, error } = await params.supabase
    .from("gob_knowledge_bases")
    .select("id,workspace_id,name,openai_vector_store_id")
    .in("workspace_id", ids)

  if (error) throw new Error(error.message)

  return (data || [])
    .filter((row: any) => !!row?.openai_vector_store_id)
    .map((row: any) => ({
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      name: String(row.name),
      vectorStoreId: String(row.openai_vector_store_id),
    }))
}

export async function mapResultsToEvidence(params: {
  supabase: any
  workspaceId?: string
  workspaceIds?: string[]
  results: ManagedSearchResult[]
}) {
  const { supabase, results } = params
  const workspaceIds = Array.from(
    new Set(
      (Array.isArray(params.workspaceIds) ? params.workspaceIds : [])
        .concat(params.workspaceId ? [params.workspaceId] : [])
        .map((x) => String(x || ""))
        .filter(Boolean)
    )
  ).slice(0, 80)

  const fileIds = Array.from(
    new Set(
      results
        .map((r) => r.fileId)
        .filter((v): v is string => Boolean(v))
    )
  )

  const snapshotsByFile = new Map<string, any>()
  const sourcesById = new Map<string, any>()

  if (fileIds.length) {
    let snapshotsQuery = supabase
      .from("gob_source_snapshots")
      .select("id,workspace_id,source_id,openai_file_id,openai_attributes")
      .in("openai_file_id", fileIds)

    if (workspaceIds.length > 0) {
      snapshotsQuery = snapshotsQuery.in("workspace_id", workspaceIds)
    }

    const { data: snapshots, error: sErr } = await snapshotsQuery

    if (sErr) throw new Error(sErr.message)

    const sourceIds = Array.from(
      new Set(
        (snapshots || [])
          .map((s: any) => (s?.source_id ? String(s.source_id) : ""))
          .filter(Boolean)
      )
    )

    if (sourceIds.length) {
      const { data: sources, error: srcErr } = await supabase
        .from("gob_sources")
        .select(
          "id,url,title,filename,doc_type,year,region,sector,project_name,source_origin,language,attributes"
        )
        .in("id", sourceIds)
      if (srcErr) throw new Error(srcErr.message)
      for (const src of sources || []) {
        sourcesById.set(String((src as any).id), src)
      }
    }

    for (const snapshot of snapshots || []) {
      const fid = String((snapshot as any).openai_file_id || "")
      if (fid) snapshotsByFile.set(fid, snapshot)
    }
  }

  const evidence = results.map((r, idx) => {
    const snapshot = r.fileId ? snapshotsByFile.get(r.fileId) : null
    const source = snapshot?.source_id ? sourcesById.get(String(snapshot.source_id)) : null
    const sourceAttrs = source?.attributes && typeof source.attributes === "object" ? source.attributes : {}
    const attrs = r.attributes && typeof r.attributes === "object" ? { ...sourceAttrs, ...r.attributes } : sourceAttrs

    const page = toFiniteNumber(attrs.page)
    const documentType = sanitizeText((source as any)?.doc_type, 120) || sanitizeText(attrs.doc_type, 120) || null
    const documentTitle =
      sanitizeText((source as any)?.title, 240) || sanitizeText(r.filename, 240) || null
    const section = sanitizeText(attrs.section, 200) || documentType || null
    const sourceUrl =
      sanitizeText((source as any)?.url, 1000) || sanitizeText(attrs.source_url, 1000) || null
    const snapshotId =
      sanitizeText(snapshot?.id, 80) || sanitizeText(attrs.snapshot_id, 80) || null
    const docRole = inferDefenseDocumentRole({
      docRole: attrs?.doc_role ? String(attrs.doc_role) : null,
      documentType,
      name: documentTitle,
      title: documentType,
      section,
    })

    return {
      chunkId: r.id || `openai:${idx}`,
      content: r.text,
      sourceUrl,
      snapshotId,
      page: page !== null ? Math.floor(page) : null,
      section,
      docRole,
      documentType,
      documentTitle,
      _meta: {
        openai_file_id: r.fileId,
        openai_filename: r.filename,
        score: r.score,
        attributes: attrs,
        workspace_id: snapshot?.workspace_id ? String(snapshot.workspace_id) : null,
      },
    }
  })

  return evidence
}
