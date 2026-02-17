import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"

const KindSchema = z.enum(["ingreso", "oficio", "informe", "audiencia", "resolucion", "otro"]).default("otro")

const CreateSchema = z
  .object({
    occurredAt: z.string().datetime().nullable().optional(),
    kind: KindSchema,
    title: z.string().trim().min(2).max(240),
    description: z.string().trim().max(8000).nullable().optional(),
    snapshotIds: z.array(z.string().uuid()).default([]),
    metadata: z.any().optional(),
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

  const { data: events, error: eErr } = await supabase
    .from("gob_workspace_timeline_events")
    .select("id,occurred_at,kind,title,description,created_at,updated_at")
    .eq("workspace_id", workspaceId)
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(250)

  if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 })

  const ids = (events ?? []).map((e: any) => String(e.id))
  let links: any[] = []
  if (ids.length) {
    const { data: linkRows, error: lErr } = await supabase
      .from("gob_workspace_timeline_event_snapshots")
      .select("event_id,snapshot_id")
      .in("event_id", ids)

    if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 })
    links = Array.isArray(linkRows) ? linkRows : []
  }

  const byEvent = new Map<string, string[]>()
  for (const l of links) {
    const k = String(l.event_id)
    const arr = byEvent.get(k) ?? []
    arr.push(String(l.snapshot_id))
    byEvent.set(k, arr)
  }

  const out = (events ?? []).map((e: any) => ({
    id: e.id,
    occurredAt: e.occurred_at ?? null,
    kind: e.kind,
    title: e.title,
    description: e.description ?? null,
    snapshotIds: byEvent.get(String(e.id)) ?? [],
    createdAt: e.created_at ?? null,
    updatedAt: e.updated_at ?? null,
  }))

  return NextResponse.json({ events: out })
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
  const payload = parsed.data

  const { data: event, error: insErr } = await supabase
    .from("gob_workspace_timeline_events")
    .insert({
      workspace_id: workspaceId,
      created_at: now,
      updated_at: now,
      occurred_at: payload.occurredAt ?? null,
      kind: payload.kind,
      title: payload.title,
      description: payload.description ?? null,
      metadata: payload.metadata ?? {},
      created_by: user.id,
    })
    .select("id")
    .single()

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  const snapIds = payload.snapshotIds ?? []
  if (snapIds.length) {
    const rows = snapIds.map((sid) => ({
      event_id: event.id,
      snapshot_id: sid,
      created_at: now,
    }))
    const { error: linkErr } = await supabase
      .from("gob_workspace_timeline_event_snapshots")
      .insert(rows)

    if (linkErr) {
      return NextResponse.json(
        { error: "Event created but linking snapshots failed", details: linkErr.message },
        { status: 500 }
      )
    }
  }

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "workspace.timeline.create",
    target_resource: "gob_workspace_timeline_events",
    details: { workspace_id: workspaceId, event_id: event.id, kind: payload.kind },
    timestamp: now,
  })

  return NextResponse.json({ id: event.id })
}
