import { fetch1TACauseSnapshotByRol } from "../../lib/tribunal/one-ta"
import {
  build1TADownloadUrl,
  build1TAViewerUrl,
  canonicalRoleLabel,
  fetch1TAAsientoDocumentDetails,
  fetch1TAAsientos,
  fetch1TACauseIdByRol,
  fetch1TACuadernos,
  pickAsientoKeyRole,
  pickDocumentFilePath,
  toIsoDateFromTribunal,
  type OneTAAsiento,
} from "../../lib/tribunal/estado-diario"
import {
  create2TASessionForWorker,
  download2TADocument,
  fetch2TACauseByRol,
  fetch2TACauseDetail,
  fetch2TATramitesByCuaderno,
  type TwoTACauseRow,
} from "../../lib/tribunal/two-ta"
import { isEligibleOnboardingCause } from "../../lib/onboarding/eligibility"
import { classifyTribunalDocumentRole } from "../../lib/tribunal/document-role"

async function auditSkipNonEligibleCause(params: {
  supabase: any
  tribunal: string
  rol: string
  caratula: string | null
  sourceDate: string | null
  nowIso: string
}) {
  const { supabase, tribunal, rol, caratula, sourceDate, nowIso } = params
  await supabase.from("gob_audit_logs").insert({
    user_id: null,
    action: "tribunal.cause_sync.skipped_non_eligible",
    target_resource: "gob_tribunal_causes",
    details: {
      tribunal,
      rol,
      caratula,
      source_date: sourceDate,
    },
    timestamp: nowIso,
  })
}

