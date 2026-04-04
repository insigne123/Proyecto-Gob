import { classifyTribunalDocumentRole } from "@/lib/tribunal/document-role"
import { getRuntimeCached } from "@/lib/runtime-cache"

export type TribunalDocumentFact = {
  documentId: string | null
  causeId: string | null
  rol: string | null
  docRole: string | null
  sourceId: string | null
  snapshotId: string | null
  sourceTitle: string | null
  documentType: string | null
  documentName: string | null
  documentUrl: string | null
  claimants: string[]
  fojas: string[]
  dates: string[]
  citedNorms: string[]
  authorities: string[]
  outcomeSignals: string[]
  holdings: string[]
  resolutionSnippets: string[]
  keySignals: string[]
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function safeText(value: unknown, maxLen = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > maxLen ? `${text.slice(0, maxLen).trim()}...` : text
}

function uniqueStrings(values: string[], max = 8) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = String(value || "").trim()
    if (!clean) continue
    const key = normalizeText(clean)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(clean)
    if (out.length >= max) break
  }
  return out
}

function firstMatches(content: string, regexes: RegExp[], max = 4) {
  const out: string[] = []
  for (const regex of regexes) {
    for (const match of String(content || "").matchAll(regex)) {
      const value = String(match[1] || match[0] || "").replace(/\s+/g, " ").trim()
      if (!value) continue
      out.push(value)
      if (out.length >= max) return uniqueStrings(out, max)
    }
  }
  return uniqueStrings(out, max)
}

function sentenceAround(content: string, token: string, maxChars = 220) {
  const clean = String(content || "").replace(/\s+/g, " ")
  if (!clean || !token) return ""
  const index = clean.toLowerCase().indexOf(token.toLowerCase())
  if (index < 0) return ""
  const before = clean.lastIndexOf(". ", index)
  const after = clean.indexOf(". ", index)
  const start = before >= 0 ? before + 2 : 0
  const end = after >= 0 ? after + 1 : clean.length
  const sentence = clean.slice(start, end).trim()
  if (!sentence) return ""
  return sentence.length > maxChars ? `${sentence.slice(0, maxChars).trim()}...` : sentence
}

function extractClaimants(content: string) {
  return firstMatches(
    content,
    [
      /RECLAMANTE\s*:\s*([^\n]+)/gi,
      /en representaci[oó]n de la reclamante,\s*([^,.;\n]+)/gi,
      /la reclamante,\s*([^,.;\n]+)/gi,
      /parte reclamante[:\s]+([^,.;\n]+)/gi,
      /reclamante[:\s]+([^,.;\n]+)/gi,
    ],
    4
  ).map((item) => item.replace(/\bMATERIA\b.*$/i, "").replace(/\bRUT\b.*$/i, "").trim())
}

function extractFojas(content: string) {
  return uniqueStrings(
    Array.from(String(content || "").matchAll(/fojas?\s+(\d{1,6})/gi)).map((match) => String(match[1] || "").trim()),
    8
  )
}

function extractDates(content: string) {
  return firstMatches(
    content,
    [
      /(\b\d{1,2}\s+de\s+[a-záéíóúñ]+\s+de\s+\d{4}\b)/gi,
      /(\b\d{4}-\d{2}-\d{2}\b)/g,
      /(\b\d{1,2}-\d{1,2}-\d{4}\b)/g,
    ],
    6
  )
}

function extractResolutionSnippets(content: string) {
  const tokens = [
    "a lo principal",
    "se resuelve",
    "tengase por evacuado el informe",
    "por evacuado informe",
    "se tiene presente",
    "se admite a tramite",
    "acoge el recurso",
    "rechaza el recurso",
  ]

  return uniqueStrings(
    tokens
      .map((token) => sentenceAround(content, token))
      .filter(Boolean),
    4
  )
}

function extractCitedNorms(content: string) {
  const articleMatches = Array.from(String(content || "").matchAll(/\b(?:art\.?|articulo)\s*\d+[a-z]?\b/gi)).map((match) => String(match[0] || "").trim())
  const knownNorms = ["Ley 19.300", "Ley 20.417", "DS 40", "Reglamento del SEIA", "LBGMA"]
  const normMatches = knownNorms.filter((token) => normalizeText(content).includes(normalizeText(token)))
  return uniqueStrings([...articleMatches, ...normMatches], 8)
}

