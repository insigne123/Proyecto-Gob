import nodemailer from "nodemailer"

import { OPERATING_TIMEZONE, nextDailyAt } from "../../lib/timezone"

type SectionKey =
  | "tribunal_constitucional"
  | "corte_suprema"
  | "corte_apelaciones"
  | "tribunales_ambientales"
  | "causas_civiles"
  | "nuevos_ingresos"
  | "causas_dominga"
  | "causas_tramitacion"

type NormalizedRow = {
  section: SectionKey
  tribunal: string | null
  corte: string | null
  rol: string | null
  proyecto: string | null
  caratula: string | null
  contenido: string | null
  estado: string | null
  raw: Record<string, any>
}

type ChangeHighlight = {
  kind: "modified" | "added" | "removed" | "tribunal"
  title: string
  subtitle?: string | null
  items: string[]
}

function safeArray<T>(v: any): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function safeText(value: unknown, maxLen = 2200) {
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

function htmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
}

function summarizeRuns(runs: any[]) {
  let added = 0
  let removed = 0
  let modified = 0
  let tribunalChanged = 0
  for (const r of runs) {
    const s = r.summary || {}
    added += Number(s.added || 0)
    removed += Number(s.removed || 0)
    modified += Number(s.modified || 0)
    tribunalChanged += Number(s?.tribunal_monitoring?.changed_cases || 0)
  }
  return { added, removed, modified, tribunalChanged }
}

function rowEntries(row: Record<string, any>) {
  return Object.entries(row || {}).map(([key, value]) => ({
    key,
    keyNorm: normalizeText(key),
    value: safeText(value),
  }))
}

function pickByHeaders(entries: ReturnType<typeof rowEntries>, hints: string[]) {
  const hintNorm = hints.map((h) => normalizeText(h))
  for (const entry of entries) {
    if (!entry.value) continue
    if (hintNorm.some((hint) => entry.keyNorm.includes(hint))) {
      return entry.value
    }
  }
  return ""
}

function pickAnyValue(entries: ReturnType<typeof rowEntries>) {
  for (const entry of entries) {
    if (entry.value) return entry.value
  }
  return ""
}

function detectSectionByLabel(label: string): SectionKey | null {
  const n = normalizeText(label)
  if (!n) return null
  if (n.includes("tribunal constitucional") || n === "tc") return "tribunal_constitucional"
  if (n.includes("corte suprema") || n === "cs") return "corte_suprema"
  if (n.includes("corte apelaciones") || n.includes("ica")) return "corte_apelaciones"
  if (n.includes("tribunales ambientales") || n.includes("tribunal ambiental")) return "tribunales_ambientales"
  if (n.includes("causas civiles") || n.includes("civil")) return "causas_civiles"
  if (n.includes("nuevos ingresos") || n.includes("nuevo ingreso")) return "nuevos_ingresos"
  if (n.includes("causas dominga") || n.includes("dominga")) return "causas_dominga"
  if (n.includes("causas en tramitacion") || n.includes("tramitacion")) return "causas_tramitacion"
  return null
}

function detectSectionFromRow(params: {
  row: Record<string, any>
  tribunal: string
  corte: string
  contenido: string
  proyecto: string
}) {
  const entries = rowEntries(params.row)
  const explicit = pickByHeaders(entries, ["seccion", "categoria", "modulo", "bloque", "grupo", "tabla", "capitulo"])
  const fromExplicit = detectSectionByLabel(explicit)
  if (fromExplicit) return fromExplicit

  const merged = normalizeText(
    [params.tribunal, params.corte, params.contenido, params.proyecto, pickAnyValue(entries)].join(" ")
  )

  if (merged.includes("tribunal constitucional") || merged.includes(" ina")) return "tribunal_constitucional"
  if (merged.includes("corte suprema") || merged.includes(" cs ")) return "corte_suprema"
  if (merged.includes("corte apelaciones") || merged.includes("ica")) return "corte_apelaciones"
  if (merged.includes("causas dominga") || merged.includes("dominga")) return "causas_dominga"
  if (merged.includes("causas civiles") || merged.includes("civil")) return "causas_civiles"
  if (merged.includes("nuevos ingresos") || merged.includes("nuevo ingreso")) return "nuevos_ingresos"
  if (merged.includes("causas en tramitacion") || merged.includes("tramitacion")) return "causas_tramitacion"

  const tribunalNorm = normalizeText(params.tribunal)
  if (
    tribunalNorm.includes("1ta") ||
    tribunalNorm.includes("2ta") ||
    tribunalNorm.includes("3ta") ||
    tribunalNorm.includes("tribunal ambiental")
  ) {
    return "tribunales_ambientales"
  }

  if (tribunalNorm.includes("tc")) return "tribunal_constitucional"
  if (tribunalNorm.includes("cs")) return "corte_suprema"

  return "tribunales_ambientales"
}

function parseBullets(value: string) {
  const raw = String(value || "")
  const parts = raw
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .flatMap((line) => line.split(/[;|]/g))
    .map((line) => line.replace(/^[-*\u2022\s]+/, "").trim())
    .filter(Boolean)

  if (!parts.length) return [] as string[]
  if (parts.length === 1) {
    const x = parts[0]
    if (x.length > 180 && x.includes(". ")) {
      return x
        .split(". ")
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .map((chunk) => (chunk.endsWith(".") ? chunk : `${chunk}.`))
        .slice(0, 10)
    }
  }
  return parts.slice(0, 12)
}

function valueByKeyNorm(
  entries: ReturnType<typeof rowEntries>,
  exact: string[],
  contains: string[] = []
) {
  const exactNorm = exact.map((x) => normalizeText(x))
  const containsNorm = contains.map((x) => normalizeText(x))

  for (const entry of entries) {
    if (!entry.value) continue
    if (exactNorm.includes(entry.keyNorm)) return entry.value
  }

  for (const entry of entries) {
    if (!entry.value) continue
    if (containsNorm.some((token) => entry.keyNorm.includes(token))) return entry.value
  }

  return ""
}

