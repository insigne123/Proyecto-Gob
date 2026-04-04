import "dotenv/config"

import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"

function safeText(value: unknown, maxLen = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text
}

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "")
    if (!token.startsWith("--")) continue
    const key = token.slice(2)
    const next = String(argv[i + 1] || "")
    if (!next || next.startsWith("--")) {
      out[key] = "true"
      continue
    }
    out[key] = next
    i += 1
  }
  return out
}

async function findUserIdByEmail(admin: any, email: string) {
  let page = 1
  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const users = Array.isArray(data?.users) ? data.users : []
    const match = users.find((user: any) => String(user?.email || "").toLowerCase() === email.toLowerCase())
    if (match?.id) return String(match.id)
    if (users.length < 200) break
    page += 1
  }
  throw new Error(`User not found for email ${email}`)
}

async function buildCookie(params: { supabaseUrl: string; anonKey: string; email: string; password: string }) {
  const jar = new Map<string, string>()
  const supabase = createServerClient(params.supabaseUrl, params.anonKey, {
    cookies: {
      getAll() {
        return Array.from(jar.entries()).map(([name, value]) => ({ name, value }))
      },
      setAll(cookies) {
        for (const cookie of cookies) {
          if (cookie.value) jar.set(cookie.name, cookie.value)
          else jar.delete(cookie.name)
        }
      },
    },
  })

  const { error } = await supabase.auth.signInWithPassword({
    email: params.email,
    password: params.password,
  })
  if (error) throw error

  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ")
}

function sanitizeRecommendForReport(payload: any) {
  const recommendations = Array.isArray(payload?.recommendations) ? payload.recommendations : []
  return recommendations.slice(0, 12).map((rec: any) => ({
    causeId: String(rec?.causeId || ""),
    rol: rec?.rol ? safeText(rec.rol, 80) : null,
    caratula: rec?.caratula ? safeText(rec.caratula, 240) : null,
    estado: rec?.estado ? safeText(rec.estado, 120) : null,
    score: typeof rec?.score === "number" ? rec.score : undefined,
    confidence: rec?.confidence ? safeText(rec.confidence, 40) : null,
    reasons: Array.isArray(rec?.reasons) ? rec.reasons.map((item: any) => String(item || "")).slice(0, 6) : [],
    defenseSummary: rec?.defenseSummary ? safeText(rec.defenseSummary, 1000) : null,
    strategicActions: Array.isArray(rec?.strategicActions)
      ? rec.strategicActions.map((item: any) => String(item || "")).slice(0, 6)
      : [],
    interestingDocuments: Array.isArray(rec?.interestingDocuments)
      ? rec.interestingDocuments.slice(0, 4).map((doc: any) => ({
          id: safeText(doc?.id || "", 120),
          name: doc?.name ? safeText(doc.name, 240) : null,
          documentType: doc?.documentType ? safeText(doc.documentType, 120) : null,
          date: doc?.date ? safeText(doc.date, 80) : null,
          url: doc?.url ? String(doc.url) : null,
          contribution: doc?.contribution ? safeText(doc.contribution, 1200) : null,
        }))
      : [],
    keyQuotes: Array.isArray(rec?.keyQuotes)
      ? rec.keyQuotes.slice(0, 4).map((quote: any) => ({
          quote: safeText(quote?.quote || "", 1200),
          claimQuote: quote?.claimQuote ? safeText(quote.claimQuote, 1200) : null,
          documentName: quote?.documentName ? safeText(quote.documentName, 240) : null,
          documentUrl: quote?.documentUrl ? String(quote.documentUrl) : null,
          sourceUrl: quote?.sourceUrl ? String(quote.sourceUrl) : null,
        }))
      : [],
  }))
}

