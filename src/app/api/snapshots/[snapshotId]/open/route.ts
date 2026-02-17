import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ snapshotId: string }> }
) {
  const { snapshotId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const url = new URL("/login", request.url)
    return NextResponse.redirect(url)
  }

  // RLS enforces membership by workspace_id
  const { data: snapshot, error } = await supabase
    .from("gob_source_snapshots")
    .select("id,storage_path")
    .eq("id", snapshotId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!snapshot || !snapshot.storage_path) {
    return NextResponse.json({ error: "Snapshot not found" }, { status: 404 })
  }

  const admin = createAdminClient()
  const { data: signed, error: sErr } = await admin.storage
    .from("gob_sources")
    .createSignedUrl(snapshot.storage_path, 60 * 10)

  if (sErr) {
    return NextResponse.json({ error: "Signed URL failed", details: sErr.message }, { status: 500 })
  }

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "snapshot.open",
    target_resource: "gob_source_snapshots",
    details: { snapshot_id: snapshotId },
    timestamp: new Date().toISOString(),
  })

  return NextResponse.redirect(signed.signedUrl)
}
