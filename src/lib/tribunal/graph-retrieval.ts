import { extractLegalGraphEntities } from "@/lib/tribunal/graph-entities"

function uniqueStrings(values: unknown[], max = 8) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = String(value ?? "").replace(/\s+/g, " ").trim()
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
    if (out.length >= max) break
  }
  return out
}

export async function loadLegalGraphContext(params: {
  admin: any
  workspaceId: string
  question: string
  roleTokens?: string[]
  limit?: number
}) {
  const questionEntities = extractLegalGraphEntities({ text: params.question })
  const limit = Math.max(3, Math.min(12, Number(params.limit || 6)))
  const normalizedValues = uniqueStrings(questionEntities.map((row) => row.normalizedValue), 12)
  const roleTokens = uniqueStrings(params.roleTokens || [], 6).map((item) => item.toUpperCase())

  if (!normalizedValues.length && !roleTokens.length) {
    return { block: "", relatedRoles: [] as string[], relatedQueries: [] as string[] }
  }

  const { data: entityRows } = normalizedValues.length
    ? await params.admin
        .from("gob_entities")
        .select("id,cause_id,entity_type,entity_value,normalized_value,metadata")
        .eq("workspace_id", params.workspaceId)
        .in("normalized_value", normalizedValues)
        .limit(80)
    : await params.admin
        .from("gob_entities")
        .select("id,cause_id,entity_type,entity_value,normalized_value,metadata")
        .eq("workspace_id", params.workspaceId)
        .eq("entity_type", "rol_causa")
        .limit(80)

  const causeMentions = new Map<string, { rol: string | null; signals: string[] }>()
  for (const row of entityRows || []) {
    const causeId = String((row as any)?.cause_id || "")
    if (!causeId) continue
    const current = causeMentions.get(causeId) || {
      rol: typeof (row as any)?.metadata?.rol === "string" ? String((row as any).metadata.rol) : null,
      signals: [],
    }
    current.signals = uniqueStrings([
      ...current.signals,
      String((row as any)?.entity_value || ""),
      typeof (row as any)?.metadata?.rol === "string" ? String((row as any).metadata.rol) : "",
    ])
    causeMentions.set(causeId, current)
  }

  const roleEntityRows = roleTokens.length
    ? await params.admin
        .from("gob_entities")
        .select("cause_id,entity_value,metadata")
        .eq("workspace_id", params.workspaceId)
        .eq("entity_type", "rol_causa")
        .in("entity_value", roleTokens)
        .limit(20)
    : { data: [] as any[] }

  const focusCauseIds = uniqueStrings([
    ...(roleEntityRows.data || []).map((row: any) => String(row?.cause_id || "")),
    ...Array.from(causeMentions.keys()),
  ], 12)

  const relatedRowsA = focusCauseIds.length
    ? await params.admin
        .from("gob_cause_similarity")
        .select("cause_a_id,cause_b_id,cause_a_rol,cause_b_rol,similarity_score,shared_factors")
        .eq("workspace_id", params.workspaceId)
        .in("cause_a_id", focusCauseIds)
        .order("similarity_score", { ascending: false })
        .limit(24)
    : { data: [] as any[] }

  const relatedRowsB = focusCauseIds.length
    ? await params.admin
        .from("gob_cause_similarity")
        .select("cause_a_id,cause_b_id,cause_a_rol,cause_b_rol,similarity_score,shared_factors")
        .eq("workspace_id", params.workspaceId)
        .in("cause_b_id", focusCauseIds)
        .order("similarity_score", { ascending: false })
        .limit(24)
    : { data: [] as any[] }

  const relatedCombined = uniqueStrings([
    ...((relatedRowsA.data || []).map((row: any) => JSON.stringify(row)) as string[]),
    ...((relatedRowsB.data || []).map((row: any) => JSON.stringify(row)) as string[]),
  ], 40).map((item) => JSON.parse(item))

  const relatedRoles = uniqueStrings(
    relatedCombined.flatMap((row: any) => [String(row?.cause_a_rol || ""), String(row?.cause_b_rol || "")]),
    limit
  )

  const graphLines = relatedCombined
    .slice(0, limit)
    .map((row: any) => {
      const left = String(row?.cause_a_rol || "").trim()
      const right = String(row?.cause_b_rol || "").trim()
      const factors = row?.shared_factors && typeof row.shared_factors === "object" ? row.shared_factors : {}
      const factorLine = uniqueStrings([
        ...(Array.isArray(factors?.normas) ? factors.normas : []),
        ...(Array.isArray(factors?.autoridades) ? factors.autoridades : []),
        ...(Array.isArray(factors?.materias) ? factors.materias : []),
        factors?.sameOutcome ? "mismo resultado" : "",
      ], 4).join(", ")
      return `${left || "causa"} ~ ${right || "causa"} (score ${Number(row?.similarity_score || 0).toFixed(2)}${factorLine ? `; factores: ${factorLine}` : ""})`
    })

  const relatedQueries = uniqueStrings([
    ...relatedRoles.map((rol) => `${rol} ${params.question}`),
    ...graphLines.map((line) => line.replace(/\(score.*$/, "").trim()),
  ], limit)

  const block = graphLines.length
    ? `Grafo legal relacionado:\n${graphLines.map((line) => `- ${line}`).join("\n")}`
    : ""

  return {
    block,
    relatedRoles,
    relatedQueries,
  }
}

export async function loadLegalGraphSnapshotReferences(params: {
  admin: any
  workspaceId: string
  question: string
  roleTokens?: string[]
  preferredDocRoles?: string[]
  limit?: number
}) {
  const graph = await loadLegalGraphContext({
    admin: params.admin,
    workspaceId: params.workspaceId,
    question: params.question,
    roleTokens: params.roleTokens,
    limit: Math.max(4, Math.min(10, Number(params.limit || 6))),
  })

  const targetRoles = uniqueStrings([...(params.roleTokens || []), ...graph.relatedRoles], 10)
  if (!targetRoles.length) return [] as Array<{ snapshotId: string; title?: string | null; docType?: string | null; docRole?: string | null; rol?: string | null }>

  const preferredRoles = uniqueStrings(params.preferredDocRoles || [], 4).map((item) => item.toLowerCase())
  const { data } = await params.admin
    .from("gob_tribunal_document_facts")
    .select("snapshot_id,source_title,document_type,doc_role,rol")
    .in("rol", targetRoles)
    .limit(Math.max(12, Math.min(40, Number(params.limit || 6) * 4)))

  const rows = Array.isArray(data) ? data : []
  const ordered = rows
    .map((row: any, index: number) => {
      const docRole = String(row?.doc_role || "").toLowerCase()
      const roleRank = preferredRoles.length ? preferredRoles.indexOf(docRole) : -1
      const score = (roleRank >= 0 ? 20 - roleRank * 3 : 0) + (docRole === "informe" ? 8 : docRole === "sentencia" ? 7 : 2) - index * 0.01
      return { row, score, index }
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.row)

  const deduped = new Map<string, { snapshotId: string; title?: string | null; docType?: string | null; docRole?: string | null; rol?: string | null }>()
  for (const row of ordered) {
    const snapshotId = String(row?.snapshot_id || "").trim()
    if (!snapshotId || deduped.has(snapshotId)) continue
    deduped.set(snapshotId, {
      snapshotId,
      title: row?.source_title ? String(row.source_title) : null,
      docType: row?.document_type ? String(row.document_type) : null,
      docRole: row?.doc_role ? String(row.doc_role) : null,
      rol: row?.rol ? String(row.rol) : null,
    })
    if (deduped.size >= Math.max(4, Math.min(12, Number(params.limit || 6)))) break
  }

  return Array.from(deduped.values())
}
