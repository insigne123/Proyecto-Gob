import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"

const PatchSchema = z
  .object({
    causeType: z.string().trim().max(200).nullable().optional(),
    tribunalRole: z.string().trim().max(200).nullable().optional(),
    seaId: z.string().trim().max(80).nullable().optional(),
    seaRole: z.string().trim().max(200).nullable().optional(),
    holder: z.string().trim().max(240).nullable().optional(),
    proponent: z.string().trim().max(240).nullable().optional(),
    region: z.string().trim().max(120).nullable().optional(),
    comuna: z.string().trim().max(120).nullable().optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    proceduralStatus: z.string().trim().max(240).nullable().optional(),
    keyDates: z.any().optional(),
    metadata: z.any().optional(),
  })
  .strict()

function toProfileJson(row: any) {
  if (!row) return null
  return {
    workspaceId: row.workspace_id,
    causeType: row.cause_type ?? null,
    tribunalRole: row.tribunal_role ?? null,
    seaId: row.sea_id ?? null,
    seaRole: row.sea_role ?? null,
    holder: row.holder ?? null,
    proponent: row.proponent ?? null,
    region: row.region ?? null,
    comuna: row.comuna ?? null,
    latitude: typeof row.latitude === "number" ? row.latitude : row.latitude ? Number(row.latitude) : null,
    longitude: typeof row.longitude === "number" ? row.longitude : row.longitude ? Number(row.longitude) : null,
    proceduralStatus: row.procedural_status ?? null,
    keyDates: row.key_dates ?? {},
    metadata: row.metadata ?? {},
    updatedAt: row.updated_at ?? null,
  }
}

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
    .from("gob_workspace_profiles")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ profile: toProfileJson(data) })
}

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

  const now = new Date().toISOString()
  const patch = parsed.data

  const update: any = { updated_at: now }
  if ("causeType" in patch) update.cause_type = patch.causeType ?? null
  if ("tribunalRole" in patch) update.tribunal_role = patch.tribunalRole ?? null
  if ("seaId" in patch) update.sea_id = patch.seaId ?? null
  if ("seaRole" in patch) update.sea_role = patch.seaRole ?? null
  if ("holder" in patch) update.holder = patch.holder ?? null
  if ("proponent" in patch) update.proponent = patch.proponent ?? null
  if ("region" in patch) update.region = patch.region ?? null
  if ("comuna" in patch) update.comuna = patch.comuna ?? null
  if ("latitude" in patch) update.latitude = patch.latitude ?? null
  if ("longitude" in patch) update.longitude = patch.longitude ?? null
  if ("proceduralStatus" in patch) update.procedural_status = patch.proceduralStatus ?? null
  if ("keyDates" in patch) update.key_dates = patch.keyDates ?? {}
  if ("metadata" in patch) update.metadata = patch.metadata ?? {}

  const { data: existing, error: exErr } = await supabase
    .from("gob_workspace_profiles")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 })

  if (!existing) {
    const { error: insErr } = await supabase
      .from("gob_workspace_profiles")
      .insert({
        workspace_id: workspaceId,
        ...update,
        created_at: now,
        created_by: user.id,
      })

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  } else {
    const { error: upErr } = await supabase
      .from("gob_workspace_profiles")
      .update(update)
      .eq("workspace_id", workspaceId)

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "workspace.profile.update",
    target_resource: "gob_workspace_profiles",
    details: { workspace_id: workspaceId, fields: Object.keys(update) },
    timestamp: now,
  })

  return NextResponse.json({ ok: true })
}
