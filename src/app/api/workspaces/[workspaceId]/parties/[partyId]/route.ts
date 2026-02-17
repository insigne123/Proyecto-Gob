import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"

const PatchSchema = z
  .object({
    role: z
      .enum([
        "demandante",
        "reclamante",
        "reclamado",
        "tercero",
        "abogado",
        "perito",
        "titular",
        "proponente",
        "autoridad",
        "otro",
      ])
      .optional(),
    name: z.string().trim().min(2).max(240).optional(),
    entityType: z.enum(["persona", "organizacion"]).optional(),
    contactEmail: z.string().trim().email().max(240).nullable().optional(),
    contactPhone: z.string().trim().max(80).nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    metadata: z.any().optional(),
  })
  .strict()

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; partyId: string }> }
) {
  const { workspaceId, partyId } = await params
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
  if (patch.role) update.role = patch.role
  if (patch.name) update.name = patch.name
  if (patch.entityType) update.entity_type = patch.entityType
  if ("contactEmail" in patch) update.contact_email = patch.contactEmail ?? null
  if ("contactPhone" in patch) update.contact_phone = patch.contactPhone ?? null
  if ("notes" in patch) update.notes = patch.notes ?? null
  if ("metadata" in patch) update.metadata = patch.metadata ?? {}

  const { error } = await supabase
    .from("gob_workspace_parties")
    .update(update)
    .eq("id", partyId)
    .eq("workspace_id", workspaceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "workspace.party.update",
    target_resource: "gob_workspace_parties",
    details: { workspace_id: workspaceId, party_id: partyId, fields: Object.keys(update) },
    timestamp: now,
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; partyId: string }> }
) {
  const { workspaceId, partyId } = await params
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
    .from("gob_workspace_parties")
    .delete()
    .eq("id", partyId)
    .eq("workspace_id", workspaceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "workspace.party.delete",
    target_resource: "gob_workspace_parties",
    details: { workspace_id: workspaceId, party_id: partyId },
    timestamp: now,
  })

  return NextResponse.json({ ok: true })
}
