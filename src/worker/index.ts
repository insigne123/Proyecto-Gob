import "dotenv/config"

import os from "os"

import { validateWorkerEnv } from "../lib/env"
import { createAdminClient } from "../lib/supabase/admin"
import { handleJob } from "./job-handler"

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function numEnv(name: string, fallback: number) {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
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

  const retentionJobsDays = numEnv("RETENTION_JOBS_DAYS", 30)
  const retentionExcelRunsDays = numEnv("RETENTION_EXCEL_RUNS_DAYS", 120)
  const retentionEmailRunsDays = numEnv("RETENTION_EMAIL_RUNS_DAYS", 120)
  const retentionEveryMs = numEnv("RETENTION_EVERY_MINUTES", 360) * 60_000
  let lastRetention = 0

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

    const { data: jobs, error } = await supabase.rpc("gob_claim_jobs", {
      p_worker_id: workerId,
      p_limit: 5,
    })

    if (error) {
      // eslint-disable-next-line no-console
      console.error("[worker] claim error", error)
      await sleep(1500)
      continue
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
