type TraceParams = {
  supabase: any
  workspaceId: string
  stage: "chat" | "report" | "search" | "debug"
  provider: "local" | "openai" | "hybrid"
  query: string
  filters?: any
  results?: any[]
  responseId?: string | null
  model?: string | null
  createdBy?: string | null
  threadId?: string | null
  messageId?: string | null
  reportId?: string | null
  metadata?: Record<string, any>
}

function safeText(value: unknown, maxLen = 2_000) {
  const out = String(value ?? "")
  if (out.length <= maxLen) return out
  return `${out.slice(0, maxLen)}...`
}

function sanitizeResults(results: any[]) {
  return (Array.isArray(results) ? results : []).slice(0, 30).map((r) => ({
    id: safeText(r?.id, 180),
    fileId: safeText(r?.fileId ?? r?.openai_file_id, 120),
    filename: safeText(r?.filename ?? r?.openai_filename, 220),
    score:
      typeof r?.score === "number"
        ? r.score
        : typeof r?.similarity === "number"
          ? r.similarity
          : null,
    snippet: safeText(r?.text ?? r?.content ?? "", 900),
    chunkId: safeText(r?.chunkId, 120),
    sourceUrl: safeText(r?.sourceUrl, 900),
    snapshotId: safeText(r?.snapshotId, 120),
  }))
}

export async function recordRetrievalTrace(params: TraceParams) {
  const payload = {
    workspace_id: params.workspaceId,
    stage: params.stage,
    provider: params.provider,
    query: safeText(params.query, 8_000),
    filters: params.filters ?? {},
    results: sanitizeResults(params.results || []),
    response_id: params.responseId ?? null,
    model: params.model ?? null,
    created_by: params.createdBy ?? null,
    thread_id: params.threadId ?? null,
    message_id: params.messageId ?? null,
    report_id: params.reportId ?? null,
    metadata: params.metadata ?? {},
    created_at: new Date().toISOString(),
  }

  await params.supabase.from("gob_rag_retrieval_traces").insert(payload)
}
