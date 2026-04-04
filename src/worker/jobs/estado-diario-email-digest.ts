import nodemailer from "nodemailer"

import { OPERATING_TIMEZONE } from "../../lib/timezone"
import { chileDateIso } from "../../lib/tribunal/estado-diario"

type CauseUpdateRow = {
  created_at: string
  tribunal: string
  rol: string
  previous_estado: string | null
  current_estado: string | null
  previous_estado_subtipo: string | null
  current_estado_subtipo: string | null
  current_movimiento: string | null
  has_casacion: boolean | null
  recurso_tipo: string | null
  metadata: Record<string, any> | null
}

function safeText(value: unknown, maxLen = 480) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text
}

function normalizeComparable(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function hasEstadoTransition(row: CauseUpdateRow) {
  const prev = normalizeComparable(row.previous_estado)
  const curr = normalizeComparable(row.current_estado)
  const prevSub = normalizeComparable(row.previous_estado_subtipo)
  const currSub = normalizeComparable(row.current_estado_subtipo)
  if (!prev && !curr && !prevSub && !currSub) return false
  return prev !== curr || prevSub !== currSub
}

function causeKey(tribunal: string, rol: string) {
  return `${safeText(tribunal || "", 40)}|${safeText(rol || "", 120)}`
}

type AmbientStateRow = {
  tribunal: string
  rol: string
  proyecto: string
  contenido: string[]
}

function htmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
}

