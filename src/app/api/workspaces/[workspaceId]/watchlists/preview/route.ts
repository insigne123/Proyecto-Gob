import { NextResponse } from "next/server"
import { z } from "zod"
import * as XLSX from "xlsx"

import { downloadWorkbook } from "@/lib/watchlists/provider-files"
import { createClient } from "@/lib/supabase/server"

const QuerySchema = z.object({
  connectionId: z.string().uuid(),
  fileId: z.string().trim().min(1).max(512),
  sheetName: z.string().trim().max(128).optional(),
})

function pickColumns(rows: Array<Record<string, any>>) {
  const set = new Set<string>()

  for (const row of rows.slice(0, 180)) {
    for (const key of Object.keys(row || {})) {
      const column = String(key || "").trim()
      if (!column) continue
      set.add(column)
      if (set.size >= 180) break
    }
    if (set.size >= 180) break
  }

  return Array.from(set)
}

function normalizeSampleRows(rows: Array<Record<string, any>>, columns: string[]) {
  const visibleColumns = columns.slice(0, 40)
  return rows.slice(0, 20).map((row) => {
    const out: Record<string, any> = {}
    for (const column of visibleColumns) {
      out[column] = row?.[column] ?? null
    }
    return out
  })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: member } = await supabase
    .from("gob_workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const url = new URL(request.url)
  const parsed = QuerySchema.safeParse({
    connectionId: url.searchParams.get("connectionId"),
    fileId: url.searchParams.get("fileId"),
    sheetName: url.searchParams.get("sheetName") || undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  try {
    const workbookFile = await downloadWorkbook({
      supabase,
      userId: user.id,
      connectionId: parsed.data.connectionId,
      fileId: parsed.data.fileId,
    })

    const workbook = XLSX.read(workbookFile.buffer, { type: "buffer" })
    const sheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : []
    if (!sheetNames.length) {
      return NextResponse.json({ error: "Workbook without sheets" }, { status: 400 })
    }

    const selectedSheet =
      parsed.data.sheetName && sheetNames.includes(parsed.data.sheetName)
        ? parsed.data.sheetName
        : sheetNames[0]

    const sheet = workbook.Sheets[selectedSheet]
    if (!sheet) return NextResponse.json({ error: "Sheet not found" }, { status: 404 })

    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null }) as Array<Record<string, any>>

    let columns = pickColumns(rows)
    if (columns.length === 0) {
      const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as Array<any[]>
      if (Array.isArray(matrix[0])) {
        columns = matrix[0]
          .map((cell, idx) => {
            const c = String(cell ?? "").trim()
            return c || `col_${idx + 1}`
          })
          .slice(0, 180)
      }
    }

    return NextResponse.json({
      file: {
        id: workbookFile.fileId,
        name: workbookFile.fileName || "Archivo",
        provider: workbookFile.provider,
        modifiedAt: workbookFile.modifiedAt,
        webUrl: workbookFile.webUrl,
        mimeType: workbookFile.mimeType,
      },
      sheetNames,
      selectedSheet,
      rowCount: rows.length,
      columns,
      sampleRows: normalizeSampleRows(rows, columns),
    })
  } catch (err: any) {
    const message = err?.message ?? "Could not preview file"
    const status = message === "Connection not found" ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
