import "dotenv/config"

import { toVectorLiteral } from "../src/lib/pgvector"
import { embedTextWithOpenAI, embedTextsWithOpenAI } from "../src/lib/rag/openai-embeddings"
import { createAdminClient } from "../src/lib/supabase/admin"

type ChunkRow = {
  id: string
  content: string | null
  section: string | null
  metadata: Record<string, unknown> | null
}

const SUMMARY_STOP_WORDS = new Set([
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
  "como",
  "sobre",
  "segun",
  "y",
  "o",
  "a",
  "un",
  "una",
  "al",
])

function normalizeText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function summarizeText(text: string, maxChars = 220) {
  const clean = String(text || "").replace(/\s+/g, " ").trim()
  if (!clean) return ""
  if (clean.length <= maxChars) return clean

  const sentences = clean
    .split(/(?<=[\.!?;])\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 20)

  const head = sentences.slice(0, 2).join(" ").trim()
  if (!head) return clean.slice(0, maxChars)
  if (head.length <= maxChars) return head
  return head.slice(0, maxChars)
}

function extractTopTerms(text: string, maxTerms = 6) {
  const freq = new Map<string, number>()
  for (const token of normalizeText(text)
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean)) {
    if (token.length < 3) continue
    if (SUMMARY_STOP_WORDS.has(token)) continue
    if (/^\d+$/.test(token)) continue
    freq.set(token, (freq.get(token) || 0) + 1)
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(2, Math.min(20, maxTerms)))
    .map(([term]) => term)
}

function contextualMetadata(row: ChunkRow) {
  const base = row.metadata && typeof row.metadata === "object" ? row.metadata : {}
  const existingSummary = String((base as any).context_summary || "").trim()
  const existingTerms = Array.isArray((base as any).key_terms) ? (base as any).key_terms : null

  const section = String(row.section || "").trim()
  const content = String(row.content || "").trim()
  const contextSource = section ? `${section}. ${content}` : content
  const summary = existingSummary || summarizeText(contextSource, 260)
  const terms =
    existingTerms && existingTerms.length > 0
      ? existingTerms
      : extractTopTerms(`${summary} ${content}`, 8)

  return {
    ...(base as Record<string, unknown>),
    context_summary: summary || null,
    key_terms: terms,
    metadata_contextualized: true,
    metadata_contextualized_at: new Date().toISOString(),
  }
}

function positionalArgs() {
  const raw = process.argv.slice(2)
  const out: string[] = []

  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i]
    if (!token || token.startsWith("--")) continue

    const prev = raw[i - 1]
    if (prev && prev.startsWith("--") && !prev.includes("=")) {
      continue
    }
    out.push(token)
  }

  return out
}

function buildEmbeddingInput(content: string | null, metadata: Record<string, unknown> | null) {
  const cleanContent = String(content || "").replace(/\s+/g, " ").trim()
  if (!cleanContent) return ""

  const contextRaw =
    metadata && typeof metadata === "object" ? String((metadata as any).context_summary || "") : ""
  const context = contextRaw.replace(/\s+/g, " ").trim()
  if (!context) return cleanContent

  return `Context: ${context}\n\nChunk: ${cleanContent}`
}

function arg(name: string) {
  const inline = process.argv.find((x) => x.startsWith(`${name}=`))
  if (inline) {
    const value = inline.slice(name.length + 1).trim()
    if (value) return value
  }

  const idx = process.argv.findIndex((x) => x === name)
  if (idx >= 0) {
    const next = process.argv[idx + 1]
    if (next && !next.startsWith("--")) return next
  }

  const npmConfigKey = `npm_config_${name.replace(/^--+/, "").replace(/-/g, "_")}`
  const fromNpmConfig = String(process.env[npmConfigKey] || "").trim()
  if (fromNpmConfig) return fromNpmConfig

  return null
}