type ExistingTribunalDoc = {
  id: string
  document_type: string | null
  date: string | null
  name: string | null
  url: string | null
  cod_asiento?: string | null
  cod_documento?: string | null
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

function toDateIso(value: unknown) {
  const text = String(value || "").trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  return null
}

function pickTextCandidate(values: unknown[], maxLen = 300) {
  for (const value of values) {
    if (typeof value !== "string") continue
    const text = safeText(value, maxLen)
    if (text) return text
  }
  return ""
}

type TwoTAKeyRole = "reclamacion" | "informe" | "sentencia"

type TwoTADocumentCandidate = {
  role: TwoTAKeyRole
  docId: number
  canonicalType: string
  dateIso: string | null
  name: string
  url: string
}

function dateIsoMs(value: string | null, preferEarliest: boolean) {
  if (!value) return preferEarliest ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return preferEarliest ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
  return d.getTime()
}

function hasToken(text: string, token: string) {
  return new RegExp(`(^|\\s)${token}($|\\s)`).test(text)
}

function classify2TAKeyRoleFromContext(params: {
  tramiteTipo: string | null
  tramiteReferencia: string | null
  tipoEscrito: string | null
  referencia: string | null
  parteText: string | null
  docDescription: string | null
  docName: string | null
}) {
  const role = classifyTribunalDocumentRole({
    documentType: [params.tramiteTipo, params.tipoEscrito].filter(Boolean).join(" "),
    title: [params.tramiteReferencia, params.referencia, params.parteText, params.docDescription]
      .filter(Boolean)
      .join(" "),
    name: params.docName,
  })

  if (role === "reclamacion" || role === "informe" || role === "sentencia") {
    return role satisfies TwoTAKeyRole
  }

  return null
}

function detect2TAKeyRole(params: {
  tramiteTipo: string | null
  tramiteReferencia: string | null
  tipoEscrito: string | null
  referencia: string | null
  parteText: string | null
  docDescription: string | null
  docName: string | null
}): TwoTAKeyRole | null {
  const tramiteTipo = normalizeText(params.tramiteTipo)
  const tramiteRef = normalizeText(params.tramiteReferencia)
  const tipo = normalizeText(params.tipoEscrito)
  const ref = normalizeText(params.referencia)
  const docDescription = normalizeText(params.docDescription)
  const name = normalizeText(params.docName)
  const roleHint = classify2TAKeyRoleFromContext(params)

  const isReclamacionEscrito =
    tipo.includes("reclamacion") ||
    ref.includes("reclamacion") ||
    tipo.includes("escrito inicial") ||
    ref.includes("escrito inicial")
  const hasDemandaAdjunto = docDescription.includes("demanda") || name.includes("demanda")
  const hasReclamacionAdjunto =
    docDescription.includes("reclamacion") ||
    name.includes("reclamacion") ||
    docDescription.includes("escrito inicial") ||
    name.includes("escrito inicial")
  if (isReclamacionEscrito && (hasDemandaAdjunto || hasReclamacionAdjunto || roleHint === "reclamacion")) {
    return "reclamacion"
  }

  const hasInforme =
    tipo.includes("informe") ||
    ref.includes("informe") ||
    tipo.includes("evacua") ||
    tramiteRef.includes("informe")
  const hasEscritoAdjunto =
    docDescription.includes("escrito") ||
    docDescription.includes("informe") ||
    hasToken(name, "escrito") ||
    name.includes("informe")
  if (hasInforme && (hasEscritoAdjunto || roleHint === "informe")) {
    return "informe"
  }

  const isResolucion = tramiteTipo.includes("resolucion")
  const isSentenciaRef =
    tramiteRef.includes("sentencia") || ref.includes("sentencia") || docDescription.includes("sentencia")
  const hasSentenciaDocName = name.includes("sentencia")
  const isSentenciaCertificate =
    (tramiteRef.includes("certific") || ref.includes("certific") || docDescription.includes("certific") ||
      name.includes("certific") ||
      tramiteRef.includes("notific") ||
      ref.includes("notific")) &&
    (isSentenciaRef || hasSentenciaDocName)

  if (!isSentenciaCertificate && ((isResolucion && isSentenciaRef) || (isSentenciaRef && hasSentenciaDocName))) {
    return "sentencia"
  }

  if (roleHint === "reclamacion" && (isReclamacionEscrito || hasDemandaAdjunto || hasReclamacionAdjunto)) {
    return "reclamacion"
  }
  if (roleHint === "informe" && (hasInforme || hasEscritoAdjunto)) {
    return "informe"
  }
  if (roleHint === "sentencia" && !isSentenciaCertificate && (isResolucion || isSentenciaRef || hasSentenciaDocName)) {
    return "sentencia"
  }

  return null
}

function shouldReplaceCandidate(role: TwoTAKeyRole, current: TwoTADocumentCandidate | null, incoming: TwoTADocumentCandidate) {
  if (!current) return true

  if (role === "reclamacion") {
    const currentMs = dateIsoMs(current.dateIso, true)
    const incomingMs = dateIsoMs(incoming.dateIso, true)
    if (incomingMs !== currentMs) return incomingMs < currentMs
    return incoming.docId < current.docId
  }

  const currentMs = dateIsoMs(current.dateIso, false)
  const incomingMs = dateIsoMs(incoming.dateIso, false)
  if (incomingMs !== currentMs) return incomingMs > currentMs
  return incoming.docId > current.docId
}

function pickDocumentDisplayName(params: {
  canonicalType: string
  detailName: string | null
  asientoName: string | null
  tipoDocumento2: string | null
  resuelveDocumento: string | null
}) {
  return (
    safeText(params.detailName, 300) ||
    safeText(params.asientoName, 300) ||
    safeText(params.tipoDocumento2, 220) ||
    safeText(params.resuelveDocumento, 220) ||
    params.canonicalType
  )
}

function isMissingColumnOrRelation(error: any) {
  const message = String(error?.message || "").toLowerCase()
  return message.includes("does not exist") || message.includes("column") || message.includes("relation")
}

function upsertConflictHint(error: any) {
  const message = String(error?.message || "")
  const normalized = message.toLowerCase()
  if (normalized.includes("no unique") && normalized.includes("on conflict")) {
    return `${message}. Missing DB migration: 202602262235_tribunal_causes_composite_unique.sql`
  }
  return message
}

function computeDocKey(params: {
  codAsiento: string | null
  codDocumento: string | null
  documentType: string
  dateIso: string | null
  name: string
  url: string | null
}) {
  const byAsiento = safeText(params.codAsiento, 120)
  if (byAsiento) return `asiento:${byAsiento}`
  const byDocumento = safeText(params.codDocumento, 120)
  if (byDocumento) return `documento:${byDocumento}`
  return [
    normalizeText(params.documentType),
    params.dateIso || "",
    normalizeText(params.name),
    normalizeText(params.url || ""),
  ].join("|")
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
  const d = new Date(text)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function getSourcesBucket() {
  const preferred = String(
    process.env.SUPABASE_SOURCES_BUCKET || process.env.NEXT_PUBLIC_SUPABASE_SOURCES_BUCKET || ""
  ).trim()
  return preferred || "gob_sources"
}

function parseBoolEnv(name: string, fallback: boolean) {
  const raw = String(process.env[name] || "")
    .trim()
    .toLowerCase()
  if (!raw) return fallback
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false
  return fallback
}

function shouldPersist2TAFiles() {
  return parseBoolEnv("TRIBUNAL_2TA_PERSIST_FILES", false)
}

function waitMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetch2TACauseDetailWithRetry(params: {
  session: any
  idCausa: number
  attempts?: number
}) {
  const attempts = Math.max(1, Math.min(6, Number(params.attempts || 4)))
  for (let i = 0; i < attempts; i += 1) {
    try {
      const detail = await fetch2TACauseDetail({ session: params.session, idCausa: params.idCausa })
      if (detail && typeof detail === "object") return detail
    } catch {}

    if (i < attempts - 1) {
      await waitMs(350 * (i + 1))
    }
  }

  return null
}

async function uploadToBucket(
  supabase: any,
  bucket: string,
  path: string,
  data: Buffer,
  contentType: string
) {
  const { error } = await supabase.storage.from(bucket).upload(path, data, {
    contentType,
    upsert: true,
  })
  if (error) throw new Error(`upload failed: ${error.message}`)
}

function normalize2TADocId(value: unknown) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n)
}

function unique2TADocuments(rows: any[]) {
  const out: any[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    if (!row || typeof row !== "object") continue

    const id = normalize2TADocId((row as any)?.id ?? (row as any)?.idDocumento)
    const path = safeText((row as any)?.path, 260)
    const name = safeText((row as any)?.nombre || (row as any)?.name, 260)

    const key = id ? `id:${id}` : path ? `path:${path}` : name ? `name:${normalizeText(name)}` : null
    if (!key || seen.has(key)) continue

    seen.add(key)
    out.push(row)
  }

  return out
}

function extract2TAEscritosFromTramite(tramite: any) {
  const rows = Array.isArray(tramite?.escritos) ? tramite.escritos : []
  return rows.filter((row: any) => row && typeof row === "object")
}

