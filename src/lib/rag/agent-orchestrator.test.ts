import test from "node:test"
import assert from "node:assert/strict"

import { buildStrategicAgentPlan } from "@/lib/rag/agent-orchestrator"
import { inferRagQueryIntent } from "@/lib/rag/query-intent"

test("buildStrategicAgentPlan creates graph-aware multi-step plan for complex strategic questions", async () => {
  const prev = process.env.RAG_ENABLE_AGENT_PLANNER
  const prevKey = process.env.OPENAI_API_KEY
  process.env.RAG_ENABLE_AGENT_PLANNER = "false"
  delete process.env.OPENAI_API_KEY

  try {
    const question = "Compara precedentes del SEA y explica que criterios consistentes sirven para el marco teorico"
    const plan = await buildStrategicAgentPlan({
      question,
      mode: "comparison",
      difficulty: "complex",
      responseProfile: "deep",
      intent: inferRagQueryIntent(question),
      graphRelatedRoles: ["R-44-2021"],
    })

    assert.equal(plan.applied, true)
    assert.ok(plan.toolOrder.includes("graph"))
    assert.ok(plan.toolOrder.includes("local"))
    assert.ok(plan.subqueries.some((item) => item.includes("R-44-2021")))
  } finally {
    if (typeof prev === "string") process.env.RAG_ENABLE_AGENT_PLANNER = prev
    else delete process.env.RAG_ENABLE_AGENT_PLANNER

    if (typeof prevKey === "string") process.env.OPENAI_API_KEY = prevKey
    else delete process.env.OPENAI_API_KEY
  }
})
