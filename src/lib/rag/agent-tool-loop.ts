export type AgentRetrievalTool = "memory" | "facts" | "graph" | "local" | "managed"

export type RetrievalJobKind = "local" | "managed"
export type RetrievalJobPhase = "initial" | "graph" | "scope" | "depth"

export type AgentRetrievalJob = {
  id: string
  kind: RetrievalJobKind
  phase: RetrievalJobPhase
  workspaceIds: string[]
  queries: string[]
  label: string
}

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function uniqueStrings(values: unknown[], max = 8) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = String(value ?? "").replace(/\s+/g, " ").trim()
    if (!clean) continue
    const key = normalize(clean)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(clean)
    if (out.length >= max) break
  }
  return out
}

function pushJob(jobs: AgentRetrievalJob[], seen: Set<string>, job: AgentRetrievalJob | null) {
  if (!job || !job.workspaceIds.length || !job.queries.length) return
  const key = `${job.kind}|${job.phase}|${job.workspaceIds.slice().sort().join(",")}|${job.queries.map((item) => normalize(item)).join("|")}`
  if (!key || seen.has(key)) return
  seen.add(key)
  jobs.push(job)
}

export function buildAgenticRetrievalJobs(params: {
  isFactualPipeline: boolean
  primaryWorkspaceId: string
  secondaryWorkspaceIds: string[]
  toolOrder: string[]
  primaryQueries: string[]
  secondaryQueries: string[]
  graphQueries: string[]
  extraQueries: string[]
  allowScopeExpansion: boolean
  needsDepth: boolean
  allowLocalFallbackInOpenAI: boolean
}) {
  const jobs: AgentRetrievalJob[] = []
  const seen = new Set<string>()
  const toolOrder = uniqueStrings(params.toolOrder, 5) as AgentRetrievalTool[]
  const primaryQueries = uniqueStrings(params.primaryQueries, 6)
  const secondaryQueries = uniqueStrings(params.secondaryQueries, 3)
  const graphQueries = uniqueStrings(params.graphQueries, 3)
  const extraQueries = uniqueStrings(params.extraQueries, 4)
  const primaryWorkspaceIds = [params.primaryWorkspaceId]
  const secondaryWorkspaceIds = uniqueStrings(params.secondaryWorkspaceIds, 20)

  if (params.isFactualPipeline) {
    pushJob(jobs, seen, {
      id: "factual-local",
      kind: "local",
      phase: "initial",
      workspaceIds: primaryWorkspaceIds,
      queries: primaryQueries.slice(0, 1),
      label: "factual-local",
    })
    pushJob(jobs, seen, {
      id: "factual-managed",
      kind: "managed",
      phase: "initial",
      workspaceIds: primaryWorkspaceIds,
      queries: primaryQueries.slice(0, 1),
      label: "factual-managed",
    })
    return jobs
  }

  const effectiveOrder: AgentRetrievalTool[] = toolOrder.length
    ? toolOrder.filter((tool) => ["managed", "local", "graph", "facts", "memory"].includes(tool))
    : ["managed", "local"]

  for (const tool of effectiveOrder) {
    if (tool === "managed") {
      pushJob(jobs, seen, {
        id: "initial-managed",
        kind: "managed",
        phase: "initial",
        workspaceIds: primaryWorkspaceIds,
        queries: primaryQueries,
        label: "initial-managed",
      })
    }

    if (tool === "local" && params.allowLocalFallbackInOpenAI) {
      pushJob(jobs, seen, {
        id: "initial-local",
        kind: "local",
        phase: "initial",
        workspaceIds: primaryWorkspaceIds,
        queries: primaryQueries.slice(0, 2),
        label: "initial-local",
      })
    }

    if (tool === "graph" && graphQueries.length) {
      pushJob(jobs, seen, {
        id: "graph-local",
        kind: "local",
        phase: "graph",
        workspaceIds: primaryWorkspaceIds,
        queries: graphQueries.slice(0, 2),
        label: "graph-local",
      })
      pushJob(jobs, seen, {
        id: "graph-managed",
        kind: "managed",
        phase: "graph",
        workspaceIds: primaryWorkspaceIds,
        queries: graphQueries.slice(0, 2),
        label: "graph-managed",
      })
    }
  }

  if (params.allowScopeExpansion && secondaryWorkspaceIds.length) {
    if (effectiveOrder.includes("managed")) {
      pushJob(jobs, seen, {
        id: "scope-managed",
        kind: "managed",
        phase: "scope",
        workspaceIds: secondaryWorkspaceIds,
        queries: secondaryQueries.length ? secondaryQueries : primaryQueries.slice(0, 2),
        label: "scope-managed",
      })
    }
    if (effectiveOrder.includes("local")) {
      pushJob(jobs, seen, {
        id: "scope-local",
        kind: "local",
        phase: "scope",
        workspaceIds: secondaryWorkspaceIds,
        queries: secondaryQueries.length ? secondaryQueries.slice(0, 1) : primaryQueries.slice(0, 1),
        label: "scope-local",
      })
    }
  }

  if (params.needsDepth && extraQueries.length) {
    if (effectiveOrder.includes("managed")) {
      pushJob(jobs, seen, {
        id: "depth-managed",
        kind: "managed",
        phase: "depth",
        workspaceIds: primaryWorkspaceIds,
        queries: extraQueries,
        label: "depth-managed",
      })
    }
    if (effectiveOrder.includes("local")) {
      pushJob(jobs, seen, {
        id: "depth-local",
        kind: "local",
        phase: "depth",
        workspaceIds: primaryWorkspaceIds,
        queries: extraQueries.slice(0, 2),
        label: "depth-local",
      })
    }
    if (params.allowScopeExpansion && secondaryWorkspaceIds.length && effectiveOrder.includes("managed")) {
      pushJob(jobs, seen, {
        id: "depth-scope-managed",
        kind: "managed",
        phase: "depth",
        workspaceIds: secondaryWorkspaceIds,
        queries: extraQueries.slice(0, 2),
        label: "depth-scope-managed",
      })
    }
  }

  return jobs
}
