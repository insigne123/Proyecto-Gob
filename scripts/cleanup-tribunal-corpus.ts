import "dotenv/config"

import { createAdminClient } from "../src/lib/supabase/admin"
import { ensureTribunalCorpusWorkspace, syncTribunalCorpusDocuments } from "../src/lib/onboarding/tribunal-corpus"
import { classifyTribunalDocumentRole, isStrictTribunalKeyDocument } from "../src/lib/tribunal/document-role"

type SourceRow = {
  id: string
  url: string | null
  title: string | null
  doc_type: string | null
  attributes: Record<string, any> | null
  source_origin: string | null
  created_at: string | null
}

type TribunalDocRow = {
  id: string
  cause_id: string
  document_type: string | null
  date: string | null
  name: string | null
  storage_path: string | null
  url: string | null
}

type PlannedRemoval = {
  source: SourceRow
  reason: "missing_doc_link" | "non_key_doc" | "duplicate_role"
  role: string | null
  causeId: string | null
  docId: string | null
}

function parseArgs(argv: string[]) {
  const set = new Set(argv.map((x) => String(x || "").trim()).filter(Boolean))
  return {
    apply: set.has("--apply"),
    resync: set.has("--resync"),
  }
}

function chunkArray<T>(arr: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

function safeDateMs(value: string | null) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.getTime()
}

function sourceLabel(source: SourceRow) {
  const title = String(source.title || "").trim()
  return title || String(source.id)
}

function attrDocId(source: SourceRow) {
  const attrs = source.attributes && typeof source.attributes === "object" ? source.attributes : null
  const raw = attrs?.tribunal_document_id
  return raw ? String(raw).trim() : ""
}

async function loadAllCorpusSources(admin: any, workspaceId: string) {
  const pageSize = 1000
  let from = 0
  const out: SourceRow[] = []

  while (true) {
    const to = from + pageSize - 1
    const { data, error } = await admin
      .from("gob_sources")
      .select("id,url,title,doc_type,attributes,source_origin,created_at")
      .eq("workspace_id", workspaceId)
      .eq("source_origin", "tribunal-corpus")
      .order("created_at", { ascending: false })
      .range(from, to)

    if (error) throw new Error(error.message)
    const rows = (data || []) as any[]
    if (!rows.length) break

    out.push(
      ...rows.map((row) => ({
        id: String(row.id),
        url: row.url ? String(row.url) : null,
        title: row.title ? String(row.title) : null,
        doc_type: row.doc_type ? String(row.doc_type) : null,
        attributes: row.attributes && typeof row.attributes === "object" ? row.attributes : null,
        source_origin: row.source_origin ? String(row.source_origin) : null,
        created_at: row.created_at ? String(row.created_at) : null,
      }))
    )

    if (rows.length < pageSize) break
    from += pageSize
  }

  return out
}

async function loadDocsByIds(admin: any, ids: string[]) {
  const out = new Map<string, TribunalDocRow>()
  for (const batch of chunkArray(ids, 500)) {
    const { data, error } = await admin
      .from("gob_tribunal_documents")
      .select("id,cause_id,document_type,date,name,storage_path,url")
      .in("id", batch)
    if (error) throw new Error(error.message)
    for (const row of (data || []) as any[]) {
      out.set(String(row.id), {
        id: String(row.id),
        cause_id: String(row.cause_id),
        document_type: row.document_type ? String(row.document_type) : null,
        date: row.date ? String(row.date) : null,
        name: row.name ? String(row.name) : null,
        storage_path: row.storage_path ? String(row.storage_path) : null,
        url: row.url ? String(row.url) : null,
      })
    }
  }
  return out
}

