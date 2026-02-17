import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { getRagProvider } from "@/lib/env"
import { retrieveLocalEvidenceForQuestion } from "@/lib/rag/local-retrieval"
import {
  isHybridRagMode,
  listKnowledgeBasesForWorkspaces,
  mapResultsToEvidence,
  searchKnowledgeBaseWithFileSearch,
  shouldUseManagedRetrieval,
} from "@/lib/rag/openai-managed"
import { getAccessibleWorkspaceIdsForUser } from "@/lib/workspaces/access"
import { recordRetrievalTrace } from "@/lib/rag/retrieval-trace"
import {
  generateStrictAnswer,
  type AnswerResponseProfile,
  type EvidenceChunk,
  type QuestionDifficulty,
} from "@/lib/rag/strict-answer"

const RetrievalFiltersSchema = z
  .object({
    docTypes: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    regions: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
    sectors: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
    sourceOrigins: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
    languages: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
    projectNames: z.array(z.string().trim().min(1).max(200)).max(12).optional(),
    snapshotIds: z.array(z.string().uuid()).max(30).optional(),
    yearFrom: z.number().int().min(1900).max(2200).optional(),
    yearTo: z.number().int().min(1900).max(2200).optional(),
  })
  .strict()

const AskSchema = z.object({
  question: z.string().trim().min(3).max(4000),
  threadId: z.string().uuid().nullable().optional(),
  mode: z.enum(["extractive", "comparison", "checklist", "resolution"]).optional(),
  responseProfile: z.enum(["auto", "fast", "balanced", "deep"]).optional(),
  filters: RetrievalFiltersSchema.nullish(),
})

const CHITCHAT_WORDS = new Set([
  "hola",
  "holi",
  "hi",
  "hello",
  "hey",
  "buenas",
  "buenos",
  "dias",
  "tardes",
  "noches",
  "gracias",
  "thanks",
  "ok",
  "okay",
  "dale",
  "perfecto",
  "listo",
  "como",
  "estas",
  "que",
  "tal",
])

