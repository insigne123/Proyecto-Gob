import "dotenv/config"

import { createAdminClient } from "../src/lib/supabase/admin"
import { create2TASessionForWorker, fetch2TACausesPage } from "../src/lib/tribunal/two-ta"

function hasFlag(name: string) {
  return process.argv.slice(2).some((arg) => String(arg).trim() === name)
}

function getArg(prefix: string) {
  const hit = process.argv.slice(2).find((arg) => String(arg).trim().startsWith(prefix))
  if (!hit) return null
  const value = String(hit).trim().slice(prefix.length).trim()
  return value || null
}

function intArg(prefix: string, fallback: number, min: number, max: number) {
  const raw = Number(getArg(prefix) || fallback)
  if (!Number.isFinite(raw)) return fallback
  return Math.max(min, Math.min(max, Math.floor(raw)))
}

function safeText(value: unknown, maxLen = 120) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > maxLen ? text.slice(0, maxLen) : text
}

function normalizeDocId(value: unknown) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return String(Math.floor(n))
}

function pick2TADocIdFromMetadata(metadata: any) {
  if (!metadata || typeof metadata !== "object") return null
  return (
    normalizeDocId((metadata as any).source_id_causa_2ta) ||
    normalizeDocId((metadata as any).id_causa_2ta) ||
    normalizeDocId((metadata as any).idCausa2TA) ||
    normalizeDocId((metadata as any).idCausa)
  )
}

async function loadPending2TARoles(supabase: any) {
  const out = new Set<string>()
  const pageSize = 1000

  for (let from = 0; from <= 30_000; from += pageSize) {
    const to = from + pageSize - 1
    const { data, error } = await supabase
      .from("gob_jobs")
      .select("payload")
      .eq("type", "tribunal_cause_sync")
      .in("status", ["pending", "running"])
      .filter("payload->>tribunal", "eq", "2TA")
      .range(from, to)

    if (error) throw new Error(error.message)
    const rows = Array.isArray(data) ? data : []

    for (const row of rows) {
      const rol = safeText((row as any)?.payload?.rol, 120)
      if (rol) out.add(rol)
    }

    if (rows.length < pageSize) break
  }

  return out
}

async function loadKnown2TARolesFromDb(supabase: any) {
  const out = new Map<string, string | null>()
  const pageSize = 1000

  for (let from = 0; from <= 30_000; from += pageSize) {
    const to = from + pageSize - 1
    const { data, error } = await supabase
      .from("gob_tribunal_cause_updates")
      .select("rol,metadata,created_at")
      .eq("tribunal", "2TA")
      .order("created_at", { ascending: false })
      .range(from, to)

    if (error) throw new Error(error.message)
    const rows = Array.isArray(data) ? data : []

    for (const row of rows) {
      const rol = safeText((row as any)?.rol, 120)
      if (!rol) continue
      const idCausa = pick2TADocIdFromMetadata((row as any)?.metadata)
      if (!out.has(rol) || (!out.get(rol) && idCausa)) {
        out.set(rol, idCausa)
      }
    }

    if (rows.length < pageSize) break
  }

  for (let from = 0; from <= 30_000; from += pageSize) {
    const to = from + pageSize - 1
    const { data, error } = await supabase
      .from("gob_estado_diario_entries")
      .select("rol,id_causa_1ta,created_at")
      .eq("tribunal", "2TA")
      .order("created_at", { ascending: false })
      .range(from, to)

    if (error) throw new Error(error.message)
    const rows = Array.isArray(data) ? data : []

    for (const row of rows) {
      const rol = safeText((row as any)?.rol, 120)
      if (!rol) continue
      const idCausa = normalizeDocId((row as any)?.id_causa_1ta)
      if (!out.has(rol) || (!out.get(rol) && idCausa)) {
        out.set(rol, idCausa)
      }
    }

    if (rows.length < pageSize) break
  }

  for (let from = 0; from <= 20_000; from += pageSize) {
    const to = from + pageSize - 1
    const { data, error } = await supabase
      .from("gob_tribunal_causes")
      .select("rol,updated_at")
      .eq("tribunal", "2TA")
      .order("updated_at", { ascending: false })
      .range(from, to)

    if (error) throw new Error(error.message)
    const rows = Array.isArray(data) ? data : []

    for (const row of rows) {
      const rol = safeText((row as any)?.rol, 120)
      if (!rol) continue
      if (!out.has(rol)) {
        out.set(rol, null)
      }
    }

    if (rows.length < pageSize) break
  }

  return out
}

