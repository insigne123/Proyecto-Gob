import {
  classifyTribunalDocumentRole as classifyStrictTribunalDocumentRole,
  isStrictTribunalKeyDocument as isStrictTribunalKeyDocumentByTitle,
} from "@/lib/tribunal/document-role"
import { isEligibleOnboardingCause } from "@/lib/onboarding/eligibility"
import { pickDocumentsForDefense } from "@/lib/tribunal/document-selection"

type TribunalCauseRow = {
  id: string
  tribunal: string | null
  rol: string | null
  caratula: string | null
  estado: string | null
  estado_subtipo: string | null
  fecha_ingreso: string | null
}

type TribunalDocumentRow = {
  id: string
  cause_id: string
  document_type: string | null
  date: string | null
  name: string | null
  storage_path: string | null
  url: string | null
}

export type TribunalCorpusWorkspace = {
  id: string
  title: string
  created: boolean
}

export type TribunalCorpusSyncStats = {
  scannedDocuments: number
  readySnapshots: number
  totalSnapshots: number
  existingSources: number
  newSources: number
  newSnapshots: number
  retriedSnapshots: number
  queuedJobs: number
}

export function orderCorpusCauseDocs(params: {
  docsByCause: Map<string, TribunalDocumentRow[]>
  targetCauseIds?: string[]
}) {
  const targetCauseIds = Array.from(
    new Set((Array.isArray(params.targetCauseIds) ? params.targetCauseIds : []).map((item) => String(item || "")).filter(Boolean))
  )
  const targetSet = new Set(targetCauseIds)

  return Array.from(params.docsByCause.entries()).sort(([causeA, docsA], [causeB, docsB]) => {
    const aTarget = targetSet.has(causeA) ? 0 : 1
    const bTarget = targetSet.has(causeB) ? 0 : 1
    if (aTarget !== bTarget) return aTarget - bTarget

    const aCore = docsA.some((doc) => classifyTribunalDocumentRole({ documentType: doc.document_type, name: doc.name }) === "informe") &&
      docsA.some((doc) => classifyTribunalDocumentRole({ documentType: doc.document_type, name: doc.name }) === "sentencia")
    const bCore = docsB.some((doc) => classifyTribunalDocumentRole({ documentType: doc.document_type, name: doc.name }) === "informe") &&
      docsB.some((doc) => classifyTribunalDocumentRole({ documentType: doc.document_type, name: doc.name }) === "sentencia")
    if (aCore !== bCore) return aCore ? 1 : -1

    return causeA.localeCompare(causeB)
  })
}

const CORPUS_MARKER = "[system] tribunal-corpus-v1"
const CORPUS_TITLE = "Base Jurisprudencial Tribunal Ambiental"
const CORPUS_SOURCE_ORIGIN = "tribunal-corpus"

function safeText(value: unknown, maxLen = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen)
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

export function classifyTribunalDocumentRole(input: {
  documentType?: string | null
  name?: string | null
  title?: string | null
}) {
  return classifyStrictTribunalDocumentRole(input)
}

export function isStrictTribunalKeyDocument(input: {
  documentType?: string | null
  name?: string | null
  title?: string | null
}) {
  return isStrictTribunalKeyDocumentByTitle(input)
}

function parseYear(value: string | null) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.getUTCFullYear()
}

function buildSourceTitle(cause: TribunalCauseRow, doc: TribunalDocumentRow) {
  const rol = safeText(cause.rol, 80) || "rol"
  const docType = safeText(doc.document_type, 120)
  const name = safeText(doc.name, 160)
  const label = docType || name || "Documento"
  return safeText(`${rol} - ${label}`, 220)
}

function buildFilename(cause: TribunalCauseRow, doc: TribunalDocumentRow) {
  const role = classifyTribunalDocumentRole({ documentType: doc.document_type, name: doc.name })
  const rol = safeText(cause.rol, 80).replace(/[^a-zA-Z0-9_-]/g, "_") || "rol"
  const docId = safeText(doc.id, 80)
  return `${rol}_${role}_${docId}.pdf`
}

function sourceKeyForDoc(doc: TribunalDocumentRow) {
  const byUrl = safeText(doc.url, 1800)
  if (byUrl) return byUrl
  const byStorage = safeText(doc.storage_path, 1400)
  if (byStorage) return `storage://${byStorage}`
  return `tribunal-doc:${safeText(doc.id, 120)}`
}

