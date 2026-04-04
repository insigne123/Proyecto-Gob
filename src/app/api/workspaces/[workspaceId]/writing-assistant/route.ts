import { NextResponse } from "next/server"
import { z } from "zod"

import { loadPersistedOnboardingArtifacts } from "@/lib/onboarding/artifacts"
import { ensureTribunalCorpusWorkspace } from "@/lib/onboarding/tribunal-corpus"
import {
  buildWritingGuidanceFromStructuredMemory,
  extractStructuredOnboardingMemoryFromMetadata,
} from "@/lib/onboarding/structured-memory"
import { createAdminClient } from "@/lib/supabase/admin"
import { retrieveReferencedSnapshotEvidence } from "@/lib/rag/local-retrieval"
import { createClient } from "@/lib/supabase/server"
import { loadLegalGraphContext } from "@/lib/tribunal/graph-retrieval"
import { generateOpenAIJson } from "@/lib/llm/openai-json"
import {
  resolveOpenAIWritingCounterargueModel,
  resolveOpenAIWritingProofreadModel,
} from "@/lib/openai-models"

const WritingSchema = z
  .object({
    task: z.enum(["proofread", "counterargue"]),
    text: z.string().trim().min(20).max(40000),
    context: z.string().trim().max(3000).optional().nullable(),
  })
  .strict()

function fallbackProofread(text: string) {
  return {
    revisedText: text,
    observations: [
      "No se pudo invocar el modelo de revision; se mantiene el texto original.",
      "Sugerencia manual: revisar frases extensas y voz pasiva.",
    ],
    suggestions: ["Divide parrafos largos.", "Agrega conectores causales y conclusivos."] ,
  }
}

function fallbackCounterargue(text: string) {
  const trimmed = text.slice(0, 900)
  return {
    revisedText: text,
    observations: ["No se pudo invocar el modelo de argumentacion; salida de respaldo aplicada."],
    suggestions: [
      "Identifica la premisa principal y exige evidencia documental por cada afirmacion.",
      "Contrasta el hecho alegado con actos administrativos y trazabilidad del expediente.",
      "Formula al menos dos contraargumentos alternativos con sus riesgos.",
    ],
    counterArguments: [
      `La tesis central no acredita suficientemente el nexo causal con la medida impugnada: ${trimmed}`,
      "Incluso aceptando los hechos alegados, no se demuestra que la autoridad haya omitido una carga legal especifica.",
      "La pretension deberia ponderarse con principios de proporcionalidad y deferencia tecnica en evaluacion ambiental.",
    ],
  }
}

