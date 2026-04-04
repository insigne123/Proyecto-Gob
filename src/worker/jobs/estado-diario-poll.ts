import {
  chileDateIso,
  chileHour,
  fetchEstadoDiarioEntries,
  fetchEstadoDiarioIsSigned,
  hashEstadoEntries,
  type EstadoDiarioEntry,
} from "../../lib/tribunal/estado-diario"
import { ensureEstadoDiarioPollJobs } from "../../lib/tribunal/estado-diario-scheduler"
import { fetch2TAEstadoDiarioEntries } from "../../lib/tribunal/two-ta"

type DiarioChange = {
  rol: string
  idCausa: string | null
  caratula: string | null
  before: number | null
  after: number
  kind: "new_rol" | "providencias_up" | "providencias_down"
}

function safeDate(value: unknown) {
  const text = String(value || "").trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  return null
}

function intEnv(name: string, fallback: number, min: number, max: number) {
  const raw = Number(process.env[name] || fallback)
  if (!Number.isFinite(raw)) return fallback
  return Math.max(min, Math.min(max, Math.floor(raw)))
}

function isDuplicateRunHashError(error: any) {
  const message = String(error?.message || "").toLowerCase()
  return message.includes("gob_estado_diario_runs_unique_hash_idx")
}

async function loadLatestRunForDate(params: { supabase: any; tribunal: string; date: string }) {
  const { supabase, tribunal, date } = params
  const { data, error } = await supabase
    .from("gob_estado_diario_runs")
    .select("id,hash,fetched_at,entry_count,status")
    .eq("tribunal", tribunal)
    .eq("daily_date", date)
    .eq("status", "ok")
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data || null
}

async function loadEntriesByRunId(params: { supabase: any; runId: string }) {
  const { supabase, runId } = params
  const { data, error } = await supabase
    .from("gob_estado_diario_entries")
    .select("rol,id_causa_1ta,caratula,providencias")
    .eq("run_id", runId)
    .limit(2000)

  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data : []
}

function computeChanges(params: {
  currentEntries: EstadoDiarioEntry[]
  previousEntries: Array<{ rol: string; id_causa_1ta: string | null; caratula: string | null; providencias: number }>
}) {
  const previousByRol = new Map<
    string,
    { idCausa: string | null; caratula: string | null; providencias: number }
  >()

  for (const row of params.previousEntries) {
    const rol = String(row.rol || "").trim()
    if (!rol || previousByRol.has(rol)) continue
    previousByRol.set(rol, {
      idCausa: row.id_causa_1ta ? String(row.id_causa_1ta) : null,
      caratula: row.caratula ? String(row.caratula) : null,
      providencias: Number(row.providencias || 0),
    })
  }

  const out: DiarioChange[] = []
  for (const row of params.currentEntries) {
    const previous = previousByRol.get(row.rol)
    if (!previous) {
      out.push({
        rol: row.rol,
        idCausa: row.idCausa,
        caratula: row.caratula,
        before: null,
        after: row.providencias,
        kind: "new_rol",
      })
      continue
    }

    if (row.providencias > previous.providencias) {
      out.push({
        rol: row.rol,
        idCausa: row.idCausa || previous.idCausa,
        caratula: row.caratula || previous.caratula,
        before: previous.providencias,
        after: row.providencias,
        kind: "providencias_up",
      })
      continue
    }

    if (row.providencias < previous.providencias) {
      out.push({
        rol: row.rol,
        idCausa: row.idCausa || previous.idCausa,
        caratula: row.caratula || previous.caratula,
        before: previous.providencias,
        after: row.providencias,
        kind: "providencias_down",
      })
    }
  }

  return out
}

async function hasPendingJobForDate(params: { supabase: any; type: string; date: string }) {
  const { supabase, type, date } = params
  const { data, error } = await supabase
    .from("gob_jobs")
    .select("id")
    .eq("type", type)
    .in("status", ["pending", "running"])
    .filter("payload->>date", "eq", date)
    .limit(1)

  if (error) throw new Error(error.message)
  return Array.isArray(data) && data.length > 0
}

async function hasPendingJobByType(params: { supabase: any; type: string }) {
  const { supabase, type } = params
  const { data, error } = await supabase
    .from("gob_jobs")
    .select("id")
    .eq("type", type)
    .in("status", ["pending", "running"])
    .limit(1)

  if (error) throw new Error(error.message)
  return Array.isArray(data) && data.length > 0
}

