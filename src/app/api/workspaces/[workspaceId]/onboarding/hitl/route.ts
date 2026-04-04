import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"

const CauseStatusSchema = z.enum(["pendiente", "aprobada", "descartada", "usar_en_escrito"])
const FindingDecisionSchema = z.enum(["util", "dudoso", "descartar", "usar_en_escrito"])

const HitlActionSchema = z
  .discriminatedUnion("action", [
    z
      .object({
        action: z.literal("set_cause_status"),
        runId: z.string().trim().min(8).max(120),
        causeId: z.string().uuid(),
        status: CauseStatusSchema,
        comment: z.string().trim().max(1200).optional().nullable(),
      })
      .strict(),
    z
      .object({
        action: z.literal("set_finding_feedback"),
        runId: z.string().trim().min(8).max(120),
        findingId: z.string().trim().min(8).max(120),
        decision: FindingDecisionSchema,
        comment: z.string().trim().max(1200).optional().nullable(),
      })
      .strict(),
    z
      .object({
        action: z.literal("freeze_precedents"),
        runId: z.string().trim().min(8).max(120),
        causeIds: z.array(z.string().uuid()).min(1).max(30),
      })
      .strict(),
  ])

function isRecord(value: any): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function minutesBetween(fromIso: string | null, toIso: string | null) {
  if (!fromIso || !toIso) return null
  const from = Date.parse(fromIso)
  const to = Date.parse(toIso)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null
  return Number(((to - from) / 60000).toFixed(2))
}

function computeRunKpis(run: any) {
  const recs = Array.isArray(run?.recommendations) ? run.recommendations : []
  const total = recs.length || 1

  const causeReviews = isRecord(run?.hitl?.cause_reviews) ? run.hitl.cause_reviews : {}
  const findingFeedback = isRecord(run?.hitl?.finding_feedback) ? run.hitl.finding_feedback : {}

  const causeValues = Object.values(causeReviews) as any[]
  const approvedCount = causeValues.filter((x) => x?.status === "aprobada" || x?.status === "usar_en_escrito").length
  const usedCausesRatio = Number((approvedCount / total).toFixed(4))

  const findingValues = Object.values(findingFeedback) as any[]
  const usefulVotes = findingValues.filter((x) => x?.decision === "util" || x?.decision === "usar_en_escrito").length
  const totalVotes = findingValues.length
  const perceivedPrecision = totalVotes > 0 ? Number((usefulVotes / totalVotes).toFixed(4)) : null

  const useTimes = [
    ...causeValues
      .filter((x) => x?.status === "usar_en_escrito" || x?.status === "aprobada")
      .map((x) => String(x?.updated_at || ""))
      .filter(Boolean),
    ...findingValues
      .filter((x) => x?.decision === "usar_en_escrito")
      .map((x) => String(x?.updated_at || ""))
      .filter(Boolean),
  ]
    .map((x) => Date.parse(x))
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => a - b)

  const firstUseIso = useTimes.length ? new Date(useTimes[0]).toISOString() : null
  const timeToFirstUseMinutes = minutesBetween(run?.created_at ? String(run.created_at) : null, firstUseIso)

  return {
    used_causes_ratio: usedCausesRatio,
    perceived_precision: perceivedPrecision,
    time_to_first_use_minutes: timeToFirstUseMinutes,
    approved_causes: approvedCount,
    reviewed_findings: totalVotes,
  }
}