function extract2TADocumentsFromEscrito(row: any) {
  const docs: any[] = []
  if (row?.documento && typeof row.documento === "object") docs.push(row.documento)
  if (Array.isArray(row?.documentos)) docs.push(...row.documentos)
  if (Array.isArray(row?.documentosArchivo)) docs.push(...row.documentosArchivo)
  return unique2TADocuments(docs)
}

function extract2TADocumentsFromTramite(row: any) {
  const docs: any[] = []
  if (row?.documento && typeof row.documento === "object") docs.push(row.documento)
  if (Array.isArray(row?.documentos)) docs.push(...row.documentos)
  return unique2TADocuments(docs)
}

function isPublic2TADocument(row: any) {
  if (!row || typeof row !== "object") return false
  const publico = (row as any).publico
  if (publico === false || String(publico).toLowerCase() === "false") return false
  return true
}

function pick2TAEscritoDocumentForRole(role: TwoTAKeyRole, docs: any[]) {
  const publicDocs = docs.filter((doc) => isPublic2TADocument(doc))
  if (!publicDocs.length) return null

  const withMeta = publicDocs.map((doc) => {
    const description = normalizeText((doc as any)?.descripcion)
    const name = normalizeText((doc as any)?.nombre || (doc as any)?.name)
    return { doc, description, name }
  })

  if (role === "reclamacion") {
    return (
      withMeta.find((item) => item.description.includes("demanda"))?.doc ||
      withMeta.find((item) => item.description.includes("escrito inicial") || item.name.includes("escrito inicial"))
        ?.doc ||
      withMeta.find((item) => item.description.includes("reclamacion"))?.doc ||
      withMeta.find((item) => item.name.includes("demanda") || item.name.includes("reclamacion"))?.doc ||
      withMeta.find((item) => item.description.includes("escrito"))?.doc ||
      withMeta[0]?.doc ||
      null
    )
  }

  if (role === "informe") {
    return (
      withMeta.find((item) => item.description.includes("escrito") && !item.description.includes("reclamacion"))
        ?.doc ||
      withMeta.find((item) => item.name.includes("evacua informe") || item.name.includes("informe"))?.doc ||
      withMeta.find((item) => item.description.includes("informe"))?.doc ||
      withMeta.find((item) => item.description.includes("documento") && item.name.includes("informe"))?.doc ||
      withMeta[0]?.doc ||
      null
    )
  }

  return withMeta.find((item) => item.description.includes("sentencia") || item.name.includes("sentencia"))?.doc || withMeta[0]?.doc || null
}

function extract2TACuadernos(detail: any, causeRow: TwoTACauseRow | null) {
  const candidates = [
    detail?.cuadernos,
    detail?.causa?.cuadernos,
    detail?.ot?.cuadernos,
    detail?.data?.cuadernos,
    causeRow?.cuadernos,
  ]
  const raw = candidates.find((value) => Array.isArray(value)) || []

  return (raw as any[])
    .map((row) => {
      const id = normalize2TADocId((row as any)?.idCuaderno ?? (row as any)?.id ?? (row as any)?.id_cuaderno)
      const name = safeText((row as any)?.nombre || (row as any)?.name || (row as any)?.titulo, 180) || null
      if (!id) return null
      return { id, name }
    })
    .filter(Boolean) as Array<{ id: number; name: string | null }>
}

function resolve2TAEstado(detail: any) {
  return (
    safeText(detail?.estado?.name || detail?.estado?.nombre, 140) ||
    safeText(detail?.estadoCausa || detail?.estado || detail?.estadoNombre, 140) ||
    null
  )
}

function resolve2TAEstadoSubtipo(detail: any) {
  return (
    safeText(detail?.subEstado?.name || detail?.subEstado?.nombre, 140) ||
    safeText(detail?.subEstadoCausa || detail?.estadoSubtipo || detail?.subestado, 140) ||
    null
  )
}

function resolve2TACaratula(params: {
  detail: any
  causeRow: TwoTACauseRow | null
  rol: string
  existingCaratula?: string | null
}) {
  const { detail, causeRow, rol, existingCaratula } = params

  const text = pickTextCandidate(
    [
      detail?.descripcion,
      detail?.caratulaCausa,
      detail?.causa?.descripcion,
      detail?.causa?.caratula,
      detail?.ot?.descripcion,
      detail?.ot?.caratula,
      typeof detail?.caratula === "string" ? detail.caratula : null,
      causeRow?.descripcion,
      existingCaratula,
    ],
    300
  )

  if (text) return text
  return (
    rol
  )
}

function resolve2TAFechaIngreso(detail: any, causeRow: TwoTACauseRow | null) {
  const value =
    (detail &&
      (detail.fechaIngreso ||
        detail.fechaIngresoCausa ||
        detail.fecha ||
        detail?.causa?.fechaIngreso ||
        detail?.ot?.fechaIngreso ||
        detail?.causa?.fechaIngresoCausa ||
        detail?.ot?.fechaIngresoCausa)) ||
    (causeRow && causeRow.fechaIngreso)
  return toIsoDateFlexible(value)
}

function resolve2TACauseIdFromDetail(detail: any) {
  const id = normalize2TADocId(detail?.idCausa ?? detail?.id ?? detail?.causa?.id ?? detail?.ot?.id)
  return id
}

function resolve2TACauseRolFromDetail(detail: any) {
  return safeText(detail?.rol || detail?.causa?.rol || detail?.ot?.rol, 120) || null
}