function intArg(name: string, fallback: number, min: number, max: number) {
  const raw = Number(arg(name) || fallback)
  if (!Number.isFinite(raw)) return fallback
  return Math.max(min, Math.min(max, Math.floor(raw)))
}

function hasFlag(name: string) {
  if (process.argv.includes(name)) return true

  const npmConfigKey = `npm_config_${name.replace(/^--+/, "").replace(/-/g, "_")}`
  const fromNpmConfig = String(process.env[npmConfigKey] || "")
    .trim()
    .toLowerCase()
  if (!fromNpmConfig) return false
  return fromNpmConfig === "1" || fromNpmConfig === "true" || fromNpmConfig === "yes"
}

async function sleep(ms: number) {
  if (ms <= 0) return
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function errorMessage(err: unknown) {
  return String((err as any)?.message || err || "")
}

function isRateLimitError(err: unknown) {
  const msg = errorMessage(err).toLowerCase()
  return msg.includes("429") || msg.includes("too many requests") || msg.includes("quota")
}

async function embedOneWithRetry(text: string, maxAttempts = 8) {
  return embedTextWithOpenAI(text, {
    task: "document",
    maxRetries: maxAttempts,
    batchSize: 1,
  })
}

async function embedBatch(texts: string[], retryOnRateLimit: boolean) {
  try {
    const vectors = await embedTextsWithOpenAI(texts, {
      task: "document",
      maxRetries: 4,
      batchSize: Math.max(1, Math.min(64, texts.length)),
    })
    if (vectors.length !== texts.length) {
      throw new Error(`Embedding count mismatch: got ${vectors.length}, expected ${texts.length}`)
    }
    return vectors
  } catch (err) {
    if (!isRateLimitError(err) || !retryOnRateLimit) throw err

    const vectors: number[][] = []
    for (const text of texts) {
      const vec = await embedOneWithRetry(text)
      vectors.push(vec)
    }
    return vectors
  }
}

async function main() {
  const positional = positionalArgs()

  const workspaceId = String(arg("--workspace-id") || positional[0] || "").trim()
  if (!workspaceId) {
    throw new Error("Missing --workspace-id")
  }

  const limit = intArg("--limit", Number(positional[2] || 200000), 1, 5_000_000)
  const fetchBatch = intArg("--fetch-batch", Number(positional[3] || 120), 10, 400)
  const embedBatchSize = intArg("--embed-batch", Number(positional[4] || 32), 1, 64)
  const sleepMs = intArg("--sleep-ms", Number(positional[5] || 0), 0, 20000)
  const startOffset = intArg("--offset", Number(positional[1] || 0), 0, 5_000_000)
  const reembedAll = hasFlag("--reembed-all") || startOffset > 0
  const dryRun = hasFlag("--dry-run")
  const metadataOnly = hasFlag("--metadata-only")
  const failOnRateLimit = hasFlag("--fail-on-rate-limit")

  const supabase = createAdminClient()

  let pendingBeforeQuery = supabase
    .from("gob_chunks")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
  if (!reembedAll) {
    pendingBeforeQuery = pendingBeforeQuery.is("embedding", null)
  }

  const { count: pendingBefore, error: countErr } = await pendingBeforeQuery

  if (countErr) throw new Error(countErr.message)

  const start = Date.now()
  let processed = 0
  let updated = 0
  let loops = 0
  let offset = reembedAll ? startOffset : 0
  let stoppedByRateLimit = false
  let rateLimitMessage = ""

  while (processed < limit) {
    loops += 1
    const remaining = limit - processed
    const currentFetch = Math.max(1, Math.min(fetchBatch, remaining))

    let chunkQuery = supabase
      .from("gob_chunks")
      .select("id,content,section,metadata")
      .eq("workspace_id", workspaceId)

    if (reembedAll) {
      chunkQuery = chunkQuery
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + currentFetch - 1)
    } else {
      chunkQuery = chunkQuery
        .is("embedding", null)
        .order("created_at", { ascending: true })
        .limit(currentFetch)
    }

    const { data, error } = await chunkQuery

    if (error) throw new Error(error.message)
    const rows = (Array.isArray(data) ? data : []) as ChunkRow[]
    if (!rows.length) break

    if (dryRun) {
      processed += rows.length
      if (reembedAll) {
        offset += rows.length
      }
      console.log(
        JSON.stringify({
          action: "backfill_chunk_embeddings.dry_run_batch",
          loop: loops,
          rows: rows.length,
          processed,
        })
      )
      continue
    }

    const payload: Array<{ id: string; embedding: string | null; metadata: Record<string, unknown> }> = []

    if (metadataOnly) {
      for (const row of rows) {
        payload.push({
          id: row.id,
          embedding: null,
          metadata: contextualMetadata(row),
        })
      }
    } else {
      for (let i = 0; i < rows.length; i += embedBatchSize) {
        const batch = rows.slice(i, i + embedBatchSize)
        const texts = batch.map((row) => buildEmbeddingInput(row.content, row.metadata))

        let vectors: number[][] = []
        try {
          vectors = await embedBatch(texts, failOnRateLimit)
        } catch (err) {
          if (isRateLimitError(err) && !failOnRateLimit) {
            stoppedByRateLimit = true
            rateLimitMessage = errorMessage(err)
            break
          }
          throw err
        }

        for (let j = 0; j < batch.length; j += 1) {
          const row = batch[j]
          const vec = vectors[j]
          payload.push({
            id: row.id,
            embedding: toVectorLiteral(vec),
            metadata: {
              ...contextualMetadata(row),
              embedding_provider: "openai",
              embedding_backfilled_at: new Date().toISOString(),
              embedding_contextualized: true,
            },
          })
        }
      }
    }

    if (stoppedByRateLimit && payload.length === 0) {
      break
    }

    const updateConcurrency = 20
    for (let i = 0; i < payload.length; i += updateConcurrency) {
      const group = payload.slice(i, i + updateConcurrency)
      const results = await Promise.all(
        group.map(async (row) => {
          const patch: Record<string, unknown> = {
            metadata: row.metadata,
          }
          if (row.embedding) {
            patch.embedding = row.embedding
          }

          const { error: updateErr } = await supabase
            .from("gob_chunks")
            .update(patch)
            .eq("id", row.id)
          return updateErr
        })
      )

      const failed = results.find((err) => Boolean(err))
      if (failed) throw new Error(String((failed as any)?.message || failed))
    }

    processed += payload.length
    updated += payload.length
    if (reembedAll) {
      offset += payload.length
    }

    const elapsedSec = Math.round((Date.now() - start) / 1000)
    console.log(
      JSON.stringify({
        action: "backfill_chunk_embeddings.batch",
        loop: loops,
        rows: payload.length,
        processed,
        updated,
        elapsedSec,
      })
    )

    if (sleepMs > 0) {
      await sleep(sleepMs)
    }

    if (stoppedByRateLimit) {
      break
    }
  }

  const { count: pendingAfter, error: countAfterErr } = await supabase
    .from("gob_chunks")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("embedding", null)

  if (countAfterErr) throw new Error(countAfterErr.message)

  const elapsedSec = Math.round((Date.now() - start) / 1000)
  console.log(
    JSON.stringify(
      {
        action: "backfill_chunk_embeddings.done",
        workspaceId,
        dryRun,
        reembedAll,
        metadataOnly,
        startOffset,
        endOffset: reembedAll ? offset : null,
        pendingBefore: pendingBefore || 0,
        pendingAfter: pendingAfter || 0,
        processed,
        updated,
        elapsedSec,
        stoppedByRateLimit,
        rateLimitMessage: rateLimitMessage || null,
      },
      null,
      2
    )
  )
}

main().catch((err) => {
  console.error("backfill-chunk-embeddings failed:", err)
  process.exit(1)
})
