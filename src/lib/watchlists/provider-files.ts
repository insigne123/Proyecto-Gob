import { google } from "googleapis"

import { decryptJson, encryptJson } from "@/lib/crypto"

type Provider = "google" | "microsoft"

type ConnectionRow = {
  id: string
  provider: Provider
  tokens_enc: string
}

export type ProviderFileItem = {
  id: string
  name: string
  provider: Provider
  modifiedAt: string | null
  webUrl: string | null
  mimeType: string | null
}

export type WorkbookDownload = {
  fileId: string
  fileName: string | null
  provider: Provider
  modifiedAt: string | null
  webUrl: string | null
  mimeType: string | null
  buffer: Buffer
}

function requireGoogleCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET")
  }
  return { clientId, clientSecret }
}

function requireMicrosoftCredentials() {
  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error("Missing MICROSOFT_CLIENT_ID/MICROSOFT_CLIENT_SECRET")
  }
  return { clientId, clientSecret }
}

function isExcelLike(name: string | null | undefined, mimeType: string | null | undefined) {
  const n = String(name || "").toLowerCase()
  const m = String(mimeType || "").toLowerCase()

  if (m.includes("spreadsheet") || m.includes("excel") || m.includes("sheet")) return true
  return /\.(xlsx|xlsm|xlsb|xls|csv)$/i.test(n)
}

async function persistTokens(supabase: any, connectionId: string, tokens: any) {
  await supabase
    .from("gob_oauth_connections")
    .update({
      tokens_enc: encryptJson(tokens),
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectionId)
}

async function getConnection(params: {
  supabase: any
  userId: string
  connectionId: string
}) {
  const { supabase, userId, connectionId } = params
  const { data, error } = await supabase
    .from("gob_oauth_connections")
    .select("id,provider,tokens_enc")
    .eq("id", connectionId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null
  return data as ConnectionRow
}

async function refreshMicrosoftToken(refreshToken: string) {
  const { clientId, clientSecret } = requireMicrosoftCredentials()

  const tokenUrl = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
  const body = new URLSearchParams()
  body.set("client_id", clientId)
  body.set("client_secret", clientSecret)
  body.set("grant_type", "refresh_token")
  body.set("refresh_token", refreshToken)
  body.set("scope", ["offline_access", "User.Read", "Files.Read"].join(" "))

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  })
  const json = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`microsoft refresh failed: ${JSON.stringify(json)}`)
  }
  return json
}

function createGoogleDriveClient(params: {
  supabase: any
  connectionId: string
  tokens: any
}) {
  const { supabase, connectionId } = params
  const { clientId, clientSecret } = requireGoogleCredentials()

  let tokens = params.tokens
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret)
  oauth2.setCredentials(tokens)
  oauth2.on("tokens", async (newTokens) => {
    if (!newTokens || Object.keys(newTokens).length === 0) return
    tokens = { ...tokens, ...newTokens }
    await persistTokens(supabase, connectionId, tokens)
  })

  return {
    drive: google.drive({ version: "v3", auth: oauth2 }),
    getTokens: () => tokens,
  }
}

function createMicrosoftClient(params: {
  supabase: any
  connectionId: string
  tokens: any
}) {
  const { supabase, connectionId } = params
  let tokens = params.tokens

  async function request(url: string, init?: RequestInit) {
    const send = () =>
      fetch(url, {
        ...init,
        headers: {
          ...(init?.headers || {}),
          Authorization: `Bearer ${tokens.access_token}`,
        },
      })

    let response = await send()
    if (response.status !== 401 || !tokens.refresh_token) return response

    const refreshed = await refreshMicrosoftToken(tokens.refresh_token)
    tokens = { ...tokens, ...refreshed }
    await persistTokens(supabase, connectionId, tokens)

    response = await send()
    return response
  }

  return {
    request,
    getTokens: () => tokens,
  }
}

