import { randomUUID } from "node:crypto"

import {
  normalizeStructuredOnboardingMemory,
  type StructuredOnboardingMemory,
} from "@/lib/onboarding/structured-memory"

export type PersistedOnboardingArtifacts = {
  workspaceId: string
  runId: string | null
  claimSnapshotId: string | null
  version: number
  versionId?: string | null
  versionCount?: number
  summary: string | null
  reportContent: string | null
  structuredMemory: StructuredOnboardingMemory | null
  tribunalReferences: any[]
  recommendations: any[]
  matrix: any[]
  metadata: Record<string, any>
}

function safeText(value: unknown, max = 20000) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function normalizeReference(value: any) {
  const snapshotId = String(value?.snapshotId || value?.snapshot_id || "").trim()
  if (!snapshotId) return null
  return {
    snapshotId,
    sourceId: value?.sourceId ? String(value.sourceId) : value?.source_id ? String(value.source_id) : null,
    sourceTitle:
      value?.sourceTitle ? String(value.sourceTitle) : value?.source_title ? String(value.source_title) : null,
    docType: value?.docType ? String(value.docType) : value?.doc_type ? String(value.doc_type) : null,
    docRole: value?.docRole ? String(value.docRole) : value?.doc_role ? String(value.doc_role) : null,
    rol: value?.rol ? String(value.rol) : null,
    causeId: value?.causeId ? String(value.causeId) : value?.cause_id ? String(value.cause_id) : null,
    documentId:
      value?.documentId ? String(value.documentId) : value?.document_id ? String(value.document_id) : null,
    documentName:
      value?.documentName ? String(value.documentName) : value?.document_name ? String(value.document_name) : null,
    documentUrl:
      value?.documentUrl ? String(value.documentUrl) : value?.document_url ? String(value.document_url) : null,
    sampleQuote:
      value?.sampleQuote ? safeText(value.sampleQuote, 300) : value?.sample_quote ? safeText(value.sample_quote, 300) : null,
    sourceUrl: value?.sourceUrl ? String(value.sourceUrl) : value?.source_url ? String(value.source_url) : null,
  }
}

function normalizeJsonArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

export function normalizePersistedOnboardingArtifacts(row: any): PersistedOnboardingArtifacts | null {
  const workspaceId = String(row?.workspace_id || row?.workspaceId || "").trim()
  if (!workspaceId) return null

  return {
    workspaceId,
    runId: row?.run_id ? String(row.run_id) : row?.runId ? String(row.runId) : null,
    claimSnapshotId:
      row?.claim_snapshot_id ? String(row.claim_snapshot_id) : row?.claimSnapshotId ? String(row.claimSnapshotId) : null,
    version: Number.isFinite(Number(row?.version)) ? Math.max(1, Math.floor(Number(row.version))) : 1,
    versionId: row?.version_id ? String(row.version_id) : row?.versionId ? String(row.versionId) : null,
    versionCount: Number.isFinite(Number(row?.version_count)) ? Math.max(1, Math.floor(Number(row.version_count))) : undefined,
    summary: row?.summary ? safeText(row.summary, 20000) : null,
    reportContent: row?.report_content ? safeText(row.report_content, 100000) : row?.reportContent ? safeText(row.reportContent, 100000) : null,
    structuredMemory: normalizeStructuredOnboardingMemory(row?.structured_memory || row?.structuredMemory || null),
    tribunalReferences: normalizeJsonArray(row?.tribunal_references || row?.tribunalReferences)
      .map(normalizeReference)
      .filter(Boolean),
    recommendations: normalizeJsonArray(row?.recommendations),
    matrix: normalizeJsonArray(row?.matrix),
    metadata: row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {},
  }
}