function normalizeIntentText(input: string) {
  return String(input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[!?.,;:()[\]{}"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function isSmallTalkQuestion(input: string) {
  const normalized = normalizeIntentText(input)
  if (!normalized) return false
  const words = normalized.split(" ").filter(Boolean)
  if (!words.length || words.length > 5) return false
  const meaningful = words.filter((w) => !CHITCHAT_WORDS.has(w))
  return meaningful.length === 0
}

function defaultRetrievalProvider(): "local" | "openai" | "hybrid" {
  const provider = getRagProvider()
  if (provider === "openai") return "openai"
  if (provider === "hybrid") return "hybrid"
  return "local"
}

type ResolvedResponseProfile = Exclude<AnswerResponseProfile, "auto">

function classifyQuestionDifficulty(
  question: string,
  mode: "extractive" | "comparison" | "checklist" | "resolution"
): QuestionDifficulty {
  const q = normalizeIntentText(question)
  const words = q.split(" ").filter(Boolean)

  let score = 0
  if (words.length >= 18) score += 1
  if (words.length >= 30) score += 1
  if (mode === "comparison" || mode === "checklist" || mode === "resolution") score += 2

  const complexSignals = [
    "compara",
    "comparar",
    "diferencias",
    "similitudes",
    "enumera",
    "lista",
    "paso a paso",
    "analiza",
    "evalua",
    "riesgos",
    "mitigaciones",
    "prioriza",
    "justifica",
  ]

  const simpleSignals = [
    "que es",
    "define",
    "resumen corto",
    "hola",
    "gracias",
  ]

  for (const s of complexSignals) {
    if (q.includes(s)) score += 1
  }
  for (const s of simpleSignals) {
    if (q.includes(s)) score -= 1
  }

  if (score <= 1) return "simple"
  if (score >= 4) return "complex"
  return "medium"
}

function resolveResponseProfile(
  requested: AnswerResponseProfile,
  difficulty: QuestionDifficulty
): ResolvedResponseProfile {
  if (requested === "fast" || requested === "balanced" || requested === "deep") {
    return requested
  }
  if (difficulty === "simple") return "fast"
  if (difficulty === "complex") return "deep"
  return "balanced"
}

function retrievalProfile(
  mode: "extractive" | "comparison" | "checklist" | "resolution",
  responseProfile: ResolvedResponseProfile,
  difficulty: QuestionDifficulty
) {
  if (mode === "checklist") {
    const base = { maxResults: 16, scoreThreshold: 0.08 }
    if (responseProfile === "fast") return { maxResults: 12, scoreThreshold: 0.12 }
    if (responseProfile === "deep" || difficulty === "complex") {
      return { maxResults: 22, scoreThreshold: 0.05 }
    }
    return base
  }
  if (mode === "comparison") {
    const base = { maxResults: 14, scoreThreshold: 0.1 }
    if (responseProfile === "fast") return { maxResults: 10, scoreThreshold: 0.13 }
    if (responseProfile === "deep" || difficulty === "complex") {
      return { maxResults: 18, scoreThreshold: 0.07 }
    }
    return base
  }
  if (mode === "resolution") {
    const base = { maxResults: 12, scoreThreshold: 0.12 }
    if (responseProfile === "fast") return { maxResults: 9, scoreThreshold: 0.16 }
    if (responseProfile === "deep" || difficulty === "complex") {
      return { maxResults: 16, scoreThreshold: 0.09 }
    }
    return base
  }
  if (responseProfile === "fast") return { maxResults: 7, scoreThreshold: 0.18 }
  if (responseProfile === "deep" || difficulty === "complex") {
    return { maxResults: 12, scoreThreshold: 0.12 }
  }
  return { maxResults: 10, scoreThreshold: 0.15 }
}

function usageTotalTokens(usage: any): number | null {
  if (!usage || typeof usage !== "object") return null
  const direct = (usage as any).total_tokens
  if (typeof direct === "number" && Number.isFinite(direct)) return Math.floor(direct)
  const nested = (usage as any).totalTokens
  if (typeof nested === "number" && Number.isFinite(nested)) return Math.floor(nested)
  return null
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const url = new URL(request.url)
  const threadIdRaw = (url.searchParams.get("threadId") || "").trim()
  const threadId = threadIdRaw && threadIdRaw !== "legacy" ? threadIdRaw : null

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let q = supabase
    .from("gob_chat_messages")
    .select("id,role,content,created_at,citations")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true })
    .limit(80)

  q = threadId ? q.eq("thread_id", threadId) : q.is("thread_id", null)

  const { data: messages, error } = await q

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ messages: messages ?? [] })
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
  if (member.role === "viewer") {
    return NextResponse.json({ error: "Read-only role" }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = AskSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const now = new Date().toISOString()
  const requestStartedAt = Date.now()
  const question = parsed.data.question
  const threadId = parsed.data.threadId ?? null
  const requestedResponseProfile: AnswerResponseProfile = parsed.data.responseProfile ?? "auto"
  const retrievalFilters = parsed.data.filters ?? null
  let retrievalElapsedMs = 0
  let generationElapsedMs = 0

  let effectiveMode: "extractive" | "comparison" | "checklist" | "resolution" =
    parsed.data.mode ?? "extractive"

  if (threadId) {
    const { data: thread } = await supabase
      .from("gob_chat_threads")
      .select("id,mode")
      .eq("id", threadId)
      .eq("workspace_id", workspaceId)
      .maybeSingle()

    if (!thread) {
      return NextResponse.json({ error: "Invalid thread" }, { status: 400 })
    }

    if (!parsed.data.mode && thread.mode) {
      effectiveMode = thread.mode
    }
  }

  const questionDifficulty = classifyQuestionDifficulty(question, effectiveMode)
  const resolvedResponseProfile = resolveResponseProfile(
    requestedResponseProfile,
    questionDifficulty
  )

  const { data: userMessage, error: umErr } = await supabase
    .from("gob_chat_messages")
    .insert({
      thread_id: threadId,
      workspace_id: workspaceId,
      role: "user",
      content: question,
      created_at: now,
      created_by: user.id,
    })
    .select("id,role,content,created_at,citations")
    .single()

  if (umErr) return NextResponse.json({ error: umErr.message }, { status: 500 })

  if (isSmallTalkQuestion(question)) {
    const assistantText =
      "Hola. Puedo ayudarte con preguntas sobre las fuentes del proyecto. Prueba, por ejemplo: 'Resume los 6 modulos principales' o 'Que dice el documento sobre auto-entrenamiento continuo?'."

    await recordRetrievalTrace({
      supabase,
      workspaceId,
      stage: "chat",
      provider: defaultRetrievalProvider(),
      query: question,
      filters: retrievalFilters,
      results: [],
      responseId: null,
      model: null,
      createdBy: user.id,
      threadId,
      messageId: userMessage.id,
      metadata: {
        mode: effectiveMode,
        response_profile_requested: requestedResponseProfile,
        response_profile_resolved: resolvedResponseProfile,
        question_difficulty: questionDifficulty,
        evidence_count: 0,
        skip_reason: "smalltalk",
        retrieval_ms: 0,
      },
    }).catch(() => null)

    const { data: assistantMessage, error: amErr } = await supabase
      .from("gob_chat_messages")
      .insert({
        thread_id: threadId,
        workspace_id: workspaceId,
        role: "assistant",
        content: assistantText,
        citations: [],
        created_at: new Date().toISOString(),
        model: null,
        usage: null,
      })
      .select("id,role,content,created_at,citations")
      .single()

    if (amErr) return NextResponse.json({ error: amErr.message }, { status: 500 })

    if (threadId) {
      await supabase
        .from("gob_chat_threads")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", threadId)
        .eq("workspace_id", workspaceId)
    }

    await supabase.from("gob_audit_logs").insert({
      user_id: user.id,
      action: "chat.ask",
      target_resource: "gob_chat_messages",
      details: {
        workspace_id: workspaceId,
        thread_id: threadId,
        mode: effectiveMode,
        question,
        retrieval_provider: defaultRetrievalProvider(),
        retrieval_response_id: null,
        retrieval_model: null,
        retrieval_filters: retrievalFilters,
        evidence_count: 0,
        cited_chunks: [],
        intent: "smalltalk",
        response_profile_requested: requestedResponseProfile,
        response_profile_resolved: resolvedResponseProfile,
        question_difficulty: questionDifficulty,
      },
      timestamp: now,
    })

    return NextResponse.json({ userMessage, assistantMessage })
  }

  // Retrieve evidence (OpenAI managed + optional local fallback)
  let evidence: EvidenceChunk[] = []
  let retrievalProvider: "local" | "openai" | "hybrid" = defaultRetrievalProvider()
  let retrievalResponseId: string | null = null
  let retrievalModel: string | null = null
  const traceResults: any[] = []
  const profile = retrievalProfile(effectiveMode, resolvedResponseProfile, questionDifficulty)
  const retrievalStartedAt = Date.now()

  try {
    let managedEvidence: EvidenceChunk[] = []
    let usedManaged = false

    let retrievalWorkspaceIds = [workspaceId]
    try {
      retrievalWorkspaceIds = await getAccessibleWorkspaceIdsForUser({
        supabase,
        userId: user.id,
        requiredWorkspaceId: workspaceId,
      })
    } catch {
      retrievalWorkspaceIds = [workspaceId]
    }

    if (shouldUseManagedRetrieval()) {
      const kbs = await listKnowledgeBasesForWorkspaces({
        supabase,
        workspaceIds: retrievalWorkspaceIds,
      }).catch(() => [])

      if (kbs.length > 0) {
        const responseIds: string[] = []
        const models: string[] = []

        for (const kb of kbs) {
          const managed = await searchKnowledgeBaseWithFileSearch({
            vectorStoreId: kb.vectorStoreId,
            query: question,
            filters: retrievalFilters,
            maxResults: profile.maxResults,
            scoreThreshold: profile.scoreThreshold,
          })

          if (managed.responseId) responseIds.push(String(managed.responseId))
          if (managed.model) models.push(String(managed.model))

          const mapped = await mapResultsToEvidence({
            supabase,
            workspaceIds: retrievalWorkspaceIds,
            results: managed.results,
          })

          for (const row of mapped as any[]) {
            managedEvidence.push({
              chunkId: String(row.chunkId),
              content: String(row.content ?? ""),
              sourceUrl: row.sourceUrl ? String(row.sourceUrl) : null,
              snapshotId: row.snapshotId ? String(row.snapshotId) : null,
              page: typeof row.page === "number" ? row.page : null,
              section: row.section ? String(row.section) : null,
            })

            traceResults.push({
              chunkId: row.chunkId,
              content: row.content,
              sourceUrl: row.sourceUrl,
              snapshotId: row.snapshotId,
              page: row.page,
              section: row.section,
              ...(row._meta || {}),
              kb_workspace_id: kb.workspaceId,
            })
          }
        }

        retrievalResponseId = responseIds.length ? responseIds[0] : null
        retrievalModel = models.length ? models[0] : null

        if (managedEvidence.length > 0) {
          const dedup = new Map<string, EvidenceChunk>()
          for (const row of managedEvidence) {
            if (!row.chunkId) continue
            if (!dedup.has(row.chunkId)) {
              dedup.set(row.chunkId, row)
            }
          }

          evidence = Array.from(dedup.values()).slice(0, Math.max(10, profile.maxResults * 2))
          retrievalProvider = "openai"
          usedManaged = true
        }
      }
    }

    const fallbackToLocal =
      evidence.length < 6 && retrievalProvider !== "openai" && (isHybridRagMode() || !usedManaged)
    if (fallbackToLocal) {
      const localEvidence = await retrieveLocalEvidenceForQuestion({
        supabase,
        workspaceIds: retrievalWorkspaceIds,
        question,
        matchCount: Math.max(8, Math.min(20, profile.maxResults)),
        minSimilarity: 0.25,
        textMatchCount: Math.max(10, Math.min(24, profile.maxResults + 4)),
      })

      if (usedManaged) {
        const seen = new Set(evidence.map((e) => e.chunkId))
        for (const row of localEvidence) {
          if (seen.has(row.chunkId)) continue
          seen.add(row.chunkId)
          evidence.push(row)
        }
        if (localEvidence.length > 0) retrievalProvider = "hybrid"
      } else {
        evidence = localEvidence
        retrievalProvider = "local"
      }

      for (const row of localEvidence) {
        traceResults.push({
          chunkId: row.chunkId,
          content: row.content,
          sourceUrl: row.sourceUrl,
          snapshotId: row.snapshotId,
          page: row.page,
          section: row.section,
        })
      }
    }
  } catch {
    evidence = []
  } finally {
    retrievalElapsedMs = Date.now() - retrievalStartedAt
  }

  await recordRetrievalTrace({
    supabase,
    workspaceId,
    stage: "chat",
    provider: retrievalProvider,
    query: question,
    filters: retrievalFilters,
    results: traceResults,
    responseId: retrievalResponseId,
    model: retrievalModel,
    createdBy: user.id,
    threadId,
    messageId: userMessage.id,
    metadata: {
      mode: effectiveMode,
      response_profile_requested: requestedResponseProfile,
      response_profile_resolved: resolvedResponseProfile,
      question_difficulty: questionDifficulty,
      evidence_count: evidence.length,
      retrieval_ms: retrievalElapsedMs,
      retrieval_profile: profile,
      source_scope: "member_workspaces",
    },
  }).catch(() => null)

  let assistantText = "No se encuentra en las fuentes disponibles."
  let citations: any[] = []
  let generationError: string | null = null

  let model: string | null = null
  let usage: any = null

  if (evidence.length > 0) {
    const generationStartedAt = Date.now()
    try {
      const out = await generateStrictAnswer({
        question,
        evidence,
        mode: effectiveMode,
        responseProfile: resolvedResponseProfile,
        difficulty: questionDifficulty,
      })
      generationElapsedMs = Date.now() - generationStartedAt
      assistantText = out.answer
      model = out.model ?? null
      usage = out.usage ?? null
      const evidenceById = new Map(evidence.map((e) => [e.chunkId, e]))
      citations = out.citations.map((c: any) => {
        const meta = evidenceById.get(c.chunkId)
        return {
          chunkId: c.chunkId,
          quote: c.quote,
          paragraph: typeof c.paragraph === "number" ? c.paragraph : null,
          sourceUrl: meta?.sourceUrl ?? null,
          snapshotId: meta?.snapshotId ?? null,
          page: meta?.page ?? null,
          section: meta?.section ?? null,
        }
      })
    } catch (err: any) {
      generationElapsedMs = Date.now() - generationStartedAt
      generationError = err?.message ?? String(err)
      assistantText =
        "Tu consulta fue recibida, pero hubo un problema interno al generar la respuesta. Intenta nuevamente o cambia el perfil a 'Rapida'."
      citations = []
      model = null
      usage = null
    }
  } else {
    generationElapsedMs = 0
  }

  const { data: assistantMessage, error: amErr } = await supabase
    .from("gob_chat_messages")
    .insert({
      thread_id: threadId,
      workspace_id: workspaceId,
      role: "assistant",
      content: assistantText,
      citations,
      created_at: new Date().toISOString(),
      model,
      usage,
    })
    .select("id,role,content,created_at,citations")
    .single()

  if (amErr) return NextResponse.json({ error: amErr.message }, { status: 500 })

  if (threadId) {
    await supabase
      .from("gob_chat_threads")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", threadId)
      .eq("workspace_id", workspaceId)
  }

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "chat.ask",
    target_resource: "gob_chat_messages",
    details: {
      workspace_id: workspaceId,
      thread_id: threadId,
      mode: effectiveMode,
      question,
      retrieval_provider: retrievalProvider,
      retrieval_response_id: retrievalResponseId,
      retrieval_model: retrievalModel,
      retrieval_filters: retrievalFilters,
      response_profile_requested: requestedResponseProfile,
      response_profile_resolved: resolvedResponseProfile,
      question_difficulty: questionDifficulty,
      retrieval_ms: retrievalElapsedMs,
      generation_ms: generationElapsedMs,
      total_ms: Date.now() - requestStartedAt,
      answer_model: model,
      answer_tokens: usageTotalTokens(usage),
        generation_error: generationError,
        evidence_count: evidence.length,
        cited_chunks: citations.map((c) => c.chunkId),
        source_scope: "member_workspaces",
      },
      timestamp: now,
    })

  return NextResponse.json({ userMessage, assistantMessage })
}