function isAttachmentLike(text: string) {
  const normalized = normalizeText(text)
  if (!normalized) return false
  return (
    normalized.includes("anexo") ||
    normalized.includes("adjunto") ||
    normalized.includes("acompan") ||
    normalized.includes("documentos")
  )
}

function pickKeyDocsForCause(docs: TribunalDocumentRow[]) {
  const filtered = docs.filter((doc) => {
    const text = `${doc.document_type || ""} ${doc.name || ""}`
    if (isAttachmentLike(text)) return false
    return isStrictTribunalKeyDocument({
      documentType: doc.document_type,
      name: doc.name,
      title: doc.document_type,
    })
  })

  return pickDocumentsForDefense(filtered, { limit: 3 })
}

function isCorpusEligibleCause(cause: TribunalCauseRow | null | undefined) {
  if (!cause) return false
  return isEligibleOnboardingCause({
    tribunal: cause.tribunal,
    caratula: cause.caratula,
  })
}

export async function ensureTribunalCorpusWorkspace(admin: any): Promise<TribunalCorpusWorkspace> {
  const { data: existing, error: existingErr } = await admin
    .from("gob_workspaces")
    .select("id,title")
    .eq("description", CORPUS_MARKER)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existingErr) {
    throw new Error(existingErr.message)
  }

  if (existing?.id) {
    return {
      id: String(existing.id),
      title: safeText(existing.title, 200) || CORPUS_TITLE,
      created: false,
    }
  }

  const now = new Date().toISOString()
  const { data: created, error: createErr } = await admin
    .from("gob_workspaces")
    .insert({
      title: CORPUS_TITLE,
      description: CORPUS_MARKER,
      status: "active",
      created_at: now,
      updated_at: now,
      created_by: null,
    })
    .select("id,title")
    .single()

  if (createErr || !created?.id) {
    throw new Error(createErr?.message || "No se pudo crear workspace de corpus")
  }

  return {
    id: String(created.id),
    title: safeText(created.title, 200) || CORPUS_TITLE,
    created: true,
  }
}

