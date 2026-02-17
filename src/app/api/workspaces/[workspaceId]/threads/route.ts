import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"

const CreateSchema = z
  .object({
    title: z.string().trim().min(2).max(140),
    purpose: z.string().trim().max(600).nullable().optional(),
    mode: z.enum(["extractive", "comparison", "checklist", "resolution"]).default("extractive"),
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

  const { data, error } = await supabase
    .from("gob_chat_threads")
    .select("id,workspace_id,title,purpose,mode,created_at,updated_at")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(80)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const threads = (data ?? []).map((t: any) => ({
    id: t.id,
    title: t.title,
    purpose: t.purpose ?? null,
    mode: t.mode,
    createdAt: t.created_at ?? null,
    updatedAt: t.updated_at ?? null,
  }))

  return NextResponse.json({ threads })
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
  if (member.role === "viewer") {
    return NextResponse.json({ error: "Read-only role" }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const now = new Date().toISOString()
  const { data: row, error } = await supabase
    .from("gob_chat_threads")
    .insert({
      workspace_id: workspaceId,
      title: parsed.data.title,
      purpose: parsed.data.purpose ?? null,
      mode: parsed.data.mode,
      created_at: now,
      updated_at: now,
      created_by: user.id,
    })
    .select("id")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "chat.thread.create",
    target_resource: "gob_chat_threads",
    details: { workspace_id: workspaceId, thread_id: row.id, mode: parsed.data.mode },
    timestamp: now,
  })

  return NextResponse.json({ id: row.id })
}
