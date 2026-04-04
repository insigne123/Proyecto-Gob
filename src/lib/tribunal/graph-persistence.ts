import type { StructuredOnboardingMemory } from "@/lib/onboarding/structured-memory"
import { extractLegalGraphEntities, scoreCauseSimilarity, type LegalGraphEntity } from "@/lib/tribunal/graph-entities"

type TribunalReference = {
  causeId?: string | null
  rol?: string | null
  docRole?: string | null
  sourceTitle?: string | null
  documentName?: string | null
  sampleQuote?: string | null
}

type CauseBundle = {
  scopeKey: string
  causeId: string | null
  rol: string | null
  text: string
  entities: LegalGraphEntity[]
  factBag: {
    normas: string[]
    autoridades: string[]
    materias: string[]
    resultado: string | null
  }
}

function safeText(value: unknown, max = 1200) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function uniqueStrings(values: unknown[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = safeText(value, 500)
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
  }
  return out
}

function relationTypeFromEntity(entityType: string) {
  if (entityType === "norma_legal") return "mentions_norma"
  if (entityType === "autoridad") return "mentions_autoridad"
  if (entityType === "materia") return "mentions_materia"
  if (entityType === "resultado") return "has_outcome"
  return "related_to"
}

function factBagFromEntities(entities: LegalGraphEntity[]) {
  return {
    normas: entities.filter((row) => row.entityType === "norma_legal").map((row) => row.entityValue),
    autoridades: entities.filter((row) => row.entityType === "autoridad").map((row) => row.entityValue),
    materias: entities.filter((row) => row.entityType === "materia").map((row) => row.entityValue),
    resultado: entities.find((row) => row.entityType === "resultado")?.entityValue || null,
  }
}

function buildCauseBundles(params: {
  structuredMemory: StructuredOnboardingMemory | null
  tribunalReferences: TribunalReference[]
}) {
  const bundles = new Map<string, { causeId: string; rol: string | null; parts: string[] }>()

  for (const cause of params.structuredMemory?.preferredCauses || []) {
    if (!cause?.causeId) continue
    const current = bundles.get(cause.causeId) || { causeId: cause.causeId, rol: cause.rol || null, parts: [] }
    current.rol = current.rol || cause.rol || null
    current.parts.push(...uniqueStrings([cause.rol ? `Rol ${cause.rol}` : "", cause.reason, cause.defenseSummary]))
    bundles.set(cause.causeId, current)
  }

  for (const doc of params.structuredMemory?.keyDocuments || []) {
    const causeId = String(doc?.causeId || "").trim()
    if (!causeId) continue
    const current = bundles.get(causeId) || { causeId, rol: doc.rol || null, parts: [] }
    current.rol = current.rol || doc.rol || null
    current.parts.push(...uniqueStrings([doc.rol ? `Rol ${doc.rol}` : "", doc.docRole ? `Documento ${doc.docRole}` : "", doc.name, doc.contribution]))
    bundles.set(causeId, current)
  }

  for (const ref of params.tribunalReferences || []) {
    const causeId = String(ref?.causeId || "").trim()
    if (!causeId) continue
    const current = bundles.get(causeId) || { causeId, rol: ref.rol ? String(ref.rol) : null, parts: [] }
    current.rol = current.rol || (ref.rol ? String(ref.rol) : null)
    current.parts.push(...uniqueStrings([ref.rol ? `Rol ${ref.rol}` : "", ref.docRole ? `Documento ${ref.docRole}` : "", ref.documentName, ref.sourceTitle, ref.sampleQuote]))
    bundles.set(causeId, current)
  }

  const out: CauseBundle[] = []
  for (const current of bundles.values()) {
    const baseText = uniqueStrings([
      current.rol ? `Rol ${current.rol}` : "",
      ...(params.structuredMemory?.documentPriorityRules || []).slice(0, 3),
      ...(params.structuredMemory?.defenseCriteria || []).slice(0, 4),
      ...(params.structuredMemory?.misuseRisks || []).slice(0, 3),
      ...current.parts,
    ]).join(". ")

    const entities = extractLegalGraphEntities({ text: baseText, rol: current.rol || null })

    out.push({
      scopeKey: `cause:${current.causeId}`,
      causeId: current.causeId,
      rol: current.rol,
      text: baseText,
      entities,
      factBag: factBagFromEntities(entities),
    })
  }

  return out
}

