import test from "node:test"
import assert from "node:assert/strict"

import { buildWebHealthPayload, buildWorkerHealthPayload, summarizeWorkers } from "@/lib/health-response"

test("buildWebHealthPayload hides env details for token-based checks", () => {
  const payload = buildWebHealthPayload({
    ts: "2026-03-08T12:00:00.000Z",
    hasToken: true,
    env: { openaiApiKey: true },
  })

  assert.deepEqual(payload, {
    ok: true,
    ts: "2026-03-08T12:00:00.000Z",
    env: undefined,
  })
})

test("buildWebHealthPayload keeps env details for authenticated session checks and serializes errors", () => {
  const payload = buildWebHealthPayload({
    ts: "2026-03-08T12:00:00.000Z",
    hasToken: false,
    env: { supabaseUrl: true },
    error: new Error("Missing OPENAI_API_KEY"),
  })

  assert.deepEqual(payload, {
    ok: false,
    ts: "2026-03-08T12:00:00.000Z",
    env: { supabaseUrl: true },
    error: "Missing OPENAI_API_KEY",
  })
})

test("summarizeWorkers computes freshness and null-safe ages", () => {
  const { workers, fresh } = summarizeWorkers(
    [
      {
        worker_id: "worker-a",
        started_at: "2026-03-08T11:00:00.000Z",
        last_seen_at: "2026-03-08T12:00:30.000Z",
        hostname: "node-a",
        pid: 101,
        version: "1.0.0",
      },
      {
        worker_id: "worker-b",
        started_at: "2026-03-08T10:00:00.000Z",
        last_seen_at: "2026-03-08T11:57:00.000Z",
        hostname: "node-b",
        pid: 102,
        version: "1.0.0",
      },
      {
        worker_id: "worker-c",
        started_at: null,
        last_seen_at: null,
      },
    ],
    Date.parse("2026-03-08T12:01:00.000Z")
  )

  assert.equal(fresh, 1)
  assert.deepEqual(workers[0], {
    workerId: "worker-a",
    startedAt: "2026-03-08T11:00:00.000Z",
    lastSeenAt: "2026-03-08T12:00:30.000Z",
    ageSeconds: 30,
    hostname: "node-a",
    pid: 101,
    version: "1.0.0",
  })
  assert.equal(workers[1].ageSeconds, 240)
  assert.equal(workers[2].ageSeconds, null)
})

test("buildWorkerHealthPayload hides worker list for token checks and reports freshness", () => {
  const payload = buildWorkerHealthPayload({
    ts: "2026-03-08T12:00:00.000Z",
    hasToken: true,
    nowMs: Date.parse("2026-03-08T12:01:00.000Z"),
    rows: [
      {
        worker_id: "worker-a",
        last_seen_at: "2026-03-08T11:58:00.000Z",
      },
    ],
  })

  assert.deepEqual(payload, {
    ok: false,
    ts: "2026-03-08T12:00:00.000Z",
    fresh: 0,
    workers: undefined,
  })
})

test("buildWorkerHealthPayload exposes worker list for authenticated users", () => {
  const payload = buildWorkerHealthPayload({
    ts: "2026-03-08T12:00:00.000Z",
    hasToken: false,
    nowMs: Date.parse("2026-03-08T12:01:00.000Z"),
    rows: [
      {
        worker_id: "worker-a",
        started_at: "2026-03-08T10:00:00.000Z",
        last_seen_at: "2026-03-08T12:00:10.000Z",
        hostname: "node-a",
        pid: 101,
        version: "1.0.0",
      },
    ],
  })

  assert.equal(payload.ok, true)
  assert.equal(payload.fresh, 1)
  assert.equal(Array.isArray(payload.workers), true)
  assert.equal(payload.workers?.[0]?.workerId, "worker-a")
  assert.equal(payload.workers?.[0]?.ageSeconds, 50)
})
