import crypto from "node:crypto"

import { OPERATING_TIMEZONE } from "../timezone"
import { classifyTribunalDocumentRole, isStrictTribunalKeyDocument } from "./document-role"

const ONE_TA_WS_BASE = "https://www.portaljudicial1ta.cl/sgc-ws/rest"

type WsEnvelope = {
  status?: string | number
  response?: string | Record<string, any> | Array<any> | boolean | null
  message?: string | null
  error?: string | null
}

export type EstadoDiarioEntry = {
  lineNo: number
  rol: string
  idCausa: string | null
  caratula: string | null
  tipo: string | null
  providencias: number
  providenciasEnPalabras: string | null
  rolEnPalabras: string | null
  isDigital: boolean
}

export type OneTAAsiento = {
  codAsiento: string
  codDocumento: string | null
  fechaDocumento: string | null
  fojasDocumento: string | null
  nombreDocumento: string | null
  resuelveDocumento: string | null
  tipoDocumento: string | null
  tipoDocumento2: string | null
}

export type OneTADocumentDetail = {
  codDocumento: string | null
  tipoArchivo: string | null
  nombreDocumento: string | null
  linkFoleado: string | null
  linkOriginal: string | null
  linkDocumentoFoleado: string | null
  linkDocumentoOriginal: string | null
}

function safeText(value: unknown, maxLen = 280) {
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

function parseEnvelopeResponse(payload: WsEnvelope | null) {
  if (!payload) return null
  const status = String(payload.status || "")
  if (status && status !== "200") {
    return null
  }

  if (typeof payload.response === "string") {
    try {
      return JSON.parse(payload.response)
    } catch {
      return payload.response
    }
  }

  return payload.response ?? null
}

function intFromValue(value: unknown) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.floor(n))
}

function toIsoDateFromDmy(value: unknown) {
  const text = safeText(value, 40)
  if (!text) return null

  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dmy) {
    const dd = dmy[1].padStart(2, "0")
    const mm = dmy[2].padStart(2, "0")
    const yyyy = dmy[3]
    return `${yyyy}-${mm}-${dd}`
  }

  const d = new Date(text)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`
}

function timeZoneParts(date: Date, timeZone = OPERATING_TIMEZONE) {
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

  const map: Record<string, string> = {}
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value
  }

  return {
    year: Number(map.year || "0"),
    month: Number(map.month || "0"),
    day: Number(map.day || "0"),
    hour: Number(map.hour || "0"),
    minute: Number(map.minute || "0"),
    second: Number(map.second || "0"),
  }
}

export function chileDateIso(date = new Date()) {
  const p = timeZoneParts(date)
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(
    2,
    "0"
  )}`
}

export function chileHour(date = new Date()) {
  return timeZoneParts(date).hour
}

