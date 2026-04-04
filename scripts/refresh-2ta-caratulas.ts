import "dotenv/config"

import { createAdminClient } from "../src/lib/supabase/admin"
import { create2TASessionForWorker, fetch2TACauseDetail } from "../src/lib/tribunal/two-ta"

type CauseRow = {
  id: string
  rol: string | null
  caratula: string | null
  link_causa: string | null
  fecha_ingreso: string | null
  estado: string | null
  estado_subtipo: string | null
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function safeText(value: unknown, maxLen = 320) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > maxLen ? text.slice(0, maxLen) : text
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeDocId(value: unknown) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n)
}

function parse2TAIdCausa(link: string | null) {
  const raw = String(link || "").trim()
  if (!raw) return null

  const queryMatch = raw.match(/[?&]idCausa=(\d+)/i)
  if (queryMatch) return normalizeDocId(queryMatch[1])

  const pathMatch = raw.match(/\/ot\/causa\/(\d+)(?:[/?#].*)?$/i)
  if (pathMatch) return normalizeDocId(pathMatch[1])

  return null
}

function toIsoDateFlexible(value: unknown) {
  const text = String(value || "").trim()
  if (!text) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text

  const n = Number(value)
  if (Number.isFinite(n) && n > 0) {
    const d = new Date(n)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  }

  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dmy) {
    const dd = dmy[1].padStart(2, "0")
    const mm = dmy[2].padStart(2, "0")
    const yyyy = dmy[3]
    return `${yyyy}-${mm}-${dd}`
  }

  const d = new Date(text)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function pickTextCandidate(values: unknown[], maxLen = 320) {
  for (const value of values) {
    if (typeof value !== "string") continue
    const text = safeText(value, maxLen)
    if (text) return text
  }
  return ""
}

function resolveCaratulaFromDetail(detail: any, fallbackRol: string | null) {
  return (
    pickTextCandidate(
      [
        detail?.descripcion,
        detail?.caratulaCausa,
        detail?.causa?.descripcion,
        detail?.causa?.caratula,
        detail?.ot?.descripcion,
        detail?.ot?.caratula,
        typeof detail?.caratula === "string" ? detail.caratula : null,
      ],
      320
    ) || safeText(fallbackRol, 120)
  )
}

function resolveEstadoFromDetail(detail: any) {
  return (
    safeText(detail?.estado?.name || detail?.estado?.nombre, 140) ||
    safeText(detail?.estadoCausa || detail?.estado || detail?.estadoNombre, 140) ||
    null
  )
}

function resolveEstadoSubtipoFromDetail(detail: any) {
  return (
    safeText(detail?.subEstado?.name || detail?.subEstado?.nombre, 140) ||
    safeText(detail?.subEstadoCausa || detail?.estadoSubtipo || detail?.subestado, 140) ||
    null
  )
}

function resolveFechaIngresoFromDetail(detail: any) {
  const value =
    detail?.fechaIngreso ||
    detail?.fechaIngresoCausa ||
    detail?.fecha ||
    detail?.causa?.fechaIngreso ||
    detail?.ot?.fechaIngreso ||
    detail?.causa?.fechaIngresoCausa ||
    detail?.ot?.fechaIngresoCausa

  return toIsoDateFlexible(value)
}

async function fetchDetailWithRetry(session: any, idCausa: number, attempts: number) {
  const max = Math.max(1, Math.min(8, attempts))
  for (let i = 0; i < max; i += 1) {
    try {
      const detail = await fetch2TACauseDetail({ session, idCausa })
      if (detail && typeof detail === "object") return detail
    } catch {}
    if (i < max - 1) {
      await sleep(350 * (i + 1))
    }
  }
  return null
}

function isPlaceholderCaratula(cause: CauseRow) {
  const rol = safeText(cause.rol, 120)
  const caratula = safeText(cause.caratula, 320)
  if (!caratula) return true
  if (!rol) return false
  return normalizeText(caratula) === normalizeText(rol)
}

async function loadAll2TACauses(admin: any) {
  const out: CauseRow[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1
    const { data, error } = await admin
      .from("gob_tribunal_causes")
      .select("id,rol,caratula,link_causa,fecha_ingreso,estado,estado_subtipo")
      .eq("tribunal", "2TA")
      .range(from, to)

    if (error) throw new Error(error.message)
    const rows = (Array.isArray(data) ? data : []) as CauseRow[]
    if (!rows.length) break
    out.push(...rows)
    if (rows.length < pageSize) break
  }
  return out
}

async function main() {
  const admin = createAdminClient()
  const apply = hasFlag("--apply")
  const limit = intArg("--limit=", 250, 1, 5000)
  const attempts = intArg("--attempts=", 4, 1, 8)
  const sleepMs = intArg("--sleep-ms=", 180, 0, 5000)

  const all = await loadAll2TACauses(admin)
  const placeholders = all.filter(isPlaceholderCaratula)

  const candidates = placeholders
    .map((cause) => ({
      cause,
      idCausa: parse2TAIdCausa(cause.link_causa),
    }))
    .filter((row) => Number.isFinite(row.idCausa || NaN) && Number(row.idCausa) > 0)
    .slice(0, limit)

  const session = await create2TASessionForWorker()
  let inspected = 0
  let withDetail = 0
  let eligibleUpdates = 0
  let updated = 0
  const samples: Array<{
    rol: string
    previousCaratula: string | null
    newCaratula: string
    idCausa: number
  }> = []

  for (const row of candidates) {
    inspected += 1
    const cause = row.cause
    const idCausa = Number(row.idCausa)

    const detail = await fetchDetailWithRetry(session, idCausa, attempts)
    if (!detail) {
      if (sleepMs > 0) await sleep(sleepMs)
      continue
    }
    withDetail += 1

    const newCaratula = resolveCaratulaFromDetail(detail, cause.rol)
    const previousCaratula = safeText(cause.caratula, 320) || null
    const shouldUpdateCaratula = !!newCaratula && normalizeText(newCaratula) !== normalizeText(previousCaratula)

    const payload: Record<string, any> = {}
    if (shouldUpdateCaratula) payload.caratula = newCaratula

    const fechaIngreso = resolveFechaIngresoFromDetail(detail)
    if (fechaIngreso && fechaIngreso !== String(cause.fecha_ingreso || "")) {
      payload.fecha_ingreso = fechaIngreso
    }

    const estado = resolveEstadoFromDetail(detail)
    if (estado && normalizeText(estado) !== normalizeText(cause.estado || "")) {
      payload.estado = estado
    }

    const estadoSubtipo = resolveEstadoSubtipoFromDetail(detail)
    if (estadoSubtipo && normalizeText(estadoSubtipo) !== normalizeText(cause.estado_subtipo || "")) {
      payload.estado_subtipo = estadoSubtipo
    }

    if (!Object.keys(payload).length) {
      if (sleepMs > 0) await sleep(sleepMs)
      continue
    }

    eligibleUpdates += 1
    payload.updated_at = new Date().toISOString()

    if (samples.length < 20) {
      samples.push({
        rol: safeText(cause.rol, 120) || "(sin rol)",
        previousCaratula,
        newCaratula,
        idCausa,
      })
    }

    if (apply) {
      const { error } = await admin.from("gob_tribunal_causes").update(payload).eq("id", cause.id)
      if (!error) updated += 1
    }

    if (sleepMs > 0) await sleep(sleepMs)
  }

  console.log(
    JSON.stringify(
      {
        action: "refresh_2ta_caratulas",
        dryRun: !apply,
        total2TA: all.length,
        placeholders: placeholders.length,
        candidates: candidates.length,
        inspected,
        withDetail,
        eligibleUpdates,
        updated,
        attempts,
        sleepMs,
        sample: samples,
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error("refresh-2ta-caratulas failed:", error)
  process.exit(1)
})
