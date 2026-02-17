import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; inviteId: string }> }
) {
  const { workspaceId, inviteId } = await params
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

  const now = new Date().toISOString()
  const { error } = await supabase
    .from("gob_workspace_invites")
    .delete()
    .eq("id", inviteId)
    .eq("workspace_id", workspaceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "workspace.invite.delete",
    target_resource: "gob_workspace_invites",
    details: { workspace_id: workspaceId, invite_id: inviteId },
    timestamp: now,
  })

  return NextResponse.json({ ok: true })
}
