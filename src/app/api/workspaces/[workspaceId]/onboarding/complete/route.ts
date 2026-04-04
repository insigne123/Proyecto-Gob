import { NextResponse } from "next/server"
import { z } from "zod"

import { savePersistedOnboardingArtifacts } from "@/lib/onboarding/artifacts"
import { createAdminClient } from "@/lib/supabase/admin"
import { buildStructuredOnboardingMemory } from "@/lib/onboarding/structured-memory"
import { createClient } from "@/lib/supabase/server"
import { persistOnboardingLegalGraph } from "@/lib/tribunal/graph-persistence"
import { selectDefenseDocumentMix } from "@/lib/tribunal/defense-document-policy"

const CitationSchema = z
  .object({
    chunkId: z.string().trim().min(1).max(120),
    quote: z.string().trim().min(1).max(1200),
    sourceUrl: z.string().trim().url().max(2000).optional().nullable(),
    snapshotId: z.string().trim().max(120).optional().nullable(),
    page: z.number().int().nullable().optional(),
    section: z.string().trim().max(200).optional().nullable(),
  })
  .strict()

const SelectedDocumentSchema = z
  .object({
    id: z.string().trim().max(120).optional().nullable(),
    name: z.string().trim().max(240).optional().nullable(),
    url: z.string().trim().url().max(2000).optional().nullable(),
    contribution: z.string().trim().max(1200).optional().nullable(),
    documentType: z.string().trim().max(120).optional().nullable(),
    docRole: z.string().trim().max(80).optional().nullable(),
    date: z.string().trim().max(80).optional().nullable(),
  })
  .strict()

const RecommendationSchema = z
  .object({
    causeId: z.string().trim().uuid(),
    rol: z.string().trim().max(80).optional().nullable(),
    score: z.number().optional().nullable(),
    reason: z.string().trim().max(500).optional().nullable(),
    confidence: z.string().trim().max(40).optional().nullable(),
    defenseSummary: z.string().trim().max(1200).optional().nullable(),
    interestingDocuments: z.array(SelectedDocumentSchema).max(8).optional(),
    selectedDocuments: z.array(SelectedDocumentSchema).max(8).optional(),
  })
  .strict()

const MatrixRowSchema = z
  .object({
    causeId: z.string().trim().uuid(),
    rol: z.string().trim().max(120).optional().nullable(),
    confidence: z.string().trim().max(40).optional().nullable(),
    riskLevel: z.string().trim().max(40).optional().nullable(),
    score: z.number().optional().nullable(),
    document: z
      .object({
        id: z.string().trim().max(120).optional().nullable(),
        name: z.string().trim().max(240).optional().nullable(),
        url: z.string().trim().url().max(2000).optional().nullable(),
        contribution: z.string().trim().max(1200).optional().nullable(),
        documentType: z.string().trim().max(120).optional().nullable(),
        docRole: z.string().trim().max(80).optional().nullable(),
      })
      .optional()
      .nullable(),
    whereToCite: z
      .object({
        findingId: z.string().trim().max(120).optional().nullable(),
        quote: z.string().trim().max(1200).optional().nullable(),
        claimQuote: z.string().trim().max(1200).optional().nullable(),
        similarityType: z.string().trim().max(80).optional().nullable(),
        similarityTypeLabel: z.string().trim().max(120).optional().nullable(),
        commonTerms: z.array(z.string().trim().max(120)).max(20).optional(),
        documentUrl: z.string().trim().url().max(2000).optional().nullable(),
      })
      .optional()
      .nullable(),
  })
  .strict()

const ReportSchema = z
  .object({
    title: z.string().trim().max(220).optional().nullable(),
    content: z.string().trim().max(100000).optional().nullable(),
    structured: z.record(z.any()).optional().nullable(),
  })
  .strict()

const CompleteSchema = z
  .object({
    snapshotId: z.string().uuid().optional().nullable(),
    runId: z.string().uuid().optional().nullable(),
    summary: z.string().trim().max(20000).optional().nullable(),
    summaryCitations: z.array(CitationSchema).max(60).optional(),
    recommendations: z.array(RecommendationSchema).max(25).optional(),
    matrix: z.array(MatrixRowSchema).max(25).optional(),
    report: ReportSchema.optional().nullable(),
  })
  .strict()

