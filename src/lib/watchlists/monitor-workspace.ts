import { createAdminClient } from "@/lib/supabase/admin"
import { excelMonitorWorkspaceMarkerForUser } from "@/lib/workspaces/system-workspaces"

export async function ensureExcelMonitorWorkspaceForUser(userId: string) {
  const admin = createAdminClient()
  const now = new Date().toISOString()
  const marker = excelMonitorWorkspaceMarkerForUser(userId)

  const { data: existing, error: existingErr } = await admin
    .from("gob_workspaces")
    .select("id,title")
    .eq("description", marker)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existingErr) throw new Error(existingErr.message)

  let workspaceId: string
  let workspaceTitle = "Monitor judicial"

  if (existing?.id) {
    workspaceId = String(existing.id)
    workspaceTitle = String(existing.title || workspaceTitle)
  } else {
    const { data: created, error: createErr } = await admin
      .from("gob_workspaces")
      .insert({
        title: workspaceTitle,
        description: marker,
        status: "active",
        created_by: userId,
        updated_at: now,
      })
      .select("id,title")
      .single()

    if (createErr || !created?.id) {
      throw new Error(createErr?.message || "No se pudo crear workspace de monitor")
    }

    workspaceId = String(created.id)
    workspaceTitle = String(created.title || workspaceTitle)
  }

  const { data: member, error: memberErr } = await admin
    .from("gob_workspace_members")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle()

  if (memberErr) throw new Error(memberErr.message)

  if (!member?.workspace_id) {
    const { error: insertMemberErr } = await admin.from("gob_workspace_members").insert({
      workspace_id: workspaceId,
      user_id: userId,
      role: "admin",
      created_at: now,
    })
    if (insertMemberErr) throw new Error(insertMemberErr.message)
  }

  return {
    id: workspaceId,
    title: workspaceTitle,
  }
}

export async function pauseLegacyUserWatchlists(params: {
  userId: string
  monitorWorkspaceId: string
}) {
  const { userId, monitorWorkspaceId } = params
  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { data: legacyRows, error: legacyErr } = await admin
    .from("gob_excel_watchlists")
    .select("id,workspace_id,status")
    .eq("created_by", userId)
    .neq("workspace_id", monitorWorkspaceId)
    .in("status", ["active", "error"])
    .limit(200)

  if (legacyErr) throw new Error(legacyErr.message)

  const rows = Array.isArray(legacyRows) ? legacyRows : []
  if (!rows.length) return { paused: 0 }

  for (const row of rows) {
    const watchlistId = String((row as any).id || "")
    if (!watchlistId) continue

    await admin
      .from("gob_excel_watchlists")
      .update({
        status: "paused",
        updated_at: now,
        next_check_at: null,
        next_email_at: null,
      })
      .eq("id", watchlistId)

    await admin
      .from("gob_jobs")
      .delete()
      .in("type", ["excel_check", "email_digest"])
      .eq("status", "pending")
      .filter("payload->>watchlist_id", "eq", watchlistId)
  }

  return { paused: rows.length }
}
