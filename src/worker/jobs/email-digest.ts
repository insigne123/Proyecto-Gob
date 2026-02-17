import nodemailer from "nodemailer"

import { OPERATING_TIMEZONE, nextDailyAt } from "../../lib/timezone"

function safeArray<T>(v: any): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function summarizeRuns(runs: any[]) {
  let added = 0
  let removed = 0
  let modified = 0
  for (const r of runs) {
    const s = r.summary || {}
    added += Number(s.added || 0)
    removed += Number(s.removed || 0)
    modified += Number(s.modified || 0)
  }
  return { added, removed, modified }
}

function renderHtml(params: {
  fileName: string
  windowLabel: string
  summary: { added: number; removed: number; modified: number }
  runs: any[]
  appUrl: string | null
  runUrl: string | null
  highlights?: {
    modifiedCells: Array<{ key: string; col: string; before: any; after: any }>
    addedKeys: string[]
    removedKeys: string[]
  } | null
}) {
  const { fileName, windowLabel, summary, runs, appUrl, runUrl, highlights } = params

  const rows = runs
    .slice(0, 8)
    .map((r) => {
      const ts = r.created_at ? new Date(r.created_at).toLocaleString("es-CL") : ""
      const s = r.summary || {}
      return `<tr>
        <td style="padding:8px 10px;border-top:1px solid #2a3a31;color:#d8e6de">${ts}</td>
        <td style="padding:8px 10px;border-top:1px solid #2a3a31;color:#d8e6de">${s.sheet ?? ""}</td>
        <td style="padding:8px 10px;border-top:1px solid #2a3a31;color:#d8e6de">+${s.added ?? 0}</td>
        <td style="padding:8px 10px;border-top:1px solid #2a3a31;color:#d8e6de">~${s.modified ?? 0}</td>
        <td style="padding:8px 10px;border-top:1px solid #2a3a31;color:#d8e6de">-${s.removed ?? 0}</td>
      </tr>`
    })
    .join("")

  const appLink = appUrl
    ? `<p style="margin:16px 0 0"><a href="${appUrl}" style="color:#48d28a">Ver detalle en Cuaderno Ambiental</a></p>`
    : ""

  const runLink = runUrl
    ? `<p style="margin:10px 0 0"><a href="${runUrl}" style="color:#48d28a">Ver esta revision</a></p>`
    : ""

  const highlightRows =
    highlights?.modifiedCells?.length
      ? highlights.modifiedCells
          .slice(0, 20)
          .map((c) => {
            const b = String(c.before ?? "")
            const a = String(c.after ?? "")
            return `<tr>
              <td style="padding:8px 10px;border-top:1px solid #2a3a31;color:#d8e6de;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:11px;">${c.key}</td>
              <td style="padding:8px 10px;border-top:1px solid #2a3a31;color:#d8e6de">${c.col}</td>
              <td style="padding:8px 10px;border-top:1px solid #2a3a31;color:#a9beb3">${b}</td>
              <td style="padding:8px 10px;border-top:1px solid #2a3a31;color:#d8e6de">${a}</td>
            </tr>`
          })
          .join("")
      : ""

  const highlightBlock = highlightRows
    ? `
      <div style="margin-top:14px;border:1px solid #233129;border-radius:16px;background:#111b16;overflow:hidden;">
        <div style="padding:12px 14px;border-bottom:1px solid #233129;color:#e6f4ec;font-size:13px;font-weight:600;">Cambios destacados (celdas)</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="background:#0f1713;color:#a9beb3;">
              <th align="left" style="padding:8px 10px;">Clave</th>
              <th align="left" style="padding:8px 10px;">Columna</th>
              <th align="left" style="padding:8px 10px;">Antes</th>
              <th align="left" style="padding:8px 10px;">Despues</th>
            </tr>
          </thead>
          <tbody>
            ${highlightRows}
          </tbody>
        </table>
      </div>
    `
    : ""

  return `<!doctype html>
  <html>
    <body style="margin:0;background:#0b120f;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial;">
      <div style="max-width:680px;margin:0 auto;padding:24px;">
        <div style="border:1px solid #233129;border-radius:16px;background:#111b16;padding:18px 18px 14px;">
          <h2 style="margin:0;color:#e6f4ec;font-size:18px;">Reporte de cambios (Excel)</h2>
          <p style="margin:8px 0 0;color:#a9beb3;font-size:13px;">${fileName} - ${windowLabel}</p>
          <div style="margin:14px 0 0;display:flex;gap:10px;flex-wrap:wrap;">
            <span style="display:inline-block;border:1px solid #2a3a31;border-radius:999px;padding:6px 10px;color:#d8e6de;font-size:12px;">Filas nuevas: <strong>${summary.added}</strong></span>
            <span style="display:inline-block;border:1px solid #2a3a31;border-radius:999px;padding:6px 10px;color:#d8e6de;font-size:12px;">Filas modificadas: <strong>${summary.modified}</strong></span>
            <span style="display:inline-block;border:1px solid #2a3a31;border-radius:999px;padding:6px 10px;color:#d8e6de;font-size:12px;">Filas eliminadas: <strong>${summary.removed}</strong></span>
          </div>
        </div>

        <div style="margin-top:14px;border:1px solid #233129;border-radius:16px;background:#111b16;overflow:hidden;">
          <div style="padding:12px 14px;border-bottom:1px solid #233129;color:#e6f4ec;font-size:13px;font-weight:600;">Ultimas revisiones con cambios</div>
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
              <tr style="background:#0f1713;color:#a9beb3;">
                <th align="left" style="padding:8px 10px;">Fecha</th>
                <th align="left" style="padding:8px 10px;">Hoja</th>
                <th align="left" style="padding:8px 10px;">Nuevas</th>
                <th align="left" style="padding:8px 10px;">Modif.</th>
                <th align="left" style="padding:8px 10px;">Elim.</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="5" style="padding:10px;color:#a9beb3;">Sin datos.</td></tr>`}
            </tbody>
          </table>
        </div>

        ${appLink}
        ${runLink}
        ${highlightBlock}
        <p style="margin:18px 0 0;color:#7f9489;font-size:11px;">Cuaderno Ambiental - Tribunal Ambiental de Chile - Zona horaria: ${OPERATING_TIMEZONE}</p>
      </div>
    </body>
  </html>`
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

  // Compute next email before doing work (so failures still keep cadence)
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

  const since = watch.last_emailed_at
    ? new Date(watch.last_emailed_at)
    : new Date(now.getTime() - 24 * 60 * 60_000)

  const { data: runs, error: rErr } = await supabase
    .from("gob_excel_runs")
    .select("id,created_at,kind,summary,diff_storage_path")
    .eq("watchlist_id", watchlistId)
    .eq("kind", "changed")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(50)
  if (rErr) throw new Error(rErr.message)

  const changedRuns = safeArray<any>(runs)
  if (changedRuns.length === 0 && scheduleType === "daily") {
    // Daily digests can be skipped if no changes.
    await supabase.from("gob_email_runs").insert({
      watchlist_id: watchlistId,
      created_at: nowIso,
      recipients,
      subject: `[Cuaderno Ambiental] Sin cambios: ${watch.file_name || watch.file_id}`,
      status: "skipped",
      metadata: { reason: "no_changes" },
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
      details: { watchlist_id: watchlistId, reason: "no_changes" },
      timestamp: nowIso,
    })
    return
  }

  const summary = summarizeRuns(changedRuns)
  const fileName = watch.file_name || watch.file_id
  const windowLabel = `${since.toLocaleString("es-CL")} -> ${now.toLocaleString("es-CL")}`

  const appBase = process.env.APP_PUBLIC_URL || null
  const appUrl = appBase
    ? `${appBase}/workspaces/${watch.workspace_id}/watchlists/${watchlistId}`
    : null
  const runUrl = appBase
    ? `${appBase}/workspaces/${watch.workspace_id}/watchlists/${watchlistId}/runs/${changedRuns[0]?.id}`
    : null

  let highlights: any = null
  const latestDiffPath = changedRuns[0]?.diff_storage_path
  if (latestDiffPath) {
    try {
      const diff = await downloadJsonFromBucket(supabase, "gob_excel", latestDiffPath)
      const modifiedCells = (diff?.modified ?? [])
        .flatMap((m: any) =>
          Object.entries(m?.changes ?? {}).map(([col, v]: any) => ({
            key: String(m.key ?? ""),
            col: String(col),
            before: v?.before ?? null,
            after: v?.after ?? null,
          }))
        )
        .slice(0, 30)

      highlights = {
        modifiedCells,
        addedKeys: (diff?.added ?? []).slice(0, 10).map((a: any) => String(a.key ?? "")),
        removedKeys: (diff?.removed ?? []).slice(0, 10).map((a: any) => String(a.key ?? "")),
      }
    } catch {
      highlights = null
    }
  }

  const html = renderHtml({
    fileName,
    windowLabel,
    summary,
    runs: changedRuns,
    appUrl,
    runUrl,
    highlights,
  })
  const subject = `[Cuaderno Ambiental] Cambios Excel: ${fileName}`

  try {
    const transport = smtpTransportFromEnv()
    const from = process.env.SMTP_FROM || process.env.SMTP_USER
    await transport.sendMail({
      from,
      to: recipients.join(","),
      subject,
      html,
      text: `Cambios Excel: +${summary.added} ~${summary.modified} -${summary.removed}`,
    })

    await supabase.from("gob_email_runs").insert({
      watchlist_id: watchlistId,
      created_at: nowIso,
      recipients,
      subject,
      status: "sent",
      metadata: { summary },
    })

    await supabase.from("gob_audit_logs").insert({
      user_id: null,
      action: "email.digest.sent",
      target_resource: "gob_email_runs",
      details: { watchlist_id: watchlistId, recipients_count: recipients.length, summary },
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