function parseDate(value: string) {
  const raw = safeText(value, 80)
  if (!raw) return null

  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (us) {
    const mm = us[1].padStart(2, "0")
    const dd = us[2].padStart(2, "0")
    const yyyy = us[3]
    const iso = `${yyyy}-${mm}-${dd}`
    const d = new Date(iso)
    if (!Number.isNaN(d.getTime())) return d
  }

  const cl = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (cl) {
    const dd = cl[1].padStart(2, "0")
    const mm = cl[2].padStart(2, "0")
    const yyyy = cl[3]
    const iso = `${yyyy}-${mm}-${dd}`
    const d = new Date(iso)
    if (!Number.isNaN(d.getTime())) return d
  }

  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return d
}

function isPlaceholder(value: string) {
  const n = normalizeText(value)
  if (!n) return true
  return (
    n === "pend" ||
    n === "pendiente" ||
    n === "n a" ||
    n === "na" ||
    n === "n a n a" ||
    n === "-" ||
    n === "otro" ||
    n === "no" ||
    n === "sin novedades"
  )
}

function tribunalLabel(value: string) {
  const n = normalizeText(value)
  if (!n) return ""
  if (n.includes("primero") || n === "1" || n === "1ta") return "1TA"
  if (n.includes("segundo") || n === "2" || n === "2ta") return "2TA"
  if (n.includes("tercero") || n === "3" || n === "3ta") return "3TA"
  return safeText(value, 40)
}

function corteLabelByRegion(region: string) {
  const n = normalizeText(region)
  if (!n) return "ICA"
  if (n.includes("atacama")) return "ICA Copiapo"
  if (n.includes("antofagasta")) return "ICA Antofagasta"
  if (n.includes("coquimbo")) return "ICA La Serena"
  if (n.includes("valparaiso")) return "ICA Valparaiso"
  if (n.includes("ohiggins") || n.includes("higgins")) return "ICA Rancagua"
  if (n.includes("biobio")) return "ICA Concepcion"
  if (n.includes("araucania")) return "ICA Temuco"
  if (n.includes("los lagos")) return "ICA Puerto Montt"
  return `ICA ${safeText(region, 40)}`
}

function hasSeaParty(text: string) {
  const n = normalizeText(text)
  if (!n) return false
  if (n.includes("servicio de evaluacion ambiental")) return true
  if (n.includes("direccion ejecutiva del servicio de evaluacion ambiental")) return true
  if (n.includes("direccion regional del servicio de evaluacion ambiental")) return true
  return /(^|\s)sea(\s|$)/.test(n)
}

function buildSupremaContent(params: {
  caratula: string
  recurrentes: string
  recurrida: string
  estado: string
  observaciones: string
  resultadoCorte: string
  materias: string
}) {
  const merged = [params.caratula, params.recurrentes, params.recurrida].join(" ")
  if (hasSeaParty(merged)) return "SEA se hace parte"
  if (!isPlaceholder(params.resultadoCorte)) return params.resultadoCorte
  if (!isPlaceholder(params.estado)) return params.estado
  if (!isPlaceholder(params.observaciones)) return params.observaciones
  if (!isPlaceholder(params.materias)) return params.materias
  return "Seguimiento en Corte Suprema"
}

function buildAmbientalContent(params: {
  estado: string
  observaciones: string
  resultadoTa: string
  fechaEvacuado: string
}) {
  const estadoNorm = normalizeText(params.estado)
  const obsNorm = normalizeText(params.observaciones)

  if (
    estadoNorm.includes("sentencia ta") ||
    obsNorm.includes("sentencia ta") ||
    (!isPlaceholder(params.resultadoTa) && normalizeText(params.resultadoTa) !== "pend")
  ) {
    const result = !isPlaceholder(params.resultadoTa)
      ? params.resultadoTa
      : !isPlaceholder(params.estado)
        ? params.estado
        : "sentencia emitida"

    const informed = obsNorm.includes("informada") ? " (ya informada)" : ""
    return `Sentencia: ${result}${informed}`
  }

  if (!isPlaceholder(params.fechaEvacuado)) {
    return "Se tiene por evacuado el informe SEA"
  }

  if (
    estadoNorm.includes("alegatos") ||
    estadoNorm.includes("en acuerdo") ||
    estadoNorm.includes("pendiente admisibilidad")
  ) {
    return params.estado
  }

  return ""
}

function isTramitacionState(value: string) {
  const n = normalizeText(value)
  if (!n) return false
  return (
    n.includes("pendiente") ||
    n.includes("en estudio") ||
    n.includes("en acuerdo") ||
    n.includes("alegatos") ||
    n.includes("sdp") ||
    n.includes("en relacion") ||
    n.includes("suspendido")
  )
}

