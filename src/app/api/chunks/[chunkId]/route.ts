import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ chunkId: string }> }
) {
  const { chunkId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: chunk, error } = await supabase
    .from("gob_chunks")
    .select("id,content,source_url,snapshot_id,page,section")
    .eq("id", chunkId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!chunk) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "chunk.view",
    target_resource: "gob_chunks",
    details: { chunk_id: chunkId, snapshot_id: chunk.snapshot_id, source_url: chunk.source_url },
    timestamp: new Date().toISOString(),
  })

  return NextResponse.json({
    id: chunk.id,
    content: chunk.content,
    sourceUrl: chunk.source_url ?? null,
    snapshotId: chunk.snapshot_id ?? null,
    page: typeof chunk.page === "number" ? chunk.page : chunk.page ? Number(chunk.page) : null,
    section: chunk.section ?? null,
  })
}
