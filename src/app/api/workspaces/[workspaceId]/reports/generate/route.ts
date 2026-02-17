import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getReportTemplate } from "@/lib/reports/template"

const GenerateSchema = z.object({
  template: z.string().trim().min(1).max(120).optional(),
})

export async function POST(
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
  if (member.role === "viewer") {
    return NextResponse.json({ error: "Read-only role" }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = GenerateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const now = new Date().toISOString()

  const template = getReportTemplate(parsed.data.template ?? "informe-evaluacion")

  const { data: workspace } = await supabase
    .from("gob_workspaces")
    .select("id,title")
    .eq("id", workspaceId)
    .maybeSingle()

  if (!workspace) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { data: report, error: rErr } = await supabase
    .from("gob_reports")
    .insert({
      workspace_id: workspaceId,
      created_at: now,
      status: "draft",
      content_json: {
        title: template.title,
        sections: template.sections.map((s) => ({
          heading: s.heading,
          body: "Generando...",
          citations: [],
        })),
        generation: {
          status: "running",
          step: 0,
          total: template.sections.length,
          template: template.id,
          started_at: now,
        },
      },
      citations: [],
      created_by_model: null,
      created_by: user.id,
    })
    .select("id")
    .single()

  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "report.generate",
    target_resource: "gob_reports",
    details: { workspace_id: workspaceId, report_id: report.id, template: parsed.data.template ?? null },
    timestamp: now,
  })

  const admin = createAdminClient()
  const { error: jErr } = await admin.from("gob_jobs").insert({
    type: "report_generate",
    status: "pending",
    available_at: now,
    attempts: 0,
    max_attempts: 5,
    payload: { report_id: report.id, workspace_id: workspaceId },
    created_at: now,
  })
  if (jErr) {
    return NextResponse.json(
      { error: "Report created but job enqueue failed", details: jErr.message },
      { status: 500 }
    )
  }

  return NextResponse.json({ id: report.id })
}
