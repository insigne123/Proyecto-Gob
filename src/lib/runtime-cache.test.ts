import test from "node:test"
import assert from "node:assert/strict"

import { clearRuntimeCache, getRuntimeCached } from "@/lib/runtime-cache"

test("getRuntimeCached reuses loader result within ttl", async () => {
  await clearRuntimeCache()
  let calls = 0

  const first = await getRuntimeCached({
    namespace: "test",
    key: "a",
    ttlMs: 10_000,
    loader: async () => {
      calls += 1
      return { value: 1 }
    },
  })

  const second = await getRuntimeCached({
    namespace: "test",
    key: "a",
    ttlMs: 10_000,
    loader: async () => {
      calls += 1
      return { value: 2 }
    },
  })

  assert.equal(calls, 1)
  assert.deepEqual(first, { value: 1 })
  assert.deepEqual(second, { value: 1 })
})
