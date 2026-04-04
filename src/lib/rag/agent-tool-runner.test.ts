import test from "node:test"
import assert from "node:assert/strict"

import { executeAgenticRetrievalJobs } from "@/lib/rag/agent-tool-runner"

test("executeAgenticRetrievalJobs respects budget and stops after evidence limit", async () => {
  const calls: string[] = []
  let evidenceCount = 0
  let budget = 2

  const result = await executeAgenticRetrievalJobs({
    jobs: [
      { id: "managed-1", kind: "managed", phase: "initial", workspaceIds: ["w1"], queries: ["q1"], label: "m1" },
      { id: "local-1", kind: "local", phase: "graph", workspaceIds: ["w1"], queries: ["q2", "q3"], label: "l1" },
      { id: "managed-2", kind: "managed", phase: "depth", workspaceIds: ["w1"], queries: ["q4"], label: "m2" },
    ],
    evidenceLimit: 3,
    consumeBudget(label) {
      calls.push(`budget:${label}`)
      if (budget <= 0) return false
      budget -= 1
      return true
    },
    getEvidenceCount() {
      return evidenceCount
    },
    async runManaged(_workspaceIds, queries) {
      calls.push(`managed:${queries.join(",")}`)
      evidenceCount += 2
    },
    async runLocal(_workspaceIds, query) {
      calls.push(`local:${query}`)
      evidenceCount += 1
    },
    async verifyAfterJob(job) {
      return {
        continueLoop: job.id !== "local-1",
        reason: job.id === "local-1" ? "coverage_sufficient" : null,
        metadata: { evidenceCount },
      }
    },
  })

  assert.deepEqual(result.executedJobIds, ["managed-1", "local-1"])
  assert.equal(result.budgetExhausted, false)
  assert.equal(result.stopReason, "coverage_sufficient")
  assert.equal(result.verificationReports.length, 2)
  assert.ok(calls.includes("managed:q1"))
  assert.ok(calls.includes("local:q2"))
  assert.ok(!calls.includes("managed:q4"))
})

test("executeAgenticRetrievalJobs reports exhausted budget before running job", async () => {
  const result = await executeAgenticRetrievalJobs({
    jobs: [{ id: "managed-1", kind: "managed", phase: "initial", workspaceIds: ["w1"], queries: ["q1"], label: "m1" }],
    evidenceLimit: 10,
    consumeBudget() {
      return false
    },
    getEvidenceCount() {
      return 0
    },
    async runManaged() {
      throw new Error("should not run")
    },
    async runLocal() {
      throw new Error("should not run")
    },
  })

  assert.equal(result.budgetExhausted, true)
  assert.equal(result.exhaustedLabel, "managed:initial")
  assert.deepEqual(result.executedJobIds, [])
  assert.equal(result.stopReason, null)
})