function safeText(value: unknown, maxLen = 5000) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text
}

function listItems(value: unknown, max = 8) {
  if (!Array.isArray(value)) return [] as string[]
  return value
    .map((x) => safeText(x, 900))
    .filter(Boolean)
    .slice(0, max)
}

function normalizeSelectedDocument(value: any) {
  const id = value?.id ? String(value.id) : null
  const name = value?.name ? String(value.name) : null
  const url = value?.url ? String(value.url) : null
  const contribution = value?.contribution ? safeText(value.contribution, 500) : null
  const documentType = value?.documentType ? String(value.documentType) : value?.document_type ? String(value.document_type) : null
  const docRole = value?.docRole ? String(value.docRole) : value?.doc_role ? String(value.doc_role) : null
  if (!id && !name && !url && !contribution) return null
  return {
    id,
    name,
    url,
    contribution,
    documentType,
    docRole,
  }
}

function normalizeRunRecommendation(value: any) {
  const causeId = value?.causeId ? String(value.causeId) : value?.cause_id ? String(value.cause_id) : ""
  if (!causeId) return null
  const selectedDocuments = Array.isArray(value?.selectedDocuments)
    ? value.selectedDocuments.map(normalizeSelectedDocument).filter(Boolean)
    : Array.isArray(value?.selected_documents)
      ? value.selected_documents.map(normalizeSelectedDocument).filter(Boolean)
      : Array.isArray(value?.interestingDocuments)
        ? value.interestingDocuments.map(normalizeSelectedDocument).filter(Boolean)
        : []

  return {
    causeId,
    rol: value?.rol ? String(value.rol) : null,
    score: typeof value?.score === "number" ? Number(value.score) : null,
    reason: value?.reason ? safeText(value.reason, 500) : value?.utility_reason ? safeText(value.utility_reason, 500) : null,
    confidence: value?.confidence ? String(value.confidence) : null,
    defenseSummary: value?.defenseSummary ? safeText(value.defenseSummary, 1000) : value?.defense_summary ? safeText(value.defense_summary, 1000) : null,
    selectedDocuments,
  }
}

function enrichCompletePayloadFromRun(params: {
  payload: z.infer<typeof CompleteSchema>
  onboardingBase: any
}) {
  const runId = String(params.payload.runId || "").trim()
  const runs =
    params.onboardingBase?.analysis_runs && typeof params.onboardingBase.analysis_runs === "object"
      ? params.onboardingBase.analysis_runs
      : {}
  const runPayload = runId && runs && typeof runs[runId] === "object" ? runs[runId] : null
  if (!runPayload) return params.payload

  const runRecommendations = Array.isArray((runPayload as any)?.recommendations)
    ? ((runPayload as any).recommendations.map(normalizeRunRecommendation).filter(Boolean) as any[])
    : []
  const runRecommendationsByCause = new Map(
    runRecommendations.map((row: any) => [String(row.causeId), row])
  )

  const payloadRecommendations = Array.isArray(params.payload.recommendations) ? params.payload.recommendations : []
  const mergedRecommendations = (payloadRecommendations.length ? payloadRecommendations : runRecommendations).map((row: any) => {
    const causeId = String(row?.causeId || row?.cause_id || "")
    const runRow = runRecommendationsByCause.get(causeId) || null
    const selectedDocuments = Array.isArray(row?.selectedDocuments)
      ? row.selectedDocuments.map(normalizeSelectedDocument).filter(Boolean)
      : Array.isArray(row?.interestingDocuments)
        ? row.interestingDocuments.map(normalizeSelectedDocument).filter(Boolean)
        : Array.isArray((runRow as any)?.selectedDocuments)
          ? (runRow as any).selectedDocuments
          : []

    return {
      causeId,
      rol: row?.rol ? String(row.rol) : (runRow as any)?.rol || null,
      score: typeof row?.score === "number" ? row.score : (runRow as any)?.score || null,
      reason: row?.reason ? safeText(row.reason, 500) : (runRow as any)?.reason || null,
      confidence: row?.confidence ? String(row.confidence) : (runRow as any)?.confidence || null,
      defenseSummary:
        row?.defenseSummary ? safeText(row.defenseSummary, 1000) : (runRow as any)?.defenseSummary || null,
      selectedDocuments,
    }
  })

  return {
    ...params.payload,
    recommendations: mergedRecommendations,
  }
}

