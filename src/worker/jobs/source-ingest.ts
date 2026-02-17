import crypto from "crypto"

import { PDFParse } from "pdf-parse"
import * as cheerio from "cheerio"

import { ai } from "../../ai/genkit"
import { getRagProvider } from "../../lib/env"
import { toVectorLiteral } from "../../lib/pgvector"
import { indexSnapshotToOpenAI, shouldUseManagedIndexing } from "../../lib/rag/openai-managed"

type ChunkDraft = {
  content: string
  page: number | null
  section: string | null
}

function chunkText(text: string, opts?: { maxChars?: number; overlap?: number }) {
  const maxChars = opts?.maxChars ?? 1200
  const overlap = opts?.overlap ?? 180
  const clean = text.replace(/\s+/g, " ").trim()
  if (!clean) return []
  if (clean.length <= maxChars) return [clean]

  const out: string[] = []
  let i = 0
  while (i < clean.length) {
    const end = Math.min(clean.length, i + maxChars)
    out.push(clean.slice(i, end))
    if (end >= clean.length) break
    i = Math.max(0, end - overlap)
  }
  return out
}

function extractHtmlSections(html: string) {
  const $ = cheerio.load(html)
  $("script,style,noscript").remove()
  $("header,footer,nav,aside").remove()
  const main = $("main").first()
  const root = main.length ? main : $("body")

  const blocks: Array<{ section: string | null; text: string }> = []
  let currentSection: string | null = null
  let buffer: string[] = []

  function flush() {
    const text = buffer.join(" ").replace(/\s+/g, " ").trim()
    if (text) blocks.push({ section: currentSection, text })
    buffer = []
  }

  root.find("h1,h2,h3,p,li").each((_i: number, el: any) => {
    const tag = el.tagName?.toLowerCase?.() || ""
    const text = $(el).text().replace(/\s+/g, " ").trim()
    if (!text) return

    if (tag.startsWith("h")) {
      flush()
      currentSection = text.slice(0, 180)
      return
    }

    buffer.push(text)
  })

  flush()
  if (!blocks.length) {
    const fallback = root.text().replace(/\s+/g, " ").trim()
    if (fallback) blocks.push({ section: null, text: fallback })
  }
  return blocks
}

function inferKind(contentType: string | null, url: string | null) {
  const ct = (contentType || "").toLowerCase()
  if (ct.includes("pdf")) return "pdf"
  if (url && url.toLowerCase().includes(".pdf")) return "pdf"
  return "html"
}