async function fetchOneTAEnvelope(path: string, timeoutMs = 24_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${ONE_TA_WS_BASE}/${path.replace(/^\/+/, "")}`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    })

    const text = await response.text()
    let parsed: any = null
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }

    if (!response.ok) {
      const detail =
        (parsed && typeof parsed === "object" && (parsed.message || parsed.error) && String(parsed.message || parsed.error)) ||
        text ||
        `HTTP ${response.status}`
      throw new Error(`1TA endpoint failed: ${detail}`)
    }

    return parsed as WsEnvelope | null
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchEstadoDiarioEntries(params: { date: string; timeoutMs?: number }) {
  const date = safeText(params.date, 20)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid date format for estado diario")
  }

  const envelope = await fetchOneTAEnvelope(`estado-diario/list?fecha=${encodeURIComponent(date)}`, params.timeoutMs)
  const payload = parseEnvelopeResponse(envelope)
  const rows = Array.isArray(payload) ? payload : []

  const entries: EstadoDiarioEntry[] = rows
    .map((row: any, index: number) => ({
      lineNo: index + 1,
      rol: safeText(row?.numeroRol || row?.rolCausa || "", 80),
      idCausa: safeText(row?.idCausa, 120) || null,
      caratula: safeText(row?.caratula, 500) || null,
      tipo: safeText(row?.tipo, 120) || null,
      providencias: intFromValue(row?.providencias),
      providenciasEnPalabras: safeText(row?.providenciasEnPalabras, 120) || null,
      rolEnPalabras: safeText(row?.rolEnPalabras, 220) || null,
      isDigital: Number(row?.isDigital) === 1,
    }))
    .filter((row) => Boolean(row.rol))

  return entries
}

export async function fetchEstadoDiarioIsSigned(params: { date: string; timeoutMs?: number }) {
  const date = safeText(params.date, 20)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid date format for estado diario")
  }

  const envelope = await fetchOneTAEnvelope(`estado-diario/is-signed?fecha=${encodeURIComponent(date)}`, params.timeoutMs)
  const payload = parseEnvelopeResponse(envelope)
  if (typeof payload === "boolean") return payload
  if (typeof payload === "string") {
    const v = normalizeText(payload)
    if (v === "true") return true
    if (v === "false") return false
  }
  return null
}

export function hashEstadoEntries(entries: EstadoDiarioEntry[]) {
  const stable = entries
    .map((row) => ({
      rol: row.rol,
      idCausa: row.idCausa,
      providencias: row.providencias,
      tipo: row.tipo,
      caratula: row.caratula,
      isDigital: row.isDigital,
    }))
    .sort((a, b) => a.rol.localeCompare(b.rol))

  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex")
}

export async function fetch1TACauseIdByRol(params: { rol: string; timeoutMs?: number }) {
  const rol = safeText(params.rol, 120)
  if (!rol) return null

  const envelope = await fetchOneTAEnvelope(
    `ver-causa/carga-datos-causa?rolCausa=${encodeURIComponent(rol)}`,
    params.timeoutMs
  )
  const payload = parseEnvelopeResponse(envelope)
  if (!payload || typeof payload !== "object") return null
  const idCausa = safeText((payload as any).idCausa || (payload as any).id, 120)
  return idCausa || null
}

export async function fetch1TACuadernos(params: { idCausa: string; timeoutMs?: number }) {
  const idCausa = safeText(params.idCausa, 120)
  if (!idCausa) return [] as Array<{ idCuaderno: string; nombre: string | null }>

  const envelope = await fetchOneTAEnvelope(
    `ver-causa/lista-cuadernos-causa?idCausa=${encodeURIComponent(idCausa)}`,
    params.timeoutMs
  )
  const payload = parseEnvelopeResponse(envelope)
  const rows = Array.isArray(payload) ? payload : []

  return rows
    .map((row: any) => ({
      idCuaderno: safeText(row?.clave || row?.idCuaderno || row?.id, 120),
      nombre: safeText(row?.valor || row?.nombre || "", 180) || null,
    }))
    .filter((row) => Boolean(row.idCuaderno))
}

export async function fetch1TAAsientos(params: { idCuaderno: string; timeoutMs?: number }) {
  const idCuaderno = safeText(params.idCuaderno, 120)
  if (!idCuaderno) return [] as OneTAAsiento[]

  const envelope = await fetchOneTAEnvelope(
    `ver-causa/lista-asiento-cuaderno?idCuaderno=${encodeURIComponent(
      idCuaderno
    )}&tipoDocumento=all&idUsuario=&rolUsuario=`,
    params.timeoutMs
  )
  const payload = parseEnvelopeResponse(envelope)
  const rows = Array.isArray(payload) ? payload : []

  return rows
    .map((row: any) => ({
      codAsiento: safeText(row?.codAsiento, 120),
      codDocumento: safeText(row?.codDocumento, 120) || null,
      fechaDocumento: safeText(row?.fechaDocumento, 40) || null,
      fojasDocumento: safeText(row?.fojasDocumento, 80) || null,
      nombreDocumento: safeText(row?.nombreDocumento, 280) || null,
      resuelveDocumento: safeText(row?.resuelveDocumento, 280) || null,
      tipoDocumento: safeText(row?.tipoDocumento, 180) || null,
      tipoDocumento2: safeText(row?.tipoDocumento2, 180) || null,
    }))
    .filter((row) => Boolean(row.codAsiento))
}

export async function fetch1TAAsientoDocumentDetails(params: { asiento: string; timeoutMs?: number }) {
  const asiento = safeText(params.asiento, 120)
  if (!asiento) return [] as OneTADocumentDetail[]

  const envelope = await fetchOneTAEnvelope(
    `ver-causa/lista-documento-asiento?token=&asiento=${encodeURIComponent(asiento)}`,
    params.timeoutMs
  )
  const payload = parseEnvelopeResponse(envelope)
  const rows = Array.isArray(payload) ? payload : []

  return rows.map((row: any) => ({
    codDocumento: safeText(row?.codDocumento, 120) || null,
    tipoArchivo: safeText(row?.tipoArchivo, 60) || null,
    nombreDocumento: safeText(row?.nombreDocumento, 300) || null,
    linkFoleado: safeText(row?.linkFoleado, 1800) || null,
    linkOriginal: safeText(row?.linkOriginal, 1800) || null,
    linkDocumentoFoleado: safeText(row?.linkDocumentoFoleado, 1800) || null,
    linkDocumentoOriginal: safeText(row?.linkDocumentoOriginal, 1800) || null,
  })) as OneTADocumentDetail[]
}

export function pickAsientoKeyRole(asiento: OneTAAsiento) {
  const headline = safeText(
    asiento.tipoDocumento2 || asiento.resuelveDocumento || asiento.nombreDocumento || asiento.tipoDocumento,
    260
  )
  const role = classifyTribunalDocumentRole({
    documentType: asiento.tipoDocumento2 || asiento.tipoDocumento,
    title: headline,
    name: asiento.nombreDocumento,
  })

  const strict = isStrictTribunalKeyDocument({
    documentType: asiento.tipoDocumento2 || asiento.tipoDocumento,
    title: headline,
    name: asiento.nombreDocumento,
  })

  return {
    role,
    strict,
  }
}

export function canonicalRoleLabel(role: string) {
  if (role === "reclamacion") return "Escrito Inicial"
  if (role === "informe") return "Evacua informe"
  if (role === "sentencia") return "Sentencia"
  return "Documento"
}

export function build1TAViewerUrl(path: string) {
  const clean = safeText(path, 2000)
  if (!clean) return null
  return `${ONE_TA_WS_BASE}/servlet/viewer-file?file=${encodeURIComponent(clean)}&embedded=true`
}

export function build1TADownloadUrl(path: string) {
  const clean = safeText(path, 2000)
  if (!clean) return null
  return `${ONE_TA_WS_BASE}/servlet/download-file?file=${encodeURIComponent(clean)}`
}

export function pickDocumentFilePath(detail: OneTADocumentDetail) {
  return (
    safeText(detail.linkFoleado, 2000) ||
    safeText(detail.linkOriginal, 2000) ||
    safeText(detail.linkDocumentoFoleado, 2000) ||
    safeText(detail.linkDocumentoOriginal, 2000) ||
    ""
  )
}

export function toIsoDateFromTribunal(value: string | null) {
  return toIsoDateFromDmy(value)
}