export async function estadoDiarioPollJob(params: { supabase: any; job: any }) {
  const { supabase, job } = params
  const now = new Date()
  const nowIso = now.toISOString()

  const tribunal = String(job.payload?.tribunal || "1TA").trim() || "1TA"
  const slot = String(job.payload?.slot || "").trim()
  const dateFromPayload = safeDate(job.payload?.date)
  const targetDate = dateFromPayload || chileDateIso(now)

  const causeSyncLimit = intEnv("ESTADO_DIARIO_CAUSE_SYNC_LIMIT", 140, 10, 600)
  const corpusSyncDelaySeconds = intEnv("ESTADO_DIARIO_CORPUS_SYNC_DELAY_SECONDS", 90, 10, 1200)
  const maxAttempts = intEnv("ESTADO_DIARIO_JOB_MAX_ATTEMPTS", 5, 1, 10)
  const corpusSyncJobMaxAttempts = intEnv(
    "ESTADO_DIARIO_CORPUS_SYNC_JOB_MAX_ATTEMPTS",
    Math.max(8, maxAttempts),
    1,
    20
  )

  try {
    await supabase.from("gob_audit_logs").insert({
      user_id: null,
      action: "estado_diario.poll.start",
      target_resource: "gob_estado_diario_runs",
      details: {
        job_id: String(job.id || ""),
        tribunal,
        daily_date: targetDate,
        slot: slot || null,
        source: String(job.payload?.source || "job").trim() || "job",
        attempt: Number(job.attempts || 0) + 1,
        max_attempts: Number(job.max_attempts || 0),
      },
      timestamp: nowIso,
    })
  } catch {
    // ignore non-blocking audit logging errors
  }

  try {
    const [entries, isSigned, previousRun] = await Promise.all([
      tribunal === "2TA"
        ? fetch2TAEstadoDiarioEntries({ date: targetDate })
        : fetchEstadoDiarioEntries({ date: targetDate }),
      tribunal === "2TA" ? Promise.resolve(null) : fetchEstadoDiarioIsSigned({ date: targetDate }),
      loadLatestRunForDate({ supabase, tribunal, date: targetDate }),
    ])

    const currentHash = hashEstadoEntries(entries)

    const { data: insertedRun, error: insertRunErr } = await supabase
      .from("gob_estado_diario_runs")
      .insert({
        tribunal,
        daily_date: targetDate,
        fetched_at: nowIso,
        status: "ok",
        is_signed: isSigned,
        entry_count: entries.length,
        hash: currentHash,
        error: null,
        metadata: {
          slot: slot || null,
          source: String(job.payload?.source || "job").trim() || "job",
          previous_run_id: previousRun?.id ? String(previousRun.id) : null,
        },
      })
      .select("id")
      .single()

    if (insertRunErr || !insertedRun?.id) {
      if (insertRunErr && isDuplicateRunHashError(insertRunErr)) {
        await supabase.from("gob_audit_logs").insert({
          user_id: null,
          action: "estado_diario.poll.duplicate_hash",
          target_resource: "gob_estado_diario_runs",
          details: {
            tribunal,
            daily_date: targetDate,
            slot: slot || null,
            hash: currentHash,
          },
          timestamp: nowIso,
        })
        return
      }

      throw new Error(insertRunErr?.message || "Could not insert estado diario run")
    }

    const runId = String(insertedRun.id)

    if (entries.length) {
      const rows = entries.map((row) => ({
        run_id: runId,
        tribunal,
        daily_date: targetDate,
        line_no: row.lineNo,
        rol: row.rol,
        id_causa_1ta: row.idCausa,
        caratula: row.caratula,
        tipo: row.tipo,
        providencias: row.providencias,
        providencias_palabras: row.providenciasEnPalabras,
        rol_palabras: row.rolEnPalabras,
        is_digital: row.isDigital,
        created_at: nowIso,
      }))

      const { error: insertEntriesErr } = await supabase.from("gob_estado_diario_entries").insert(rows)
      if (insertEntriesErr) throw new Error(insertEntriesErr.message)
    }

    let changes: DiarioChange[] = []
    if (previousRun?.id && String(previousRun.hash || "") === currentHash) {
      changes = []
    } else {
      const previousEntries = previousRun?.id
        ? await loadEntriesByRunId({ supabase, runId: String(previousRun.id) })
        : []
      changes = computeChanges({ currentEntries: entries, previousEntries: previousEntries as any })
    }

    if (changes.length) {
      const changeRows = changes.map((change) => ({
        run_id: runId,
        tribunal,
        daily_date: targetDate,
        rol: change.rol,
        id_causa_1ta: change.idCausa,
        caratula: change.caratula,
        change_kind: change.kind,
        providencias_before: change.before,
        providencias_after: change.after,
        created_at: nowIso,
      }))
      const { error: insertChangesErr } = await supabase.from("gob_estado_diario_changes").insert(changeRows)
      if (insertChangesErr) throw new Error(insertChangesErr.message)
    }

    const syncTargets = changes.slice(0, causeSyncLimit)
    if (syncTargets.length) {
      const jobs = syncTargets.map((change) => ({
        type: "tribunal_cause_sync",
        status: "pending",
        available_at: nowIso,
        attempts: 0,
        max_attempts: maxAttempts,
        payload: {
          tribunal,
          rol: change.rol,
          idCausa: change.idCausa,
          date: targetDate,
          changeKind: change.kind,
          providenciasBefore: change.before,
          providenciasAfter: change.after,
        },
        created_at: nowIso,
      }))

      const { error: enqueueSyncErr } = await supabase.from("gob_jobs").insert(jobs)
      if (enqueueSyncErr) throw new Error(enqueueSyncErr.message)
    }

    let queuedCorpusSync = false
    if (syncTargets.length) {
      const hasCorpusSync = await hasPendingJobByType({ supabase, type: "tribunal_corpus_sync" })
      if (!hasCorpusSync) {
        const availableAt = new Date(now.getTime() + corpusSyncDelaySeconds * 1000).toISOString()
        await supabase.from("gob_jobs").insert({
          type: "tribunal_corpus_sync",
          status: "pending",
          available_at: availableAt,
          attempts: 0,
          max_attempts: corpusSyncJobMaxAttempts,
          payload: {
            tribunal,
            date: targetDate,
            source: "estado_diario_poll",
            changed_roles: syncTargets.length,
          },
          created_at: nowIso,
        })
        queuedCorpusSync = true
      }
    }

    const isTodayTarget = targetDate === chileDateIso(now)
    const shouldQueueDigest = isTodayTarget && (slot === "16:00" || chileHour(now) >= 16)
    let queuedEmailDigest = false
    if (shouldQueueDigest) {
      const [{ data: sentRows, error: sentErr }, alreadyQueued] = await Promise.all([
        supabase
          .from("gob_estado_diario_email_runs")
          .select("id")
          .eq("daily_date", targetDate)
          .eq("status", "sent")
          .limit(1),
        hasPendingJobForDate({ supabase, type: "estado_diario_email_digest", date: targetDate }),
      ])

      if (sentErr) throw new Error(sentErr.message)
      const alreadySent = Array.isArray(sentRows) && sentRows.length > 0

      if (!alreadySent && !alreadyQueued) {
        await supabase.from("gob_jobs").insert({
          type: "estado_diario_email_digest",
          status: "pending",
          available_at: nowIso,
          attempts: 0,
          max_attempts: maxAttempts,
          payload: {
            tribunal,
            date: targetDate,
            source: "estado_diario_poll",
          },
          created_at: nowIso,
        })
        queuedEmailDigest = true
      }
    }

    await supabase.from("gob_audit_logs").insert({
      user_id: null,
      action: "estado_diario.poll.ok",
      target_resource: "gob_estado_diario_runs",
      details: {
        run_id: runId,
        tribunal,
        daily_date: targetDate,
        slot: slot || null,
        entries: entries.length,
        changed_roles: changes.length,
        queued_cause_sync: syncTargets.length,
        queued_corpus_sync: queuedCorpusSync,
        corpus_sync_job_max_attempts: corpusSyncJobMaxAttempts,
        queued_email_digest: queuedEmailDigest,
      },
      timestamp: nowIso,
    })
  } catch (err: any) {
    const message = err?.message ? String(err.message) : String(err)

    await supabase.from("gob_estado_diario_runs").insert({
      tribunal,
      daily_date: targetDate,
      fetched_at: nowIso,
      status: "error",
      is_signed: null,
      entry_count: 0,
      hash: null,
      error: message,
      metadata: {
        slot: slot || null,
        source: String(job.payload?.source || "job").trim() || "job",
      },
    })

    await supabase.from("gob_alerts").insert({
      workspace_id: null,
      message: `Fallo actualizacion de Estado Diario ${tribunal}`,
      severity: "warning",
      metadata: {
        tribunal,
        daily_date: targetDate,
        slot: slot || null,
        error: message,
      },
    })

    await supabase.from("gob_audit_logs").insert({
      user_id: null,
      action: "estado_diario.poll.error",
      target_resource: "gob_estado_diario_runs",
      details: {
        tribunal,
        daily_date: targetDate,
        slot: slot || null,
        error: message,
      },
      timestamp: nowIso,
    })

    throw err
  } finally {
    await ensureEstadoDiarioPollJobs({ supabase, now: new Date(), maxAttempts }).catch(() => null)
  }
}