function sanitizeRecommendForComplete(payload: any, report: any) {
  return {
    snapshotId: payload?.claim?.snapshotId ? String(payload.claim.snapshotId) : null,
    runId: payload?.analysisRun?.runId ? String(payload.analysisRun.runId) : null,
    summary: payload?.summary?.text ? safeText(payload.summary.text, 20000) : null,
    summaryCitations: Array.isArray(payload?.summary?.citations)
      ? payload.summary.citations.slice(0, 40).map((citation: any) => ({
          chunkId: String(citation?.chunkId || "summary"),
          quote: safeText(citation?.quote || "", 1200),
          sourceUrl: citation?.sourceUrl ? String(citation.sourceUrl) : null,
          snapshotId: citation?.snapshotId ? String(citation.snapshotId) : null,
          page: typeof citation?.page === "number" ? citation.page : null,
          section: citation?.section ? safeText(citation.section, 200) : null,
        }))
      : [],
    recommendations: [],
    matrix: [],
    report: report?.report
      ? {
          title: report.report?.title ? String(report.report.title) : null,
          content: report.report?.content ? String(report.report.content) : null,
          structured:
            report.report?.structured && typeof report.report.structured === "object"
              ? report.report.structured
              : null,
        }
      : null,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const workspaceId = String(args.workspaceId || "").trim()
  if (!workspaceId) throw new Error("Missing --workspaceId")

  const appUrl = String(args.appUrl || "http://localhost:9002").trim().replace(/\/+$/, "")
  const question = String(
    args.question ||
      "Genera un marco teorico de defensa del SEA priorizando informe y sentencia, usando la reclamacion solo como contexto, explicando criterios utiles, riesgos y plan accionable."
  ).trim()
  const email = String(args.email || process.env.E2E_USER_EMAIL || "e2e.proyectos@local.test").trim()
  const password = String(args.password || process.env.E2E_USER_PASSWORD || "E2E_Proyecto_2026!").trim()
  const keepMembership = String(args.keepMembership || "false").trim().toLowerCase() === "true"

  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
  const anonKey = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim()
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
  if (!supabaseUrl || !anonKey || !serviceKey) throw new Error("Missing Supabase env vars")

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const userId = await findUserIdByEmail(admin, email)

  const { data: existingMembership, error: membershipErr } = await admin
    .from("gob_workspace_members")
    .select("workspace_id,user_id,role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle()
  if (membershipErr) throw membershipErr

  let tempMembershipGranted = false

  try {
    if (!existingMembership) {
      const { error } = await admin.from("gob_workspace_members").insert({
        workspace_id: workspaceId,
        user_id: userId,
        role: "analyst",
      })
      if (error) throw error
      tempMembershipGranted = true
    } else if (String(existingMembership.role || "") === "viewer") {
      const { error } = await admin
        .from("gob_workspace_members")
        .update({ role: "analyst" })
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
      if (error) throw error
      tempMembershipGranted = true
    }

    const { data: sourceRows, error: sourceErr } = await admin
      .from("gob_sources")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("source_origin", "onboarding-claim")
      .order("created_at", { ascending: false })
      .limit(1)
    if (sourceErr) throw sourceErr
    const sourceId = sourceRows?.[0]?.id
    if (!sourceId) throw new Error("No onboarding claim source found")

    const { data: snapshotRows, error: snapshotErr } = await admin
      .from("gob_source_snapshots")
      .select("id,status")
      .eq("source_id", sourceId)
      .order("created_at", { ascending: false })
      .limit(4)
    if (snapshotErr) throw snapshotErr
    const snapshotId = (snapshotRows || []).find((row: any) => String(row?.status || "") === "ready")?.id || snapshotRows?.[0]?.id
    if (!snapshotId) throw new Error("No snapshot found for onboarding claim")

    const cookie = await buildCookie({ supabaseUrl, anonKey, email, password })

    const recommendRes = await fetch(`${appUrl}/api/workspaces/${workspaceId}/onboarding/recommend`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        cookie,
      },
      body: JSON.stringify({ snapshotId, question }),
    })
    const recommendJson = await recommendRes.json().catch(() => null)
    if (!recommendRes.ok) throw new Error(`recommend failed: ${JSON.stringify(recommendJson || { status: recommendRes.status })}`)

    const reportRes = await fetch(`${appUrl}/api/workspaces/${workspaceId}/onboarding/report`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        cookie,
      },
      body: JSON.stringify({
        snapshotId,
        runId: recommendJson?.analysisRun?.runId || null,
        summary: { text: recommendJson?.summary?.text || null },
        recommendations: sanitizeRecommendForReport(recommendJson),
      }),
    })
    const reportJson = await reportRes.json().catch(() => null)
    if (!reportRes.ok) throw new Error(`report failed: ${JSON.stringify(reportJson || { status: reportRes.status })}`)

    const completePayload = sanitizeRecommendForComplete(recommendJson, reportJson)
    const completeRes = await fetch(`${appUrl}/api/workspaces/${workspaceId}/onboarding/complete`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        cookie,
      },
      body: JSON.stringify(completePayload),
    })
    const completeJson = await completeRes.json().catch(() => null)
    if (!completeRes.ok) throw new Error(`complete failed: ${JSON.stringify(completeJson || { status: completeRes.status })}`)

    const { data: profileAfter, error: profileAfterErr } = await admin
      .from("gob_workspace_profiles")
      .select("metadata")
      .eq("workspace_id", workspaceId)
      .maybeSingle()
    if (profileAfterErr) throw profileAfterErr

    const onboarding =
      profileAfter?.metadata &&
      typeof profileAfter.metadata === "object" &&
      !Array.isArray(profileAfter.metadata) &&
      profileAfter.metadata?.onboarding &&
      typeof profileAfter.metadata.onboarding === "object"
        ? profileAfter.metadata.onboarding
        : {}

    const refs = Array.isArray((onboarding as any)?.tribunal_references) ? (onboarding as any).tribunal_references : []
    const keyDocuments = Array.isArray((onboarding as any)?.structured_memory?.keyDocuments)
      ? (onboarding as any).structured_memory.keyDocuments
      : []

    console.log(
      JSON.stringify(
        {
          workspaceId,
          snapshotId,
          runId: recommendJson?.analysisRun?.runId || null,
          recommendationCount: Array.isArray(recommendJson?.recommendations) ? recommendJson.recommendations.length : 0,
          refsCount: refs.length,
          refs: refs.slice(0, 10).map((ref: any) => ({
            rol: ref?.rol || null,
            docRole: ref?.docRole || null,
            title: ref?.sourceTitle || ref?.documentName || null,
          })),
          keyDocuments: keyDocuments.slice(0, 10).map((doc: any) => ({
            rol: doc?.rol || null,
            docRole: doc?.docRole || null,
            name: doc?.name || null,
          })),
          membershipRestoredAutomatically: !keepMembership,
        },
        null,
        2
      )
    )
  } finally {
    if (!keepMembership && tempMembershipGranted) {
      if (!existingMembership) {
        await admin
          .from("gob_workspace_members")
          .delete()
          .eq("workspace_id", workspaceId)
          .eq("user_id", userId)
      } else if (String(existingMembership.role || "") === "viewer") {
        await admin
          .from("gob_workspace_members")
          .update({ role: existingMembership.role })
          .eq("workspace_id", workspaceId)
          .eq("user_id", userId)
      }
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
