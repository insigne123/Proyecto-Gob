import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"

const CreateNoteSchema = z.object({
  title: z.string().trim().max(240).nullable().optional(),
  content: z.string().trim().min(1).max(20000),
  visibility: z.enum(["shared", "private"]).default("shared"),
  citations: z.any().optional(),
})

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
    .from("gob_notes")
    .select("id,title,content,created_at,visibility")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(80)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ notes: data ?? [] })
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
  const parsed = CreateNoteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const now = new Date().toISOString()
  const { data: note, error } = await supabase
    .from("gob_notes")
    .insert({
      workspace_id: workspaceId,
      title: parsed.data.title ?? null,
      content: parsed.data.content,
      citations: parsed.data.citations ?? [],
      visibility: parsed.data.visibility,
      created_at: now,
      created_by: user.id,
    })
    .select("id")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "note.create",
    target_resource: "gob_notes",
    details: { workspace_id: workspaceId, note_id: note.id },
    timestamp: now,
  })

  return NextResponse.json({ id: note.id })
}