function normalizeSnapshotRows(snapshotRows: any[], params: { since: Date; now: Date }) {
  const rows: NormalizedRow[] = []

  const domingaRawRows: Array<{
    tribunal: string
    rol: string
    rolIca: string
    rolCs: string
    estado: string
    observaciones: string
  }> = []

  for (const item of snapshotRows || []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue
    const raw = item as Record<string, any>
    const entries = rowEntries(raw)

    const region = valueByKeyNorm(entries, ["region"], ["region"]) || ""
    const proyecto = valueByKeyNorm(entries, ["proyecto"], ["proyecto"]) || ""
    const tribunalRaw = valueByKeyNorm(entries, ["tribunal"], ["tribunal"]) || ""
    const tribunal = tribunalLabel(tribunalRaw)
    const rolTa = valueByKeyNorm(entries, ["rol"], ["rol "]) || ""
    const caratula = valueByKeyNorm(entries, ["caratula"], ["caratula"]) || ""
    const estado = valueByKeyNorm(entries, ["estado"], ["estado"]) || ""
    const observaciones = valueByKeyNorm(entries, ["observaciones"], ["observaciones"]) || ""
    const resultadoTa = valueByKeyNorm(entries, ["resultado sentencia"], ["resultado sentencia "]) || ""
    const resultadoCorte = valueByKeyNorm(entries, ["resultado sentencia corte"], ["resultado sentencia corte"]) || ""
    const fechaEvacuado = valueByKeyNorm(
      entries,
      ["fecha resolucion que tuvo por evacuado informe"],
      ["evacuado informe"]
    )
    const fechaIngreso = valueByKeyNorm(entries, ["ingreso recurso"], ["ingreso recurso"]) || ""
    const rolIca = valueByKeyNorm(entries, ["rol ica"], ["rol ica"]) || ""
    const rolCs = valueByKeyNorm(entries, ["rol cs"], ["rol cs"]) || ""
    const recurrentes = valueByKeyNorm(entries, ["recurrente s"], ["recurrente"]) || ""
    const recurrida = valueByKeyNorm(entries, ["recurrida"], ["recurrida"]) || ""
    const materias = valueByKeyNorm(entries, ["materias"], ["materias "]) || ""
    const activa = valueByKeyNorm(entries, ["activa"], ["activa"]) || ""

    const isActive = normalizeText(activa) !== "inactiva"

    if (rolCs && !isPlaceholder(rolCs)) {
      rows.push({
        section: "corte_suprema",
        tribunal: null,
        corte: "Corte Suprema",
        rol: rolCs,
        proyecto: proyecto || null,
        caratula: caratula || null,
        contenido: buildSupremaContent({
          caratula,
          recurrentes,
          recurrida,
          estado,
          observaciones,
          resultadoCorte,
          materias,
        }),
        estado: estado || null,
        raw,
      })
    }

    if (rolIca && !isPlaceholder(rolIca)) {
      rows.push({
        section: "corte_apelaciones",
        tribunal: null,
        corte: corteLabelByRegion(region),
        rol: rolIca,
        proyecto: proyecto || null,
        caratula: caratula || null,
        contenido: !isPlaceholder(estado)
          ? estado
          : !isPlaceholder(observaciones)
            ? observaciones
            : !isPlaceholder(materias)
              ? materias
              : "Sin novedad relevante",
        estado: estado || null,
        raw,
      })
    }

    if (tribunal && rolTa && !isPlaceholder(rolTa) && isActive) {
      const ambientContent = buildAmbientalContent({
        estado,
        observaciones,
        resultadoTa,
        fechaEvacuado,
      })

      if (ambientContent) {
        rows.push({
          section: "tribunales_ambientales",
          tribunal,
          corte: null,
          rol: rolTa,
          proyecto: proyecto || null,
          caratula: caratula || null,
          contenido: ambientContent,
          estado: estado || null,
          raw,
        })
      }

      if (isTramitacionState(estado)) {
        rows.push({
          section: "causas_tramitacion",
          tribunal,
          corte: null,
          rol: rolTa,
          proyecto: proyecto || null,
          caratula: caratula || null,
          contenido: null,
          estado: estado,
          raw,
        })
      }

      const ingresoDate = parseDate(fechaIngreso)
      if (ingresoDate && ingresoDate.getTime() >= params.since.getTime() && ingresoDate <= params.now) {
        rows.push({
          section: "nuevos_ingresos",
          tribunal,
          corte: null,
          rol: rolTa,
          proyecto: proyecto || null,
          caratula: caratula || null,
          contenido: null,
          estado: estado || null,
          raw,
        })
      }
    }

    const domingaMark = normalizeText(`${proyecto} ${caratula}`)
    if (domingaMark.includes("dominga")) {
      domingaRawRows.push({
        tribunal,
        rol: rolTa,
        rolIca,
        rolCs,
        estado,
        observaciones,
      })
    }
  }

  const hasAmbiental = new Set(
    rows
      .filter((row) => row.section === "tribunales_ambientales")
      .map((row) => String(row.tribunal || ""))
      .filter(Boolean)
  )

  for (const tribunal of ["1TA", "2TA", "3TA"]) {
    if (hasAmbiental.has(tribunal)) continue
    rows.push({
      section: "tribunales_ambientales",
      tribunal,
      corte: null,
      rol: "Sin novedades",
      proyecto: "-",
      caratula: null,
      contenido: "-",
      estado: null,
      raw: {},
    })
  }

  const domingaSignals = {
    cs: domingaRawRows.find((row) => row.rolCs && !isPlaceholder(row.rolCs)),
    tc: null as null,
    ica: domingaRawRows.find((row) => row.rolIca && !isPlaceholder(row.rolIca)),
    ta2: domingaRawRows.find((row) => row.tribunal === "2TA" && !isPlaceholder(row.estado)),
  }

  rows.push({
    section: "causas_dominga",
    tribunal: "CS",
    corte: null,
    rol: domingaSignals.cs?.rolCs || "Sin novedades",
    proyecto: null,
    caratula: null,
    contenido: domingaSignals.cs?.estado || "",
    estado: null,
    raw: {},
  })
  rows.push({
    section: "causas_dominga",
    tribunal: "TC",
    corte: null,
    rol: "Sin novedades",
    proyecto: null,
    caratula: null,
    contenido: "",
    estado: null,
    raw: {},
  })
  rows.push({
    section: "causas_dominga",
    tribunal: "ICA Antofagasta",
    corte: null,
    rol: domingaSignals.ica?.rolIca || "Sin novedades",
    proyecto: null,
    caratula: null,
    contenido: domingaSignals.ica?.estado || "",
    estado: null,
    raw: {},
  })
  rows.push({
    section: "causas_dominga",
    tribunal: "2TA",
    corte: null,
    rol: domingaSignals.ta2?.rol || "Sin novedades",
    proyecto: null,
    caratula: null,
    contenido: domingaSignals.ta2?.estado || "",
    estado: null,
    raw: {},
  })

  return rows
}

const SECTION_ORDER: SectionKey[] = [
  "tribunal_constitucional",
  "corte_suprema",
  "corte_apelaciones",
  "tribunales_ambientales",
  "causas_civiles",
  "nuevos_ingresos",
  "causas_dominga",
  "causas_tramitacion",
]