async function countAffectedSnapshotsAndChunks(admin: any, sourceIds: string[]) {
  if (!sourceIds.length) return { snapshots: 0, chunks: 0 }

  let snapshotIds: string[] = []
  for (const batch of chunkArray(sourceIds, 400)) {
    const { data, error } = await admin
      .from("gob_source_snapshots")
      .select("id")
      .in("source_id", batch)
    if (error) throw new Error(error.message)
    snapshotIds.push(...((data || []).map((row: any) => String(row.id)) as string[]))
  }
  snapshotIds = Array.from(new Set(snapshotIds))

  let chunks = 0
  for (const batch of chunkArray(snapshotIds, 400)) {
    const { count, error } = await admin
      .from("gob_chunks")
      .select("id", { head: true, count: "exact" })
      .in("snapshot_id", batch)
    if (error) throw new Error(error.message)
    chunks += typeof count === "number" ? count : 0
  }

  return {
    snapshots: snapshotIds.length,
    chunks,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const admin = createAdminClient()
  const corpus = await ensureTribunalCorpusWorkspace(admin)

  const sources = await loadAllCorpusSources(admin, corpus.id)
  if (!sources.length) {
    console.log("No corpus sources found.")
    return
  }

  const docIds = Array.from(new Set(sources.map((source) => attrDocId(source)).filter(Boolean)))
  const docById = await loadDocsByIds(admin, docIds)

  const removals = new Map<string, PlannedRemoval>()
  const keepCandidates: Array<{
    source: SourceRow
    doc: TribunalDocRow
    role: "reclamacion" | "informe" | "sentencia"
    dateMs: number | null
  }> = []

  for (const source of sources) {
    const linkedDocId = attrDocId(source)
    const byId = linkedDocId ? docById.get(linkedDocId) || null : null
    const doc = byId

    if (!doc) {
      removals.set(source.id, {
        source,
        reason: "missing_doc_link",
        role: null,
        causeId: null,
        docId: null,
      })
      continue
    }

    const strict = isStrictTribunalKeyDocument({
      documentType: doc.document_type,
      name: doc.name,
      title: doc.document_type,
    })

    if (!strict) {
      removals.set(source.id, {
        source,
        reason: "non_key_doc",
        role: null,
        causeId: doc.cause_id,
        docId: doc.id,
      })
      continue
    }

    const role = classifyTribunalDocumentRole({
      documentType: doc.document_type,
      name: doc.name,
      title: doc.document_type,
    })

    if (role === "documento") {
      removals.set(source.id, {
        source,
        reason: "non_key_doc",
        role: null,
        causeId: doc.cause_id,
        docId: doc.id,
      })
      continue
    }

    keepCandidates.push({
      source,
      doc,
      role,
      dateMs: safeDateMs(doc.date),
    })
  }

  const byCauseRole = new Map<string, typeof keepCandidates>()
  for (const row of keepCandidates) {
    const key = `${row.doc.cause_id}:${row.role}`
    const list = byCauseRole.get(key) || []
    list.push(row)
    byCauseRole.set(key, list)
  }

  for (const [, rows] of byCauseRole.entries()) {
    if (rows.length <= 1) continue
    rows.sort((a, b) => {
      const aMs = a.dateMs ?? (a.role === "reclamacion" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY)
      const bMs = b.dateMs ?? (b.role === "reclamacion" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY)
      if (aMs !== bMs) {
        return a.role === "reclamacion" ? aMs - bMs : bMs - aMs
      }
      return String(a.source.id).localeCompare(String(b.source.id))
    })
    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i]
      removals.set(row.source.id, {
        source: row.source,
        reason: "duplicate_role",
        role: row.role,
        causeId: row.doc.cause_id,
        docId: row.doc.id,
      })
    }
  }

  const removalsList = Array.from(removals.values())
  const reasonCount = {
    missing_doc_link: removalsList.filter((x) => x.reason === "missing_doc_link").length,
    non_key_doc: removalsList.filter((x) => x.reason === "non_key_doc").length,
    duplicate_role: removalsList.filter((x) => x.reason === "duplicate_role").length,
  }

  const impacted = await countAffectedSnapshotsAndChunks(
    admin,
    removalsList.map((row) => row.source.id)
  )

  console.log(`Corpus workspace: ${corpus.title} (${corpus.id})`)
  console.log(`Total corpus sources: ${sources.length}`)
  console.log(`Planned removals: ${removalsList.length}`)
  console.log(`- missing_doc_link: ${reasonCount.missing_doc_link}`)
  console.log(`- non_key_doc: ${reasonCount.non_key_doc}`)
  console.log(`- duplicate_role: ${reasonCount.duplicate_role}`)
  console.log(`Affected snapshots (cascade): ${impacted.snapshots}`)
  console.log(`Affected chunks (cascade): ${impacted.chunks}`)

  const preview = removalsList.slice(0, 12)
  if (preview.length) {
    console.log("Preview (first 12):")
    for (const row of preview) {
      console.log(
        `- ${row.reason} | source=${row.source.id} | doc=${row.docId || "n/a"} | role=${row.role || "n/a"} | title=${sourceLabel(row.source)}`
      )
    }
  }

  if (!args.apply) {
    console.log("Dry run only. Re-run with --apply to delete.")
    return
  }

  for (const batch of chunkArray(removalsList.map((row) => row.source.id), 400)) {
    const { error } = await admin
      .from("gob_sources")
      .delete()
      .eq("workspace_id", corpus.id)
      .eq("source_origin", "tribunal-corpus")
      .in("id", batch)
    if (error) throw new Error(error.message)
  }

  console.log(`Deleted sources: ${removalsList.length}`)

  if (args.resync) {
    const sync = await syncTribunalCorpusDocuments({
      admin,
      corpusWorkspaceId: corpus.id,
      maxNewSources: 2500,
      maxRetries: 500,
    })

    console.log("Resync finished:")
    console.log(`- scannedDocuments: ${sync.scannedDocuments}`)
    console.log(`- readySnapshots: ${sync.readySnapshots}/${sync.totalSnapshots}`)
    console.log(`- newSources: ${sync.newSources}`)
    console.log(`- newSnapshots: ${sync.newSnapshots}`)
    console.log(`- retriedSnapshots: ${sync.retriedSnapshots}`)
    console.log(`- queuedJobs: ${sync.queuedJobs}`)
  }
}

main().catch((err) => {
  console.error("cleanup-tribunal-corpus failed:", err)
  process.exit(1)
})
