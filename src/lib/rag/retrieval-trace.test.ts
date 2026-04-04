import test from "node:test"
import assert from "node:assert/strict"

import { recordRetrievalTrace } from "@/lib/rag/retrieval-trace"

function createSupabaseRecorder() {
  let tableName = ""
  let insertedPayload: any = null

  return {
    client: {
      from(table: string) {
        tableName = table
        return {
          async insert(payload: any) {
            insertedPayload = payload
            return { error: null }
          },
        }
      },
    },
    snapshot() {
      return { tableName, insertedPayload }
    },
  }
}

test("recordRetrievalTrace sanitizes and truncates large retrieval payloads", async () => {
  const recorder = createSupabaseRecorder()
  const results = Array.from({ length: 31 }, (_, index) => ({
    id: `result-${index + 1}`,
    openai_file_id: `file-${index + 1}`,
    openai_filename: `documento-${index + 1}.pdf`,
    similarity: 0.9 - index / 100,
    text: "fragmento ".repeat(150),
    sourceUrl: `https://example.com/${index + 1}`,
    snapshotId: `snapshot-${index + 1}`,
  }))

  await recordRetrievalTrace({
    supabase: recorder.client,
    workspaceId: "workspace-123",
    stage: "chat",
    provider: "hybrid",
    query: "q".repeat(8_100),
    results,
  })

  const { tableName, insertedPayload } = recorder.snapshot()

  assert.equal(tableName, "gob_rag_retrieval_traces")
  assert.equal(insertedPayload.workspace_id, "workspace-123")
  assert.equal(insertedPayload.stage, "chat")
  assert.equal(insertedPayload.provider, "hybrid")
  assert.equal(insertedPayload.query.length, 8_003)
  assert.equal(insertedPayload.query.endsWith("..."), true)
  assert.equal(Array.isArray(insertedPayload.results), true)
  assert.equal(insertedPayload.results.length, 30)
  assert.equal(insertedPayload.results[0].fileId, "file-1")
  assert.equal(insertedPayload.results[0].filename, "documento-1.pdf")
  assert.equal(insertedPayload.results[0].score, 0.9)
  assert.equal(insertedPayload.results[0].snippet.endsWith("..."), true)
  assert.equal(insertedPayload.results[0].snippet.length, 903)
  assert.deepEqual(insertedPayload.filters, {})
  assert.deepEqual(insertedPayload.metadata, {})
  assert.equal(Number.isNaN(Date.parse(insertedPayload.created_at)), false)
})

test("recordRetrievalTrace preserves provided metadata and optional identifiers", async () => {
  const recorder = createSupabaseRecorder()

  await recordRetrievalTrace({
    supabase: recorder.client,
    workspaceId: "workspace-ops",
    stage: "report",
    provider: "openai",
    query: "buscar precedentes sobre informe",
    filters: { sourceType: "tribunal" },
    responseId: "resp-1",
    model: "gpt-4o-mini",
    createdBy: "user-1",
    threadId: "thread-1",
    messageId: "message-1",
    reportId: "report-1",
    metadata: { reviewMode: "deep" },
    results: [{ id: "r1", score: 0.77, content: "texto breve" }],
  })

  const { insertedPayload } = recorder.snapshot()

  assert.deepEqual(insertedPayload.filters, { sourceType: "tribunal" })
  assert.deepEqual(insertedPayload.metadata, { reviewMode: "deep" })
  assert.equal(insertedPayload.response_id, "resp-1")
  assert.equal(insertedPayload.model, "gpt-4o-mini")
  assert.equal(insertedPayload.created_by, "user-1")
  assert.equal(insertedPayload.thread_id, "thread-1")
  assert.equal(insertedPayload.message_id, "message-1")
  assert.equal(insertedPayload.report_id, "report-1")
  assert.equal(insertedPayload.results[0].score, 0.77)
  assert.equal(insertedPayload.results[0].snippet, "texto breve")
})
