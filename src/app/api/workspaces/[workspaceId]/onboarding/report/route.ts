import { NextResponse } from "next/server"
import { z } from "zod"

import { loadPersistedOnboardingArtifacts } from "@/lib/onboarding/artifacts"
import { ensureTribunalCorpusWorkspace } from "@/lib/onboarding/tribunal-corpus"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { generateOpenAIJson } from "@/lib/llm/openai-json"
import { resolveOpenAIWritingModel } from "@/lib/openai-models"
import { loadLegalGraphContext } from "@/lib/tribunal/graph-retrieval"

const ReportRequestSchema = z
  .object({
    snapshotId: z.string().uuid().optional().nullable(),
    runId: z.string().trim().min(8).max(120).optional().nullable(),
    summary: z
      .object({
        text: z.string().trim().max(20000).optional().nullable(),
      })
      .optional()
      .nullable(),
    recommendations: z
      .array(
        z
          .object({
            causeId: z.string().uuid(),
            rol: z.string().trim().max(80).optional().nullable(),
            caratula: z.string().trim().max(500).optional().nullable(),
            estado: z.string().trim().max(200).optional().nullable(),
            score: z.number().optional(),
            confidence: z.string().trim().max(20).optional().nullable(),
            reasons: z.array(z.string().trim().max(500)).max(8).optional(),
            defenseSummary: z.string().trim().max(1200).optional().nullable(),
            strategicActions: z.array(z.string().trim().max(300)).max(8).optional(),
            interestingDocuments: z
              .array(
                z
                  .object({
                    id: z.string().trim().max(120),
                    name: z.string().trim().max(300).optional().nullable(),
                    documentType: z.string().trim().max(180).optional().nullable(),
                    date: z.string().trim().max(40).optional().nullable(),
                    url: z.string().trim().url().max(2000).optional().nullable(),
                    contribution: z.string().trim().max(500).optional().nullable(),
                  })
                  .strict()
              )
              .max(6)
              .optional(),
            keyQuotes: z
              .array(
                z
                  .object({
                    quote: z.string().trim().max(600),
                    claimQuote: z.string().trim().max(600).optional().nullable(),
                    documentName: z.string().trim().max(300).optional().nullable(),
                    documentUrl: z.string().trim().url().max(2000).optional().nullable(),
                    sourceUrl: z.string().trim().url().max(2000).optional().nullable(),
                  })
                  .strict()
              )
              .max(6)
              .optional(),
          })
          .strict()
      )
      .min(1)
      .max(20),
  })
  .strict()

function safeText(value: unknown, maxLen = 300) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text
}

function isRecord(value: any): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function normalizeLine(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim()
}

function compareReports(currentText: string, previousText: string) {
  const currentLines = String(currentText || "")
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean)
  const previousLines = String(previousText || "")
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean)

  const prevSet = new Set(previousLines)
  const currSet = new Set(currentLines)

  const added = currentLines.filter((line) => !prevSet.has(line))
  const removed = previousLines.filter((line) => !currSet.has(line))

  const overlap = currentLines.filter((line) => prevSet.has(line)).length
  const base = Math.max(1, Math.max(currentLines.length, previousLines.length))
  const similarity = Number((overlap / base).toFixed(4))

  return {
    similarity,
    addedCount: added.length,
    removedCount: removed.length,
    addedPreview: added.slice(0, 6),
    removedPreview: removed.slice(0, 6),
  }
}

