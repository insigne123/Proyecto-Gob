import test from "node:test"
import assert from "node:assert/strict"

import { buildAgenticRetrievalJobs } from "@/lib/rag/agent-tool-loop"

test("buildAgenticRetrievalJobs creates factual local-first plan", () => {
  const jobs = buildAgenticRetrievalJobs({
    isFactualPipeline: true,
    primaryWorkspaceId: "w1",
    secondaryWorkspaceIds: ["w2"],
    toolOrder: ["local", "managed"],
    primaryQueries: ["existe sentencia r-1-2020"],
    secondaryQueries: [],
    graphQueries: ["r-1-2020 sentencia"],
    extraQueries: ["resultado final sentencia"],
    allowScopeExpansion: true,
    needsDepth: true,
    allowLocalFallbackInOpenAI: true,
  })

  assert.deepEqual(jobs.map((job) => job.id), ["factual-local", "factual-managed"])
})

test("buildAgenticRetrievalJobs builds graph and depth jobs for strategic flow", () => {
  const jobs = buildAgenticRetrievalJobs({
    isFactualPipeline: false,
    primaryWorkspaceId: "w1",
    secondaryWorkspaceIds: ["w2"],
    toolOrder: ["graph", "managed", "local"],
    primaryQueries: ["criterios sea informe sentencia", "precedentes sea"],
    secondaryQueries: ["criterios sea informe sentencia"],
    graphQueries: ["R-44-2021 criterios sea"],
    extraQueries: ["resultado final sentencia sea"],
    allowScopeExpansion: true,
    needsDepth: true,
    allowLocalFallbackInOpenAI: true,
  })

  assert.ok(jobs.some((job) => job.phase === "graph" && job.kind === "local"))
  assert.ok(jobs.some((job) => job.phase === "scope" && job.kind === "managed"))
  assert.ok(jobs.some((job) => job.phase === "depth" && job.kind === "managed"))
})
