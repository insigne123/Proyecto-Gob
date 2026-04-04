import "dotenv/config"

import { createAdminClient } from "../src/lib/supabase/admin"
import { chileDateIso } from "../src/lib/tribunal/estado-diario"
import { ensureEstadoDiarioPollJobs } from "../src/lib/tribunal/estado-diario-scheduler"

function hasFlag(name: string) {
  return process.argv.slice(2).some((arg) => String(arg).trim() === name)
}

function getArg(prefix: string) {
  const hit = process.argv.slice(2).find((arg) => String(arg).trim().startsWith(prefix))
  if (!hit) return null
  const value = String(hit).trim().slice(prefix.length).trim()
  return value || null
}

function normalizeTribunal(value: string | null) {
  const raw = String(value || "").trim().toUpperCase()
  if (!raw) return "1TA"
  if (raw === "1TA" || raw === "2TA") return raw
  throw new Error("Invalid --tribunal value. Use --tribunal=1TA or --tribunal=2TA")
}

async function main() {
  const supabase = createAdminClient()
  const now = new Date()
  const maxAttempts = Math.max(1, Math.min(10, Number(process.env.ESTADO_DIARIO_JOB_MAX_ATTEMPTS || 5)))

  const { error: tableCheckErr } = await supabase
    .from("gob_estado_diario_runs")
    .select("id")
    .limit(1)
  if (tableCheckErr) {
    const msg = String(tableCheckErr.message || "")
    if (msg.toLowerCase().includes("could not find the table") && msg.toLowerCase().includes("gob_estado_diario_runs")) {
      throw new Error(
        "Faltan tablas de Estado Diario. Aplica la migracion SQL (supabase_schema.sql) y vuelve a ejecutar este comando."
      )
    }
    throw new Error(msg || "No se pudo validar tablas de Estado Diario")
  }

  const schedule = await ensureEstadoDiarioPollJobs({ supabase, now, maxAttempts })
  console.log(
    JSON.stringify(
      {
        action: "ensure_estado_diario_poll_jobs",
        inserted: schedule.inserted,
        kept: schedule.kept,
        catchupInserted: schedule.catchupInserted,
      },
      null,
      2
    )
  )

  const explicitDate = getArg("--date=")
  const dateFromArg = explicitDate && /^\d{4}-\d{2}-\d{2}$/.test(explicitDate) ? explicitDate : null
  const tribunal = normalizeTribunal(getArg("--tribunal="))

  if (explicitDate && !dateFromArg) {
    throw new Error("Invalid --date format. Use --date=YYYY-MM-DD")
  }

  if (hasFlag("--now") || dateFromArg) {
    const today = dateFromArg || chileDateIso(now)
    const nowIso = now.toISOString()
    const { error } = await supabase.from("gob_jobs").insert({
      type: "estado_diario_poll",
      status: "pending",
      available_at: nowIso,
      attempts: 0,
      max_attempts: maxAttempts,
      payload: {
        tribunal,
        date: today,
        slot: dateFromArg ? "manual-date" : "manual",
        source: "bootstrap-script",
      },
      created_at: nowIso,
    })
    if (error) throw new Error(error.message)
    console.log(`Queued immediate estado_diario_poll for ${tribunal} (${today}).`)
  }

  const { data: pending, error: pendingErr } = await supabase
    .from("gob_jobs")
    .select("id,type,available_at,payload")
    .in("type", ["estado_diario_poll", "tribunal_cause_sync", "tribunal_corpus_sync", "estado_diario_email_digest"])
    .eq("status", "pending")
    .order("available_at", { ascending: true })
    .limit(30)

  if (pendingErr) throw new Error(pendingErr.message)
  console.log(`Pending related jobs: ${Array.isArray(pending) ? pending.length : 0}`)
}

main().catch((err) => {
  console.error("estado-diario-bootstrap failed:", err)
  process.exit(1)
})
