import "dotenv/config"

import { createAdminClient } from "../src/lib/supabase/admin"

type BucketStats = {
  files: number
  bytes: number
  newestAt: string | null
}

type StorageBucket = {
  id?: string | null
  name?: string | null
}

function hasFlag(name: string) {
  return process.argv.slice(2).some((arg) => String(arg || "").trim() === name)
}

function intArg(prefix: string, fallback: number, min: number, max: number) {
  const hit = process.argv
    .slice(2)
    .map((arg) => String(arg || "").trim())
    .find((arg) => arg.startsWith(prefix))
  const raw = Number(hit ? hit.slice(prefix.length) : fallback)
  if (!Number.isFinite(raw)) return fallback
  return Math.max(min, Math.min(max, Math.floor(raw)))
}

function toBytesFromMb(mb: number) {
  return Math.max(0, Math.floor(mb * 1024 * 1024))
}

function parseObjectSize(metadata: any) {
  const raw = metadata && typeof metadata === "object" ? metadata.size : 0
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

function pickBucketId(bucket: StorageBucket) {
  const id = String(bucket?.id || "").trim()
  if (id) return id
  return String(bucket?.name || "").trim()
}

function isFileEntry(row: any) {
  const id = String(row?.id || "").trim()
  if (id) return true
  const metadata = row?.metadata
  if (!metadata || typeof metadata !== "object") return false
  if (Number.isFinite(Number((metadata as any).size))) return true
  return Object.keys(metadata).length > 0
}

async function scanBucket(params: { admin: any; bucketId: string; pageSize: number }) {
  const { admin, bucketId, pageSize } = params
  const stats: BucketStats = {
    files: 0,
    bytes: 0,
    newestAt: null,
  }

  const queue: string[] = [""]
  const visited = new Set<string>([""])

  while (queue.length) {
    const prefix = String(queue.shift() || "")

    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await admin.storage.from(bucketId).list(prefix, {
        limit: pageSize,
        offset,
        sortBy: { column: "name", order: "asc" },
      })

      if (error) {
        throw new Error(`bucket ${bucketId}, path '${prefix || "/"}': ${error.message}`)
      }

      const rows = Array.isArray(data) ? data : []
      if (!rows.length) break

      for (const row of rows as any[]) {
        const name = String(row?.name || "").trim()
        if (!name) continue
        const childPath = prefix ? `${prefix}/${name}` : name

        if (isFileEntry(row)) {
          stats.files += 1
          stats.bytes += parseObjectSize(row?.metadata)

          const ts = String(row?.updated_at || row?.created_at || "").trim()
          if (ts && (!stats.newestAt || ts > stats.newestAt)) {
            stats.newestAt = ts
          }
        } else {
          if (!visited.has(childPath)) {
            visited.add(childPath)
            queue.push(childPath)
          }
        }
      }

      if (rows.length < pageSize) break
    }
  }

  return stats
}

function fmtBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

async function main() {
  const admin = createAdminClient()
  const pageSize = intArg("--page-size=", 1000, 100, 2000)
  const warnMb = intArg("--warn-mb=", Number(process.env.STORAGE_WARN_MB || 850), 100, 5000)
  const hardMb = intArg("--limit-mb=", Number(process.env.STORAGE_LIMIT_MB || 1024), 100, 10000)
  const failOnWarn = hasFlag("--fail-on-warn")

  const byBucket = new Map<string, BucketStats>()
  let scanned = 0

  const { data: buckets, error: bucketsErr } = await admin.storage.listBuckets()
  if (bucketsErr) throw new Error(bucketsErr.message)

  for (const bucket of (Array.isArray(buckets) ? buckets : []) as StorageBucket[]) {
    const bucketId = pickBucketId(bucket)
    if (!bucketId) continue
    const stats = await scanBucket({ admin, bucketId, pageSize: Math.min(1000, pageSize) })
    byBucket.set(bucketId, stats)
    scanned += stats.files
  }

  const totalBytes = Array.from(byBucket.values()).reduce((acc, item) => acc + item.bytes, 0)
  const warnBytes = toBytesFromMb(warnMb)
  const hardBytes = toBytesFromMb(hardMb)

  const bucketRows = Array.from(byBucket.entries())
    .map(([bucket, stats]) => ({
      bucket,
      files: stats.files,
      bytes: stats.bytes,
      size: fmtBytes(stats.bytes),
      newestAt: stats.newestAt,
    }))
    .sort((a, b) => b.bytes - a.bytes)

  const payload = {
    scannedObjects: scanned,
    totalBytes,
    totalSize: fmtBytes(totalBytes),
    warnMb,
    hardMb,
    overWarn: totalBytes >= warnBytes,
    overHardLimit: totalBytes >= hardBytes,
    buckets: bucketRows,
  }

  console.log(JSON.stringify(payload, null, 2))

  if (totalBytes >= hardBytes) {
    process.exit(2)
  }

  if (failOnWarn && totalBytes >= warnBytes) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error("check-storage-usage failed:", error)
  process.exit(1)
})