function collectPersistableDocuments(payload: z.infer<typeof CompleteSchema>) {
  const byKey = new Map<string, any>()
  const pushDoc = (value: {
    causeId?: string | null
    rol?: string | null
    documentId?: string | null
    name?: string | null
    url?: string | null
    docRole?: string | null
    documentType?: string | null
    contribution?: string | null
  }) => {
    const key = [value.documentId || "", value.docRole || value.documentType || "", value.name || "", value.rol || ""].join("|").toLowerCase()
    if (!key || byKey.has(key)) return
    byKey.set(key, {
      causeId: value.causeId ? String(value.causeId) : null,
      rol: value.rol ? String(value.rol) : null,
      documentId: value.documentId ? String(value.documentId) : null,
      name: value.name ? String(value.name) : null,
      url: value.url ? String(value.url) : null,
      docRole: value.docRole ? String(value.docRole) : null,
      documentType: value.documentType ? String(value.documentType) : null,
      contribution: value.contribution ? safeText(value.contribution, 500) : null,
    })
  }

  for (const recommendation of payload.recommendations || []) {
    const docs = Array.isArray((recommendation as any)?.selectedDocuments)
      ? (recommendation as any).selectedDocuments
      : Array.isArray((recommendation as any)?.interestingDocuments)
        ? (recommendation as any).interestingDocuments
        : []
    for (const document of docs) {
      const normalized = normalizeSelectedDocument(document)
      if (!normalized) continue
      pushDoc({
        causeId: (recommendation as any)?.causeId ? String((recommendation as any).causeId) : null,
        rol: (recommendation as any)?.rol ? String((recommendation as any).rol) : null,
        documentId: normalized.id,
        name: normalized.name,
        url: normalized.url,
        docRole: normalized.docRole,
        documentType: normalized.documentType,
        contribution: normalized.contribution || (recommendation as any)?.defenseSummary || null,
      })
    }
  }

  for (const row of payload.matrix || []) {
    const document = row?.document || null
    if (!document) continue
    pushDoc({
      causeId: row?.causeId ? String(row.causeId) : null,
      rol: row?.rol ? String(row.rol) : null,
      documentId: document?.id ? String(document.id) : null,
      name: document?.name ? String(document.name) : null,
      url: document?.url ? String(document.url) : null,
      docRole: document?.docRole ? String(document.docRole) : null,
      documentType: document?.documentType ? String(document.documentType) : null,
      contribution: document?.contribution ? String(document.contribution) : null,
    })
  }

  return Array.from(byKey.values())
}

function prioritizeTribunalReferences(references: any[]) {
  const rows = Array.isArray(references) ? references : []
  if (!rows.length) return [] as any[]
  const withIds = rows.map((ref, idx) => ({
    ...ref,
    id: ref?.snapshotId ? String(ref.snapshotId) : `ref-${idx}`,
    document_type: ref?.docType ? String(ref.docType) : null,
    name: ref?.documentName ? String(ref.documentName) : ref?.sourceTitle ? String(ref.sourceTitle) : null,
    title: ref?.sourceTitle ? String(ref.sourceTitle) : ref?.documentName ? String(ref.documentName) : null,
  }))
  const selected = selectDefenseDocumentMix(withIds, {
    preferredRoles: ["informe", "sentencia", "reclamacion"],
    limit: Math.min(8, withIds.length || 8),
    requireCorePair: true,
    maxContextReclamaciones: 1,
  }).selected
  const selectedIds = new Set(selected.map((row: any) => String(row.id || "")))
  return [...selected, ...withIds.filter((row) => !selectedIds.has(String(row.id || "")))]
    .slice(0, 16)
    .map(({ id, document_type, name, title, ...ref }) => ref)
}