export async function syncTribunalCorpusDocuments(params: {
  admin: any
  corpusWorkspaceId: string
  maxNewSources?: number
  maxRetries?: number
  targetCauseIds?: string[]
  targetRoles?: string[]
}) {
  const { admin, corpusWorkspaceId } = params
  const maxNewSources = Math.max(5, Math.min(250, Number(params.maxNewSources ?? 80)))
  const maxRetries = Math.max(0, Math.min(80, Number(params.maxRetries ?? 25)))

  const [{ data: docs, error: docsErr }, { data: causes, error: causesErr }] = await Promise.all([
    admin
      .from("gob_tribunal_documents")
      .select("id,cause_id,document_type,date,name,storage_path,url")
      .order("created_at", { ascending: false })
      .limit(6000),
    admin
      .from("gob_tribunal_causes")
      .select("id,tribunal,rol,caratula,estado,estado_subtipo,fecha_ingreso")
      .limit(4000),
  ])

  if (docsErr) throw new Error(docsErr.message)
  if (causesErr) throw new Error(causesErr.message)

  const causeById = new Map<string, TribunalCauseRow>()
  for (const row of causes || []) {
    causeById.set(String((row as any).id), {
      id: String((row as any).id),
      tribunal: (row as any).tribunal ? String((row as any).tribunal) : null,
      rol: (row as any).rol ? String((row as any).rol) : null,
      caratula: (row as any).caratula ? String((row as any).caratula) : null,
      estado: (row as any).estado ? String((row as any).estado) : null,
      estado_subtipo: (row as any).estado_subtipo ? String((row as any).estado_subtipo) : null,
      fecha_ingreso: (row as any).fecha_ingreso ? String((row as any).fecha_ingreso) : null,
    })
  }

  const mappedDocs: TribunalDocumentRow[] = (docs || [])
    .map((row: any) => ({
      id: String(row.id),
      cause_id: String(row.cause_id),
      document_type: row.document_type ? String(row.document_type) : null,
      date: row.date ? String(row.date) : null,
      name: row.name ? String(row.name) : null,
      storage_path: row.storage_path ? String(row.storage_path) : null,
      url: row.url ? String(row.url) : null,
    }))
    .filter(
      (doc: TribunalDocumentRow) =>
        !!doc.cause_id &&
        isCorpusEligibleCause(causeById.get(doc.cause_id) || null) &&
        (!!doc.storage_path || !!doc.url)
    )

  const targetCauseIds = new Set(
    (Array.isArray(params.targetCauseIds) ? params.targetCauseIds : []).map((item) => String(item || "")).filter(Boolean)
  )
  const targetRoles = new Set(
    (Array.isArray(params.targetRoles) ? params.targetRoles : []).map((item) => String(item || "").toUpperCase()).filter(Boolean)
  )

  const filteredDocs = mappedDocs.filter((doc) => {
    if (targetCauseIds.size && targetCauseIds.has(doc.cause_id)) return true
    if (targetRoles.size) {
      const cause = causeById.get(doc.cause_id)
      const rol = String(cause?.rol || "").toUpperCase()
      if (rol && targetRoles.has(rol)) return true
    }
    return targetCauseIds.size === 0 && targetRoles.size === 0
  })

  const docsByCause = new Map<string, TribunalDocumentRow[]>()
  for (const doc of filteredDocs) {
    const list = docsByCause.get(doc.cause_id) || []
    list.push(doc)
    docsByCause.set(doc.cause_id, list)
  }

  const validDocs: TribunalDocumentRow[] = []
  const orderedCauseDocs = orderCorpusCauseDocs({
    docsByCause,
    targetCauseIds: Array.from(targetCauseIds),
  })
  for (const [, list] of orderedCauseDocs) {
    validDocs.push(...pickKeyDocsForCause(list))
  }

  const { data: existingSources, error: sourceErr } = await admin
    .from("gob_sources")
    .select("id,url,status")
    .eq("workspace_id", corpusWorkspaceId)
    .eq("source_origin", CORPUS_SOURCE_ORIGIN)
    .limit(12000)

  if (sourceErr) throw new Error(sourceErr.message)

  const existingSourceByUrl = new Map<string, { id: string; status: string | null }>()
  for (const row of existingSources || []) {
    const url = row?.url ? String(row.url) : ""
    if (!url) continue
    existingSourceByUrl.set(url, {
      id: String(row.id),
      status: row.status ? String(row.status) : null,
    })
  }

  const existingSourceIds = Array.from(new Set((existingSources || []).map((s: any) => String(s.id))))
  const snapshotBySourceId = new Map<string, { id: string; status: string | null }>()

  if (existingSourceIds.length) {
    for (let offset = 0; offset < existingSourceIds.length; offset += 200) {
      const slice = existingSourceIds.slice(offset, offset + 200)
      const { data: snapshots, error: snapshotErr } = await admin
        .from("gob_source_snapshots")
        .select("id,source_id,status")
        .eq("workspace_id", corpusWorkspaceId)
        .in("source_id", slice)
        .order("created_at", { ascending: false })

      if (snapshotErr) throw new Error(snapshotErr.message)

      for (const row of snapshots || []) {
        const sourceId = String((row as any).source_id)
        if (!sourceId || snapshotBySourceId.has(sourceId)) continue
        snapshotBySourceId.set(sourceId, {
          id: String((row as any).id),
          status: (row as any).status ? String((row as any).status) : null,
        })
      }
    }
  }

  const now = new Date().toISOString()
  const jobsToQueue: Array<any> = []
  let newSources = 0
  let newSnapshots = 0
  let retriedSnapshots = 0

  for (const doc of validDocs) {
    const cause = causeById.get(doc.cause_id)
    if (!cause) continue
    const urlKey = sourceKeyForDoc(doc)

    let sourceId: string | null = null
    const existing = existingSourceByUrl.get(urlKey)

    if (existing?.id) {
      sourceId = existing.id
    } else if (newSources < maxNewSources) {
      const docRole = classifyTribunalDocumentRole({
        documentType: doc.document_type,
        name: doc.name,
        title: buildSourceTitle(cause, doc),
      })

      const { data: insertedSource, error: insertSourceErr } = await admin
        .from("gob_sources")
        .insert({
          workspace_id: corpusWorkspaceId,
          kind: "upload",
          url: urlKey,
          filename: buildFilename(cause, doc),
          title: buildSourceTitle(cause, doc),
          doc_type: docRole,
          year: parseYear(doc.date),
          region: null,
          sector: null,
          project_name: safeText(cause.caratula, 200) || null,
          source_origin: CORPUS_SOURCE_ORIGIN,
          language: "es",
          attributes: {
            tribunal: cause.tribunal,
            rol: cause.rol,
            tribunal_cause_id: cause.id,
            tribunal_document_id: doc.id,
            estado: cause.estado,
            estado_subtipo: cause.estado_subtipo,
            fecha_ingreso: cause.fecha_ingreso,
            document_type_raw: doc.document_type,
            name_raw: doc.name,
            doc_role: docRole,
            retrieval_priority_group: docRole,
            metadata_schema: "source_v2",
          },
          status: "pending",
          last_error: null,
          created_by: null,
          updated_at: now,
        })
        .select("id")
        .single()

      if (insertSourceErr || !insertedSource?.id) {
        continue
      }

      sourceId = String(insertedSource.id)
      newSources += 1
      existingSourceByUrl.set(urlKey, { id: sourceId, status: "pending" })
    }

    if (!sourceId) continue

    const existingSnapshot = snapshotBySourceId.get(sourceId)
    if (!existingSnapshot?.id) {
      const { data: insertedSnapshot, error: insertSnapshotErr } = await admin
        .from("gob_source_snapshots")
        .insert({
          workspace_id: corpusWorkspaceId,
          source_id: sourceId,
          url: doc.url,
          original_filename: buildFilename(cause, doc),
          storage_path: doc.storage_path,
          content_type: "application/pdf",
          status: "pending",
          error: null,
          openai_index_status: "pending",
          openai_last_error: null,
          created_at: now,
        })
        .select("id")
        .single()

      if (insertSnapshotErr || !insertedSnapshot?.id) {
        continue
      }

      const snapshotId = String(insertedSnapshot.id)
      snapshotBySourceId.set(sourceId, { id: snapshotId, status: "pending" })
      jobsToQueue.push({
        type: "source_ingest",
        status: "pending",
        available_at: now,
        attempts: 0,
        max_attempts: 5,
        payload: { workspace_id: corpusWorkspaceId, source_id: sourceId, snapshot_id: snapshotId },
        created_at: now,
      })
      newSnapshots += 1
      continue
    }

    const snapshotStatus = String(existingSnapshot.status || "")
    if (snapshotStatus === "error" && retriedSnapshots < maxRetries) {
      const snapshotId = String(existingSnapshot.id)
      await admin
        .from("gob_source_snapshots")
        .update({ status: "pending", error: null, openai_index_status: "pending", openai_last_error: null })
        .eq("id", snapshotId)

      await admin
        .from("gob_sources")
        .update({ status: "pending", last_error: null, updated_at: now })
        .eq("id", sourceId)

      jobsToQueue.push({
        type: "source_ingest",
        status: "pending",
        available_at: now,
        attempts: 0,
        max_attempts: 5,
        payload: { workspace_id: corpusWorkspaceId, source_id: sourceId, snapshot_id: snapshotId },
        created_at: now,
      })
      retriedSnapshots += 1
    }
  }

  if (jobsToQueue.length) {
    await admin.from("gob_jobs").insert(jobsToQueue)
  }

  const [{ count: readyCount }, { count: totalSnapshots }] = await Promise.all([
    admin
      .from("gob_source_snapshots")
      .select("id", { head: true, count: "exact" })
      .eq("workspace_id", corpusWorkspaceId)
      .eq("status", "ready"),
    admin
      .from("gob_source_snapshots")
      .select("id", { head: true, count: "exact" })
      .eq("workspace_id", corpusWorkspaceId),
  ])

  return {
    scannedDocuments: validDocs.length,
    readySnapshots: typeof readyCount === "number" ? readyCount : 0,
    totalSnapshots: typeof totalSnapshots === "number" ? totalSnapshots : 0,
    existingSources: existingSourceByUrl.size,
    newSources,
    newSnapshots,
    retriedSnapshots,
    queuedJobs: jobsToQueue.length,
  } satisfies TribunalCorpusSyncStats
}
