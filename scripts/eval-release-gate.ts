import "dotenv/config"

import fs from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"

type Thresholds = {
  ragMustIncludeAllRate: number
  ragCitationValidityRate: number
  ragNotFoundAccuracy: number
  chatMustIncludeAllMatchedRate: number
  chatStrongSupportRate: number
  onboardingExpectedRoleHitRate: number
  onboardingExpectedCauseHitRate: number
}

type CliOptions = {
  ragDataset: string
  chatDataset: string
  onboardingDataset?: string
  appUrl: string
  workspaceId?: string
  maxCases?: number
  outputDir: string
}

function numberEnv(name: string, fallback: number) {
  const raw = Number(process.env[name] || fallback)
  return Number.isFinite(raw) ? raw : fallback
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    ragDataset: process.env.RELEASE_GATE_RAG_DATASET || "eval/golden.jsonl",
    chatDataset: process.env.RELEASE_GATE_CHAT_DATASET || "eval/chat-live.sea-smoke.jsonl",
    onboardingDataset: process.env.RELEASE_GATE_ONBOARDING_DATASET || undefined,
    appUrl: process.env.EVAL_APP_URL || "http://localhost:9002",
    workspaceId: process.env.EVAL_WORKSPACE_ID || undefined,
    outputDir: process.env.RELEASE_GATE_OUTPUT_DIR || "eval/results/release-gate",
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === "--rag-dataset" && next) {
      opts.ragDataset = next
      i += 1
      continue
    }
    if (arg === "--chat-dataset" && next) {
      opts.chatDataset = next
      i += 1
      continue
    }
    if (arg === "--onboarding-dataset" && next) {
      opts.onboardingDataset = next
      i += 1
      continue
    }
    if (arg === "--app-url" && next) {
      opts.appUrl = next
      i += 1
      continue
    }
    if (arg === "--workspace-id" && next) {
      opts.workspaceId = next
      i += 1
      continue
    }
    if (arg === "--max" && next) {
      const n = Number(next)
      if (Number.isFinite(n) && n > 0) opts.maxCases = Math.floor(n)
      i += 1
      continue
    }
    if (arg === "--output-dir" && next) {
      opts.outputDir = next
      i += 1
      continue
    }
  }

  return opts
}

function resolveThresholds(): Thresholds {
  return {
    ragMustIncludeAllRate: numberEnv("RELEASE_GATE_RAG_MUST_INCLUDE_ALL_RATE", 0.9),
    ragCitationValidityRate: numberEnv("RELEASE_GATE_RAG_CITATION_VALIDITY_RATE", 0.98),
    ragNotFoundAccuracy: numberEnv("RELEASE_GATE_RAG_NOT_FOUND_ACCURACY", 0.98),
    chatMustIncludeAllMatchedRate: numberEnv("RELEASE_GATE_CHAT_MUST_INCLUDE_ALL_RATE", 0.9),
    chatStrongSupportRate: numberEnv("RELEASE_GATE_CHAT_STRONG_SUPPORT_RATE", 0.65),
    onboardingExpectedRoleHitRate: numberEnv("RELEASE_GATE_ONBOARDING_ROLE_HIT_RATE", 0.75),
    onboardingExpectedCauseHitRate: numberEnv("RELEASE_GATE_ONBOARDING_CAUSE_HIT_RATE", 0.55),
  }
}

