import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"

const RoleSchema = z.enum([
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

const EntityTypeSchema = z.enum(["persona", "organizacion"]).default("organizacion")

const CreateSchema = z
  .object({
    role: RoleSchema,
    name: z.string().trim().min(2).max(240),
    entityType: EntityTypeSchema.optional(),
    contactEmail: z.string().trim().email().max(240).nullable().optional(),
    contactPhone: z.string().trim().max(80).nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
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

  const { data, error } = await supabase
    .from("gob_workspace_parties")
    .select(
      "id,workspace_id,created_at,updated_at,role,name,entity_type,contact_email,contact_phone,notes,metadata"
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const parties = (data ?? []).map((p: any) => ({
    id: p.id,
    role: p.role,
    name: p.name,
    entityType: p.entity_type,
    contactEmail: p.contact_email ?? null,
    contactPhone: p.contact_phone ?? null,
    notes: p.notes ?? null,
    metadata: p.metadata ?? {},
    createdAt: p.created_at ?? null,
    updatedAt: p.updated_at ?? null,
  }))

  return NextResponse.json({ parties })
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

  const { data: row, error } = await supabase
    .from("gob_workspace_parties")
    .insert({
      workspace_id: workspaceId,
      created_at: now,
      updated_at: now,
      role: payload.role,
      name: payload.name,
      entity_type: payload.entityType ?? "organizacion",
      contact_email: payload.contactEmail ?? null,
      contact_phone: payload.contactPhone ?? null,
      notes: payload.notes ?? null,
      metadata: payload.metadata ?? {},
      created_by: user.id,
    })
    .select("id")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "workspace.party.create",
    target_resource: "gob_workspace_parties",
    details: { workspace_id: workspaceId, party_id: row.id, role: payload.role },
    timestamp: now,
  })

  return NextResponse.json({ id: row.id })
}
