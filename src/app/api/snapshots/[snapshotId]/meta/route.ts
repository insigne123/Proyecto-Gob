import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ snapshotId: string }> }
) {
  const { snapshotId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data, error } = await supabase
    .from("gob_source_snapshots")
    .select(
      "id,workspace_id,source_id,created_at,fetched_at,url,original_filename,storage_path,content_type,content_hash,http_status,title,status,openai_file_id,openai_vector_store_file_id,openai_index_status,openai_last_error,openai_indexed_at,openai_attributes"
    )
    .eq("id", snapshotId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({
    id: data.id,
    workspaceId: data.workspace_id,
    sourceId: data.source_id,
    createdAt: data.created_at ?? null,
    fetchedAt: data.fetched_at ?? null,
    url: data.url ?? null,
    originalFilename: data.original_filename ?? null,
    storagePath: data.storage_path ?? null,
    contentType: data.content_type ?? null,
    contentHash: data.content_hash ?? null,
    httpStatus: typeof data.http_status === "number" ? data.http_status : data.http_status ? Number(data.http_status) : null,
    title: data.title ?? null,
    status: data.status ?? null,
    openaiFileId: data.openai_file_id ?? null,
    openaiVectorStoreFileId: data.openai_vector_store_file_id ?? null,
    openaiIndexStatus: data.openai_index_status ?? null,
    openaiLastError: data.openai_last_error ?? null,
    openaiIndexedAt: data.openai_indexed_at ?? null,
    openaiAttributes: data.openai_attributes ?? {},
  })
}
