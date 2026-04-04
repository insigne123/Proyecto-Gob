import "dotenv/config"

import { refreshOnboardingDefensePool } from "../src/lib/onboarding/defense-pool"
import { createAdminClient } from "../src/lib/supabase/admin"

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
    if (prev && prev.startsWith("--") && !prev.includes("=")) {
      continue
    }
    out.push(token)
  }
  return out
}

function intArg(name: string, fallback: number, min: number, max: number) {
  const raw = Number(arg(name) || fallback)
  if (!Number.isFinite(raw)) return fallback
  return Math.max(min, Math.min(max, Math.floor(raw)))
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

async function sleep(ms: number) {
  if (ms <= 0) return
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const pos = positionalArgs()
  const maxCauses = intArg("--max-causes", Number(pos[0] || 240), 20, 800)
  const maxDocs = intArg("--max-docs", Number(pos[1] || 900), 40, 4000)
  const refreshProfiles = boolArg(
    "--refresh-profiles",
    String(pos[2] || "").trim() ? String(pos[2]) !== "false" : true
  )
  const causeOffset = intArg("--cause-offset", Number(pos[3] || 0), 0, 10000)
  const docOffset = intArg("--doc-offset", Number(pos[4] || 0), 0, 50000)
  const retries = intArg("--retries", 3, 1, 10)
  const causeBatch = intArg("--cause-batch", 80, 20, 400)
  const docBatch = intArg("--doc-batch", 80, 40, 400)

  const admin = createAdminClient()

  const started = Date.now()
  const runWithRetry = async (opts: {
    refreshProfiles: boolean
    refreshCauseProfiles?: boolean
    refreshDocProfiles?: boolean
    maxCauseProfilesPerRun: number
    maxDocProfilesPerRun: number
    causeOffset: number
    docOffset: number
  }) => {
    let lastError = ""
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        const stats = await refreshOnboardingDefensePool({
          admin,
          ...opts,
        })
        return { stats, attemptsUsed: attempt }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        if (attempt >= retries) break
        await sleep(1000 * attempt)
      }
    }
    throw new Error(lastError || "refresh failed")
  }

  const bootstrap = await runWithRetry({
    refreshProfiles: false,
    maxCauseProfilesPerRun: 40,
    maxDocProfilesPerRun: 40,
    causeOffset: 0,
    docOffset: 0,
  })

  const bootstrapStats = bootstrap.stats
  const eligibleCauses = Number(bootstrapStats?.eligibleCauses || 0)
  const eligibleDocs = Number(bootstrapStats?.eligibleDocs || 0)

  let causeProfilesUpdated = 0
  let causeProfilesSkipped = 0
  let docProfilesUpdated = 0
  let docProfilesSkipped = 0
  let llmProfilesApplied = 0

  const causeRuns: any[] = []
  const docRuns: any[] = []

  if (refreshProfiles) {
    const causeEnd = Math.min(eligibleCauses, causeOffset + maxCauses)
    for (let offset = causeOffset; offset < causeEnd; offset += causeBatch) {
      const size = Math.max(20, Math.min(causeBatch, causeEnd - offset))
      const result = await runWithRetry({
        refreshProfiles: true,
        refreshCauseProfiles: true,
        refreshDocProfiles: false,
        maxCauseProfilesPerRun: size,
        maxDocProfilesPerRun: 40,
        causeOffset: offset,
        docOffset: 0,
      })

      causeRuns.push({
        causeOffset: offset,
        maxCauseProfilesPerRun: size,
        attemptsUsed: result.attemptsUsed,
        updated: result.stats.causeProfilesUpdated,
        skipped: result.stats.causeProfilesSkipped,
      })
      causeProfilesUpdated += Number(result.stats.causeProfilesUpdated || 0)
      causeProfilesSkipped += Number(result.stats.causeProfilesSkipped || 0)
      llmProfilesApplied += Number(result.stats.llmProfilesApplied || 0)
    }

    const docEnd = Math.min(eligibleDocs, docOffset + maxDocs)
    for (let offset = docOffset; offset < docEnd; offset += docBatch) {
      const size = Math.max(40, Math.min(docBatch, docEnd - offset))
      const result = await runWithRetry({
        refreshProfiles: true,
        refreshCauseProfiles: false,
        refreshDocProfiles: true,
        maxCauseProfilesPerRun: 40,
        maxDocProfilesPerRun: size,
        causeOffset: 0,
        docOffset: offset,
      })

      docRuns.push({
        docOffset: offset,
        maxDocProfilesPerRun: size,
        attemptsUsed: result.attemptsUsed,
        updated: result.stats.docProfilesUpdated,
        skipped: result.stats.docProfilesSkipped,
      })
      docProfilesUpdated += Number(result.stats.docProfilesUpdated || 0)
      docProfilesSkipped += Number(result.stats.docProfilesSkipped || 0)
    }
  }

  const stats = {
    ...bootstrapStats,
    refreshProfiles,
    maxCauseProfilesPerRun: maxCauses,
    maxDocProfilesPerRun: maxDocs,
    causeOffset,
    docOffset,
    causeProfilesUpdated,
    causeProfilesSkipped,
    docProfilesUpdated,
    docProfilesSkipped,
    llmProfilesApplied,
    causeRuns,
    docRuns,
  }

  const elapsedSec = Number(((Date.now() - started) / 1000).toFixed(2))
  console.log(
    JSON.stringify(
      {
        action: "onboarding_defense_pool_refresh.done",
        refreshProfiles,
        maxCauses,
        maxDocs,
        causeOffset,
        docOffset,
        causeBatch,
        docBatch,
        retries,
        bootstrapAttemptsUsed: bootstrap.attemptsUsed,
        elapsedSec,
        stats,
      },
      null,
      2
    )
  )
}

main().catch((err) => {
  console.error(`refresh-onboarding-defense-pool failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