async function runCommand(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code || 1}`))
    })
  })
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm"
}

function ratio(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const thresholds = resolveThresholds()
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const outputDir = path.resolve(opts.outputDir)
  await fs.mkdir(outputDir, { recursive: true })

  const ragOutput = path.join(outputDir, `rag-${stamp}.json`)
  const chatOutput = path.join(outputDir, `chat-${stamp}.json`)
  const onboardingOutput = path.join(outputDir, `onboarding-${stamp}.json`)
  const npm = npmCommand()

  const ragArgs = ["run", "eval:rag", "--", "--dataset", opts.ragDataset, "--output", ragOutput]
  if (opts.workspaceId) ragArgs.push("--workspace-id", opts.workspaceId)
  if (typeof opts.maxCases === "number") ragArgs.push("--max", String(opts.maxCases))

  const chatArgs = [
    "run",
    "eval:chat-live",
    "--",
    "--dataset",
    opts.chatDataset,
    "--app-url",
    opts.appUrl,
    "--output",
    chatOutput,
  ]
  if (opts.workspaceId) chatArgs.push("--workspace-id", opts.workspaceId)
  if (typeof opts.maxCases === "number") chatArgs.push("--max", String(opts.maxCases))

  const onboardingArgs = opts.onboardingDataset
    ? [
        "run",
        "eval:onboarding-recommend",
        "--",
        "--dataset",
        opts.onboardingDataset,
        "--app-url",
        opts.appUrl,
        "--output",
        onboardingOutput,
        ...(opts.workspaceId ? ["--workspace-id", opts.workspaceId] : []),
        ...(typeof opts.maxCases === "number" ? ["--max", String(opts.maxCases)] : []),
      ]
    : null

  await runCommand(npm, ragArgs)
  await runCommand(npm, chatArgs)
  if (onboardingArgs) await runCommand(npm, onboardingArgs)

  const ragReport = JSON.parse(await fs.readFile(ragOutput, "utf8"))
  const chatReport = JSON.parse(await fs.readFile(chatOutput, "utf8"))
  const onboardingReport = onboardingArgs ? JSON.parse(await fs.readFile(onboardingOutput, "utf8")) : null

  const ragSummary = ragReport?.summary || {}
  const chatSummary = chatReport?.summary || {}
  const supportStrengths = chatSummary?.supportStrengths && typeof chatSummary.supportStrengths === "object"
    ? chatSummary.supportStrengths
    : {}
  const supportTotal = Object.values(supportStrengths).reduce((acc: number, value: any) => acc + Number(value || 0), 0)
  const strongSupportRate = supportTotal > 0 ? Number((Number(supportStrengths.strong || 0) / supportTotal).toFixed(4)) : null

  const checks = [
    {
      label: "rag.mustIncludeAllRate",
      value: ratio(ragSummary?.answer?.mustIncludeAllRate),
      min: thresholds.ragMustIncludeAllRate,
    },
    {
      label: "rag.citationValidityRate",
      value: ratio(ragSummary?.answer?.citationValidityRate),
      min: thresholds.ragCitationValidityRate,
    },
    {
      label: "rag.notFoundAccuracy",
      value: ratio(ragSummary?.answer?.notFoundAccuracy),
      min: thresholds.ragNotFoundAccuracy,
    },
    {
      label: "chat.mustIncludeAllMatchedRate",
      value: ratio(chatSummary?.mustIncludeAllMatchedRate),
      min: thresholds.chatMustIncludeAllMatchedRate,
    },
    {
      label: "chat.strongSupportRate",
      value: strongSupportRate,
      min: thresholds.chatStrongSupportRate,
    },
    ...(onboardingReport
      ? [
          {
            label: "onboarding.expectedRoleHitRate",
            value: ratio(onboardingReport?.summary?.expectedRoleHitRate),
            min: thresholds.onboardingExpectedRoleHitRate,
          },
          {
            label: "onboarding.expectedCauseHitRate",
            value: ratio(onboardingReport?.summary?.expectedCauseHitRate),
            min: thresholds.onboardingExpectedCauseHitRate,
          },
        ]
      : []),
  ]

  const failed = checks.filter((check) => check.value === null || check.value < check.min)
  const payload = {
    generatedAt: new Date().toISOString(),
    thresholds,
    outputs: { rag: ragOutput, chat: chatOutput, onboarding: onboardingArgs ? onboardingOutput : null },
    checks,
    passed: failed.length === 0,
  }

  const gateOutput = path.join(outputDir, `release-gate-${stamp}.json`)
  await fs.writeFile(gateOutput, JSON.stringify(payload, null, 2), "utf8")
  console.log(JSON.stringify(payload, null, 2))

  if (failed.length > 0) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
