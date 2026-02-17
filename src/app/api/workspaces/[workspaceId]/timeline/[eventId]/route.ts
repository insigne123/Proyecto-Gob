import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"

const PatchSchema = z
  .object({
    occurredAt: z.string().datetime().nullable().optional(),
    kind: z
      .enum(["ingreso", "oficio", "informe", "audiencia", "resolucion", "otro"])
      .optional(),
    title: z.string().trim().min(2).max(240).optional(),
    description: z.string().trim().max(8000).nullable().optional(),
    snapshotIds: z.array(z.string().uuid()).optional(),
    metadata: z.any().optional(),
  })
  .strict()

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; eventId: string }> }
) {
  const { workspaceId, eventId } = await params
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

  const patch = parsed.data
  const now = new Date().toISOString()

  const update: any = { updated_at: now }
  if ("occurredAt" in patch) update.occurred_at = patch.occurredAt ?? null
  if (patch.kind) update.kind = patch.kind
  if (patch.title) update.title = patch.title
  if ("description" in patch) update.description = patch.description ?? null
  if ("metadata" in patch) update.metadata = patch.metadata ?? {}

  const { error: upErr } = await supabase
    .from("gob_workspace_timeline_events")
    .update(update)
    .eq("id", eventId)
    .eq("workspace_id", workspaceId)

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  if (Array.isArray(patch.snapshotIds)) {
    const { error: delErr } = await supabase
      .from("gob_workspace_timeline_event_snapshots")
      .delete()
      .eq("event_id", eventId)

    if (delErr) {
      return NextResponse.json(
        { error: "Event updated but snapshot unlink failed", details: delErr.message },
        { status: 500 }
      )
    }

    if (patch.snapshotIds.length) {
      const rows = patch.snapshotIds.map((sid) => ({
        event_id: eventId,
        snapshot_id: sid,
        created_at: now,
      }))
      const { error: insErr } = await supabase
        .from("gob_workspace_timeline_event_snapshots")
        .insert(rows)

      if (insErr) {
        return NextResponse.json(
          { error: "Event updated but snapshot linking failed", details: insErr.message },
          { status: 500 }
        )
      }
    }
  }

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "workspace.timeline.update",
    target_resource: "gob_workspace_timeline_events",
    details: { workspace_id: workspaceId, event_id: eventId, fields: Object.keys(update) },
    timestamp: now,
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; eventId: string }> }
) {
  const { workspaceId, eventId } = await params
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

  const now = new Date().toISOString()
  const { error } = await supabase
    .from("gob_workspace_timeline_events")
    .delete()
    .eq("id", eventId)
    .eq("workspace_id", workspaceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "workspace.timeline.delete",
    target_resource: "gob_workspace_timeline_events",
    details: { workspace_id: workspaceId, event_id: eventId },
    timestamp: now,
  })

  return NextResponse.json({ ok: true })
}
