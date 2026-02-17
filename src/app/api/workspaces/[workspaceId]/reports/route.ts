import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data, error } = await supabase
    .from("gob_reports")
    .select("id,status,created_at,content_json")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const reports = (data ?? []).map((r: any) => ({
    id: String(r.id),
    status: String(r.status || "draft"),
    created_at: r.created_at ?? null,
    title:
      r?.content_json?.title && typeof r.content_json.title === "string"
        ? String(r.content_json.title)
        : null,
    template:
      r?.content_json?.generation?.template && typeof r.content_json.generation.template === "string"
        ? String(r.content_json.generation.template)
        : null,
    generation_status:
      r?.content_json?.generation?.status && typeof r.content_json.generation.status === "string"
        ? String(r.content_json.generation.status)
        : null,
    generation_step:
      typeof r?.content_json?.generation?.step === "number"
        ? r.content_json.generation.step
        : null,
    generation_total:
      typeof r?.content_json?.generation?.total === "number"
        ? r.content_json.generation.total
        : null,
  }))

  return NextResponse.json({ reports })
}
