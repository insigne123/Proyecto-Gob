import { NextResponse } from "next/server"
import { z } from "zod"

import { ai } from "@/ai/genkit"
import { generateOpenAIJson } from "@/lib/llm/openai-json"
import { buildStructuredOnboardingMemoryBlock, extractStructuredOnboardingMemoryFromMetadata } from "@/lib/onboarding/structured-memory"
import { resolveOpenAIReviewInlineModel } from "@/lib/openai-models"
import { loadReviewEvidenceContext, prioritizeReviewEvidence } from "@/lib/reviews/evidence-priority"
import { createClient } from "@/lib/supabase/server"
import { getAccessibleWorkspaceIdsForUser } from "@/lib/workspaces/access"

const InlineReviewRequestSchema = z
  .object({
    sourceId: z.string().uuid(),
    saveAsNote: z.boolean().optional(),
  })
  .strict()

const SuggestionSchema = z.object({
  id: z.string().default(""),
  paragraphIndex: z.number().int().min(0).default(0),
  severity: z.enum(["critical", "major", "minor"]).default("minor"),
  category: z
    .enum([
      "ortografia",
      "redaccion",
      "claridad",
      "coherencia",
      "evidencia",
      "estrategia",
      "precedentes",
    ])
    .default("redaccion"),
  issue: z.string().default(""),
  recommendation: z.string().default(""),
  why: z.string().default(""),
  targetText: z.string().nullable().optional(),
  proposedText: z.string().nullable().optional(),
  citations: z
    .array(
      z.object({
        chunkId: z.string(),
        quote: z.string(),
      })
    )
    .default([]),
})

const StrategyInsightSchema = z.object({
  title: z.string().default(""),
  insight: z.string().default(""),
  recommendation: z.string().default(""),
  citations: z
    .array(
      z.object({
        chunkId: z.string(),
        quote: z.string(),
      })
    )
    .default([]),
})

const InlineReviewOutputSchema = z.object({
  summary: z.object({
    riskLevel: z.enum(["low", "medium", "high"]).default("medium"),
    overallVerdict: z.string().default(""),
    strengths: z.array(z.string()).default([]),
    additions: z.array(z.string()).default([]),
  }),
  suggestions: z.array(SuggestionSchema).default([]),
  strategyInsights: z.array(StrategyInsightSchema).default([]),
})

const InlineReviewOutputJsonSchema = {
  type: "object",
  properties: {
    summary: {
      type: "object",
      properties: {
        riskLevel: {
          type: "string",
          enum: ["low", "medium", "high"],
        },
        overallVerdict: { type: "string" },
        strengths: { type: "array", items: { type: "string" } },
        additions: { type: "array", items: { type: "string" } },
      },
      required: ["riskLevel", "overallVerdict", "strengths", "additions"],
      additionalProperties: false,
    },
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          paragraphIndex: { type: "number" },
          severity: { type: "string", enum: ["critical", "major", "minor"] },
          category: {
            type: "string",
            enum: [
              "ortografia",
              "redaccion",
              "claridad",
              "coherencia",
              "evidencia",
              "estrategia",
              "precedentes",
            ],
          },
          issue: { type: "string" },
          recommendation: { type: "string" },
          why: { type: "string" },
          targetText: { type: ["string", "null"] },
          proposedText: { type: ["string", "null"] },
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
          "paragraphIndex",
          "severity",
          "category",
          "issue",
          "recommendation",
          "why",
          "targetText",
          "proposedText",
          "citations",
        ],
        additionalProperties: false,
      },
    },
    strategyInsights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          insight: { type: "string" },
          recommendation: { type: "string" },
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
        required: ["title", "insight", "recommendation", "citations"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "suggestions", "strategyInsights"],
  additionalProperties: false,
} as const

type ReviewChunk = {
  chunkId: string
  content: string
  sourceUrl: string | null
  snapshotId: string | null
  page: number | null
  section: string | null
  rank: number
  origin: "document" | "cross_case"
}

