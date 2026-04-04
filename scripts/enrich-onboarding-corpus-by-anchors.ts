import "dotenv/config"

import { createAdminClient } from "../src/lib/supabase/admin"
import { ensureTribunalCorpusWorkspace } from "../src/lib/onboarding/tribunal-corpus"
import { refreshOnboardingDefensePool } from "../src/lib/onboarding/defense-pool"

type JobStatus = "pending" | "running" | "completed" | "failed"

function arg(name: string) {
  const inline = process.argv.find((x) => x.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1).trim()
  const idx = process.argv.findIndex((x) => x === name)
  if (idx < 0) return null
  const next = process.argv[idx + 1]
  if (!next || next.startsWith("--")) return null
  return next
}

function positionalArgs() {
  const raw = process.argv.slice(2)
  const out: string[] = []
  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i]
    if (!token || token.startsWith("--")) continue
    const prev = raw[i - 1]
    if (prev && prev.startsWith("--") && !prev.includes("=")) continue
    out.push(token)
  }
  return out
}

function boolArg(name: string, fallback: boolean) {
  const raw = String(arg(name) || "")
    .trim()
    .toLowerCase()
  if (!raw) return fallback
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false
  return fallback
}

function intArg(name: string, fallback: number, min: number, max: number) {
  const raw = Number(arg(name) || fallback)
  if (!Number.isFinite(raw)) return fallback
  return Math.max(min, Math.min(max, Math.floor(raw)))
}

function safeText(value: unknown, maxLen = 220) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const clean = normalizeText(value)
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    out.push(clean)
  }
  return out
}

function splitCsv(value: string | null) {
  if (!value) return [] as string[]
  return uniqueStrings(
    String(value)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
  )
}

function parseWorkspaceHints(description: string | null) {
  const text = String(description || "")
  const tribunalMatch = text.match(/Tribunal\s*:\s*([^\n\r]+)/i)
  const rolMatch = text.match(/Rol\s*:\s*([^\n\r]+)/i)
  const tribunal = tribunalMatch?.[1] ? safeText(tribunalMatch[1], 20).toUpperCase() : null
  const rol = rolMatch?.[1] ? safeText(rolMatch[1], 80).toUpperCase() : null
  return { tribunal, rol }
}