function resolve2TACauseLink(params: { idCausa: number | null; rol: string | null }) {
  const base = "https://2ta.lexsoft.cl/2ta/search?proc=4"
  const rol = safeText(params.rol, 120)
  const idCausa = Number.isFinite(params.idCausa || NaN) && Number(params.idCausa) > 0 ? String(params.idCausa) : ""

  if (!rol && !idCausa) return base
  const query = [
    rol ? `rol=${encodeURIComponent(rol)}` : "",
    idCausa ? `idCausa=${encodeURIComponent(idCausa)}` : "",
  ]
    .filter(Boolean)
    .join("&")
  return query ? `${base}&${query}` : base
}

function resolve2TADocumentExtension(contentType: string | null, name: string | null) {
  const ct = String(contentType || "").toLowerCase()
  if (ct.includes("pdf")) return "pdf"
  if (ct.includes("wordprocessingml")) return "docx"
  if (ct.includes("msword")) return "doc"
  if (name) {
    const match = String(name).toLowerCase().match(/\.([a-z0-9]{3,5})$/)
    if (match) return match[1]
  }
  return "pdf"
}

async function loadExistingDocs(params: { supabase: any; causeId: string }) {
  const { supabase, causeId } = params

  const first = await supabase
    .from("gob_tribunal_documents")
    .select("id,document_type,date,name,url,cod_asiento,cod_documento")
    .eq("cause_id", causeId)
    .limit(2000)

  if (!first.error) {
    return (Array.isArray(first.data) ? first.data : []) as ExistingTribunalDoc[]
  }

  const fallback = await supabase
    .from("gob_tribunal_documents")
    .select("id,document_type,date,name,url")
    .eq("cause_id", causeId)
    .limit(2000)

  if (fallback.error) throw new Error(fallback.error.message)
  return (Array.isArray(fallback.data) ? fallback.data : []) as ExistingTribunalDoc[]
}

async function insertTribunalDocument(params: {
  supabase: any
  payload: {
    cause_id: string
    document_type: string
    date: string | null
    fojas: string | null
    name: string
    storage_path: string | null
    url: string | null
    cod_asiento: string | null
    cod_documento: string | null
    source_origin: string
    updated_at: string
  }
}) {
  const { supabase, payload } = params

  const withExtended = await supabase.from("gob_tribunal_documents").insert(payload)
  if (!withExtended.error) return null

  if (!isMissingColumnOrRelation(withExtended.error)) {
    throw new Error(withExtended.error.message)
  }

  const legacyPayload = {
    cause_id: payload.cause_id,
    document_type: payload.document_type,
    date: payload.date,
    fojas: payload.fojas,
    name: payload.name,
    storage_path: payload.storage_path,
    url: payload.url,
  }

  const legacy = await supabase.from("gob_tribunal_documents").insert(legacyPayload)
  if (legacy.error) throw new Error(legacy.error.message)
  return null
}

async function recordCauseUpdate(params: {
  supabase: any
  payload: {
    source: string
    source_date: string | null
    tribunal: string
    cause_id: string
    rol: string
    previous_estado: string | null
    current_estado: string | null
    previous_estado_subtipo: string | null
    current_estado_subtipo: string | null
    previous_movimiento: string | null
    current_movimiento: string | null
    has_casacion: boolean
    recurso_tipo: string | null
    metadata: Record<string, any>
  }
}) {
  const { supabase, payload } = params
  const inserted = await supabase.from("gob_tribunal_cause_updates").insert(payload)
  if (!inserted.error) return
  if (isMissingColumnOrRelation(inserted.error)) return
  throw new Error(inserted.error.message)
}

function shouldTrackAsiento(asiento: OneTAAsiento) {
  const roleInfo = pickAsientoKeyRole(asiento)
  if (!roleInfo.strict) return null
  if (roleInfo.role === "documento") return null
  return roleInfo.role
}

