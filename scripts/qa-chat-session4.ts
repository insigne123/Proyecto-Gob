import "dotenv/config"

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"

type QuestionKind = "meta" | "facts" | "strategy" | "specificity"

type QuestionSpec = {
  id: string
  kind: QuestionKind
  text: string
  useClaimSource: boolean
}

type TurnScore = {
  relevance: number
  grounding: number
  honesty: number
  instruction: number
  coherence: number
  total: number
}

type TokenUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

function nowCompact() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function safeText(value: unknown, maxLen = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text
}

function normalizeText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
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

function maybeNum(value: any) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.floor(n) : 0
}

function parseUsage(usage: any): TokenUsage {
  const promptTokens =
    maybeNum(usage?.prompt_tokens) || maybeNum(usage?.promptTokens) || maybeNum(usage?.input_tokens) || maybeNum(usage?.inputTokens)
  const completionTokens =
    maybeNum(usage?.completion_tokens) ||
    maybeNum(usage?.completionTokens) ||
    maybeNum(usage?.output_tokens) ||
    maybeNum(usage?.outputTokens)
  const totalTokens =
    maybeNum(usage?.total_tokens) ||
    maybeNum(usage?.totalTokens) ||
    (promptTokens > 0 || completionTokens > 0 ? promptTokens + completionTokens : 0)

  return {
    promptTokens,
    completionTokens,
    totalTokens,
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim()
  )
}

function countBullets(text: string) {
  const matches = String(text || "").match(/(^|\n)\s*(?:[-*]|\d+\.)\s+/g)
  return matches ? matches.length : 0
}

function hasNoEvidenceDisclosure(text: string) {
  const n = normalizeText(text)
  if (!n) return false
  const signals = [
    "sin respaldo",
    "sin evidencia",
    "no se encuentra",
    "no encuentro fuentes",
    "orientacion sin respaldo documental",
    "no hay evidencia",
  ]
  return signals.some((signal) => n.includes(signal))
}

function overlapTokenCount(question: string, answer: string) {
  const qTokens = normalizeText(question)
    .split(" ")
    .filter(Boolean)
    .filter((x) => x.length >= 4)
    .slice(0, 12)
  if (!qTokens.length) return 0
  const answerNorm = normalizeText(answer)
  return qTokens.filter((token) => answerNorm.includes(token)).length
}

function scoreTurn(params: {
  question: QuestionSpec
  answer: string
  citationsTotal: number
  citationsSupported: number
  traceExists: boolean
  threadIdExists: boolean
}): TurnScore {
  const { question, answer, citationsTotal, citationsSupported } = params
  const answerNorm = normalizeText(answer)
  const overlap = overlapTokenCount(question.text, answer)
  const noEvidenceFlag = hasNoEvidenceDisclosure(answer)
  const validityRate = citationsTotal > 0 ? citationsSupported / citationsTotal : 0
  const bullets = countBullets(answer)

  let relevance = 0
  if (answer.length >= 90) relevance = 1
  if (answer.length >= 130 && overlap >= 2) relevance = 2

  let grounding = 0
  if (question.kind === "meta") {
    grounding = citationsTotal === 0 ? 2 : 1
  } else {
    const required = question.kind === "facts" ? 2 : 1
    if (citationsSupported >= required) grounding = 2
    else if (citationsSupported >= 1) grounding = 1
    else grounding = 0
  }

  let honesty = 0
  if (question.kind === "meta") {
    honesty = 2
  } else if (citationsTotal === 0) {
    honesty = noEvidenceFlag ? 2 : 0
  } else if (validityRate >= 1) {
    honesty = 2
  } else if (validityRate >= 0.5) {
    honesty = 1
  }

  let instruction = 1
  if (question.kind === "facts") {
    if (bullets >= 3 && bullets <= 6) instruction = 2
    else if (bullets <= 1) instruction = 0
  } else if (question.kind === "strategy") {
    if (bullets >= 2 && bullets <= 4) instruction = 2
    else if (answer.length < 80) instruction = 0
  } else if (question.kind === "specificity") {
    const mentionsHuawei = answerNorm.includes("huawei")
    const explicitExistsOrNot =
      answerNorm.includes("no existen") ||
      answerNorm.includes("no hay") ||
      answerNorm.includes("si existen") ||
      answerNorm.includes("no se encuentra")
    instruction = mentionsHuawei && explicitExistsOrNot ? 2 : 1
  } else if (question.kind === "meta") {
    instruction = answerNorm.includes("evidencia") || answerNorm.includes("citas") ? 2 : 1
  }

  const coherence = params.threadIdExists && params.traceExists ? 2 : params.threadIdExists ? 1 : 0

  const total = Number(((relevance + grounding + honesty + instruction + coherence) / 5).toFixed(2))

  return {
    relevance,
    grounding,
    honesty,
    instruction,
    coherence,
    total,
  }
}

