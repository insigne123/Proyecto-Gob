import { ingestSourceJob } from "./jobs/source-ingest"
import { excelCheckJob } from "./jobs/excel-check"
import { emailDigestJob } from "./jobs/email-digest"
import { reportGenerateJob } from "./jobs/report-generate"

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function backoffMs(attempt: number) {
  const base = 2_000
  const max = 60_000
  const n = Math.min(max, base * Math.pow(2, Math.max(0, attempt - 1)))
  return n + Math.floor(Math.random() * 400)
}

export async function handleJob(params: {
  supabase: any
  workerId: string
  job: any
}) {
  const { supabase, job } = params
  const startedAt = Date.now()

  try {
    const type = String(job.type)
    if (type === "source_ingest") {
      await ingestSourceJob({ supabase, job })
    } else if (type === "excel_check") {
      await excelCheckJob({ supabase, job })
    } else if (type === "email_digest") {
      await emailDigestJob({ supabase, job })
    } else if (type === "report_generate") {
      await reportGenerateJob({ supabase, job })
    } else {
      throw new Error(`Unknown job type: ${type}`)
    }

    await supabase
      .from("gob_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
      })
      .eq("id", job.id)
  } catch (err: any) {
    const attempts = Number(job.attempts ?? 0) + 1
    const maxAttempts = Number(job.max_attempts ?? 5)
    const fatal = attempts >= maxAttempts

    const update: any = {
      attempts,
      last_error: err?.message ?? String(err),
      locked_at: null,
      locked_by: null,
    }

    if (fatal) {
      update.status = "failed"
      update.completed_at = new Date().toISOString()
    } else {
      update.status = "pending"
      update.available_at = new Date(Date.now() + backoffMs(attempts)).toISOString()
    }

    await supabase.from("gob_jobs").update(update).eq("id", job.id)

    if (fatal) {
      const workspaceId = job.payload?.workspace_id
        ? String(job.payload.workspace_id)
        : null

      await supabase.from("gob_alerts").insert({
        workspace_id: workspaceId,
        message: `Job fallo: ${String(job.type)}`,
        severity: "critical",
        metadata: {
          job_id: job.id,
          type: job.type,
          attempts,
          last_error: update.last_error,
        },
      })

      await supabase.from("gob_audit_logs").insert({
        user_id: null,
        action: "job.failed",
        target_resource: "gob_jobs",
        details: {
          job_id: job.id,
          type: job.type,
          workspace_id: workspaceId,
        },
        timestamp: new Date().toISOString(),
      })
    }

    // small pause to avoid hot-loop on repeated errors
    await sleep(150)
  } finally {
    const ms = Date.now() - startedAt
    if (ms > 12_000) {
      // eslint-disable-next-line no-console
      console.log(`[worker] job ${job.id} (${job.type}) took ${ms}ms`)
    }
  }
}
