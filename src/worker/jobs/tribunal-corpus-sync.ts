import {
  ensureTribunalCorpusWorkspace,
  syncTribunalCorpusDocuments,
} from "../../lib/onboarding/tribunal-corpus"

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function intEnv(name: string, fallback: number, min: number, max: number) {
  const raw = Number(process.env[name] || fallback)
  if (!Number.isFinite(raw)) return fallback
  return Math.max(min, Math.min(max, Math.floor(raw)))
}

function isTransientCorpusSyncError(error: unknown) {
  const message = String((error as any)?.message || error || "")
    .trim()
    .toLowerCase()

  if (!message) return false

  const transientSignals = [
    "fetch failed",
    "network",
    "timeout",
    "timed out",
    "etimedout",
    "econnreset",
    "econnrefused",
    "enotfound",
    "429",
    "rate limit",
    "temporarily unavailable",
    "temporary",
    "socket hang up",
  ]

  return transientSignals.some((signal) => message.includes(signal))
}

function retryBackoffMs(attempt: number, baseMs: number, maxMs: number) {
  const exp = Math.max(0, attempt - 1)
  const raw = Math.min(maxMs, baseMs * Math.pow(2, Math.min(6, exp)))
  return raw + Math.floor(Math.random() * 500)
}

async function safeAuditLog(params: {
  supabase: any
  action: string
  details: Record<string, any>
  timestamp?: string
}) {
  try {
    await params.supabase.from("gob_audit_logs").insert({
      user_id: null,
      action: params.action,
      target_resource: "gob_sources",
      details: params.details,
      timestamp: params.timestamp || new Date().toISOString(),
    })
  } catch {
    // ignore non-blocking audit failures
  }
}

export async function tribunalCorpusSyncJob(params: { supabase: any; job: any }) {
  const { supabase, job } = params
  const nowIso = new Date().toISOString()

  const maxNewSources = intEnv("TRIBUNAL_CORPUS_SYNC_MAX_NEW", 260, 20, 3000)
  const maxRetries = intEnv("TRIBUNAL_CORPUS_SYNC_MAX_RETRIES", 80, 0, 1000)
  const internalRetries = intEnv("TRIBUNAL_CORPUS_SYNC_INTERNAL_RETRIES", 3, 1, 8)
  const retryBaseMs = intEnv("TRIBUNAL_CORPUS_SYNC_RETRY_BASE_MS", 5000, 500, 120000)
  const retryMaxMs = intEnv("TRIBUNAL_CORPUS_SYNC_RETRY_MAX_MS", 45000, 2000, 300000)

  const source = String(job.payload?.source || "job")
  const date = String(job.payload?.date || "") || null
  const tribunal = String(job.payload?.tribunal || "1TA") || "1TA"

  await safeAuditLog({
    supabase,
    action: "tribunal.corpus_sync.start",
    details: {
      source,
      date,
      tribunal,
      max_new_sources: maxNewSources,
      max_retries: maxRetries,
      internal_retries: internalRetries,
      job_attempt: Number(job.attempts || 0) + 1,
      job_max_attempts: Number(job.max_attempts || 0),
    },
    timestamp: nowIso,
  })

  try {
    const startedAt = Date.now()
    const corpus = await ensureTribunalCorpusWorkspace(supabase)

    let stats: Awaited<ReturnType<typeof syncTribunalCorpusDocuments>> | null = null
    let syncError: unknown = null
    let attemptsUsed = 0

    for (let attempt = 1; attempt <= internalRetries; attempt += 1) {
      attemptsUsed = attempt
      try {
        stats = await syncTribunalCorpusDocuments({
          admin: supabase,
          corpusWorkspaceId: corpus.id,
          maxNewSources,
          maxRetries,
        })

        if (attempt > 1) {
          await safeAuditLog({
            supabase,
            action: "tribunal.corpus_sync.retry.ok",
            details: {
              source,
              date,
              tribunal,
              attempt,
              internal_retries: internalRetries,
            },
          })
        }

        break
      } catch (err: any) {
        syncError = err
        const transient = isTransientCorpusSyncError(err)
        const canRetry = transient && attempt < internalRetries

        await safeAuditLog({
          supabase,
          action: canRetry ? "tribunal.corpus_sync.retry.scheduled" : "tribunal.corpus_sync.retry.exhausted",
          details: {
            source,
            date,
            tribunal,
            attempt,
            internal_retries: internalRetries,
            transient,
            error: String(err?.message || err || "").slice(0, 800),
          },
        })

        if (!canRetry) break

        const waitMs = retryBackoffMs(attempt, retryBaseMs, retryMaxMs)
        await sleep(waitMs)
      }
    }

    if (!stats) {
      throw syncError || new Error("tribunal corpus sync failed")
    }

    const refreshProfiles =
      String(process.env.ONBOARDING_PROFILE_REFRESH_ENABLED || "")
        .trim()
        .toLowerCase() !== "false"

    if (refreshProfiles) {
      await supabase.from("gob_jobs").insert({
        type: "onboarding_defense_refresh",
        status: "pending",
        available_at: new Date().toISOString(),
        attempts: 0,
        max_attempts: 5,
        payload: {
          workspace_id: corpus.id,
          source: "tribunal_corpus_sync",
        },
        created_at: new Date().toISOString(),
      })
    }

    await safeAuditLog({
      supabase,
      action: "tribunal.corpus_sync.ok",
      details: {
        source,
        date,
        tribunal,
        corpus_workspace_id: corpus.id,
        scanned_documents: stats.scannedDocuments,
        new_sources: stats.newSources,
        new_snapshots: stats.newSnapshots,
        retried_snapshots: stats.retriedSnapshots,
        queued_jobs: stats.queuedJobs,
        queued_onboarding_refresh: refreshProfiles,
        ready_snapshots: stats.readySnapshots,
        total_snapshots: stats.totalSnapshots,
        internal_attempts_used: attemptsUsed,
        duration_ms: Date.now() - startedAt,
      },
    })
  } catch (err: any) {
    await safeAuditLog({
      supabase,
      action: "tribunal.corpus_sync.error",
      details: {
        source,
        date,
        tribunal,
        error: String(err?.message || err || "").slice(0, 1200),
        internal_retries: internalRetries,
        job_attempt: Number(job.attempts || 0) + 1,
        job_max_attempts: Number(job.max_attempts || 0),
      },
    })

    throw err
  }
}
