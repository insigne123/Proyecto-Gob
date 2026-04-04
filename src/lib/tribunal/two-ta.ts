import { OPERATING_TIMEZONE } from "../timezone"
import { type EstadoDiarioEntry } from "./estado-diario"

const TWO_TA_BASE = "https://2ta.lexsoft.cl/2ta"
const TWO_TA_DEFAULT_REFERER = `${TWO_TA_BASE}/search?proc=4`

type TwoTASession = {
  cookie: string
  referer: string
}

type TwoTACauseRow = {
  id: number
  rol: string
  descripcion: string | null
  fechaIngreso: number | null
  cuadernos: Array<any>
  procedimiento?: { id?: number; name?: string | null } | null
}

type TwoTAEscritoRow = {
  id: number
  referencia: string | null
  tipoEscrito?: { id?: number; name?: string | null } | null
  fechaIngreso: number | null
  idCuaderno: number | null
  idCausa: number | null
  documento?: any | null
  documentos?: any[] | null
}

type TwoTAEstadoDiarioRow = {
  id: number
  fecha: number | null
  tramites?: Array<any>
}

type TwoTACauseSearchResponse = {
  results: TwoTACauseRow[]
  resultsCount?: number | null
}

type TwoTATramiteSearchResponse = {
  results?: Array<any>
  resultsCount?: number | null
}

function looksLike2TALoginUrl(value: string | null) {
  const url = String(value || "").toLowerCase()
  if (!url) return false
  return url.includes("/views/login.html") || url.includes("/login")
}

function looksLike2TALoginHtml(value: string | null) {
  const text = String(value || "").toLowerCase()
  if (!text) return false
  if (text.includes("/views/login.html")) return true
  if (text.includes("name=\"j_username\"")) return true
  if (text.includes("name=\"j_password\"")) return true
  if (text.includes("id=\"login") || text.includes("id='login")) return true
  if (text.includes("iniciar sesion") && text.includes("2ta")) return true
  return false
}

function shortTextPreview(value: string, maxLen = 220) {
  const clean = value.replace(/\s+/g, " ").trim()
  if (!clean) return ""
  return clean.length > maxLen ? `${clean.slice(0, maxLen)}...` : clean
}

function toCookieHeader(cookies: string[]) {
  return cookies
    .map((entry) => String(entry || "").split(";")[0])
    .filter(Boolean)
    .join("; ")
}

async function create2TASession(): Promise<TwoTASession> {
  const res = await fetch(TWO_TA_DEFAULT_REFERER, {
    method: "GET",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0",
    },
  })

  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : []
  const cookieHeader = toCookieHeader(cookies)
  if (!cookieHeader) {
    throw new Error("2TA session cookie not found")
  }

  return {
    cookie: cookieHeader,
    referer: TWO_TA_DEFAULT_REFERER,
  }
}

async function fetch2TAJson<T>(params: {
  session: TwoTASession
  path: string
  method?: "GET" | "POST"
  body?: any
  retriesLeft?: number
}) {
  const { session } = params
  const retriesLeft = Number.isFinite(Number(params.retriesLeft))
    ? Math.max(0, Math.floor(Number(params.retriesLeft)))
    : 2
  const shouldRetry = retriesLeft > 0
  const url = `${TWO_TA_BASE}/${params.path.replace(/^\//, "")}`
  const method = params.method || "GET"

  const res = await fetch(url, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json; charset=utf-8",
      "x-requested-with": "XMLHttpRequest",
      "user-agent": "Mozilla/5.0",
      referer: session.referer,
      cookie: session.cookie,
    },
    body: method === "POST" ? JSON.stringify(params.body || {}) : undefined,
  })

  const contentType = String(res.headers.get("content-type") || "").toLowerCase()
  const finalUrl = String(res.url || "")

  if ((res.status === 403 || looksLike2TALoginUrl(finalUrl)) && shouldRetry) {
    const fresh = await create2TASession()
    session.cookie = fresh.cookie
    session.referer = fresh.referer
    return fetch2TAJson<T>({ ...params, retriesLeft: retriesLeft - 1 })
  }

  const text = await res.text().catch(() => "")
  const isLoginBody =
    contentType.includes("text/html") && (looksLike2TALoginHtml(text) || looksLike2TALoginUrl(finalUrl))

  if (isLoginBody && shouldRetry) {
    const fresh = await create2TASession()
    session.cookie = fresh.cookie
    session.referer = fresh.referer
    return fetch2TAJson<T>({ ...params, retriesLeft: retriesLeft - 1 })
  }

  if (!res.ok) {
    throw new Error(`2TA request failed (${res.status}): ${text.slice(0, 120)}`)
  }

  if (!text.trim()) {
    if (shouldRetry) {
      const fresh = await create2TASession()
      session.cookie = fresh.cookie
      session.referer = fresh.referer
      return fetch2TAJson<T>({ ...params, retriesLeft: retriesLeft - 1 })
    }
    throw new Error("2TA request returned empty JSON body")
  }

  try {
    return JSON.parse(text) as T
  } catch {
    if (shouldRetry) {
      const fresh = await create2TASession()
      session.cookie = fresh.cookie
      session.referer = fresh.referer
      return fetch2TAJson<T>({ ...params, retriesLeft: retriesLeft - 1 })
    }

    throw new Error(
      `2TA invalid JSON response (${contentType || "unknown"}): ${shortTextPreview(text, 180) || "empty body"}`
    )
  }
}

