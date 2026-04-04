import { NextResponse } from "next/server"
import { z } from "zod"

import { ai } from "@/ai/genkit"
import { generateOpenAIJson } from "@/lib/llm/openai-json"
import { loadPersistedOnboardingArtifacts } from "@/lib/onboarding/artifacts"
import { ensureTribunalCorpusWorkspace } from "@/lib/onboarding/tribunal-corpus"
import { buildStructuredOnboardingMemoryBlock, extractStructuredOnboardingMemoryFromMetadata } from "@/lib/onboarding/structured-memory"
import { resolveOpenAIReviewProfessionalModel } from "@/lib/openai-models"
import { loadReviewEvidenceContext, prioritizeReviewEvidence } from "@/lib/reviews/evidence-priority"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { loadLegalGraphContext } from "@/lib/tribunal/graph-retrieval"
import { getAccessibleWorkspaceIdsForUser } from "@/lib/workspaces/access"

const REVIEW_NOTE_PREFIX = "Revision profesional:"

const FocusSchema = z.enum(["evidence", "coherence", "strategy", "writing"])

const ProfessionalReviewRequestSchema = z
  .object({
    sourceId: z.string().uuid(),
    focus: z.array(FocusSchema).min(1).max(4).optional(),
    saveAsNote: z.boolean().optional(),
  })
  .strict()

const ReviewFindingSchema = z.object({
  id: z.string().default(""),
  title: z.string().default("Observacion"),
  severity: z.enum(["critical", "major", "minor"]).default("minor"),
  category: z.enum(["evidence", "coherence", "strategy", "writing"]).default("writing"),
  issue: z.string().default(""),
  recommendation: z.string().default(""),
  appliesTo: z.string().nullable().optional(),
  citations: z
    .array(
      z.object({
        chunkId: z.string(),
        quote: z.string(),
      })
    )
    .default([]),
})

const ReviewOutputSchema = z.object({
  summary: z.object({
    riskLevel: z.enum(["low", "medium", "high"]).default("medium"),
    verdict: z.string().default(""),
    strengths: z.array(z.string()).default([]),
    priorities: z.array(z.string()).default([]),
  }),
  findings: z.array(ReviewFindingSchema).default([]),
  checklist: z.array(z.string()).default([]),
})

const ReviewOutputJsonSchema = {
  type: "object",
  properties: {
    summary: {
      type: "object",
      properties: {
        riskLevel: {
          type: "string",
          enum: ["low", "medium", "high"],
        },
        verdict: { type: "string" },
        strengths: {
          type: "array",
          items: { type: "string" },
        },
        priorities: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["riskLevel", "verdict", "strengths", "priorities"],
      additionalProperties: false,
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          severity: {
            type: "string",
            enum: ["critical", "major", "minor"],
          },
          category: {
            type: "string",
            enum: ["evidence", "coherence", "strategy", "writing"],
          },
          issue: { type: "string" },
          recommendation: { type: "string" },
          appliesTo: { type: ["string", "null"] },
          citations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                chunkId: { type: "string" },
                quote: { type: "string" },
              },
              required: ["chunkId", "quote"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "id",
          "title",
          "severity",
          "category",
          "issue",
          "recommendation",
          "appliesTo",
          "citations",
        ],
        additionalProperties: false,
      },
    },
    checklist: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["summary", "findings", "checklist"],
  additionalProperties: false,
} as const

type Focus = z.infer<typeof FocusSchema>

type ReviewChunk = {
  chunkId: string
  content: string
  sourceUrl: string | null
  snapshotId: string | null
  page: number | null
  section: string | null
  origin: "reviewed_document" | "project_evidence"
  rank: number
}

const FOCUS_LABEL: Record<Focus, string> = {
  evidence: "Sustento probatorio",
  coherence: "Coherencia interna",
  strategy: "Estrategia argumental",
  writing: "Redaccion profesional",
}