async function buildOnboardingTribunalReferences(params: {
  admin: any
  payload: z.infer<typeof CompleteSchema>
}) {
  const { admin, payload } = params

  const refsBySnapshot = new Map<
    string,
    {
      snapshotId: string
      sourceId: string | null
      sourceTitle: string | null
      docType: string | null
      docRole: string | null
      rol: string | null
      causeId: string | null
      documentId: string | null
      documentName: string | null
      documentUrl: string | null
      sampleQuote: string | null
      sourceUrl: string | null
    }
  >()

  for (const citation of payload.summaryCitations || []) {
    const snapshotId = String(citation?.snapshotId || "").trim()
    if (!snapshotId) continue
    refsBySnapshot.set(snapshotId, {
      snapshotId,
      sourceId: null,
      sourceTitle: null,
      docType: null,
      docRole: null,
      rol: null,
      causeId: null,
      documentId: null,
      documentName: null,
      documentUrl: null,
      sampleQuote: citation.quote ? safeText(citation.quote, 260) : null,
      sourceUrl: citation.sourceUrl ? String(citation.sourceUrl) : null,
    })
  }

  const persistableDocuments = collectPersistableDocuments(payload)
  const documentsById = new Map<string, any>()
  for (const document of persistableDocuments) {
    const documentId = String(document?.documentId || "").trim()
    if (!documentId || documentsById.has(documentId)) continue
    documentsById.set(documentId, document)
  }

  const documentIds = Array.from(documentsById.keys()).slice(0, 80)
  if (!documentIds.length) {
    return prioritizeTribunalReferences(Array.from(refsBySnapshot.values()))
  }

  const { data: corpusSources, error: sourceErr } = await admin
    .from("gob_sources")
    .select("id,workspace_id,title,doc_type,attributes,url")
    .eq("source_origin", "tribunal-corpus")
    .limit(4000)

  if (sourceErr) {
    return prioritizeTribunalReferences(Array.from(refsBySnapshot.values()))
  }

  const matchedSources = (corpusSources || []).filter((row: any) => {
    const attrs = row?.attributes && typeof row.attributes === "object" ? row.attributes : {}
    return documentIds.includes(String(attrs?.tribunal_document_id || ""))
  })

  const sourceIds = matchedSources.map((row: any) => String(row.id)).filter(Boolean)
  const snapshotBySourceId = new Map<string, string>()
  if (sourceIds.length) {
    const { data: snapshots, error: snapshotErr } = await admin
      .from("gob_source_snapshots")
      .select("id,source_id,status")
      .in("source_id", sourceIds)
      .eq("status", "ready")
      .order("created_at", { ascending: false })

    if (!snapshotErr) {
      for (const row of snapshots || []) {
        const sourceId = String((row as any)?.source_id || "")
        if (sourceId && !snapshotBySourceId.has(sourceId)) {
          snapshotBySourceId.set(sourceId, String((row as any)?.id || ""))
        }
      }
    }
  }

  for (const source of matchedSources) {
    const attrs = source?.attributes && typeof source.attributes === "object" ? source.attributes : {}
    const snapshotId = snapshotBySourceId.get(String(source.id)) || ""
    if (!snapshotId) continue

    const selectedDoc = documentsById.get(String(attrs?.tribunal_document_id || "")) || null
    const existing = refsBySnapshot.get(snapshotId)
    refsBySnapshot.set(snapshotId, {
      snapshotId,
      sourceId: String(source.id),
      sourceTitle: source?.title ? String(source.title) : existing?.sourceTitle || null,
      docType:
        source?.doc_type ? String(source.doc_type) : selectedDoc?.documentType || existing?.docType || null,
      docRole: selectedDoc?.docRole || (attrs?.doc_role ? String(attrs.doc_role) : existing?.docRole || null),
      rol: selectedDoc?.rol || (attrs?.rol ? String(attrs.rol) : existing?.rol || null),
      causeId:
        selectedDoc?.causeId || (attrs?.tribunal_cause_id ? String(attrs.tribunal_cause_id) : existing?.causeId || null),
      documentId: attrs?.tribunal_document_id ? String(attrs.tribunal_document_id) : existing?.documentId || null,
      documentName:
        selectedDoc?.name ? String(selectedDoc.name) : source?.title ? String(source.title) : existing?.documentName || null,
      documentUrl:
        selectedDoc?.url ? String(selectedDoc.url) : source?.url ? String(source.url) : existing?.documentUrl || null,
      sampleQuote: existing?.sampleQuote || null,
      sourceUrl: existing?.sourceUrl || null,
    })
  }

  return prioritizeTribunalReferences(Array.from(refsBySnapshot.values()))
}

