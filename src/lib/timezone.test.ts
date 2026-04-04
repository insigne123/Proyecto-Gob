import test from "node:test"
import assert from "node:assert/strict"

import { nextDailyAt } from "@/lib/timezone"

test("nextDailyAt returns same-day slot when it is still ahead", () => {
  const next = nextDailyAt({
    timeZone: "UTC",
    hhmm: "10:30",
    now: new Date("2026-01-10T09:15:00.000Z"),
  })

  assert.equal(next.toISOString(), "2026-01-10T10:30:00.000Z")
})

test("nextDailyAt rolls to the next day when the slot already passed", () => {
  const next = nextDailyAt({
    timeZone: "UTC",
    hhmm: "10:30",
    now: new Date("2026-01-10T11:00:00.000Z"),
  })

  assert.equal(next.toISOString(), "2026-01-11T10:30:00.000Z")
})

test("nextDailyAt clamps invalid hour and minute values", () => {
  const next = nextDailyAt({
    timeZone: "UTC",
    hhmm: "99:99",
    now: new Date("2026-01-10T22:00:00.000Z"),
  })

  assert.equal(next.toISOString(), "2026-01-10T23:59:00.000Z")
})