const SECTION_TITLE: Record<SectionKey, string> = {
  tribunal_constitucional: "Tribunal Constitucional",
  corte_suprema: "Corte Suprema",
  corte_apelaciones: "Corte Apelaciones",
  tribunales_ambientales: "Tribunales Ambientales",
  causas_civiles: "Causas civiles",
  nuevos_ingresos: "Nuevos ingresos",
  causas_dominga: "Causas Dominga",
  causas_tramitacion: "Causas en tramitacion",
}

type ColumnDef = {
  label: string
  getValue: (row: NormalizedRow) => string
  bullet?: boolean
}

const SECTION_COLUMNS: Record<SectionKey, ColumnDef[]> = {
  tribunal_constitucional: [
    { label: "Rol", getValue: (row) => row.rol || "" },
    { label: "Proyecto", getValue: (row) => row.proyecto || row.caratula || "" },
    { label: "Contenido", getValue: (row) => row.contenido || "", bullet: true },
  ],
  corte_suprema: [
    { label: "Rol", getValue: (row) => row.rol || "" },
    { label: "Proyecto", getValue: (row) => row.proyecto || row.caratula || "" },
    { label: "Contenido", getValue: (row) => row.contenido || "", bullet: true },
  ],
  corte_apelaciones: [
    { label: "Corte", getValue: (row) => row.corte || row.tribunal || "" },
    { label: "Rol", getValue: (row) => row.rol || "" },
    { label: "Caratula / Proyecto", getValue: (row) => row.caratula || row.proyecto || "" },
    { label: "Contenido", getValue: (row) => row.contenido || "", bullet: true },
  ],
  tribunales_ambientales: [
    { label: "Tribunal", getValue: (row) => row.tribunal || "" },
    { label: "Rol", getValue: (row) => row.rol || "" },
    { label: "Proyecto", getValue: (row) => row.proyecto || row.caratula || "" },
    { label: "Contenido", getValue: (row) => row.contenido || "", bullet: true },
  ],
  causas_civiles: [
    { label: "Tribunal", getValue: (row) => row.tribunal || row.corte || "" },
    { label: "Rol", getValue: (row) => row.rol || "" },
    { label: "Contenido", getValue: (row) => row.contenido || "", bullet: true },
  ],
  nuevos_ingresos: [
    { label: "Tribunal", getValue: (row) => row.tribunal || row.corte || "" },
    { label: "Rol", getValue: (row) => row.rol || "" },
    { label: "Proyecto/Caratula", getValue: (row) => row.proyecto || row.caratula || "" },
  ],
  causas_dominga: [
    { label: "Tribunal", getValue: (row) => row.tribunal || row.corte || "" },
    { label: "Rol", getValue: (row) => row.rol || "" },
    { label: "Contenido", getValue: (row) => row.contenido || "", bullet: true },
  ],
  causas_tramitacion: [
    { label: "Tribunal", getValue: (row) => row.tribunal || row.corte || "" },
    { label: "Rol", getValue: (row) => row.rol || "" },
    { label: "Proyecto", getValue: (row) => row.proyecto || row.caratula || "" },
    { label: "Estado", getValue: (row) => row.estado || row.contenido || "", bullet: true },
  ],
}

const SECTION_MAX_ROWS: Record<SectionKey, number> = {
  tribunal_constitucional: 12,
  corte_suprema: 18,
  corte_apelaciones: 18,
  tribunales_ambientales: 18,
  causas_civiles: 12,
  nuevos_ingresos: 18,
  causas_dominga: 10,
  causas_tramitacion: 24,
}

function buildSectionMap(rows: NormalizedRow[]) {
  const grouped = new Map<SectionKey, NormalizedRow[]>()
  for (const section of SECTION_ORDER) grouped.set(section, [])

  for (const row of rows) {
    const list = grouped.get(row.section) || []
    list.push(row)
    grouped.set(row.section, list)
  }

  for (const section of SECTION_ORDER) {
    const list = grouped.get(section) || []
    const deduped: NormalizedRow[] = []
    const seen = new Set<string>()
    for (const row of list) {
      const key = `${safeText(row.tribunal)}|${safeText(row.corte)}|${safeText(row.rol)}|${safeText(row.proyecto)}|${safeText(row.caratula)}|${safeText(row.contenido)}|${safeText(row.estado)}`
      if (seen.has(key)) continue
      seen.add(key)
      deduped.push(row)
    }
    grouped.set(section, deduped.slice(0, SECTION_MAX_ROWS[section]))
  }

  return grouped
}

function renderCell(value: string, opts?: { bullet?: boolean }) {
  const clean = safeText(value, 2500)
  if (!clean) return "-"
  if (!opts?.bullet) return htmlEscape(clean)

  const bullets = parseBullets(clean)
  if (!bullets.length) return htmlEscape(clean)
  return `<ul style="margin:0;padding-left:20px;">${bullets
    .map((b) => `<li style="margin:0 0 6px 0;">${htmlEscape(b)}</li>`)
    .join("")}</ul>`
}

function renderSectionTable(section: SectionKey, rows: NormalizedRow[]) {
  const columns = SECTION_COLUMNS[section]
  const title = SECTION_TITLE[section]

  let bodyRows = ""
  if (!rows.length) {
    bodyRows = `<tr>${columns
      .map((_, idx) => {
        const value = idx === 0 ? "Sin novedades" : "-"
        return `<td style="border:1px solid #1f1f1f;padding:10px;vertical-align:top;font-size:12px;line-height:1.35;">${htmlEscape(value)}</td>`
      })
      .join("")}</tr>`
  } else {
    bodyRows = rows
      .slice(0, 200)
      .map((row) => {
        return `<tr>${columns
          .map((col) => `<td style="border:1px solid #1f1f1f;padding:10px;vertical-align:top;font-size:12px;line-height:1.35;">${renderCell(col.getValue(row), { bullet: col.bullet })}</td>`)
          .join("")}</tr>`
      })
      .join("")
  }

  return `
  <table style="width:100%;border-collapse:collapse;margin:0 0 28px 0;font-family:Arial,Helvetica,sans-serif;background:#ffffff;">
    <thead>
      <tr>
        <th colspan="${columns.length}" style="border:1px solid #1f1f1f;background:#c1e4f5;padding:10px 12px;text-align:left;font-size:16px;">${htmlEscape(title)}</th>
      </tr>
      <tr>
        ${columns
          .map((col) => `<th style="border:1px solid #1f1f1f;background:#c1e4f5;padding:9px 10px;text-align:left;font-size:12px;">${htmlEscape(col.label)}</th>`)
          .join("")}
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>`
}

