import "dotenv/config"

import { createAdminClient } from "../src/lib/supabase/admin"
import { ensureTribunalCorpusWorkspace, syncTribunalCorpusDocuments } from "../src/lib/onboarding/tribunal-corpus"

function arg(name: string) {
  const idx = process.argv.findIndex((item) => item === name)
  if (idx < 0) return null
  const next = process.argv[idx + 1]
  if (!next || next.startsWith("--")) return null
  return next
}

function intArg(name: string, fallback: number, min: number, max: number) {
  const raw = Number(arg(name) || fallback)
  if (!Number.isFinite(raw)) return fallback
  return Math.max(min, Math.min(max, Math.floor(raw)))
}

async function main() {
  const admin = createAdminClient()
  const workspaceId = String(arg("--workspace-id") || "").trim() || null
  const artifactLimit = intArg("--artifact-limit", 24, 1, 100)
  const traceLimit = intArg("--trace-limit", 120, 20, 400)
  const maxNewSources = intArg("--max-new-sources", 120, 5, 400)
  const maxRetries = intArg("--max-retries", 40, 0, 120)

  const corpus = await ensureTribunalCorpusWorkspace(admin)

  let artifactQuery = admin
    .from("gob_onboarding_memory_artifact_versions")
    .select("workspace_id,tribunal_references,recommendations")
    .order("created_at", { ascending: false })
    .limit(artifactLimit)

  let traceQuery = admin
    .from("gob_rag_retrieval_traces")
    .select("workspace_id,results,metadata")
    .eq("stage", "chat")
    .order("created_at", { ascending: false })
    .limit(traceLimit)

  if (workspaceId) {
    artifactQuery = artifactQuery.eq("workspace_id", workspaceId)
    traceQuery = traceQuery.eq("workspace_id", workspaceId)
  }

  const [{ data: artifacts }, { data: traces }] = await Promise.all([artifactQuery, traceQuery])

  const targetCauseIds = new Set<string>()
  const targetRoles = new Set<string>()

  for (const row of artifacts || []) {
    for (const ref of Array.isArray((row as any)?.tribunal_references) ? (row as any).tribunal_references : []) {
      const causeId = String(ref?.causeId || ref?.cause_id || "").trim()
      const rol = String(ref?.rol || "").trim().toUpperCase()
      if (causeId) targetCauseIds.add(causeId)
      if (rol) targetRoles.add(rol)
    }
    for (const rec of Array.isArray((row as any)?.recommendations) ? (row as any).recommendations : []) {
      const causeId = String(rec?.causeId || "").trim()
      const rol = String(rec?.rol || "").trim().toUpperCase()
      if (causeId) targetCauseIds.add(causeId)
      if (rol) targetRoles.add(rol)
    }
  }

  for (const row of traces || []) {
    const metadata = (row as any)?.metadata && typeof (row as any).metadata === "object" ? (row as any).metadata : {}
    for (const rol of Array.isArray(metadata?.retrieval_graph_related_roles) ? metadata.retrieval_graph_related_roles : []) {
      const clean = String(rol || "").trim().toUpperCase()
      if (clean) targetRoles.add(clean)
    }
    for (const result of Array.isArray((row as any)?.results) ? (row as any).results : []) {
      const snippet = String(result?.snippet || "")
      const match = snippet.match(/\bR-\d{1,5}-\d{4}\b/i)
      if (match) targetRoles.add(String(match[0]).toUpperCase())
    }
  }

  const stats = await syncTribunalCorpusDocuments({
    admin,
    corpusWorkspaceId: corpus.id,
    maxNewSources,
    maxRetries,
    targetCauseIds: Array.from(targetCauseIds),
    targetRoles: Array.from(targetRoles),
  })

  console.log(
    JSON.stringify(
      {
        corpusWorkspaceId: corpus.id,
        targetedCauseIds: targetCauseIds.size,
        targetedRoles: Array.from(targetRoles).slice(0, 20),
        stats,
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