async function sync2TACause(params: {
  supabase: any
  job: any
  nowIso: string
  rol: string
  sourceDate: string | null
  existingCause: { id?: string; estado?: string | null; estado_subtipo?: string | null; caratula?: string | null } | null
}) {
  const { supabase, job, nowIso, rol, sourceDate, existingCause } = params
  const session = await create2TASessionForWorker()
  const persist2TAFiles = shouldPersist2TAFiles()
  const idCausaPayload = normalize2TADocId(job.payload?.idCausa)

  let causeRow: TwoTACauseRow | null = null
  let detail: any = null
  let searchError: string | null = null

  if (idCausaPayload) {
    detail = await fetch2TACauseDetailWithRetry({ session, idCausa: idCausaPayload, attempts: 4 })
    const detailRol = resolve2TACauseRolFromDetail(detail)
    const detailId = resolve2TACauseIdFromDetail(detail) || idCausaPayload
    causeRow = {
      id: detailId,
      rol: detailRol || rol,
      descripcion:
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
          300
        ) || null,
      fechaIngreso:
        Number(
          detail?.fechaIngreso ||
            detail?.fechaIngresoCausa ||
            detail?.causa?.fechaIngreso ||
            detail?.ot?.fechaIngreso ||
            detail?.causa?.fechaIngresoCausa ||
            detail?.ot?.fechaIngresoCausa
        ) || null,
      cuadernos: Array.isArray(detail?.cuadernos) ? detail.cuadernos : [],
      procedimiento: detail?.procedimiento || null,
    }
  }

  if (!causeRow || !causeRow.rol) {
    let byRol: TwoTACauseRow | null = null
    try {
      byRol = await fetch2TACauseByRol({ session, rol })
    } catch (err: any) {
      searchError = String(err?.message || err || "2TA search failed").slice(0, 700)
    }

    if (byRol) {
      causeRow = byRol
      if (!detail && byRol.id) {
        detail = await fetch2TACauseDetailWithRetry({ session, idCausa: byRol.id, attempts: 4 })
      }
    }
  }

  if (causeRow && !detail) {
    const retryId = normalize2TADocId(causeRow.id)
    if (retryId) {
      detail = await fetch2TACauseDetailWithRetry({ session, idCausa: retryId, attempts: 3 })
      if (detail) {
        const refreshedRol = resolve2TACauseRolFromDetail(detail)
        if (refreshedRol) causeRow.rol = refreshedRol

        const refreshedDesc = pickTextCandidate(
          [
            detail?.descripcion,
            detail?.caratulaCausa,
            detail?.causa?.descripcion,
            detail?.causa?.caratula,
            detail?.ot?.descripcion,
            detail?.ot?.caratula,
            typeof detail?.caratula === "string" ? detail.caratula : null,
          ],
          300
        )
        if (refreshedDesc) causeRow.descripcion = refreshedDesc

        const refreshedFecha =
          Number(
            detail?.fechaIngreso ||
              detail?.fechaIngresoCausa ||
              detail?.causa?.fechaIngreso ||
              detail?.ot?.fechaIngreso ||
              detail?.causa?.fechaIngresoCausa ||
              detail?.ot?.fechaIngresoCausa
          ) || null
        if (refreshedFecha) causeRow.fechaIngreso = refreshedFecha

        const refreshedCuadernos = extract2TACuadernos(detail, causeRow)
        if (refreshedCuadernos.length) {
          causeRow.cuadernos = refreshedCuadernos as any
        }
      }
    }
  }

  if (!causeRow) {
    await supabase.from("gob_audit_logs").insert({
      user_id: null,
      action: "tribunal.cause_sync.not_found",
      target_resource: "gob_tribunal_causes",
      details: { tribunal: "2TA", rol, source_date: sourceDate, search_error: searchError },
      timestamp: nowIso,
    })
    return
  }

  const resolvedIdCausa = normalize2TADocId(causeRow.id) || resolve2TACauseIdFromDetail(detail)
  const caratula = resolve2TACaratula({
    detail,
    causeRow,
    rol,
    existingCaratula: existingCause?.caratula || null,
  })
  const estado = resolve2TAEstado(detail)
  const estadoSubtipo = resolve2TAEstadoSubtipo(detail)

  if (!isEligibleOnboardingCause({ tribunal: "2TA", caratula })) {
    await auditSkipNonEligibleCause({
      supabase,
      tribunal: "2TA",
      rol,
      caratula,
      sourceDate,
      nowIso,
    })
    return
  }

  const causePayload: any = {
    tribunal: "2TA",
    rol: safeText(causeRow.rol || rol, 120) || rol,
    fecha_ingreso: resolve2TAFechaIngreso(detail, causeRow),
    caratula,
    estado_subtipo: estadoSubtipo,
    estado,
    link_causa: resolve2TACauseLink({ idCausa: resolvedIdCausa, rol: causeRow.rol || rol }),
    last_scraped_at: nowIso,
    updated_at: nowIso,
  }
  if (existingCause?.id) {
    causePayload.id = String(existingCause.id)
  }

  const { data: causeRowUpsert, error: causeUpsertErr } = await supabase
    .from("gob_tribunal_causes")
    .upsert(causePayload, { onConflict: "tribunal,rol" })
    .select("id")
    .single()

  if (causeUpsertErr || !causeRowUpsert?.id) {
    throw new Error(upsertConflictHint(causeUpsertErr) || "Could not upsert tribunal cause")
  }

  const causeId = String(causeRowUpsert.id)
  const existingDocs = await loadExistingDocs({ supabase, causeId })
  const existingKeys = new Set<string>()

  for (const doc of existingDocs) {
    const key = computeDocKey({
      codAsiento: doc.cod_asiento || null,
      codDocumento: doc.cod_documento || null,
      documentType: safeText(doc.document_type || "", 140),
      dateIso: doc.date ? String(doc.date) : null,
      name: safeText(doc.name || "", 260),
      url: doc.url ? String(doc.url) : null,
    })
    existingKeys.add(key)
  }

  const insertedDocs: Array<{
    role: string
    documentType: string
    date: string | null
    name: string
    url: string | null
  }> = []

  const selectedByRole = new Map<TwoTAKeyRole, TwoTADocumentCandidate>()

  const cuadernos = extract2TACuadernos(detail, causeRow)
  for (const cuaderno of cuadernos.slice(0, 8)) {
    const pageSize = 200
    const maxPages = 8
    const tramites: any[] = []

    for (let page = 1; page <= maxPages; page += 1) {
      const batch = await fetch2TATramitesByCuaderno({
        session,
        idCuaderno: cuaderno.id,
        pageSize,
        page,
        isPublic: true,
      }).catch(() => ({ results: [] as any[], resultsCount: 0 }))

      const rows = Array.isArray(batch.results) ? batch.results : []
      if (!rows.length) break

      tramites.push(...rows)

      const hint = Number(batch.resultsCount || 0)
      const reachedHint = hint > 0 && page * pageSize >= hint
      if (rows.length < pageSize || reachedHint) break
    }

    for (const tramite of tramites) {
      const tramiteTipo = safeText((tramite as any)?.tipoTramite?.name, 160) || null
      const tramiteReferencia = safeText((tramite as any)?.referencia, 260) || null
      const tramiteDateIso = toIsoDateFlexible((tramite as any)?.fechaIngreso || (tramite as any)?.fecha)

      const tramiteDocs = extract2TADocumentsFromTramite(tramite)
      for (const doc of tramiteDocs) {
        if (!isPublic2TADocument(doc)) continue

        const docId = normalize2TADocId((doc as any)?.id ?? (doc as any)?.idDocumento)
        if (!docId) continue

        const docName = safeText((doc as any)?.nombre || (doc as any)?.name, 300) || null
        const docDescription = safeText((doc as any)?.descripcion, 120) || null

        const role = detect2TAKeyRole({
          tramiteTipo,
          tramiteReferencia,
          tipoEscrito: null,
          referencia: null,
          parteText: null,
          docDescription,
          docName,
        })
        if (role !== "sentencia") continue

        const canonicalType = canonicalRoleLabel(role)
        const name = docName || safeText(tramiteReferencia, 300) || canonicalType
        const dateIso = toIsoDateFlexible((doc as any)?.fechaIngreso || (doc as any)?.fecha || tramiteDateIso)
        const url = `https://2ta.lexsoft.cl/2ta/download/${docId}`

        const candidate: TwoTADocumentCandidate = {
          role,
          docId,
          canonicalType,
          dateIso,
          name,
          url,
        }

        const previous = selectedByRole.get(role) || null
        if (shouldReplaceCandidate(role, previous, candidate)) {
          selectedByRole.set(role, candidate)
        }
      }

      const escritos = extract2TAEscritosFromTramite(tramite)
      for (const escrito of escritos) {
        const tipoEscrito = safeText((escrito as any)?.tipoEscrito?.name, 160) || null
        const referencia = safeText((escrito as any)?.referencia, 260) || null
        const parteText =
          safeText(
            (escrito as any)?.parteQuePresenta?.razonSocial ||
              (escrito as any)?.parteQuePresenta?.nombre ||
              (escrito as any)?.parteQuePresenta?.nombreCompleto ||
              (escrito as any)?.nombreParte ||
              (tramite as any)?.persona?.razonSocial ||
              (tramite as any)?.persona?.nombre,
            220
          ) || null

        const docs = extract2TADocumentsFromEscrito(escrito)
        const tipoNorm = normalizeText(tipoEscrito)
        const refNorm = normalizeText(referencia)
        const tramiteRefNorm = normalizeText(tramiteReferencia)

        const roleHint = classify2TAKeyRoleFromContext({
          tramiteTipo,
          tramiteReferencia,
          tipoEscrito,
          referencia,
          parteText,
          docDescription: null,
          docName: null,
        })

        const isReclamacionEscrito =
          tipoNorm.includes("reclamacion") ||
          refNorm.includes("reclamacion") ||
          tipoNorm.includes("escrito inicial") ||
          refNorm.includes("escrito inicial")
        const isInformeEscrito =
          tipoNorm.includes("informe") ||
          refNorm.includes("informe") ||
          tipoNorm.includes("evacua") ||
          tramiteRefNorm.includes("informe")

        let targetRole: TwoTAKeyRole | null = null
        if (isReclamacionEscrito || roleHint === "reclamacion") {
          targetRole = "reclamacion"
        } else if (isInformeEscrito || roleHint === "informe") {
          targetRole = "informe"
        }

        if (!targetRole) {
          for (const doc of docs) {
            const docRole = detect2TAKeyRole({
              tramiteTipo,
              tramiteReferencia,
              tipoEscrito,
              referencia,
              parteText,
              docDescription: safeText((doc as any)?.descripcion, 120) || null,
              docName: safeText((doc as any)?.nombre || (doc as any)?.name, 300) || null,
            })
            if (docRole === "reclamacion" || docRole === "informe") {
              targetRole = docRole
              break
            }
          }
        }

        if (!targetRole) continue

        const pickedDoc = pick2TAEscritoDocumentForRole(targetRole, docs)
        if (!pickedDoc) continue

        const docId = normalize2TADocId((pickedDoc as any)?.id ?? (pickedDoc as any)?.idDocumento)
        if (!docId) continue

        const docName = safeText((pickedDoc as any)?.nombre || (pickedDoc as any)?.name, 300) || null
        const canonicalType = canonicalRoleLabel(targetRole)
        const name =
          docName ||
          safeText(referencia, 300) ||
          safeText(tipoEscrito, 220) ||
          safeText(tramiteReferencia, 220) ||
          canonicalType

        const dateIso = toIsoDateFlexible(
          (escrito as any)?.fechaIngreso ||
            (pickedDoc as any)?.fechaIngreso ||
            (pickedDoc as any)?.fecha ||
            (tramite as any)?.fechaIngreso
        )
        const url = `https://2ta.lexsoft.cl/2ta/download/${docId}`

        const candidate: TwoTADocumentCandidate = {
          role: targetRole,
          docId,
          canonicalType,
          dateIso,
          name,
          url,
        }

        const previous = selectedByRole.get(targetRole) || null
        if (shouldReplaceCandidate(targetRole, previous, candidate)) {
          selectedByRole.set(targetRole, candidate)
        }
      }
    }
  }

  for (const role of ["reclamacion", "informe", "sentencia"] as const) {
    const candidate = selectedByRole.get(role)
    if (!candidate) continue

    const key = computeDocKey({
      codAsiento: null,
      codDocumento: String(candidate.docId),
      documentType: candidate.canonicalType,
      dateIso: candidate.dateIso,
      name: candidate.name,
      url: candidate.url,
    })
    if (existingKeys.has(key)) continue

    let storagePath: string | null = null
    if (persist2TAFiles) {
      try {
        const { buffer, contentType } = await download2TADocument({ session, documentId: candidate.docId })
        const ext = resolve2TADocumentExtension(contentType, candidate.name)
        const path = `tribunal/2ta/${causeId}/doc-${candidate.docId}.${ext}`
        await uploadToBucket(supabase, getSourcesBucket(), path, buffer, contentType || "application/pdf")
        storagePath = path
      } catch {
        storagePath = null
      }
    }

    await insertTribunalDocument({
      supabase,
      payload: {
        cause_id: causeId,
        document_type: candidate.canonicalType,
        date: candidate.dateIso,
        fojas: null,
        name: candidate.name,
        storage_path: storagePath,
        url: candidate.url,
        cod_asiento: null,
        cod_documento: String(candidate.docId),
        source_origin: "estado_diario",
        updated_at: nowIso,
      },
    })

    existingKeys.add(key)
    insertedDocs.push({
      role,
      documentType: candidate.canonicalType,
      date: candidate.dateIso,
      name: candidate.name,
      url: candidate.url,
    })
  }

  const stateChanged =
    String(existingCause?.estado || "") !== String(estado || "") ||
    String(existingCause?.estado_subtipo || "") !== String(estadoSubtipo || "")

  if (stateChanged || insertedDocs.length) {
    await recordCauseUpdate({
      supabase,
      payload: {
        source: "estado_diario",
        source_date: sourceDate,
        tribunal: "2TA",
        cause_id: causeId,
        rol: causePayload.rol,
        previous_estado: existingCause?.estado ? String(existingCause.estado) : null,
        current_estado: estado || null,
        previous_estado_subtipo: existingCause?.estado_subtipo ? String(existingCause.estado_subtipo) : null,
        current_estado_subtipo: estadoSubtipo || null,
        previous_movimiento: null,
        current_movimiento: null,
        has_casacion: false,
        recurso_tipo: null,
        metadata: {
          source_date: sourceDate,
          source_id_causa_2ta: resolvedIdCausa || null,
          persist_storage_files: persist2TAFiles,
          inserted_documents: insertedDocs,
        },
      },
    })
  }

  await supabase.from("gob_audit_logs").insert({
    user_id: null,
    action: "tribunal.cause_sync.ok",
    target_resource: "gob_tribunal_causes",
    details: {
      tribunal: "2TA",
      rol: causePayload.rol,
      source_date: sourceDate,
      state_changed: stateChanged,
      inserted_documents: insertedDocs.length,
      id_causa_2ta: resolvedIdCausa || null,
      persist_storage_files: persist2TAFiles,
    },
    timestamp: nowIso,
  })
}

