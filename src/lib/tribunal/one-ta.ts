type OneTAEnvelope = {
  status?: string | number
  response?: string | Record<string, any> | Array<any> | null
  message?: string | null
  error?: string | null
}

type OneTAMovement = {
  date: string | null
  label: string | null
  actor: string | null
}

export type OneTACauseSnapshot = {
  found: boolean
  tribunal: "1TA"
  rol: string
  idCausa: string | null
  caratula: string | null
  estado: string | null
  estadoSubtipo: string | null
  fechaIngreso: string | null
  linkCausa: string
  latestMovement: OneTAMovement | null
  hasCasacion: boolean
  recursoTipo: string | null
  movementCount: number
}

const ONE_TA_BASE = "https://www.portaljudicial1ta.cl/sgc-ws/rest/ver-causa"

const SEA_PART_PATTERNS = [
  "servicio de evaluacion ambiental",
  "servicio evaluacion ambiental",
  "direccion ejecutiva del servicio de evaluacion ambiental",
  "direccion regional del servicio de evaluacion ambiental",
  "direccion ejecutiva sea",
  "direccion regional sea",
  "comite de ministros",
  "comision de evaluacion",
  "comision evaluacion",
  "coeva",
  "director ejecutivo",
  "directora ejecutiva",
  "direccion ejecutiva",
  "director regional",
  "directora regional",
  "direccion regional",
]

function hasSeaTokenWord(text: string) {
  return /(^|\s)sea(\s|$)/.test(text)
}

function hasSmaTokenWord(text: string) {
  return /(^|\s)sma(\s|$)/.test(text)
}

function hasSmaAuthorityMention(text: string) {
  if (!text) return false
  if (text.includes("superintendencia del medio ambiente")) return true

  const hasSma = hasSmaTokenWord(text)
  const hasContra = text.includes(" con ") || text.includes("contra")
  if (hasSma && hasContra) return true

  return hasSma
}

function hasSeaActorMention(text: string) {
  if (!text) return false

  if (SEA_PART_PATTERNS.some((pattern) => text.includes(pattern))) return true

  const hasSea = hasSeaTokenWord(text)
  const hasContra = text.includes(" con ") || text.includes("contra")
  if (hasSea && hasContra) return true

  const hasAuthorityWord =
    text.includes("director ejecutivo") ||
    text.includes("directora ejecutiva") ||
    text.includes("direccion ejecutiva") ||
    text.includes("director regional") ||
    text.includes("directora regional") ||
    text.includes("direccion regional") ||
    /(^|\s)ejecutivo(\s|$)/.test(text)

  if (hasAuthorityWord) {
    const hasSeaContext =
      hasSea ||
      text.includes("servicio") ||
      text.includes("evaluacion ambiental") ||
      text.includes("ambiental")
    if (hasSeaContext) return true
  }

  return false
}

