import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

function getSourcesBucket() {
  const preferred = String(
    process.env.SUPABASE_SOURCES_BUCKET || process.env.NEXT_PUBLIC_SUPABASE_SOURCES_BUCKET || ""
  ).trim()
  return preferred || "gob_sources"
}

function normalizeStoragePath(path: string) {
  const clean = String(path || "").trim().replace(/^\/+/, "")
  if (!clean) return ""
  return clean.replace(/^(gob_sources|gob-sources)\//i, "")
}

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
    .select("id,storage_path,url")
    .eq("id", snapshotId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!snapshot || (!snapshot.storage_path && !snapshot.url)) {
    return NextResponse.json({ error: "Snapshot not found" }, { status: 404 })
  }

  if (!snapshot.storage_path && snapshot.url) {
    return NextResponse.redirect(snapshot.url)
  }

  const admin = createAdminClient()
  const storagePath = normalizeStoragePath(String(snapshot.storage_path || ""))
  if (!storagePath) {
    if (snapshot.url) return NextResponse.redirect(snapshot.url)
    return NextResponse.json({ error: "Snapshot has no openable path" }, { status: 404 })
  }

  const bucketCandidates = Array.from(new Set([getSourcesBucket(), "gob_sources", "gob-sources"]))

  let signedUrl: string | null = null
  let lastErrorMessage: string | null = null

  for (const bucket of bucketCandidates) {
    const { data: signed, error: sErr } = await admin.storage
      .from(bucket)
      .createSignedUrl(storagePath, 60 * 10)
    if (!sErr && signed?.signedUrl) {
      signedUrl = signed.signedUrl
      break
    }
    lastErrorMessage = sErr?.message || lastErrorMessage
  }

  if (!signedUrl) {
    if (snapshot.url) {
      return NextResponse.redirect(snapshot.url)
    }
    return NextResponse.json(
      { error: "Signed URL failed", details: lastErrorMessage || "Unknown storage error" },
      { status: 500 }
    )
  }

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "snapshot.open",
    target_resource: "gob_source_snapshots",
    details: { snapshot_id: snapshotId },
    timestamp: new Date().toISOString(),
  })

  return NextResponse.redirect(signedUrl)
}