async function deleteGraphScope(params: { admin: any; workspaceId: string; sourceTag: string; scopeKeys?: string[] }) {
  const scopeKeys = Array.isArray(params.scopeKeys) ? params.scopeKeys.filter(Boolean) : []

  if (scopeKeys.length) {
    const snapshotScopeKeys = scopeKeys.filter((key) => key.startsWith("snapshot:"))
    if (snapshotScopeKeys.length === scopeKeys.length) {
      const snapshotIds = snapshotScopeKeys.map((key) => key.slice("snapshot:".length)).filter(Boolean)
      if (snapshotIds.length) {
        await params.admin
          .from("gob_entity_relations")
          .delete()
          .eq("workspace_id", params.workspaceId)
          .filter("metadata->>source", "eq", params.sourceTag)
          .in("snapshot_id", snapshotIds)
      }
      await params.admin
        .from("gob_entities")
        .delete()
        .eq("workspace_id", params.workspaceId)
        .filter("metadata->>source", "eq", params.sourceTag)
        .in("scope_key", scopeKeys)
      return
    }

    await params.admin
      .from("gob_entity_relations")
      .delete()
      .eq("workspace_id", params.workspaceId)
      .filter("metadata->>source", "eq", params.sourceTag)
      .filter("metadata->>scope_key", "in", `(${scopeKeys.join(",")})`)
    await params.admin
      .from("gob_entities")
      .delete()
      .eq("workspace_id", params.workspaceId)
      .filter("metadata->>source", "eq", params.sourceTag)
      .in("scope_key", scopeKeys)
    return
  }

  await params.admin.from("gob_entity_relations").delete().eq("workspace_id", params.workspaceId).filter("metadata->>source", "eq", params.sourceTag)
  await params.admin.from("gob_entities").delete().eq("workspace_id", params.workspaceId).filter("metadata->>source", "eq", params.sourceTag)
}

async function persistGraphBundles(params: {
  admin: any
  workspaceId: string
  sourceTag: string
  bundles: CauseBundle[]
}) {
  if (!params.bundles.length) return { entities: 0, relations: 0 }

  await deleteGraphScope({
    admin: params.admin,
    workspaceId: params.workspaceId,
    sourceTag: params.sourceTag,
    scopeKeys: params.bundles.map((bundle) => bundle.scopeKey),
  })

  const entityRows: any[] = []
  for (const bundle of params.bundles) {
    for (const entity of bundle.entities) {
      entityRows.push({
        workspace_id: params.workspaceId,
        scope_key: bundle.scopeKey,
        snapshot_id: bundle.scopeKey.startsWith("snapshot:") ? bundle.scopeKey.slice("snapshot:".length) : null,
        source_id: null,
        cause_id: bundle.causeId,
        entity_type: entity.entityType,
        entity_value: entity.entityValue,
        normalized_value: entity.normalizedValue,
        metadata: {
          source: params.sourceTag,
          scope_key: bundle.scopeKey,
          confidence: entity.confidence,
          rol: bundle.rol,
          ...((entity.metadata as Record<string, unknown>) || {}),
        },
      })
    }
  }

  const inserted = entityRows.length
    ? await params.admin
        .from("gob_entities")
        .insert(entityRows)
        .select("id,scope_key,cause_id,entity_type,normalized_value")
    : { data: [], error: null }

  if (inserted.error) throw inserted.error

  const entityMap = new Map<string, string>()
  for (const row of inserted.data || []) {
    const key = `${String((row as any).scope_key || "")}|${String((row as any).entity_type || "")}|${String((row as any).normalized_value || "")}`
    entityMap.set(key, String((row as any).id || ""))
  }

  const relationRows: any[] = []
  for (const bundle of params.bundles) {
    const rootEntity = bundle.entities.find((row) => row.entityType === "rol_causa") || bundle.entities[0]
    if (!rootEntity) continue
    const rootEntityId = entityMap.get(`${bundle.scopeKey}|${rootEntity.entityType}|${rootEntity.normalizedValue}`) || ""
    if (!rootEntityId) continue

    for (const entity of bundle.entities) {
      if (entity === rootEntity) continue
      const entityId = entityMap.get(`${bundle.scopeKey}|${entity.entityType}|${entity.normalizedValue}`) || ""
      if (!entityId) continue
      relationRows.push({
        workspace_id: params.workspaceId,
        snapshot_id: bundle.scopeKey.startsWith("snapshot:") ? bundle.scopeKey.slice("snapshot:".length) : null,
        source_entity_id: rootEntityId,
        target_entity_id: entityId,
        relation_type: relationTypeFromEntity(entity.entityType),
        weight: entity.confidence,
        evidence_chunk_id: null,
        metadata: {
          source: params.sourceTag,
          scope_key: bundle.scopeKey,
          rol: bundle.rol,
        },
      })
    }
  }

  if (relationRows.length) {
    const { error } = await params.admin.from("gob_entity_relations").insert(relationRows)
    if (error) throw error
  }

  return {
    entities: entityRows.length,
    relations: relationRows.length,
  }
}