function extractAuthorities(content: string) {
  const authorities = [
    "SEA",
    "Servicio de Evaluacion Ambiental",
    "SMA",
    "Superintendencia del Medio Ambiente",
    "Comite de Ministros",
    "Tribunal Ambiental",
  ]
  return uniqueStrings(authorities.filter((token) => normalizeText(content).includes(normalizeText(token))), 6)
}

function extractOutcomeSignals(content: string) {
  const tokens = ["acoge", "rechaza", "inadmisible", "tengase por evacuado el informe", "se tiene presente"]
  return uniqueStrings(tokens.map((token) => sentenceAround(content, token)).filter(Boolean), 5)
}

function extractHoldings(content: string) {
  const tokens = [
    "se concluye",
    "esta magistratura",
    "la reclamacion sera rechazada",
    "la reclamacion sera acogida",
    "no se advierte ilegalidad",
  ]
  return uniqueStrings(tokens.map((token) => sentenceAround(content, token)).filter(Boolean), 5)
}

function extractKeySignals(content: string) {
  const tokens = [
    "precedente administrativo",
    "interpretacion uniforme",
    "previsibilidad",
    "uniformidad",
    "seguridad juridica",
    "legitima confianza",
    "no vinculantes para el sea",
    "comite de ministros",
    "observaciones no debidamente consideradas",
  ]

  return uniqueStrings(
    tokens
      .map((token) => sentenceAround(content, token))
      .filter(Boolean),
    6
  )
}

function questionRoleTokens(question: string, extraRoleTokens?: string[]) {
  const tokens = uniqueStrings(
    [
      ...Array.from(String(question || "").matchAll(/\bR-\d{1,5}-\d{4}\b/gi)).map((match) => String(match[0] || "").toUpperCase()),
      ...(Array.isArray(extraRoleTokens) ? extraRoleTokens.map((item) => String(item || "").toUpperCase()) : []),
    ],
    6
  )
  return tokens
}

function inferDocRoleHint(question: string) {
  const normalized = normalizeText(question)
  if (normalized.includes("sentencia") || normalized.includes("fallo")) return "sentencia"
  if (normalized.includes("informe") || normalized.includes("evacua")) return "informe"
  if (
    normalized.includes("reclamacion") ||
    normalized.includes("reclamante") ||
    normalized.includes("escrito inicial") ||
    normalized.includes("desistim")
  ) {
    return "reclamacion"
  }
  return null
}

export function extractTribunalDocumentFact(params: {
  documentId?: string | null
  causeId?: string | null
  rol?: string | null
  docRole?: string | null
  sourceId?: string | null
  snapshotId?: string | null
  sourceTitle?: string | null
  documentType?: string | null
  documentName?: string | null
  documentUrl?: string | null
  content?: string | null
}) {
  const content = String(params.content || "")
  return {
    documentId: params.documentId ? String(params.documentId) : null,
    causeId: params.causeId ? String(params.causeId) : null,
    rol: params.rol ? String(params.rol).toUpperCase() : null,
    docRole: params.docRole ? String(params.docRole) : null,
    sourceId: params.sourceId ? String(params.sourceId) : null,
    snapshotId: params.snapshotId ? String(params.snapshotId) : null,
    sourceTitle: params.sourceTitle ? String(params.sourceTitle) : null,
    documentType: params.documentType ? String(params.documentType) : null,
    documentName: params.documentName ? String(params.documentName) : null,
    documentUrl: params.documentUrl ? String(params.documentUrl) : null,
    claimants: extractClaimants(content),
    fojas: extractFojas(content),
    dates: extractDates(content),
    citedNorms: extractCitedNorms(content),
    authorities: extractAuthorities(content),
    outcomeSignals: extractOutcomeSignals(content),
    holdings: extractHoldings(content),
    resolutionSnippets: extractResolutionSnippets(content),
    keySignals: extractKeySignals(content),
  } satisfies TribunalDocumentFact
}