async function listGoogleExcelFiles(params: {
  supabase: any
  connection: ConnectionRow
  query: string
}) {
  const { supabase, connection, query } = params
  const tokens = decryptJson<any>(connection.tokens_enc)
  const { drive } = createGoogleDriveClient({
    supabase,
    connectionId: connection.id,
    tokens,
  })

  const escapedQuery = query.replace(/'/g, "\\'")
  const qParts = [
    "trashed = false",
    "(mimeType='application/vnd.google-apps.spreadsheet' or mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or mimeType='application/vnd.ms-excel')",
  ]
  if (escapedQuery) {
    qParts.push(`name contains '${escapedQuery}'`)
  }

  const response = await drive.files.list({
    q: qParts.join(" and "),
    pageSize: 40,
    orderBy: "modifiedTime desc",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
  })

  const files = Array.isArray(response.data.files) ? response.data.files : []
  return files
    .filter((f) => !!f.id)
    .map((f) => ({
      id: String(f.id),
      name: String(f.name || "Archivo"),
      provider: "google" as const,
      modifiedAt: f.modifiedTime || null,
      webUrl: (f.webViewLink as string) || null,
      mimeType: (f.mimeType as string) || null,
    }))
}

async function listMicrosoftExcelFiles(params: {
  supabase: any
  connection: ConnectionRow
  query: string
}) {
  const { supabase, connection, query } = params
  const tokens = decryptJson<any>(connection.tokens_enc)
  const client = createMicrosoftClient({
    supabase,
    connectionId: connection.id,
    tokens,
  })

  const endpoints = [
    "https://graph.microsoft.com/v1.0/me/drive/recent?$top=60&$select=id,name,lastModifiedDateTime,webUrl,file",
    "https://graph.microsoft.com/v1.0/me/drive/root/children?$top=120&$select=id,name,lastModifiedDateTime,webUrl,file",
  ]

  const merged = new Map<string, ProviderFileItem>()
  for (const endpoint of endpoints) {
    const response = await client.request(endpoint)
    if (!response.ok) continue

    const json = await response.json().catch(() => null)
    const items = Array.isArray(json?.value) ? json.value : []
    for (const item of items) {
      const id = String(item?.id || "")
      if (!id) continue
      const name = String(item?.name || "Archivo")
      const mimeType = item?.file?.mimeType ? String(item.file.mimeType) : null
      if (!isExcelLike(name, mimeType)) continue

      merged.set(id, {
        id,
        name,
        provider: "microsoft",
        modifiedAt: item?.lastModifiedDateTime ? String(item.lastModifiedDateTime) : null,
        webUrl: item?.webUrl ? String(item.webUrl) : null,
        mimeType,
      })
    }
  }

  const lowerQuery = query.trim().toLowerCase()
  return Array.from(merged.values())
    .filter((f) => (lowerQuery ? f.name.toLowerCase().includes(lowerQuery) : true))
    .sort((a, b) => {
      const at = a.modifiedAt ? Date.parse(a.modifiedAt) : 0
      const bt = b.modifiedAt ? Date.parse(b.modifiedAt) : 0
      return bt - at
    })
    .slice(0, 50)
}

export async function listExcelFiles(params: {
  supabase: any
  userId: string
  connectionId: string
  query?: string | null
}) {
  const query = String(params.query || "").trim().slice(0, 120)
  const connection = await getConnection(params)
  if (!connection) {
    throw new Error("Connection not found")
  }

  if (connection.provider === "google") {
    return {
      provider: "google" as const,
      files: await listGoogleExcelFiles({
        supabase: params.supabase,
        connection,
        query,
      }),
    }
  }

  return {
    provider: "microsoft" as const,
    files: await listMicrosoftExcelFiles({
      supabase: params.supabase,
      connection,
      query,
    }),
  }
}

async function downloadGoogleWorkbook(params: {
  supabase: any
  connection: ConnectionRow
  fileId: string
}) {
  const { supabase, connection, fileId } = params
  const tokens = decryptJson<any>(connection.tokens_enc)
  const { drive } = createGoogleDriveClient({
    supabase,
    connectionId: connection.id,
    tokens,
  })

  const meta = await drive.files.get({
    fileId,
    fields: "id,name,mimeType,modifiedTime,webViewLink",
    supportsAllDrives: true,
  })

  const fileName = meta.data.name || null
  const mimeType = meta.data.mimeType || null
  const modifiedAt = meta.data.modifiedTime || null
  const webUrl = (meta.data as any).webViewLink || null

  let buffer: Buffer
  if (mimeType === "application/vnd.google-apps.spreadsheet") {
    const exported = await drive.files.export(
      {
        fileId,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      { responseType: "arraybuffer" as any }
    )
    buffer = Buffer.from(exported.data as any)
  } else {
    const downloaded = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" as any }
    )
    buffer = Buffer.from(downloaded.data as any)
  }

  return {
    fileId,
    fileName,
    provider: "google" as const,
    modifiedAt,
    webUrl,
    mimeType,
    buffer,
  }
}

async function downloadMicrosoftWorkbook(params: {
  supabase: any
  connection: ConnectionRow
  fileId: string
}) {
  const { supabase, connection, fileId } = params
  const tokens = decryptJson<any>(connection.tokens_enc)
  const client = createMicrosoftClient({
    supabase,
    connectionId: connection.id,
    tokens,
  })

  const metaUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(
    fileId
  )}?$select=id,name,lastModifiedDateTime,webUrl,file`
  const metaResponse = await client.request(metaUrl)
  const metaJson = await metaResponse.json().catch(() => null)
  if (!metaResponse.ok) {
    throw new Error(`graph meta error: ${JSON.stringify(metaJson)}`)
  }

  const contentUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(
    fileId
  )}/content`
  const contentResponse = await client.request(contentUrl)
  if (!contentResponse.ok) {
    const text = await contentResponse.text().catch(() => "")
    throw new Error(`graph download error: ${contentResponse.status} ${text}`)
  }

  const arrayBuffer = await contentResponse.arrayBuffer()
  return {
    fileId,
    fileName: metaJson?.name ? String(metaJson.name) : null,
    provider: "microsoft" as const,
    modifiedAt: metaJson?.lastModifiedDateTime
      ? String(metaJson.lastModifiedDateTime)
      : null,
    webUrl: metaJson?.webUrl ? String(metaJson.webUrl) : null,
    mimeType: metaJson?.file?.mimeType ? String(metaJson.file.mimeType) : null,
    buffer: Buffer.from(arrayBuffer),
  }
}

export async function downloadWorkbook(params: {
  supabase: any
  userId: string
  connectionId: string
  fileId: string
}) {
  const connection = await getConnection(params)
  if (!connection) {
    throw new Error("Connection not found")
  }

  if (connection.provider === "google") {
    return downloadGoogleWorkbook({
      supabase: params.supabase,
      connection,
      fileId: params.fileId,
    })
  }

  return downloadMicrosoftWorkbook({
    supabase: params.supabase,
    connection,
    fileId: params.fileId,
  })
}
