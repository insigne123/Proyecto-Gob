import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getAccessibleWorkspaceIdsForUser } from "@/lib/workspaces/access"

const SourceMetadataSchema = z
  .object({
    docType: z.string().trim().min(1).max(80).optional().nullable(),
    year: z.number().int().min(1900).max(2200).optional().nullable(),
    region: z.string().trim().max(120).optional().nullable(),
    sector: z.string().trim().max(120).optional().nullable(),
    projectName: z.string().trim().max(200).optional().nullable(),
    sourceOrigin: z.string().trim().max(80).optional().nullable(),
    language: z.string().trim().min(2).max(24).optional().nullable(),
    attributes: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict()

const CreateUrlSourceSchema = z.object({
  kind: z.literal("url"),
  url: z.string().trim().url().max(2000),
  title: z.string().trim().max(240).optional().nullable(),
  metadata: SourceMetadataSchema.optional(),
})

function normalizeMetadata(metadata?: z.infer<typeof SourceMetadataSchema>) {
  const input = metadata || {}
  const year =
    typeof input.year === "number" && Number.isFinite(input.year)
      ? Math.floor(input.year)
      : null

  return {
    doc_type: input.docType ? String(input.docType) : null,
    year,
    region: input.region ? String(input.region) : null,
    sector: input.sector ? String(input.sector) : null,
    project_name: input.projectName ? String(input.projectName) : null,
    source_origin: input.sourceOrigin ? String(input.sourceOrigin) : null,
    language: input.language ? String(input.language) : "es",
    attributes: input.attributes || {},
  }
}

function parseMaybeNumber(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null
  const clean = value.trim()
  if (!clean) return null
  const n = Number(clean)
  if (!Number.isFinite(n)) return null
  return Math.floor(n)
}

function limitText(value: FormDataEntryValue | null, maxLen: number) {
  const clean = parseMaybeText(value)
  if (!clean) return null
  return clean.length > maxLen ? clean.slice(0, maxLen) : clean
}

function parseMaybeYear(value: FormDataEntryValue | null) {
  const y = parseMaybeNumber(value)
  if (typeof y !== "number" || !Number.isFinite(y)) return null
  if (y < 1900 || y > 2200) return null
  return y
}

function parseMaybeLanguage(value: FormDataEntryValue | null) {
  const clean = limitText(value, 24)
  if (!clean) return null
  if (clean.length < 2) return null
  return clean
}

function parseMaybeText(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null
  const clean = value.trim()
  return clean ? clean : null
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

  let workspaceIds: string[] = []
  try {
    workspaceIds = await getAccessibleWorkspaceIdsForUser({
      supabase,
      userId: user.id,
      requiredWorkspaceId: workspaceId,
    })
  } catch (err: any) {
    if (String(err?.message || "") === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    return NextResponse.json({ error: err?.message || "Could not load access" }, { status: 500 })
  }

  if (!workspaceIds.length) {
    return NextResponse.json({ sources: [] })
  }

  const { data: sources, error } = await supabase
    .from("gob_sources")
    .select(
      "id,workspace_id,kind,url,filename,title,doc_type,year,region,sector,project_name,source_origin,language,attributes,status,updated_at,last_error,snapshots_count"
    )
    .in("workspace_id", workspaceIds)
    .order("updated_at", { ascending: false })
    .limit(600)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const sourceWorkspaceIds = Array.from(
    new Set((sources || []).map((s: any) => String(s.workspace_id || "")).filter(Boolean))
  )

  const workspaceTitleById = new Map<string, string>()
  if (sourceWorkspaceIds.length) {
    const { data: wsRows } = await supabase
      .from("gob_workspaces")
      .select("id,title")
      .in("id", sourceWorkspaceIds)

    for (const row of wsRows || []) {
      workspaceTitleById.set(String((row as any).id), String((row as any).title || "Expediente"))
    }
  }

  const withWorkspace = (sources || []).map((row: any) => {
    const wsId = String(row.workspace_id || "")
    return {
      ...row,
      workspace_id: wsId || null,
      workspace_title: wsId ? workspaceTitleById.get(wsId) || "Expediente" : null,
    }
  })

  return NextResponse.json({
    sources: withWorkspace,
    sharedScope: "member_workspaces",
    projectsCount: workspaceIds.length,
  })
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

  // membership check (also enforced by RLS)
  const { data: member } = await supabase
    .from("gob_workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (member.role === "viewer") {
    return NextResponse.json(
      { error: "Read-only role" },
      { status: 403 }
    )
  }

  const { data: ws } = await supabase
    .from("gob_workspaces")
    .select("allowed_domains")
    .eq("id", workspaceId)
    .maybeSingle()

  const contentType = request.headers.get("content-type") || ""
  const now = new Date().toISOString()

  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => null)
    const parsed = CreateUrlSourceSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const metadata = normalizeMetadata(parsed.data.metadata)

    const allowed = Array.isArray((ws as any)?.allowed_domains)
      ? ((ws as any).allowed_domains as string[])
      : []
    if (allowed.length) {
      try {
        const host = new URL(parsed.data.url).host
        const ok = allowed.some((d) => d === host || host.endsWith(`.${d}`))
        if (!ok) {
          return NextResponse.json(
            {
              error: "Domain not allowed",
              details: { host, allowed },
            },
            { status: 400 }
          )
        }
      } catch {
        return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
      }
    }

    const { data: existingSource } = await supabase
      .from("gob_sources")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("kind", "url")
      .eq("url", parsed.data.url)
      .maybeSingle()

    const sourceId = existingSource?.id
      ? String(existingSource.id)
      : null

    let finalSourceId = sourceId

    if (!finalSourceId) {
      const { data: source, error: sErr } = await supabase
        .from("gob_sources")
        .insert({
          workspace_id: workspaceId,
          kind: "url",
          url: parsed.data.url,
          title: parsed.data.title ?? null,
          ...metadata,
          status: "pending",
          created_by: user.id,
          updated_at: now,
        })
        .select("id")
        .single()

      if (sErr)
        return NextResponse.json({ error: sErr.message }, { status: 500 })
      finalSourceId = source.id
    } else {
      await supabase
        .from("gob_sources")
        .update({
          status: "pending",
          updated_at: now,
          last_error: null,
          title: parsed.data.title ?? null,
          ...metadata,
        })
        .eq("id", finalSourceId)
    }

    const { data: snapshot, error: snapErr } = await supabase
      .from("gob_source_snapshots")
      .insert({
        workspace_id: workspaceId,
        source_id: finalSourceId,
        url: parsed.data.url,
        status: "pending",
        created_at: now,
      })
      .select("id")
      .single()

    if (snapErr) return NextResponse.json({ error: snapErr.message }, { status: 500 })

    const admin = createAdminClient()
    const { error: jErr } = await admin.from("gob_jobs").insert({
      type: "source_ingest",
      status: "pending",
      available_at: now,
      attempts: 0,
      max_attempts: 5,
      payload: { workspace_id: workspaceId, source_id: finalSourceId, snapshot_id: snapshot.id },
      created_at: now,
    })

    if (jErr) return NextResponse.json({ error: jErr.message }, { status: 500 })

    await supabase.from("gob_audit_logs").insert({
      user_id: user.id,
      action: "source.create",
      target_resource: "gob_sources",
      details: { workspace_id: workspaceId, source_id: finalSourceId, url: parsed.data.url },
      timestamp: now,
    })

    return NextResponse.json({ id: finalSourceId, snapshotId: snapshot.id })
  }

  // multipart upload
  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: "Invalid form" }, { status: 400 })
  const kind = String(form.get("kind") || "")
  if (kind !== "upload") {
    return NextResponse.json({ error: "Unsupported kind" }, { status: 400 })
  }
  const file = form.get("file") as File | null
  if (!file) return NextResponse.json({ error: "Missing file" }, { status: 400 })
  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "Only PDF is supported" }, { status: 400 })
  }
  if (file.size > 50 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 50MB)" }, { status: 400 })
  }

  let attributes: Record<string, string | number | boolean> | undefined = undefined
  const attributesRaw = form.get("attributes")
  if (typeof attributesRaw === "string" && attributesRaw.trim()) {
    try {
      const parsedAttrs = JSON.parse(attributesRaw)
      if (parsedAttrs && typeof parsedAttrs === "object" && !Array.isArray(parsedAttrs)) {
        attributes = Object.fromEntries(
          Object.entries(parsedAttrs).filter(([, v]) => {
            const t = typeof v
            return t === "string" || t === "number" || t === "boolean"
          })
        ) as Record<string, string | number | boolean>
      }
    } catch {
      // metadata is optional; ignore invalid attributes payload
      attributes = undefined
    }
  }

  // Metadata is optional; coerce values and never block upload for malformed optional fields.
  const metadata = normalizeMetadata({
    docType: limitText(form.get("docType"), 80),
    year: parseMaybeYear(form.get("year")),
    region: limitText(form.get("region"), 120),
    sector: limitText(form.get("sector"), 120),
    projectName: limitText(form.get("projectName"), 200),
    sourceOrigin: limitText(form.get("sourceOrigin"), 80),
    language: parseMaybeLanguage(form.get("language")),
    attributes,
  })

  // Insert source+snapshot first (RLS validated), then upload via service role.
  const { data: source, error: sErr } = await supabase
    .from("gob_sources")
    .insert({
      workspace_id: workspaceId,
      kind: "upload",
      filename: file.name,
      ...metadata,
      status: "pending",
      created_by: user.id,
      updated_at: now,
    })
    .select("id")
    .single()
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })

  const { data: snapshot, error: snapErr } = await supabase
    .from("gob_source_snapshots")
    .insert({
      workspace_id: workspaceId,
      source_id: source.id,
      url: null,
      status: "pending",
      created_at: now,
      original_filename: file.name,
    })
    .select("id")
    .single()
  if (snapErr) return NextResponse.json({ error: snapErr.message }, { status: 500 })

  const uploadPath = `uploads/${workspaceId}/${source.id}/${snapshot.id}.pdf`
  const admin = createAdminClient()
  const buf = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await admin.storage
    .from("gob_sources")
    .upload(uploadPath, buf, {
      contentType: "application/pdf",
      upsert: false,
    })

  if (upErr) {
    return NextResponse.json(
      { error: "Upload failed", details: upErr.message },
      { status: 500 }
    )
  }

  const { error: snapUpErr } = await supabase
    .from("gob_source_snapshots")
    .update({ storage_path: uploadPath, content_type: "application/pdf" })
    .eq("id", snapshot.id)

  if (snapUpErr) {
    return NextResponse.json({ error: snapUpErr.message }, { status: 500 })
  }

  const { error: jErr } = await admin.from("gob_jobs").insert({
    type: "source_ingest",
    status: "pending",
    available_at: now,
    attempts: 0,
    max_attempts: 5,
    payload: { workspace_id: workspaceId, source_id: source.id, snapshot_id: snapshot.id },
    created_at: now,
  })
  if (jErr) return NextResponse.json({ error: jErr.message }, { status: 500 })

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "source.upload",
    target_resource: "gob_sources",
    details: { workspace_id: workspaceId, source_id: source.id, snapshot_id: snapshot.id },
    timestamp: now,
  })

  return NextResponse.json({ id: source.id, snapshotId: snapshot.id })
}