function mergeFacts(rows: TribunalDocumentFact[]) {
  if (!rows.length) return [] as TribunalDocumentFact[]
  const byDocument = new Map<string, TribunalDocumentFact>()
  for (const row of rows) {
    const key = String(row.documentId || row.snapshotId || row.sourceId || row.sourceTitle || "")
    if (!key) continue
    const current = byDocument.get(key)
    if (!current) {
      byDocument.set(key, {
        ...row,
        claimants: uniqueStrings(row.claimants || [], 8),
        fojas: uniqueStrings(row.fojas || [], 8),
        dates: uniqueStrings(row.dates || [], 8),
        citedNorms: uniqueStrings(row.citedNorms || [], 8),
        authorities: uniqueStrings(row.authorities || [], 6),
        outcomeSignals: uniqueStrings(row.outcomeSignals || [], 5),
        holdings: uniqueStrings(row.holdings || [], 5),
        resolutionSnippets: uniqueStrings(row.resolutionSnippets || [], 6),
        keySignals: uniqueStrings(row.keySignals || [], 8),
      })
      continue
    }
    current.claimants = uniqueStrings([...(current.claimants || []), ...(row.claimants || [])], 8)
    current.fojas = uniqueStrings([...(current.fojas || []), ...(row.fojas || [])], 8)
    current.dates = uniqueStrings([...(current.dates || []), ...(row.dates || [])], 8)
    current.citedNorms = uniqueStrings([...(current.citedNorms || []), ...(row.citedNorms || [])], 8)
    current.authorities = uniqueStrings([...(current.authorities || []), ...(row.authorities || [])], 6)
    current.outcomeSignals = uniqueStrings([...(current.outcomeSignals || []), ...(row.outcomeSignals || [])], 5)
    current.holdings = uniqueStrings([...(current.holdings || []), ...(row.holdings || [])], 5)
    current.resolutionSnippets = uniqueStrings(
      [...(current.resolutionSnippets || []), ...(row.resolutionSnippets || [])],
      6
    )
    current.keySignals = uniqueStrings([...(current.keySignals || []), ...(row.keySignals || [])], 8)
  }
  return Array.from(byDocument.values())
}

async function loadPersistedTribunalFacts(params: {
  admin: any
  roleTokens: string[]
  docRoleHint: string | null
  limit: number
}) {
  if (!params.roleTokens.length) return [] as TribunalDocumentFact[]

  const query = params.admin
    .from("gob_tribunal_document_facts")
    .select(
      "document_id,cause_id,rol,doc_role,source_id,snapshot_id,source_title,document_type,document_name,document_url,claimants,fojas,dates,cited_norms,authorities,outcome_signals,holdings,resolution_snippets,key_signals"
    )
    .in("rol", params.roleTokens)
    .limit(Math.max(12, Math.min(80, params.limit * 8)))

  const { data, error } = params.docRoleHint
    ? await query.eq("doc_role", params.docRoleHint)
    : await query

  if (error || !Array.isArray(data)) return [] as TribunalDocumentFact[]

  return data.map((row: any) => ({
    documentId: row?.document_id ? String(row.document_id) : null,
    causeId: row?.cause_id ? String(row.cause_id) : null,
    rol: row?.rol ? String(row.rol) : null,
    docRole: row?.doc_role ? String(row.doc_role) : null,
    sourceId: row?.source_id ? String(row.source_id) : null,
    snapshotId: row?.snapshot_id ? String(row.snapshot_id) : null,
    sourceTitle: row?.source_title ? String(row.source_title) : null,
    documentType: row?.document_type ? String(row.document_type) : null,
    documentName: row?.document_name ? String(row.document_name) : null,
    documentUrl: row?.document_url ? String(row.document_url) : null,
    claimants: Array.isArray(row?.claimants) ? row.claimants.map(String) : [],
    fojas: Array.isArray(row?.fojas) ? row.fojas.map(String) : [],
    dates: Array.isArray(row?.dates) ? row.dates.map(String) : [],
    citedNorms: Array.isArray(row?.cited_norms) ? row.cited_norms.map(String) : [],
    authorities: Array.isArray(row?.authorities) ? row.authorities.map(String) : [],
    outcomeSignals: Array.isArray(row?.outcome_signals) ? row.outcome_signals.map(String) : [],
    holdings: Array.isArray(row?.holdings) ? row.holdings.map(String) : [],
    resolutionSnippets: Array.isArray(row?.resolution_snippets) ? row.resolution_snippets.map(String) : [],
    keySignals: Array.isArray(row?.key_signals) ? row.key_signals.map(String) : [],
  }))
}