const FOCUS_INSTRUCTIONS: Record<Focus, string> = {
  evidence:
    "Detecta afirmaciones relevantes sin respaldo verificable en evidencia. Prioriza observaciones con riesgo juridico.",
  coherence:
    "Detecta contradicciones de hechos, fechas, actores o conclusiones dentro del documento.",
  strategy:
    "Evalua si la linea argumental es util para defensa institucional y sugiere mejoras concretas.",
  writing:
    "Evalua claridad, precision, tono juridico y ambiguedades de redaccion.",
}

const STOPWORDS = new Set([
  "de",
  "la",
  "el",
  "y",
  "en",
  "que",
  "los",
  "las",
  "del",
  "por",
  "para",
  "con",
  "una",
  "un",
  "al",
  "se",
  "es",
  "no",
  "como",
  "sus",
  "entre",
  "sobre",
  "ante",
  "esta",
  "este",
  "esto",
  "segun",
  "tambien",
  "desde",
  "hasta",
  "contra",
  "informe",
  "documento",
])

function safeText(value: unknown, max = 300) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function normalizeText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function uniqueStrings(values: unknown[], max = 8) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = String(value ?? "").replace(/\s+/g, " ").trim()
    if (!clean) continue
    const key = normalizeText(clean)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(clean)
    if (out.length >= max) break
  }
  return out
}

function chunkRank(row: any) {
  const rank = typeof row?.rank === "number" ? row.rank : Number(row?.rank || 0)
  if (Number.isFinite(rank)) return rank
  return 0
}

function extractKeywords(text: string, max = 14) {
  const counts = new Map<string, number>()
  for (const token of normalizeText(text).split(" ")) {
    if (!token || token.length < 4) continue
    if (STOPWORDS.has(token)) continue
    const prev = counts.get(token) || 0
    counts.set(token, prev + 1)
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([token]) => token)
}

function quoteExistsInContent(content: string, quote: string) {
  const hay = normalizeText(content)
  const needle = normalizeText(quote)
  return needle.length >= 12 && hay.includes(needle)
}

function buildReviewQueries(params: { sourceTitle: string; documentText: string; focus: Focus[] }) {
  const { sourceTitle, documentText, focus } = params
  const keywords = extractKeywords(documentText, 12)
  const focusTerms = focus.map((f) => FOCUS_LABEL[f].toLowerCase())

  const q1 = safeText(`${sourceTitle} ${keywords.slice(0, 8).join(" ")}`, 280)
  const q2 = safeText(
    `${focusTerms.join(" ")} tribunal ambiental reclamacion evacua informe sentencia`,
    280
  )

  return Array.from(new Set([q1, q2].filter((q) => q.length >= 8))).slice(0, 2)
}