function renderQuickSummaryHtml(summary: {
  added: number
  removed: number
  modified: number
  tribunalChanged: number
}) {
  const items = [
    { label: "Nuevas filas", value: summary.added },
    { label: "Filas modificadas", value: summary.modified },
    { label: "Filas eliminadas", value: summary.removed },
    { label: "Causas tribunal", value: summary.tribunalChanged },
  ]

  return `
  <div style="margin:0 0 16px 0;padding:12px;border:1px solid #d6d9dc;background:#ffffff;">
    <div style="font-size:12px;color:#4b5563;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;">Resumen rapido</div>
    <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;">
      ${items
        .map(
          (item) => `
          <div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;background:#f9fafb;">
            <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">${htmlEscape(item.label)}</div>
            <div style="font-size:22px;font-weight:700;color:#111827;">${item.value}</div>
          </div>`
        )
        .join("")}
    </div>
  </div>`
}

function renderQuickSummaryText(summary: {
  added: number
  removed: number
  modified: number
  tribunalChanged: number
}) {
  return [
    "Resumen rapido",
    `- Nuevas filas: ${summary.added}`,
    `- Filas modificadas: ${summary.modified}`,
    `- Filas eliminadas: ${summary.removed}`,
    `- Causas tribunal con movimiento: ${summary.tribunalChanged}`,
    "",
  ]
}

function valueByConfiguredColumn(row: Record<string, any>, configured: string) {
  const entries = rowEntries(row)
  return valueByKeyNorm(entries, [configured], [configured])
}

function buildRowIdentifier(row: Record<string, any>, keyColumns: string[]) {
  const parts = safeArray<string>(keyColumns)
    .map((column) => {
      const value = valueByConfiguredColumn(row, column)
      return value ? `${column}: ${safeText(value, 80)}` : null
    })
    .filter(Boolean)

  if (parts.length) return parts.join(" · ")

  const fallback =
    valueByConfiguredColumn(row, "Rol") ||
    valueByConfiguredColumn(row, "Carátula") ||
    valueByConfiguredColumn(row, "Proyecto") ||
    "Fila monitoreada"
  return safeText(fallback, 140)
}

function shortChangeValue(value: unknown, max = 80) {
  const text = safeText(value, max + 8)
  if (!text) return "(vacio)"
  return text.length > max ? `${text.slice(0, max)}...` : text
}

async function buildChangeHighlights(params: {
  supabase: any
  changedRuns: any[]
  keyColumns: string[]
}) {
  const highlights: ChangeHighlight[] = []

  for (const run of safeArray<any>(params.changedRuns).slice(0, 8)) {
    if (!run?.diff_storage_path) continue

    const diff = await downloadJsonFromBucket(params.supabase, "gob_excel", String(run.diff_storage_path)).catch(() => null)
    if (!diff || typeof diff !== "object") continue

    for (const row of safeArray<any>(diff.modified).slice(0, 8)) {
      const raw = (row?.raw && typeof row.raw === "object") ? row.raw : row?.row || {}
      const items = Object.entries((row?.changes && typeof row.changes === "object") ? row.changes : {})
        .slice(0, 6)
        .map(([column, value]) => {
          const before = shortChangeValue((value as any)?.before)
          const after = shortChangeValue((value as any)?.after)
          return `${column}: ${before} -> ${after}`
        })
      if (!items.length) continue
      highlights.push({
        kind: "modified",
        title: buildRowIdentifier(raw, params.keyColumns),
        subtitle: `Cambio detectado ${run.created_at ? dateLabel(String(run.created_at)) : ""}`,
        items,
      })
    }

    for (const row of safeArray<any>(diff.added).slice(0, 4)) {
      const raw = (row?.raw && typeof row.raw === "object") ? row.raw : row?.row || {}
      const preview = Object.keys(raw || {})
        .slice(0, 4)
        .map((column) => `${column}: ${shortChangeValue(raw?.[column])}`)
      highlights.push({
        kind: "added",
        title: buildRowIdentifier(raw, params.keyColumns),
        subtitle: "Fila nueva detectada",
        items: preview.length ? preview : ["Nueva fila incorporada al monitoreo."],
      })
    }

    for (const row of safeArray<any>(diff.removed).slice(0, 4)) {
      const raw = (row?.raw && typeof row.raw === "object") ? row.raw : row?.row || {}
      highlights.push({
        kind: "removed",
        title: buildRowIdentifier(raw, params.keyColumns),
        subtitle: "Fila eliminada",
        items: ["La fila dejo de estar presente en la hoja monitoreada."],
      })
    }

    for (const update of safeArray<any>(diff.tribunal_updates).slice(0, 4)) {
      const items = [
        `Estado: ${shortChangeValue(update?.previousEstado)} -> ${shortChangeValue(update?.currentEstado)}`,
        `Movimiento: ${shortChangeValue(update?.previousMovimiento)} -> ${shortChangeValue(update?.currentMovimiento)}`,
      ]
      highlights.push({
        kind: "tribunal",
        title: `${String(update?.tribunal || "Tribunal")} · ${String(update?.rol || "Sin rol")}`,
        subtitle: "Cambio detectado en seguimiento tribunal",
        items,
      })
    }
  }

  return highlights.slice(0, 16)
}

