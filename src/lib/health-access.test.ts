import test from "node:test"
import assert from "node:assert/strict"

import { requestHasHealthToken } from "@/lib/health-access"

test("requestHasHealthToken accepts x-health-token header", () => {
  process.env.HEALTHCHECK_TOKEN = "secret-token"

  const request = new Request("https://example.com/api/health", {
    headers: {
      "x-health-token": "secret-token",
    },
  })

  assert.equal(requestHasHealthToken(request), true)
})

test("requestHasHealthToken accepts bearer token with extra spaces", () => {
  process.env.HEALTHCHECK_TOKEN = "secret-token"

  const request = new Request("https://example.com/api/health", {
    headers: {
      authorization: "Bearer   secret-token  ",
    },
  })

  assert.equal(requestHasHealthToken(request), true)
})

test("requestHasHealthToken returns false for missing or mismatched token", () => {
  process.env.HEALTHCHECK_TOKEN = "secret-token"

  const mismatchedRequest = new Request("https://example.com/api/health", {
    headers: {
      authorization: "Bearer wrong-token",
    },
  })

  assert.equal(requestHasHealthToken(mismatchedRequest), false)

  delete process.env.HEALTHCHECK_TOKEN

  const unsignedRequest = new Request("https://example.com/api/health")
  assert.equal(requestHasHealthToken(unsignedRequest), false)
})
