import { google } from "googleapis"
import * as XLSX from "xlsx"

import { decryptJson, encryptJson } from "../../lib/crypto"
import { OPERATING_TIMEZONE } from "../../lib/timezone"

type WatchlistRow = any

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function computeRowKey(row: Record<string, any>, keyColumns: string[]) {
  return keyColumns.map((c) => String(row?.[c] ?? "").trim()).join("|")
}

function pickColumns(row: Record<string, any>, columns: string[]) {
  const out: Record<string, any> = {}
  for (const c of columns) out[c] = row?.[c] ?? null
  return out
}

async function downloadFromBucket(supabase: any, bucket: string, path: string) {
  const { data, error } = await supabase.storage.from(bucket).download(path)
  if (error) throw new Error(`download failed: ${error.message}`)
  const ab = await (data as Blob).arrayBuffer()
  return Buffer.from(ab)
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

async function getGoogleDriveClient(tokens: any) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET")
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret)
  oauth2.setCredentials(tokens)
  return { oauth2, drive: google.drive({ version: "v3", auth: oauth2 }) }
}

async function refreshMicrosoftToken(refreshToken: string) {
  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error("Missing MICROSOFT_CLIENT_ID/MICROSOFT_CLIENT_SECRET")
  }
  const tokenUrl = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
  const body = new URLSearchParams()
  body.set("client_id", clientId)
  body.set("client_secret", clientSecret)
  body.set("grant_type", "refresh_token")
  body.set("refresh_token", refreshToken)
  body.set("scope", ["offline_access", "User.Read", "Files.Read"].join(" "))
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`microsoft refresh failed: ${JSON.stringify(json)}`)
  return json
}