async function buildLiveTribunalFacts(params: {
  admin: any
  question: string
  roleTokens: string[]
  docRoleHint: string | null
  limit: number
}) {
  if (!params.roleTokens.length) return [] as TribunalDocumentFact[]

  const { data: sources, error: sourceErr } = await params.admin
    .from("gob_sources")
    .select("id,title,doc_type,attributes,url")
    .eq("source_origin", "tribunal-corpus")
    .limit(4000)

  if (sourceErr || !Array.isArray(sources)) return [] as TribunalDocumentFact[]

  const matchingSources = sources.filter((row: any) => {
    const attrs = row?.attributes && typeof row.attributes === "object" ? row.attributes : {}
    const rol = String(attrs?.rol || "").toUpperCase()
    if (!rol || !params.roleTokens.includes(rol)) return false
    const role =
      attrs?.doc_role
        ? String(attrs.doc_role)
        : classifyTribunalDocumentRole({
            documentType: row?.doc_type ? String(row.doc_type) : null,
            name: row?.title ? String(row.title) : null,
            title: row?.doc_type ? String(row.doc_type) : row?.title ? String(row.title) : null,
          })
    return !params.docRoleHint || role === params.docRoleHint
  })

  if (!matchingSources.length) return [] as TribunalDocumentFact[]

  const sourceIds = matchingSources.map((row: any) => String(row.id)).filter(Boolean).slice(0, 80)
  const { data: snapshots, error: snapshotErr } = await params.admin
    .from("gob_source_snapshots")
    .select("id,source_id,status")
    .in("source_id", sourceIds)
    .eq("status", "ready")
    .order("created_at", { ascending: false })

  if (snapshotErr || !Array.isArray(snapshots)) return [] as TribunalDocumentFact[]

  const snapshotBySourceId = new Map<string, string>()
  for (const row of snapshots) {
    const sourceId = String((row as any)?.source_id || "")
    if (sourceId && !snapshotBySourceId.has(sourceId)) {
      snapshotBySourceId.set(sourceId, String((row as any)?.id || ""))
    }
  }

  const snapshotIds = Array.from(snapshotBySourceId.values()).filter(Boolean).slice(0, Math.max(12, params.limit * 6))
  if (!snapshotIds.length) return [] as TribunalDocumentFact[]

  const { data: chunks, error: chunksErr } = await params.admin
    .from("gob_chunks")
    .select("id,snapshot_id,content,section")
    .in("snapshot_id", snapshotIds)
    .limit(Math.max(400, Math.min(2400, snapshotIds.length * 40)))

  if (chunksErr || !Array.isArray(chunks)) return [] as TribunalDocumentFact[]

  const sourceById = new Map(matchingSources.map((row: any) => [String(row.id), row]))
  const sourceIdBySnapshotId = new Map<string, string>()
  for (const [sourceId, snapshotId] of snapshotBySourceId.entries()) {
    if (snapshotId) sourceIdBySnapshotId.set(snapshotId, sourceId)
  }

  const extracted = chunks.map((row: any) => {
    const snapshotId = String(row?.snapshot_id || "")
    const sourceId = sourceIdBySnapshotId.get(snapshotId) || ""
    const source = sourceById.get(sourceId)
    const attrs = source?.attributes && typeof source.attributes === "object" ? source.attributes : {}
    const docRole = attrs?.doc_role
      ? String(attrs.doc_role)
      : classifyTribunalDocumentRole({
          documentType: source?.doc_type ? String(source.doc_type) : null,
          name: source?.title ? String(source.title) : null,
          title: source?.doc_type ? String(source.doc_type) : source?.title ? String(source.title) : null,
        })
    return extractTribunalDocumentFact({
      documentId: attrs?.tribunal_document_id ? String(attrs.tribunal_document_id) : null,
      causeId: attrs?.tribunal_cause_id ? String(attrs.tribunal_cause_id) : null,
      rol: attrs?.rol ? String(attrs.rol) : null,
      docRole,
      sourceId,
      snapshotId,
      sourceTitle: source?.title ? String(source.title) : null,
      documentType: source?.doc_type ? String(source.doc_type) : null,
      documentName: source?.title ? String(source.title) : null,
      documentUrl: source?.url ? String(source.url) : null,
      content: [row?.section ? String(row.section) : "", row?.content ? String(row.content) : ""].join("\n"),
    })
  })

  return mergeFacts(extracted).slice(0, Math.max(4, params.limit))
}