function renderReviewNoteContent(params: {
  sourceTitle: string
  generatedAt: string
  focus: Focus[]
  summary: {
    riskLevel: "low" | "medium" | "high"
    verdict: string
    strengths: string[]
    priorities: string[]
  }
  findings: Array<{
    title: string
    severity: "critical" | "major" | "minor"
    category: "evidence" | "coherence" | "strategy" | "writing"
    issue: string
    recommendation: string
    appliesTo: string | null
    evidence: Array<{
      quote: string
      sourceUrl: string | null
      page: number | null
      section: string | null
      origin: "reviewed_document" | "project_evidence"
    }>
  }>
  checklist: string[]
}) {
  const riskLabel =
    params.summary.riskLevel === "high"
      ? "Alto"
      : params.summary.riskLevel === "medium"
        ? "Medio"
        : "Bajo"

  const lines: string[] = []
  lines.push("Revision profesional asistida por IA")
  lines.push("")
  lines.push(`Documento revisado: ${params.sourceTitle}`)
  lines.push(`Fecha: ${new Date(params.generatedAt).toLocaleString("es-CL")}`)
  lines.push(`Riesgo general: ${riskLabel}`)
  lines.push(`Foco de revision: ${params.focus.map((f) => FOCUS_LABEL[f]).join(", ")}`)
  lines.push("")
  lines.push("Dictamen")
  lines.push(params.summary.verdict || "Sin dictamen.")

  if (params.summary.strengths.length) {
    lines.push("")
    lines.push("Fortalezas")
    for (const item of params.summary.strengths.slice(0, 6)) {
      lines.push(`- ${item}`)
    }
  }

  if (params.summary.priorities.length) {
    lines.push("")
    lines.push("Prioridades de mejora")
    for (const item of params.summary.priorities.slice(0, 8)) {
      lines.push(`- ${item}`)
    }
  }

  lines.push("")
  lines.push("Hallazgos")
  if (!params.findings.length) {
    lines.push("- No se detectaron hallazgos con evidencia suficiente.")
  }

  params.findings.slice(0, 14).forEach((finding, index) => {
    const sev =
      finding.severity === "critical" ? "CRITICO" : finding.severity === "major" ? "MAYOR" : "MENOR"
    const cat =
      finding.category === "evidence"
        ? "Sustento"
        : finding.category === "coherence"
          ? "Coherencia"
          : finding.category === "strategy"
            ? "Estrategia"
            : "Redaccion"

    lines.push("")
    lines.push(`${index + 1}. [${sev}] [${cat}] ${finding.title}`)
    if (finding.appliesTo) {
      lines.push(`   Tramo: ${finding.appliesTo}`)
    }
    lines.push(`   Observacion: ${finding.issue}`)
    lines.push(`   Recomendacion: ${finding.recommendation}`)
    if (finding.evidence.length) {
      lines.push("   Evidencia:")
      for (const ev of finding.evidence.slice(0, 3)) {
        const refParts = [
          ev.origin === "reviewed_document" ? "documento" : "fuente",
          typeof ev.page === "number" ? `p.${ev.page}` : null,
          ev.section ? ev.section : null,
        ].filter(Boolean)
        lines.push(`   - \"${safeText(ev.quote, 220)}\" (${refParts.join(" | ")})`)
        if (ev.sourceUrl) {
          lines.push(`     url: ${ev.sourceUrl}`)
        }
      }
    }
  })

  if (params.checklist.length) {
    lines.push("")
    lines.push("Checklist rapido")
    for (const item of params.checklist.slice(0, 10)) {
      lines.push(`- [ ] ${item}`)
    }
  }

  return lines.join("\n").trim()
}

