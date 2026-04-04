import crypto from "crypto"
import path from "node:path"
import { pathToFileURL } from "url"

import { PDFParse } from "pdf-parse"
import * as cheerio from "cheerio"
import * as mammoth from "mammoth"

import { getRagProvider } from "../../lib/env"
import { toVectorLiteral } from "../../lib/pgvector"
import { embedTextWithOpenAI, embedTextsWithOpenAI } from "../../lib/rag/openai-embeddings"
import { clearRuntimeCache } from "../../lib/runtime-cache"
import { extractTribunalDocumentFact } from "../../lib/tribunal/document-facts"
import { persistSnapshotLegalGraph } from "../../lib/tribunal/graph-persistence"
import { classifyTribunalDocumentRole } from "../../lib/tribunal/document-role"
import {
  extractPdfSemanticBlocks,
  splitTextSemantically,
  topSectionLabels,
} from "../../lib/source-ingest/semantic-chunking"
import { indexSnapshotToOpenAI, shouldUseManagedIndexing } from "../../lib/rag/openai-managed"

type ChunkDraft = {
  content: string
  page: number | null
  section: string | null
}

let pdfWorkerConfigured = false

async function ensurePdfJsWorker() {
  if (pdfWorkerConfigured) return

  const workerPath = path.resolve(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs")
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as any
  const workerHref = pathToFileURL(workerPath).href

  if (pdfjs?.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerHref
  }

  pdfWorkerConfigured = true
}

const SUMMARY_STOP_WORDS = new Set([
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "y",
  "o",
  "a",
  "en",
  "por",
  "para",
  "con",
  "que",
  "como",
  "se",
  "su",
  "sus",
  "al",
  "un",
  "una",
  "es",
  "son",
  "del",
  "sobre",
  "segun",
  "segun",
  "this",
  "that",
  "from",
  "with",
])

function normalizeSummaryText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function extractTopTerms(text: string, maxTerms = 8) {
  const freq = new Map<string, number>()
  for (const token of normalizeSummaryText(text)
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

function summarizeTextForRetrieval(text: string, maxChars = 650) {
  const clean = String(text || "").replace(/\s+/g, " ").trim()
  if (!clean) return ""
  if (clean.length <= maxChars) return clean

  const sentences = clean
    .split(/(?<=[\.!?;])\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 25)

  const head = sentences.slice(0, 3).join(" ")
  if (!head) return clean.slice(0, maxChars)
  if (head.length <= maxChars) return head
  return head.slice(0, maxChars)
}

function buildDocumentContextSummary(params: {
  source: any
  kind: "pdf" | "docx" | "html"
  sourceUrl: string | null
  totalChunks: number
}) {
  const { source, kind, sourceUrl, totalChunks } = params
  const bits: string[] = []

  const title = String(source?.title || source?.filename || "").trim()
  if (title) bits.push(`title=${title.slice(0, 120)}`)
  if (source?.doc_type) bits.push(`doc_type=${String(source.doc_type).slice(0, 60)}`)
  if (source?.year) bits.push(`year=${String(source.year)}`)
  if (source?.region) bits.push(`region=${String(source.region).slice(0, 60)}`)
  if (source?.source_origin) bits.push(`origin=${String(source.source_origin).slice(0, 60)}`)
  bits.push(`kind=${kind}`)
  bits.push(`chunks=${Math.max(0, totalChunks)}`)

  if (sourceUrl) {
    const safeUrl = String(sourceUrl).trim()
    if (safeUrl) bits.push(`url=${safeUrl.slice(0, 160)}`)
  }

  return bits.join(" | ").slice(0, 420)
}

function buildChunkContextSummary(params: {
  chunk: ChunkDraft
  index: number
  total: number
  documentContext: string
}) {
  const { chunk, index, total, documentContext } = params
  const parts: string[] = []
  if (documentContext) parts.push(documentContext)
  parts.push(`chunk=${index + 1}/${Math.max(1, total)}`)
  if (typeof chunk.page === "number") parts.push(`page=${chunk.page}`)
  if (chunk.section) parts.push(`section=${String(chunk.section).slice(0, 90)}`)

  const localSummary = summarizeTextForRetrieval(chunk.content, 220)
  if (localSummary) parts.push(`summary=${localSummary}`)

  return parts.join(" | ").slice(0, 520)
}

function buildEmbeddingInput(content: string, contextSummary: string) {
  const cleanContent = String(content || "").replace(/\s+/g, " ").trim()
  if (!cleanContent) return ""
  const context = String(contextSummary || "").replace(/\s+/g, " ").trim()
  if (!context) return cleanContent

  return `Context: ${context}\n\nChunk: ${cleanContent}`
}

async function embedOneDocumentWithRetry(input: string, maxAttempts = 8) {
  return embedTextWithOpenAI(input, {
    task: "document",
    maxRetries: maxAttempts,
    batchSize: 1,
  })
}

async function upsertTribunalDocumentFact(params: {
  supabase: any
  source: any
  snapshot: any
  chunks: ChunkDraft[]
  sourceUrl: string | null
  now: string
}) {
  const attrs = params.source?.attributes && typeof params.source.attributes === "object" ? params.source.attributes : {}
  const documentId = String(attrs?.tribunal_document_id || "").trim()
  if (!documentId) return

  const documentType = params.source?.doc_type ? String(params.source.doc_type) : null
  const documentName = params.source?.title ? String(params.source.title) : params.source?.filename ? String(params.source.filename) : null
  const docRole = attrs?.doc_role
    ? String(attrs.doc_role)
    : classifyTribunalDocumentRole({
        documentType,
        name: documentName,
        title: documentType || documentName,
      })

  const content = params.chunks
    .slice(0, 24)
    .map((chunk) => [chunk.section || "", chunk.content].filter(Boolean).join("\n"))
    .join("\n\n")

  const fact = extractTribunalDocumentFact({
    documentId,
    causeId: attrs?.tribunal_cause_id ? String(attrs.tribunal_cause_id) : null,
    rol: attrs?.rol ? String(attrs.rol) : null,
    docRole,
    sourceId: params.source?.id ? String(params.source.id) : null,
    snapshotId: params.snapshot?.id ? String(params.snapshot.id) : null,
    sourceTitle: documentName,
    documentType,
    documentName,
    documentUrl: params.sourceUrl,
    content,
  })

  await params.supabase.from("gob_tribunal_document_facts").upsert(
    {
      document_id: fact.documentId,
      cause_id: fact.causeId,
      rol: fact.rol,
      doc_role: fact.docRole,
      source_id: fact.sourceId,
      snapshot_id: fact.snapshotId,
      source_title: fact.sourceTitle,
      document_type: fact.documentType,
      document_name: fact.documentName,
      document_url: fact.documentUrl,
      claimants: fact.claimants,
      fojas: fact.fojas,
      dates: fact.dates,
      cited_norms: fact.citedNorms,
      authorities: fact.authorities,
      outcome_signals: fact.outcomeSignals,
      holdings: fact.holdings,
      resolution_snippets: fact.resolutionSnippets,
      key_signals: fact.keySignals,
      metadata: {
        generated_from: "source_ingest",
      },
      updated_at: params.now,
    },
    { onConflict: "document_id" }
  )
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
  const lowerUrl = String(url || "").toLowerCase()

  if (ct.includes("pdf")) return "pdf"
  if (
    ct.includes("wordprocessingml.document") ||
    ct.includes("application/msword") ||
    lowerUrl.includes(".docx")
  ) {
    return "docx"
  }

  if (lowerUrl.includes(".pdf")) return "pdf"
  return "html"
}

function kindToExt(kind: "pdf" | "docx" | "html") {
  if (kind === "pdf") return "pdf"
  if (kind === "docx") return "docx"
  return "html"
}

function kindToContentType(kind: "pdf" | "docx" | "html") {
  if (kind === "pdf") return "application/pdf"
  if (kind === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  return "text/html"
}

function parseBoolEnv(name: string) {
  const raw = String(process.env[name] || "")
    .trim()
    .toLowerCase()
  if (!raw) return null
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false
  return null
}

function shouldPersistFetchedUrlSnapshot(sourceOrigin: string | null) {
  const forceGlobal = parseBoolEnv("SOURCE_INGEST_PERSIST_URL_SNAPSHOTS")
  if (forceGlobal !== null) return forceGlobal

  const origin = String(sourceOrigin || "")
    .trim()
    .toLowerCase()

  if (origin.startsWith("tribunal")) {
    const forceTribunal = parseBoolEnv("SOURCE_INGEST_PERSIST_TRIBUNAL_URL_SNAPSHOTS")
    if (forceTribunal !== null) return forceTribunal
    return false
  }

  return true
}

async function extractTextWithOcrSpace(buf: Buffer) {
  const apiKey = String(process.env.OCR_SPACE_API_KEY || "").trim()
  if (!apiKey) return ""

  const language = String(process.env.OCR_SPACE_LANGUAGE || "spa").trim() || "spa"
  const endpoint = String(process.env.OCR_SPACE_ENDPOINT || "https://api.ocr.space/parse/image")
    .trim()
    .replace(/\/+$/, "")

  const form = new FormData()
  form.set("language", language)
  form.set("isOverlayRequired", "false")
  form.set("scale", "true")
  form.set("OCREngine", "2")
  form.set("isTable", "false")
  form.set("file", new Blob([buf], { type: "application/pdf" }), "source.pdf")

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { apikey: apiKey },
    body: form,
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const msg = payload?.ErrorMessage || payload?.message || `OCR HTTP ${response.status}`
    throw new Error(String(msg))
  }

  if (payload?.IsErroredOnProcessing) {
    const msg = Array.isArray(payload?.ErrorMessage)
      ? payload.ErrorMessage.join(" | ")
      : payload?.ErrorMessage || "OCR processing error"
    throw new Error(String(msg))
  }

  const text = Array.isArray(payload?.ParsedResults)
    ? payload.ParsedResults.map((r: any) => String(r?.ParsedText || "")).join("\n")
    : ""

  return text.replace(/\s+/g, " ").trim()
}

export async function ingestSourceJob(params: { supabase: any; job: any }) {
  const { supabase, job } = params
  const payload = job.payload || {}
  const snapshotId = String(payload.snapshot_id || payload.snapshotId || "")
  if (!snapshotId) throw new Error("Missing snapshot_id")

  const now = new Date().toISOString()
  const ragProvider = getRagProvider()
  const requestedManagedIndexing = shouldUseManagedIndexing()
  const strictManagedIndexing =
    String(process.env.OPENAI_INDEXING_STRICT || "")
      .trim()
      .toLowerCase() === "true"
  const localEmbeddingsOverride = String(process.env.LOCAL_EMBEDDINGS_ENABLED || "")
    .trim()
    .toLowerCase()
  const requestedLocalEmbeddingsEnabled =
    localEmbeddingsOverride === ""
      ? true
      : localEmbeddingsOverride === "1" ||
          localEmbeddingsOverride === "true" ||
          localEmbeddingsOverride === "yes" ||
          localEmbeddingsOverride === "on"
  let managedIndexing = requestedManagedIndexing
  let localEmbeddingsEnabled = requestedLocalEmbeddingsEnabled
  let isFastTrackClaim = false
  let managedIndexingError: string | null = null
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
        "id,workspace_id,kind,url,filename,title,doc_type,year,region,sector,project_name,source_origin,language,attributes"
      )
      .eq("id", snapshot.source_id)
      .single()
    if (srcErr) throw new Error(srcErr.message)
    source = sourceRow

    const sourceOrigin = String(source?.source_origin || "")
      .trim()
      .toLowerCase()
    isFastTrackClaim = sourceOrigin === "onboarding-claim"
    managedIndexing = isFastTrackClaim ? false : requestedManagedIndexing
    localEmbeddingsEnabled = isFastTrackClaim ? false : requestedLocalEmbeddingsEnabled

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
      const persistFetchedSnapshot = shouldPersistFetchedUrlSnapshot(
        source?.source_origin ? String(source.source_origin) : null
      )

      if (persistFetchedSnapshot) {
        const ext = kindToExt(kind)
        storagePath = `snapshots/${snapshot.workspace_id}/${source.id}/${snapshot.id}.${ext}`

        const { error: upErr } = await supabase.storage
          .from("gob_sources")
          .upload(storagePath, buf, {
            contentType: kindToContentType(kind),
            upsert: false,
          })

        if (upErr) {
          // If upload fails, continue without storage (still keep hash + chunks)
          storagePath = null
        }
      } else {
        storagePath = null
      }
    } else {
      throw new Error("Snapshot has neither storage_path nor url")
    }

    const hash = crypto.createHash("sha256").update(buf).digest("hex")

    const kind = inferKind(contentType, snapshot.url)
    const ext = kindToExt(kind)
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
        managedIndexingError = managedMessage
        await supabase
          .from("gob_source_snapshots")
          .update({
            openai_index_status: "failed",
            openai_last_error: managedMessage,
          })
          .eq("id", snapshot.id)

        if (ragProvider === "openai" && strictManagedIndexing) {
          throw new Error(`OpenAI indexing failed: ${managedMessage}`)
        }
      }
    }

    if (managedIndexingError) {
      await supabase.from("gob_alerts").insert({
        workspace_id: snapshot.workspace_id,
        message:
          "Indexacion OpenAI no disponible; se continua con indexacion local de texto. " +
          `Detalle: ${managedIndexingError}`,
        severity: "warning",
        metadata: {
          source_id: source.id,
          snapshot_id: snapshot.id,
          rag_provider: ragProvider,
          strict_mode: strictManagedIndexing,
        },
      })
    }

    // Parse
    const chunks: ChunkDraft[] = []

    if (kind === "pdf") {
      await ensurePdfJsWorker()
      const parser = new PDFParse({ data: buf })
      const text = await parser.getText()
      for (const page of text.pages ?? []) {
        const pageNumber = Number(page.num)
        const semanticBlocks = extractPdfSemanticBlocks(String(page.text ?? ""), pageNumber)
        for (const block of semanticBlocks) {
          const pieces = splitTextSemantically(block.text, { maxChars: 1100, overlap: 140 })
          for (const piece of pieces) {
            chunks.push({ content: piece, page: block.page, section: block.section })
          }
        }
      }
      await parser.destroy().catch(() => null)
    } else if (kind === "docx") {
      const [extractedHtml, extractedText] = await Promise.all([
        mammoth.convertToHtml({ buffer: buf }),
        mammoth.extractRawText({ buffer: buf }),
      ])
      const htmlSections = extractHtmlSections(String(extractedHtml.value || ""))
      if (htmlSections.length) {
        for (const section of htmlSections) {
          const pieces = splitTextSemantically(section.text, { maxChars: 1050, overlap: 140 })
          for (const piece of pieces) {
            chunks.push({
              content: piece,
              page: null,
              section: section.section ? `docx | ${String(section.section).slice(0, 140)}` : "docx",
            })
          }
        }
      } else {
        const raw = String(extractedText.value || "").replace(/\r/g, "")
        const units = splitTextSemantically(raw, { maxChars: 1050, overlap: 140 })
        for (const unit of units) {
          chunks.push({ content: unit, page: null, section: "docx" })
        }
      }
    } else {
      const html = buf.toString("utf8")
      const sections = extractHtmlSections(html)
      for (const s of sections) {
        const pieces = splitTextSemantically(s.text, { maxChars: 1100, overlap: 140 })
        for (const piece of pieces) {
          chunks.push({ content: piece, page: null, section: s.section })
        }
      }
    }

    // Limit worst-cases
    const dedupedChunks = new Map<string, ChunkDraft>()
    for (const chunk of chunks) {
      const cleanContent = String(chunk.content || "").replace(/\s+/g, " ").trim()
      if (cleanContent.length < 40) continue
      const dedupeKey = `${chunk.page || "-"}|${String(chunk.section || "").trim()}|${cleanContent.toLowerCase()}`
      if (dedupedChunks.has(dedupeKey)) continue
      dedupedChunks.set(dedupeKey, {
        content: cleanContent,
        page: chunk.page,
        section: chunk.section ? String(chunk.section).trim().slice(0, 180) : null,
      })
    }

    let limited = Array.from(dedupedChunks.values()).slice(0, 240)

    if (limited.length === 0 && kind === "pdf") {
      try {
        const ocrText = await extractTextWithOcrSpace(buf)
        if (ocrText) {
          const ocrPieces = splitTextSemantically(ocrText, { maxChars: 1100, overlap: 160 })
          limited = ocrPieces
            .map((piece: string) => ({ content: piece, page: null, section: "ocr" }))
            .filter((c: ChunkDraft) => c.content.length >= 40)
            .slice(0, 240)

          await supabase.from("gob_alerts").insert({
            workspace_id: snapshot.workspace_id,
            message: "OCR aplicado a PDF escaneado para extraer texto util.",
            severity: "info",
            metadata: { source_id: source.id, snapshot_id: snapshot.id },
          })
        }
      } catch (ocrErr: any) {
        await supabase.from("gob_alerts").insert({
          workspace_id: snapshot.workspace_id,
          message: `OCR no disponible o fallo: ${ocrErr?.message ?? String(ocrErr)}`,
          severity: "warning",
          metadata: { source_id: source.id, snapshot_id: snapshot.id },
        })
      }
    }

    if (limited.length === 0) {
      await supabase.from("gob_alerts").insert({
        workspace_id: snapshot.workspace_id,
        message:
          "Fuente sin texto extraible (posible PDF escaneado). Considera OCR opcional.",
        severity: "warning",
        metadata: { source_id: source.id, snapshot_id: snapshot.id },
      })
    }

    const sectionLabels = topSectionLabels(limited, 10)
    const documentRawText = limited.map((c) => c.content).join(" ")
    const documentSummary = summarizeTextForRetrieval(documentRawText, 780)
    const documentTerms = extractTopTerms(documentRawText, 12)
    const documentContext = buildDocumentContextSummary({
      source,
      kind,
      sourceUrl,
      totalChunks: limited.length,
    })

    const chunkContextSummaries = limited.map((chunk, idx) =>
      buildChunkContextSummary({
        chunk,
        index: idx,
        total: limited.length,
        documentContext,
      })
    )
    const chunkTerms = limited.map((chunk) => extractTopTerms(chunk.content, 6))
    const embeddingInputs = limited.map((chunk, idx) =>
      buildEmbeddingInput(chunk.content, chunkContextSummaries[idx])
    )

    // Embed (for local/hybrid retrieval only)
    const embeddings: Array<string | null> = []
    if (localEmbeddingsEnabled) {
      const batchSize = 32
      for (let i = 0; i < limited.length; i += batchSize) {
        const batch = limited.slice(i, i + batchSize)
        const batchInput = batch.map((_b, j) => embeddingInputs[i + j] || batch[j].content)
        const vectors = await embedTextsWithOpenAI(batchInput, {
          task: "document",
          maxRetries: 4,
          batchSize,
        }).catch(async () => {
          const fallback: number[][] = []
          for (const input of batchInput) {
            fallback.push(await embedOneDocumentWithRetry(input, 8))
          }
          return fallback
        })

        for (const vec of vectors) {
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
        embedding_provider: localEmbeddingsEnabled ? "openai" : "none",
        context_summary: chunkContextSummaries[idx],
        key_terms: chunkTerms[idx],
        chunk_index: idx + 1,
        chunk_total: limited.length,
        semantic_chunking_version: 2,
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

    const sourceAttributesBase =
      source?.attributes && typeof source.attributes === "object" ? source.attributes : {}
    const sourceAttributes = {
      ...(sourceAttributesBase as Record<string, unknown>),
      retrieval_document_context: documentContext || null,
      retrieval_document_summary: documentSummary || null,
      retrieval_document_terms: documentTerms,
      retrieval_section_labels: sectionLabels,
      retrieval_document_kind: kind,
      retrieval_chunking_strategy: kind === "html" ? "html_section_v2" : "semantic_v2",
      retrieval_chunk_total: rows.length,
      retrieval_last_ingested_at: now,
    }

    const fallbackTitle = String(snapshot?.title || inferredFilename || "").trim().slice(0, 200)
    const safeTitle =
      String(source?.title || "").trim().slice(0, 200) ||
      (fallbackTitle ? fallbackTitle : null)

    await supabase
      .from("gob_sources")
      .update({
        status: "ready",
        updated_at: now,
        snapshots_count: typeof count === "number" ? count : 0,
        last_error: null,
        title: safeTitle,
        attributes: sourceAttributes,
      })
      .eq("id", source.id)

    await upsertTribunalDocumentFact({
      supabase,
      source,
      snapshot,
      chunks: limited,
      sourceUrl,
      now,
    }).catch(() => null)

    const sourceAttrs = source?.attributes && typeof source.attributes === "object" ? source.attributes : {}
    await persistSnapshotLegalGraph({
      admin: supabase,
      workspaceId: String(snapshot.workspace_id),
      snapshotId: String(snapshot.id),
      causeId: sourceAttrs?.tribunal_cause_id ? String(sourceAttrs.tribunal_cause_id) : null,
      rol: sourceAttrs?.rol ? String(sourceAttrs.rol) : null,
      docRole: sourceAttrs?.doc_role
        ? String(sourceAttrs.doc_role)
        : classifyTribunalDocumentRole({
            documentType: source?.doc_type ? String(source.doc_type) : null,
            name: safeTitle,
            title: source?.doc_type ? String(source.doc_type) : safeTitle,
          }),
      title: safeTitle,
      sourceKind: kind,
      chunks: limited,
    }).catch(() => null)

    await Promise.all([
      clearRuntimeCache("chat-local-retrieval"),
      clearRuntimeCache("tribunal-facts"),
      clearRuntimeCache("rag-feedback-signals"),
    ]).catch(() => null)

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
        fast_track_claim: isFastTrackClaim,
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
