import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const url = new URL(request.url)
  const limitRaw = Number(url.searchParams.get("limit") || 100)
  const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 100))

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

  const { data, error } = await supabase
    .from("gob_rag_retrieval_traces")
    .select(
      "id,created_at,stage,provider,query,filters,results,response_id,model,thread_id,message_id,report_id,metadata"
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ traces: data ?? [] })
}
