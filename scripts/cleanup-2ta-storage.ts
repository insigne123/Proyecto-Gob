import "dotenv/config"

import { createAdminClient } from "../src/lib/supabase/admin"

type DocRow = {
  id: string
  storage_path: string | null
  url: string | null
}

type SnapshotRow = {
  id: string
  storage_path: string | null
  url: string | null
}

function hasFlag(name: string) {
  return process.argv.slice(2).some((arg) => String(arg || "").trim() === name)
}

function intArg(prefix: string, fallback: number, min: number, max: number) {
  const raw = process.argv
    .slice(2)
    .map((arg) => String(arg || "").trim())
    .find((arg) => arg.startsWith(prefix))
  const value = Number(raw ? raw.slice(prefix.length) : fallback)
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function chunkArray<T>(arr: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

function getSourcesBucket() {
  const preferred = String(
    process.env.SUPABASE_SOURCES_BUCKET || process.env.NEXT_PUBLIC_SUPABASE_SOURCES_BUCKET || ""
  ).trim()
  return preferred || "gob_sources"
}

function normalizeStoragePath(path: string | null) {
  const clean = String(path || "").trim().replace(/^\/+/, "")
  if (!clean) return ""
  return clean.replace(/^(gob_sources|gob-sources)\//i, "")
}

function hasHttpUrl(value: string | null) {
  return /^https?:\/\//i.test(String(value || "").trim())
}

async function loadRowsByLikePattern<T>(params: {
  admin: any
  table: "gob_tribunal_documents" | "gob_source_snapshots"
  select: string
  like: string
  pageSize: number
}) {
  const out: T[] = []
  for (let from = 0; ; from += params.pageSize) {
    const to = from + params.pageSize - 1
    const { data, error } = await params.admin
      .from(params.table)
      .select(params.select)
      .like("storage_path", params.like)
      .range(from, to)

    if (error) throw new Error(`${params.table} query failed (${params.like}): ${error.message}`)
    const rows = (Array.isArray(data) ? data : []) as T[]
    if (!rows.length) break
    out.push(...rows)
    if (rows.length < params.pageSize) break
  }
  return out
}

function uniqueById<T extends { id: string }>(rows: T[]) {
  const map = new Map<string, T>()
  for (const row of rows) {
    const id = String(row.id || "").trim()
    if (!id) continue
    if (!map.has(id)) map.set(id, row)
  }
  return Array.from(map.values())
}

async function load2TADocsAndSnapshots(admin: any, pageSize: number, bucket: string) {
  const patterns = Array.from(
    new Set(["tribunal/2ta/%", `${bucket}/tribunal/2ta/%`, "gob_sources/tribunal/2ta/%", "gob-sources/tribunal/2ta/%"])
  )

  let docs: DocRow[] = []
  let snapshots: SnapshotRow[] = []

  for (const pattern of patterns) {
    const [docsPart, snapshotsPart] = await Promise.all([
      loadRowsByLikePattern<DocRow>({
        admin,
        table: "gob_tribunal_documents",
        select: "id,storage_path,url",
        like: pattern,
        pageSize,
      }),
      loadRowsByLikePattern<SnapshotRow>({
        admin,
        table: "gob_source_snapshots",
        select: "id,storage_path,url",
        like: pattern,
        pageSize,
      }),
    ])
    docs = docs.concat(docsPart)
    snapshots = snapshots.concat(snapshotsPart)
  }

  return {
    docs: uniqueById(docs),
    snapshots: uniqueById(snapshots),
  }
}

async function loadReferencedPaths(params: {
  admin: any
  normalizedPaths: string[]
  pageSize: number
  bucket: string
}) {
  const referenced = new Set<string>()

  for (const batch of chunkArray(params.normalizedPaths, params.pageSize)) {
    const aliases = Array.from(
      new Set(
        batch.flatMap((path) => [
          path,
          `${params.bucket}/${path}`,
          `gob_sources/${path}`,
          `gob-sources/${path}`,
        ])
      )
    )

    const [docsRef, snapshotsRef] = await Promise.all([
      params.admin.from("gob_tribunal_documents").select("storage_path").in("storage_path", aliases),
      params.admin.from("gob_source_snapshots").select("storage_path").in("storage_path", aliases),
    ])

    if (docsRef.error) throw new Error(`docs reference check failed: ${docsRef.error.message}`)
    if (snapshotsRef.error) throw new Error(`snapshots reference check failed: ${snapshotsRef.error.message}`)

    for (const row of (docsRef.data || []) as Array<{ storage_path?: string | null }>) {
      const normalized = normalizeStoragePath(row.storage_path || null)
      if (normalized) referenced.add(normalized)
    }
    for (const row of (snapshotsRef.data || []) as Array<{ storage_path?: string | null }>) {
      const normalized = normalizeStoragePath(row.storage_path || null)
      if (normalized) referenced.add(normalized)
    }
  }

  return referenced
}

async function main() {
  const admin = createAdminClient()
  const apply = hasFlag("--apply")
  const pageSize = intArg("--page-size=", 800, 100, 2000)
  const batchSize = intArg("--batch-size=", 200, 20, 1000)
  const bucket = getSourcesBucket()

  const loaded = await load2TADocsAndSnapshots(admin, pageSize, bucket)

  const docsWithPath = loaded.docs.filter((row) => normalizeStoragePath(row.storage_path).startsWith("tribunal/2ta/"))
  const snapshotsWithPath = loaded.snapshots.filter((row) =>
    normalizeStoragePath(row.storage_path).startsWith("tribunal/2ta/")
  )

  const docsToDetach = docsWithPath.filter((row) => hasHttpUrl(row.url))
  const snapshotsToDetach = snapshotsWithPath.filter((row) => hasHttpUrl(row.url))

  const docsMissingUrl = docsWithPath.length - docsToDetach.length
  const snapshotsMissingUrl = snapshotsWithPath.length - snapshotsToDetach.length

  const candidatePaths = Array.from(
    new Set(
      docsToDetach
        .map((row) => normalizeStoragePath(row.storage_path))
        .concat(snapshotsToDetach.map((row) => normalizeStoragePath(row.storage_path)))
        .filter((path) => path.startsWith("tribunal/2ta/"))
    )
  )

  console.log(
    JSON.stringify(
      {
        action: "cleanup_2ta_storage",
        dryRun: !apply,
        bucket,
        docsWithStoragePath: docsWithPath.length,
        snapshotsWithStoragePath: snapshotsWithPath.length,
        docsWithoutUrl: docsMissingUrl,
        snapshotsWithoutUrl: snapshotsMissingUrl,
        docsToDetach: docsToDetach.length,
        snapshotsToDetach: snapshotsToDetach.length,
        candidatePaths: candidatePaths.length,
      },
      null,
      2
    )
  )

  if (!apply) {
    console.log("Dry run complete. Re-run with --apply to detach DB references and delete files.")
    return
  }

  const nowIso = new Date().toISOString()

  for (const batch of chunkArray(
    docsToDetach.map((row) => row.id),
    batchSize
  )) {
    const { error } = await admin
      .from("gob_tribunal_documents")
      .update({ storage_path: null, updated_at: nowIso })
      .in("id", batch)
    if (error) throw new Error(`docs update failed: ${error.message}`)
  }

  for (const batch of chunkArray(
    snapshotsToDetach.map((row) => row.id),
    batchSize
  )) {
    const { error } = await admin
      .from("gob_source_snapshots")
      .update({ storage_path: null })
      .in("id", batch)
    if (error) throw new Error(`snapshots update failed: ${error.message}`)
  }

  const referenced = await loadReferencedPaths({
    admin,
    normalizedPaths: candidatePaths,
    pageSize: Math.max(100, Math.min(600, batchSize * 2)),
    bucket,
  })
  const removablePaths = candidatePaths.filter((path) => !referenced.has(path))

  let deletedBatches = 0
  for (const batch of chunkArray(removablePaths, Math.min(1000, batchSize))) {
    const { error } = await admin.storage.from(bucket).remove(batch)
    if (error) throw new Error(`storage remove failed: ${error.message}`)
    deletedBatches += 1
  }

  console.log(
    JSON.stringify(
      {
        action: "cleanup_2ta_storage.applied",
        bucket,
        detachedDocs: docsToDetach.length,
        detachedSnapshots: snapshotsToDetach.length,
        stillReferencedPaths: referenced.size,
        deletedPaths: removablePaths.length,
        deletedBatches,
      },
      null,
      2
    )
  )
}

main().catch((err) => {
  console.error("cleanup-2ta-storage failed:", err)
  process.exit(1)
})
