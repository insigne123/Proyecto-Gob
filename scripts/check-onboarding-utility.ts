import "dotenv/config"

import { createClient } from "@supabase/supabase-js"

type AnyRow = Record<string, any>

const STOP = new Set([
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "y",
  "o",
  "en",
  "al",
  "para",
  "con",
  "por",
  "que",
  "se",
  "su",
  "sus",
  "una",
  "uno",
  "unos",
  "unas",
  "como",
  "sobre",
  "ante",
  "desde",
  "hacia",
  "este",
  "esta",
  "estos",
  "estas",
  "esa",
  "ese",
  "esas",
  "esos",
  "servicio",
  "evaluacion",
  "ambiental",
])

function normalize(text: unknown) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function tokenize(text: unknown) {
  return normalize(text)
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x.length >= 4)
    .filter((x) => !STOP.has(x))
}

function tokenSet(text: unknown) {
  return new Set(tokenize(text))
}

function overlapRatio(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0
  let hits = 0
  for (const token of a) {
    if (b.has(token)) hits += 1
  }
  return hits / Math.max(1, Math.min(a.size, b.size))
}

async function main() {
  const workspaceId = String(process.argv[2] || "").trim()
  const topN = Math.max(1, Math.min(12, Number(process.argv[3] || 6)))
  const corpusWorkspaceId = String(process.argv[4] || "0d7ff8bd-5171-496d-a64e-b98a7a46b31c").trim()
  const anchorTermsArg = String(process.argv[5] || "").trim()

  if (!workspaceId) {
    throw new Error(
      "Usage: tsx scripts/check-onboarding-utility.ts <workspaceId> [topN] [corpusWorkspaceId] [anchor1,anchor2,...]"
    )
  }

  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim()
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
  if (!url || !key) throw new Error("Missing Supabase env vars")

  const sb = createClient(url, key, { auth: { persistSession: false } })

  const profile = await sb
    .from("gob_workspace_profiles")
    .select("workspace_id,metadata,updated_at")
    .eq("workspace_id", workspaceId)
    .maybeSingle()
  if (profile.error) throw new Error(profile.error.message)

  const metadata = (profile.data as AnyRow | null)?.metadata as AnyRow | undefined
  const onboarding = metadata?.onboarding && typeof metadata.onboarding === "object" ? metadata.onboarding : {}
  const runId = String(onboarding?.last_run_id || "")
  const runs = onboarding?.analysis_runs && typeof onboarding.analysis_runs === "object" ? onboarding.analysis_runs : {}
  const run = runId ? (runs as AnyRow)[runId] : null
  if (!run) throw new Error("No onboarding run found")

  const recommendations = (Array.isArray(run.recommendations) ? run.recommendations : []).slice(0, topN)
  const utilityCounts = {
    core: recommendations.filter((r: AnyRow) => String(r.utility_label || r.utilityLabel || "") === "core").length,
    support: recommendations.filter((r: AnyRow) => String(r.utility_label || r.utilityLabel || "") === "support").length,
    discard: recommendations.filter((r: AnyRow) => String(r.utility_label || r.utilityLabel || "") === "discard").length,
  }
  const anchorPolicy = run?.anchors && typeof run.anchors === "object" ? run.anchors : null
  const causeIds = recommendations
    .map((r: AnyRow) => String(r.cause_id || r.causeId || "").trim())
    .filter(Boolean)

  const claimSource = await sb
    .from("gob_sources")
    .select("id,title,filename,updated_at")
    .eq("workspace_id", workspaceId)
    .eq("source_origin", "onboarding-claim")
    .order("updated_at", { ascending: false })
    .limit(1)
  if (claimSource.error) throw new Error(claimSource.error.message)
  const source = (claimSource.data || [])[0] as AnyRow | undefined
  if (!source?.id) throw new Error("No onboarding claim source found")

  const claimSnapshots = await sb
    .from("gob_source_snapshots")
    .select("id,status,created_at")
    .eq("workspace_id", workspaceId)
    .eq("source_id", source.id)
    .order("created_at", { ascending: false })
    .limit(6)
  if (claimSnapshots.error) throw new Error(claimSnapshots.error.message)
  const claimSnapshot =
    (claimSnapshots.data || []).find((row: AnyRow) => String(row.status || "") === "ready") ||
    (claimSnapshots.data || [])[0]
  if (!claimSnapshot?.id) throw new Error("No claim snapshot found")

  const claimChunks = await sb
    .from("gob_chunks")
    .select("content")
    .eq("workspace_id", workspaceId)
    .eq("snapshot_id", claimSnapshot.id)
    .order("created_at", { ascending: true })
    .limit(240)
  if (claimChunks.error) throw new Error(claimChunks.error.message)
  const claimText = (claimChunks.data || []).map((row: AnyRow) => String(row.content || "")).join(" ")
  const claimTokens = tokenSet(claimText)

  const claimFreq = new Map<string, number>()
  for (const token of tokenize(claimText)) {
    claimFreq.set(token, (claimFreq.get(token) || 0) + 1)
  }
  const claimTopTerms = Array.from(claimFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([term]) => term)

  const anchorTerms = (anchorTermsArg
    ? anchorTermsArg.split(",").map((x) => normalize(x))
    : claimTopTerms.slice(0, 10)
  )
    .filter(Boolean)
    .slice(0, 20)

  const causeRows = await sb
    .from("gob_tribunal_causes")
    .select("id,rol,caratula,estado,estado_subtipo,fecha_ingreso")
    .in("id", causeIds)
  if (causeRows.error) throw new Error(causeRows.error.message)
  const causeById = new Map((causeRows.data || []).map((row: AnyRow) => [String(row.id), row]))

  const docsRows = await sb
    .from("gob_tribunal_documents")
    .select("id,cause_id,document_type,name,date,url")
    .in("cause_id", causeIds)
  if (docsRows.error) throw new Error(docsRows.error.message)

  const docsByCause = new Map<string, AnyRow[]>()
  for (const row of docsRows.data || []) {
    const causeId = String((row as AnyRow).cause_id || "")
    if (!causeId) continue
    const list = docsByCause.get(causeId) || []
    list.push(row as AnyRow)
    docsByCause.set(causeId, list)
  }

  const results: AnyRow[] = []

  for (const rec of recommendations) {
    const causeId = String((rec as AnyRow).cause_id || (rec as AnyRow).causeId || "")
    if (!causeId) continue
    const cause = causeById.get(causeId) || null
    const docs = docsByCause.get(causeId) || []

    const docsText = docs
      .slice(0, 20)
      .map((doc) => `${doc.document_type || ""} ${doc.name || ""}`)
      .join(" ")

    const lexicalFromMetadata = overlapRatio(claimTokens, tokenSet(`${cause?.caratula || ""} ${docsText}`))

    const docUrls = docs
      .map((doc) => String(doc.url || "").trim())
      .filter(Boolean)
      .slice(0, 80)

    const sourceIds = new Set<string>()
    for (let i = 0; i < docUrls.length; i += 80) {
      const batch = docUrls.slice(i, i + 80)
      if (!batch.length) continue
      const sources = await sb
        .from("gob_sources")
        .select("id,url")
        .eq("workspace_id", corpusWorkspaceId)
        .in("url", batch)
      if (sources.error) throw new Error(sources.error.message)
      for (const row of sources.data || []) {
        const id = String((row as AnyRow).id || "")
        if (id) sourceIds.add(id)
      }
    }

    let snapshotsLinked = 0
    let chunksAnalyzed = 0
    let bestChunkOverlap = 0
    let avgChunkOverlap = 0
    let huaweiHits = 0
    let keyTermHits = 0
    const anchorHits: Record<string, number> = Object.fromEntries(anchorTerms.map((term) => [term, 0]))

    const sourceIdList = Array.from(sourceIds)
    for (let i = 0; i < sourceIdList.length; i += 120) {
      const sourceBatch = sourceIdList.slice(i, i + 120)
      if (!sourceBatch.length) continue
      const snaps = await sb
        .from("gob_source_snapshots")
        .select("id")
        .eq("workspace_id", corpusWorkspaceId)
        .eq("status", "ready")
        .in("source_id", sourceBatch)
      if (snaps.error) throw new Error(snaps.error.message)
      const snapIds = (snaps.data || []).map((row: AnyRow) => String(row.id || "")).filter(Boolean)
      snapshotsLinked += snapIds.length

      for (let j = 0; j < snapIds.length; j += 120) {
        const snapBatch = snapIds.slice(j, j + 120)
        if (!snapBatch.length) continue
        const chunks = await sb
          .from("gob_chunks")
          .select("content")
          .eq("workspace_id", corpusWorkspaceId)
          .in("snapshot_id", snapBatch)
          .limit(9000)
        if (chunks.error) throw new Error(chunks.error.message)

        for (const row of chunks.data || []) {
          const content = String((row as AnyRow).content || "")
          if (!content.trim()) continue
          const ov = overlapRatio(claimTokens, tokenSet(content))
          chunksAnalyzed += 1
          avgChunkOverlap += ov
          if (ov > bestChunkOverlap) bestChunkOverlap = ov

          const n = normalize(content)
          if (n.includes("huawei")) huaweiHits += 1
          if (claimTopTerms.some((term) => term && n.includes(term))) keyTermHits += 1
          for (const term of anchorTerms) {
            if (term && n.includes(term)) anchorHits[term] = (anchorHits[term] || 0) + 1
          }
        }
      }
    }

    results.push({
      rol: (cause as AnyRow | null)?.rol || (rec as AnyRow).rol || null,
      causeId,
      score: (rec as AnyRow).score ?? null,
      confidence: (rec as AnyRow).confidence ?? null,
      utilityLabel: (rec as AnyRow).utility_label ?? (rec as AnyRow).utilityLabel ?? null,
      utilityRisk: (rec as AnyRow).utility_risk ?? (rec as AnyRow).utilityRisk ?? null,
      runAnchorHits: (rec as AnyRow).anchor_hits ?? (rec as AnyRow).anchorHits ?? null,
      runAnchorCoverage: (rec as AnyRow).anchor_coverage ?? (rec as AnyRow).anchorCoverage ?? null,
      runMatchedAnchors: (rec as AnyRow).matched_anchors ?? (rec as AnyRow).matchedAnchors ?? null,
      runMissingAnchors: (rec as AnyRow).missing_anchors ?? (rec as AnyRow).missingAnchors ?? null,
      runCriticalAnchorHits:
        (rec as AnyRow).critical_anchor_hits ?? (rec as AnyRow).criticalAnchorHits ?? null,
      runMatchedCriticalAnchors:
        (rec as AnyRow).matched_critical_anchors ?? (rec as AnyRow).matchedCriticalAnchors ?? null,
      runMissingCriticalAnchors:
        (rec as AnyRow).missing_critical_anchors ?? (rec as AnyRow).missingCriticalAnchors ?? null,
      keyQuotesCount: Array.isArray((rec as AnyRow).keyQuotes) ? (rec as AnyRow).keyQuotes.length : 0,
      matchedDocumentsCount: Array.isArray((rec as AnyRow).matchedDocuments)
        ? (rec as AnyRow).matchedDocuments.length
        : 0,
      lexicalFromMetadata: Number(lexicalFromMetadata.toFixed(4)),
      docsCount: docs.length,
      linkedSourcesByUrl: sourceIds.size,
      linkedSnapshots: snapshotsLinked,
      chunksAnalyzed,
      bestChunkOverlap: Number(bestChunkOverlap.toFixed(4)),
      avgChunkOverlap: Number((chunksAnalyzed ? avgChunkOverlap / chunksAnalyzed : 0).toFixed(4)),
      huaweiChunkHits: huaweiHits,
      claimTopTermHitsInChunks: keyTermHits,
      anchorTermHits: anchorHits,
      caratula: (cause as AnyRow | null)?.caratula || null,
    })
  }

  console.log(
    JSON.stringify(
      {
        workspaceId,
        runId,
        runCreatedAt: run?.created_at || null,
        candidateChunks: run?.candidate_chunks ?? null,
        recommendationCount: recommendations.length,
        utilityCounts,
        anchorPolicy,
        claimSnapshotId: claimSnapshot.id,
        claimSourceTitle: source.title || source.filename || null,
        claimTopTerms,
        anchorTerms,
        results,
      },
      null,
      2
    )
  )
}

main().catch((err) => {
  console.error(`check-onboarding-utility failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
