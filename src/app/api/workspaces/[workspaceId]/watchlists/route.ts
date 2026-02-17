import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { nextDailyAt, OPERATING_TIMEZONE } from "@/lib/timezone"

const CreateWatchlistSchema = z.object({
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
  rules: z.any().optional(),
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
    .from("gob_excel_watchlists")
    .select("id,provider,file_name,status,next_check_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ watchlists: data ?? [] })
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

  const { data: watch, error: wErr } = await supabase
    .from("gob_excel_watchlists")
    .insert({
      workspace_id: workspaceId,
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
      rules: parsed.data.rules ?? {},
      status: "active",
      created_at: nowIso,
      created_by: user.id,
      next_check_at: nowIso,
      next_email_at: nextEmailAt,
    })
    .select("id")
    .single()

  if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 })

  const admin = createAdminClient()

  // Enqueue first check ASAP
  await admin.from("gob_jobs").insert({
    type: "excel_check",
    status: "pending",
    available_at: nowIso,
    attempts: 0,
    max_attempts: 5,
    payload: { watchlist_id: watch.id, workspace_id: workspaceId },
    created_at: nowIso,
  })

  if (nextEmailAt) {
    await admin.from("gob_jobs").insert({
      type: "email_digest",
      status: "pending",
      available_at: nextEmailAt,
      attempts: 0,
      max_attempts: 5,
      payload: { watchlist_id: watch.id, workspace_id: workspaceId },
      created_at: nowIso,
    })
  }

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "watchlist.create",
    target_resource: "gob_excel_watchlists",
    details: { workspace_id: workspaceId, watchlist_id: watch.id },
    timestamp: nowIso,
  })

  return NextResponse.json({ id: watch.id, nextCheckAt: nextCheckAt.toISOString(), nextEmailAt })
}