function highlightPalette(kind: ChangeHighlight["kind"]) {
  if (kind === "modified") {
    return { border: "#f59e0b", bg: "#fffbeb", chip: "#92400e", chipBg: "#fde68a" }
  }
  if (kind === "added") {
    return { border: "#10b981", bg: "#ecfdf5", chip: "#065f46", chipBg: "#a7f3d0" }
  }
  if (kind === "removed") {
    return { border: "#ef4444", bg: "#fef2f2", chip: "#991b1b", chipBg: "#fecaca" }
  }
  return { border: "#0ea5e9", bg: "#eff6ff", chip: "#0c4a6e", chipBg: "#bae6fd" }
}

function renderChangeHighlightsHtml(highlights: ChangeHighlight[]) {
  if (!highlights.length) return ""

  return `
  <div style="margin:0 0 18px 0;">
    <div style="font-size:12px;color:#4b5563;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;">Cambios detectados</div>
    <div style="display:grid;gap:12px;">
      ${highlights
        .map((highlight) => {
          const palette = highlightPalette(highlight.kind)
          return `
          <div style="border:1px solid ${palette.border};background:${palette.bg};border-radius:12px;padding:12px;">
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
              <div>
                <div style="font-size:14px;font-weight:700;color:#111827;">${htmlEscape(highlight.title)}</div>
                ${highlight.subtitle ? `<div style="font-size:12px;color:#4b5563;margin-top:3px;">${htmlEscape(highlight.subtitle)}</div>` : ""}
              </div>
              <span style="display:inline-block;padding:4px 8px;border-radius:999px;background:${palette.chipBg};color:${palette.chip};font-size:11px;font-weight:700;text-transform:uppercase;">${htmlEscape(highlight.kind)}</span>
            </div>
            <ul style="margin:10px 0 0 0;padding-left:18px;">
              ${highlight.items.map((item) => `<li style="margin:0 0 6px 0;font-size:13px;line-height:1.45;color:#111827;">${htmlEscape(item)}</li>`).join("")}
            </ul>
          </div>`
        })
        .join("")}
    </div>
  </div>`
}

function renderChangeHighlightsText(highlights: ChangeHighlight[]) {
  if (!highlights.length) return [] as string[]

  const lines = ["Cambios detectados", ""]
  for (const highlight of highlights) {
    lines.push(`- ${highlight.kind.toUpperCase()}: ${highlight.title}`)
    if (highlight.subtitle) lines.push(`  ${highlight.subtitle}`)
    for (const item of highlight.items) {
      lines.push(`  * ${item}`)
    }
    lines.push("")
  }
  return lines
}

function renderHtml(params: {
  fileName: string
  subjectLabel: string
  summary: { added: number; removed: number; modified: number; tribunalChanged: number }
  rows: NormalizedRow[]
  highlights: ChangeHighlight[]
  scheduleType: string
  appUrl: string | null
}) {
  const grouped = buildSectionMap(params.rows)
  const sectionsHtml = SECTION_ORDER.map((section) => renderSectionTable(section, grouped.get(section) || [])).join("\n")

  const appLink = params.appUrl
    ? `<p style="margin:8px 0 0 0;"><a href="${params.appUrl}" style="color:#0a5c9f;text-decoration:underline;">Ver detalle en Cuaderno Ambiental</a></p>`
    : ""

  return `<!doctype html>
  <html>
    <body style="margin:0;background:#f6f7f8;font-family:Arial,Helvetica,sans-serif;color:#111;">
      <div style="max-width:1180px;margin:0 auto;padding:20px;">
        <p style="margin:0 0 8px 0;font-size:14px;">Estimad@s,</p>
        <p style="margin:0 0 14px 0;font-size:14px;">Envio seguimiento judicial de hoy.</p>

        <div style="margin:0 0 14px 0;padding:10px 12px;border:1px solid #d6d9dc;background:#fff;font-size:12px;line-height:1.4;">
          <div><strong>${htmlEscape(params.subjectLabel)}</strong></div>
          <div style="margin-top:4px;">Cambios Excel: +${params.summary.added} ~${params.summary.modified} -${params.summary.removed} | Actividad tribunal: ${params.summary.tribunalChanged}</div>
          <div style="margin-top:4px;">Fuente monitor: ${htmlEscape(params.fileName)}</div>
          ${appLink}
        </div>

        ${renderQuickSummaryHtml(params.summary)}

        ${renderChangeHighlightsHtml(params.highlights)}

        ${params.scheduleType === "daily" ? sectionsHtml : ""}

        <p style="margin:10px 0 0 0;color:#555;font-size:11px;">Cuaderno Ambiental · Zona horaria ${OPERATING_TIMEZONE}</p>
      </div>
    </body>
  </html>`
}

function renderText(params: {
  subjectLabel: string
  summary: { added: number; removed: number; modified: number; tribunalChanged: number }
  rows: NormalizedRow[]
  highlights: ChangeHighlight[]
  scheduleType: string
}) {
  const grouped = buildSectionMap(params.rows)
  const lines: string[] = []

  lines.push(params.subjectLabel)
  lines.push(`Cambios Excel: +${params.summary.added} ~${params.summary.modified} -${params.summary.removed}`)
  lines.push(`Actividad tribunal: ${params.summary.tribunalChanged}`)
  lines.push("")
  lines.push(...renderQuickSummaryText(params.summary))
  lines.push(...renderChangeHighlightsText(params.highlights))

  if (params.scheduleType === "daily") {
    for (const section of SECTION_ORDER) {
    lines.push(SECTION_TITLE[section])
    const rows = grouped.get(section) || []
    if (!rows.length) {
      lines.push("- Sin novedades")
      lines.push("")
      continue
    }

    const cols = SECTION_COLUMNS[section]
    rows.slice(0, 60).forEach((row) => {
      const rowText = cols
        .map((col) => `${col.label}: ${safeText(col.getValue(row), 500) || "-"}`)
        .join(" | ")
      lines.push(`- ${rowText}`)
    })
    lines.push("")
    }
  }

  return lines.join("\n").trim()
}

