import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"

const PatchSchema = z
  .object({
    status: z.enum(["draft", "review", "final"]).optional(),
    title: z.string().trim().min(1).max(240).optional(),
    sections: z
      .array(
        z.object({
          heading: z.string().trim().min(1).max(240),
          body: z.string().trim().min(0).max(80000),
        })
      )
      .optional(),
    note: z.string().trim().max(400).optional(),
  })
  .strict()

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; reportId: string }> }
) {
  const { workspaceId, reportId } = await params
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
  if (member.role === "viewer") {
    return NextResponse.json({ error: "Read-only role" }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const now = new Date().toISOString()

  const { data: report, error: rErr } = await supabase
    .from("gob_reports")
    .select("id,workspace_id,status,content_json")
    .eq("id", reportId)
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })
  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const currentStatus = String(report.status || "draft")
  const contentJson = (report.content_json as any) ?? {}

  const wantsContentUpdate =
    typeof parsed.data.title === "string" || Array.isArray(parsed.data.sections)

  if (currentStatus === "final" && wantsContentUpdate) {
    return NextResponse.json({ error: "Report is final (locked)" }, { status: 403 })
  }

  // Save version snapshot (before changes)
  if (wantsContentUpdate || parsed.data.status) {
    await supabase.from("gob_report_versions").insert({
      report_id: reportId,
      workspace_id: workspaceId,
      created_at: now,
      status: currentStatus,
      note: parsed.data.note ?? null,
      content_json: contentJson,
      created_by: user.id,
    })
  }

  const nextContent = { ...contentJson }
  if (typeof parsed.data.title === "string") nextContent.title = parsed.data.title
  if (Array.isArray(parsed.data.sections)) {
    nextContent.sections = parsed.data.sections.map((s) => ({
      ...s,
      citations: Array.isArray((s as any).citations) ? (s as any).citations : [],
    }))
    nextContent.manual_edits = true
    nextContent.manual_edited_at = now
  }

  const update: any = { content_json: nextContent }
  if (parsed.data.status) update.status = parsed.data.status

  const { error: upErr } = await supabase
    .from("gob_reports")
    .update(update)
    .eq("id", reportId)
    .eq("workspace_id", workspaceId)

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "report.update",
    target_resource: "gob_reports",
    details: {
      workspace_id: workspaceId,
      report_id: reportId,
      status: parsed.data.status ?? null,
      manual_edit: wantsContentUpdate,
    },
    timestamp: now,
  })

  return NextResponse.json({ ok: true })
}
