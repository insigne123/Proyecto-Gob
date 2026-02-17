import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

async function canWriteWorkspace(params: { supabase: any; workspaceId: string; userId: string }) {
  const { supabase, workspaceId, userId } = params
  const { data: member } = await supabase
    .from("gob_workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle()

  if (!member) return false
  return member.role !== "viewer"
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; watchlistId: string }> }
) {
  const { workspaceId, watchlistId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const writable = await canWriteWorkspace({
    supabase,
    workspaceId,
    userId: user.id,
  })
  if (!writable) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { data: watch, error: watchErr } = await supabase
    .from("gob_excel_watchlists")
    .select("id,workspace_id,status")
    .eq("id", watchlistId)
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (watchErr) return NextResponse.json({ error: watchErr.message }, { status: 500 })
  if (!watch) return NextResponse.json({ error: "Watchlist not found" }, { status: 404 })

  const admin = createAdminClient()
  const { data: existingJob, error: existingErr } = await admin
    .from("gob_jobs")
    .select("id,status,created_at")
    .eq("type", "excel_check")
    .in("status", ["pending", "running"])
    .filter("payload->>watchlist_id", "eq", watchlistId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 })

  if (existingJob) {
    return NextResponse.json({
      queued: false,
      reason: "already_queued",
      job: existingJob,
    })
  }

  const nowIso = new Date().toISOString()
  const { data: job, error: insertErr } = await admin
    .from("gob_jobs")
    .insert({
      type: "excel_check",
      status: "pending",
      available_at: nowIso,
      attempts: 0,
      max_attempts: 5,
      payload: {
        watchlist_id: watchlistId,
        workspace_id: workspaceId,
        manual: true,
        force: true,
      },
      created_at: nowIso,
    })
    .select("id,created_at")
    .single()

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "watchlist.check_now",
    target_resource: "gob_jobs",
    details: {
      workspace_id: workspaceId,
      watchlist_id: watchlistId,
      job_id: job.id,
      previous_status: watch.status,
    },
    timestamp: nowIso,
  })

  return NextResponse.json({
    queued: true,
    job,
  })
}