function buildDraftNote(payload: z.infer<typeof CompleteSchema>) {
  const lines: string[] = []
  lines.push("Borrador inicial para informe evacuado")
  lines.push("")
  lines.push("Este borrador se genera automaticamente desde el marco teorico y requiere revision juridica del equipo.")
  lines.push("")

  const structured = payload.report?.structured && typeof payload.report.structured === "object"
    ? payload.report.structured
    : null

  if (structured && typeof structured.executiveSummary === "string") {
    lines.push("1) Resumen ejecutivo")
    lines.push(safeText(structured.executiveSummary, 2500))
    lines.push("")
  }

  if (structured && typeof structured.defenseHypothesis === "string") {
    lines.push("2) Hipotesis de defensa")
    lines.push(safeText(structured.defenseHypothesis, 2500))
    lines.push("")
  }

  const facts = listItems((structured as any)?.comparableFacts, 8)
  if (facts.length) {
    lines.push("3) Hechos comparables")
    facts.forEach((item) => lines.push(`- ${item}`))
    lines.push("")
  }

  const criteria = listItems((structured as any)?.usefulCriteria, 8)
  if (criteria.length) {
    lines.push("4) Criterios utiles")
    criteria.forEach((item) => lines.push(`- ${item}`))
    lines.push("")
  }

  const risks = listItems((structured as any)?.misuseRisks, 8)
  if (risks.length) {
    lines.push("5) Riesgos por mal uso")
    risks.forEach((item) => lines.push(`- ${item}`))
    lines.push("")
  }

  const drafts = listItems((structured as any)?.draftParagraphs, 5)
  if (drafts.length) {
    lines.push("6) Parrafos borrador")
    drafts.forEach((item, idx) => {
      lines.push(`${idx + 1}. ${item}`)
      lines.push("")
    })
  }

  const matrix = Array.isArray(payload.matrix) ? payload.matrix.slice(0, 10) : []
  if (matrix.length) {
    lines.push("7) Matriz causa-documento-aporte")
    matrix.forEach((row, idx) => {
      lines.push(`${idx + 1}. ${row.rol || "(sin rol)"} | Riesgo: ${row.riskLevel || "N/A"} | Confianza: ${(row.confidence || "N/A").toUpperCase()}`)
      if (row.document?.name) lines.push(`   Documento clave: ${safeText(row.document.name, 260)}`)
      if (row.document?.contribution) lines.push(`   Aporte: ${safeText(row.document.contribution, 800)}`)
      if (row.whereToCite?.similarityTypeLabel) lines.push(`   Donde citar (${row.whereToCite.similarityTypeLabel}): ${safeText(row.whereToCite.quote || "", 320)}`)
      if (row.whereToCite?.documentUrl) lines.push(`   Link cita: ${row.whereToCite.documentUrl}`)
    })
    lines.push("")
  }

  if (payload.report?.content) {
    lines.push("8) Referencia del informe automatico")
    lines.push(safeText(payload.report.content, 7000))
    lines.push("")
  }

  return safeText(lines.join("\n").trim(), 20000)
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
  const parsed = CompleteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { data: profile, error: profileErr } = await supabase
    .from("gob_workspace_profiles")
    .select("workspace_id,metadata")
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 })
  }

  const metadataBase =
    profile?.metadata && typeof profile.metadata === "object" && !Array.isArray(profile.metadata)
      ? profile.metadata
      : {}
  const onboardingBase =
    metadataBase?.onboarding && typeof metadataBase.onboarding === "object"
      ? metadataBase.onboarding
      : {}

  const payload = enrichCompletePayloadFromRun({
    payload: parsed.data,
    onboardingBase,
  })
  const now = new Date().toISOString()
  const admin = createAdminClient()
  const tribunalReferences = await buildOnboardingTribunalReferences({ admin, payload }).catch(() => [])
  const structuredMemory = buildStructuredOnboardingMemory(payload)

  const mergedMetadata = {
    ...metadataBase,
    onboarding: {
      ...onboardingBase,
      required: true,
      completed: true,
      completed_at: now,
      version: 1,
      completed_run_id: payload.runId ?? onboardingBase?.completed_run_id ?? null,
      claim_snapshot_id: payload.snapshotId ?? onboardingBase?.claim_snapshot_id ?? null,
      recommendations_count: Array.isArray(payload.recommendations)
        ? payload.recommendations.length
        : onboardingBase?.recommendations_count ?? null,
      tribunal_references: tribunalReferences,
      tribunal_reference_snapshot_ids: tribunalReferences.map((ref: any) => ref.snapshotId).filter(Boolean),
      structured_memory: structuredMemory,
    },
  }

  if (!profile?.workspace_id) {
    const { error: insertErr } = await supabase.from("gob_workspace_profiles").insert({
      workspace_id: workspaceId,
      created_at: now,
      updated_at: now,
      created_by: user.id,
      metadata: mergedMetadata,
    })

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }
  } else {
    const { error: updateErr } = await supabase
      .from("gob_workspace_profiles")
      .update({ metadata: mergedMetadata, updated_at: now })
      .eq("workspace_id", workspaceId)

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }
  }

  const persistedArtifactVersion = await savePersistedOnboardingArtifacts({
    admin,
    workspaceId,
    userId: user.id,
    runId: payload.runId ?? onboardingBase?.completed_run_id ?? null,
    claimSnapshotId: payload.snapshotId ?? onboardingBase?.claim_snapshot_id ?? null,
    summary: payload.summary ?? null,
    reportContent: payload.report?.content ?? null,
    structuredMemory,
    tribunalReferences,
    recommendations: payload.recommendations || [],
    matrix: payload.matrix || [],
    metadata: {
      source: "onboarding_complete",
      saved_summary_note: Boolean(payload.summary),
      has_report_content: Boolean(payload.report?.content),
    },
  }).catch(() => null)

  await persistOnboardingLegalGraph({
    admin,
    workspaceId,
    structuredMemory,
    tribunalReferences,
  }).catch(() => null)

  if (payload.summary) {
    const recommendationLines = (payload.recommendations || [])
      .slice(0, 12)
      .map((rec, idx) => {
        const rol = rec.rol || "(sin rol)"
        const score = typeof rec.score === "number" ? ` [score ${rec.score.toFixed(3)}]` : ""
        const reason = rec.reason ? ` - ${safeText(rec.reason, 180)}` : ""
        return `${idx + 1}. ${rol}${score}${reason}`
      })

    const noteContent = [
      payload.summary,
      recommendationLines.length ? "\n\nCausas recomendadas:\n" : "",
      recommendationLines.join("\n"),
    ]
      .join("")
      .trim()

    await supabase.from("gob_notes").insert({
      workspace_id: workspaceId,
      title: "Marco teorico inicial",
      content: safeText(noteContent, 20000),
      citations: payload.summaryCitations || [],
      visibility: "shared",
      created_by: user.id,
      created_at: now,
    })
  }

  let savedDraftNote = false
  if (payload.report?.content || (Array.isArray(payload.matrix) && payload.matrix.length > 0)) {
    const draftContent = buildDraftNote(payload)
    if (draftContent) {
      const { error: draftErr } = await supabase.from("gob_notes").insert({
        workspace_id: workspaceId,
        title: "Borrador inicial de informe (auto)",
        content: draftContent,
        citations: payload.summaryCitations || [],
        visibility: "shared",
        created_by: user.id,
        created_at: now,
      })
      savedDraftNote = !draftErr
    }
  }

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "workspace.onboarding.complete",
    target_resource: "gob_workspace_profiles",
    details: {
      workspace_id: workspaceId,
      claim_snapshot_id: payload.snapshotId ?? null,
      recommendations_count: payload.recommendations?.length ?? 0,
      saved_summary_note: Boolean(payload.summary),
      saved_draft_note: savedDraftNote,
      persisted_artifact_version_id: persistedArtifactVersion?.versionId ?? null,
      persisted_artifact_version_count: persistedArtifactVersion?.versionCount ?? null,
    },
    timestamp: now,
  })

  return NextResponse.json({ ok: true })
}