function buildDashboardFromRuns(runsObj: Record<string, any>) {
  const runs = Object.values(runsObj || {})
  if (!runs.length) {
    return {
      total_runs: 0,
      avg_used_causes_ratio: null,
      avg_perceived_precision: null,
      avg_time_to_first_use_minutes: null,
    }
  }

  const kpis = runs.map((run) => computeRunKpis(run))
  const avg = (arr: number[]) =>
    arr.length ? Number((arr.reduce((acc, x) => acc + x, 0) / arr.length).toFixed(4)) : null

  return {
    total_runs: runs.length,
    avg_used_causes_ratio: avg(kpis.map((x) => x.used_causes_ratio).filter((x) => typeof x === "number")),
    avg_perceived_precision: avg(
      kpis.map((x) => x.perceived_precision).filter((x): x is number => typeof x === "number")
    ),
    avg_time_to_first_use_minutes: avg(
      kpis.map((x) => x.time_to_first_use_minutes).filter((x): x is number => typeof x === "number")
    ),
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: profile, error } = await supabase
    .from("gob_workspace_profiles")
    .select("workspace_id,metadata")
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const metadata = isRecord(profile?.metadata) ? profile.metadata : {}
  const onboarding = isRecord(metadata?.onboarding) ? metadata.onboarding : {}
  const runs = isRecord(onboarding?.analysis_runs) ? onboarding.analysis_runs : {}
  const latestRunId = typeof onboarding?.last_run_id === "string" ? onboarding.last_run_id : null
  const latestRun = latestRunId && runs[latestRunId] ? runs[latestRunId] : null

  return NextResponse.json({
    latestRunId,
    latestRun,
    latestRunKpis: latestRun ? computeRunKpis(latestRun) : null,
    dashboard: buildDashboardFromRuns(runs),
  })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: member } = await supabase
    .from("gob_workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (member.role === "viewer") return NextResponse.json({ error: "Read-only role" }, { status: 403 })

  const body = await request.json().catch(() => null)
  const parsed = HitlActionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const action = parsed.data
  const now = new Date().toISOString()

  const { data: profile, error: profileErr } = await supabase
    .from("gob_workspace_profiles")
    .select("workspace_id,metadata")
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 })

  const metadata = isRecord(profile?.metadata) ? profile.metadata : {}
  const onboarding = isRecord(metadata?.onboarding) ? metadata.onboarding : {}
  const runs = isRecord(onboarding?.analysis_runs) ? onboarding.analysis_runs : {}
  const run = isRecord(runs[action.runId]) ? runs[action.runId] : null

  if (!run) {
    return NextResponse.json({ error: "Run no encontrado" }, { status: 404 })
  }

  const hitl = isRecord(run?.hitl) ? run.hitl : { cause_reviews: {}, finding_feedback: {}, frozen_precedents: null }
  const causeReviews = isRecord(hitl?.cause_reviews) ? hitl.cause_reviews : {}
  const findingFeedback = isRecord(hitl?.finding_feedback) ? hitl.finding_feedback : {}

  if (action.action === "set_cause_status") {
    if (action.status === "descartada" && !String(action.comment || "").trim()) {
      return NextResponse.json(
        { error: "Comentario obligatorio al descartar una causa" },
        { status: 400 }
      )
    }

    causeReviews[action.causeId] = {
      status: action.status,
      comment: action.comment ? String(action.comment) : null,
      updated_at: now,
      updated_by: user.id,
    }
  }

  if (action.action === "set_finding_feedback") {
    findingFeedback[action.findingId] = {
      decision: action.decision,
      comment: action.comment ? String(action.comment) : null,
      updated_at: now,
      updated_by: user.id,
    }
  }

  if (action.action === "freeze_precedents") {
    hitl.frozen_precedents = {
      cause_ids: action.causeIds,
      frozen_at: now,
      frozen_by: user.id,
    }
  }

  const updatedRun = {
    ...run,
    updated_at: now,
    hitl: {
      ...hitl,
      cause_reviews: causeReviews,
      finding_feedback: findingFeedback,
    },
  }

  updatedRun.kpis = computeRunKpis(updatedRun)

  const mergedMetadata = {
    ...metadata,
    onboarding: {
      ...onboarding,
      analysis_runs: {
        ...runs,
        [action.runId]: updatedRun,
      },
      hitl: {
        ...(isRecord(onboarding?.hitl) ? onboarding.hitl : {}),
        latest_run_id: action.runId,
      },
    },
  }

  if (!profile?.workspace_id) {
    await supabase.from("gob_workspace_profiles").insert({
      workspace_id: workspaceId,
      created_at: now,
      updated_at: now,
      created_by: user.id,
      metadata: mergedMetadata,
    })
  } else {
    await supabase
      .from("gob_workspace_profiles")
      .update({ metadata: mergedMetadata, updated_at: now })
      .eq("workspace_id", workspaceId)
  }

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "workspace.onboarding.hitl",
    target_resource: "gob_workspace_profiles",
    details: {
      workspace_id: workspaceId,
      run_id: action.runId,
      hitl_action: action.action,
    },
    timestamp: now,
  })

  const updatedRuns = isRecord(mergedMetadata?.onboarding?.analysis_runs)
    ? mergedMetadata.onboarding.analysis_runs
    : {}

  return NextResponse.json({
    ok: true,
    runId: action.runId,
    run: updatedRun,
    runKpis: updatedRun.kpis,
    dashboard: buildDashboardFromRuns(updatedRuns),
  })
}
