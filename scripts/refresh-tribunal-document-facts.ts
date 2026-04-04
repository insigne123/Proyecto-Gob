import "dotenv/config"

import { createClient } from "@supabase/supabase-js"

import { extractTribunalDocumentFact } from "@/lib/tribunal/document-facts"
import { classifyTribunalDocumentRole } from "@/lib/tribunal/document-role"

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "")
    if (!token.startsWith("--")) continue
    const key = token.slice(2)
    const next = String(argv[i + 1] || "")
    if (!next || next.startsWith("--")) {
      out[key] = "true"
      continue
    }
    out[key] = next
    i += 1
  }
  return out
}

function uniqueStrings(values: string[], max = 8) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = String(value || "").trim()
    if (!clean || seen.has(clean.toLowerCase())) continue
    seen.add(clean.toLowerCase())
    out.push(clean)
    if (out.length >= max) break
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const limit = Math.max(20, Math.min(4000, Number(args.limit || 800)))
  const pageSize = Math.max(50, Math.min(250, Number(args.pageSize || 150)))

  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing Supabase env vars")
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  let scannedSources = 0
  let readySnapshots = 0
  let generatedFacts = 0
  let upserted = 0

  for (let offset = 0; offset < limit; offset += pageSize) {
    const pageEnd = Math.min(limit - 1, offset + pageSize - 1)
    const { data: sources, error: sourceErr } = await admin
      .from("gob_sources")
      .select("id,title,doc_type,attributes,url")
      .eq("source_origin", "tribunal-corpus")
      .order("id", { ascending: true })
      .range(offset, pageEnd)

    if (sourceErr) throw sourceErr
    if (!Array.isArray(sources) || !sources.length) break
    scannedSources += sources.length

    const sourceIds = Array.from(new Set(sources.map((row: any) => String(row.id)).filter(Boolean)))
    const { data: snapshots, error: snapshotErr } = await admin
      .from("gob_source_snapshots")
      .select("id,source_id,status")
      .in("source_id", sourceIds)
      .eq("status", "ready")
      .order("created_at", { ascending: false })

    if (snapshotErr) throw snapshotErr

    const snapshotBySourceId = new Map<string, string>()
    for (const row of snapshots || []) {
      const sourceId = String((row as any)?.source_id || "")
      if (sourceId && !snapshotBySourceId.has(sourceId)) {
        snapshotBySourceId.set(sourceId, String((row as any)?.id || ""))
      }
    }

    const snapshotIds = Array.from(snapshotBySourceId.values()).filter(Boolean)
    readySnapshots += snapshotIds.length
    if (!snapshotIds.length) continue

    const chunksBySnapshot = new Map<string, Array<{ content: string; section: string | null }>>()
    for (let chunkOffset = 0; chunkOffset < snapshotIds.length; chunkOffset += 40) {
      const chunkSlice = snapshotIds.slice(chunkOffset, chunkOffset + 40)
      const { data: chunks, error: chunkErr } = await admin
        .from("gob_chunks")
        .select("snapshot_id,content,section")
        .in("snapshot_id", chunkSlice)
        .limit(Math.max(400, Math.min(5000, chunkSlice.length * 32)))

      if (chunkErr) throw chunkErr

      for (const row of chunks || []) {
        const snapshotId = String((row as any)?.snapshot_id || "")
        if (!snapshotId) continue
        const list = chunksBySnapshot.get(snapshotId) || []
        list.push({
          content: String((row as any)?.content || ""),
          section: (row as any)?.section ? String((row as any).section) : null,
        })
        chunksBySnapshot.set(snapshotId, list)
      }
    }

    const batch: any[] = []
    for (const source of sources) {
      const sourceId = String((source as any)?.id || "")
      const snapshotId = snapshotBySourceId.get(sourceId) || ""
      if (!snapshotId) continue
      const attrs = (source as any)?.attributes && typeof (source as any).attributes === "object" ? (source as any).attributes : {}
      const docRole = attrs?.doc_role
        ? String(attrs.doc_role)
        : classifyTribunalDocumentRole({
            documentType: (source as any)?.doc_type ? String((source as any).doc_type) : null,
            name: (source as any)?.title ? String((source as any).title) : null,
            title: (source as any)?.doc_type ? String((source as any).doc_type) : (source as any)?.title ? String((source as any).title) : null,
          })
      const text = (chunksBySnapshot.get(snapshotId) || [])
        .slice(0, 24)
        .map((row) => [row.section || "", row.content].filter(Boolean).join("\n"))
        .join("\n\n")
      const fact = extractTribunalDocumentFact({
        documentId: attrs?.tribunal_document_id ? String(attrs.tribunal_document_id) : null,
        causeId: attrs?.tribunal_cause_id ? String(attrs.tribunal_cause_id) : null,
        rol: attrs?.rol ? String(attrs.rol) : null,
        docRole,
        sourceId,
        snapshotId,
        sourceTitle: (source as any)?.title ? String((source as any).title) : null,
        documentType: (source as any)?.doc_type ? String((source as any).doc_type) : null,
        documentName: (source as any)?.title ? String((source as any).title) : null,
        documentUrl: (source as any)?.url ? String((source as any).url) : null,
        content: text,
      })
      const documentId = String(fact.documentId || "")
      if (!documentId) continue
      batch.push({
        document_id: documentId,
        cause_id: fact.causeId,
        rol: fact.rol,
        doc_role: fact.docRole,
        source_id: fact.sourceId,
        snapshot_id: fact.snapshotId,
        source_title: fact.sourceTitle,
        document_type: fact.documentType,
        document_name: fact.documentName,
        document_url: fact.documentUrl,
        claimants: uniqueStrings(fact.claimants, 8),
        fojas: uniqueStrings(fact.fojas, 8),
        dates: uniqueStrings(fact.dates, 8),
        cited_norms: uniqueStrings(fact.citedNorms, 8),
        authorities: uniqueStrings(fact.authorities, 6),
        outcome_signals: uniqueStrings(fact.outcomeSignals, 5),
        holdings: uniqueStrings(fact.holdings, 5),
        resolution_snippets: uniqueStrings(fact.resolutionSnippets, 6),
        key_signals: uniqueStrings(fact.keySignals, 8),
        metadata: {
          generated_from: "tribunal-corpus",
        },
        updated_at: new Date().toISOString(),
      })
    }

    generatedFacts += batch.length
    for (let index = 0; index < batch.length; index += 200) {
      const slice = batch.slice(index, index + 200)
      const { error } = await admin.from("gob_tribunal_document_facts").upsert(slice, { onConflict: "document_id" })
      if (error) throw error
      upserted += slice.length
    }
  }

  console.log(
    JSON.stringify(
      {
        scannedSources,
        readySnapshots,
        generatedFacts,
        upserted,
      },
      null,
      2
    )
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