export async function refreshWorkspaceCauseSimilarityFromEntities(params: {
  admin: any
  workspaceId: string
  sourceTag?: string
  targetCauseIds?: string[]
}) {
  const sourceTag = String(params.sourceTag || "graph_refresh").trim() || "graph_refresh"
  const targetCauseIds = Array.from(new Set((params.targetCauseIds || []).map((item) => String(item || "").trim()).filter(Boolean)))

  const { data: entityRows, error } = await params.admin
    .from("gob_entities")
    .select("cause_id,entity_type,entity_value,metadata")
    .eq("workspace_id", params.workspaceId)
    .not("cause_id", "is", null)
    .in("entity_type", ["norma_legal", "autoridad", "materia", "resultado", "rol_causa"])
    .limit(20000)

  if (error) throw error

  const byCause = new Map<string, { rol: string | null; factBag: { normas: string[]; autoridades: string[]; materias: string[]; resultado: string | null } }>()
  for (const row of entityRows || []) {
    const causeId = String((row as any)?.cause_id || "")
    if (!causeId) continue
    const current =
      byCause.get(causeId) ||
      {
        rol:
          typeof (row as any)?.metadata?.rol === "string"
            ? String((row as any).metadata.rol)
            : (row as any)?.entity_type === "rol_causa"
              ? String((row as any).entity_value || "")
              : null,
        factBag: { normas: [], autoridades: [], materias: [], resultado: null as string | null },
      }
    const entityType = String((row as any)?.entity_type || "")
    const entityValue = String((row as any)?.entity_value || "")
    if (entityType === "norma_legal") current.factBag.normas = uniqueStrings([...current.factBag.normas, entityValue])
    if (entityType === "autoridad") current.factBag.autoridades = uniqueStrings([...current.factBag.autoridades, entityValue])
    if (entityType === "materia") current.factBag.materias = uniqueStrings([...current.factBag.materias, entityValue])
    if (entityType === "resultado" && !current.factBag.resultado) current.factBag.resultado = entityValue
    if (entityType === "rol_causa" && !current.rol) current.rol = entityValue
    byCause.set(causeId, current)
  }

  const allCauseIds = Array.from(byCause.keys())
  const sourceCauseIds = targetCauseIds.length ? targetCauseIds : allCauseIds
  if (!sourceCauseIds.length) return { similarities: 0 }

  await params.admin
    .from("gob_cause_similarity")
    .delete()
    .eq("workspace_id", params.workspaceId)
    .filter("metadata->>source", "eq", sourceTag)

  const similarityRows: any[] = []
  for (const causeId of sourceCauseIds) {
    const left = byCause.get(causeId)
    if (!left) continue
    for (const [otherCauseId, right] of byCause.entries()) {
      if (causeId === otherCauseId) continue
      if (causeId > otherCauseId && !targetCauseIds.length) continue
      const similarity = scoreCauseSimilarity({ left: left.factBag, right: right.factBag })
      if (similarity.similarityScore <= 0) continue
      similarityRows.push({
        workspace_id: params.workspaceId,
        cause_a_id: causeId,
        cause_b_id: otherCauseId,
        cause_a_rol: left.rol,
        cause_b_rol: right.rol,
        similarity_score: similarity.similarityScore,
        shared_factors: similarity.sharedFactors,
        metadata: {
          source: sourceTag,
        },
      })
    }
  }

  if (similarityRows.length) {
    const { error: insertError } = await params.admin.from("gob_cause_similarity").insert(similarityRows)
    if (insertError) throw insertError
  }

  return { similarities: similarityRows.length }
}

