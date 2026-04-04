import { OPERATING_TIMEZONE, nextDailyAt } from "../timezone"
import { chileDateIso } from "./estado-diario"

const POLL_SLOTS = ["08:00", "16:00"] as const
const POLL_TRIBUNALS = ["1TA", "2TA"] as const

type PollTarget = {
  availableAt: Date
  date: string
  slot: (typeof POLL_SLOTS)[number]
}

function parseIsoDate(value: string) {
  const text = String(value || "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const d = new Date(`${text}T12:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return null
  return d
}

function isMissingRelationError(error: any, relation: string) {
  const message = String(error?.message || "").toLowerCase()
  return message.includes("could not find the table") && message.includes(relation.toLowerCase())
}

async function isEstadoDiarioSchemaReady(supabase: any) {
  const { error } = await supabase.from("gob_estado_diario_runs").select("id").limit(1)
  if (!error) return true
  if (isMissingRelationError(error, "gob_estado_diario_runs")) return false
  throw new Error(error.message)
}

function addUtcDays(date: Date, days: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days, 12, 0, 0))
}

function toKey(target: { tribunal: string; date: string; slot: string }) {
  return `${target.tribunal}|${target.date}|${target.slot}`
}

function buildTargets(now: Date) {
  const out: PollTarget[] = []

  for (const slot of POLL_SLOTS) {
    const first = nextDailyAt({ timeZone: OPERATING_TIMEZONE, hhmm: slot, now })
    const second = nextDailyAt({
      timeZone: OPERATING_TIMEZONE,
      hhmm: slot,
      now: new Date(first.getTime() + 60_000),
    })

    for (const at of [first, second]) {
      out.push({
        availableAt: at,
        date: chileDateIso(at),
        slot,
      })
    }
  }

  return out.sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime())
}

export async function ensureEstadoDiarioPollJobs(params: {
  supabase: any
  now?: Date
  maxAttempts?: number
  catchupDays?: number
}) {
  const supabase = params.supabase
  const now = params.now || new Date()
  const maxAttempts = Math.max(1, Math.min(10, Number(params.maxAttempts || 5)))
  const catchupDays = Math.max(0, Math.min(21, Number(params.catchupDays || process.env.ESTADO_DIARIO_CATCHUP_DAYS || 5)))

  const schemaReady = await isEstadoDiarioSchemaReady(supabase)
  if (!schemaReady) {
    return { inserted: 0, kept: 0, catchupInserted: 0, disabled: true }
  }

  const targets = buildTargets(now)
  if (!targets.length) return { inserted: 0, kept: 0, catchupInserted: 0, disabled: false }

  const windowStart = new Date(now.getTime() - 60 * 60_000).toISOString()
  const windowEnd = new Date(now.getTime() + 72 * 60 * 60_000).toISOString()

  const { data: existingRows, error: existingErr } = await supabase
    .from("gob_jobs")
    .select("id,available_at,payload,status")
    .eq("type", "estado_diario_poll")
    .in("status", ["pending", "running"])
    .gte("available_at", windowStart)
    .lte("available_at", windowEnd)
    .limit(400)

  if (existingErr) throw new Error(existingErr.message)

  const existingKeys = new Set<string>()
  for (const row of existingRows || []) {
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {}
    const slot = String((payload as any).slot || "").trim()
    const date = String((payload as any).date || "").trim()
    const tribunal = String((payload as any).tribunal || "1TA").trim() || "1TA"

    if (slot && date) {
      existingKeys.add(toKey({ tribunal, date, slot }))
      continue
    }

    const at = row?.available_at ? new Date(String(row.available_at)) : null
    if (at && !Number.isNaN(at.getTime())) {
      const h = String(timeInChile(at).hour).padStart(2, "0")
      const m = String(timeInChile(at).minute).padStart(2, "0")
      const fallbackSlot = `${h}:${m}`
      if (POLL_SLOTS.includes(fallbackSlot as any)) {
        existingKeys.add(toKey({ tribunal, date: chileDateIso(at), slot: fallbackSlot }))
      }
    }
  }

  const totalTargets = targets.length * POLL_TRIBUNALS.length
  const toInsert = targets
    .flatMap((target) =>
      POLL_TRIBUNALS.map((tribunal) => ({
        tribunal,
        date: target.date,
        slot: target.slot,
        availableAt: target.availableAt,
      }))
    )
    .filter((target) => !existingKeys.has(toKey(target)))
  if (!toInsert.length) {
    const catchupInserted = await ensureCatchupJobs({ supabase, now, maxAttempts, catchupDays })
    return { inserted: 0, kept: totalTargets, catchupInserted }
  }

  const nowIso = now.toISOString()
  const jobs = toInsert.map((target) => ({
    type: "estado_diario_poll",
    status: "pending",
    available_at: target.availableAt.toISOString(),
    attempts: 0,
    max_attempts: maxAttempts,
    payload: {
      tribunal: target.tribunal,
      date: target.date,
      slot: target.slot,
      source: "scheduler",
    },
    created_at: nowIso,
  }))

  const { error: insertErr } = await supabase.from("gob_jobs").insert(jobs)
  if (insertErr) throw new Error(insertErr.message)

  const catchupInserted = await ensureCatchupJobs({ supabase, now, maxAttempts, catchupDays })
  return { inserted: jobs.length, kept: totalTargets - jobs.length, catchupInserted }
}

