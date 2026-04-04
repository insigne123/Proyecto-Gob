import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { nextDailyAt, OPERATING_TIMEZONE } from "@/lib/timezone"

const CreateWatchlistSchema = z.object({
  watchlistId: z.string().uuid().optional(),
  provider: z.enum(["google", "microsoft"]),
  connectionId: z.string().uuid(),
  fileId: z.string().trim().min(1).max(512),
  fileName: z.string().trim().max(512).nullable().optional(),
  sheetName: z.string().trim().max(128).nullable().optional(),
  keyColumns: z.array(z.string().trim().min(1).max(128)).min(1),
  watchedColumns: z.array(z.string().trim().min(1).max(128)).default([]),
  checkEveryMinutes: z.number().int().min(1).max(1440),
  emailSchedule: z.enum(["daily", "immediate", "interval"]).default("daily"),
  emailTime: z.string().regex(/^\d{2}:\d{2}$/).default("18:00"),
  emailEveryMinutes: z.number().int().min(5).max(10080).optional(),
  recipients: z.array(z.string().trim().email()).default([]),
  criticalAlerts: z.boolean().optional().default(false),
  rules: z.any().optional(),
})

function normalizeColName(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function hasRequiredTribunalAndRol(keyColumns: string[]) {
  const normalized = keyColumns.map((c) => normalizeColName(c))
  const hasTribunal = normalized.some((c) => c.includes("tribunal"))
  const hasRol = normalized.some((c) => c.includes("rol"))
  return { hasTribunal, hasRol }
}

async function hasQueuedJob(params: {
  admin: any
  watchlistId: string
  type: "excel_check" | "email_digest"
}) {
  const { admin, watchlistId, type } = params
  const { data, error } = await admin
    .from("gob_jobs")
    .select("id")
    .eq("type", type)
    .in("status", ["pending", "running"])
    .filter("payload->>watchlist_id", "eq", watchlistId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return Boolean(data)
}

async function enqueueIfMissing(params: {
  admin: any
  watchlistId: string
  workspaceId: string
  type: "excel_check" | "email_digest"
  availableAt: string
}) {
  const { admin, watchlistId, workspaceId, type, availableAt } = params
  const already = await hasQueuedJob({ admin, watchlistId, type })
  if (already) return

  const { error } = await admin.from("gob_jobs").insert({
    type,
    status: "pending",
    available_at: availableAt,
    attempts: 0,
    max_attempts: 5,
    payload: { watchlist_id: watchlistId, workspace_id: workspaceId },
    created_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
}

async function deletePendingJobsForWatchlist(params: {
  admin: any
  watchlistId: string
}) {
  const { admin, watchlistId } = params
  const { error } = await admin
    .from("gob_jobs")
    .delete()
    .in("type", ["excel_check", "email_digest"])
    .eq("status", "pending")
    .filter("payload->>watchlist_id", "eq", watchlistId)

  if (error) throw new Error(error.message)
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
    .from("gob_excel_watchlists")
    .select(
      "id,provider,connection_id,file_id,file_name,sheet_name,status,next_check_at,next_email_at,email_schedule,key_columns,watched_columns,check_every_minutes,recipients,rules"
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    watchlists: Array.isArray(data) ? data : [],
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
  const parsed = CreateWatchlistSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const now = new Date()
  const nowIso = now.toISOString()

  const tribunalKeySupport = hasRequiredTribunalAndRol(parsed.data.keyColumns)

  // Validate connection ownership
  const { data: conn } = await supabase
    .from("gob_oauth_connections")
    .select("id,provider")
    .eq("id", parsed.data.connectionId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!conn || conn.provider !== parsed.data.provider) {
    return NextResponse.json({ error: "Invalid connection" }, { status: 400 })
  }

  const nextCheckAt = new Date(now.getTime() + parsed.data.checkEveryMinutes * 60_000)
  const nextEmailAt =
    parsed.data.emailSchedule === "daily"
      ? nextDailyAt({ timeZone: OPERATING_TIMEZONE, hhmm: parsed.data.emailTime, now }).toISOString()
      : parsed.data.emailSchedule === "interval" && parsed.data.emailEveryMinutes
        ? new Date(now.getTime() + parsed.data.emailEveryMinutes * 60_000).toISOString()
        : null

  const admin = createAdminClient()

  const payload = {
    provider: parsed.data.provider,
    connection_id: parsed.data.connectionId,
    file_id: parsed.data.fileId,
    file_name: parsed.data.fileName ?? null,
    sheet_name: parsed.data.sheetName ?? null,
    key_columns: parsed.data.keyColumns,
    watched_columns: parsed.data.watchedColumns,
    check_every_minutes: parsed.data.checkEveryMinutes,
    email_schedule: {
      type: parsed.data.emailSchedule,
      time: parsed.data.emailSchedule === "daily" ? parsed.data.emailTime : null,
      interval_minutes:
        parsed.data.emailSchedule === "interval"
          ? parsed.data.emailEveryMinutes ?? null
          : null,
      timezone: OPERATING_TIMEZONE,
    },
    recipients: parsed.data.recipients,
    rules: {
      ...(parsed.data.rules && typeof parsed.data.rules === "object" ? parsed.data.rules : {}),
      critical_alerts: Boolean(parsed.data.criticalAlerts),
      monitor_tribunal_activity: tribunalKeySupport.hasTribunal && tribunalKeySupport.hasRol,
    },
    status: "active",
    updated_at: nowIso,
    next_check_at: nowIso,
    next_email_at: nextEmailAt,
    last_error: null,
    last_etag: null,
    last_modified_time: null,
  }

  let watchId = ""
  let mode: "created" | "updated" = "created"

  if (!parsed.data.watchlistId) {
    const { data: watch, error: wErr } = await admin
      .from("gob_excel_watchlists")
      .insert({
        workspace_id: workspaceId,
        created_at: nowIso,
        created_by: user.id,
        ...payload,
      })
      .select("id")
      .single()

    if (wErr || !watch?.id) {
      return NextResponse.json({ error: wErr?.message || "No se pudo crear monitor" }, { status: 500 })
    }
    watchId = String(watch.id)
    mode = "created"
  } else {
    const { data: existingWatch, error: existingWatchErr } = await admin
      .from("gob_excel_watchlists")
      .select("id")
      .eq("id", parsed.data.watchlistId)
      .eq("workspace_id", workspaceId)
      .maybeSingle()

    if (existingWatchErr) return NextResponse.json({ error: existingWatchErr.message }, { status: 500 })
    if (!existingWatch?.id) return NextResponse.json({ error: "Watchlist not found" }, { status: 404 })

    const { error: updateErr } = await admin
      .from("gob_excel_watchlists")
      .update(payload)
      .eq("id", existingWatch.id)

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

    watchId = String(existingWatch.id)
    mode = "updated"
  }

  try {
    if (mode === "updated") {
      await deletePendingJobsForWatchlist({ admin, watchlistId: watchId })
    }

    await enqueueIfMissing({
      admin,
      watchlistId: watchId,
      workspaceId,
      type: "excel_check",
      availableAt: nowIso,
    })

    if (nextEmailAt) {
      await enqueueIfMissing({
        admin,
        watchlistId: watchId,
        workspaceId,
        type: "email_digest",
        availableAt: nextEmailAt,
      })
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "No se pudo encolar monitor" }, { status: 500 })
  }

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: mode === "created" ? "watchlist.create" : "watchlist.update",
    target_resource: "gob_excel_watchlists",
    details: {
      workspace_id: workspaceId,
      watchlist_id: watchId,
      mode,
      monitor_tribunal_activity: tribunalKeySupport.hasTribunal && tribunalKeySupport.hasRol,
    },
    timestamp: nowIso,
  })

  return NextResponse.json({
    id: watchId,
    mode,
    nextCheckAt: nextCheckAt.toISOString(),
    nextEmailAt,
    criticalAlerts: Boolean(parsed.data.criticalAlerts),
    monitorTribunalActivity: tribunalKeySupport.hasTribunal && tribunalKeySupport.hasRol,
  })
}