function buildEvidenceBlock(evidence: Array<{ section: string | null; page: number | null; content: string }>) {
  return evidence
    .slice(0, 6)
    .map((chunk, index) => {
      const location = [chunk.section, typeof chunk.page === "number" ? `p.${chunk.page}` : null]
        .filter(Boolean)
        .join(" | ")
      return `EVIDENCIA ${index + 1}${location ? ` (${location})` : ""}\n${String(chunk.content || "").slice(0, 900)}`
    })
    .join("\n\n---\n\n")
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
  const parsed = WritingSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const payload = parsed.data
  const now = new Date().toISOString()
  const context = payload.context ? String(payload.context) : ""
  const admin = createAdminClient()
  const persistedArtifacts = await loadPersistedOnboardingArtifacts({
    supabase,
    workspaceId,
  }).catch(() => null)

  const [{ data: profileRow }, { data: marcoNotes }] = await Promise.all([
    supabase
      .from("gob_workspace_profiles")
      .select("metadata")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    supabase
      .from("gob_notes")
      .select("title,content")
      .eq("workspace_id", workspaceId)
      .or("title.ilike.%marco teorico%,title.ilike.%borrador inicial de informe%")
      .order("created_at", { ascending: false })
      .limit(2),
  ])

  const structuredMemory = persistedArtifacts?.structuredMemory || extractStructuredOnboardingMemoryFromMetadata(profileRow?.metadata)
  const structuredWritingGuidance = buildWritingGuidanceFromStructuredMemory(structuredMemory)
  const metadata = profileRow?.metadata && typeof profileRow.metadata === "object" && !Array.isArray(profileRow.metadata)
    ? profileRow.metadata
    : {}
  const onboarding = metadata?.onboarding && typeof metadata.onboarding === "object" ? metadata.onboarding : {}
  const tribunalReferences = Array.isArray(persistedArtifacts?.tribunalReferences) && persistedArtifacts?.tribunalReferences.length
    ? persistedArtifacts.tribunalReferences
        .map((ref) => ({
          snapshotId: String((ref as any)?.snapshotId || "").trim(),
          title: (ref as any)?.sourceTitle ? String((ref as any).sourceTitle) : (ref as any)?.documentName ? String((ref as any).documentName) : null,
          docType: (ref as any)?.docType ? String((ref as any).docType) : null,
          docRole: (ref as any)?.docRole ? String((ref as any).docRole) : null,
          rol: (ref as any)?.rol ? String((ref as any).rol) : null,
        }))
        .filter((ref) => ref.snapshotId)
    : Array.isArray((onboarding as any)?.tribunal_references)
    ? ((onboarding as any).tribunal_references as any[])
        .map((ref) => ({
          snapshotId: String(ref?.snapshotId || "").trim(),
          title: ref?.sourceTitle ? String(ref.sourceTitle) : ref?.documentName ? String(ref.documentName) : null,
          docType: ref?.docType ? String(ref.docType) : null,
          docRole: ref?.docRole ? String(ref.docRole) : null,
          rol: ref?.rol ? String(ref.rol) : null,
        }))
        .filter((ref) => ref.snapshotId)
    : []

  const graphRoleTokens = Array.from(
    new Set(
      [
        ...tribunalReferences.map((ref) => String(ref.rol || "").trim()),
        ...(structuredMemory?.preferredCauses || []).slice(0, 4).map((row) => String(row?.rol || "").trim()),
      ].filter(Boolean)
    )
  ).slice(0, 6)
  const corpus = await ensureTribunalCorpusWorkspace(admin).catch(() => null)
  const graphContext = await loadLegalGraphContext({
    admin,
    workspaceId: corpus?.id || workspaceId,
    question: `${payload.task === "counterargue" ? "refutar" : "redactar"} ${payload.text}\n${context}`,
    roleTokens: graphRoleTokens,
    limit: 5,
  }).catch(() => ({ block: "", relatedRoles: [] as string[], relatedQueries: [] as string[] }))

  const retrievalQuestion = `${payload.task === "counterargue" ? "refutar" : "mejorar redaccion"} ${payload.text}\n${context}`
  const writingEvidence = tribunalReferences.length
    ? await retrieveReferencedSnapshotEvidence({
        supabase: admin,
        references: tribunalReferences,
        question: retrievalQuestion,
        maxOut: payload.task === "counterargue" ? 8 : 6,
        perSnapshotCap: 2,
      }).catch(() => [])
    : []
  const evidenceBlock = buildEvidenceBlock(writingEvidence)
  const marcoContext = Array.isArray(marcoNotes)
    ? marcoNotes
        .map((note: any) => {
          const title = String(note?.title || "nota")
          const content = String(note?.content || "").replace(/\s+/g, " ").trim().slice(0, 700)
          return content ? `${title}: ${content}` : ""
        })
        .filter(Boolean)
        .join("\n")
    : ""
  const persistedMarcoContext = [persistedArtifacts?.summary, persistedArtifacts?.reportContent]
    .map((item) => String(item || "").replace(/\s+/g, " ").trim().slice(0, 700))
    .filter(Boolean)
    .join("\n")

  const writingGuidanceBlock = [
    context ? `Contexto entregado por usuario:\n${context}` : "",
    structuredWritingGuidance ? `Memoria estructurada del caso:\n${structuredWritingGuidance}` : "",
    persistedMarcoContext ? `Artefacto persistido del marco teorico:\n${persistedMarcoContext}` : "",
    graphContext.block ? `${graphContext.block}` : "",
    marcoContext ? `Notas relevantes del proyecto:\n${marcoContext}` : "",
    evidenceBlock ? `Evidencia tribunal priorizada:\n${evidenceBlock}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")

  const schema = {
    type: "object",
    properties: {
      revisedText: { type: "string" },
      observations: { type: "array", items: { type: "string" } },
      suggestions: { type: "array", items: { type: "string" } },
      counterArguments: { type: "array", items: { type: "string" } },
    },
    required: ["revisedText", "observations", "suggestions", "counterArguments"],
    additionalProperties: false,
  } as const

  const system =
    payload.task === "proofread"
      ? "Eres editor juridico en espanol chileno. Corriges redaccion, claridad y gramatica sin cambiar hechos ni sentido juridico. Mantienes consistencia con la estrategia de defensa del SEA y no debilitas argumentos utiles."
      : "Eres analista de litigacion ambiental. Debes proponer contraargumentos fuertes, realistas y verificables contra la tesis presentada, alineados con criterios defensivos ya identificados para el SEA."

  const prompt =
    payload.task === "proofread"
      ? `${writingGuidanceBlock || "Contexto: (sin contexto)"}\n\nTexto a revisar:\n${payload.text}\n\nInstrucciones:\n- Entrega revisedText con redaccion mejorada.\n- Conserva hechos, citas y sentido juridico.\n- Si la memoria del caso sugiere criterios utiles del SEA, mantenlos visibles y consistentes.\n- Lista observations (hallazgos de estilo o consistencia defensiva).\n- Lista suggestions accionables.\n- counterArguments debe venir vacio.`
      : `${writingGuidanceBlock || "Contexto: (sin contexto)"}\n\nTesis a refutar:\n${payload.text}\n\nInstrucciones:\n- Mantener revisedText como version pulida de la tesis (sin alterar hechos).\n- observations: debilidades detectadas.\n- suggestions: mejoras para robustecer refutacion.\n- counterArguments: 3 a 7 contraargumentos concretos.\n- Si hay criterios u outcomes en la memoria del caso, reutilizalos como base de la refutacion.\n- Si la evidencia tribunal aporta criterios concretos, usalos para que los contraargumentos sean mas consistentes con defensas reales del SEA.`

  let output: any
  let modelUsed: string | null = null
  let usage: any = null
  try {
    const generated = await generateOpenAIJson({
      system,
      prompt,
      schemaName: "writing_assistant",
      schema,
      maxCompletionTokens: payload.task === "proofread" ? 1100 : 1400,
      reasoningEffort: "minimal",
      model:
        payload.task === "proofread"
          ? resolveOpenAIWritingProofreadModel()
          : resolveOpenAIWritingCounterargueModel(),
    })
    output = generated.output
    modelUsed = generated.model
    usage = generated.usage
  } catch {
    output = payload.task === "proofread" ? fallbackProofread(payload.text) : fallbackCounterargue(payload.text)
  }

  const response = {
    revisedText: String(output?.revisedText || payload.text),
    observations: Array.isArray(output?.observations)
      ? output.observations.map((x: any) => String(x)).slice(0, 12)
      : [],
    suggestions: Array.isArray(output?.suggestions)
      ? output.suggestions.map((x: any) => String(x)).slice(0, 12)
      : [],
    counterArguments: Array.isArray(output?.counterArguments)
      ? output.counterArguments.map((x: any) => String(x)).slice(0, 12)
      : [],
    meta: {
      model: modelUsed,
      usage,
      structuredMemory: Boolean(structuredWritingGuidance),
      evidenceChunks: writingEvidence.length,
      graphRelatedRoles: graphContext.relatedRoles,
      graphRelatedQueries: graphContext.relatedQueries,
    },
  }

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "workspace.writing_assistant",
    target_resource: "gob_notes",
    details: {
        workspace_id: workspaceId,
        task: payload.task,
        text_len: payload.text.length,
        context_len: context.length,
        structured_memory: Boolean(structuredWritingGuidance),
        evidence_chunks: writingEvidence.length,
        graph_related_roles: graphContext.relatedRoles,
        graph_related_queries: graphContext.relatedQueries,
      },
    timestamp: now,
  })

  return NextResponse.json(response)
}