export async function tribunalCauseSyncJob(params: { supabase: any; job: any }) {
  const { supabase, job } = params
  const nowIso = new Date().toISOString()

  const tribunal = String(job.payload?.tribunal || "1TA").trim() || "1TA"
  const rol = safeText(job.payload?.rol, 120)
  const sourceDate = toDateIso(job.payload?.date)

  if (!rol) throw new Error("Missing rol in tribunal_cause_sync payload")

  const { data: existingCause, error: existingCauseErr } = await supabase
    .from("gob_tribunal_causes")
    .select("id,estado,estado_subtipo,caratula")
    .eq("tribunal", tribunal)
    .eq("rol", rol)
    .maybeSingle()

  if (existingCauseErr) throw new Error(existingCauseErr.message)

  if (tribunal === "2TA") {
    await sync2TACause({ supabase, job, nowIso, rol, sourceDate, existingCause })
    return
  }

  const snapshot = await fetch1TACauseSnapshotByRol({ rol })

  if (!snapshot.found) {
    await supabase.from("gob_audit_logs").insert({
      user_id: null,
      action: "tribunal.cause_sync.not_found",
      target_resource: "gob_tribunal_causes",
      details: { tribunal, rol, source_date: sourceDate },
      timestamp: nowIso,
    })
    return
  }

  const caratula = snapshot.caratula || existingCause?.caratula || rol
  if (!isEligibleOnboardingCause({ tribunal, caratula })) {
    await auditSkipNonEligibleCause({
      supabase,
      tribunal,
      rol,
      caratula,
      sourceDate,
      nowIso,
    })
    return
  }

  const causePayload: any = {
    tribunal,
    rol: snapshot.rol,
    fecha_ingreso: snapshot.fechaIngreso,
    caratula,
    estado_subtipo: snapshot.estadoSubtipo,
    estado: snapshot.estado,
    link_causa: snapshot.linkCausa,
    last_scraped_at: nowIso,
    updated_at: nowIso,
  }
  if (existingCause?.id) {
    causePayload.id = String(existingCause.id)
  }

  const { data: causeRow, error: causeUpsertErr } = await supabase
    .from("gob_tribunal_causes")
    .upsert(causePayload, { onConflict: "tribunal,rol" })
    .select("id")
    .single()

  if (causeUpsertErr || !causeRow?.id) {
    throw new Error(upsertConflictHint(causeUpsertErr) || "Could not upsert tribunal cause")
  }

  const causeId = String(causeRow.id)
  const idCausa = safeText(job.payload?.idCausa || snapshot.idCausa || "", 120)
  const resolvedIdCausa = idCausa || (await fetch1TACauseIdByRol({ rol }))

  const insertedDocs: Array<{
    role: string
    documentType: string
    date: string | null
    name: string
    url: string | null
  }> = []

  if (resolvedIdCausa) {
    const cuadernos = await fetch1TACuadernos({ idCausa: resolvedIdCausa })
    let asientos: OneTAAsiento[] = []
    for (const cuaderno of cuadernos.slice(0, 8)) {
      const rows = await fetch1TAAsientos({ idCuaderno: cuaderno.idCuaderno })
      asientos = asientos.concat(rows)
    }

    const existingDocs = await loadExistingDocs({ supabase, causeId })
    const existingKeys = new Set<string>()

    for (const doc of existingDocs) {
      const key = computeDocKey({
        codAsiento: doc.cod_asiento || null,
        codDocumento: doc.cod_documento || null,
        documentType: safeText(doc.document_type || "", 140),
        dateIso: doc.date ? String(doc.date) : null,
        name: safeText(doc.name || "", 260),
        url: doc.url ? String(doc.url) : null,
      })
      existingKeys.add(key)
    }

    for (const asiento of asientos) {
      const role = shouldTrackAsiento(asiento)
      if (!role) continue

      const details = await fetch1TAAsientoDocumentDetails({ asiento: asiento.codAsiento })
      const preferredDetail =
        details.find((row) => normalizeText(row.tipoArchivo).includes("documento")) || details[0] || null
      if (!preferredDetail) continue

      const filePath = pickDocumentFilePath(preferredDetail)
      if (!filePath) continue

      const canonicalType = canonicalRoleLabel(role)
      const dateIso = toIsoDateFromTribunal(asiento.fechaDocumento)
      const name = pickDocumentDisplayName({
        canonicalType,
        detailName: preferredDetail.nombreDocumento,
        asientoName: asiento.nombreDocumento,
        tipoDocumento2: asiento.tipoDocumento2,
        resuelveDocumento: asiento.resuelveDocumento,
      })

      const viewerUrl = build1TAViewerUrl(filePath)
      const downloadUrl = build1TADownloadUrl(filePath)
      const bestUrl = viewerUrl || downloadUrl

      const key = computeDocKey({
        codAsiento: asiento.codAsiento,
        codDocumento: preferredDetail.codDocumento || asiento.codDocumento || null,
        documentType: canonicalType,
        dateIso,
        name,
        url: bestUrl,
      })

      if (existingKeys.has(key)) continue

      await insertTribunalDocument({
        supabase,
        payload: {
          cause_id: causeId,
          document_type: canonicalType,
          date: dateIso,
          fojas: safeText(asiento.fojasDocumento, 80) || null,
          name,
          storage_path: null,
          url: bestUrl,
          cod_asiento: safeText(asiento.codAsiento, 120) || null,
          cod_documento: safeText(preferredDetail.codDocumento || asiento.codDocumento || "", 120) || null,
          source_origin: "estado_diario",
          updated_at: nowIso,
        },
      })

      existingKeys.add(key)
      insertedDocs.push({
        role,
        documentType: canonicalType,
        date: dateIso,
        name,
        url: bestUrl,
      })
    }
  }

  const stateChanged =
    String(existingCause?.estado || "") !== String(snapshot.estado || "") ||
    String(existingCause?.estado_subtipo || "") !== String(snapshot.estadoSubtipo || "")

  if (stateChanged || insertedDocs.length) {
    await recordCauseUpdate({
      supabase,
      payload: {
        source: "estado_diario",
        source_date: sourceDate,
        tribunal,
        cause_id: causeId,
        rol,
        previous_estado: existingCause?.estado ? String(existingCause.estado) : null,
        current_estado: snapshot.estado || null,
        previous_estado_subtipo: existingCause?.estado_subtipo ? String(existingCause.estado_subtipo) : null,
        current_estado_subtipo: snapshot.estadoSubtipo || null,
        previous_movimiento: null,
        current_movimiento: snapshot.latestMovement?.label || null,
        has_casacion: Boolean(snapshot.hasCasacion),
        recurso_tipo: snapshot.recursoTipo || null,
        metadata: {
          source_date: sourceDate,
          source_id_causa_1ta: resolvedIdCausa || null,
          latest_movement_date: snapshot.latestMovement?.date || null,
          latest_movement_actor: snapshot.latestMovement?.actor || null,
          movement_count: snapshot.movementCount,
          inserted_documents: insertedDocs,
        },
      },
    })
  }

  await supabase.from("gob_audit_logs").insert({
    user_id: null,
    action: "tribunal.cause_sync.ok",
    target_resource: "gob_tribunal_causes",
    details: {
      tribunal,
      rol,
      source_date: sourceDate,
      state_changed: stateChanged,
      inserted_documents: insertedDocs.length,
      id_causa_1ta: resolvedIdCausa || null,
    },
    timestamp: nowIso,
  })
}