export async function loadPersistedOnboardingArtifacts(params: { supabase: any; workspaceId: string }) {
  const { data, error } = await params.supabase
    .from("gob_onboarding_memory_artifacts")
    .select(
      "workspace_id,run_id,claim_snapshot_id,version,summary,report_content,structured_memory,tribunal_references,recommendations,matrix,metadata,version_id,version_count"
    )
    .eq("workspace_id", params.workspaceId)
    .maybeSingle()

  if (error) return null
  return normalizePersistedOnboardingArtifacts(data)
}

export async function loadOnboardingArtifactVersions(params: {
  supabase: any
  workspaceId: string
  limit?: number
}) {
  const { data, error } = await params.supabase
    .from("gob_onboarding_memory_artifact_versions")
    .select(
      "id,workspace_id,artifact_version,run_id,claim_snapshot_id,summary,report_content,structured_memory,tribunal_references,recommendations,matrix,metadata,created_at"
    )
    .eq("workspace_id", params.workspaceId)
    .order("artifact_version", { ascending: false })
    .limit(Math.max(1, Math.min(20, Number(params.limit || 10))))

  if (error || !Array.isArray(data)) return [] as PersistedOnboardingArtifacts[]
  return data
    .map((row: any) =>
      normalizePersistedOnboardingArtifacts({
        ...row,
        version: row?.artifact_version,
        version_id: row?.id,
      })
    )
    .filter(Boolean) as PersistedOnboardingArtifacts[]
}

export async function savePersistedOnboardingArtifacts(params: {
  admin: any
  workspaceId: string
  userId: string | null
  runId?: string | null
  claimSnapshotId?: string | null
  summary?: string | null
  reportContent?: string | null
  structuredMemory: StructuredOnboardingMemory | null
  tribunalReferences: any[]
  recommendations?: any[]
  matrix?: any[]
  metadata?: Record<string, any>
}) {
  const now = new Date().toISOString()
  const { data: currentArtifact } = await params.admin
    .from("gob_onboarding_memory_artifacts")
    .select("version_count")
    .eq("workspace_id", params.workspaceId)
    .maybeSingle()

  const versionCount = Math.max(1, Number(currentArtifact?.version_count || 0) + 1)
  const versionId = randomUUID()
  const payload = {
    workspace_id: params.workspaceId,
    run_id: params.runId ? String(params.runId) : null,
    claim_snapshot_id: params.claimSnapshotId ? String(params.claimSnapshotId) : null,
    version: params.structuredMemory?.version || 1,
    version_id: versionId,
    version_count: versionCount,
    summary: params.summary ? safeText(params.summary, 20000) : null,
    report_content: params.reportContent ? safeText(params.reportContent, 100000) : null,
    structured_memory: params.structuredMemory || {},
    tribunal_references: (Array.isArray(params.tribunalReferences) ? params.tribunalReferences : [])
      .map(normalizeReference)
      .filter(Boolean),
    recommendations: normalizeJsonArray(params.recommendations),
    matrix: normalizeJsonArray(params.matrix),
    metadata: params.metadata && typeof params.metadata === "object" && !Array.isArray(params.metadata) ? params.metadata : {},
    created_by: params.userId,
    updated_at: now,
  }

  const { error } = await params.admin
    .from("gob_onboarding_memory_artifacts")
    .upsert(payload, { onConflict: "workspace_id" })

  if (error) throw error

  const { error: versionError } = await params.admin.from("gob_onboarding_memory_artifact_versions").insert({
    id: versionId,
    workspace_id: params.workspaceId,
    artifact_version: versionCount,
    run_id: params.runId ? String(params.runId) : null,
    claim_snapshot_id: params.claimSnapshotId ? String(params.claimSnapshotId) : null,
    summary: payload.summary,
    report_content: payload.report_content,
    structured_memory: payload.structured_memory,
    tribunal_references: payload.tribunal_references,
    recommendations: payload.recommendations,
    matrix: payload.matrix,
    metadata: payload.metadata,
    created_at: now,
    created_by: params.userId,
  })

  if (versionError) throw versionError

  return { versionId, versionCount }
}
