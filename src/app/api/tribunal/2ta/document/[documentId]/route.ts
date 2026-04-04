import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { create2TASessionForWorker, download2TADocument } from "@/lib/tribunal/two-ta"

function parseDocumentId(value: string) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const id = Math.floor(n)
  if (id <= 0) return null
  return id
}

function guessFileExtension(contentType: string | null) {
  const ct = String(contentType || "").toLowerCase()
  if (ct.includes("pdf")) return "pdf"
  if (ct.includes("wordprocessingml")) return "docx"
  if (ct.includes("msword")) return "doc"
  return "bin"
}

export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const params = await context.params
  const documentId = parseDocumentId(String(params.documentId || ""))
  if (!documentId) {
    return NextResponse.json({ error: "Invalid document id" }, { status: 400 })
  }

  try {
    const session = await create2TASessionForWorker()
    const { buffer, contentType } = await download2TADocument({ session, documentId })
    const ext = guessFileExtension(contentType)
    const filename = `2ta-doc-${documentId}.${ext}`
    const url = new URL(request.url)
    const forceDownload = ["1", "true", "yes"].includes(
      String(url.searchParams.get("download") || "")
        .trim()
        .toLowerCase()
    )

    return new NextResponse(buffer as any, {
      status: 200,
      headers: {
        "content-type": contentType || "application/octet-stream",
        "content-disposition": `${forceDownload ? "attachment" : "inline"}; filename="${filename}"`,
        "cache-control": "private, no-store, max-age=0",
      },
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        error: "2TA document fetch failed",
        detail: error?.message ? String(error.message) : "Unknown error",
      },
      { status: 502 }
    )
  }
}