async function fetch2TABinary(params: {
  session: TwoTASession
  path: string
  retriesLeft?: number
}) {
  const { session } = params
  const retriesLeft = Number.isFinite(Number(params.retriesLeft))
    ? Math.max(0, Math.floor(Number(params.retriesLeft)))
    : 2
  const shouldRetry = retriesLeft > 0
  const url = `${TWO_TA_BASE}/${params.path.replace(/^\//, "")}`

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "user-agent": "Mozilla/5.0",
      referer: session.referer,
      cookie: session.cookie,
    },
  })

  const contentType = String(res.headers.get("content-type") || "").toLowerCase()
  const finalUrl = String(res.url || "")

  if ((res.status === 403 || looksLike2TALoginUrl(finalUrl)) && shouldRetry) {
    const fresh = await create2TASession()
    session.cookie = fresh.cookie
    session.referer = fresh.referer
    return fetch2TABinary({ ...params, retriesLeft: retriesLeft - 1 })
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`2TA download failed (${res.status}): ${text.slice(0, 120)}`)
  }

  const buffer = Buffer.from(await res.arrayBuffer())

  if (contentType.includes("text/html")) {
    const htmlPreview = buffer.toString("utf8", 0, Math.min(buffer.length, 4096))
    if (looksLike2TALoginHtml(htmlPreview) || looksLike2TALoginUrl(finalUrl)) {
      if (shouldRetry) {
        const fresh = await create2TASession()
        session.cookie = fresh.cookie
        session.referer = fresh.referer
        return fetch2TABinary({ ...params, retriesLeft: retriesLeft - 1 })
      }
      throw new Error("2TA download returned login page")
    }
  }

  const rawContentType = res.headers.get("content-type")
  const normalizedPath = String(params.path || "").toLowerCase()
  if (
    normalizedPath.includes("/download/") &&
    !String(rawContentType || "").toLowerCase().includes("pdf") &&
    !String(rawContentType || "").toLowerCase().includes("word")
  ) {
    if (shouldRetry) {
      const fresh = await create2TASession()
      session.cookie = fresh.cookie
      session.referer = fresh.referer
      return fetch2TABinary({ ...params, retriesLeft: retriesLeft - 1 })
    }
  }

  return { buffer, contentType: rawContentType || contentType || null }
}

function timeZoneOffsetMs(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })

  const parts = dtf.formatToParts(date)
  const map: Record<string, string> = {}
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value
  }

  const utcFromParts = Date.UTC(
    Number(map.year || 0),
    Number(map.month || 1) - 1,
    Number(map.day || 1),
    Number(map.hour || 0),
    Number(map.minute || 0),
    Number(map.second || 0)
  )

  return utcFromParts - date.getTime()
}

function zonedDateTime(isoDate: string, hour: number, minute: number, second: number) {
  const [y, m, d] = isoDate.split("-").map((v) => Number(v))
  const utcGuess = new Date(Date.UTC(y, m - 1, d, hour, minute, second))
  const offset = timeZoneOffsetMs(utcGuess, OPERATING_TIMEZONE)
  return new Date(utcGuess.getTime() - offset)
}

function dailyRangeMs(isoDate: string) {
  const start = zonedDateTime(isoDate, 0, 0, 0).getTime()
  const end = zonedDateTime(isoDate, 23, 59, 59).getTime()
  return { start, end }
}