async function downloadJsonFromBucket(supabase: any, bucket: string, path: string) {
  const { data, error } = await supabase.storage.from(bucket).download(path)
  if (error) throw new Error(`download failed: ${error.message}`)
  const ab = await (data as Blob).arrayBuffer()
  const buf = Buffer.from(ab)
  return JSON.parse(buf.toString("utf8"))
}

function smtpTransportFromEnv() {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT || 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true"

  if (!host || !user || !pass) {
    throw new Error("Missing SMTP_HOST/SMTP_USER/SMTP_PASS")
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  })
}

function hasSmtpEnv() {
  return Boolean(
    String(process.env.SMTP_HOST || "").trim() &&
      String(process.env.SMTP_USER || "").trim() &&
      String(process.env.SMTP_PASS || "").trim()
  )
}

function hasResendEnv() {
  return Boolean(String(process.env.RESEND_API_KEY || "").trim())
}

function resolveFromAddress() {
  const from =
    String(process.env.RESEND_FROM || "").trim() ||
    String(process.env.SMTP_FROM || "").trim() ||
    String(process.env.SMTP_USER || "").trim()
  return from || null
}

async function sendWithResend(params: {
  from: string
  to: string[]
  subject: string
  html: string
  text: string
}) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim()
  if (!apiKey) throw new Error("Missing RESEND_API_KEY")

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: params.from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  })

  if (!response.ok) {
    const errorJson = await response.json().catch(() => null)
    const detail =
      (errorJson && typeof errorJson.message === "string" && errorJson.message) ||
      (errorJson && typeof errorJson.error === "string" && errorJson.error) ||
      `status ${response.status}`
    throw new Error(`resend send failed: ${detail}`)
  }
}

function dateLabel(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const dd = String(d.getDate()).padStart(2, "0")
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const yyyy = String(d.getFullYear())
  return `${dd}.${mm}.${yyyy}`
}