type SourceTags = {
  tribunal: string | null
  rol: string | null
  fecha: string | null
  materia: string | null
  region: string | null
}

type ParagraphUnit = {
  index: number
  text: string
  chunkId: string
  page: number | null
  section: string | null
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

function safeText(value: unknown, max = 400) {
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

function quoteExistsInContent(content: string, quote: string) {
  const hay = normalizeText(content)
  const needle = normalizeText(quote)
  return needle.length >= 12 && hay.includes(needle)
}

function extractKeywords(text: string, max = 12) {
  const counts = new Map<string, number>()
  for (const token of normalizeText(text).split(" ")) {
    if (!token || token.length < 4) continue
    if (STOPWORDS.has(token)) continue
    counts.set(token, (counts.get(token) || 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([token]) => token)
}

function chunkRank(row: any) {
  const rank = typeof row?.rank === "number" ? row.rank : Number(row?.rank || 0)
  if (Number.isFinite(rank)) return rank
  return 0
}

function splitIntoParagraphPieces(text: string, params?: { maxChars?: number; preferWholeBlock?: boolean }) {
  const maxChars = Math.max(420, Number(params?.maxChars || 900))
  const raw = String(text || "").replace(/\r/g, "")
  const blocks = raw
    .split(/\n{2,}/)
    .map((part) => part.replace(/[ \t]+/g, " ").trim())
    .filter((part) => part.length >= 20)

  const seeds = blocks.length
    ? blocks
    : [raw.replace(/\s+/g, " ").trim()].filter((part) => part.length >= 20)

  if (!seeds.length) return []

  const out: string[] = []
  for (const seed of seeds) {
    if (params?.preferWholeBlock && seed.length <= maxChars * 1.35) {
      out.push(seed)
      continue
    }
    if (seed.length <= maxChars) {
      out.push(seed)
      continue
    }

    const sentences = seed.split(/(?<=[\.!?;:])\s+/)
    let buffer = ""
    for (const sentence of sentences) {
      const cleanSentence = sentence.trim()
      if (!cleanSentence) continue
      const trial = buffer ? `${buffer} ${cleanSentence}` : cleanSentence
      if (trial.length <= maxChars) {
        buffer = trial
        continue
      }
      if (buffer) out.push(buffer)
      if (cleanSentence.length <= maxChars) {
        buffer = cleanSentence
        continue
      }
      for (let offset = 0; offset < cleanSentence.length; offset += maxChars) {
        const piece = cleanSentence.slice(offset, offset + maxChars).trim()
        if (piece.length >= 20) out.push(piece)
      }
      buffer = ""
    }
    if (buffer) out.push(buffer)
  }

  return out.map((part) => part.trim()).filter((part) => part.length >= 20)
}

function buildParagraphUnits(rows: any[]) {
  const units: ParagraphUnit[] = []
  let idx = 0
  for (const row of rows) {
    const chunkId = String((row as any).id)
    const content = String((row as any).content || "")
    const page = typeof (row as any).page === "number" ? (row as any).page : (row as any).page ? Number((row as any).page) : null
    const section = (row as any).section ? String((row as any).section) : null
    const isDocxLike = section === "docx"
    const pieces = splitIntoParagraphPieces(content, {
      maxChars: isDocxLike ? 1200 : page ? 780 : 920,
      preferWholeBlock: isDocxLike,
    })
    for (const piece of pieces) {
      units.push({
        index: idx,
        text: piece,
        chunkId,
        page,
        section,
      })
      idx += 1
    }
  }
  return units
}

function detectDocumentKind(source: any, snapshot: any): "docx" | "pdf" {
  const filename = String(source?.filename || snapshot?.original_filename || "").toLowerCase()
  const contentType = String(snapshot?.content_type || "").toLowerCase()
  if (filename.endsWith(".docx") || contentType.includes("wordprocessingml.document")) return "docx"
  return "pdf"
}

function inferSourceTagsFromChunk(chunk: ReviewChunk): SourceTags {
  const text = normalizeText(chunk.content)

  const tribunal = (() => {
    if (text.includes("primer tribunal ambiental")) return "1TA"
    if (text.includes("segundo tribunal ambiental")) return "2TA"
    if (text.includes("tercer tribunal ambiental")) return "3TA"
    if (text.includes("corte suprema")) return "Corte Suprema"
    if (text.includes("corte de apelaciones")) return "Corte de Apelaciones"
    return null
  })()

  const rolMatch =
    chunk.content.match(/rol\s*(?:n[°ºo.]*)?\s*([a-z]-?\d{1,5}-\d{4})/i) ||
    chunk.content.match(/\b(r-\d{1,5}-\d{4})\b/i)
  const rol = rolMatch ? String(rolMatch[1]).toUpperCase() : null

  const fechaMatch =
    chunk.content.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/) ||
    chunk.content.match(/\b(\d{1,2}\s+de\s+[A-Za-záéíóúñ]+\s+de\s+\d{4})\b/i)
  const fecha = fechaMatch ? String(fechaMatch[1]) : null

  const materia = (() => {
    if (text.includes("participacion ciudadana")) return "Participacion ciudadana"
    if (text.includes("resolucion de calificacion ambiental") || text.includes("rca")) return "RCA"
    if (text.includes("legitimacion activa")) return "Legitimacion activa"
    if (text.includes("inadmisible") || text.includes("inadmisibilidad")) return "Inadmisibilidad"
    if (text.includes("reclamacion")) return "Reclamacion ambiental"
    return null
  })()

  const region = (() => {
    const regions = [
      "tarapaca",
      "antofagasta",
      "atacama",
      "coquimbo",
      "valparaiso",
      "metropolitana",
      "ohiggins",
      "maule",
      "nuble",
      "biobio",
      "araucania",
      "los rios",
      "los lagos",
      "aysen",
      "magallanes",
    ]
    const found = regions.find((candidate) => text.includes(candidate))
    return found ? found.replace(/\b\w/g, (m) => m.toUpperCase()) : null
  })()

  return {
    tribunal,
    rol,
    fecha,
    materia,
    region,
  }
}

function buildSimilarCases(crossCaseEvidence: ReviewChunk[]) {
  const groups = new Map<string, ReviewChunk[]>()
  for (const row of crossCaseEvidence) {
    const key = row.snapshotId || row.chunkId
    const existing = groups.get(key) || []
    existing.push(row)
    groups.set(key, existing)
  }

  return Array.from(groups.entries())
    .slice(0, 5)
    .map(([snapshotId, rows], idx) => {
      const joined = rows.map((r) => r.content).join(" ")
      const normalized = normalizeText(joined)
      const primary = rows[0]
      const tags = inferSourceTagsFromChunk(primary)

      const outcome =
        normalized.includes("acoge") || normalized.includes("acogio")
          ? "Tendencia favorable (acogimiento)"
          : normalized.includes("rechaza") || normalized.includes("rechazo")
            ? "Tendencia desfavorable (rechazo)"
            : "Resultado no concluyente"

      const criterion =
        tags.materia ||
        (normalized.includes("participacion ciudadana")
          ? "Control de participacion ciudadana"
          : normalized.includes("legitimacion")
            ? "Control de legitimacion"
            : "Control de motivacion y prueba")

      return {
        id: snapshotId,
        caseLabel: tags.rol ? `${tags.rol}${tags.tribunal ? ` (${tags.tribunal})` : ""}` : `Caso similar #${idx + 1}`,
        similarityReason:
          tags.materia
            ? `Coincidencia por materia: ${tags.materia}.`
            : "Coincidencia textual y argumental con el informe revisado.",
        argumentsWorked: [
          "Explicar con trazabilidad la cadena de hechos y fundamentos normativos.",
          "Vincular observaciones ciudadanas con respuesta tecnica verificable.",
        ],
        argumentsFailed: [
          "Afirmaciones sin respaldo documental directo.",
          "Omitir control de admisibilidad y legitimacion procesal.",
        ],
        outcome,
        criterion,
        citations: rows.slice(0, 2).map((row) => ({
          chunkId: row.chunkId,
          quote: shortQuote(row.content, 240),
          sourceUrl: row.sourceUrl,
          snapshotId: row.snapshotId,
          page: row.page,
          section: row.section,
          origin: row.origin,
          tags: inferSourceTagsFromChunk(row),
        })),
      }
    })
}

function buildRiskAlerts(params: {
  suggestions: Array<{
    severity: "critical" | "major" | "minor"
    category: "ortografia" | "redaccion" | "claridad" | "coherencia" | "evidencia" | "estrategia" | "precedentes"
    issue: string
    recommendation: string
    citations: Array<{
      chunkId: string
      quote: string
      sourceUrl: string | null
      snapshotId: string | null
      page: number | null
      section: string | null
      origin: "document" | "cross_case"
      tags?: SourceTags
    }>
  }>
}) {
  const alerts: Array<{
    severity: "critical" | "major" | "minor"
    title: string
    detail: string
    mitigation: string
    citations: Array<{
      chunkId: string
      quote: string
      sourceUrl: string | null
      snapshotId: string | null
      page: number | null
      section: string | null
      origin: "document" | "cross_case"
      tags?: SourceTags
    }>
  }> = []

  const criticalCoherence = params.suggestions.find(
    (s) => s.category === "coherencia" && (s.severity === "critical" || s.severity === "major")
  )
  if (criticalCoherence) {
    alerts.push({
      severity: criticalCoherence.severity,
      title: "Riesgo de contradiccion interna",
      detail: criticalCoherence.issue,
      mitigation: "Unificar narrativa de hechos, fechas y peticiones en una sola linea argumental.",
      citations: criticalCoherence.citations.slice(0, 2),
    })
  }

  const evidenceGap = params.suggestions.find(
    (s) => s.category === "evidencia" && (s.severity === "critical" || s.severity === "major")
  )
  if (evidenceGap) {
    alerts.push({
      severity: evidenceGap.severity,
      title: "Riesgo de insuficiencia probatoria",
      detail: evidenceGap.issue,
      mitigation: "Agregar respaldo documental directo y cita de fuente por cada afirmacion clave.",
      citations: evidenceGap.citations.slice(0, 2),
    })
  }

  const strategyGap = params.suggestions.find(
    (s) => s.category === "estrategia" || s.category === "precedentes"
  )
  if (strategyGap) {
    alerts.push({
      severity: strategyGap.severity,
      title: "Riesgo estrategico en defensa",
      detail: strategyGap.issue,
      mitigation: strategyGap.recommendation || "Alinear estrategia con criterios de casos comparables.",
      citations: strategyGap.citations.slice(0, 2),
    })
  }

  return alerts.slice(0, 5)
}

function shortQuote(text: string, max = 220) {
  const clean = safeText(text, max)
  return clean || ""
}

async function generateInlineReviewOutput(params: {
  system: string
  prompt: string
  model?: string
}) {
  try {
    const openai = await generateOpenAIJson({
      system: params.system,
      prompt: params.prompt,
      schemaName: "inline_document_review_v1",
      schema: InlineReviewOutputJsonSchema,
      maxCompletionTokens: 2200,
      reasoningEffort: "minimal",
      model: params.model,
    })
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

    const fallback = await ai.generate({
      system: params.system,
      prompt: params.prompt,
      output: {
        schema: InlineReviewOutputSchema,
        format: "json",
        constrained: true,
      },
      config: {
        temperature: 0.1,
        topP: 0.9,
      },
    })

    return {
      output: fallback.output,
      model: fallback.model ?? null,
      usage: fallback.usage,
    }
  }
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

  const body = await request.json().catch(() => null)
  const parsed = InlineReviewRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { data: member } = await supabase
    .from("gob_workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { data: source, error: sourceErr } = await supabase
    .from("gob_sources")
    .select("id,workspace_id,title,filename,status")
    .eq("id", parsed.data.sourceId)
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (sourceErr) return NextResponse.json({ error: sourceErr.message }, { status: 500 })
  if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 })

  const { data: snapshot, error: snapshotErr } = await supabase
    .from("gob_source_snapshots")
    .select("id,status,content_type,original_filename,created_at")
    .eq("workspace_id", workspaceId)
    .eq("source_id", source.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (snapshotErr) return NextResponse.json({ error: snapshotErr.message }, { status: 500 })
  if (!snapshot) return NextResponse.json({ error: "Source has no snapshots" }, { status: 409 })
  if (String(snapshot.status || "") !== "ready") {
    return NextResponse.json(
      { error: "Source is still processing", status: snapshot.status || "pending" },
      { status: 409 }
    )
  }

  const { data: chunkRows, error: chunksErr } = await supabase
    .from("gob_chunks")
    .select("id,content,source_url,snapshot_id,page,section")
    .eq("workspace_id", workspaceId)
    .eq("snapshot_id", snapshot.id)
    .order("created_at", { ascending: true })
    .limit(260)

  if (chunksErr) return NextResponse.json({ error: chunksErr.message }, { status: 500 })
  if (!chunkRows?.length) {
    return NextResponse.json({ error: "No extracted text available for this source" }, { status: 409 })
  }

  const paragraphs = buildParagraphUnits(chunkRows)
  if (!paragraphs.length) {
    return NextResponse.json({ error: "Document text is empty after normalization" }, { status: 409 })
  }

  const documentKind = detectDocumentKind(source, snapshot)
  const sourceTitle =
    safeText(source.title || source.filename || snapshot.original_filename || "Documento", 180) ||
    "Documento"

  const { data: profileRow } = await supabase
    .from("gob_workspace_profiles")
    .select("metadata")
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  const profileMetadata =
    profileRow?.metadata && typeof profileRow.metadata === "object" && !Array.isArray(profileRow.metadata)
      ? profileRow.metadata
      : {}
  const structuredMemoryBlock = buildStructuredOnboardingMemoryBlock(
    extractStructuredOnboardingMemoryFromMetadata(profileMetadata)
  )

  let workspaceIds: string[] = []
  try {
    workspaceIds = await getAccessibleWorkspaceIdsForUser({
      supabase,
      userId: user.id,
      requiredWorkspaceId: workspaceId,
    })
  } catch (err: any) {
    if (String(err?.message || "") === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    return NextResponse.json({ error: err?.message || "Could not evaluate workspace access" }, { status: 500 })
  }

  const textForKeywords = paragraphs
    .slice(0, 40)
    .map((p) => p.text)
    .join(" ")
  const keywords = extractKeywords(textForKeywords, 10)

  const queries = Array.from(
    new Set(
      [
        safeText(`${sourceTitle} ${keywords.join(" ")}`, 280),
        "estrategia defensa tribunal ambiental reclamacion sentencia informe",
      ].filter((q) => q.length >= 10)
    )
  ).slice(0, 3)
  const reviewIntentQuestion = `${sourceTitle} revision guiada estrategia defensa sea informe sentencia precedentes resultado`

  const scopedWorkspaceIds = Array.from(new Set([workspaceId, ...workspaceIds])).slice(0, 10)
  const perWorkspaceCount = Math.max(4, Math.min(12, Math.ceil(140 / Math.max(1, scopedWorkspaceIds.length * queries.length))))

  const externalRows: any[] = []
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
      for (const row of batch.data) externalRows.push(row)
    }
  }

  const crossCaseMap = new Map<string, ReviewChunk>()
  for (const row of externalRows) {
    const chunkId = String((row as any).chunk_id || "")
    if (!chunkId) continue
    const snapshotId = (row as any).snapshot_id ? String((row as any).snapshot_id) : null
    if (snapshotId && snapshotId === String(snapshot.id)) continue

    const rank = chunkRank(row)
    const prev = crossCaseMap.get(chunkId)
    if (prev && prev.rank >= rank) continue

    crossCaseMap.set(chunkId, {
      chunkId,
      content: safeText(String((row as any).content || ""), 1300),
      sourceUrl: (row as any).source_url ? String((row as any).source_url) : null,
      snapshotId,
      page:
        typeof (row as any).page === "number"
          ? (row as any).page
          : (row as any).page
            ? Number((row as any).page)
            : null,
      section: (row as any).section ? String((row as any).section) : null,
      rank,
      origin: "cross_case",
    })
  }

  const evidenceContextBySnapshotId = await loadReviewEvidenceContext({
    supabase,
    snapshotIds: Array.from(crossCaseMap.values())
      .map((row) => String(row.snapshotId || ""))
      .filter(Boolean),
  })

  const crossCaseEvidence = prioritizeReviewEvidence({
    chunks: Array.from(crossCaseMap.values()),
    contextBySnapshotId: evidenceContextBySnapshotId,
    question: reviewIntentQuestion,
    limit: 34,
  })

  const documentEvidence: ReviewChunk[] = chunkRows.map((row: any) => ({
    chunkId: String(row.id),
    content: safeText(String(row.content || ""), 1600),
    sourceUrl: row.source_url ? String(row.source_url) : null,
    snapshotId: row.snapshot_id ? String(row.snapshot_id) : null,
    page: typeof row.page === "number" ? row.page : row.page ? Number(row.page) : null,
    section: row.section ? String(row.section) : null,
    rank: 1,
    origin: "document",
  }))

  const evidenceByChunkId = new Map<string, ReviewChunk>()
  for (const row of [...documentEvidence, ...crossCaseEvidence]) {
    evidenceByChunkId.set(row.chunkId, row)
  }

  const { data: marcoNotes } = await supabase
    .from("gob_notes")
    .select("id,title,content")
    .eq("workspace_id", workspaceId)
    .ilike("title", "%marco teorico%")
    .order("created_at", { ascending: false })
    .limit(2)

  const paragraphBlock = paragraphs
    .slice(0, 120)
    .map(
      (p) =>
        `TRAMO ${p.index}: chunkId=${p.chunkId}${
          typeof p.page === "number" ? ` (page=${p.page})` : p.section ? ` (section=${p.section})` : ""
        }\n${p.text}`
    )
    .join("\n\n---\n\n")

  const crossCaseBlock = crossCaseEvidence.length
    ? crossCaseEvidence
        .map(
          (row, idx) =>
            `EVIDENCIA ${idx + 1}: chunkId=${row.chunkId}${
              row.sourceUrl ? ` (url=${row.sourceUrl})` : ""
            }\n${row.content}`
        )
        .join("\n\n---\n\n")
    : "(sin evidencia cruzada suficiente)"

  const marcoBlock = (marcoNotes || []).length
    ? (marcoNotes || [])
        .map((note: any, idx: number) => `MARCO ${idx + 1}: ${safeText(note.title, 120)}\n${safeText(note.content, 1600)}`)
        .join("\n\n---\n\n")
    : "(sin notas de marco teorico detectadas)"

  const system =
    "Eres un abogado redactor senior en litigacion ambiental chilena. Debes analizar documentos con criterio profesional y generar mejoras accionables. Regla critica: cada sugerencia debe citar evidencia (chunkId + cita literal). No inventes hechos ni jurisprudencia."

  const prompt =
    `Documento analizado: ${sourceTitle} (${documentKind.toUpperCase()})\n\n` +
    "OBJETIVO:\n" +
    "1) Corregir ortografia, redaccion y claridad.\n" +
    "2) Detectar debilidades probatorias y de estrategia de defensa.\n" +
    "3) Sugerir informacion adicional util.\n" +
    "4) Cruzar con evidencia de causas previas para extraer estrategias que suelen funcionar o fallar.\n\n" +
    "Prioriza Evacua Informe e informes equivalentes del SEA para estrategia defensiva, luego sentencia o resolucion final para evaluar resultado, y usa reclamacion solo como contexto.\n\n" +
    (structuredMemoryBlock ? `MEMORIA ESTRUCTURADA DEL CASO:\n${structuredMemoryBlock}\n\n` : "") +
    `BLOQUE MARCO TEORICO:\n${marcoBlock}\n\n` +
    `BLOQUE DOCUMENTO (tramos consecutivos del escrito):\n${paragraphBlock}\n\n` +
    `BLOQUE EVIDENCIA CRUZADA:\n${crossCaseBlock}\n\n` +
    "INSTRUCCIONES DE SALIDA:\n" +
    "- Devuelve solo JSON valido.\n" +
    "- suggestions entre 6 y 18 items, con paragraphIndex valido sobre los TRAMO.\n" +
    "- Para category=ortografia/redaccion intenta incluir targetText y proposedText.\n" +
    "- Cada sugerencia debe tener al menos 1 cita literal valida.\n" +
    "- strategyInsights debe contener aprendizajes de estrategia de defensa.\n"

  let model: string | null = null
  let usage: any = null
  let generated: z.infer<typeof InlineReviewOutputSchema>

  try {
    const output = await generateInlineReviewOutput({ system, prompt, model: resolveOpenAIReviewInlineModel() })
    model = output.model
    usage = output.usage
    const checked = InlineReviewOutputSchema.safeParse(output.output)
    if (!checked.success) {
      return NextResponse.json({ error: "Invalid AI output schema" }, { status: 500 })
    }
    generated = checked.data
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Could not generate analysis" }, { status: 500 })
  }

  const verifiedSuggestions = generated.suggestions
    .slice(0, 30)
    .map((suggestion, idx) => {
      const paragraphIndex = Math.max(0, Math.min(paragraphs.length - 1, Number(suggestion.paragraphIndex || 0)))
      const paragraph = paragraphs[paragraphIndex]

      const verifiedCitations = (suggestion.citations || [])
        .slice(0, 4)
        .map((citation) => {
          const chunk = evidenceByChunkId.get(String(citation.chunkId || ""))
          if (!chunk) return null
          const quote = safeText(citation.quote, 260)
          if (!quote || !quoteExistsInContent(chunk.content, quote)) return null
          return {
            chunkId: chunk.chunkId,
            quote,
            sourceUrl: chunk.sourceUrl,
            snapshotId: chunk.snapshotId,
            page: chunk.page,
            section: chunk.section,
            origin: chunk.origin,
            tags: inferSourceTagsFromChunk(chunk),
          }
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))

      if (!verifiedCitations.length) {
        verifiedCitations.push({
          chunkId: paragraph.chunkId,
          quote: shortQuote(paragraph.text, 220),
          sourceUrl: evidenceByChunkId.get(paragraph.chunkId)?.sourceUrl || null,
          snapshotId: evidenceByChunkId.get(paragraph.chunkId)?.snapshotId || null,
          page: paragraph.page,
          section: paragraph.section,
          origin: "document",
          tags: inferSourceTagsFromChunk(evidenceByChunkId.get(paragraph.chunkId) || {
            chunkId: paragraph.chunkId,
            content: paragraph.text,
            sourceUrl: null,
            snapshotId: null,
            page: paragraph.page,
            section: paragraph.section,
            rank: 1,
            origin: "document",
          }),
        })
      }

      return {
        id: safeText(suggestion.id || `s_${idx + 1}`, 48) || `s_${idx + 1}`,
        paragraphIndex,
        severity: suggestion.severity,
        category: suggestion.category,
        issue: safeText(suggestion.issue, 800),
        recommendation: safeText(suggestion.recommendation, 900),
        why: safeText(suggestion.why, 900),
        targetText:
          documentKind === "docx" && suggestion.targetText
            ? safeText(String(suggestion.targetText), 300)
            : null,
        proposedText:
          documentKind === "docx" && suggestion.proposedText
            ? safeText(String(suggestion.proposedText), 500)
            : null,
        citations: verifiedCitations,
      }
    })

  const verifiedStrategyInsights = generated.strategyInsights
    .slice(0, 8)
    .map((insight) => {
      const citations = (insight.citations || [])
        .slice(0, 4)
        .map((citation) => {
          const chunk = evidenceByChunkId.get(String(citation.chunkId || ""))
          if (!chunk) return null
          const quote = safeText(citation.quote, 240)
          if (!quote || !quoteExistsInContent(chunk.content, quote)) return null
          return {
            chunkId: chunk.chunkId,
            quote,
            sourceUrl: chunk.sourceUrl,
            snapshotId: chunk.snapshotId,
            page: chunk.page,
            section: chunk.section,
            origin: chunk.origin,
            tags: inferSourceTagsFromChunk(chunk),
          }
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))

      return {
        title: safeText(insight.title, 180),
        insight: safeText(insight.insight, 700),
        recommendation: safeText(insight.recommendation, 700),
        citations,
      }
    })
    .filter((item) => item.title && item.insight)

  const summary = {
    riskLevel: generated.summary.riskLevel,
    overallVerdict: safeText(generated.summary.overallVerdict, 1200),
    strengths: (generated.summary.strengths || []).map((item) => safeText(item, 220)).filter(Boolean).slice(0, 8),
    additions: (generated.summary.additions || []).map((item) => safeText(item, 220)).filter(Boolean).slice(0, 10),
  }

  const criticalCount = verifiedSuggestions.filter((s) => s.severity === "critical").length
  const majorCount = verifiedSuggestions.filter((s) => s.severity === "major").length
  const similarCases = buildSimilarCases(crossCaseEvidence)
  const riskAlerts = buildRiskAlerts({ suggestions: verifiedSuggestions as any })

  const shouldSaveAsNote = parsed.data.saveAsNote === true
  let noteId: string | null = null
  if (shouldSaveAsNote) {
    const noteLines = [
      `Revision inteligente de informe (${sourceTitle})`,
      "",
      `Riesgo: ${summary.riskLevel}`,
      summary.overallVerdict,
      "",
      "Sugerencias destacadas:",
      ...verifiedSuggestions.slice(0, 12).map((s, idx) => `${idx + 1}. [${s.severity}] ${s.issue}`),
      "",
      "Alertas de riesgo:",
      ...riskAlerts.slice(0, 5).map((a, idx) => `${idx + 1}. [${a.severity}] ${a.title}`),
    ]
    const { data: note } = await supabase
      .from("gob_notes")
      .insert({
        workspace_id: workspaceId,
        title: `Revision inteligente: ${sourceTitle}`,
        content: noteLines.join("\n"),
        visibility: "shared",
        created_by: user.id,
        created_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle()

    noteId = note?.id ? String(note.id) : null
  }

  try {
    await supabase.from("gob_audit_logs").insert({
      user_id: user.id,
      action: "workspace.review.inline",
      target_resource: "gob_sources",
      details: {
        workspace_id: workspaceId,
        source_id: source.id,
        snapshot_id: snapshot.id,
        document_kind: documentKind,
        suggestions: verifiedSuggestions.length,
        critical_count: criticalCount,
        major_count: majorCount,
      },
      timestamp: new Date().toISOString(),
    })
  } catch {
    // ignore audit failures
  }

  return NextResponse.json({
    review: {
      generatedAt: new Date().toISOString(),
      document: {
        sourceId: String(source.id),
        sourceTitle,
        snapshotId: String(snapshot.id),
        kind: documentKind,
        paragraphs,
      },
      summary,
      suggestions: verifiedSuggestions,
      strategyInsights: verifiedStrategyInsights,
      similarCases,
      riskAlerts,
      stats: {
        paragraphs: paragraphs.length,
        suggestions: verifiedSuggestions.length,
        criticalCount,
        majorCount,
        crossEvidence: crossCaseEvidence.length,
        model,
        usage,
      },
    },
    noteId,
  })
}
