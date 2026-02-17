import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

const BodySchema = z
  .object({
    token: z.string().trim().min(12).max(240),
  })
  .strict()

function normEmail(email: string) {
  return email.trim().toLowerCase()
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const userEmail = user.email
  if (!userEmail) {
    return NextResponse.json({ error: "User has no email" }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: invite, error: iErr } = await admin
    .from("gob_workspace_invites")
    .select("id,workspace_id,email,role,token,expires_at,accepted_at,accepted_by")
    .eq("token", parsed.data.token)
    .maybeSingle()

  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 })
  if (!invite) return NextResponse.json({ error: "Invite not found" }, { status: 404 })

  const now = new Date()
  const nowIso = now.toISOString()
  const expiresAt = invite.expires_at ? new Date(invite.expires_at) : null

  if (expiresAt && expiresAt.getTime() < now.getTime()) {
    return NextResponse.json({ error: "Invite expired" }, { status: 400 })
  }

  if (invite.accepted_at) {
    return NextResponse.json({ ok: true, workspaceId: invite.workspace_id })
  }

  if (normEmail(String(invite.email || "")) !== normEmail(userEmail)) {
    return NextResponse.json(
      { error: "Invite email mismatch", details: { inviteEmail: invite.email, userEmail } },
      { status: 403 }
    )
  }

  const { error: mErr } = await admin
    .from("gob_workspace_members")
    .upsert(
      {
        workspace_id: invite.workspace_id,
        user_id: user.id,
        role: invite.role,
        created_at: nowIso,
      },
      { onConflict: "workspace_id,user_id" }
    )

  if (mErr) {
    return NextResponse.json(
      { error: "Membership upsert failed", details: mErr.message },
      { status: 500 }
    )
  }

  const { error: aErr } = await admin
    .from("gob_workspace_invites")
    .update({ accepted_at: nowIso, accepted_by: user.id })
    .eq("id", invite.id)

  if (aErr) {
    return NextResponse.json(
      { error: "Invite accept failed", details: aErr.message },
      { status: 500 }
    )
  }

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "workspace.invite.accept",
    target_resource: "gob_workspace_members",
    details: { workspace_id: invite.workspace_id, invite_id: invite.id, role: invite.role },
    timestamp: nowIso,
  })

  return NextResponse.json({ ok: true, workspaceId: invite.workspace_id })
}
