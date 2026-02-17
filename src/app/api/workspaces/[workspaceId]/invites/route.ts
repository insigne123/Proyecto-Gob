import crypto from "crypto"

import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"

const CreateSchema = z
  .object({
    email: z.string().trim().email().max(240),
    role: z.enum(["admin", "analyst", "viewer"]).default("viewer"),
    expiresInDays: z.number().int().min(1).max(60).default(7),
  })
  .strict()

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

  const { data, error } = await supabase
    .from("gob_workspace_invites")
    .select("id,email,role,token,created_at,expires_at,accepted_at,accepted_by")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const invites = (data ?? []).map((i: any) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    token: i.token,
    createdAt: i.created_at ?? null,
    expiresAt: i.expires_at ?? null,
    acceptedAt: i.accepted_at ?? null,
    acceptedBy: i.accepted_by ?? null,
  }))

  return NextResponse.json({ invites })
}

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
  if (member.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const now = new Date()
  const nowIso = now.toISOString()
  const expiresAt = new Date(now.getTime() + parsed.data.expiresInDays * 24 * 60 * 60_000).toISOString()
  const token = crypto.randomBytes(24).toString("base64url")

  const { data: invite, error } = await supabase
    .from("gob_workspace_invites")
    .insert({
      workspace_id: workspaceId,
      created_at: nowIso,
      email: parsed.data.email,
      role: parsed.data.role,
      token,
      expires_at: expiresAt,
      created_by: user.id,
    })
    .select("id")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "workspace.invite.create",
    target_resource: "gob_workspace_invites",
    details: { workspace_id: workspaceId, invite_id: invite.id, email: parsed.data.email, role: parsed.data.role },
    timestamp: nowIso,
  })

  return NextResponse.json({
    id: invite.id,
    token,
    expiresAt,
  })
}
