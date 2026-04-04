import { google } from "googleapis"
import * as XLSX from "xlsx"

import { decryptJson, encryptJson } from "../../lib/crypto"
import { OPERATING_TIMEZONE } from "../../lib/timezone"
import { extractTribunalRolFromRow, fetch1TACauseSnapshotByRol, normalizeTribunalCode } from "../../lib/tribunal/one-ta"

type WatchlistRow = any

type ResolvedColumn = {
  configured: string
  actual: string
}

type TribunalStateRow = {
  tribunal: string
  rol: string
  estado: string | null
  estadoSubtipo: string | null
  caratula: string | null
  fechaIngreso: string | null
  latestMovementDate: string | null
  latestMovementLabel: string | null
  latestMovementActor: string | null
  hasCasacion: boolean
  recursoTipo: string | null
  fetchedAt: string
}

type WatchedRowSelection = {
  rowKey: string
  label?: string | null
}

type WatchedCellSelection = {
  rowKey: string
  rowLabel?: string | null
  column: string
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function normalizeColumnName(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function resolveColumns(configured: string[], rows: Array<Record<string, any>>) {
  const exact = new Map<string, string>()
  const trimmed = new Map<string, string>()
  const normalized = new Map<string, string>()

  for (const row of rows.slice(0, 220)) {
    for (const key of Object.keys(row || {})) {
      const raw = String(key || "")
      if (!raw) continue
      if (!exact.has(raw)) exact.set(raw, raw)

      const lowerTrim = raw.trim().toLowerCase()
      if (lowerTrim && !trimmed.has(lowerTrim)) trimmed.set(lowerTrim, raw)

      const norm = normalizeColumnName(raw)
      if (norm && !normalized.has(norm)) normalized.set(norm, raw)
    }
  }

  return configured.map((col) => {
    const configuredRaw = String(col || "")
    if (!configuredRaw) return { configured: configuredRaw, actual: configuredRaw }

    const byExact = exact.get(configuredRaw)
    if (byExact) return { configured: configuredRaw, actual: byExact }

    const byTrimmed = trimmed.get(configuredRaw.trim().toLowerCase())
    if (byTrimmed) return { configured: configuredRaw, actual: byTrimmed }

    const byNorm = normalized.get(normalizeColumnName(configuredRaw))
    if (byNorm) return { configured: configuredRaw, actual: byNorm }

    return { configured: configuredRaw, actual: configuredRaw }
  })
}

function resolveColumnsExpanded(configured: string[], rows: Array<Record<string, any>>) {
  const actualKeys: string[] = []
  const seen = new Set<string>()

  for (const row of rows.slice(0, 220)) {
    for (const key of Object.keys(row || {})) {
      const raw = String(key || "")
      if (!raw || seen.has(raw)) continue
      seen.add(raw)
      actualKeys.push(raw)
    }
  }

  const out: ResolvedColumn[] = []
  const emitted = new Set<string>()

  for (const col of configured) {
    const configuredRaw = String(col || "")
    if (!configuredRaw) continue
    const normalizedConfigured = normalizeColumnName(configuredRaw)

    const matches = actualKeys.filter((raw) => {
      if (raw === configuredRaw) return true
      if (raw.trim().toLowerCase() === configuredRaw.trim().toLowerCase()) return true
      return normalizeColumnName(raw) === normalizedConfigured
    })

    if (!matches.length) {
      const key = `${configuredRaw}::${configuredRaw}`
      if (!emitted.has(key)) {
        out.push({ configured: configuredRaw, actual: configuredRaw })
        emitted.add(key)
      }
      continue
    }

    for (const actual of matches) {
      const key = `${configuredRaw}::${actual}`
      if (emitted.has(key)) continue
      out.push({ configured: configuredRaw, actual })
      emitted.add(key)
    }
  }

  return out
}

function computeRowKey(row: Record<string, any>, keyColumns: ResolvedColumn[]) {
  return keyColumns
    .map((col) => {
      const value = row?.[col.actual]
      if (value !== undefined && value !== null) return String(value).trim()
      return String(row?.[col.configured] ?? "").trim()
    })
    .join("|")
}

function pickColumns(row: Record<string, any>, columns: ResolvedColumn[]) {
  const out: Record<string, any> = {}
  for (const col of columns) {
    const value = row?.[col.actual]
    out[col.configured] = value !== undefined ? value : (row?.[col.configured] ?? null)
  }
  return out
}

function collectColumns(rows: Array<Record<string, any>>) {
  const set = new Set<string>()
  for (const row of rows.slice(0, 260)) {
    for (const key of Object.keys(row || {})) {
      const raw = String(key || "").trim()
      if (!raw) continue
      set.add(raw)
      if (set.size >= 240) break
    }
    if (set.size >= 240) break
  }
  return Array.from(set)
}

function normalizeWatchedRows(rules: any) {
  const rows = Array.isArray(rules?.watched_rows) ? rules.watched_rows : []
  const seen = new Set<string>()
  const out: WatchedRowSelection[] = []
  for (const row of rows) {
    const rowKey = String((row as any)?.rowKey || "").trim()
    if (!rowKey || seen.has(rowKey)) continue
    seen.add(rowKey)
    out.push({ rowKey, label: (row as any)?.label ? String((row as any).label) : null })
  }
  return out
}

function normalizeWatchedCells(rules: any) {
  const rows = Array.isArray(rules?.watched_cells) ? rules.watched_cells : []
  const seen = new Set<string>()
  const out: WatchedCellSelection[] = []
  for (const cell of rows) {
    const rowKey = String((cell as any)?.rowKey || "").trim()
    const column = String((cell as any)?.column || "").trim()
    if (!rowKey || !column) continue
    const key = `${rowKey}::${normalizeColumnName(column)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      rowKey,
      rowLabel: (cell as any)?.rowLabel ? String((cell as any).rowLabel) : null,
      column,
    })
  }
  return out
}

function normalizeImmediateColumns(rules: any) {
  const columns = Array.isArray(rules?.immediate_columns) ? rules.immediate_columns : []
  const out: string[] = []
  for (const value of columns) {
    const clean = String(value || "").trim()
    if (!clean) continue
    if (out.some((item) => normalizeColumnName(item) === normalizeColumnName(clean))) continue
    out.push(clean)
  }
  return out
}

function normalizeRuleCriticalFlag(rules: any) {
  if (!rules || typeof rules !== "object") return false
  const value = (rules as any).critical_alerts
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on"
  }
  return false
}

function normalizeRuleText(value: unknown) {
  return String(value ?? "").trim().toLowerCase()
}

function toComparableNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  const normalized = String(value ?? "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim()
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function matchesColumnOperator(params: {
  operator: string
  actualValue: unknown
  expectedValue?: unknown
}) {
  const operator = String(params.operator || "equals").trim().toLowerCase()
  const actualText = normalizeRuleText(params.actualValue)
  const expectedText = normalizeRuleText(params.expectedValue)

  if (operator === "empty") return actualText.length === 0
  if (operator === "not_empty") return actualText.length > 0
  if (operator === "contains") return !!expectedText && actualText.includes(expectedText)
  if (operator === "gt" || operator === "gte" || operator === "lt" || operator === "lte") {
    const actualNumber = toComparableNumber(params.actualValue)
    const expectedNumber = toComparableNumber(params.expectedValue)
    if (actualNumber === null || expectedNumber === null) return false
    if (operator === "gt") return actualNumber > expectedNumber
    if (operator === "gte") return actualNumber >= expectedNumber
    if (operator === "lt") return actualNumber < expectedNumber
    return actualNumber <= expectedNumber
  }

  return actualText === expectedText
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toStateMap(value: any) {
  if (!isObject(value)) return {} as Record<string, TribunalStateRow>
  const out: Record<string, TribunalStateRow> = {}
  for (const [key, row] of Object.entries(value)) {
    if (!isObject(row)) continue
    const rol = String(row.rol || "").trim()
    const tribunal = String(row.tribunal || "").trim()
    if (!rol || !tribunal) continue
    out[String(key)] = {
      tribunal,
      rol,
      estado: row.estado ? String(row.estado) : null,
      estadoSubtipo: row.estadoSubtipo ? String(row.estadoSubtipo) : null,
      caratula: row.caratula ? String(row.caratula) : null,
      fechaIngreso: row.fechaIngreso ? String(row.fechaIngreso) : null,
      latestMovementDate: row.latestMovementDate ? String(row.latestMovementDate) : null,
      latestMovementLabel: row.latestMovementLabel ? String(row.latestMovementLabel) : null,
      latestMovementActor: row.latestMovementActor ? String(row.latestMovementActor) : null,
      hasCasacion: Boolean(row.hasCasacion),
      recursoTipo: row.recursoTipo ? String(row.recursoTipo) : null,
      fetchedAt: row.fetchedAt ? String(row.fetchedAt) : "",
    }
  }
  return out
}

function stateChanged(a: TribunalStateRow | null, b: TribunalStateRow | null) {
  if (!a && !b) return false
  if (!a || !b) return true
  return (
    String(a.estado || "") !== String(b.estado || "") ||
    String(a.estadoSubtipo || "") !== String(b.estadoSubtipo || "") ||
    String(a.latestMovementDate || "") !== String(b.latestMovementDate || "") ||
    String(a.latestMovementLabel || "") !== String(b.latestMovementLabel || "") ||
    String(a.latestMovementActor || "") !== String(b.latestMovementActor || "") ||
    Boolean(a.hasCasacion) !== Boolean(b.hasCasacion) ||
    String(a.recursoTipo || "") !== String(b.recursoTipo || "")
  )
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length)
  let next = 0

  async function runOne() {
    while (next < items.length) {
      const idx = next
      next += 1
      out[idx] = await worker(items[idx])
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }).map(() =>
    runOne()
  )
  await Promise.all(workers)
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

  async function hasQueuedJob(type: "excel_check" | "email_digest") {
    const { data, error } = await supabase
      .from("gob_jobs")
      .select("id")
      .eq("type", type)
      .in("status", ["pending", "running"])
      .filter("payload->>watchlist_id", "eq", watchlistId)
      .neq("id", job.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw new Error(error.message)
    return Boolean(data)
  }

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
      fields: "id,name,mimeType,modifiedTime,md5Checksum,version",
      supportsAllDrives: true,
    })
    const googleMeta = meta.data as any
    const checksum = googleMeta?.md5Checksum ? String(googleMeta.md5Checksum) : null
    const versionTag =
      googleMeta?.version !== undefined && googleMeta?.version !== null
        ? String(googleMeta.version)
        : null
    const headerTag = (meta as any)?.headers?.etag

    etag = checksum || versionTag || (headerTag ? String(headerTag) : null)
    modifiedTime = meta.data.modifiedTime || null
    fileName = fileName || meta.data.name || null

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
  const watchedRows = normalizeWatchedRows(watchlist.rules)
  const watchedCells = normalizeWatchedCells(watchlist.rules)
  const immediateColumns = normalizeImmediateColumns(watchlist.rules)
  const immediateCells = normalizeWatchedCells({ watched_cells: watchlist.rules?.immediate_cells })
  const watchedCellColumns = watchedCells.map((cell) => cell.column)
  const immediateCellColumns = immediateCells.map((cell) => cell.column)
  const availableColumns = collectColumns(rawRows)
  const trackedColumns = Array.from(
    new Set([
      ...keyColumns,
      ...watchedColumns,
      ...watchedCellColumns,
      ...immediateColumns,
      ...immediateCellColumns,
      ...(watchedRows.length ? availableColumns.filter((column) => !keyColumns.some((key) => normalizeColumnName(key) === normalizeColumnName(column))) : []),
    ])
  )
  const resolvedKeyColumns = resolveColumns(keyColumns, rawRows)
  const resolvedTrackedColumns = resolveColumnsExpanded(trackedColumns, rawRows)
  const watchedRowKeySet = new Set(watchedRows.map((row) => row.rowKey))
  const granularRowKeySet = new Set([
    ...watchedRows.map((row) => row.rowKey),
    ...watchedCells.map((cell) => cell.rowKey),
  ])
  const watchedCellKeySet = new Set(
    watchedCells.map((cell) => `${cell.rowKey}::${normalizeColumnName(cell.column)}`)
  )
  const immediateCellKeySet = new Set(
    immediateCells.map((cell) => `${cell.rowKey}::${normalizeColumnName(cell.column)}`)
  )

  const nextRows = rawRows
    .map((raw) => {
      const row = pickColumns(raw, resolvedTrackedColumns)
      return {
        key: computeRowKey(raw, resolvedKeyColumns),
        row,
        raw,
      }
    })
    .filter((x) => x.key)

  const nextMap = new Map(nextRows.map((x) => [x.key, x.row]))
  const nextRawByKey = new Map(nextRows.map((x) => [x.key, x.raw]))

  // Load previous snapshot
  const { data: prevRun } = await supabase
    .from("gob_excel_runs")
    .select("snapshot_storage_path,summary")
    .eq("watchlist_id", watchlistId)
    .not("snapshot_storage_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  let prevMap = new Map<string, Record<string, any>>()
  let prevRawByKey = new Map<string, Record<string, any>>()
  const isBaselineRun = !prevRun?.snapshot_storage_path
  if (prevRun?.snapshot_storage_path) {
    try {
      const prevBuf = await downloadFromBucket(
        supabase,
        "gob_excel",
        prevRun.snapshot_storage_path
      )
      const prevJson = JSON.parse(prevBuf.toString("utf8"))
      if (Array.isArray(prevJson)) {
        const prevRows = prevJson
          .map((r: any) => ({
            key: computeRowKey(r, resolvedKeyColumns),
            row: pickColumns(r, resolvedTrackedColumns),
            raw: r,
          }))
          .filter((x: any) => x.key)

        prevMap = new Map(prevRows.map((x: any) => [x.key, x.row]))
        prevRawByKey = new Map(prevRows.map((x: any) => [x.key, x.raw]))
      }
    } catch {
      // ignore and treat as first snapshot
      prevMap = new Map()
      prevRawByKey = new Map()
    }
  }

  const addedAll: any[] = []
  const removedAll: any[] = []
  const modified: any[] = []

  for (const [key, row] of nextMap.entries()) {
    if (!prevMap.has(key)) {
      addedAll.push({ key, row, raw: nextRawByKey.get(key) || null })
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
    const relevantChanges: Record<string, { before: any; after: any }> = {}
    for (const [col, value] of Object.entries(changes)) {
      const watchedColumn = watchedColumns.some((item) => normalizeColumnName(item) === normalizeColumnName(col))
      const watchedRow = watchedRowKeySet.has(key)
      const watchedCell = watchedCellKeySet.has(`${key}::${normalizeColumnName(col)}`)
      if (watchedColumn || watchedRow || watchedCell) {
        relevantChanges[col] = value
      }
    }

    if (Object.keys(relevantChanges).length) {
      modified.push({ key, changes: relevantChanges, row, raw: nextRawByKey.get(key) || null })
    }
  }

  for (const [key, row] of prevMap.entries()) {
    if (!nextMap.has(key)) removedAll.push({ key, row, raw: prevRawByKey.get(key) || null })
  }

  const useGranularSelection = watchedRows.length > 0 || watchedCells.length > 0
  const added = useGranularSelection ? addedAll.filter((row) => granularRowKeySet.has(String(row.key))) : addedAll
  const removed = useGranularSelection ? removedAll.filter((row) => granularRowKeySet.has(String(row.key))) : removedAll

  const immediateColumnHits = new Set<string>()
  const immediateCellHits = new Set<string>()

  const immediateColumnNorms = immediateColumns.map((column) => normalizeColumnName(column))

  for (const row of modified) {
    for (const column of Object.keys(row?.changes || {})) {
      const normalizedColumn = normalizeColumnName(column)
      if (immediateColumnNorms.includes(normalizedColumn)) {
        immediateColumnHits.add(column)
      }
      if (immediateCellKeySet.has(`${String(row.key)}::${normalizedColumn}`)) {
        immediateCellHits.add(`${String(row.key)}::${column}`)
      }
    }
  }

  for (const row of addedAll) {
    const raw = row?.raw || {}
    for (const column of immediateColumns) {
      const value = raw?.[column]
      if (value !== undefined && value !== null && String(value) !== "") {
        immediateColumnHits.add(column)
      }
    }
    for (const cell of immediateCells) {
      if (cell.rowKey !== String(row.key)) continue
      const value = raw?.[cell.column]
      if (value !== undefined && value !== null && String(value) !== "") {
        immediateCellHits.add(`${cell.rowKey}::${cell.column}`)
      }
    }
  }

  for (const row of removedAll) {
    const raw = row?.raw || {}
    for (const column of immediateColumns) {
      const value = raw?.[column]
      if (value !== undefined && value !== null && String(value) !== "") {
        immediateColumnHits.add(column)
      }
    }
    for (const cell of immediateCells) {
      if (cell.rowKey !== String(row.key)) continue
      const value = raw?.[cell.column]
      if (value !== undefined && value !== null && String(value) !== "") {
        immediateCellHits.add(`${cell.rowKey}::${cell.column}`)
      }
    }
  }

  const immediateTriggered = immediateColumnHits.size > 0 || immediateCellHits.size > 0
  const effectiveImmediateTriggered = isBaselineRun ? false : immediateTriggered

  const prevSummary = isObject(prevRun?.summary) ? prevRun.summary : {}
  const prevTribunalStateByKey = toStateMap(prevSummary?.tribunal_monitoring?.state_by_key)
  const monitorTribunalActivity = Boolean((watchlist.rules as any)?.monitor_tribunal_activity)

  const maxLookups = Math.max(5, Math.min(350, Number(process.env.WATCHLIST_1TA_MAX_LOOKUPS || 80)))
  const lookupConcurrency = Math.max(
    1,
    Math.min(8, Number(process.env.WATCHLIST_1TA_LOOKUP_CONCURRENCY || 4))
  )

  const tribunalParsedRows = monitorTribunalActivity
    ? Array.from(nextMap.entries()).map(([key, row]) => {
        const rawRow = nextRawByKey.get(key) || row
        const parsed = extractTribunalRolFromRow(rawRow)
        return {
          key,
          row: rawRow,
          rol: parsed.rol,
          tribunalCode: normalizeTribunalCode(parsed.tribunalCode || parsed.tribunal),
        }
      })
    : []

  const withRol = tribunalParsedRows.filter((row) => Boolean(row.rol))
  const oneTaRows = withRol.filter((row) => row.tribunalCode === "1TA")
  const unsupportedRows = withRol.filter((row) => row.tribunalCode !== "1TA")
  const lookedRows = oneTaRows.slice(0, maxLookups)
  const skippedByLimitRows = oneTaRows.slice(maxLookups)

  const tribunalStateByKey: Record<string, TribunalStateRow> = {}
  const tribunalUpdates: Array<{
    key: string
    tribunal: string
    rol: string
    previousEstado: string | null
    currentEstado: string | null
    previousMovimiento: string | null
    currentMovimiento: string | null
    hasCasacion: boolean
    recursoTipo: string | null
    linkCausa: string | null
  }> = []
  const tribunalErrors: Array<{ key: string; rol: string; error: string }> = []

  const lookupResults = monitorTribunalActivity
    ? await mapWithConcurrency(lookedRows, lookupConcurrency, async (target) => {
        try {
          const snapshot = await fetch1TACauseSnapshotByRol({ rol: String(target.rol || "") })
          if (!snapshot.found) {
            return { key: target.key, rol: String(target.rol || ""), kind: "not_found" as const }
          }

          const state: TribunalStateRow = {
            tribunal: "1TA",
            rol: snapshot.rol,
            estado: snapshot.estado || null,
            estadoSubtipo: snapshot.estadoSubtipo || null,
            caratula: snapshot.caratula || null,
            fechaIngreso: snapshot.fechaIngreso || null,
            latestMovementDate: snapshot.latestMovement?.date || null,
            latestMovementLabel: snapshot.latestMovement?.label || null,
            latestMovementActor: snapshot.latestMovement?.actor || null,
            hasCasacion: Boolean(snapshot.hasCasacion),
            recursoTipo: snapshot.recursoTipo || null,
            fetchedAt: nowIso,
          }

          return {
            key: target.key,
            rol: snapshot.rol,
            kind: "ok" as const,
            linkCausa: snapshot.linkCausa || null,
            state,
          }
        } catch (err: any) {
          return {
            key: target.key,
            rol: String(target.rol || ""),
            kind: "error" as const,
            error: err?.message ? String(err.message) : String(err),
          }
        }
      })
    : []

  let tribunalNotFound = 0
  let tribunalUnchanged = 0

  for (const row of lookupResults) {
    if (row.kind === "not_found") {
      tribunalNotFound += 1
      const prev = prevTribunalStateByKey[row.key]
      if (prev) tribunalStateByKey[row.key] = prev
      continue
    }

    if (row.kind === "error") {
      tribunalErrors.push({ key: row.key, rol: row.rol, error: row.error })
      const prev = prevTribunalStateByKey[row.key]
      if (prev) tribunalStateByKey[row.key] = prev
      continue
    }

    tribunalStateByKey[row.key] = row.state

    const prev = prevTribunalStateByKey[row.key] || null
    if (stateChanged(prev, row.state)) {
      tribunalUpdates.push({
        key: row.key,
        tribunal: "1TA",
        rol: row.state.rol,
        previousEstado: prev?.estado || null,
        currentEstado: row.state.estado || null,
        previousMovimiento: prev?.latestMovementLabel || null,
        currentMovimiento: row.state.latestMovementLabel || null,
        hasCasacion: row.state.hasCasacion,
        recursoTipo: row.state.recursoTipo,
        linkCausa: row.linkCausa,
      })
    } else {
      tribunalUnchanged += 1
    }
  }

  for (const skipped of skippedByLimitRows) {
    const prev = prevTribunalStateByKey[skipped.key]
    if (prev) {
      tribunalStateByKey[skipped.key] = prev
    }
  }

  for (const unsupported of unsupportedRows) {
    const prev = prevTribunalStateByKey[unsupported.key]
    if (prev) {
      tribunalStateByKey[unsupported.key] = prev
    }
  }

  const tribunalMonitoring = {
    enabled: monitorTribunalActivity,
    fetched_at: nowIso,
    total_rows: nextMap.size,
    parsed_rows: withRol.length,
    one_ta_rows: oneTaRows.length,
    looked_up: lookedRows.length,
    skipped_by_limit: skippedByLimitRows.length,
    unsupported_rows: unsupportedRows.length,
    not_found: tribunalNotFound,
    errors: tribunalErrors.length,
    changed_cases: tribunalUpdates.length,
    unchanged_cases: tribunalUnchanged,
    updates: tribunalUpdates.slice(0, 120),
    errors_preview: tribunalErrors.slice(0, 40),
    state_by_key: tribunalStateByKey,
  }

  const effectiveAdded = isBaselineRun ? [] : added
  const effectiveRemoved = isBaselineRun ? [] : removed
  const effectiveModified = isBaselineRun ? [] : modified
  const effectiveTribunalMonitoring = {
    ...tribunalMonitoring,
    changed_cases: isBaselineRun ? 0 : tribunalMonitoring.changed_cases,
    updates: isBaselineRun ? [] : tribunalMonitoring.updates,
  }

  const changed =
    effectiveAdded.length + effectiveRemoved.length + effectiveModified.length > 0 || effectiveTribunalMonitoring.changed_cases > 0
  const summary = {
    added: effectiveAdded.length,
    removed: effectiveRemoved.length,
    modified: effectiveModified.length,
    sheet: targetSheetName,
    etag_unchanged: Boolean(etag && watchlist.last_etag && etag === watchlist.last_etag),
    baseline_established: isBaselineRun,
    baseline_rows: isBaselineRun ? nextMap.size : 0,
    monitoring_scope: {
      watched_columns: watchedColumns.length,
      watched_rows: watchedRows.length,
      watched_cells: watchedCells.length,
      granular_selection: useGranularSelection,
    },
    immediate_alerts: {
      configured_columns: immediateColumns,
      configured_cells: immediateCells,
      triggered: effectiveImmediateTriggered,
      triggered_columns: isBaselineRun ? [] : Array.from(immediateColumnHits),
      triggered_cells: isBaselineRun ? [] : Array.from(immediateCellHits),
    },
    tribunal_monitoring: effectiveTribunalMonitoring,
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

  if (changed || isBaselineRun) {
    const snapshotPath = `snapshots/${watchlistId}/${run.id}.json`
    const diffPath = `diffs/${watchlistId}/${run.id}.json`

    await uploadToBucket(
      supabase,
      "gob_excel",
      snapshotPath,
      Buffer.from(JSON.stringify(Array.from(nextRawByKey.values())), "utf8"),
      "application/json"
    )
    await uploadToBucket(
      supabase,
      "gob_excel",
      diffPath,
      Buffer.from(
        JSON.stringify(
          {
            added: effectiveAdded,
            removed: effectiveRemoved,
            modified: effectiveModified,
            tribunal_updates: summary.tribunal_monitoring?.updates || [],
            tribunal_errors: summary.tribunal_monitoring?.errors_preview || [],
            baseline_established: isBaselineRun,
            baseline_rows: isBaselineRun ? nextMap.size : 0,
          },
          null,
          2
        ),
        "utf8"
      ),
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
      baseline_established: isBaselineRun,
      summary,
      manual: manualTrigger,
      force: forceRun,
    },
    timestamp: nowIso,
  })

  if (changed) {
    const tribunalChangedCount = Number(summary.tribunal_monitoring?.changed_cases || 0)
    const msgParts = [`Excel cambio: +${effectiveAdded.length} ~${effectiveModified.length} -${effectiveRemoved.length}`]
    if (tribunalChangedCount > 0) {
      msgParts.push(`Tribunal actualizado: ${tribunalChangedCount}`)
    }

    await supabase.from("gob_alerts").insert({
      workspace_id: watchlist.workspace_id,
      watchlist_id: watchlistId,
      message: msgParts.join(" | "),
      severity: "info",
      metadata: {
        run_id: run.id,
        file_id: watchlist.file_id,
        tribunal_changed_cases: tribunalChangedCount,
        baseline_established: isBaselineRun,
      },
    })
  }

  // enqueue next check
  if (!pausedMode) {
    const alreadyQueued = await hasQueuedJob("excel_check")
    if (!alreadyQueued) {
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
  }

  const criticalAlerts = Boolean((watchlist.rules as any)?.critical_alerts) || normalizeRuleCriticalFlag(watchlist.rules)

  // immediate email (direct schedule or daily+critical profile)
  if (
    changed &&
    !pausedMode &&
    (watchlist.email_schedule?.type === "immediate" ||
      ((watchlist.email_schedule?.type === "daily" || watchlist.email_schedule?.type === "interval") && (criticalAlerts || effectiveImmediateTriggered)))
  ) {
    const alreadyQueued = await hasQueuedJob("email_digest")
    if (!alreadyQueued) {
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

        if (type === "removed_row") {
          if (!removed.length) continue
          await supabase.from("gob_alerts").insert({
            workspace_id: watchlist.workspace_id,
            watchlist_id: watchlistId,
            message: rule?.message || `Regla: filas eliminadas (${removed.length})`,
            severity: severity,
            metadata: { run_id: run.id, type, removed: removed.length },
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

        if (type === "column_condition") {
          const trigger = String(rule?.trigger || "changed").trim().toLowerCase()
          const operator = String(rule?.operator || "equals").trim().toLowerCase()
          const value = rule?.value

          const hits =
            trigger === "current"
              ? Array.from(nextMap.entries()).filter(([_, row]) => matchesColumnOperator({
                  operator,
                  actualValue: row?.[column],
                  expectedValue: value,
                }))
              : modified.filter((m) => {
                  const change = m?.changes?.[column]
                  if (!change) return false
                  return matchesColumnOperator({
                    operator,
                    actualValue: change.after,
                    expectedValue: value,
                  })
                })

          if (!hits.length) continue

          const operatorLabel =
            operator === "contains"
              ? "contiene"
              : operator === "empty"
                ? "queda vacia"
                : operator === "not_empty"
                  ? "queda con valor"
                  : operator === "gt"
                    ? ">"
                    : operator === "gte"
                      ? ">="
                      : operator === "lt"
                        ? "<"
                        : operator === "lte"
                          ? "<="
                          : "="

          await supabase.from("gob_alerts").insert({
            workspace_id: watchlist.workspace_id,
            watchlist_id: watchlistId,
            message:
              rule?.message ||
              `Regla: '${column}' ${operatorLabel}${value !== undefined && value !== null && operator !== "empty" && operator !== "not_empty" ? ` '${String(value)}'` : ""} (${hits.length} fila(s))`,
            severity: severity,
            metadata: { run_id: run.id, column, type, operator, trigger, value, hits: hits.length },
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
