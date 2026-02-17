import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getAccessibleWorkspaceIdsForUser } from "@/lib/workspaces/access"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const url = new URL(request.url)
  const q = (url.searchParams.get("q") || "").trim()
  const format = (url.searchParams.get("format") || "json").toLowerCase()
  const filterSnapshotId = (url.searchParams.get("snapshotId") || "").trim()
  const filterPageRaw = (url.searchParams.get("page") || "").trim()
  const filterSection = (url.searchParams.get("section") || "").trim()
  const filterDocType = (url.searchParams.get("docType") || "").trim().toLowerCase()
  const filterRegion = (url.searchParams.get("region") || "").trim().toLowerCase()
  const filterSector = (url.searchParams.get("sector") || "").trim().toLowerCase()
  const filterYearFromRaw = (url.searchParams.get("yearFrom") || "").trim()
  const filterYearToRaw = (url.searchParams.get("yearTo") || "").trim()
  const filterPage = filterPageRaw ? Number(filterPageRaw) : null
  const filterYearFrom = filterYearFromRaw ? Number(filterYearFromRaw) : null
  const filterYearTo = filterYearToRaw ? Number(filterYearToRaw) : null

  if (q.length < 2) {
    return NextResponse.json(
      { error: "Query too short" },
      { status: 400 }
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let memberWorkspaceIds: string[] = []
  try {
    memberWorkspaceIds = await getAccessibleWorkspaceIdsForUser({
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

  const orderedWorkspaceIds = [workspaceId, ...memberWorkspaceIds.filter((id) => id !== workspaceId)].slice(
    0,
    60
  )

  const perWorkspaceCount = Math.max(
    8,
    Math.min(25, Math.ceil(120 / Math.max(1, orderedWorkspaceIds.length)))
  )

  let searchBatches: Array<{ workspaceId: string; rows: any[] }> = []
  try {
    searchBatches = await Promise.all(
      orderedWorkspaceIds.map(async (wsId) => {
        const { data, error } = await supabase.rpc("gob_search_chunks_text", {
          p_workspace_id: wsId,
          p_query_text: q,
          p_match_count: perWorkspaceCount,
        })
        if (error) {
          throw new Error(error.message)
        }
        return {
          workspaceId: wsId,
          rows: Array.isArray(data) ? data : [],
        }
      })
    )
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Search failed" }, { status: 500 })
  }

  const results = searchBatches
    .flatMap((batch) => {
      return batch.rows.map((m: any) => {
        const content = String(m.content ?? "")
        const snippet = content.length > 260 ? `${content.slice(0, 260)}...` : content
        return {
          chunkId: String(m.chunk_id ?? m.id),
          snippet,
          sourceUrl: m.source_url ? String(m.source_url) : null,
          snapshotId: m.snapshot_id ? String(m.snapshot_id) : null,
          page: typeof m.page === "number" ? m.page : m.page ? Number(m.page) : null,
          section: m.section ? String(m.section) : null,
          rank: typeof m.rank === "number" ? m.rank : m.rank ? Number(m.rank) : null,
          workspaceId: batch.workspaceId,
        }
      })
    })
    .sort((a, b) => {
      const ar = typeof a.rank === "number" && Number.isFinite(a.rank) ? a.rank : 0
      const br = typeof b.rank === "number" && Number.isFinite(b.rank) ? b.rank : 0
      return br - ar
    })
    .slice(0, 180)

  const needsMetadataFilter =
    !!filterDocType ||
    !!filterRegion ||
    !!filterSector ||
    (typeof filterYearFrom === "number" && Number.isFinite(filterYearFrom)) ||
    (typeof filterYearTo === "number" && Number.isFinite(filterYearTo))

  const sourceMetaBySnapshotId = new Map<
    string,
    {
      docType: string | null
      region: string | null
      sector: string | null
      year: number | null
      workspaceId: string | null
      workspaceTitle: string | null
    }
  >()

  if (needsMetadataFilter) {
    const snapshotIds = Array.from(
      new Set(results.map((r) => r.snapshotId).filter((x): x is string => Boolean(x)))
    )

    if (snapshotIds.length) {
      const { data: snapshots } = await supabase
        .from("gob_source_snapshots")
        .select("id,source_id")
        .in("id", snapshotIds)

      const sourceIds = Array.from(
        new Set((snapshots || []).map((s: any) => (s?.source_id ? String(s.source_id) : "")).filter(Boolean))
      )

      const sourceById = new Map<string, any>()
      const sourceWorkspaceIds = new Set<string>()
      if (sourceIds.length) {
        const { data: sources } = await supabase
          .from("gob_sources")
          .select("id,workspace_id,doc_type,region,sector,year")
          .in("id", sourceIds)
        for (const source of sources || []) {
          sourceById.set(String((source as any).id), source)
          const wsId = String((source as any).workspace_id || "")
          if (wsId) sourceWorkspaceIds.add(wsId)
        }
      }

      const workspaceTitleById = new Map<string, string>()
      if (sourceWorkspaceIds.size > 0) {
        const ids = Array.from(sourceWorkspaceIds)
        const { data: workspaces } = await supabase
          .from("gob_workspaces")
          .select("id,title")
          .in("id", ids)

        for (const ws of workspaces || []) {
          workspaceTitleById.set(String((ws as any).id), String((ws as any).title || "Expediente"))
        }
      }

      for (const snapshot of snapshots || []) {
        const sid = String((snapshot as any).id || "")
        const src = sourceById.get(String((snapshot as any).source_id || ""))
        if (!sid || !src) continue
        sourceMetaBySnapshotId.set(sid, {
          docType: src.doc_type ? String(src.doc_type) : null,
          region: src.region ? String(src.region) : null,
          sector: src.sector ? String(src.sector) : null,
          year:
            typeof src.year === "number" ? src.year : src.year ? Number(src.year) : null,
          workspaceId: src.workspace_id ? String(src.workspace_id) : null,
          workspaceTitle: src.workspace_id
            ? workspaceTitleById.get(String(src.workspace_id)) || "Expediente"
            : null,
        })
      }
    }
  }

  const filtered = results
    .filter((r) => (filterSnapshotId ? r.snapshotId === filterSnapshotId : true))
    .filter((r) => (typeof filterPage === "number" && Number.isFinite(filterPage) ? r.page === filterPage : true))
    .filter((r) => {
      if (!filterSection) return true
      const hay = (r.section ?? "").toLowerCase()
      return hay.includes(filterSection.toLowerCase())
    })
    .filter((r) => {
      if (!needsMetadataFilter) return true
      const meta = r.snapshotId ? sourceMetaBySnapshotId.get(r.snapshotId) : null
      if (!meta) return false

      if (filterDocType) {
        const hay = (meta.docType || "").toLowerCase()
        if (!hay.includes(filterDocType)) return false
      }

      if (filterRegion) {
        const hay = (meta.region || "").toLowerCase()
        if (!hay.includes(filterRegion)) return false
      }

      if (filterSector) {
        const hay = (meta.sector || "").toLowerCase()
        if (!hay.includes(filterSector)) return false
      }

      if (typeof filterYearFrom === "number" && Number.isFinite(filterYearFrom)) {
        if (typeof meta.year !== "number" || meta.year < filterYearFrom) return false
      }

      if (typeof filterYearTo === "number" && Number.isFinite(filterYearTo)) {
        if (typeof meta.year !== "number" || meta.year > filterYearTo) return false
      }

      return true
    })

  const enriched = filtered.map((r) => {
    const meta = r.snapshotId ? sourceMetaBySnapshotId.get(r.snapshotId) : null
    return {
      ...r,
      docType: meta?.docType ?? null,
      region: meta?.region ?? null,
      sector: meta?.sector ?? null,
      year: meta?.year ?? null,
      workspaceId: meta?.workspaceId ?? r.workspaceId ?? null,
      workspaceTitle: meta?.workspaceTitle ?? null,
    }
  })

  if (format === "csv") {
    const esc = (v: any) => {
      const s = String(v ?? "")
      if (/[\n\r",]/.test(s)) return `"${s.replace(/"/g, '""')}"`
      return s
    }

    const header = [
      "chunkId",
      "workspaceId",
      "workspaceTitle",
      "docType",
      "year",
      "region",
      "sector",
      "sourceUrl",
      "snapshotId",
      "page",
      "section",
      "rank",
      "snippet",
    ]
    const rows = enriched.map((r) => [
      esc(r.chunkId),
      esc(r.workspaceId),
      esc(r.workspaceTitle),
      esc(r.docType),
      esc(r.year),
      esc(r.region),
      esc(r.sector),
      esc(r.sourceUrl),
      esc(r.snapshotId),
      esc(r.page),
      esc(r.section),
      esc(r.rank),
      esc(r.snippet),
    ])

    const csv = [header.join(","), ...rows.map((r) => r.join(","))].join("\n")
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=search_results.csv",
      },
    })
  }

  return NextResponse.json({
    results: enriched,
    sharedScope: "member_workspaces",
    projectsCount: orderedWorkspaceIds.length,
  })
}