async function generateReviewOutput(params: {
  system: string
  prompt: string
  schemaName: string
  schema: any
  model?: string
}) {
  try {
    const openai = await generateOpenAIJson(params)
    return {
      output: openai.output,
      model: openai.model,
      usage: openai.usage,
    }
  } catch (err: any) {
    const message = String(err?.message || "")
    const canFallback =
      message.toLowerCase().includes("missing openai_api_key") ||
      message.toLowerCase().includes("openai")

    if (!canFallback) throw err

    const resp = await ai.generate({
      system: params.system,
      prompt: params.prompt,
      output: {
        schema: ReviewOutputSchema,
        format: "json",
        constrained: true,
      },
      config: {
        temperature: 0.1,
        topP: 0.9,
      },
    })

    return {
      output: resp.output,
      model: resp.model ?? null,
      usage: resp.usage,
    }
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

  const { data: notes, error } = await supabase
    .from("gob_notes")
    .select("id,title,content,created_at")
    .eq("workspace_id", workspaceId)
    .ilike("title", `${REVIEW_NOTE_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const reviews = (notes || []).map((note: any) => {
    const content = String(note.content || "")
    const riskMatch = content.match(/Riesgo general:\s*(Alto|Medio|Bajo)/i)
    const riskLevel = riskMatch
      ? String(riskMatch[1]).toLowerCase() === "alto"
        ? "high"
        : String(riskMatch[1]).toLowerCase() === "medio"
          ? "medium"
          : "low"
      : null

    return {
      id: String(note.id),
      title: String(note.title || "Revision profesional"),
      createdAt: note.created_at ? String(note.created_at) : null,
      riskLevel,
      snippet: safeText(content, 260),
    }
  })

  return NextResponse.json({ reviews })
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
  const parsed = ProfessionalReviewRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const now = new Date().toISOString()
  const focus: Focus[] = parsed.data.focus?.length
    ? Array.from(new Set(parsed.data.focus)).slice(0, 4)
    : ["evidence", "coherence", "strategy", "writing"]
  const shouldSave = parsed.data.saveAsNote !== false

  const { data: source, error: sourceErr } = await supabase
    .from("gob_sources")
    .select("id,workspace_id,title,filename,status,url,doc_type,attributes")
    .eq("id", parsed.data.sourceId)
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (sourceErr) return NextResponse.json({ error: sourceErr.message }, { status: 500 })
  if (!source) {
    return NextResponse.json({ error: "Source not found in this project" }, { status: 404 })
  }

  const { data: snapshot, error: snapshotErr } = await supabase
    .from("gob_source_snapshots")
    .select("id,status,created_at")
    .eq("workspace_id", workspaceId)
    .eq("source_id", source.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (snapshotErr) return NextResponse.json({ error: snapshotErr.message }, { status: 500 })
  if (!snapshot) {
    return NextResponse.json({ error: "Source has no snapshots yet" }, { status: 409 })
  }

  if (String(snapshot.status || "") !== "ready") {
    return NextResponse.json(
      {
        error: "Source is still processing. Try again in a moment.",
        status: snapshot.status || "pending",
      },
      { status: 409 }
    )
  }

  const { data: documentRows, error: documentErr } = await supabase
    .from("gob_chunks")
    .select("id,content,source_url,snapshot_id,page,section")
    .eq("workspace_id", workspaceId)
    .eq("snapshot_id", snapshot.id)
    .order("created_at", { ascending: true })
    .limit(220)

  if (documentErr) return NextResponse.json({ error: documentErr.message }, { status: 500 })
  if (!documentRows?.length) {
    return NextResponse.json(
      { error: "No extracted text was found for this document yet" },
      { status: 409 }
    )
  }

  const documentChunks: ReviewChunk[] = (documentRows || []).map((row: any) => ({
    chunkId: String(row.id),
    content: safeText(String(row.content || ""), 1700),
    sourceUrl: row.source_url ? String(row.source_url) : null,
    snapshotId: row.snapshot_id ? String(row.snapshot_id) : null,
    page: typeof row.page === "number" ? row.page : row.page ? Number(row.page) : null,
    section: row.section ? String(row.section) : null,
    origin: "reviewed_document",
    rank: 1,
  }))

  const sourceTitle =
    safeText(source.title || source.filename || "Documento", 180) || "Documento"
  const documentText = (documentChunks || []).map((x) => x.content).join("\n")

  const admin = createAdminClient()
  const persistedArtifacts = await loadPersistedOnboardingArtifacts({
    supabase,
    workspaceId,
  }).catch(() => null)

  const { data: profileRow } = await supabase
    .from("gob_workspace_profiles")
    .select("metadata")
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  const profileMetadata =
    profileRow?.metadata && typeof profileRow.metadata === "object" && !Array.isArray(profileRow.metadata)
      ? profileRow.metadata
      : {}
  const structuredMemory = persistedArtifacts?.structuredMemory || extractStructuredOnboardingMemoryFromMetadata(profileMetadata)
  const structuredMemoryBlock = buildStructuredOnboardingMemoryBlock(structuredMemory)
  const sourceAttrs = source?.attributes && typeof source.attributes === "object" ? source.attributes : {}

  let accessibleWorkspaceIds: string[] = []
  try {
    accessibleWorkspaceIds = await getAccessibleWorkspaceIdsForUser({
      supabase,
      userId: user.id,
      requiredWorkspaceId: workspaceId,
    })
  } catch (err: any) {
    if (String(err?.message || "") === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    return NextResponse.json(
      { error: err?.message || "Could not evaluate workspace access" },
      { status: 500 }
    )
  }

  const scopedWorkspaceIds = Array.from(
    new Set([workspaceId, ...accessibleWorkspaceIds.filter((id) => id !== workspaceId)])
  ).slice(0, 10)

  const reviewIntentQuestion = `${sourceTitle} ${focus.map((item) => FOCUS_LABEL[item]).join(" ")} estrategia defensa sea informe sentencia resultado`
  const graphRoleTokens = uniqueStrings([
    sourceAttrs?.rol ? String(sourceAttrs.rol) : "",
    ...(structuredMemory?.preferredCauses || []).slice(0, 4).map((row) => String(row?.rol || "")),
  ], 6)
  const corpus = await ensureTribunalCorpusWorkspace(admin).catch(() => null)
  const graphContext = await loadLegalGraphContext({
    admin,
    workspaceId: corpus?.id || workspaceId,
    question: reviewIntentQuestion,
    roleTokens: graphRoleTokens,
    limit: 5,
  }).catch(() => ({ block: "", relatedRoles: [] as string[], relatedQueries: [] as string[] }))
  const queries = Array.from(
    new Set([...buildReviewQueries({ sourceTitle, documentText, focus }), ...graphContext.relatedQueries.slice(0, 2)])
  ).slice(0, 4)
  const perWorkspaceCount = Math.max(
    6,
    Math.min(16, Math.ceil(170 / Math.max(1, scopedWorkspaceIds.length * Math.max(1, queries.length))))
  )

  const candidateEvidenceRows: any[] = []
  for (const query of queries) {
    const batches = await Promise.all(
      scopedWorkspaceIds.map((wsId) =>
        supabase.rpc("gob_search_chunks_text", {
          p_workspace_id: wsId,
          p_query_text: query,
          p_match_count: perWorkspaceCount,
        })
      )
    )

    for (const batch of batches) {
      if (!batch || batch.error || !Array.isArray(batch.data)) continue
      for (const row of batch.data) {
        candidateEvidenceRows.push(row)
      }
    }
  }

  const externalByChunkId = new Map<string, ReviewChunk>()
  for (const row of candidateEvidenceRows) {
    const chunkId = String((row as any).chunk_id || "")
    if (!chunkId) continue

    const snapshotId = (row as any).snapshot_id ? String((row as any).snapshot_id) : null
    if (snapshotId && snapshotId === String(snapshot.id)) continue

    const rank = chunkRank(row)
    const prev = externalByChunkId.get(chunkId)
    if (prev && prev.rank >= rank) continue

    externalByChunkId.set(chunkId, {
      chunkId,
      content: safeText(String((row as any).content || ""), 1400),
      sourceUrl: (row as any).source_url ? String((row as any).source_url) : null,
      snapshotId,
      page: typeof (row as any).page === "number" ? (row as any).page : (row as any).page ? Number((row as any).page) : null,
      section: (row as any).section ? String((row as any).section) : null,
      origin: "project_evidence",
      rank,
    })
  }

  const evidenceContextBySnapshotId = await loadReviewEvidenceContext({
    supabase,
    snapshotIds: Array.from(externalByChunkId.values())
      .map((row) => String(row.snapshotId || ""))
      .filter(Boolean),
  })

  const externalEvidence = prioritizeReviewEvidence({
    chunks: Array.from(externalByChunkId.values()),
    contextBySnapshotId: evidenceContextBySnapshotId,
    question: reviewIntentQuestion,
    limit: 34,
  })

  const reviewDocForPrompt = documentChunks.slice(0, 18)
  const evidenceForPrompt = externalEvidence.slice(0, 26)

  const reviewDocBlock = reviewDocForPrompt
    .map((chunk, index) => {
      const loc = [
        typeof chunk.page === "number" ? `page=${chunk.page}` : null,
        chunk.section ? `section=${chunk.section}` : null,
      ]
        .filter(Boolean)
        .join(", ")
      const locSuffix = loc ? ` (${loc})` : ""
      return `DOC ${index + 1}: chunkId=${chunk.chunkId}${locSuffix}\n${chunk.content}`
    })
    .join("\n\n---\n\n")

  const evidenceBlock = evidenceForPrompt.length
    ? evidenceForPrompt
        .map((chunk, index) => {
          const loc = [
            chunk.sourceUrl ? `url=${chunk.sourceUrl}` : null,
            typeof chunk.page === "number" ? `page=${chunk.page}` : null,
            chunk.section ? `section=${chunk.section}` : null,
          ]
            .filter(Boolean)
            .join(", ")
          const locSuffix = loc ? ` (${loc})` : ""
          return `EVIDENCE ${index + 1}: chunkId=${chunk.chunkId}${locSuffix}\n${chunk.content}`
        })
        .join("\n\n---\n\n")
    : "(sin evidencia externa adicional para este documento)"

  const focusInstructions = focus.map((f) => `- ${FOCUS_INSTRUCTIONS[f]}`).join("\n")
  const persistedMarcoBlock = [persistedArtifacts?.summary, persistedArtifacts?.reportContent]
    .map((item) => safeText(item, 700))
    .filter(Boolean)
    .join("\n")

  const system =
    "Eres un revisor senior de documentos juridicos ambientales de Chile. Debes ser estricto, concreto y trazable. Regla critica: no inventes hechos ni normas. Solo puedes fundamentar observaciones con citas literales desde BLOQUE DOCUMENTO o BLOQUE EVIDENCIA. Si no hay sustento suficiente, no generes ese hallazgo."

  const prompt =
    `Documento bajo revision: ${sourceTitle}\n` +
    `Foco de revision:\n${focusInstructions}\n\n` +
    "Prioriza evacua informe/informe del SEA para evaluar estrategia defensiva y sentencia o resolucion final para evaluar si la estrategia funciono o fracaso. Usa la reclamacion solo como contexto.\n\n" +
    (structuredMemoryBlock ? `MEMORIA ESTRUCTURADA DEL CASO:\n${structuredMemoryBlock}\n\n` : "") +
    (persistedMarcoBlock ? `ARTEFACTO PERSISTIDO DEL MARCO TEORICO:\n${persistedMarcoBlock}\n\n` : "") +
    (graphContext.block ? `${graphContext.block}\n\n` : "") +
    `BLOQUE DOCUMENTO (texto real del informe revisado):\n\n${reviewDocBlock}\n\n` +
    `BLOQUE EVIDENCIA (otras fuentes del proyecto y proyectos vinculados):\n\n${evidenceBlock}\n\n` +
    "Instrucciones de salida:\n" +
    "- Devuelve SOLO JSON valido, sin texto adicional.\n" +
    "- findings debe tener entre 0 y 10 hallazgos.\n" +
    "- Cada finding debe incluir al menos 1 cita literal en citations (chunkId + quote).\n" +
    "- Usa severidad: critical, major, minor.\n" +
    "- Usa category: evidence, coherence, strategy, writing.\n" +
    "- checklist debe incluir acciones concretas y ejecutables.\n"

  let llmModel: string | null = null
  let llmUsage: any = null
  let parsedOutput: z.infer<typeof ReviewOutputSchema>

  try {
  const generated = await generateReviewOutput({
    system,
    prompt,
    schemaName: "professional_review_v1",
    schema: ReviewOutputJsonSchema,
    model: resolveOpenAIReviewProfessionalModel(),
  })

    llmModel = generated.model
    llmUsage = generated.usage
    const checked = ReviewOutputSchema.safeParse(generated.output)
    if (!checked.success) {
      return NextResponse.json(
        { error: "Review generation returned invalid schema" },
        { status: 500 }
      )
    }
    parsedOutput = checked.data
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Could not generate review" },
      { status: 500 }
    )
  }

  const allowedChunks = new Map<string, ReviewChunk>()
  for (const chunk of [...reviewDocForPrompt, ...evidenceForPrompt]) {
    allowedChunks.set(chunk.chunkId, chunk)
  }

  const findings = parsedOutput.findings
    .slice(0, 12)
    .map((finding, index) => {
      const evidence = (finding.citations || [])
        .slice(0, 4)
        .map((citation) => {
          const chunk = allowedChunks.get(String(citation.chunkId || ""))
          if (!chunk) return null
          const quote = String(citation.quote || "").trim()
          if (!quote || !quoteExistsInContent(chunk.content, quote)) return null
          return {
            chunkId: chunk.chunkId,
            quote,
            sourceUrl: chunk.sourceUrl,
            snapshotId: chunk.snapshotId,
            page: chunk.page,
            section: chunk.section,
            origin: chunk.origin,
          }
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x))

      if (!evidence.length) return null

      return {
        id: safeText(finding.id || `finding_${index + 1}`, 40) || `finding_${index + 1}`,
        title: safeText(finding.title || "Observacion", 160) || "Observacion",
        severity: finding.severity,
        category: finding.category,
        issue: safeText(finding.issue, 1200),
        recommendation: safeText(finding.recommendation, 1200),
        appliesTo: finding.appliesTo ? safeText(finding.appliesTo, 180) : null,
        evidence,
      }
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))

  const criticalCount = findings.filter((f) => f.severity === "critical").length
  const majorCount = findings.filter((f) => f.severity === "major").length
  const computedRisk: "low" | "medium" | "high" =
    criticalCount > 0 ? "high" : majorCount >= 2 ? "medium" : "low"

  const summary = {
    riskLevel: findings.length ? computedRisk : parsedOutput.summary.riskLevel,
    verdict: safeText(parsedOutput.summary.verdict, 900),
    strengths: (parsedOutput.summary.strengths || []).map((x) => safeText(x, 240)).filter(Boolean).slice(0, 6),
    priorities: (parsedOutput.summary.priorities || [])
      .map((x) => safeText(x, 240))
      .filter(Boolean)
      .slice(0, 8),
  }

  const checklist = (parsedOutput.checklist || [])
    .map((x) => safeText(x, 220))
    .filter(Boolean)
    .slice(0, 10)

  const citationsForNote = Array.from(
    new Map(
      findings
        .flatMap((finding) => finding.evidence)
        .map((ev) => [
          `${ev.chunkId}|${ev.quote}`,
          {
            chunkId: ev.chunkId,
            quote: ev.quote,
            sourceUrl: ev.sourceUrl,
            snapshotId: ev.snapshotId,
            page: ev.page,
            section: ev.section,
          },
        ])
    ).values()
  )

  let noteId: string | null = null
  let noteWarning: string | null = null
  if (shouldSave) {
    const noteContent = renderReviewNoteContent({
      sourceTitle,
      generatedAt: now,
      focus,
      summary,
      findings,
      checklist,
    })

    const { data: note, error: noteErr } = await supabase
      .from("gob_notes")
      .insert({
        workspace_id: workspaceId,
        title: `${REVIEW_NOTE_PREFIX} ${sourceTitle}`,
        content: noteContent,
        citations: citationsForNote,
        visibility: "shared",
        created_by: user.id,
        created_at: now,
      })
      .select("id")
      .single()

    if (noteErr) {
      noteWarning = noteErr.message
    } else {
      noteId = String(note.id)
    }
  }

  try {
    await supabase.from("gob_audit_logs").insert({
      user_id: user.id,
      action: "workspace.review.professional",
      target_resource: "gob_notes",
      details: {
        workspace_id: workspaceId,
        source_id: source.id,
        snapshot_id: snapshot.id,
        findings_count: findings.length,
        critical_count: criticalCount,
        major_count: majorCount,
        risk_level: summary.riskLevel,
        focus,
        note_id: noteId,
        graph_related_roles: graphContext.relatedRoles,
        graph_related_queries: graphContext.relatedQueries,
        graph_context_used: Boolean(graphContext.block),
      },
      timestamp: now,
    })
  } catch {
    // ignore audit failure
  }

  return NextResponse.json({
    review: {
      generatedAt: now,
      source: {
        id: String(source.id),
        title: sourceTitle,
        snapshotId: String(snapshot.id),
      },
      focus,
      summary,
      findings,
      checklist,
      stats: {
        reviewedChunks: reviewDocForPrompt.length,
        externalEvidenceChunks: evidenceForPrompt.length,
        findingsCount: findings.length,
        criticalCount,
        majorCount,
        model: llmModel,
        usage: llmUsage,
      },
    },
    noteId,
    noteWarning,
  })
}
