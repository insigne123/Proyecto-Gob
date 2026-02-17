import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

const CreateWorkspaceSchema = z.object({
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().max(4000).optional().nullable(),
})

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data, error } = await supabase
    .from("gob_workspaces")
    .select("id,title,description,status,created_at,updated_at")
    .order("updated_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ workspaces: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = CreateWorkspaceSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const now = new Date().toISOString()
  const admin = createAdminClient()

  const { data: workspace, error: wErr } = await admin
    .from("gob_workspaces")
    .insert({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      status: "active",
      created_by: user.id,
      updated_at: now,
    })
    .select("id")
    .single()

  if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 })

  const { error: mErr } = await admin.from("gob_workspace_members").insert({
    workspace_id: workspace.id,
    user_id: user.id,
    role: "admin",
    created_at: now,
  })

  if (mErr) {
    // best-effort rollback is not available via PostgREST; keep error explicit
    return NextResponse.json(
      { error: "Workspace created but membership failed", details: mErr.message },
      { status: 500 }
    )
  }

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "workspace.create",
    target_resource: "gob_workspaces",
    details: { workspace_id: workspace.id },
    timestamp: now,
  })

  return NextResponse.json({ id: workspace.id })
}
