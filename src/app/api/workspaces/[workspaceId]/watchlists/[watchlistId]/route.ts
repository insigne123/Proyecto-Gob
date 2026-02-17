import { NextResponse } from "next/server"
import { z } from "zod"

import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { nextDailyAt, OPERATING_TIMEZONE } from "@/lib/timezone"

const PatchSchema = z.object({
  action: z.enum(["pause", "resume"]),
})

async function assertWriterMember(params: { supabase: any; workspaceId: string; userId: string }) {
  const { supabase, workspaceId, userId } = params
  const { data: member } = await supabase
    .from("gob_workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle()

  if (!member) {
    return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }

  if (member.role === "viewer") {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Read-only role" }, { status: 403 }),
    }
  }

  return { ok: true as const }
}

async function findWatchlist(params: { supabase: any; workspaceId: string; watchlistId: string }) {
  const { supabase, workspaceId, watchlistId } = params
  const { data, error } = await supabase
    .from("gob_excel_watchlists")
    .select("id,workspace_id,status,check_every_minutes,email_schedule,file_name")
    .eq("id", watchlistId)
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null
  return data
}

async function deletePendingJobsForWatchlist(params: {
  admin: any
  watchlistId: string
  types: string[]
}) {
  const { admin, watchlistId, types } = params
  if (!types.length) return

  const { error } = await admin
    .from("gob_jobs")
    .delete()
    .in("type", types)
    .eq("status", "pending")
    .filter("payload->>watchlist_id", "eq", watchlistId)

  if (error) throw new Error(error.message)
}

async function hasQueuedJob(params: { admin: any; watchlistId: string; type: "excel_check" | "email_digest" }) {
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
  return !!data
}

function computeNextEmailAt(params: { emailSchedule: any; now: Date }) {
  const { emailSchedule, now } = params
  const scheduleType = String(emailSchedule?.type || "daily")

  if (scheduleType === "daily") {
    const hhmm = String(emailSchedule?.time || "18:00")
    return nextDailyAt({
      timeZone: String(emailSchedule?.timezone || OPERATING_TIMEZONE),
      hhmm,
      now,
    }).toISOString()
  }

  if (scheduleType === "interval") {
    const minutes = Number(emailSchedule?.interval_minutes || 0)
    if (Number.isFinite(minutes) && minutes >= 5) {
      return new Date(now.getTime() + minutes * 60_000).toISOString()
    }
  }

  return null
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; watchlistId: string }> }
) {
  const { workspaceId, watchlistId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const memberCheck = await assertWriterMember({
    supabase,
    workspaceId,
    userId: user.id,
  })
  if (!memberCheck.ok) return memberCheck.response

  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const watchlist = await findWatchlist({ supabase, workspaceId, watchlistId })
  if (!watchlist) return NextResponse.json({ error: "Watchlist not found" }, { status: 404 })

  const now = new Date()
  const nowIso = now.toISOString()
  const action = parsed.data.action
  const admin = createAdminClient()

  if (action === "pause") {
    const { error: pauseErr } = await supabase
      .from("gob_excel_watchlists")
      .update({
        status: "paused",
        updated_at: nowIso,
        next_check_at: null,
        next_email_at: null,
      })
      .eq("id", watchlistId)

    if (pauseErr) return NextResponse.json({ error: pauseErr.message }, { status: 500 })

    try {
      await deletePendingJobsForWatchlist({
        admin,
        watchlistId,
        types: ["excel_check", "email_digest"],
      })
    } catch (err: any) {
      return NextResponse.json({ error: err?.message ?? "Could not cancel jobs" }, { status: 500 })
    }

    await supabase.from("gob_audit_logs").insert({
      user_id: user.id,
      action: "watchlist.pause",
      target_resource: "gob_excel_watchlists",
      details: { workspace_id: workspaceId, watchlist_id: watchlistId },
      timestamp: nowIso,
    })

    return NextResponse.json({ id: watchlistId, status: "paused" })
  }

  const nextEmailAt = computeNextEmailAt({
    emailSchedule: watchlist.email_schedule,
    now,
  })

  const { error: resumeErr } = await supabase
    .from("gob_excel_watchlists")
    .update({
      status: "active",
      updated_at: nowIso,
      last_error: null,
      next_check_at: nowIso,
      next_email_at: nextEmailAt,
    })
    .eq("id", watchlistId)

  if (resumeErr) return NextResponse.json({ error: resumeErr.message }, { status: 500 })

  const alreadyQueuedCheck = await hasQueuedJob({
    admin,
    watchlistId,
    type: "excel_check",
  })
  if (!alreadyQueuedCheck) {
    const { error: checkJobErr } = await admin.from("gob_jobs").insert({
      type: "excel_check",
      status: "pending",
      available_at: nowIso,
      attempts: 0,
      max_attempts: 5,
      payload: { watchlist_id: watchlistId, workspace_id: workspaceId },
      created_at: nowIso,
    })
    if (checkJobErr) return NextResponse.json({ error: checkJobErr.message }, { status: 500 })
  }

  if (nextEmailAt) {
    const alreadyQueuedDigest = await hasQueuedJob({
      admin,
      watchlistId,
      type: "email_digest",
    })
    if (!alreadyQueuedDigest) {
      const { error: digestJobErr } = await admin.from("gob_jobs").insert({
        type: "email_digest",
        status: "pending",
        available_at: nextEmailAt,
        attempts: 0,
        max_attempts: 5,
        payload: { watchlist_id: watchlistId, workspace_id: workspaceId },
        created_at: nowIso,
      })
      if (digestJobErr) return NextResponse.json({ error: digestJobErr.message }, { status: 500 })
    }
  }

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "watchlist.resume",
    target_resource: "gob_excel_watchlists",
    details: { workspace_id: workspaceId, watchlist_id: watchlistId },
    timestamp: nowIso,
  })

  return NextResponse.json({
    id: watchlistId,
    status: "active",
    nextCheckAt: nowIso,
    nextEmailAt,
  })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; watchlistId: string }> }
) {
  const { workspaceId, watchlistId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const memberCheck = await assertWriterMember({
    supabase,
    workspaceId,
    userId: user.id,
  })
  if (!memberCheck.ok) return memberCheck.response

  const watchlist = await findWatchlist({ supabase, workspaceId, watchlistId })
  if (!watchlist) return NextResponse.json({ error: "Watchlist not found" }, { status: 404 })

  const nowIso = new Date().toISOString()
  const admin = createAdminClient()

  try {
    await deletePendingJobsForWatchlist({
      admin,
      watchlistId,
      types: ["excel_check", "email_digest"],
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Could not cancel jobs" }, { status: 500 })
  }

  const { error } = await supabase
    .from("gob_excel_watchlists")
    .delete()
    .eq("id", watchlistId)
    .eq("workspace_id", workspaceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "watchlist.delete",
    target_resource: "gob_excel_watchlists",
    details: {
      workspace_id: workspaceId,
      watchlist_id: watchlistId,
      file_name: watchlist.file_name || null,
    },
    timestamp: nowIso,
  })

  return NextResponse.json({ id: watchlistId, deleted: true })
}