async function fetchMicrosoft(
  accessToken: string,
  url: string,
  init?: RequestInit
) {
  return fetch(url, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${accessToken}`,
    },
  })
}

export async function excelCheckJob(params: { supabase: any; job: any }) {
  const { supabase, job } = params
  const watchlistId = String(job.payload?.watchlist_id || "")
  if (!watchlistId) throw new Error("Missing watchlist_id")

  const now = new Date()
  const nowIso = now.toISOString()

  let watchlistRow: WatchlistRow | null = null

  try {

  const { data: watch, error: wErr } = await supabase
    .from("gob_excel_watchlists")
    .select("*")
    .eq("id", watchlistId)
    .single()
  if (wErr) throw new Error(wErr.message)

  const watchlist = watch as WatchlistRow
  watchlistRow = watchlist
  const forceRun = Boolean(job.payload?.force)
  const manualTrigger = Boolean(job.payload?.manual)
  const isPaused = String(watchlist.status || "") === "paused"

  async function shouldKeepPaused() {
    const { data: current } = await supabase
      .from("gob_excel_watchlists")
      .select("status")
      .eq("id", watchlistId)
      .maybeSingle()

    return String(current?.status || watchlist.status || "") === "paused"
  }

  if (isPaused && !forceRun) {
    await supabase.from("gob_audit_logs").insert({
      user_id: null,
      action: "excel.check.skipped_paused",
      target_resource: "gob_excel_watchlists",
      details: {
        watchlist_id: watchlistId,
        workspace_id: watchlist.workspace_id,
      },
      timestamp: nowIso,
    })
    return
  }

  const { data: conn, error: cErr } = await supabase
    .from("gob_oauth_connections")
    .select("id,provider,tokens_enc")
    .eq("id", watchlist.connection_id)
    .single()
  if (cErr) throw new Error(cErr.message)

  let tokens = decryptJson<any>(conn.tokens_enc)

  // Fetch metadata + download
  let etag: string | null = null
  let modifiedTime: string | null = null
  let fileName: string | null = watchlist.file_name || null
  let fileBuf: Buffer | null = null

  if (watchlist.provider === "google") {
    const { oauth2, drive } = await getGoogleDriveClient(tokens)

    oauth2.on("tokens", async (newTokens) => {
      if (!newTokens || Object.keys(newTokens).length === 0) return
      const merged = { ...tokens, ...newTokens }
      const enc = encryptJson(merged)
      await supabase
        .from("gob_oauth_connections")
        .update({ tokens_enc: enc, updated_at: nowIso })
        .eq("id", conn.id)
      tokens = merged
    })

    const meta = await drive.files.get({
      fileId: watchlist.file_id,
      fields: "id,name,mimeType,modifiedTime,etag",
      supportsAllDrives: true,
    })
    etag =
      ((meta.data as any).etag as string) ||
      (((meta as any).headers?.etag as string) || null)
    modifiedTime = meta.data.modifiedTime || null
    fileName = fileName || meta.data.name || null

    if (etag && watchlist.last_etag && etag === watchlist.last_etag) {
      const pausedMode = await shouldKeepPaused()

      await supabase.from("gob_excel_runs").insert({
        watchlist_id: watchlistId,
        created_at: nowIso,
        kind: "no_change",
        etag,
        modified_time: modifiedTime,
        summary: { no_change: true },
      })

      const nextCheckAt = new Date(now.getTime() + watchlist.check_every_minutes * 60_000)
      await supabase
        .from("gob_excel_watchlists")
        .update({
          last_checked_at: nowIso,
          next_check_at: pausedMode ? null : nextCheckAt.toISOString(),
          status: pausedMode ? "paused" : "active",
          last_error: null,
        })
        .eq("id", watchlistId)

      if (!pausedMode) {
        await supabase.from("gob_jobs").insert({
          type: "excel_check",
          status: "pending",
          available_at: nextCheckAt.toISOString(),
          attempts: 0,
          max_attempts: 5,
          payload: { watchlist_id: watchlistId, workspace_id: watchlist.workspace_id },
          created_at: nowIso,
        })
      }

      await supabase.from("gob_audit_logs").insert({
        user_id: null,
        action: "excel.check.no_change",
        target_resource: "gob_excel_watchlists",
        details: {
          watchlist_id: watchlistId,
          workspace_id: watchlist.workspace_id,
          etag,
          manual: manualTrigger,
          force: forceRun,
        },
        timestamp: nowIso,
      })

      return
    }

    if (meta.data.mimeType === "application/vnd.google-apps.spreadsheet") {
      const exp = await drive.files.export(
        {
          fileId: watchlist.file_id,
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        { responseType: "arraybuffer" as any }
      )
      fileBuf = Buffer.from(exp.data as any)
    } else {
      const dl = await drive.files.get(
        { fileId: watchlist.file_id, alt: "media", supportsAllDrives: true },
        { responseType: "arraybuffer" as any }
      )
      fileBuf = Buffer.from(dl.data as any)
    }
  } else if (watchlist.provider === "microsoft") {
    const itemUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(
      watchlist.file_id
    )}?$select=id,name,eTag,lastModifiedDateTime`

    let metaRes = await fetchMicrosoft(tokens.access_token, itemUrl)
    if (metaRes.status === 401 && tokens.refresh_token) {
      const refreshed = await refreshMicrosoftToken(tokens.refresh_token)
      tokens = { ...tokens, ...refreshed }
      await supabase
        .from("gob_oauth_connections")
        .update({ tokens_enc: encryptJson(tokens), updated_at: nowIso })
        .eq("id", conn.id)
      metaRes = await fetchMicrosoft(tokens.access_token, itemUrl)
    }

    const metaJson = await metaRes.json().catch(() => null)
    if (!metaRes.ok) throw new Error(`graph meta error: ${JSON.stringify(metaJson)}`)

    etag = metaJson?.eTag || null
    modifiedTime = metaJson?.lastModifiedDateTime || null
    fileName = fileName || metaJson?.name || null

    if (etag && watchlist.last_etag && etag === watchlist.last_etag) {
      const pausedMode = await shouldKeepPaused()

      await supabase.from("gob_excel_runs").insert({
        watchlist_id: watchlistId,
        created_at: nowIso,
        kind: "no_change",
        etag,
        modified_time: modifiedTime,
        summary: { no_change: true },
      })

      const nextCheckAt = new Date(now.getTime() + watchlist.check_every_minutes * 60_000)
      await supabase
        .from("gob_excel_watchlists")
        .update({
          last_checked_at: nowIso,
          next_check_at: pausedMode ? null : nextCheckAt.toISOString(),
          status: pausedMode ? "paused" : "active",
          last_error: null,
        })
        .eq("id", watchlistId)

      if (!pausedMode) {
        await supabase.from("gob_jobs").insert({
          type: "excel_check",
          status: "pending",
          available_at: nextCheckAt.toISOString(),
          attempts: 0,
          max_attempts: 5,
          payload: { watchlist_id: watchlistId, workspace_id: watchlist.workspace_id },
          created_at: nowIso,
        })
      }

      await supabase.from("gob_audit_logs").insert({
        user_id: null,
        action: "excel.check.no_change",
        target_resource: "gob_excel_watchlists",
        details: {
          watchlist_id: watchlistId,
          workspace_id: watchlist.workspace_id,
          etag,
          manual: manualTrigger,
          force: forceRun,
        },
        timestamp: nowIso,
      })
      return
    }

    const contentUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(
      watchlist.file_id
    )}/content`
    const dlRes = await fetchMicrosoft(tokens.access_token, contentUrl)
    if (!dlRes.ok) {
      const t = await dlRes.text().catch(() => "")
      throw new Error(`graph download error: ${dlRes.status} ${t}`)
    }
    const ab = await dlRes.arrayBuffer()
    fileBuf = Buffer.from(ab)
  } else {
    throw new Error(`Unsupported provider: ${watchlist.provider}`)
  }

  if (!fileBuf) throw new Error("No file data")

  // Parse
  const wb = XLSX.read(fileBuf, { type: "buffer" })
  const targetSheetName =
    watchlist.sheet_name && wb.SheetNames.includes(watchlist.sheet_name)
      ? watchlist.sheet_name
      : wb.SheetNames[0]
  const sheet = wb.Sheets[targetSheetName]
  if (!sheet) throw new Error("Sheet not found")

  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: null }) as Array<
    Record<string, any>
  >

  const keyColumns: string[] = Array.isArray(watchlist.key_columns)
    ? watchlist.key_columns
    : []
  const watchedColumns: string[] = Array.isArray(watchlist.watched_columns)
    ? watchlist.watched_columns
    : []
  const trackedColumns = Array.from(new Set([...keyColumns, ...watchedColumns]))

  const nextRows = rawRows
    .map((r) => pickColumns(r, trackedColumns))
    .map((r) => ({
      key: computeRowKey(r, keyColumns),
      row: r,
    }))
    .filter((x) => x.key)

  const nextMap = new Map(nextRows.map((x) => [x.key, x.row]))

  // Load previous snapshot
  const { data: prevRun } = await supabase
    .from("gob_excel_runs")
    .select("snapshot_storage_path")
    .eq("watchlist_id", watchlistId)
    .not("snapshot_storage_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  let prevMap = new Map<string, Record<string, any>>()
  if (prevRun?.snapshot_storage_path) {
    try {
      const prevBuf = await downloadFromBucket(
        supabase,
        "gob_excel",
        prevRun.snapshot_storage_path
      )
      const prevJson = JSON.parse(prevBuf.toString("utf8"))
      if (Array.isArray(prevJson)) {
        prevMap = new Map(
          prevJson
            .map((r: any) => ({
              key: computeRowKey(r, keyColumns),
              row: pickColumns(r, trackedColumns),
            }))
            .filter((x: any) => x.key)
            .map((x: any) => [x.key, x.row])
        )
      }
    } catch {
      // ignore and treat as first snapshot
      prevMap = new Map()
    }
  }

  const added: any[] = []
  const removed: any[] = []
  const modified: any[] = []

  for (const [key, row] of nextMap.entries()) {
    if (!prevMap.has(key)) {
      added.push({ key, row })
      continue
    }
    const prev = prevMap.get(key)!
    const changes: Record<string, { before: any; after: any }> = {}
    for (const col of watchedColumns) {
      const before = prev[col] ?? null
      const after = row[col] ?? null
      if (String(before ?? "") !== String(after ?? "")) {
        changes[col] = { before, after }
      }
    }
    if (Object.keys(changes).length) {
      modified.push({ key, changes, row })
    }
  }

  for (const [key, row] of prevMap.entries()) {
    if (!nextMap.has(key)) removed.push({ key, row })
  }

  const changed = added.length + removed.length + modified.length > 0
  const summary = {
    added: added.length,
    removed: removed.length,
    modified: modified.length,
    sheet: targetSheetName,
  }

  const { data: run, error: runErr } = await supabase
    .from("gob_excel_runs")
    .insert({
      watchlist_id: watchlistId,
      created_at: nowIso,
      kind: changed ? "changed" : "no_change",
      etag,
      modified_time: modifiedTime,
      summary,
    })
    .select("id")
    .single()
  if (runErr) throw new Error(runErr.message)

  if (changed) {
    const snapshotPath = `snapshots/${watchlistId}/${run.id}.json`
    const diffPath = `diffs/${watchlistId}/${run.id}.json`

    await uploadToBucket(
      supabase,
      "gob_excel",
      snapshotPath,
      Buffer.from(JSON.stringify(Array.from(nextMap.values())), "utf8"),
      "application/json"
    )
    await uploadToBucket(
      supabase,
      "gob_excel",
      diffPath,
      Buffer.from(JSON.stringify({ added, removed, modified }, null, 2), "utf8"),
      "application/json"
    )

    await supabase
      .from("gob_excel_runs")
      .update({ snapshot_storage_path: snapshotPath, diff_storage_path: diffPath })
      .eq("id", run.id)
  }

  const pausedMode = await shouldKeepPaused()

  const nextCheckAt = new Date(now.getTime() + watchlist.check_every_minutes * 60_000)

  await supabase
    .from("gob_excel_watchlists")
    .update({
      updated_at: nowIso,
      file_name: fileName,
      last_etag: etag,
      last_modified_time: modifiedTime,
      last_checked_at: nowIso,
      next_check_at: pausedMode ? null : nextCheckAt.toISOString(),
      next_email_at: watchlist.next_email_at,
      status: pausedMode ? "paused" : "active",
      last_error: null,
    })
    .eq("id", watchlistId)

  await supabase.from("gob_audit_logs").insert({
    user_id: null,
    action: "excel.check.completed",
    target_resource: "gob_excel_runs",
    details: {
      watchlist_id: watchlistId,
      workspace_id: watchlist.workspace_id,
      run_id: run.id,
      changed,
      summary,
      manual: manualTrigger,
      force: forceRun,
    },
    timestamp: nowIso,
  })

  if (changed) {
    await supabase.from("gob_alerts").insert({
      workspace_id: watchlist.workspace_id,
      watchlist_id: watchlistId,
      message: `Excel cambio: +${added.length} ~${modified.length} -${removed.length}`,
      severity: "info",
      metadata: { run_id: run.id, file_id: watchlist.file_id },
    })
  }

  // enqueue next check
  if (!pausedMode) {
    await supabase.from("gob_jobs").insert({
      type: "excel_check",
      status: "pending",
      available_at: nextCheckAt.toISOString(),
      attempts: 0,
      max_attempts: 5,
      payload: { watchlist_id: watchlistId, workspace_id: watchlist.workspace_id },
      created_at: nowIso,
    })
  }

  // immediate email
  if (changed && !pausedMode && watchlist.email_schedule?.type === "immediate") {
    await supabase.from("gob_jobs").insert({
      type: "email_digest",
      status: "pending",
      available_at: new Date(Date.now() + 500).toISOString(),
      attempts: 0,
      max_attempts: 5,
      payload: { watchlist_id: watchlistId, workspace_id: watchlist.workspace_id },
      created_at: nowIso,
    })
  }

  // Optional rules evaluation (alerts)
  if (changed) {
    const rules = watchlist.rules
    const list: any[] = Array.isArray(rules) ? rules : Array.isArray(rules?.rules) ? rules.rules : []
    if (list.length) {
      let created = 0
      for (const rule of list) {
        if (created >= 10) break
        const type = String(rule?.type || "")
        const column = String(rule?.column || "")
        const severity = String(rule?.severity || "warning")

        if (type === "new_row" || type === "new_id") {
          if (!added.length) continue
          await supabase.from("gob_alerts").insert({
            workspace_id: watchlist.workspace_id,
            watchlist_id: watchlistId,
            message: rule?.message || `Regla: nuevas filas (${added.length})`,
            severity: severity,
            metadata: { run_id: run.id, type, added: added.length },
          })
          created++
          continue
        }

        if (!column) continue

        if (type === "column_changed") {
          const hits = modified.filter((m) => m?.changes && m.changes[column])
          if (!hits.length) continue
          await supabase.from("gob_alerts").insert({
            workspace_id: watchlist.workspace_id,
            watchlist_id: watchlistId,
            message:
              rule?.message ||
              `Regla: cambio en columna '${column}' (${hits.length} filas)`,
            severity: severity,
            metadata: { run_id: run.id, column, type },
          })
          created++
        }

        if (type === "column_equals") {
          const equals = rule?.equals
          const hits = modified
            .filter((m) => m?.changes && m.changes[column])
            .filter((m) => String(m.changes[column].after ?? "") === String(equals ?? ""))
          if (!hits.length) continue
          await supabase.from("gob_alerts").insert({
            workspace_id: watchlist.workspace_id,
            watchlist_id: watchlistId,
            message:
              rule?.message ||
              `Regla: '${column}' ahora es '${String(equals)}' (${hits.length} filas)`,
            severity: severity,
            metadata: { run_id: run.id, column, type, equals },
          })
          created++
        }
      }
    }
  }

  // gentle throttle to avoid API bursts
  await sleep(250)
  } catch (err: any) {
    const message = err?.message ?? String(err)

    if (watchlistRow) {
      const { data: currentWatch } = await supabase
        .from("gob_excel_watchlists")
        .select("status")
        .eq("id", watchlistId)
        .maybeSingle()
      const preservePaused =
        String(currentWatch?.status || watchlistRow.status || "") === "paused"
      const watchUpdate: Record<string, any> = {
        status: preservePaused ? "paused" : "error",
        last_error: message,
        last_checked_at: nowIso,
      }
      if (preservePaused) watchUpdate.next_check_at = null

      await supabase.from("gob_excel_runs").insert({
        watchlist_id: watchlistId,
        created_at: nowIso,
        kind: "error",
        etag: null,
        modified_time: null,
        summary: { error: true },
        error: message,
      })

      await supabase
        .from("gob_excel_watchlists")
        .update(watchUpdate)
        .eq("id", watchlistId)

      await supabase.from("gob_alerts").insert({
        workspace_id: watchlistRow.workspace_id,
        watchlist_id: watchlistId,
        message: `Monitor Excel fallo: ${message}`,
        severity: "warning",
        metadata: { provider: watchlistRow.provider, file_id: watchlistRow.file_id },
      })

      await supabase.from("gob_audit_logs").insert({
        user_id: null,
        action: "excel.check.error",
        target_resource: "gob_excel_watchlists",
        details: {
          watchlist_id: watchlistId,
          workspace_id: watchlistRow.workspace_id,
          error: message,
        },
        timestamp: nowIso,
      })
    }

    throw err
  }
}