function scoreFact(question: string, fact: TribunalDocumentFact, docRoleHint: string | null) {
  const normalizedQuestion = normalizeText(question)
  let score = 0
  if (docRoleHint && String(fact.docRole || "") === docRoleHint) score += 40
  if (normalizedQuestion.includes("foja") && fact.fojas.length) score += 40
  if (normalizedQuestion.includes("reclamante") && fact.claimants.length) score += 35
  if ((normalizedQuestion.includes("resolucion") || normalizedQuestion.includes("se resuelve")) && fact.resolutionSnippets.length) score += 35
  if (normalizedQuestion.includes("fecha") && fact.dates.length) score += 20
  if ((normalizedQuestion.includes("norma") || normalizedQuestion.includes("articulo") || normalizedQuestion.includes("ley")) && fact.citedNorms.length) score += 24
  if ((normalizedQuestion.includes("sea") || normalizedQuestion.includes("sma") || normalizedQuestion.includes("comite")) && fact.authorities.length) score += 18
  if ((normalizedQuestion.includes("resultado") || normalizedQuestion.includes("rechaza") || normalizedQuestion.includes("acoge")) && fact.outcomeSignals.length) score += 22
  if ((normalizedQuestion.includes("criterio") || normalizedQuestion.includes("concluye") || normalizedQuestion.includes("holding")) && fact.holdings.length) score += 24
  if (normalizedQuestion.includes("precedente") || normalizedQuestion.includes("criterio") || normalizedQuestion.includes("riesgo")) {
    score += Math.min(24, fact.keySignals.length * 6)
  }
  if (fact.docRole === "informe") score += 6
  if (fact.docRole === "sentencia") score += 5
  if (fact.docRole === "reclamacion") score += 2
  return score
}

export async function fetchTribunalDocumentFacts(params: {
  admin: any
  question: string
  roleTokens?: string[]
  limit?: number
}) {
  return getRuntimeCached({
    namespace: "tribunal-facts",
    key: JSON.stringify({
      question: params.question,
      roleTokens: Array.isArray(params.roleTokens) ? params.roleTokens : [],
      limit: Number(params.limit || 6),
    }),
    ttlMs: 5 * 60 * 1000,
    loader: async () => {
      const limit = Math.max(2, Math.min(12, Number(params.limit || 6)))
      const roleTokens = questionRoleTokens(params.question, params.roleTokens)
      const docRoleHint = inferDocRoleHint(params.question)
      if (!roleTokens.length) return [] as TribunalDocumentFact[]

      const persisted = await loadPersistedTribunalFacts({
        admin: params.admin,
        roleTokens,
        docRoleHint,
        limit,
      }).catch(() => [] as TribunalDocumentFact[])

      const facts = persisted.length
        ? persisted
        : await buildLiveTribunalFacts({
            admin: params.admin,
            question: params.question,
            roleTokens,
            docRoleHint,
            limit,
          })

      return facts
        .slice()
        .sort((a, b) => scoreFact(params.question, b, docRoleHint) - scoreFact(params.question, a, docRoleHint))
        .slice(0, limit)
    },
  })
}

export function buildFactSnapshotReferences(params: {
  question: string
  facts: TribunalDocumentFact[]
  maxRefs?: number
}) {
  const maxRefs = Math.max(2, Math.min(10, Number(params.maxRefs || 6)))
  return params.facts
    .filter((fact) => fact.snapshotId)
    .slice(0, maxRefs)
    .map((fact) => ({
      snapshotId: String(fact.snapshotId || ""),
      title: fact.sourceTitle || fact.documentName || null,
      docType: fact.documentType || null,
      docRole: fact.docRole || null,
      rol: fact.rol || null,
    }))
}
