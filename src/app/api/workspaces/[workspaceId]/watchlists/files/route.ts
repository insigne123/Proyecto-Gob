import { NextResponse } from "next/server"
import { z } from "zod"

import { listExcelFiles } from "@/lib/watchlists/provider-files"
import { createClient } from "@/lib/supabase/server"

const QuerySchema = z.object({
  connectionId: z.string().uuid(),
  q: z.string().trim().max(120).optional(),
})

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
    q: url.searchParams.get("q") || undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  try {
    const result = await listExcelFiles({
      supabase,
      userId: user.id,
      connectionId: parsed.data.connectionId,
      query: parsed.data.q || "",
    })

    return NextResponse.json({
      provider: result.provider,
      files: result.files,
    })
  } catch (err: any) {
    const message = err?.message ?? "Could not list files"
    const status = message === "Connection not found" ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
