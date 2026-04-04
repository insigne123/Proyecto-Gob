import "dotenv/config"

import os from "os"
import dns from "node:dns/promises"

import { validateWorkerEnv } from "../lib/env"
import { createAdminClient } from "../lib/supabase/admin"
import { handleJob } from "./job-handler"
import { ensureEstadoDiarioPollJobs } from "../lib/tribunal/estado-diario-scheduler"

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function numEnv(name: string, fallback: number) {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function trimText(value: unknown) {
  return String(value || "").trim()
}

function shortError(error: any) {
  const message = trimText(error?.message || error?.details || String(error || ""))
  const code = trimText(error?.code)
  return {
    message: message.slice(0, 700),
    code: code || null,
  }
}

function claimBackoffMs(failures: number) {
  const base = 1500
  const cap = 60_000
  const exp = Math.min(6, Math.max(0, failures - 1))
  const raw = Math.min(cap, base * Math.pow(2, exp))
  return raw + Math.floor(Math.random() * 500)
}

function isoMs(value: unknown) {
  const text = trimText(value)
  if (!text) return null
  const ms = Date.parse(text)
  return Number.isFinite(ms) ? ms : null
}

async function recoverStaleRunningJobs(params: {
  supabase: any
  workerId: string
  staleMinutes: number
  staleWorkerMinutes: number
  maxJobs: number
}) {
  const { supabase, workerId, staleMinutes, staleWorkerMinutes, maxJobs } = params
  const staleCutoffMs = Date.now() - Math.max(5, staleMinutes) * 60_000
  const staleWorkerCutoffMs = Date.now() - Math.max(1, staleWorkerMinutes) * 60_000

  const { data: runningRows, error: runningErr } = await supabase
    .from("gob_jobs")
    .select("id,type,status,created_at,locked_at,locked_by,attempts,max_attempts,payload,last_error")
    .eq("status", "running")
    .order("created_at", { ascending: true })
    .limit(Math.max(10, maxJobs * 3))

  if (runningErr) {
    throw new Error(runningErr.message)
  }

  const staleRows = (runningRows || [])
    .filter(Boolean)

  const lockedByIds = Array.from(
    new Set(
      staleRows
        .map((row: any) => trimText(row?.locked_by))
        .filter(Boolean)
    )
  )

  const workerHeartbeatById = new Map<string, number | null>()
  if (lockedByIds.length) {
    const { data: workerRows, error: workerErr } = await supabase
      .from("gob_workers")
      .select("worker_id,last_seen_at")
      .in("worker_id", lockedByIds)

    if (workerErr) {
      throw new Error(workerErr.message)
    }

    for (const row of workerRows || []) {
      workerHeartbeatById.set(trimText((row as any)?.worker_id), isoMs((row as any)?.last_seen_at))
    }
  }

  const recoverableRows = staleRows
    .filter((row: any) => {
      const lockMs = isoMs(row?.locked_at)
      const createdMs = isoMs(row?.created_at)
      const baselineMs = lockMs ?? createdMs
      const lockedBy = trimText(row?.locked_by)
      const workerHeartbeatMs = lockedBy ? workerHeartbeatById.get(lockedBy) ?? null : null
      const workerMissing = Boolean(lockedBy) && !workerHeartbeatById.has(lockedBy)
      const workerStale = typeof workerHeartbeatMs === "number" && workerHeartbeatMs < staleWorkerCutoffMs

      if (lockedBy === workerId) {
        return Boolean(baselineMs && baselineMs < staleCutoffMs)
      }

      if (workerMissing || workerStale) {
        return true
      }

      if (!baselineMs) return false
      return baselineMs < staleCutoffMs
    })
    .slice(0, Math.max(1, maxJobs))

  if (!recoverableRows.length) {
    return {
      recovered: 0,
      rows: [] as any[],
    }
  }

  const nowIso = new Date().toISOString()
  const staleIds = recoverableRows.map((row: any) => String(row.id)).filter(Boolean)

  const { data: updatedRows, error: updateErr } = await supabase
    .from("gob_jobs")
    .update({
      status: "pending",
      available_at: nowIso,
      locked_at: null,
      locked_by: null,
      last_error: "Recovered stale running job lock",
    })
    .in("id", staleIds)
    .select("id,type,status,created_at,locked_at,locked_by,attempts,max_attempts,payload,last_error")

  if (updateErr) {
    throw new Error(updateErr.message)
  }

  const auditRows = recoverableRows.map((row: any) => ({
    user_id: null,
    action: "worker.job.recovered_stale_running",
    target_resource: "gob_jobs",
    details: {
      job_id: String(row.id),
      type: String(row.type || "unknown"),
      previous_locked_at: row.locked_at || null,
      previous_locked_by: row.locked_by || null,
      previous_worker_last_seen_at:
        trimText(row.locked_by) && workerHeartbeatById.has(trimText(row.locked_by))
          ? new Date(workerHeartbeatById.get(trimText(row.locked_by)) as number).toISOString()
          : null,
      previous_last_error: row.last_error || null,
      previous_attempts: Number(row.attempts || 0),
      max_attempts: Number(row.max_attempts || 0),
      worker_id: workerId,
      stale_minutes_threshold: staleMinutes,
      stale_worker_minutes_threshold: staleWorkerMinutes,
    },
    timestamp: nowIso,
  }))

  try {
    await supabase.from("gob_audit_logs").insert(auditRows)
  } catch {
    // ignore non-blocking audit write failures
  }

  return {
    recovered: Array.isArray(updatedRows) ? updatedRows.length : recoverableRows.length,
    rows: updatedRows || [],
  }
}

async function main() {
  validateWorkerEnv()

  const workerId =
    process.env.WORKER_ID || `ca-${os.hostname()}-${process.pid}`

  const supabase = createAdminClient()

  const hostname = os.hostname()
  const pid = process.pid
  const version =
    process.env.APP_VERSION ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    null

  const supabaseUrl = trimText(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)
  let supabaseHost = ""
  try {
    supabaseHost = new URL(supabaseUrl).host
  } catch {
    supabaseHost = ""
  }

  async function heartbeat() {
    const now = new Date().toISOString()
    await supabase
      .from("gob_workers")
      .upsert(
        {
          worker_id: workerId,
          last_seen_at: now,
          hostname,
          pid,
          version,
          metadata: {
            node: process.version,
            platform: process.platform,
          },
        },
        { onConflict: "worker_id" }
      )
  }

  // Best-effort heartbeat
  await heartbeat().catch(() => null)
  const hb = setInterval(() => heartbeat().catch(() => null), 30_000)

  // eslint-disable-next-line no-console
  console.log(`[worker] started: ${workerId}`)

  if (supabaseHost) {
    try {
      const resolved = await dns.lookup(supabaseHost)
      // eslint-disable-next-line no-console
      console.log(`[worker] supabase host: ${supabaseHost} (${resolved.address})`)
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn(
        `[worker] supabase DNS warning: ${supabaseHost} (${trimText(err?.code || err?.message || "lookup_failed")})`
      )
    }
  }

  const retentionJobsDays = numEnv("RETENTION_JOBS_DAYS", 30)
  const retentionExcelRunsDays = numEnv("RETENTION_EXCEL_RUNS_DAYS", 120)
  const retentionEmailRunsDays = numEnv("RETENTION_EMAIL_RUNS_DAYS", 120)
  const retentionEveryMs = numEnv("RETENTION_EVERY_MINUTES", 360) * 60_000
  const estadoSchedulerEveryMs = numEnv("ESTADO_DIARIO_SCHEDULER_EVERY_MINUTES", 30) * 60_000
  const staleRecoverEveryMs = numEnv("WORKER_RECOVER_STALE_RUNNING_EVERY_MINUTES", 15) * 60_000
  const staleRunningMinutes = numEnv("WORKER_STALE_RUNNING_MINUTES", 90)
  const staleWorkerMinutes = numEnv("WORKER_STALE_WORKER_MINUTES", 3)
  const staleRecoverMaxJobs = numEnv("WORKER_RECOVER_STALE_MAX_JOBS", 30)
  let lastRetention = 0
  let lastEstadoScheduler = 0
  let lastStaleRecovery = 0
  let claimFailures = 0
  let lastClaimErrorLogAt = 0

  try {
    await ensureEstadoDiarioPollJobs({
      supabase,
      now: new Date(),
      maxAttempts: numEnv("ESTADO_DIARIO_JOB_MAX_ATTEMPTS", 5),
    })
  } catch {
    // ignore scheduler warmup failures
  }

  try {
    const recovered = await recoverStaleRunningJobs({
      supabase,
      workerId,
      staleMinutes: staleRunningMinutes,
      staleWorkerMinutes,
      maxJobs: staleRecoverMaxJobs,
    })

    if (recovered.recovered > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[worker] recovered stale running jobs: ${recovered.recovered} (threshold ${staleRunningMinutes}m)`
      )
    }
  } catch {
    // ignore stale recovery warmup errors
  }

  while (true) {
    if (Date.now() - lastRetention > retentionEveryMs) {
      lastRetention = Date.now()
      try {
        await supabase.rpc("gob_retention_cleanup", {
          p_jobs_days: retentionJobsDays,
          p_excel_runs_days: retentionExcelRunsDays,
          p_email_runs_days: retentionEmailRunsDays,
        })
      } catch {
        // ignore
      }
    }

    if (Date.now() - lastEstadoScheduler > estadoSchedulerEveryMs) {
      lastEstadoScheduler = Date.now()
      try {
        await ensureEstadoDiarioPollJobs({
          supabase,
          now: new Date(),
          maxAttempts: numEnv("ESTADO_DIARIO_JOB_MAX_ATTEMPTS", 5),
        })
      } catch {
        // ignore scheduler errors
      }
    }

    if (Date.now() - lastStaleRecovery > staleRecoverEveryMs) {
      lastStaleRecovery = Date.now()
      try {
        const recovered = await recoverStaleRunningJobs({
          supabase,
          workerId,
          staleMinutes: staleRunningMinutes,
          staleWorkerMinutes,
          maxJobs: staleRecoverMaxJobs,
        })

        if (recovered.recovered > 0) {
          // eslint-disable-next-line no-console
          console.log(
            `[worker] recovered stale running jobs: ${recovered.recovered} (threshold ${staleRunningMinutes}m)`
          )
        }
      } catch {
        // ignore stale recovery errors
      }
    }

    const { data: jobs, error } = await supabase.rpc("gob_claim_jobs", {
      p_worker_id: workerId,
      p_limit: 5,
    })

    if (error) {
      claimFailures += 1
      const waitMs = claimBackoffMs(claimFailures)
      const now = Date.now()

      if (claimFailures === 1 || now - lastClaimErrorLogAt > 12_000) {
        // eslint-disable-next-line no-console
        console.error("[worker] claim error", {
          failures: claimFailures,
          backoff_ms: waitMs,
          ...shortError(error),
        })
        lastClaimErrorLogAt = now
      }

      await sleep(waitMs)
      continue
    }

    if (claimFailures > 0) {
      // eslint-disable-next-line no-console
      console.log(`[worker] connection recovered after ${claimFailures} claim errors`)
      claimFailures = 0
      lastClaimErrorLogAt = 0
    }

    const list = Array.isArray(jobs) ? jobs : []
    if (list.length === 0) {
      await sleep(1200)
      continue
    }

    for (const job of list) {
      await handleJob({ supabase, workerId, job }).catch(() => null)
    }
  }

  // eslint-disable-next-line no-unreachable
  clearInterval(hb)
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[worker] fatal", err)
  process.exit(1)
})