function buildFallbackStructured(data: z.infer<typeof ReportRequestSchema>) {
  const causes = (data.recommendations || []).slice(0, 8).map((rec, idx) => {
    const docs = (rec.interestingDocuments || []).slice(0, 3)
    return {
      index: idx + 1,
      rol: rec.rol || "(sin rol)",
      whySelected:
        rec.reasons?.[0] ||
        rec.defenseSummary ||
        "Fue priorizada por coincidencia tematica y respaldo documental util para defensa.",
      defenseContribution:
        rec.defenseSummary ||
        "Contribuye a estructurar argumentos, anticipar riesgos y reforzar trazabilidad probatoria.",
      keyDocumentUsage: docs.map(
        (doc) => `${doc.name || doc.documentType || "Documento"}: ${doc.contribution || "Referencia util para soporte de defensa."}`
      ),
      criticalSimilarity: (rec.keyQuotes || []).slice(0, 2).map((q) => {
        const claim = q.claimQuote ? `Reclamacion: "${safeText(q.claimQuote, 180)}"` : "Reclamacion: (no disponible)"
        const precedent = `Precedente: "${safeText(q.quote, 180)}"`
        return `${claim} | ${precedent}`
      }),
      whereToCite: (rec.keyQuotes || []).slice(0, 2).map((q) => q.documentUrl || q.sourceUrl || "sin link"),
      risks:
        rec.confidence === "baja"
          ? "Usar con cautela; requiere corroboracion adicional para sostenerla como eje central."
          : "Verificar contexto factico/procesal para evitar analogias sobreextendidas.",
      priority: rec.confidence || "media",
    }
  })

  return {
    executiveSummary:
      data.summary?.text ||
      "Se priorizaron causas con mayor afinidad para defensa, destacando documentos y similitudes textuales que pueden reforzar la estrategia.",
    defenseHypothesis:
      "La defensa mejora cuando integra precedentes comparables, citas directas verificables y una secuencia argumental coherente por etapa procesal.",
    comparableFacts: causes
      .slice(0, 4)
      .map((x) => `${x.rol}: ${x.criticalSimilarity?.[0] || "Coincidencias facticas relevantes detectadas."}`),
    usefulCriteria: causes
      .slice(0, 4)
      .map((x) => `${x.rol}: ${x.keyDocumentUsage?.[0] || "Criterio util para estructurar defensa."}`),
    misuseRisks: causes
      .slice(0, 4)
      .map((x) => `${x.rol}: ${x.risks}`),
    draftParagraphs: causes.slice(0, 3).map((x) => {
      return `Respecto de ${x.rol}, la jurisprudencia comparada sugiere que ${safeText(
        x.defenseContribution,
        380
      )} En consecuencia, corresponde reforzar la trazabilidad probatoria y la compatibilidad procesal antes de su cita como precedente principal.`
    }),
    causeAnalyses: causes,
    immediateActions: [
      "Revisar primero evacua informe/informe del SEA, luego sentencia o resolucion final, y dejar la reclamacion como contexto.",
      "Extraer citas textuales de mayor impacto para la estructura de defensa.",
      "Validar que cada precedente tenga compatibilidad factica y temporal con la causa actual.",
    ],
  }
}

function structuredToMarkdown(structured: any, data: z.infer<typeof ReportRequestSchema>) {
  const lines: string[] = []
  lines.push("# Informe automatico de marco teorico")
  lines.push("")
  lines.push("## Resumen ejecutivo")
  lines.push(structured.executiveSummary || "")
  lines.push("")
  lines.push("## Hipotesis de defensa")
  lines.push(structured.defenseHypothesis || "")
  lines.push("")

  if (Array.isArray(structured.comparableFacts) && structured.comparableFacts.length) {
    lines.push("## Hechos comparables")
    structured.comparableFacts.slice(0, 8).forEach((x: string) => lines.push(`- ${safeText(x, 700)}`))
    lines.push("")
  }

  if (Array.isArray(structured.usefulCriteria) && structured.usefulCriteria.length) {
    lines.push("## Criterios utiles")
    structured.usefulCriteria.slice(0, 8).forEach((x: string) => lines.push(`- ${safeText(x, 700)}`))
    lines.push("")
  }

  if (Array.isArray(structured.misuseRisks) && structured.misuseRisks.length) {
    lines.push("## Riesgos por mal uso")
    structured.misuseRisks.slice(0, 8).forEach((x: string) => lines.push(`- ${safeText(x, 700)}`))
    lines.push("")
  }

  if (Array.isArray(structured.draftParagraphs) && structured.draftParagraphs.length) {
    lines.push("## Parrafos borrador para escrito/informe")
    structured.draftParagraphs.slice(0, 6).forEach((x: string) => {
      lines.push(safeText(x, 1200))
      lines.push("")
    })
  }

  lines.push("## Analisis por causa")

  const recByRol = new Map(
    (data.recommendations || []).map((rec) => [String(rec.rol || ""), rec])
  )

  for (const item of structured.causeAnalyses || []) {
    const rol = String(item.rol || "(sin rol)")
    const rec = recByRol.get(rol)
    lines.push(`### ${item.index || ""}. ${rol}`)
    lines.push(`- Prioridad: ${safeText(item.priority || "media", 20)}`)
    lines.push(`- Por que se eligio: ${safeText(item.whySelected, 700)}`)
    lines.push(`- Aporte a defensa: ${safeText(item.defenseContribution, 900)}`)

    const keyUsage = Array.isArray(item.keyDocumentUsage) ? item.keyDocumentUsage.slice(0, 4) : []
    if (keyUsage.length) {
      lines.push("- Uso de documentos:")
      keyUsage.forEach((x: string) => lines.push(`  - ${safeText(x, 600)}`))
    }

    const sims = Array.isArray(item.criticalSimilarity) ? item.criticalSimilarity.slice(0, 3) : []
    if (sims.length) {
      lines.push("- Similitudes relevantes:")
      sims.forEach((x: string) => lines.push(`  - ${safeText(x, 700)}`))
    }

    const cites = Array.isArray(item.whereToCite) ? item.whereToCite.slice(0, 3) : []
    if (cites.length) {
      lines.push("- Donde citar:")
      cites.forEach((x: string) => lines.push(`  - ${safeText(x, 700)}`))
    }

    if (rec?.interestingDocuments?.length) {
      lines.push("- Links a documentos clave:")
      rec.interestingDocuments.slice(0, 3).forEach((doc) => {
        const label = doc.name || doc.documentType || "Documento"
        lines.push(`  - ${label}${doc.url ? ` -> ${doc.url}` : ""}`)
      })
    }

    lines.push(`- Riesgo/cautela: ${safeText(item.risks, 700)}`)
    lines.push("")
  }

  lines.push("## Plan de accion inmediato")
  const actions = Array.isArray(structured.immediateActions) ? structured.immediateActions : []
  actions.slice(0, 8).forEach((x: string, idx: number) => lines.push(`${idx + 1}. ${safeText(x, 400)}`))

  return lines.join("\n").trim()
}

