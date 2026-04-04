import "dotenv/config"

import { createAdminClient } from "../src/lib/supabase/admin"
import { persistSnapshotLegalGraph, refreshWorkspaceCauseSimilarityFromEntities } from "../src/lib/tribunal/graph-persistence"

function arg(name: string) {
  const inline = process.argv.find((item) => item.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1).trim()
  const idx = process.argv.findIndex((item) => item === name)
  if (idx < 0) return null
  const next = process.argv[idx + 1]
  if (!next || next.startsWith("--")) return null
  return next
}

function intArg(name: string, fallback: number, min: number, max: number) {
  const raw = Number(arg(name) || fallback)
  if (!Number.isFinite(raw)) return fallback
  return Math.max(min, Math.min(max, Math.floor(raw)))
}

function boolArg(name: string, fallback: boolean) {
  const raw = String(arg(name) || "")
    .trim()
    .toLowerCase()
  if (!raw) return fallback
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false
  return fallback
}

async function main() {
  const admin = createAdminClient()
  const workspaceId = String(arg("--workspaceId") || "").trim()
  const sourceOrigin = String(arg("--sourceOrigin") || "tribunal-corpus").trim()
  const limit = intArg("--limit", 180, 10, 4000)
  const refreshSimilarity = boolArg("--refreshSimilarity", true)

  let query = admin
    .from("gob_sources")
    .select("id,workspace_id,title,doc_type,source_origin,attributes,status")
    .eq("status", "ready")
    .order("updated_at", { ascending: false })
    .limit(limit)

  if (workspaceId) query = query.eq("workspace_id", workspaceId)
  if (sourceOrigin && sourceOrigin !== "all") query = query.eq("source_origin", sourceOrigin)

  const { data: sources, error } = await query
  if (error) throw error

  const stats = {
    sources: 0,
    snapshots: 0,
    entities: 0,
    relations: 0,
    similarities: 0,
    workspaces: new Set<string>(),
    causeIdsByWorkspace: new Map<string, Set<string>>(),
  }

  for (const source of sources || []) {
    stats.sources += 1
    const currentWorkspaceId = String((source as any)?.workspace_id || "")
    if (!currentWorkspaceId) continue
    stats.workspaces.add(currentWorkspaceId)

    const attrs = (source as any)?.attributes && typeof (source as any).attributes === "object" ? (source as any).attributes : {}

    const { data: snapshot } = await admin
      .from("gob_source_snapshots")
      .select("id,workspace_id,source_id,status")
      .eq("source_id", String((source as any)?.id || ""))
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!snapshot?.id) continue
    stats.snapshots += 1

    const { data: chunks } = await admin
      .from("gob_chunks")
      .select("content,section,page")
      .eq("snapshot_id", String(snapshot.id))
      .order("page", { ascending: true })
      .limit(80)

    const persisted = await persistSnapshotLegalGraph({
      admin,
      workspaceId: currentWorkspaceId,
      snapshotId: String(snapshot.id),
      causeId: attrs?.tribunal_cause_id ? String(attrs.tribunal_cause_id) : null,
      rol: attrs?.rol ? String(attrs.rol) : null,
      docRole: attrs?.doc_role ? String(attrs.doc_role) : null,
      title: (source as any)?.title ? String((source as any).title) : null,
      sourceKind: (source as any)?.doc_type ? String((source as any).doc_type) : null,
      chunks: Array.isArray(chunks)
        ? chunks.map((chunk: any) => ({
            content: String(chunk?.content || ""),
            section: chunk?.section ? String(chunk.section) : null,
            page: typeof chunk?.page === "number" ? chunk.page : null,
          }))
        : [],
    })

    stats.entities += persisted.entities
    stats.relations += persisted.relations

    const causeId = attrs?.tribunal_cause_id ? String(attrs.tribunal_cause_id) : ""
    if (causeId) {
      const current = stats.causeIdsByWorkspace.get(currentWorkspaceId) || new Set<string>()
      current.add(causeId)
      stats.causeIdsByWorkspace.set(currentWorkspaceId, current)
    }
  }

  if (refreshSimilarity) {
    for (const [currentWorkspaceId, causeIds] of stats.causeIdsByWorkspace.entries()) {
      const refreshed = await refreshWorkspaceCauseSimilarityFromEntities({
        admin,
        workspaceId: currentWorkspaceId,
        sourceTag: "source_ingest_refresh",
        targetCauseIds: Array.from(causeIds),
      })
      stats.similarities += refreshed.similarities
    }
  }

  console.log(
    JSON.stringify(
      {
        processedSources: stats.sources,
        processedSnapshots: stats.snapshots,
        workspaces: Array.from(stats.workspaces),
        entities: stats.entities,
        relations: stats.relations,
        similarities: stats.similarities,
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