async function sleep(ms: number) {
  if (ms <= 0) return
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function checkTermCoverage(params: { admin: any; corpusWorkspaceId: string; terms: string[] }) {
  const rows: Array<{ term: string; hits: number; error: string | null }> = []

  for (const term of params.terms) {
    const { data, error } = await params.admin.rpc("gob_search_chunks_text", {
      p_workspace_id: params.corpusWorkspaceId,
      p_query_text: term,
      p_match_count: 120,
    })

    rows.push({
      term,
      hits: Array.isArray(data) ? data.length : 0,
      error: error?.message ? String(error.message) : null,
    })
  }

  return rows
}

async function ensureJobQueued(params: {
  admin: any
  type: string
  payload: Record<string, any>
  dedupe?: (row: any) => boolean
}) {
  const nowIso = new Date().toISOString()

  const { data: pendingRows } = await params.admin
    .from("gob_jobs")
    .select("id,type,status,payload,created_at")
    .eq("type", params.type)
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(120)

  const existing = (pendingRows || []).find((row: any) => (params.dedupe ? params.dedupe(row) : true))
  if (existing?.id) {
    return {
      created: false,
      id: String(existing.id),
      status: String(existing.status || "pending") as JobStatus,
      payload: existing.payload || null,
    }
  }

  const { data: inserted, error } = await params.admin
    .from("gob_jobs")
    .insert({
      type: params.type,
      status: "pending",
      available_at: nowIso,
      attempts: 0,
      max_attempts: 6,
      payload: params.payload,
      created_at: nowIso,
    })
    .select("id,status,payload")
    .single()

  if (error || !inserted?.id) {
    throw new Error(error?.message || `No se pudo encolar job ${params.type}`)
  }

  return {
    created: true,
    id: String(inserted.id),
    status: String(inserted.status || "pending") as JobStatus,
    payload: inserted.payload || null,
  }
}

async function waitJobs(params: {
  admin: any
  jobIds: string[]
  timeoutMs: number
  pollMs: number
}) {
  const deadline = Date.now() + Math.max(30_000, params.timeoutMs)
  const targetIds = Array.from(new Set(params.jobIds.filter(Boolean)))

  if (!targetIds.length) {
    return {
      done: true,
      timedOut: false,
      jobs: [] as Array<{ id: string; status: JobStatus; lastError: string | null; attempts: number }>,
    }
  }

  while (Date.now() < deadline) {
    const { data, error } = await params.admin
      .from("gob_jobs")
      .select("id,status,last_error,attempts")
      .in("id", targetIds)

    if (error) {
      throw new Error(error.message)
    }

    const rows = (data || []).map((row: any) => ({
      id: String(row.id),
      status: String(row.status || "pending") as JobStatus,
      lastError: row.last_error ? String(row.last_error) : null,
      attempts: Number(row.attempts || 0),
    }))

    const allDone =
      rows.length === targetIds.length &&
      rows.every((row: { status: JobStatus }) => row.status === "completed" || row.status === "failed")
    if (allDone) {
      return {
        done: true,
        timedOut: false,
        jobs: rows,
      }
    }

    await sleep(params.pollMs)
  }

  const { data: finalRows } = await params.admin
    .from("gob_jobs")
    .select("id,status,last_error,attempts")
    .in("id", targetIds)

  return {
    done: false,
    timedOut: true,
    jobs: (finalRows || []).map((row: any) => ({
      id: String(row.id),
      status: String(row.status || "pending") as JobStatus,
      lastError: row.last_error ? String(row.last_error) : null,
      attempts: Number(row.attempts || 0),
    })),
  }
}

async function waitSourceIngestDrain(params: {
  admin: any
  sinceIso: string
  corpusWorkspaceId: string
  timeoutMs: number
  pollMs: number
}) {
  const deadline = Date.now() + Math.max(30_000, params.timeoutMs)

  while (Date.now() < deadline) {
    const { data, error } = await params.admin
      .from("gob_jobs")
      .select("id,status")
      .eq("type", "source_ingest")
      .gte("created_at", params.sinceIso)
      .filter("payload->>workspace_id", "eq", params.corpusWorkspaceId)
      .in("status", ["pending", "running"])
      .limit(4000)

    if (error) {
      throw new Error(error.message)
    }

    const pending = (data || []).length
    if (pending === 0) {
      return {
        done: true,
        timedOut: false,
        pending,
      }
    }

    await sleep(params.pollMs)
  }

  const { data: remaining } = await params.admin
    .from("gob_jobs")
    .select("id,status")
    .eq("type", "source_ingest")
    .gte("created_at", params.sinceIso)
    .filter("payload->>workspace_id", "eq", params.corpusWorkspaceId)
    .in("status", ["pending", "running"])
    .limit(4000)

  return {
    done: false,
    timedOut: true,
    pending: (remaining || []).length,
  }
}

async function main() {
  const pos = positionalArgs()
  const workspaceId = String(arg("--workspace-id") || pos[0] || "").trim()

  if (!workspaceId) {
    throw new Error(
      "Usage: tsx scripts/enrich-onboarding-corpus-by-anchors.ts <workspaceId> [--tribunal=2TA] [--rol=R-202-2026] [--terms=a,b,c] [--apply=true]"
    )
  }

  const apply = boolArg("--apply", true)
  const waitJobsEnabled = boolArg("--wait-jobs", true)
  const waitIngestEnabled = boolArg("--wait-ingest", true)
  const waitMs = intArg("--wait-ms", 360_000, 30_000, 1_200_000)
  const pollMs = intArg("--poll-ms", 8_000, 2_000, 20_000)
  const maxCriticalTerms = intArg("--max-critical-terms", 8, 2, 20)

  const tribunalArg = String(arg("--tribunal") || "").trim().toUpperCase()
  const rolArg = String(arg("--rol") || "").trim().toUpperCase()
  const idCausaArg = String(arg("--id-causa") || "").trim()
  const termsArg = splitCsv(arg("--terms"))

  const admin = createAdminClient()
  const startedIso = new Date().toISOString()

  const [{ data: profileRow, error: profileErr }, { data: workspaceRow, error: workspaceErr }] = await Promise.all([
    admin
      .from("gob_workspace_profiles")
      .select("metadata")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    admin
      .from("gob_workspaces")
      .select("id,title,description")
      .eq("id", workspaceId)
      .maybeSingle(),
  ])

  if (profileErr) throw new Error(profileErr.message)
  if (workspaceErr) throw new Error(workspaceErr.message)

  const workspaceHints = parseWorkspaceHints(workspaceRow?.description ? String(workspaceRow.description) : null)

  const metadata = profileRow?.metadata && typeof profileRow.metadata === "object" ? (profileRow.metadata as any) : {}
  const onboarding = metadata?.onboarding && typeof metadata.onboarding === "object" ? metadata.onboarding : {}
  const runId = String(onboarding?.last_run_id || "")
  const run = runId && onboarding?.analysis_runs && typeof onboarding.analysis_runs === "object"
    ? onboarding.analysis_runs[runId] || null
    : null

  const runAnchors = run?.anchors && typeof run.anchors === "object" ? run.anchors : {}
  const criticalTermsFromRun = uniqueStrings(
    Array.isArray(runAnchors?.criticalTerms)
      ? runAnchors.criticalTerms
      : Array.isArray(runAnchors?.terms)
        ? runAnchors.terms
        : []
  ).slice(0, maxCriticalTerms)

  const targetTerms = uniqueStrings([...termsArg, ...criticalTermsFromRun]).slice(0, maxCriticalTerms)
  if (!targetTerms.length) {
    throw new Error("No se encontraron terminos criticos para enriquecer. Usa --terms=a,b,c o ejecuta primero onboarding recommend.")
  }

  const tribunal = tribunalArg || workspaceHints.tribunal || "2TA"
  const rol = rolArg || workspaceHints.rol || ""

  const corpus = await ensureTribunalCorpusWorkspace(admin)
  const beforeCoverage = await checkTermCoverage({
    admin,
    corpusWorkspaceId: corpus.id,
    terms: targetTerms,
  })

  const missingTerms = beforeCoverage.filter((row) => row.hits === 0).map((row) => row.term)

  const queuedJobs: Array<{ type: string; id: string; created: boolean }> = []
  let jobWait = {
    done: true,
    timedOut: false,
    jobs: [] as Array<{ id: string; status: JobStatus; lastError: string | null; attempts: number }>,
  }
  let ingestWait = {
    done: true,
    timedOut: false,
    pending: 0,
  }
  let poolRefreshStats: any = null

  if (apply && (missingTerms.length > 0 || rol)) {
    const queuedAt = new Date().toISOString()

    if (rol) {
      const causeJob = await ensureJobQueued({
        admin,
        type: "tribunal_cause_sync",
        payload: {
          tribunal,
          rol,
          idCausa: idCausaArg || null,
          source: "anchor_enrichment",
          requested_terms: targetTerms,
          workspace_id: workspaceId,
        },
        dedupe: (row) => {
          const payload = row?.payload && typeof row.payload === "object" ? row.payload : {}
          return String(payload?.tribunal || "").toUpperCase() === tribunal && String(payload?.rol || "").toUpperCase() === rol
        },
      })

      queuedJobs.push({ type: "tribunal_cause_sync", id: causeJob.id, created: causeJob.created })
    }

    const corpusJob = await ensureJobQueued({
      admin,
      type: "tribunal_corpus_sync",
      payload: {
        tribunal,
        date: startedIso.slice(0, 10),
        source: "anchor_enrichment",
        requested_terms: targetTerms,
        workspace_id: workspaceId,
      },
      dedupe: () => true,
    })

    queuedJobs.push({ type: "tribunal_corpus_sync", id: corpusJob.id, created: corpusJob.created })

    if (waitJobsEnabled) {
      jobWait = await waitJobs({
        admin,
        jobIds: queuedJobs.map((x) => x.id),
        timeoutMs: waitMs,
        pollMs,
      })
    }

    if (waitIngestEnabled) {
      ingestWait = await waitSourceIngestDrain({
        admin,
        sinceIso: queuedAt,
        corpusWorkspaceId: corpus.id,
        timeoutMs: waitMs,
        pollMs,
      })
    }

    poolRefreshStats = await refreshOnboardingDefensePool({
      admin,
      refreshProfiles: false,
    }).catch((err) => ({ error: err instanceof Error ? err.message : String(err) }))
  }

  const afterCoverage = await checkTermCoverage({
    admin,
    corpusWorkspaceId: corpus.id,
    terms: targetTerms,
  })

  const report = {
    action: "onboarding_anchor_corpus_enrichment",
    startedAt: startedIso,
    completedAt: new Date().toISOString(),
    workspace: {
      id: workspaceId,
      title: workspaceRow?.title ? String(workspaceRow.title) : null,
      runId: runId || null,
      tribunal,
      rol: rol || null,
    },
    corpus: {
      workspaceId: corpus.id,
      workspaceTitle: corpus.title,
      created: corpus.created,
    },
    apply,
    terms: targetTerms,
    missingTermsBefore: missingTerms,
    coverage: {
      before: beforeCoverage,
      after: afterCoverage,
    },
    jobs: {
      queued: queuedJobs,
      wait: jobWait,
      ingestWait,
    },
    poolRefresh: poolRefreshStats,
  }

  console.log(JSON.stringify(report, null, 2))
}

main().catch((err) => {
  console.error(`enrich-onboarding-corpus-by-anchors failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