function buildCookieHeader(jar: Map<string, string>) {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")
}

function applySetCookies(jar: Map<string, string>, setCookies: string[]) {
  for (const raw of setCookies) {
    const first = String(raw || "").split(";", 1)[0] || ""
    const idx = first.indexOf("=")
    if (idx <= 0) continue
    const name = first.slice(0, idx)
    const value = first.slice(idx + 1)
    if (!value) jar.delete(name)
    else jar.set(name, value)
  }
}

async function waitForApp(appUrl: string, timeoutMs = 45_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${appUrl}/login`, { method: "GET" })
      if (res.ok || res.status === 401 || res.status === 302) return true
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  return false
}

async function ensureE2eUser(params: {
  supabaseUrl: string
  serviceKey: string
  email: string
  password: string
}) {
  const admin = createClient(params.supabaseUrl, params.serviceKey)
  const usersResp = await admin.auth.admin.listUsers({ page: 1, perPage: 800 })
  if (usersResp.error) throw usersResp.error

  const existing = (usersResp.data?.users || []).find(
    (u: any) => String(u.email || "").toLowerCase() === params.email.toLowerCase()
  )

  if (existing?.id) {
    const upd = await admin.auth.admin.updateUserById(existing.id, {
      password: params.password,
      email_confirm: true,
    })
    if (upd.error) throw upd.error
    return { id: String(existing.id), created: false }
  }

  const create = await admin.auth.admin.createUser({
    email: params.email,
    password: params.password,
    email_confirm: true,
    user_metadata: { e2e: true },
  })

  if (create.error || !create.data.user?.id) {
    throw create.error || new Error("No se pudo crear usuario e2e")
  }

  return { id: String(create.data.user.id), created: true }
}

async function createSessionCookieJar(params: { email: string; password: string }) {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim()
  const anonKey = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim()
  if (!supabaseUrl || !anonKey) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY")
  }

  const jar = new Map<string, string>()
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return Array.from(jar.entries()).map(([name, value]) => ({ name, value }))
      },
      setAll(cookiesToSet) {
        for (const c of cookiesToSet) {
          if (c.value) jar.set(c.name, c.value)
          else jar.delete(c.name)
        }
      },
    },
  })

  const { error } = await supabase.auth.signInWithPassword({
    email: params.email,
    password: params.password,
  })
  if (error) throw new Error(`signIn failed: ${error.message}`)
  if (!buildCookieHeader(jar)) throw new Error("No se generaron cookies de sesion")
  return jar
}

async function httpJson(params: {
  baseUrl: string
  jar: Map<string, string>
  method: "GET" | "POST"
  path: string
  body?: any
}) {
  const headers: Record<string, string> = { accept: "application/json" }
  const cookieHeader = buildCookieHeader(params.jar)
  if (cookieHeader) headers.cookie = cookieHeader
  if (typeof params.body !== "undefined") headers["content-type"] = "application/json"

  const res = await fetch(`${params.baseUrl}${params.path}`, {
    method: params.method,
    headers,
    body: typeof params.body !== "undefined" ? JSON.stringify(params.body) : undefined,
    redirect: "manual",
  })

  const setCookies = (res.headers as any).getSetCookie?.() as string[] | undefined
  if (Array.isArray(setCookies) && setCookies.length) {
    applySetCookies(params.jar, setCookies)
  }

  const text = await res.text()
  const json = (() => {
    try {
      return text ? JSON.parse(text) : null
    } catch {
      return null
    }
  })()

  return { status: res.status, ok: res.ok, json, text }
}

async function main() {
  const started = Date.now()
  const args = parseArgs(process.argv.slice(2))

  const workspaceId = String(args["workspace-id"] || process.argv[2] || "").trim()
  if (!workspaceId || workspaceId.startsWith("--")) {
    throw new Error("Uso: tsx scripts/qa-chat-session4.ts <workspaceId> [--app-url http://localhost:9002]")
  }

  const appUrl = String(args["app-url"] || process.env.E2E_APP_URL || "http://localhost:9002")
    .trim()
    .replace(/\/+$/, "")
  const reportDir = path.resolve(args["report-dir"] || path.resolve(process.cwd(), "reports"))
  const responseProfile = String(args["response-profile"] || "fast").trim().toLowerCase()
  const maxQuestions = Math.max(1, Math.min(4, Number(args["max-questions"] || 4) || 4))
  const profile: "auto" | "fast" | "balanced" | "deep" =
    responseProfile === "balanced" || responseProfile === "deep" || responseProfile === "auto"
      ? (responseProfile as any)
      : "fast"

  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Faltan SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY")
  }

  const e2eEmail = String(process.env.E2E_USER_EMAIL || "e2e.proyectos@local.test").trim()
  const e2ePassword = String(process.env.E2E_USER_PASSWORD || "E2E_Proyecto_2026!").trim()

  const appReady = await waitForApp(appUrl, 45_000)
  if (!appReady) {
    throw new Error(`La app no responde en ${appUrl}. Inicia 'npm run dev' y reintenta.`)
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const user = await ensureE2eUser({
    supabaseUrl,
    serviceKey,
    email: e2eEmail,
    password: e2ePassword,
  })

  const jar = await createSessionCookieJar({ email: e2eEmail, password: e2ePassword })

  const { data: workspaceMember, error: memberErr } = await admin
    .from("gob_workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (memberErr) throw new Error(memberErr.message)
  if (!workspaceMember) throw new Error(`Usuario E2E no es miembro de workspace ${workspaceId}`)

  const { data: sourceRows, error: sourceErr } = await admin
    .from("gob_sources")
    .select("id,title,filename,status,source_origin,created_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(20)

  if (sourceErr) throw new Error(sourceErr.message)

  const claimSource = (sourceRows || []).find((row: any) => String(row.source_origin || "") === "onboarding-claim") ||
    (sourceRows || [])[0] ||
    null
  const claimSourceId = claimSource?.id ? String(claimSource.id) : null

  const questionCatalog: QuestionSpec[] = [
    {
      id: "Q1",
      kind: "meta",
      text: "Antes de comenzar, ¿qué puedes hacer en este expediente y cómo manejas respuestas sin evidencia?",
      useClaimSource: false,
    },
    {
      id: "Q2",
      kind: "facts",
      text: "Con base en la reclamación adjunta, resume en máximo 5 bullets los hechos centrales y cita al menos 2 fragmentos textuales.",
      useClaimSource: true,
    },
    {
      id: "Q3",
      kind: "strategy",
      text: "Propón hasta 3 líneas de defensa priorizadas para este caso ante SMA, indicando para cada una: riesgo y sustento documental disponible.",
      useClaimSource: false,
    },
    {
      id: "Q4",
      kind: "specificity",
      text: "¿Existen precedentes específicos de Huawei en las fuentes disponibles? Si no existen, indícalo explícitamente y sugiere qué documentación falta cargar.",
      useClaimSource: false,
    },
  ]
  const questions: QuestionSpec[] = questionCatalog.slice(0, maxQuestions)

  let apiCalls = 0
  let dbReads = 0
  let maxRss = process.memoryUsage().rss

  const threadTitle = `QA Chat Session 4 ${nowCompact()}`
  apiCalls += 1
  const createThread = await httpJson({
    baseUrl: appUrl,
    jar,
    method: "POST",
    path: `/api/workspaces/${workspaceId}/threads`,
    body: {
      title: threadTitle,
      purpose: "Sesion QA chat costo-controlado (4 preguntas)",
      mode: "resolution",
    },
  })

  if (!createThread.ok || !createThread.json?.id) {
    throw new Error(`No se pudo crear thread: ${createThread.status} ${safeText(createThread.text, 400)}`)
  }

  const threadId = String(createThread.json.id)

  const turns: any[] = []

  for (const q of questions) {
    const payload = {
      threadId,
      question: q.text,
      mode: "resolution",
      responseProfile: profile,
      sourceId: q.useClaimSource ? claimSourceId || undefined : undefined,
    }

    const sentAt = Date.now()
    apiCalls += 1
    const res = await httpJson({
      baseUrl: appUrl,
      jar,
      method: "POST",
      path: `/api/workspaces/${workspaceId}/chat`,
      body: payload,
    })
    const latencyMs = Date.now() - sentAt

    if (!res.ok) {
      turns.push({
        id: q.id,
        kind: q.kind,
        question: q.text,
        status: "error",
        httpStatus: res.status,
        error: safeText(res.json?.error || res.text || "chat_request_failed", 380),
        latencyMs,
      })
      maxRss = Math.max(maxRss, process.memoryUsage().rss)
      continue
    }

    const userMessageId = String(res.json?.userMessage?.id || "")
    const assistantMessageId = String(res.json?.assistantMessage?.id || "")

    dbReads += 1
    const { data: assistantRow, error: assistantErr } = await admin
      .from("gob_chat_messages")
      .select("id,content,citations,usage,model,created_at")
      .eq("id", assistantMessageId)
      .maybeSingle()

    if (assistantErr) throw new Error(assistantErr.message)

    const answer = String(assistantRow?.content || "")
    const citations = Array.isArray(assistantRow?.citations) ? assistantRow.citations : []

    const citationChunkIds = Array.from(
      new Set(
        citations
          .map((c: any) => String(c?.chunkId || "").trim())
          .filter(Boolean)
      )
    )

    const citationUuidChunkIds = citationChunkIds.filter((id) => isUuid(id))

    const chunkById = new Map<string, string>()
    if (citationUuidChunkIds.length) {
      dbReads += 1
      const { data: chunkRows, error: chunkErr } = await admin
        .from("gob_chunks")
        .select("id,content")
        .in("id", citationUuidChunkIds)

      if (chunkErr) throw new Error(chunkErr.message)
      for (const row of chunkRows || []) {
        chunkById.set(String((row as any).id), String((row as any).content || ""))
      }
    }

    let citationsVerified = 0
    let citationsUnverifiable = 0
    for (const cite of citations) {
      const chunkId = String((cite as any)?.chunkId || "")
      const quote = String((cite as any)?.quote || "")
      if (!quote) continue

      if (!isUuid(chunkId)) {
        if (quote.trim().length >= 12) {
          citationsUnverifiable += 1
        }
        continue
      }

      const chunkText = chunkById.get(chunkId) || ""
      if (!chunkText) continue
      const has = normalizeText(chunkText).includes(normalizeText(quote))
      if (has) citationsVerified += 1
    }
    const citationsSupported = citationsVerified + citationsUnverifiable

    dbReads += 1
    const { data: traceRow, error: traceErr } = await admin
      .from("gob_rag_retrieval_traces")
      .select("id,provider,query,model,response_id,metadata,results,created_at,message_id")
      .eq("workspace_id", workspaceId)
      .eq("stage", "chat")
      .eq("message_id", userMessageId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (traceErr) throw new Error(traceErr.message)

    const usage = parseUsage(assistantRow?.usage || null)
    const score = scoreTurn({
      question: q,
      answer,
      citationsTotal: citations.length,
      citationsSupported,
      traceExists: Boolean(traceRow?.id),
      threadIdExists: Boolean(threadId),
    })

    const issues: string[] = []
    if (q.kind !== "meta" && citations.length === 0 && !hasNoEvidenceDisclosure(answer)) {
      issues.push("Sin citas y sin advertencia explícita de falta de evidencia")
    }
    if (citations.length > 0 && citationsSupported < citations.length) {
      issues.push(`Citas no sustentadas: ${citations.length - citationsSupported}/${citations.length}`)
    }
    if (Number((traceRow as any)?.metadata?.total_ms || 0) > 45_000) {
      issues.push("Latencia alta (>45s)")
    }

    turns.push({
      id: q.id,
      kind: q.kind,
      question: q.text,
      status: "ok",
      httpStatus: res.status,
      latencyMs,
      messageIds: {
        user: userMessageId,
        assistant: assistantMessageId,
      },
      answerPreview: safeText(answer, 520),
      answerLength: answer.length,
      citationsTotal: citations.length,
      citationsVerified,
      citationsUnverifiable,
      citationsSupported,
      citationValidityRate:
        citations.length > 0 ? Number((citationsSupported / citations.length).toFixed(3)) : null,
      noEvidenceDisclosure: hasNoEvidenceDisclosure(answer),
      usage,
      assistantModel: assistantRow?.model ? String(assistantRow.model) : null,
      retrievalTrace: traceRow
        ? {
            id: String(traceRow.id),
            provider: String(traceRow.provider || ""),
            model: traceRow.model ? String(traceRow.model) : null,
            responseId: traceRow.response_id ? String(traceRow.response_id) : null,
            evidenceCount: Number((traceRow as any)?.metadata?.evidence_count || 0),
            retrievalMs: Number((traceRow as any)?.metadata?.retrieval_ms || 0),
            generationMs: Number((traceRow as any)?.metadata?.generation_ms || 0),
            totalMs: Number((traceRow as any)?.metadata?.total_ms || 0),
            retrievalCoverageBefore: Number((traceRow as any)?.metadata?.retrieval_coverage_before || 0),
            retrievalCoverageAfter: Number((traceRow as any)?.metadata?.retrieval_coverage_after || 0),
            retrievalDeepened: Boolean((traceRow as any)?.metadata?.retrieval_deepened),
            retrievalRerankApplied: Boolean((traceRow as any)?.metadata?.retrieval_rerank_applied),
            retrievalExpandedScope: Boolean((traceRow as any)?.metadata?.retrieval_expanded_scope),
          }
        : null,
      score,
      issues,
    })

    maxRss = Math.max(maxRss, process.memoryUsage().rss)
  }

  const okTurns = turns.filter((turn) => turn.status === "ok")
  const tokenTotals = okTurns.reduce(
    (acc, turn) => {
      acc.prompt += Number(turn.usage?.promptTokens || 0)
      acc.completion += Number(turn.usage?.completionTokens || 0)
      acc.total += Number(turn.usage?.totalTokens || 0)
      return acc
    },
    { prompt: 0, completion: 0, total: 0 }
  )

  const avgScore =
    okTurns.length > 0
      ? Number(
          (
            okTurns.reduce((acc, turn) => acc + Number(turn.score?.total || 0), 0) /
            Math.max(1, okTurns.length)
          ).toFixed(2)
        )
      : 0

  const totalCitations = okTurns.reduce((acc, turn) => acc + Number(turn.citationsTotal || 0), 0)
  const totalVerifiedCitations = okTurns.reduce((acc, turn) => acc + Number(turn.citationsVerified || 0), 0)
  const totalSupportedCitations = okTurns.reduce((acc, turn) => acc + Number(turn.citationsSupported || 0), 0)
  const unsupportedCitations = Math.max(0, totalCitations - totalSupportedCitations)

  const totalTraceMs = okTurns.reduce(
    (acc, turn) => acc + Number(turn.retrievalTrace?.totalMs || 0),
    0
  )

  dbReads += 1
  const { data: auditRows, error: auditErr } = await admin
    .from("gob_audit_logs")
    .select("id,timestamp,details")
    .eq("action", "chat.ask")
    .filter("details->>thread_id", "eq", threadId)
    .order("timestamp", { ascending: true })

  if (auditErr) throw new Error(auditErr.message)

  const auditMetrics = (auditRows || []).reduce(
    (acc, row: any) => {
      const details = row?.details && typeof row.details === "object" ? row.details : {}
      acc.turns += 1
      acc.retrievalMs += Number(details?.retrieval_ms || 0)
      acc.generationMs += Number(details?.generation_ms || 0)
      acc.totalMs += Number(details?.total_ms || 0)
      acc.answerTokens += Number(details?.answer_tokens || 0)
      return acc
    },
    { turns: 0, retrievalMs: 0, generationMs: 0, totalMs: 0, answerTokens: 0 }
  )

  const summary = {
    action: "qa_chat_session4",
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    appUrl,
    workspaceId,
    threadId,
    responseProfile: profile,
    maxQuestions,
    claimSource: claimSource
      ? {
          id: String(claimSource.id),
          title: String(claimSource.title || claimSource.filename || "Documento"),
          status: String(claimSource.status || ""),
        }
      : null,
    resources: {
      apiCalls,
      dbReads,
      maxRssMb: Number((maxRss / (1024 * 1024)).toFixed(2)),
      tokens: tokenTotals,
      traceTotalMs: totalTraceMs,
      audit: auditMetrics,
    },
    quality: {
      turns: turns.length,
      okTurns: okTurns.length,
      avgScore,
      totalCitations,
      totalVerifiedCitations,
      totalSupportedCitations,
      unsupportedCitations,
    },
    turns,
  }

  fs.mkdirSync(reportDir, { recursive: true })
  const stamp = nowCompact()
  const jsonPath = path.resolve(reportDir, `qa_chat_session4_${stamp}.json`)
  const mdPath = path.resolve(reportDir, `qa_chat_session4_${stamp}.md`)

  const md: string[] = []
  md.push("# QA Chat - Sesion 4")
  md.push("")
  md.push(`- Workspace: ${workspaceId}`)
  md.push(`- Thread: ${threadId}`)
  md.push(`- Perfil respuesta: ${profile}`)
  md.push(`- Duracion total: ${(summary.durationMs / 1000).toFixed(1)}s`)
  md.push(`- Tokens totales (chat): ${tokenTotals.total} (prompt ${tokenTotals.prompt} / completion ${tokenTotals.completion})`)
  md.push(`- Llamadas API: ${apiCalls} | Lecturas DB: ${dbReads}`)
  md.push(
    `- Tiempos audit chat.ask: retrieval ${auditMetrics.retrievalMs}ms | generation ${auditMetrics.generationMs}ms | total ${auditMetrics.totalMs}ms`
  )
  md.push(`- Score promedio: ${avgScore}/2`)
  md.push(`- Citas soportadas: ${totalSupportedCitations}/${totalCitations} (verificadas en DB: ${totalVerifiedCitations})`)
  md.push("")
  md.push("## Resultado por pregunta")

  for (const turn of turns) {
    md.push("")
    md.push(`### ${turn.id} (${turn.kind})`)
    md.push(`- Estado: ${turn.status}`)
    md.push(`- Pregunta: ${turn.question}`)
    if (turn.status !== "ok") {
      md.push(`- Error: ${turn.error}`)
      continue
    }
    md.push(`- Score: ${turn.score.total}/2`) 
    md.push(`- Citas: ${turn.citationsSupported}/${turn.citationsTotal} soportadas (${turn.citationsVerified} verificadas + ${turn.citationsUnverifiable} no verificables en DB)`) 
    md.push(`- Tokens: ${turn.usage.totalTokens} (prompt ${turn.usage.promptTokens} / completion ${turn.usage.completionTokens})`)
    md.push(`- Trace: provider ${turn.retrievalTrace?.provider || "N/A"}, evidence ${turn.retrievalTrace?.evidenceCount ?? 0}, total_ms ${turn.retrievalTrace?.totalMs ?? 0}`)
    md.push(`- Respuesta (preview): ${safeText(turn.answerPreview, 460)}`)
    if (Array.isArray(turn.issues) && turn.issues.length) {
      md.push(`- Observaciones: ${turn.issues.join(" | ")}`)
    }
  }

  const improvementHints: string[] = []
  if (unsupportedCitations > 0) {
    improvementHints.push("Reforzar consistencia de citas para reducir referencias sin soporte verificable.")
  }
  if (okTurns.some((turn) => Number(turn.retrievalTrace?.totalMs || 0) > 45_000)) {
    improvementHints.push("Reducir latencia en preguntas complejas (ajustar max query variants y deep retrieval).")
  }
  if (okTurns.some((turn) => turn.kind !== "meta" && turn.citationsTotal === 0 && !turn.noEvidenceDisclosure)) {
    improvementHints.push("Forzar disclaimer de falta de evidencia cuando no hay citas validas.")
  }
  if (!improvementHints.length) {
    improvementHints.push("Sin hallazgos criticos: mantener monitoreo de costo (tokens) y latencia por sesion.")
  }

  md.push("")
  md.push("## Mejoras recomendadas")
  for (const hint of improvementHints) {
    md.push(`- ${hint}`)
  }

  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), "utf8")
  fs.writeFileSync(mdPath, md.join("\n"), "utf8")

  console.log(`Reporte JSON: ${jsonPath}`)
  console.log(`Reporte MD: ${mdPath}`)
  console.log(
    JSON.stringify(
      {
        workspaceId,
        threadId,
        turns: turns.length,
        okTurns: okTurns.length,
        score: avgScore,
        tokens: tokenTotals,
        apiCalls,
        dbReads,
      },
      null,
      2
    )
  )
}

main().catch((err) => {
  console.error(`qa-chat-session4 failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