async function ensureCatchupJobs(params: {
  supabase: any
  now: Date
  maxAttempts: number
  catchupDays: number
}) {
  const { supabase, now, maxAttempts, catchupDays } = params
  if (catchupDays <= 0) return 0

  const today = parseIsoDate(chileDateIso(now))
  if (!today) return 0

  let inserted = 0
  const nowIso = now.toISOString()

  for (const tribunal of POLL_TRIBUNALS) {
    const { data: latestRun, error: latestErr } = await supabase
      .from("gob_estado_diario_runs")
      .select("daily_date")
      .eq("tribunal", tribunal)
      .eq("status", "ok")
      .order("daily_date", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latestErr) {
      if (isMissingRelationError(latestErr, "gob_estado_diario_runs")) return 0
      throw new Error(latestErr.message)
    }

    const explicitStart = latestRun?.daily_date ? parseIsoDate(String(latestRun.daily_date)) : null
    const fallbackStart = addUtcDays(today, -(catchupDays - 1))
    const start = explicitStart ? addUtcDays(explicitStart, 1) : fallbackStart

    if (start.getTime() > today.getTime()) continue

    for (let d = start; d.getTime() <= today.getTime(); d = addUtcDays(d, 1)) {
      const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
        d.getUTCDate()
      ).padStart(2, "0")}`

      const { data: runRows, error: runErr } = await supabase
        .from("gob_estado_diario_runs")
        .select("id")
        .eq("tribunal", tribunal)
        .eq("daily_date", date)
        .eq("status", "ok")
        .limit(1)

      if (runErr) throw new Error(runErr.message)
      if (Array.isArray(runRows) && runRows.length) continue

      const { data: pendingRows, error: pendingErr } = await supabase
        .from("gob_jobs")
        .select("id")
        .eq("type", "estado_diario_poll")
        .in("status", ["pending", "running"])
        .filter("payload->>date", "eq", date)
        .filter("payload->>tribunal", "eq", tribunal)
        .limit(1)

      if (pendingErr) throw new Error(pendingErr.message)
      if (Array.isArray(pendingRows) && pendingRows.length) continue

      const { error: insertErr } = await supabase.from("gob_jobs").insert({
        type: "estado_diario_poll",
        status: "pending",
        available_at: nowIso,
        attempts: 0,
        max_attempts: maxAttempts,
        payload: {
          tribunal,
          date,
          slot: "catchup",
          source: "scheduler-catchup",
        },
        created_at: nowIso,
      })

      if (insertErr) throw new Error(insertErr.message)
      inserted += 1
    }
  }

  return inserted
}

function timeInChile(date: Date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: OPERATING_TIMEZONE,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  })

  const parts = dtf.formatToParts(date)
  const map: Record<string, string> = {}
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value
  }

  return {
    hour: Number(map.hour || "0"),
    minute: Number(map.minute || "0"),
  }
}