function safeText(value: unknown, maxLen = 240) {
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

function toIsoDate(value: unknown) {
  const raw = safeText(value, 64)
  if (!raw) return null

  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dmy) {
    const dd = dmy[1].padStart(2, "0")
    const mm = dmy[2].padStart(2, "0")
    const yyyy = dmy[3]
    return `${yyyy}-${mm}-${dd}`
  }

  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function movementDateMs(value: unknown) {
  const iso = toIsoDate(value)
  if (!iso) return 0
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 0
  return d.getTime()
}

function parseResponseBody(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function parseEnvelopeResponse(payload: OneTAEnvelope | null) {
  if (!payload) return null
  const status = String(payload.status || "")
  if (status && status !== "200") {
    return null
  }

  if (typeof payload.response === "string") {
    const parsed = parseResponseBody(payload.response)
    return parsed
  }

  return payload.response ?? null
}

async function fetchOneTAJson(path: string, timeoutMs = 22000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${ONE_TA_BASE}/${path.replace(/^\/+/, "")}`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    })

    const text = await response.text()
    const parsed = parseResponseBody(text)

    if (!response.ok) {
      const message =
        (parsed && typeof parsed === "object" && (parsed as any).message && String((parsed as any).message)) ||
        text ||
        `HTTP ${response.status}`
      throw new Error(`1TA request failed: ${message}`)
    }

    return parsed as OneTAEnvelope | null
  } finally {
    clearTimeout(timer)
  }
}

function movementLabel(row: any) {
  return (
    safeText(row?.resuelveDocumento, 220) ||
    safeText(row?.tipoDocumento2, 220) ||
    safeText(row?.tipoDocumento, 220) ||
    safeText(row?.nombreDocumento, 220) ||
    null
  )
}

function movementActor(row: any) {
  return (
    safeText(row?.nombreParte, 180) ||
    safeText(row?.rolUsuario, 180) ||
    safeText(row?.origen, 180) ||
    null
  )
}

function inferRecursoTipo(text: string) {
  const n = normalizeText(text)
  const hasFondo = n.includes("casacion en el fondo")
  const hasForma = n.includes("casacion en la forma")
  if (hasFondo && hasForma) return "Forma y fondo"
  if (hasFondo) return "Fondo"
  if (hasForma) return "Forma"
  if (n.includes("casacion")) return "Casacion"
  return null
}

function buildCauseLink(rol: string) {
  return `https://www.portaljudicial1ta.cl/sgc-web/ver-causa.html?rol=${encodeURIComponent(rol)}`
}

export function normalizeTribunalCode(value: unknown) {
  const n = normalizeText(value)
  if (!n) return null
  if (
    n === "1ta" ||
    n === "1 ta" ||
    n === "primer tribunal ambiental" ||
    n.includes("portaljudicial1ta")
  ) {
    return "1TA"
  }
  if (n === "2ta" || n === "2 ta" || n === "segundo tribunal ambiental") return "2TA"
  if (n === "3ta" || n === "3 ta" || n === "tercer tribunal ambiental") return "3TA"
  return safeText(value, 40) || null
}

export function isSeaDefendantCaratula(caratula: unknown) {
  const n = normalizeText(caratula)
  if (!n) return false
  return hasSeaActorMention(n)
}

export function isSmaDefendantCaratula(caratula: unknown) {
  const n = normalizeText(caratula)
  if (!n) return false
  return hasSmaAuthorityMention(n)
}

export function isSeaOrSmaDefendantCaratula(caratula: unknown) {
  const n = normalizeText(caratula)
  if (!n) return false
  return hasSeaActorMention(n) || hasSmaAuthorityMention(n)
}

export function isSeaOnlyCaratula(caratula: unknown) {
  const n = normalizeText(caratula)
  if (!n) return false

  const hasSmaToken = hasSmaTokenWord(n)
  const hasSmaPhrase = n.includes("superintendencia del medio ambiente")
  if (hasSmaToken || hasSmaPhrase) return false

  return hasSeaActorMention(n)
}

export function extractTribunalRolFromRow(row: Record<string, any>) {
  const entries = Object.entries(row || {})
  let tribunal: string | null = null
  let rol: string | null = null

  for (const [key, raw] of entries) {
    const keyNorm = normalizeText(key)
    const value = safeText(raw, 180)
    if (!value) continue

    if (!tribunal && keyNorm.includes("tribunal")) {
      tribunal = value
      continue
    }

    if (!rol && (keyNorm === "rol" || keyNorm.includes("rol") || keyNorm.includes("numero de rol"))) {
      rol = value
      continue
    }
  }

  if (!tribunal) {
    for (const [, raw] of entries) {
      const value = safeText(raw, 180)
      const t = normalizeTribunalCode(value)
      if (t === "1TA" || t === "2TA" || t === "3TA") {
        tribunal = value
        break
      }
    }
  }

  return {
    tribunal: tribunal || null,
    tribunalCode: normalizeTribunalCode(tribunal),
    rol: rol || null,
  }
}

export async function fetch1TACauseSnapshotByRol(params: { rol: string; timeoutMs?: number }) {
  const rol = safeText(params.rol, 120)
  if (!rol) {
    throw new Error("Missing rol")
  }

  const timeoutMs = Number(params.timeoutMs || 22000)

  const causaEnv = await fetchOneTAJson(
    `carga-datos-causa?rolCausa=${encodeURIComponent(rol)}`,
    timeoutMs
  )
  const causaPayload = parseEnvelopeResponse(causaEnv)
  if (!causaPayload || typeof causaPayload !== "object") {
    return {
      found: false,
      tribunal: "1TA" as const,
      rol,
      idCausa: null,
      caratula: null,
      estado: null,
      estadoSubtipo: null,
      fechaIngreso: null,
      linkCausa: buildCauseLink(rol),
      latestMovement: null,
      hasCasacion: false,
      recursoTipo: null,
      movementCount: 0,
    } satisfies OneTACauseSnapshot
  }

  const idCausa = safeText((causaPayload as any).idCausa || (causaPayload as any).id, 80) || null
  const caratula = safeText(
    (causaPayload as any).caratula || (causaPayload as any).caratulaCausa,
    280
  ) || null
  const estado = safeText((causaPayload as any).estadoCausa || (causaPayload as any).estado, 140) || null
  const estadoSubtipo =
    safeText((causaPayload as any).subEstadoCausa || (causaPayload as any).subTipoCausa, 140) || null
  const fechaIngreso =
    toIsoDate((causaPayload as any).fechaIngreso || (causaPayload as any).fechaIngresoCausa) || null

  if (!idCausa) {
    return {
      found: true,
      tribunal: "1TA",
      rol,
      idCausa: null,
      caratula,
      estado,
      estadoSubtipo,
      fechaIngreso,
      linkCausa: buildCauseLink(rol),
      latestMovement: null,
      hasCasacion: false,
      recursoTipo: null,
      movementCount: 0,
    } satisfies OneTACauseSnapshot
  }

  const cuadernosEnv = await fetchOneTAJson(
    `lista-cuadernos-causa?idCausa=${encodeURIComponent(idCausa)}`,
    timeoutMs
  )
  const cuadernosPayload = parseEnvelopeResponse(cuadernosEnv)
  const cuadernos = Array.isArray(cuadernosPayload) ? cuadernosPayload : []

  const allMovements: any[] = []
  for (const cuaderno of cuadernos.slice(0, 5)) {
    const idCuaderno =
      safeText((cuaderno as any).clave || (cuaderno as any).idCuaderno || (cuaderno as any).id, 120) ||
      null
    if (!idCuaderno) continue

    const asientosEnv = await fetchOneTAJson(
      `lista-asiento-cuaderno?idCuaderno=${encodeURIComponent(idCuaderno)}&tipoDocumento=all&idUsuario=&rolUsuario=`,
      timeoutMs
    )
    const asientosPayload = parseEnvelopeResponse(asientosEnv)
    const asientos = Array.isArray(asientosPayload) ? asientosPayload : []
    allMovements.push(...asientos)
  }

  const movements = allMovements
    .map((row: any) => ({
      date: toIsoDate(row?.fechaDocumento || row?.fechaAsiento || row?.fecha),
      dateMs: movementDateMs(row?.fechaDocumento || row?.fechaAsiento || row?.fecha),
      label: movementLabel(row),
      actor: movementActor(row),
      raw: row,
    }))
    .filter((row) => Boolean(row.label))
    .sort((a, b) => b.dateMs - a.dateMs)

  const latest = movements.length
    ? {
        date: movements[0].date,
        label: movements[0].label,
        actor: movements[0].actor,
      }
    : null

  const casacionText = movements
    .slice(0, 120)
    .map((row) => `${row.label || ""} ${row.actor || ""}`)
    .join(" ")
  const hasCasacion = normalizeText(casacionText).includes("casacion")

  return {
    found: true,
    tribunal: "1TA",
    rol,
    idCausa,
    caratula,
    estado,
    estadoSubtipo,
    fechaIngreso,
    linkCausa: buildCauseLink(rol),
    latestMovement: latest,
    hasCasacion,
    recursoTipo: inferRecursoTipo(casacionText),
    movementCount: movements.length,
  } satisfies OneTACauseSnapshot
}