export async function emailDigestJob(params: { supabase: any; job: any }) {
  const { supabase, job } = params
  const watchlistId = String(job.payload?.watchlist_id || "")
  if (!watchlistId) throw new Error("Missing watchlist_id")

  const now = new Date()
  const nowIso = now.toISOString()

  const { data: watch, error: wErr } = await supabase
    .from("gob_excel_watchlists")
    .select("*")
    .eq("id", watchlistId)
    .single()
  if (wErr) throw new Error(wErr.message)

  const recipients: string[] = safeArray<string>(watch.recipients)
  const scheduleType = watch.email_schedule?.type || "daily"
  const fromAddress = resolveFromAddress()

  const nextEmailAt =
    scheduleType === "daily" && watch.email_schedule?.time
      ? nextDailyAt({
          timeZone: watch.email_schedule?.timezone || OPERATING_TIMEZONE,
          hhmm: watch.email_schedule?.time,
          now,
        }).toISOString()
      : scheduleType === "interval" && watch.email_schedule?.interval_minutes
        ? new Date(now.getTime() + Number(watch.email_schedule.interval_minutes) * 60_000).toISOString()
        : null

  if (!recipients.length) {
    await supabase.from("gob_email_runs").insert({
      watchlist_id: watchlistId,
      created_at: nowIso,
      recipients: [],
      subject: "(sin destinatarios)",
      status: "skipped",
      metadata: { reason: "no_recipients" },
    })
    await supabase
      .from("gob_excel_watchlists")
      .update({ last_emailed_at: nowIso, next_email_at: nextEmailAt })
      .eq("id", watchlistId)
    if (nextEmailAt) {
      await supabase.from("gob_jobs").insert({
        type: "email_digest",
        status: "pending",
        available_at: nextEmailAt,
        attempts: 0,
        max_attempts: 5,
        payload: { watchlist_id: watchlistId, workspace_id: watch.workspace_id },
        created_at: nowIso,
      })
    }

    await supabase.from("gob_audit_logs").insert({
      user_id: null,
      action: "email.digest.skipped",
      target_resource: "gob_email_runs",
      details: { watchlist_id: watchlistId, reason: "no_recipients" },
      timestamp: nowIso,
    })
    return
  }

  if ((!hasResendEnv() && !hasSmtpEnv()) || !fromAddress) {
    const reason = !fromAddress ? "mail_from_not_configured" : "mail_provider_not_configured"
    const warnMessage = !fromAddress
      ? "Correo no enviado: falta configurar RESEND_FROM (o SMTP_FROM)."
      : "Correo no enviado: falta configurar RESEND_API_KEY + RESEND_FROM (o SMTP)."

    await supabase.from("gob_email_runs").insert({
      watchlist_id: watchlistId,
      created_at: nowIso,
      recipients,
      subject: "(correo no configurado)",
      status: "skipped",
      metadata: { reason },
    })

    await supabase
      .from("gob_excel_watchlists")
      .update({ last_emailed_at: nowIso, next_email_at: nextEmailAt })
      .eq("id", watchlistId)

    if (nextEmailAt) {
      await supabase.from("gob_jobs").insert({
        type: "email_digest",
        status: "pending",
        available_at: nextEmailAt,
        attempts: 0,
        max_attempts: 5,
        payload: { watchlist_id: watchlistId, workspace_id: watch.workspace_id },
        created_at: nowIso,
      })
    }

    await supabase.from("gob_alerts").insert({
      workspace_id: watch.workspace_id,
      watchlist_id: watchlistId,
      message: warnMessage,
      severity: "warning",
      metadata: { reason },
    })

    await supabase.from("gob_audit_logs").insert({
      user_id: null,
      action: "email.digest.skipped",
      target_resource: "gob_email_runs",
      details: { watchlist_id: watchlistId, reason },
      timestamp: nowIso,
    })

    return
  }

  const since = watch.last_emailed_at
    ? new Date(watch.last_emailed_at)
    : new Date(now.getTime() - 24 * 60 * 60_000)

  const { data: recentRuns, error: recentErr } = await supabase
    .from("gob_excel_runs")
    .select("id,created_at,kind,summary,diff_storage_path")
    .eq("watchlist_id", watchlistId)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(120)
  if (recentErr) throw new Error(recentErr.message)

  const changedRuns = safeArray<any>(recentRuns).filter((r) => String(r.kind) === "changed")

  if (scheduleType !== "daily" && changedRuns.length === 0) {
    await supabase.from("gob_email_runs").insert({
      watchlist_id: watchlistId,
      created_at: nowIso,
      recipients,
      subject: `[Cuaderno Ambiental] Sin cambios: ${watch.file_name || watch.file_id}`,
      status: "skipped",
      metadata: { reason: "no_changes_non_daily" },
    })
    await supabase
      .from("gob_excel_watchlists")
      .update({ last_emailed_at: nowIso, next_email_at: nextEmailAt })
      .eq("id", watchlistId)

    if (nextEmailAt) {
      await supabase.from("gob_jobs").insert({
        type: "email_digest",
        status: "pending",
        available_at: nextEmailAt,
        attempts: 0,
        max_attempts: 5,
        payload: { watchlist_id: watchlistId, workspace_id: watch.workspace_id },
        created_at: nowIso,
      })
    }
    return
  }

  const { data: latestSnapshotRun, error: latestSnapshotErr } = await supabase
    .from("gob_excel_runs")
    .select("id,created_at,snapshot_storage_path")
    .eq("watchlist_id", watchlistId)
    .not("snapshot_storage_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latestSnapshotErr) throw new Error(latestSnapshotErr.message)

  let snapshotRows: any[] = []
  if (latestSnapshotRun?.snapshot_storage_path) {
    snapshotRows = safeArray<any>(
      await downloadJsonFromBucket(supabase, "gob_excel", latestSnapshotRun.snapshot_storage_path).catch(() => [])
    )
  }

  const summary = summarizeRuns(changedRuns)

  let normalizedRows = normalizeSnapshotRows(snapshotRows, { since, now })
  const changeHighlights = await buildChangeHighlights({
    supabase,
    changedRuns,
    keyColumns: safeArray<string>(watch.key_columns),
  })

  if (!normalizedRows.length && changedRuns.length > 0) {
    const tribunalFallback = changedRuns
      .flatMap((r: any) => {
        const updates = r?.summary?.tribunal_monitoring?.updates
        return Array.isArray(updates) ? updates : []
      })
      .slice(0, 120)

    normalizedRows = tribunalFallback.map((item: any) => ({
      section: "tribunales_ambientales" as SectionKey,
      tribunal: String(item?.tribunal || "1TA"),
      corte: null,
      rol: item?.rol ? String(item.rol) : null,
      proyecto: null,
      caratula: null,
      contenido:
        `Estado: ${String(item?.previousEstado || "(sin dato)")} -> ${String(item?.currentEstado || "(sin dato)")}. ` +
        `Movimiento: ${String(item?.previousMovimiento || "(sin dato)")} -> ${String(item?.currentMovimiento || "(sin dato)")}.` +
        (item?.hasCasacion
          ? ` Casacion detectada${item?.recursoTipo ? ` (${String(item.recursoTipo)})` : ""}.`
          : ""),
      estado: item?.currentEstado ? String(item.currentEstado) : null,
      raw: item,
    }))
  }

  const fileName = watch.file_name || watch.file_id
  const label = `Seguimiento judicial ${dateLabel(nowIso)}`

  const appBase = process.env.APP_PUBLIC_URL || null
  const appUrl = appBase ? `${appBase}/excel/${watch.workspace_id}/${watchlistId}` : null

  const html = renderHtml({
    fileName,
    subjectLabel: label,
    summary,
    rows: normalizedRows,
    highlights: changeHighlights,
    scheduleType,
    appUrl,
  })
  const text = renderText({
    subjectLabel: label,
    summary,
    rows: normalizedRows,
    highlights: changeHighlights,
    scheduleType,
  })
  const subject = label
  const emailProvider = hasResendEnv() ? "resend" : "smtp"
  const from = String(fromAddress)

  try {
    if (emailProvider === "resend") {
      await sendWithResend({ from, to: recipients, subject, html, text })
    } else {
      const transport = smtpTransportFromEnv()
      await transport.sendMail({
        from,
        to: recipients.join(","),
        subject,
        html,
        text,
      })
    }

    await supabase.from("gob_email_runs").insert({
      watchlist_id: watchlistId,
      created_at: nowIso,
      recipients,
      subject,
      status: "sent",
      metadata: {
        summary,
        rows: normalizedRows.length,
        snapshot_run_id: latestSnapshotRun?.id || null,
        provider: emailProvider,
      },
    })

    await supabase.from("gob_audit_logs").insert({
      user_id: null,
      action: "email.digest.sent",
      target_resource: "gob_email_runs",
      details: {
        watchlist_id: watchlistId,
        recipients_count: recipients.length,
        summary,
        rows: normalizedRows.length,
        provider: emailProvider,
      },
      timestamp: nowIso,
    })
  } catch (err: any) {
    await supabase.from("gob_email_runs").insert({
      watchlist_id: watchlistId,
      created_at: nowIso,
      recipients,
      subject,
      status: "error",
      error: err?.message ?? String(err),
      metadata: { summary },
    })

    await supabase.from("gob_audit_logs").insert({
      user_id: null,
      action: "email.digest.error",
      target_resource: "gob_email_runs",
      details: { watchlist_id: watchlistId, error: err?.message ?? String(err) },
      timestamp: nowIso,
    })
    throw err
  }

  await supabase
    .from("gob_excel_watchlists")
    .update({ last_emailed_at: nowIso, next_email_at: nextEmailAt })
    .eq("id", watchlistId)

  if (nextEmailAt) {
    await supabase.from("gob_jobs").insert({
      type: "email_digest",
      status: "pending",
      available_at: nextEmailAt,
      attempts: 0,
      max_attempts: 5,
      payload: { watchlist_id: watchlistId, workspace_id: watch.workspace_id },
      created_at: nowIso,
    })
  }
}