export async function ingestSourceJob(params: { supabase: any; job: any }) {
  const { supabase, job } = params
  const payload = job.payload || {}
  const snapshotId = String(payload.snapshot_id || payload.snapshotId || "")
  if (!snapshotId) throw new Error("Missing snapshot_id")

  const now = new Date().toISOString()
  const ragProvider = getRagProvider()
  const managedIndexing = shouldUseManagedIndexing()
  const localEmbeddingsEnabled = ragProvider !== "openai"
  let snapshot: any = null
  let source: any = null

  try {
    const { data: snapshotRow, error: snapErr } = await supabase
      .from("gob_source_snapshots")
      .select(
        "id,workspace_id,source_id,url,storage_path,content_type,original_filename,openai_file_id,openai_vector_store_file_id"
      )
      .eq("id", snapshotId)
      .single()
    if (snapErr) throw new Error(snapErr.message)
    snapshot = snapshotRow

    const { data: sourceRow, error: srcErr } = await supabase
      .from("gob_sources")
      .select(
        "id,workspace_id,kind,url,filename,doc_type,year,region,sector,project_name,source_origin,language"
      )
      .eq("id", snapshot.source_id)
      .single()
    if (srcErr) throw new Error(srcErr.message)
    source = sourceRow

    // Domain allowlist + workspace metadata
    const workspaceLookupId =
      (payload.workspace_id ? String(payload.workspace_id) : "") ||
      (snapshot?.workspace_id ? String(snapshot.workspace_id) : "")
    const { data: ws } = workspaceLookupId
      ? await supabase
          .from("gob_workspaces")
          .select("allowed_domains,title")
          .eq("id", workspaceLookupId)
          .maybeSingle()
      : { data: null }

    const allowed = Array.isArray((ws as any)?.allowed_domains)
      ? ((ws as any).allowed_domains as string[])
      : []
    const checkUrl = snapshot.url || source.url
    if (allowed.length && checkUrl) {
      try {
        const host = new URL(checkUrl).host
        const ok = allowed.some((d) => d === host || host.endsWith(`.${d}`))
        if (!ok) {
          throw new Error(`Domain not allowed: ${host}`)
        }
      } catch {
        throw new Error("Invalid source URL")
      }
    }

    await supabase
      .from("gob_sources")
      .update({ status: "processing", last_error: null, updated_at: now })
      .eq("id", source.id)

    await supabase
      .from("gob_source_snapshots")
      .update(
        managedIndexing
          ? { status: "processing", error: null, openai_index_status: "indexing", openai_last_error: null }
          : { status: "processing", error: null, openai_index_status: "deleted", openai_last_error: null }
      )
      .eq("id", snapshot.id)

    let buf: Buffer
    let httpStatus: number | null = null
    let contentType: string | null = snapshot.content_type
    let storagePath: string | null = snapshot.storage_path
    let sourceUrl: string | null = snapshot.url || source.url || null

    if (storagePath) {
      const { data, error } = await supabase.storage
        .from("gob_sources")
        .download(storagePath)
      if (error) throw new Error(`storage download failed: ${error.message}`)
      const ab = await (data as Blob).arrayBuffer()
      buf = Buffer.from(ab)
  } else if (snapshot.url) {
    const resp = await fetch(snapshot.url, {
      headers: {
        "user-agent": "CuadernoAmbiental/1.0 (+strict-rag)",
        accept:
          "text/html,application/pdf,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    })
    httpStatus = resp.status
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} al descargar fuente`)
    }
    contentType = resp.headers.get("content-type")
    const ab = await resp.arrayBuffer()
    buf = Buffer.from(ab)

      const kind = inferKind(contentType, snapshot.url)
      const ext = kind === "pdf" ? "pdf" : "html"
      storagePath = `snapshots/${snapshot.workspace_id}/${source.id}/${snapshot.id}.${ext}`

      const { error: upErr } = await supabase.storage
        .from("gob_sources")
        .upload(storagePath, buf, {
          contentType: kind === "pdf" ? "application/pdf" : "text/html",
          upsert: false,
        })

      if (upErr) {
        // If upload fails, continue without storage (still keep hash + chunks)
        storagePath = null
      }
    } else {
      throw new Error("Snapshot has neither storage_path nor url")
    }

    const hash = crypto.createHash("sha256").update(buf).digest("hex")

    const kind = inferKind(contentType, snapshot.url)
    const ext = kind === "pdf" ? "pdf" : "html"
    const inferredFilename =
      (snapshot.original_filename ? String(snapshot.original_filename) : "") ||
      (source.filename ? String(source.filename) : "") ||
      `snapshot-${snapshot.id}.${ext}`

    if (managedIndexing) {
      try {
        const indexed = await indexSnapshotToOpenAI({
          supabase,
          workspaceId: String(snapshot.workspace_id),
          workspaceTitle: (ws as any)?.title ? String((ws as any).title) : null,
          sourceId: String(source.id),
          snapshotId: String(snapshot.id),
          filename: inferredFilename,
          contentType,
          bytes: buf,
          metadata: {
            docType: source.doc_type ? String(source.doc_type) : null,
            year:
              typeof source.year === "number"
                ? source.year
                : source.year
                  ? Number(source.year)
                  : null,
            region: source.region ? String(source.region) : null,
            sector: source.sector ? String(source.sector) : null,
            projectName: source.project_name ? String(source.project_name) : null,
            sourceOrigin: source.source_origin ? String(source.source_origin) : null,
            language: source.language ? String(source.language) : "es",
          },
        })

        await supabase
          .from("gob_source_snapshots")
          .update({
            openai_file_id: indexed.openaiFileId,
            openai_vector_store_file_id: indexed.openaiVectorStoreFileId,
            openai_index_status: "ready",
            openai_last_error: null,
            openai_indexed_at: new Date().toISOString(),
            openai_attributes: indexed.attributes,
          })
          .eq("id", snapshot.id)
      } catch (managedErr: any) {
        const managedMessage = managedErr?.message ?? String(managedErr)
        await supabase
          .from("gob_source_snapshots")
          .update({
            openai_index_status: "failed",
            openai_last_error: managedMessage,
          })
          .eq("id", snapshot.id)

        if (ragProvider === "openai") {
          throw new Error(`OpenAI indexing failed: ${managedMessage}`)
        }
      }
    }

    // Parse
    const chunks: ChunkDraft[] = []

    if (kind === "pdf") {
      const parser = new PDFParse({ data: buf })
      const text = await parser.getText()
      for (const page of text.pages ?? []) {
        const pageNumber = Number(page.num)
        const pieces = chunkText(String(page.text ?? ""))
        for (const piece of pieces) {
          chunks.push({ content: piece, page: pageNumber, section: null })
        }
      }
      await parser.destroy().catch(() => null)
    } else {
      const html = buf.toString("utf8")
      const sections = extractHtmlSections(html)
      for (const s of sections) {
        const pieces = chunkText(s.text)
        for (const piece of pieces) {
          chunks.push({ content: piece, page: null, section: s.section })
        }
      }
    }

  // Limit worst-cases
  const limited = chunks.filter((c) => c.content.length >= 40).slice(0, 240)

  if (limited.length === 0) {
    await supabase.from("gob_alerts").insert({
      workspace_id: snapshot.workspace_id,
      message:
        "Fuente sin texto extraible (posible PDF escaneado). Considera OCR opcional.",
      severity: "warning",
      metadata: { source_id: source.id, snapshot_id: snapshot.id },
    })
  }

    // Embed (for local/hybrid retrieval only)
    const embeddings: Array<string | null> = []
    if (localEmbeddingsEnabled) {
      const batchSize = 32
      for (let i = 0; i < limited.length; i += batchSize) {
        const batch = limited.slice(i, i + batchSize)
        const resp = await ai.embedMany({
          embedder: "googleai/gemini-embedding-001",
          content: batch.map((b) => b.content),
          options: { taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: 768 },
        })
        for (const e of resp as any[]) {
          const vec = (e as any).embedding as number[]
          embeddings.push(toVectorLiteral(vec))
        }
      }
    } else {
      for (let i = 0; i < limited.length; i++) embeddings.push(null)
    }

    if (embeddings.length !== limited.length) {
      throw new Error("Embedding count mismatch")
    }

    // Replace chunks for this snapshot
    await supabase.from("gob_chunks").delete().eq("snapshot_id", snapshot.id)

    const rows = limited.map((c, idx) => ({
      workspace_id: snapshot.workspace_id,
      snapshot_id: snapshot.id,
      content: c.content,
      embedding: embeddings[idx],
      source_url: sourceUrl,
      page: c.page,
      section: c.section,
      metadata: {
        kind,
        embedding_provider: localEmbeddingsEnabled ? "googleai" : "none",
      },
    }))

    const insertBatchSize = 120
    for (let i = 0; i < rows.length; i += insertBatchSize) {
      const part = rows.slice(i, i + insertBatchSize)
      const { error: insErr } = await supabase.from("gob_chunks").insert(part)
      if (insErr) throw new Error(insErr.message)
    }

    await supabase
      .from("gob_source_snapshots")
      .update({
        fetched_at: now,
        content_hash: hash,
        content_type: contentType,
        http_status: httpStatus,
        storage_path: storagePath,
        status: "ready",
        error: null,
      })
      .eq("id", snapshot.id)

    const { count } = await supabase
      .from("gob_source_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("source_id", source.id)

    await supabase
      .from("gob_sources")
      .update({
        status: "ready",
        updated_at: now,
        snapshots_count: typeof count === "number" ? count : 0,
        last_error: null,
      })
      .eq("id", source.id)

    await supabase.from("gob_audit_logs").insert({
      user_id: null,
      action: "source.ingest.completed",
      target_resource: "gob_source_snapshots",
      details: {
        workspace_id: snapshot.workspace_id,
        source_id: source.id,
        snapshot_id: snapshot.id,
        kind,
        chunks: rows.length,
        rag_provider: ragProvider,
        managed_indexing: managedIndexing,
        local_embeddings: localEmbeddingsEnabled,
      },
      timestamp: now,
    })
  } catch (err: any) {
    const message = err?.message ?? String(err)

    if (snapshot?.id) {
      await supabase
        .from("gob_source_snapshots")
        .update(
          managedIndexing
            ? {
                status: "error",
                error: message,
                openai_index_status: "failed",
                openai_last_error: message,
              }
            : { status: "error", error: message }
        )
        .eq("id", snapshot.id)
    }

    if (source?.id) {
      await supabase
        .from("gob_sources")
        .update({ status: "error", last_error: message, updated_at: now })
        .eq("id", source.id)
    }

    const ws = snapshot?.workspace_id || source?.workspace_id
    if (ws) {
      await supabase.from("gob_alerts").insert({
        workspace_id: ws,
        message: `Ingesta de fuente fallo: ${message}`,
        severity: "warning",
        metadata: {
          source_id: source?.id ?? null,
          snapshot_id: snapshot?.id ?? null,
          url: snapshot?.url ?? source?.url ?? null,
          filename: source?.filename ?? null,
        },
      })
      await supabase.from("gob_audit_logs").insert({
        user_id: null,
        action: "source.ingest.error",
        target_resource: "gob_source_snapshots",
        details: {
          workspace_id: ws,
          source_id: source?.id ?? null,
          snapshot_id: snapshot?.id ?? null,
          error: message,
        },
        timestamp: now,
      })
    }

    throw err
  }
}