export async function fetch2TACausesPage(params: {
  session: TwoTASession
  pageSize: number
  page: number
  idProcedimiento?: number
  idMateria?: number | null
  rol?: string | null
}) {
  const body = {
    buscar: "1",
    idProcedimiento: params.idProcedimiento ?? 4,
    rol: params.rol || undefined,
    idMateria: params.idMateria ?? null,
  }

  return fetch2TAJson<TwoTACauseSearchResponse>({
    session: params.session,
    path: `rest/causa/searchPaginado/${params.pageSize}/${params.page}`,
    method: "POST",
    body,
  })
}

export async function fetch2TACauseByRol(params: { session: TwoTASession; rol: string }) {
  const data = await fetch2TACausesPage({
    session: params.session,
    pageSize: 12,
    page: 1,
    rol: params.rol,
  })

  const row = Array.isArray(data.results) && data.results.length ? data.results[0] : null
  return row || null
}

export async function fetch2TAEscritos(params: {
  session: TwoTASession
  idCausa: number
  idCuaderno: number
  pendientes: boolean
}) {
  const path = `rest/escrito/pendientes/${params.pendientes ? "true" : "false"}/${params.idCausa}?idCuaderno=${
    params.idCuaderno
  }`
  const rows = await fetch2TAJson<TwoTAEscritoRow[]>({ session: params.session, path })
  return Array.isArray(rows) ? rows : []
}

export async function fetch2TATramitesByCuaderno(params: {
  session: TwoTASession
  idCuaderno: number
  pageSize?: number
  page?: number
  isPublic?: boolean
}) {
  const pageSize = Math.max(20, Math.min(400, Number(params.pageSize || 200)))
  const page = Math.max(1, Number(params.page || 1))
  const publicFlag = params.isPublic === false ? "false" : "true"
  const payload = await fetch2TAJson<TwoTATramiteSearchResponse>({
    session: params.session,
    path: `rest/tramite/bloqueados/${params.idCuaderno}/${pageSize}/${page}/${publicFlag}`,
  })

  const results = Array.isArray(payload?.results) ? payload.results : []
  const countHint = Number(payload?.resultsCount || results.length)

  return {
    results,
    resultsCount: Number.isFinite(countHint) ? countHint : results.length,
  }
}

export async function fetch2TAEstadoDiario(params: { session: TwoTASession; date: string }) {
  const range = dailyRangeMs(params.date)
  const rows = await fetch2TAJson<TwoTAEstadoDiarioRow[]>({
    session: params.session,
    path: `rest/estadodiario/byrango/${range.start}/${range.end}`,
  })
  return Array.isArray(rows) ? rows : []
}

export async function fetch2TACausesByEstadoDiario(params: { session: TwoTASession; estadoId: number }) {
  const rows = await fetch2TAJson<TwoTACauseRow[]>({
    session: params.session,
    path: `rest/causa/byestadodiario/${params.estadoId}`,
  })
  return Array.isArray(rows) ? rows : []
}

export async function fetch2TACauseDetail(params: { session: TwoTASession; idCausa: number }) {
  return fetch2TAJson<any>({
    session: params.session,
    path: `rest/ot/data/${params.idCausa}`,
  })
}

export async function fetch2TAEstadoDiarioEntries(params: { date: string }) {
  const session = await create2TASession()
  const estados = await fetch2TAEstadoDiario({ session, date: params.date })

  const entries: EstadoDiarioEntry[] = []
  let line = 1

  for (const estado of estados) {
    const estadoId = Number((estado as any)?.id || 0)
    if (!estadoId) continue
    const providencias = Array.isArray((estado as any)?.tramites) ? (estado as any).tramites.length : 0
    const causas = await fetch2TACausesByEstadoDiario({ session, estadoId })

    for (const cause of causas) {
      const rol = String((cause as any)?.rol || "").trim()
      if (!rol) continue
      entries.push({
        lineNo: line++,
        rol,
        idCausa: (cause as any)?.id ? String((cause as any).id) : null,
        caratula: (cause as any)?.descripcion ? String((cause as any).descripcion) : null,
        tipo: "Estado Diario 2TA",
        providencias,
        providenciasEnPalabras: null,
        rolEnPalabras: null,
        isDigital: false,
      })
    }
  }

  return entries
}

export async function download2TADocument(params: { session: TwoTASession; documentId: number }) {
  return fetch2TABinary({ session: params.session, path: `download/${params.documentId}` })
}

export async function create2TASessionForWorker() {
  return create2TASession()
}

export type { TwoTASession, TwoTACauseRow, TwoTAEscritoRow }
