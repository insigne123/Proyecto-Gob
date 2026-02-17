import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"

const PatchSchema = z
  .object({
    title: z.string().trim().min(3).max(140).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    status: z.enum(["active", "archived"]).optional(),
    allowedDomains: z.array(z.string().trim().min(1).max(200)).optional(),
  })
  .strict()

export async function PATCH(
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
  if (member.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const update: any = { updated_at: new Date().toISOString() }
  if (typeof parsed.data.title === "string") update.title = parsed.data.title
  if ("description" in parsed.data) update.description = parsed.data.description ?? null
  if (parsed.data.status) update.status = parsed.data.status
  if (parsed.data.allowedDomains) update.allowed_domains = parsed.data.allowedDomains

  const { error } = await supabase
    .from("gob_workspaces")
    .update(update)
    .eq("id", workspaceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "workspace.update",
    target_resource: "gob_workspaces",
    details: { workspace_id: workspaceId, fields: Object.keys(update) },
    timestamp: new Date().toISOString(),
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: Request,
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
  if (member.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 })
  }

  const { error } = await supabase.from("gob_workspaces").delete().eq("id", workspaceId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "workspace.delete",
    target_resource: "gob_workspaces",
    details: { workspace_id: workspaceId },
    timestamp: new Date().toISOString(),
  })

  return NextResponse.json({ ok: true })
}