export async function persistOnboardingLegalGraph(params: {
  admin: any
  workspaceId: string
  structuredMemory: StructuredOnboardingMemory | null
  tribunalReferences: TribunalReference[]
}) {
  const bundles = buildCauseBundles({
    structuredMemory: params.structuredMemory,
    tribunalReferences: params.tribunalReferences,
  })

  const sourceTag = "onboarding_artifact"

  await params.admin.from("gob_cause_similarity").delete().eq("workspace_id", params.workspaceId).filter("metadata->>source", "eq", sourceTag)

  if (!bundles.length) {
    await deleteGraphScope({ admin: params.admin, workspaceId: params.workspaceId, sourceTag })
    return { causes: 0, entities: 0, relations: 0, similarities: 0 }
  }

  const persisted = await persistGraphBundles({
    admin: params.admin,
    workspaceId: params.workspaceId,
    sourceTag,
    bundles,
  })

  const similarityRows: any[] = []
  for (let i = 0; i < bundles.length; i += 1) {
    for (let j = i + 1; j < bundles.length; j += 1) {
      const left = bundles[i]
      const right = bundles[j]
      if (!left.causeId || !right.causeId) continue
      const similarity = scoreCauseSimilarity({ left: left.factBag, right: right.factBag })
      if (similarity.similarityScore <= 0) continue
      similarityRows.push({
        workspace_id: params.workspaceId,
        cause_a_id: left.causeId,
        cause_b_id: right.causeId,
        cause_a_rol: left.rol,
        cause_b_rol: right.rol,
        similarity_score: similarity.similarityScore,
        shared_factors: similarity.sharedFactors,
        metadata: {
          source: sourceTag,
        },
      })
    }
  }

  if (similarityRows.length) {
    const { error } = await params.admin.from("gob_cause_similarity").insert(similarityRows)
    if (error) throw error
  }

  return {
    causes: bundles.length,
    entities: persisted.entities,
    relations: persisted.relations,
    similarities: similarityRows.length,
  }
}

export async function persistSnapshotLegalGraph(params: {
  admin: any
  workspaceId: string
  snapshotId: string
  causeId?: string | null
  rol?: string | null
  docRole?: string | null
  title?: string | null
  sourceKind?: string | null
  chunks: Array<{ content: string; section?: string | null; page?: number | null }>
}) {
  const scopeKey = `snapshot:${params.snapshotId}`
  const causeId = params.causeId ? String(params.causeId) : null
  const rol = params.rol ? String(params.rol) : null
  const combinedText = uniqueStrings([
    rol ? `Rol ${rol}` : "",
    params.docRole ? `Documento ${params.docRole}` : "",
    params.title ? `Titulo ${params.title}` : "",
    params.sourceKind ? `Fuente ${params.sourceKind}` : "",
    ...params.chunks.slice(0, 18).map((chunk) => [chunk.section || "", chunk.content].filter(Boolean).join(": ")),
  ]).join(". ")

  if (!combinedText) {
    await deleteGraphScope({
      admin: params.admin,
      workspaceId: params.workspaceId,
      sourceTag: "source_ingest",
      scopeKeys: [scopeKey],
    })
    return { entities: 0, relations: 0 }
  }

  const entities = extractLegalGraphEntities({ text: combinedText, rol })
  if (!entities.length) {
    await deleteGraphScope({
      admin: params.admin,
      workspaceId: params.workspaceId,
      sourceTag: "source_ingest",
      scopeKeys: [scopeKey],
    })
    return { entities: 0, relations: 0 }
  }

  const bundle: CauseBundle = {
    scopeKey,
    causeId,
    rol,
    text: combinedText,
    entities,
    factBag: factBagFromEntities(entities),
  }

  return persistGraphBundles({
    admin: params.admin,
    workspaceId: params.workspaceId,
    sourceTag: "source_ingest",
    bundles: [bundle],
  })
}