async function saveReportVersion(params: {
  supabase: any
  workspaceId: string
  userId: string
  runId: string | null
  report: {
    title: string
    content: string
    structured: any
    noteId: string
    generatedAt: string
  }
}) {
  const { supabase, workspaceId, userId, runId, report } = params
  const { data: profile } = await supabase
    .from("gob_workspace_profiles")
    .select("workspace_id,metadata")
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  const metadataBase = isRecord(profile?.metadata) ? profile.metadata : {}
  const onboardingBase = isRecord(metadataBase?.onboarding) ? metadataBase.onboarding : {}
  const previousVersions = Array.isArray(onboardingBase?.report_versions) ? onboardingBase.report_versions : []

  const previous = previousVersions.length ? previousVersions[previousVersions.length - 1] : null
  const previousText = isRecord(previous) ? String(previous?.content || "") : ""
  const comparison = previousText ? compareReports(report.content, previousText) : null

  const versionEntry = {
    version_id: `rep_${Date.now()}`,
    run_id: runId,
    note_id: report.noteId,
    title: report.title,
    content: report.content,
    structured: report.structured,
    generated_at: report.generatedAt,
    generated_by: userId,
    comparison,
  }

  const mergedMetadata = {
    ...metadataBase,
    onboarding: {
      ...onboardingBase,
      last_report_note_id: report.noteId,
      last_report_at: report.generatedAt,
      report_versions: [...previousVersions, versionEntry].slice(-15),
    },
  }

  if (!profile?.workspace_id) {
    await supabase.from("gob_workspace_profiles").insert({
      workspace_id: workspaceId,
      created_at: report.generatedAt,
      updated_at: report.generatedAt,
      created_by: userId,
      metadata: mergedMetadata,
    })
  } else {
    await supabase
      .from("gob_workspace_profiles")
      .update({ metadata: mergedMetadata, updated_at: report.generatedAt })
      .eq("workspace_id", workspaceId)
  }

  return {
    currentVersionId: String(versionEntry.version_id),
    previousVersionId: previous && isRecord(previous) ? String(previous.version_id || "") || null : null,
    comparison,
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
  const parsed = ReportRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const payload = parsed.data
  const admin = createAdminClient()
  const persistedArtifacts = await loadPersistedOnboardingArtifacts({
    supabase,
    workspaceId,
  }).catch(() => null)
  const corpus = await ensureTribunalCorpusWorkspace(admin).catch(() => null)
  const graphRoleTokens = Array.from(
    new Set(
      (payload.recommendations || [])
        .slice(0, 6)
        .map((rec) => String(rec.rol || "").trim())
        .filter(Boolean)
    )
  )
  const graphContext = await loadLegalGraphContext({
    admin,
    workspaceId: corpus?.id || workspaceId,
    question: `${payload.summary?.text || ""} marco teorico defensa sea precedentes utiles`,
    roleTokens: graphRoleTokens,
    limit: 6,
  }).catch(() => ({ block: "", relatedRoles: [] as string[], relatedQueries: [] as string[] }))
  const compactPayload = {
    summary: payload.summary?.text || "",
    persistedSummary: persistedArtifacts?.summary || "",
    graphContext: graphContext.block || "",
    recommendations: payload.recommendations.map((rec) => ({
      rol: rec.rol,
      caratula: rec.caratula,
      estado: rec.estado,
      score: rec.score,
      confidence: rec.confidence,
      reasons: rec.reasons || [],
      defenseSummary: rec.defenseSummary,
      strategicActions: rec.strategicActions || [],
      docs: (rec.interestingDocuments || []).slice(0, 3),
      quotes: (rec.keyQuotes || []).slice(0, 2),
    })),
  }

  const schema = {
    type: "object",
    properties: {
      executiveSummary: { type: "string" },
      defenseHypothesis: { type: "string" },
      comparableFacts: { type: "array", items: { type: "string" } },
      usefulCriteria: { type: "array", items: { type: "string" } },
      misuseRisks: { type: "array", items: { type: "string" } },
      draftParagraphs: { type: "array", items: { type: "string" } },
      causeAnalyses: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "number" },
            rol: { type: "string" },
            whySelected: { type: "string" },
            defenseContribution: { type: "string" },
            keyDocumentUsage: { type: "array", items: { type: "string" } },
            criticalSimilarity: { type: "array", items: { type: "string" } },
            whereToCite: { type: "array", items: { type: "string" } },
            risks: { type: "string" },
            priority: { type: "string" },
          },
          required: [
            "index",
            "rol",
            "whySelected",
            "defenseContribution",
            "keyDocumentUsage",
            "criticalSimilarity",
            "whereToCite",
            "risks",
            "priority",
          ],
          additionalProperties: false,
        },
      },
      immediateActions: { type: "array", items: { type: "string" } },
    },
    required: [
      "executiveSummary",
      "defenseHypothesis",
      "comparableFacts",
      "usefulCriteria",
      "misuseRisks",
      "draftParagraphs",
      "causeAnalyses",
      "immediateActions",
    ],
    additionalProperties: false,
  } as const

  let structured: any
  try {
    const generated = await generateOpenAIJson({
      system:
        "Eres analista juridico ambiental. Debes construir un informe util para defensa, priorizando claridad, aplicabilidad y evidencia trazable.",
      prompt:
        "Genera un informe automatico de marco teorico para defensa usando solo estos datos. " +
        "No inventes hechos fuera de la entrada. Debe incluir exactamente estas secciones: hechos comparables, criterios utiles, riesgos por mal uso, parrafos borrador para escrito/informe y analisis por causa con donde citar.\n\n" +
        (graphContext.block ? `Contexto del grafo legal:\n${graphContext.block}\n\n` : "") +
        JSON.stringify(compactPayload),
      schemaName: "onboarding_defense_report",
      schema,
      maxCompletionTokens: 2400,
      reasoningEffort: "minimal",
      model: resolveOpenAIWritingModel(),
    })

    structured = generated.output
  } catch {
    structured = buildFallbackStructured(payload)
  }

  const content = structuredToMarkdown(structured, payload)
  const citations = payload.recommendations
    .flatMap((rec) => rec.keyQuotes || [])
    .slice(0, 40)
    .map((q) => ({
      chunkId: null,
      quote: q.quote,
      sourceUrl: q.documentUrl || q.sourceUrl || null,
      snapshotId: payload.snapshotId || null,
      page: null,
      section: null,
    }))

  const now = new Date().toISOString()
  const { data: note, error: noteErr } = await supabase
    .from("gob_notes")
    .insert({
      workspace_id: workspaceId,
      title: "Informe automatico de marco teorico",
      content,
      citations,
      visibility: "shared",
      created_by: user.id,
      created_at: now,
    })
    .select("id")
    .single()

  if (noteErr) {
    return NextResponse.json({ error: noteErr.message }, { status: 500 })
  }

  const versions = await saveReportVersion({
    supabase,
    workspaceId,
    userId: user.id,
    runId: payload.runId ? String(payload.runId) : null,
    report: {
      title: "Informe automatico de marco teorico",
      content,
      structured,
      noteId: String(note.id),
      generatedAt: now,
    },
  }).catch(() => ({ currentVersionId: null, previousVersionId: null, comparison: null }))

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "workspace.onboarding.report",
    target_resource: "gob_notes",
    details: {
      workspace_id: workspaceId,
      note_id: note.id,
      recommendations: payload.recommendations.length,
      snapshot_id: payload.snapshotId || null,
      run_id: payload.runId || null,
      report_version_id: versions.currentVersionId,
      persisted_artifact_version_id: persistedArtifacts?.versionId ?? null,
      persisted_artifact_version_count: persistedArtifacts?.versionCount ?? null,
      graph_related_roles: graphContext.relatedRoles,
      graph_related_queries: graphContext.relatedQueries,
    },
    timestamp: now,
  })

  return NextResponse.json({
    status: "ready",
    noteId: String(note.id),
    generatedAt: now,
    report: {
      title: "Informe automatico de marco teorico",
      content,
      structured,
    },
    versions,
  })
}