function dateLabel(isoDate: string) {
  const d = new Date(`${isoDate}T12:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return isoDate
  const dd = String(d.getUTCDate()).padStart(2, "0")
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0")
  const yyyy = String(d.getUTCFullYear())
  return `${dd}.${mm}.${yyyy}`
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function parseCsvEmails(value: string) {
  return value
    .split(/[;,]/g)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .filter(validEmail)
}

function parseInputEmails(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((x) => String(x || "").trim().toLowerCase())
      .filter(Boolean)
      .filter(validEmail)
  }
  if (typeof value === "string") {
    return parseCsvEmails(value)
  }
  return [] as string[]
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

function smtpTransportFromEnv() {
  const host = String(process.env.SMTP_HOST || "").trim()
  const port = Number(process.env.SMTP_PORT || 587)
  const user = String(process.env.SMTP_USER || "").trim()
  const pass = String(process.env.SMTP_PASS || "").trim()
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
    const body = await response.json().catch(() => null)
    const detail =
      (body && typeof body.message === "string" && body.message) ||
      (body && typeof body.error === "string" && body.error) ||
      `status ${response.status}`
    throw new Error(`resend send failed: ${detail}`)
  }
}

async function resolveDigestRecipients(supabase: any) {
  const envRecipients = parseCsvEmails(String(process.env.ESTADO_DIARIO_DIGEST_RECIPIENTS || ""))

  const { data: watchlists, error: watchErr } = await supabase
    .from("gob_excel_watchlists")
    .select("recipients,status")
    .eq("status", "active")
    .limit(600)

  if (watchErr) throw new Error(watchErr.message)

  const fromWatchlists = new Set<string>()
  for (const row of watchlists || []) {
    const recipients = Array.isArray((row as any)?.recipients) ? ((row as any).recipients as any[]) : []
    for (const recipient of recipients) {
      const email = String(recipient || "").trim().toLowerCase()
      if (validEmail(email)) fromWatchlists.add(email)
    }
  }

  const merged = new Set<string>()
  for (const email of envRecipients) merged.add(email)
  for (const email of fromWatchlists) merged.add(email)

  return Array.from(merged)
}

function renderBulletList(values: string[]) {
  const clean = values.map((v) => safeText(v, 260)).filter(Boolean)
  if (!clean.length) {
    return '<div style="line-height:1.38; margin:0cm 0cm 8pt; font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif; font-size:12pt; color:rgb(0,0,0);">-</div>'
  }

  return `<ul style="margin-top:0cm; margin-right:0cm;">${clean
    .map(
      (v) =>
        `<li style="font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif; font-size:12pt; color:rgb(0,0,0); line-height:115%; margin:0cm 0cm 8pt;"><div role="presentation" style="line-height:1.38; margin:0cm 0cm 8pt; font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif; font-size:12pt; color:rgb(0,0,0);">${htmlEscape(
          v
        )}</div></li>`
    )
    .join("")}</ul>`
}

type ContentStyle = "bullet" | "dash" | "plain"

function renderSectionTable(params: {
  title: string
  columns: string[]
  rows: Array<Array<string | string[] | null>>
  headerColor: string
  contentStyle?: ContentStyle
  contentColumnIndex?: number
  boldColumns?: number[]
  columnWidths?: string[]
}) {
  const rows = params.rows.length
    ? params.rows
    : [["Sin novedades", ...Array.from({ length: Math.max(0, params.columns.length - 1) }).map(() => "-")]]

  const contentStyle = params.contentStyle || "bullet"
  const contentColumnIndex =
    typeof params.contentColumnIndex === "number" && params.contentColumnIndex >= 0
      ? params.contentColumnIndex
      : params.columns.length - 1
  const boldColumns = new Set(params.boldColumns || [])

  const headerRow = params.columns
    .map((col, idx) => {
      const width = params.columnWidths?.[idx] ? `width:${params.columnWidths[idx]};` : ""
      return `<td style="border-right:1pt solid; border-bottom:1pt solid;${idx === 0 ? " border-left:1pt solid;" : ""} background-color:${
        params.headerColor
      }; padding:0cm 5.4pt; vertical-align:top; ${width}"><div style="line-height:1.38; margin:0cm 0cm 8pt; font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif; font-size:12pt; color:rgb(0,0,0);"><span><b>${htmlEscape(
        col
      )}</b></span></div></td>`
    })
    .join("")

  const renderContent = (value: string | string[] | null, style: ContentStyle) => {
    if (Array.isArray(value)) {
      const clean = value.map((v) => safeText(v, 260)).filter(Boolean)
      if (!clean.length) {
        return '<div style="line-height:1.38; margin:0cm 0cm 8pt; font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif; font-size:12pt; color:rgb(0,0,0);">-</div>'
      }

      if (style === "dash") {
        return clean
          .map(
            (v) =>
              `<div style="line-height:1.38; margin:0cm 0cm 8pt; font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif; font-size:12pt; color:rgb(0,0,0);">- ${htmlEscape(
                v
              )}</div>`
          )
          .join("")
      }

      if (style === "plain") {
        return clean
          .map(
            (v) =>
              `<div style="line-height:1.38; margin:0cm 0cm 8pt; font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif; font-size:12pt; color:rgb(0,0,0);">${htmlEscape(
                v
              )}</div>`
          )
          .join("")
      }

      return renderBulletList(clean)
    }

    const single = safeText(value || "-", 320) || "-"
    if (style === "dash" && single !== "-" && !single.trim().startsWith("-")) {
      return `<div style="line-height:1.38; margin:0cm 0cm 8pt; font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif; font-size:12pt; color:rgb(0,0,0);">- ${htmlEscape(
        single
      )}</div>`
    }

    return `<div style="line-height:1.38; margin:0cm 0cm 8pt; font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif; font-size:12pt; color:rgb(0,0,0);">${htmlEscape(
      single
    )}</div>`
  }

  const bodyRows = rows
    .map((row) => {
      const cells = params.columns
        .map((_, idx) => {
          const cell = row[idx]
          const width = params.columnWidths?.[idx] ? `width:${params.columnWidths[idx]};` : ""
          const isContent = idx === contentColumnIndex

          let content = ""
          if (isContent) {
            content = renderContent(cell, contentStyle)
          } else {
            const text = safeText(cell || "-", 320) || "-"
            const maybeBold = boldColumns.has(idx) ? `<b>${htmlEscape(text)}</b>` : htmlEscape(text)
            content = `<div style="line-height:1.38; margin:0cm 0cm 8pt; font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif; font-size:12pt; color:rgb(0,0,0);">${maybeBold}</div>`
          }

          return `<td style="border-right:1pt solid; border-bottom:1pt solid;${idx === 0 ? " border-left:1pt solid;" : ""} background-color:rgb(245,245,245); padding:0cm 5.4pt; vertical-align:top; ${width}">${content}</td>`
        })
        .join("")
      return `<tr>${cells}</tr>`
    })
    .join("")

  return `<table border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse; border-spacing:0px; box-sizing:border-box; width:82%; margin:0 auto 28pt auto;">
    <tr>
      <td colspan="${params.columns.length}" style="border-width:1pt; border-style:solid; border-color:initial; background-color:${params.headerColor}; padding:0cm 5.4pt; vertical-align:top;"><div style="line-height:1.38; margin:0cm 0cm 8pt; font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif; font-size:12pt; color:rgb(0,0,0);"><span><b>${htmlEscape(
        params.title
      )}</b></span></div></td>
    </tr>
    <tr>${headerRow}</tr>
    ${bodyRows}
  </table>`
}

function buildAmbientRowsForTemplate(rows: AmbientStateRow[]) {
  const grouped = new Map<string, AmbientStateRow[]>()
  for (const row of rows) {
    const tribunal = safeText(row.tribunal || "", 20) || "1TA"
    const list = grouped.get(tribunal) || []
    list.push(row)
    grouped.set(tribunal, list)
  }

  const out: Array<Array<string | string[] | null>> = []
  const pushTribunal = (tribunal: string) => {
    const list = grouped.get(tribunal) || []
    if (!list.length) {
      out.push([tribunal, "Sin novedades", "-", "-"])
      return
    }
    for (const row of list) {
      out.push([tribunal, row.rol, row.proyecto, row.contenido])
    }
  }

  pushTribunal("1TA")
  pushTribunal("2TA")
  pushTribunal("3TA")

  for (const [tribunal, list] of grouped.entries()) {
    if (tribunal === "1TA" || tribunal === "2TA" || tribunal === "3TA") continue
    for (const row of list) {
      out.push([tribunal, row.rol, row.proyecto, row.contenido])
    }
  }

  return out
}

function renderHtml(params: {
  label: string
  ambientRows: AmbientStateRow[]
  useDemoData: boolean
}) {
  const ambientTableRows = buildAmbientRowsForTemplate(params.ambientRows)

  const tcRows = params.useDemoData
    ? [["17062-25-INA", "CES, Canal Goni, SW Isla Jorge, Pert N° 205111020", ["Causa en tabla: N°42"]]]
    : [["Sin novedades", "-", "-"]]

  const supremaRows = params.useDemoData
    ? [
        ["6850-2026", "Linea de Transmision Electrica HVDC Kimal - Lo Aguirre", ["SEA se hace parte"]],
        ["7360-2026", "Proyecto Alba", ["SEA se hace parte"]],
      ]
    : [["Sin novedades", "-", "-"]]

  const apelRows = params.useDemoData
    ? [["ICA Copiapo", "203-2026", "Prospeccion Minera El Alto", ["Recurrente cumple lo ordenado", "Titular se hace parte"]]]
    : [["Sin novedades", "-", "-", "-"]]

  const sections = [
    renderSectionTable({
      title: "Tribunal Constitucional",
      columns: ["Rol", "Proyecto", "Contenido"],
      rows: tcRows,
      headerColor: "#c1e4f5",
      columnWidths: ["20%", "35%", "45%"],
      contentStyle: "bullet",
    }),
    renderSectionTable({
      title: "Corte Suprema",
      columns: ["Rol", "Proyecto", "Contenido"],
      rows: supremaRows,
      headerColor: "#c1e4f5",
      columnWidths: ["20%", "35%", "45%"],
      contentStyle: "dash",
      boldColumns: [1],
    }),
    renderSectionTable({
      title: "Corte Apelaciones",
      columns: ["Corte", "Rol", "Caratula / Proyecto", "Contenido"],
      rows: apelRows,
      headerColor: "#c1e4f5",
      columnWidths: ["18%", "14%", "34%", "34%"],
      contentStyle: "bullet",
    }),
    renderSectionTable({
      title: "Tribunales Ambientales",
      columns: ["Tribunal", "Rol", "Proyecto", "Contenido"],
      rows: ambientTableRows,
      headerColor: "#c1e4f5",
      columnWidths: ["14%", "16%", "30%", "40%"],
      contentStyle: "bullet",
    }),
    renderSectionTable({
      title: "Causas civiles",
      columns: ["Tribunal", "Rol", "Contenido"],
      rows: [["Sin novedades", "-", "-"]],
      headerColor: "#caedfb",
      columnWidths: ["24%", "24%", "52%"],
      contentStyle: "plain",
    }),
    renderSectionTable({
      title: "Nuevos ingresos",
      columns: ["Tribunal", "Rol", "Proyecto/Caratula"],
      rows: [["Sin novedades", "-", "-"]],
      headerColor: "#c1e4f5",
      columnWidths: ["20%", "20%", "60%"],
      contentStyle: "plain",
    }),
    renderSectionTable({
      title: "Causas Dominga",
      columns: ["Tribunal", "Rol", "Contenido"],
      rows: [
        ["CS", "Sin novedades", "-"],
        ["TC", "Sin novedades", "-"],
        ["ICA Antofagasta", "Sin novedades", "-"],
        ["2TA", "Sin novedades", "-"],
      ],
      headerColor: "#caedfb",
      columnWidths: ["24%", "22%", "54%"],
      contentStyle: "plain",
    }),
    renderSectionTable({
      title: "Causas en tramitacion",
      columns: ["Tribunal", "Rol", "Proyecto", "Estado"],
      rows: [["Sin novedades", "-", "-", "-"]],
      headerColor: "#c1e4f5",
      columnWidths: ["14%", "16%", "32%", "38%"],
      contentStyle: "plain",
    }),
  ].join("\n")

  return `<!doctype html>
  <html>
    <body style="margin:0;background:#e8e8e8;font-family:Aptos,Calibri,Arial,sans-serif;color:#000;">
      <div style="max-width:1280px;margin:0 auto;padding:18px 8px;">
        <p style="margin:0 0 8px 0;font-family:Aptos,Calibri,Arial,sans-serif;font-size:12pt;">Estimad@s,</p>
        <p style="margin:0 0 8px 0;font-family:Aptos,Calibri,Arial,sans-serif;font-size:12pt;">Envio seguimiento de hoy.</p>
        <p style="margin:0 0 10px 0;font-family:Aptos,Calibri,Arial,sans-serif;font-size:12pt;">Saludos!!</p>
        ${sections}
        <p style="margin:8px 0 0 0;font-family:Aptos,Calibri,Arial,sans-serif;font-size:9pt;color:#666;">Generado por Cuaderno Ambiental · ${OPERATING_TIMEZONE}</p>
      </div>
    </body>
  </html>`
}

function renderText(params: {
  label: string
  ambientRows: AmbientStateRow[]
}) {
  const lines: string[] = []
  lines.push(params.label)
  lines.push("Estimad@s,")
  lines.push("Envio seguimiento de hoy.")
  lines.push("Saludos!!")
  lines.push("")

  lines.push("Tribunal Constitucional")
  lines.push("- Sin novedades")
  lines.push("")

  lines.push("Corte Suprema")
  lines.push("- Sin novedades")
  lines.push("")

  lines.push("Corte Apelaciones")
  lines.push("- Sin novedades")
  lines.push("")

  lines.push("Tribunales Ambientales")
  const ambientRows = buildAmbientRowsForTemplate(params.ambientRows)
  for (const row of ambientRows) {
    const tribunal = String(row[0] || "-")
    const rol = String(row[1] || "-")
    const proyecto = String(row[2] || "-")
    const contenido = row[3]
    lines.push(`- ${tribunal} | ${rol} | ${proyecto}`)
    if (Array.isArray(contenido)) {
      for (const item of contenido) {
        lines.push(`  * ${item}`)
      }
    } else if (contenido && String(contenido) !== "-") {
      lines.push(`  * ${String(contenido)}`)
    }
  }
  lines.push("")

  lines.push("Causas civiles")
  lines.push("- Sin novedades")
  lines.push("")

  lines.push("Nuevos ingresos")
  lines.push("- Sin novedades")
  lines.push("")

  lines.push("Causas Dominga")
  lines.push("- Sin novedades")
  lines.push("")

  lines.push("Causas en tramitacion")
  lines.push("- Sin novedades")

  return lines.join("\n")
}

export async function estadoDiarioEmailDigestJob(params: { supabase: any; job: any }) {
  const { supabase, job } = params
  const nowIso = new Date().toISOString()
  const targetDate = safeText(job.payload?.date, 20) || chileDateIso(new Date())
  const forceSend = Boolean(job.payload?.force_send)
  const payloadRecipients = parseInputEmails(job.payload?.to || job.payload?.recipients)

  const [{ data: sentRows, error: sentErr }, resolvedRecipients] = await Promise.all([
    supabase
      .from("gob_estado_diario_email_runs")
      .select("id")
      .eq("daily_date", targetDate)
      .eq("status", "sent")
      .limit(1),
    resolveDigestRecipients(supabase),
  ])

  const recipients = payloadRecipients.length ? payloadRecipients : resolvedRecipients

  if (sentErr) throw new Error(sentErr.message)
  if (!forceSend && Array.isArray(sentRows) && sentRows.length > 0) {
    return
  }

  const fromAddress = resolveFromAddress()
  const label = `${forceSend ? "TEST " : ""}Seguimiento judicial ${dateLabel(targetDate)}`

  if (!recipients.length) {
    await supabase.from("gob_estado_diario_email_runs").insert({
      daily_date: targetDate,
      recipients: [],
      subject: label,
      status: "skipped",
      metadata: { reason: "no_recipients" },
    })
    return
  }

  if ((!hasResendEnv() && !hasSmtpEnv()) || !fromAddress) {
    const reason = !fromAddress ? "mail_from_not_configured" : "mail_provider_not_configured"
    await supabase.from("gob_estado_diario_email_runs").insert({
      daily_date: targetDate,
      recipients,
      subject: label,
      status: "skipped",
      metadata: { reason },
    })
    await supabase.from("gob_alerts").insert({
      workspace_id: null,
      message: "Estado Diario: correo no enviado por configuracion faltante",
      severity: "warning",
      metadata: { reason, daily_date: targetDate },
    })
    return
  }

  const { data: updatesRows, error: updatesErr } = await supabase
    .from("gob_tribunal_cause_updates")
    .select(
      "created_at,tribunal,rol,previous_estado,current_estado,previous_estado_subtipo,current_estado_subtipo,current_movimiento,has_casacion,recurso_tipo,metadata"
    )
    .eq("source", "estado_diario")
    .eq("source_date", targetDate)
    .order("created_at", { ascending: false })
    .limit(1000)

  if (updatesErr) throw new Error(updatesErr.message)

  const latestUpdateByKey = new Map<string, CauseUpdateRow>()
  for (const row of updatesRows || []) {
    const rol = safeText((row as any).rol, 120)
    const tribunal = safeText((row as any).tribunal, 40) || "1TA"
    const key = causeKey(tribunal, rol)
    if (!rol || latestUpdateByKey.has(key)) continue
    const parsed: CauseUpdateRow = {
      created_at: safeText((row as any).created_at, 80),
      tribunal,
      rol,
      previous_estado: (row as any).previous_estado ? String((row as any).previous_estado) : null,
      current_estado: (row as any).current_estado ? String((row as any).current_estado) : null,
      previous_estado_subtipo: (row as any).previous_estado_subtipo
        ? String((row as any).previous_estado_subtipo)
        : null,
      current_estado_subtipo: (row as any).current_estado_subtipo
        ? String((row as any).current_estado_subtipo)
        : null,
      current_movimiento: (row as any).current_movimiento ? String((row as any).current_movimiento) : null,
      has_casacion:
        typeof (row as any).has_casacion === "boolean" ? (row as any).has_casacion : Boolean((row as any).has_casacion),
      recurso_tipo: (row as any).recurso_tipo ? String((row as any).recurso_tipo) : null,
      metadata: (row as any).metadata && typeof (row as any).metadata === "object" ? (row as any).metadata : null,
    }
    if (!hasEstadoTransition(parsed)) continue
    latestUpdateByKey.set(key, parsed)
  }

  const updates = Array.from(latestUpdateByKey.values()).sort(
    (a, b) => a.tribunal.localeCompare(b.tribunal) || a.rol.localeCompare(b.rol)
  )

  const roles = Array.from(new Set(updates.map((row) => row.rol))).filter(Boolean)
  const tribunales = Array.from(new Set(updates.map((row) => row.tribunal))).filter(Boolean)
  const causeByKey = new Map<string, { caratula: string | null; tribunal: string | null }>()
  if (roles.length) {
    const query = supabase.from("gob_tribunal_causes").select("rol,caratula,tribunal").in("rol", roles).limit(2500)
    const { data: causesRows, error: causesErr } = tribunales.length ? await query.in("tribunal", tribunales) : await query

    if (!causesErr) {
      for (const row of causesRows || []) {
        const rol = safeText((row as any).rol, 120)
        const tribunal = safeText((row as any).tribunal, 40) || "1TA"
        if (!rol) continue
        const key = causeKey(tribunal, rol)
        if (causeByKey.has(key)) continue
        causeByKey.set(key, {
          caratula: (row as any).caratula ? String((row as any).caratula) : null,
          tribunal,
        })
      }
    }
  }

  const ambientRows: AmbientStateRow[] = updates.map((row) => {
    const cause = causeByKey.get(causeKey(row.tribunal, row.rol))

    const prevEstado = safeText(row.previous_estado || "(sin dato)", 90)
    const currEstado = safeText(row.current_estado || "(sin dato)", 90)
    const prevSub = safeText(row.previous_estado_subtipo || "(sin dato)", 90)
    const currSub = safeText(row.current_estado_subtipo || "(sin dato)", 90)

    const content: string[] = []
    content.push(`Estado: ${prevEstado} -> ${currEstado}`)
    if (normalizeComparable(prevSub) !== normalizeComparable(currSub)) {
      content.push(`Subestado: ${prevSub} -> ${currSub}`)
    }
    if (row.current_movimiento) {
      content.push(`Movimiento: ${safeText(row.current_movimiento, 180)}`)
    }
    if (row.has_casacion) {
      content.push(
        `Casacion detectada${row.recurso_tipo ? ` (${safeText(row.recurso_tipo, 80)})` : ""}`
      )
    }

    return {
      tribunal: safeText(cause?.tribunal || row.tribunal || "1TA", 40) || "1TA",
      rol: row.rol,
      proyecto: safeText(cause?.caratula || "-", 190) || "-",
      contenido: content,
    }
  })

  const demoRequested = Boolean(job.payload?.demo_data)
  const useDemoData = forceSend && demoRequested

  const ambientRowsForTemplate: AmbientStateRow[] = useDemoData
    ? [
        {
          tribunal: "1TA",
          rol: "R-150-2026",
          proyecto: "Inversiones Santorini Ltda. con Superintendencia del Medio Ambiente",
          contenido: ["Se reporta en Estado Diario con UNA providencia."],
        },
      ]
    : ambientRows

  if (!updates.length && !forceSend) {
    await supabase.from("gob_estado_diario_email_runs").insert({
      daily_date: targetDate,
      recipients,
      subject: label,
      status: "skipped",
      metadata: {
        reason: "no_state_changes",
        forced: forceSend,
      },
    })
    return
  }

  const html = renderHtml({
    label,
    ambientRows: ambientRowsForTemplate,
    useDemoData,
  })
  const text = renderText({
    label,
    ambientRows: ambientRowsForTemplate,
  })
  const subject = label
  const emailProvider = hasResendEnv() ? "resend" : "smtp"

  try {
    if (emailProvider === "resend") {
      await sendWithResend({ from: String(fromAddress), to: recipients, subject, html, text })
    } else {
      const transport = smtpTransportFromEnv()
      await transport.sendMail({
        from: String(fromAddress),
        to: recipients.join(","),
        subject,
        html,
        text,
      })
    }

    await supabase.from("gob_estado_diario_email_runs").insert({
      daily_date: targetDate,
      recipients,
      subject,
      status: "sent",
      metadata: {
        state_changes: updates.length,
        provider: emailProvider,
        forced: forceSend,
      },
    })

    await supabase.from("gob_audit_logs").insert({
      user_id: null,
      action: "estado_diario.email_digest.sent",
      target_resource: "gob_estado_diario_email_runs",
      details: {
        daily_date: targetDate,
        recipients_count: recipients.length,
        state_changes: updates.length,
        provider: emailProvider,
        forced: forceSend,
      },
      timestamp: nowIso,
    })
  } catch (err: any) {
    await supabase.from("gob_estado_diario_email_runs").insert({
      daily_date: targetDate,
      recipients,
      subject,
      status: "error",
      error: err?.message ? String(err.message) : String(err),
      metadata: {
        state_changes: updates.length,
        forced: forceSend,
      },
    })

    await supabase.from("gob_audit_logs").insert({
      user_id: null,
      action: "estado_diario.email_digest.error",
      target_resource: "gob_estado_diario_email_runs",
      details: {
        daily_date: targetDate,
        error: err?.message ? String(err.message) : String(err),
      },
      timestamp: nowIso,
    })
    throw err
  }
}