async function main() {
  const supabase = createAdminClient()
  const dryRun = hasFlag("--dry-run")
  const pageSize = intArg("--page-size=", 100, 20, 300)
  const maxPages = intArg("--max-pages=", 300, 1, 1200)
  const limit = intArg("--limit=", 0, 0, 20_000)
  const maxAttempts = intArg("--max-attempts=", Number(process.env.ESTADO_DIARIO_JOB_MAX_ATTEMPTS || 5), 1, 10)

  const session = await create2TASessionForWorker()
  const causesByRol = new Map<string, string | null>()
  let resultHint = 0
  let discoverySource: "2ta_api" | "db_fallback" = "2ta_api"

  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const response = await fetch2TACausesPage({
        session,
        pageSize,
        page,
        idProcedimiento: 4,
      })

      const rows = Array.isArray(response.results) ? response.results : []
      if (!rows.length) break

      resultHint = Number(response.resultsCount || 0) || resultHint

      for (const row of rows) {
        const rol = safeText(row?.rol, 120)
        if (!rol) continue
        const idCausa = Number(row?.id)
        causesByRol.set(rol, Number.isFinite(idCausa) && idCausa > 0 ? String(Math.floor(idCausa)) : null)
      }

      const reachedHint = resultHint > 0 && page * pageSize >= resultHint
      if (reachedHint) break
    }
  } catch (remoteErr: any) {
    discoverySource = "db_fallback"
    console.warn("[backfill-2ta] API discovery failed, switching to DB fallback:", remoteErr?.message || remoteErr)
    const known = await loadKnown2TARolesFromDb(supabase)
    for (const [rol, idCausa] of known.entries()) {
      causesByRol.set(rol, idCausa)
    }
  }

  if (!causesByRol.size) {
    discoverySource = "db_fallback"
    const known = await loadKnown2TARolesFromDb(supabase)
    for (const [rol, idCausa] of known.entries()) {
      causesByRol.set(rol, idCausa)
    }
  }

  let discovered = Array.from(causesByRol.entries())
  if (limit > 0) {
    discovered = discovered.slice(0, limit)
  }

  const pendingRoles = await loadPending2TARoles(supabase)
  const nowIso = new Date().toISOString()

  const jobs = discovered
    .filter(([rol]) => !pendingRoles.has(rol))
    .map(([rol, idCausa]) => ({
      type: "tribunal_cause_sync",
      status: "pending",
      available_at: nowIso,
      attempts: 0,
      max_attempts: maxAttempts,
      payload: {
        tribunal: "2TA",
        rol,
        idCausa,
        source: "backfill-2ta-reclamacion",
      },
      created_at: nowIso,
    }))

  let inserted = 0
  if (!dryRun && jobs.length) {
    const chunkSize = 300
    for (let i = 0; i < jobs.length; i += chunkSize) {
      const chunk = jobs.slice(i, i + chunkSize)
      const { error } = await supabase.from("gob_jobs").insert(chunk)
      if (error) throw new Error(error.message)
      inserted += chunk.length
    }
  }

  console.log(
    JSON.stringify(
      {
        action: "backfill_2ta_reclamaciones",
        dryRun,
        pageSize,
        maxPages,
        limit: limit || null,
        fetchedHint: resultHint || null,
        discoverySource,
        discoveredRoles: discovered.length,
        alreadyPending: discovered.length - jobs.length,
        queued: dryRun ? jobs.length : inserted,
        sampleRoles: discovered.slice(0, 12).map(([rol, idCausa]) => ({ rol, idCausa })),
      },
      null,
      2
    )
  )
}

main().catch((err) => {
  console.error("backfill-2ta-reclamaciones failed:", err)
  process.exit(1)
})
