import { NextResponse } from "next/server"
import { z } from "zod"
import { randomUUID } from "node:crypto"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { recordRetrievalTrace } from "@/lib/rag/retrieval-trace"
import { generateStrictAnswer, type EvidenceChunk } from "@/lib/rag/strict-answer"
import { generateOpenAIJson } from "@/lib/llm/openai-json"
import {
  classifyTribunalDocumentRole,
  ensureTribunalCorpusWorkspace,
  isStrictTribunalKeyDocument,
  syncTribunalCorpusDocuments,
} from "@/lib/onboarding/tribunal-corpus"
import {
  defenseRoleWeight,
} from "@/lib/tribunal/document-selection"
import { extractLegalGraphEntities } from "@/lib/tribunal/graph-entities"
import { buildGraphOverlapSignal } from "@/lib/tribunal/graph-overlap"
import {
  selectDefenseDocumentMix,
  selectRoleBalancedItems,
  summarizeDefenseDocumentCoverage,
} from "@/lib/tribunal/defense-document-policy"
import {
  loadOnboardingCauseProfiles,
  loadOnboardingDocumentProfiles,
  loadOnboardingEligibleCauseIds,
} from "@/lib/onboarding/defense-pool"
import { isEligibleOnboardingCause } from "@/lib/onboarding/eligibility"

const RecommendSchema = z
  .object({
    snapshotId: z.string().uuid(),
    question: z.string().trim().max(4000).optional().nullable(),
    maxCauses: z.number().int().min(3).max(20).optional(),
    filters: z
      .object({
        projectType: z.string().trim().max(160).optional().nullable(),
        region: z.string().trim().max(120).optional().nullable(),
        yearFrom: z.number().int().min(1900).max(2200).optional().nullable(),
        yearTo: z.number().int().min(1900).max(2200).optional().nullable(),
        themes: z.array(z.string().trim().min(2).max(120)).max(15).optional(),
      })
      .strict()
      .optional()
      .nullable(),
  })
  .strict()

type RecommendFilters = {
  projectType: string | null
  region: string | null
  yearFrom: number | null
  yearTo: number | null
  themes: string[]
}

type ScoreRow = {
  score: number
  best: number
  hits: number
}

type UtilityLabel = "core" | "support" | "discard"
type UtilityRisk = "low" | "medium" | "high"

type RerankDecision = {
  causeId: string
  label: UtilityLabel
  risk: UtilityRisk
  reason: string
}

type RankedChunk = {
  chunkId: string
  score: number
  content: string
  sourceUrl: string | null
  snapshotId: string | null
  page: number | null
  section: string | null
  sourceId: string
  causeId: string
  docId: string | null
  docRole: string
  docUrl: string | null
  docName: string | null
}

type ClaimChunkLex = {
  chunkId: string
  content: string
  tokens: Set<string>
}

type CauseAggregate = {
  causeId: string
  score: number
  best: number
  chunkHits: number
  chunkIds: Set<string>
  matchedDocIds: Set<string>
  docRoles: Set<string>
  topChunks: RankedChunk[]
}

const STOP_WORDS = new Set([
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "y",
  "o",
  "en",
  "al",
  "para",
  "con",
  "por",
  "que",
  "se",
  "su",
  "sus",
  "una",
  "uno",
  "unos",
  "unas",
  "lo",
  "como",
  "sobre",
  "ante",
  "desde",
  "hacia",
  "este",
  "esta",
  "estos",
  "estas",
  "esa",
  "ese",
  "esas",
  "esos",
])

const GENERIC_DEFENSE_TERMS = new Set([
  "tribunal",
  "ambiental",
  "reclamacion",
  "reclamo",
  "reclamante",
  "reclamada",
  "servicio",
  "evaluacion",
  "causa",
  "causas",
  "sentencia",
  "informe",
  "resolucion",
  "resoluciones",
  "expediente",
  "proceso",
  "procesal",
  "hechos",
  "hecho",
  "derecho",
  "articulo",
  "articulos",
  "medio",
  "ambiente",
])

const NON_DISTINCTIVE_ANCHOR_TERMS = new Set([
  "acto",
  "actos",
  "procedimiento",
  "administrativo",
  "presente",
  "adelante",
  "ilustre",
  "plazo",
  "derecho",
  "articulo",
  "articulos",
  "fecha",
  "pagina",
  "fojas",
  "considerando",
  "proyecto",
  "causa",
  "causas",
  "reclamado",
])

const CRITICAL_ANCHOR_HINTS = new Set([
  "sma",
  "sea",
  "seia",
  "rca",
  "pdc",
  "cargo",
  "cargos",
  "sancionatorio",
  "sancionatoria",
  "formulacion",
  "cumplimiento",
  "programa",
  "superintendencia",
  "ministerio",
  "seremi",
  "clausura",
  "multa",
  "revocacion",
  "invalidacion",
  "caducidad",
])

const FILE_NOISE_ANCHOR_TERMS = new Set([
  "reclamacion",
  "reclamo",
  "firmada",
  "firmado",
  "documento",
  "archivo",
  "anexo",
  "anexos",
  "version",
  "final",
  "copia",
  "foleado",
  "foleada",
])

function safeText(value: unknown, maxLen = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text
}

function resolveRecommendationDocRole(doc: any) {
  const explicit = doc?.doc_role ? String(doc.doc_role) : doc?.docRole ? String(doc.docRole) : ""
  if (explicit) return explicit
  const inferred = classifyTribunalDocumentRole({
    documentType: doc?.document_type ? String(doc.document_type) : null,
    name: doc?.name ? String(doc.name) : null,
    title: doc?.name ? String(doc.name) : null,
  })
  return inferred && inferred !== "documento" ? inferred : null
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function tokenize(value: unknown) {
  return normalizeText(value)
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x.length >= 4)
    .filter((x) => !STOP_WORDS.has(x))
}

function tokenSet(value: unknown) {
  return new Set(tokenize(value))
}

function isLikelyFileArtifactToken(token: string) {
  const clean = normalizeText(token)
  if (!clean) return false
  if (/^[a-f0-9]{7,}$/.test(clean)) return true
  if (/^\d{4,}$/.test(clean)) return true
  if (/[a-z]/.test(clean) && /\d/.test(clean)) return true
  const digitCount = (clean.match(/\d/g) || []).length
  if (digitCount >= 3) return true
  return false
}

function overlapRatio(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0
  let hits = 0
  for (const token of a) {
    if (b.has(token)) hits += 1
  }
  return hits / Math.max(1, Math.min(a.size, b.size))
}

function extractUpperAcronymTerms(value: unknown) {
  const text = String(value || "")
  const matches = text.match(/\b[A-Z0-9]{3,5}\b/g) || []
  const freq = new Map<string, number>()

  for (const raw of matches) {
    const token = String(raw || "")
      .trim()
      .toLowerCase()
    if (!token) continue
    if (/^\d+$/.test(token)) continue
    if (STOP_WORDS.has(token)) continue
    if (GENERIC_DEFENSE_TERMS.has(token)) continue
    freq.set(token, (freq.get(token) || 0) + 1)
  }

  return Array.from(freq.entries())
}

function extractDefenseAnchorFrequency(params: { question: string; claimText: string; sourceTitle?: string }) {
  const base = `${params.question || ""}\n${params.claimText || ""}`
  const sourceTitle = String(params.sourceTitle || "")
  const freq = new Map<string, number>()

  for (const token of tokenize(params.claimText || "")) {
    if (GENERIC_DEFENSE_TERMS.has(token)) continue
    if (/^\d+$/.test(token)) continue
    if (isLikelyFileArtifactToken(token)) continue
    freq.set(token, (freq.get(token) || 0) + 1)
  }

  for (const token of tokenize(params.question || "")) {
    if (GENERIC_DEFENSE_TERMS.has(token)) continue
    if (/^\d+$/.test(token)) continue
    if (isLikelyFileArtifactToken(token)) continue
    freq.set(token, (freq.get(token) || 0) + 2)
  }

  for (const token of tokenize(sourceTitle)) {
    if (GENERIC_DEFENSE_TERMS.has(token)) continue
    if (/^\d+$/.test(token)) continue
    if (isLikelyFileArtifactToken(token)) continue
    freq.set(token, (freq.get(token) || 0) + 3)
  }

  for (const [term, count] of extractUpperAcronymTerms(base)) {
    freq.set(term, (freq.get(term) || 0) + count * 2)
  }

  for (const [term, count] of extractUpperAcronymTerms(sourceTitle)) {
    freq.set(term, (freq.get(term) || 0) + count * 2)
  }

  for (const token of tokenize(base)) {
    if (GENERIC_DEFENSE_TERMS.has(token)) continue
    if (/^\d+$/.test(token)) continue
    if (isLikelyFileArtifactToken(token)) continue
    freq.set(token, (freq.get(token) || 0) + 1)
  }

  return Array.from(freq.entries()).sort((a, b) => b[1] - a[1])
}

function extractDefenseAnchors(params: {
  question: string
  claimText: string
  sourceTitle: string
  maxAnchors: number
}) {
  const titleAnchors = tokenize(params.sourceTitle || "")
    .filter((term) => !GENERIC_DEFENSE_TERMS.has(term))
    .filter((term) => !NON_DISTINCTIVE_ANCHOR_TERMS.has(term))
    .filter((term) => !FILE_NOISE_ANCHOR_TERMS.has(term))
    .filter((term) => !isLikelyFileArtifactToken(term))
    .slice(0, 6)

  const rankedAnchors = extractDefenseAnchorFrequency(params)
    .slice(0, Math.max(4, params.maxAnchors))
    .map(([term]) => term)

  return uniqueStrings([...titleAnchors, ...rankedAnchors]).slice(0, Math.max(4, params.maxAnchors))
}

function extractCriticalDefenseAnchors(params: {
  question: string
  claimText: string
  sourceTitle: string
  anchors: string[]
  maxCriticalAnchors: number
}) {
  const anchors = Array.isArray(params.anchors) ? params.anchors.map((x) => normalizeText(x)).filter(Boolean) : []
  if (!anchors.length) return [] as string[]

  const scoreByAnchor = new Map<string, number>(extractDefenseAnchorFrequency(params))
  const acronymSet = new Set(extractUpperAcronymTerms(`${params.question || ""}\n${params.claimText || ""}`).map(([term]) => term))
  const questionTokens = new Set(tokenize(params.question || ""))
  const titleTokens = new Set(tokenize(params.sourceTitle || ""))

  const distinctAnchors = anchors.filter((anchor) => {
    if (!anchor) return false
    if (STOP_WORDS.has(anchor)) return false
    if (GENERIC_DEFENSE_TERMS.has(anchor)) return false
    if (NON_DISTINCTIVE_ANCHOR_TERMS.has(anchor)) return false
    if (FILE_NOISE_ANCHOR_TERMS.has(anchor)) return false
    return true
  })

  const criticalCandidates = distinctAnchors.filter((anchor) => {
    const score = Number(scoreByAnchor.get(anchor) || 0)
    if (acronymSet.has(anchor)) return true
    if (CRITICAL_ANCHOR_HINTS.has(anchor)) return true
    if (questionTokens.has(anchor) && anchor.length >= 5) return true
    if (titleTokens.has(anchor) && anchor.length >= 5) return true
    return anchor.length >= 7 && score >= 3
  })

  const titleDrivenCandidates = distinctAnchors.filter((anchor) => titleTokens.has(anchor) && anchor.length >= 5)

  const fallbackCandidates = distinctAnchors.filter((anchor) => {
    const score = Number(scoreByAnchor.get(anchor) || 0)
    return score >= 4 || anchor.length >= 8
  })

  const selectedRaw = criticalCandidates.length
    ? uniqueStrings([...titleDrivenCandidates, ...criticalCandidates])
    : fallbackCandidates.length
      ? fallbackCandidates
      : distinctAnchors

  const selected = selectedRaw
    .map((anchor) => {
      const score = Number(scoreByAnchor.get(anchor) || 0)
      const priority =
        (CRITICAL_ANCHOR_HINTS.has(anchor) ? 6 : 0) +
        (titleTokens.has(anchor) ? 4 : 0) +
        (acronymSet.has(anchor) ? 3 : 0) +
        (questionTokens.has(anchor) ? 2 : 0) +
        Math.min(3, Math.floor(score / 3))
      return { anchor, priority, score }
    })
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      if (b.score !== a.score) return b.score - a.score
      return a.anchor.localeCompare(b.anchor)
    })
    .map((x) => x.anchor)

  return uniqueStrings(selected).slice(0, Math.max(1, params.maxCriticalAnchors))
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function hasAnchorMatch(haystack: string, anchor: string) {
  const cleanAnchor = normalizeText(anchor)
  if (!cleanAnchor) return false
  if (cleanAnchor.length <= 3) {
    const pattern = new RegExp(`(^|\\s)${escapeRegExp(cleanAnchor)}(\\s|$)`)
    return pattern.test(haystack)
  }
  return haystack.includes(cleanAnchor)
}

function anchorSignal(params: {
  anchors: string[]
  cause: any
  docs: any[]
  topChunks: RankedChunk[]
}) {
  const anchors = Array.isArray(params.anchors) ? params.anchors.filter(Boolean) : []
  if (!anchors.length) {
    return {
      anchorHits: 0,
      anchorCoverage: 0,
      matchedAnchors: [] as string[],
      missingAnchors: [] as string[],
    }
  }

  const haystack = normalizeText(
    [
      params.cause?.tribunal || "",
      params.cause?.rol || "",
      params.cause?.caratula || "",
      params.cause?.estado || "",
      ...(params.docs || []).slice(0, 6).map((doc: any) => `${doc?.document_type || ""} ${doc?.name || ""}`),
      ...(params.topChunks || []).slice(0, 5).map((chunk) => chunk.content || ""),
    ].join("\n")
  )

  const matchedAnchors = anchors.filter((anchor) => hasAnchorMatch(haystack, anchor))
  const matchedSet = new Set(matchedAnchors)
  const anchorHits = matchedAnchors.length
  const anchorCoverage = anchors.length ? Number((anchorHits / anchors.length).toFixed(4)) : 0

  return {
    anchorHits,
    anchorCoverage,
    matchedAnchors: matchedAnchors.slice(0, 8),
    missingAnchors: anchors.filter((anchor) => !matchedSet.has(anchor)).slice(0, 8),
  }
}

function buildKeywordQuery(text: string) {
  const terms = tokenize(text)
  if (!terms.length) return ""
  const freq = new Map<string, number>()
  for (const term of terms) {
    freq.set(term, (freq.get(term) || 0) + 1)
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k]) => k)
    .join(" OR ")
}

function buildFocusedKeywordPairs(text: string) {
  const terms = tokenize(text)
  if (!terms.length) return [] as string[]
  const freq = new Map<string, number>()
  for (const term of terms) {
    freq.set(term, (freq.get(term) || 0) + 1)
  }

  const topTerms = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([term]) => term)

  const out: string[] = []
  for (let i = 0; i < topTerms.length - 1; i += 2) {
    const a = topTerms[i]
    const b = topTerms[i + 1]
    if (!a || !b) continue
    out.push(`${a} ${b}`)
  }
  return out.slice(0, 4)
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const clean = String(value || "").trim()
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    out.push(clean)
  }
  return out
}

function chunkArray<T>(items: T[], size: number) {
  const out: T[][] = []
  const n = Math.max(1, Math.floor(size))
  for (let i = 0; i < items.length; i += n) {
    out.push(items.slice(i, i + n))
  }
  return out
}

function clipQuote(text: string, maxLen = 300) {
  const clean = String(text || "").replace(/\s+/g, " ").trim()
  if (!clean) return ""
  if (clean.length <= maxLen) return clean
  return `${clean.slice(0, maxLen)}...`
}

function parseDate(value: string | null) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d
}

function buildSearchQueries(params: {
  question: string
  claimText: string
  firstChunk: string
  sourceTitle: string
  filters: RecommendFilters
}) {
  const compactClaim = params.claimText.slice(0, 6000)
  const keywordQuery = buildKeywordQuery(compactClaim)
  const focusedPairs = buildFocusedKeywordPairs(compactClaim)
  const fromFirstChunk = safeText(params.firstChunk, 700)
  const fromFirstChunkKeywords = buildKeywordQuery(fromFirstChunk)
  const questionKeywords = buildKeywordQuery(params.question)
  const filterText = uniqueStrings([
    params.filters.projectType,
    params.filters.region,
    ...(params.filters.themes || []),
    params.filters.yearFrom ? String(params.filters.yearFrom) : "",
    params.filters.yearTo ? String(params.filters.yearTo) : "",
  ]).join(" ")
  const filterKeywords = buildKeywordQuery(filterText)

  const genericLegalQuery = "evacua informe OR informe OR sentencia OR fallo OR resolucion OR reclamacion"

  return uniqueStrings([
    params.question,
    questionKeywords,
    `${safeText(params.question, 350)} ${genericLegalQuery}`,
    filterKeywords,
    keywordQuery,
    ...focusedPairs,
    fromFirstChunkKeywords,
    fromFirstChunk,
    params.sourceTitle,
    genericLegalQuery,
  ])
    .map((q) => q.slice(0, 900))
    .filter((q) => q.length >= 4)
    .slice(0, 9)
}

function roleBonus(roles: Set<string>) {
  let bonus = 0
  if (roles.has("informe")) bonus += 1.35
  if (roles.has("sentencia")) bonus += 1.2
  if (roles.has("reclamacion")) bonus += 0.35
  if (roles.has("informe") && roles.has("sentencia")) bonus += 1.15
  if (roles.has("reclamacion") && (roles.has("informe") || roles.has("sentencia"))) bonus += 0.2
  return bonus
}

function resolveCauseId(sourceRow: any, byUrlDoc: Map<string, any>, byDocId: Map<string, any>) {
  const attrs = sourceRow?.attributes && typeof sourceRow.attributes === "object" ? sourceRow.attributes : {}
  const fromAttr = attrs?.tribunal_cause_id ? String(attrs.tribunal_cause_id) : null
  if (fromAttr) return fromAttr

  const fromAttrDoc = attrs?.tribunal_document_id ? String(attrs.tribunal_document_id) : null
  if (fromAttrDoc && byDocId.has(fromAttrDoc)) {
    return String(byDocId.get(fromAttrDoc)?.cause_id || "") || null
  }

  const fromUrl = sourceRow?.url ? byUrlDoc.get(String(sourceRow.url)) : null
  if (fromUrl?.cause_id) return String(fromUrl.cause_id)
  return null
}

function resolveDocId(sourceRow: any, byUrlDoc: Map<string, any>, byDocId: Map<string, any>) {
  const attrs = sourceRow?.attributes && typeof sourceRow.attributes === "object" ? sourceRow.attributes : {}
  const fromAttr = attrs?.tribunal_document_id ? String(attrs.tribunal_document_id) : null
  if (fromAttr) return fromAttr

  const fromUrl = sourceRow?.url ? byUrlDoc.get(String(sourceRow.url)) : null
  if (fromUrl?.id) return String(fromUrl.id)
  return null
}

function buildFallbackReason(cause: any, docRoles: Set<string>, lexicalScore: number) {
  const reasons: string[] = []
  if (lexicalScore > 0.08) {
    reasons.push(`Coincidencia tematica con la reclamacion (${Math.round(lexicalScore * 100)}%).`)
  }
  if (docRoles.has("informe") || docRoles.has("sentencia")) {
    reasons.push(
      `Cobertura documental prioritaria: ${Array.from(docRoles)
        .filter((role) => role === "informe" || role === "sentencia")
        .join(", ")}.`
    )
  } else if (docRoles.has("reclamacion")) {
    reasons.push("La causa incluye principalmente escrito inicial; usarlo para contexto, no como soporte principal.")
  }
  if (cause?.estado) {
    reasons.push(`Estado de la causa: ${safeText(cause.estado, 140)}.`)
  }
  return reasons.slice(0, 3)
}

function docDefenseContribution(doc: any) {
  const text = normalizeText(`${doc?.document_type || ""} ${doc?.name || ""}`)
  if (text.includes("sentencia")) {
    return "Aporta el resultado de la estrategia y criterios de decision del tribunal, utiles para saber que funciono y que fracaso."
  }
  if (text.includes("informe") || text.includes("evacua")) {
    return "Aporta la defensa tecnica del SEA o de la reclamada, util para mantener criterios y reutilizar lineas argumentales efectivas."
  }
  if (text.includes("reclamacion") || text.includes("escrito inicial") || text.includes("demanda")) {
    return "Sirve para contextualizar hechos y tesis de apertura, pero no deberia desplazar al informe o a la sentencia como documento principal."
  }
  return "Documento complementario para reforzar trazabilidad factual y procesal."
}

function inferConfidence(params: { lexicalScore: number; docRoles: Set<string>; quoteCount: number }) {
  const { lexicalScore, docRoles, quoteCount } = params
  let score = 0
  if (lexicalScore >= 0.13) score += 2
  else if (lexicalScore >= 0.08) score += 1
  if (docRoles.has("informe")) score += 2
  if (docRoles.has("sentencia")) score += 2
  if (docRoles.has("reclamacion")) score += 0.5
  if (docRoles.has("informe") && docRoles.has("sentencia")) score += 1
  if (quoteCount >= 3) score += 1

  if (score >= 5) return "alta"
  if (score >= 3) return "media"
  return "baja"
}

function buildStrategicActions(params: {
  cause: any
  lexicalScore: number
  docRoles: Set<string>
  confidence: string
}) {
  const { cause, lexicalScore, docRoles, confidence } = params
  const actions: string[] = []

  if (docRoles.has("informe")) {
    actions.push("Revisar primero el Evacua Informe para extraer la defensa tecnica del SEA y mantener criterios consistentes.")
  }
  if (docRoles.has("sentencia")) {
    actions.push("Revisar luego la sentencia o resolucion final para verificar si la estrategia funciono o fracaso y por que.")
  }
  if (docRoles.has("reclamacion")) {
    actions.push("Usar el escrito inicial solo para contextualizar hechos y contrastar la tesis de entrada con la respuesta del SEA.")
  }

  actions.push("Comparar hechos de la reclamacion con los fundamentos acogidos/rechazados en esta causa.")

  if (confidence === "baja" || lexicalScore < 0.08) {
    actions.push("Usar esta causa como referencia secundaria, no como pilar principal del escrito.")
  } else {
    actions.push("Priorizar esta causa dentro del marco teorico y citarla en la seccion de analogia jurisprudencial.")
  }

  if (cause?.estado) {
    actions.push(`Verificar estado procesal actual (${safeText(cause.estado, 90)}) antes de usarla como precedente central.`)
  }

  return actions.slice(0, 4)
}

function findBestClaimMatch(chunkContent: string, claimChunksLex: ClaimChunkLex[]) {
  const targetTokens = tokenSet(chunkContent)
  if (!targetTokens.size || !claimChunksLex.length) {
    return { quote: null as string | null, overlap: 0 }
  }

  let best: { quote: string | null; overlap: number } = { quote: null, overlap: 0 }
  for (const row of claimChunksLex) {
    const ratio = overlapRatio(targetTokens, row.tokens)
    if (ratio > best.overlap) {
      best = {
        quote: clipQuote(row.content, 260),
        overlap: ratio,
      }
    }
  }

  return {
    quote: best.quote,
    overlap: Number(best.overlap.toFixed(4)),
  }
}

function buildSimilarityComment(params: {
  overlap: number
  docRole: string
  hasClaimQuote: boolean
}) {
  const { overlap, docRole, hasClaimQuote } = params
  const overlapPct = Math.round(overlap * 100)
  const roleHint =
    docRole === "sentencia"
      ? "aporta criterio jurisprudencial de cierre"
      : docRole === "informe"
        ? "anticipa defensa tecnica de la reclamada"
        : docRole === "reclamacion"
          ? "permite contrastar construccion argumental inicial"
          : "entrega contexto documental complementario"

  if (!hasClaimQuote) {
    return `Similitud detectada (${overlapPct}%) y ${roleHint}; revisar manualmente contexto completo para validar uso en defensa.`
  }

  if (overlap >= 0.14) {
    return `Coincidencia fuerte (${overlapPct}%) y ${roleHint}; util para reforzar argumentacion principal.`
  }
  if (overlap >= 0.08) {
    return `Coincidencia media (${overlapPct}%) y ${roleHint}; usar como soporte secundario con cita precisa.`
  }
  return `Coincidencia baja (${overlapPct}%), pero ${roleHint}; requiere corroboracion adicional antes de citar.`
}

function commonTermsBetween(a: string | null, b: string | null, limit = 8) {
  const aTokens = new Set(tokenize(a || ""))
  const bTokens = new Set(tokenize(b || ""))
  if (!aTokens.size || !bTokens.size) return [] as string[]
  const common: string[] = []
  for (const token of aTokens) {
    if (bTokens.has(token)) common.push(token)
    if (common.length >= limit) break
  }
  return common
}

function classifySimilarityType(params: { claimQuote: string | null; precedentQuote: string; docRole: string }) {
  const text = normalizeText(`${params.claimQuote || ""} ${params.precedentQuote || ""}`)
  if (
    text.includes("articulo") ||
    text.includes("ley") ||
    text.includes("decreto") ||
    text.includes("norma") ||
    text.includes("reglamento")
  ) {
    return "norma"
  }
  if (
    params.docRole === "sentencia" ||
    text.includes("considerando") ||
    text.includes("acoge") ||
    text.includes("rechaza") ||
    text.includes("fallo")
  ) {
    return "criterio_judicial"
  }
  if (
    params.docRole === "informe" ||
    text.includes("evacua") ||
    text.includes("traslado") ||
    text.includes("resolucion") ||
    text.includes("fojas")
  ) {
    return "estrategia_procesal"
  }
  return "hecho"
}

function similarityTypeLabel(type: string) {
  if (type === "norma") return "Norma"
  if (type === "criterio_judicial") return "Criterio judicial"
  if (type === "estrategia_procesal") return "Estrategia procesal"
  return "Hecho"
}

function proceduralStageFit(cause: any, docRoles: Set<string>) {
  const status = normalizeText(`${cause?.estado || ""} ${cause?.estado_subtipo || ""}`)
  let fit = 0.5

  if (status.includes("sentencia") || status.includes("cumplimiento")) fit += 0.2
  if (status.includes("en tramitacion") || status.includes("demanda") || status.includes("informe")) fit += 0.12
  if (docRoles.has("sentencia")) fit += 0.12
  if (docRoles.has("informe")) fit += 0.1
  if (docRoles.has("reclamacion")) fit += 0.06

  return Math.min(1, Number(fit.toFixed(4)))
}

function buildScoreBreakdown(params: {
  textualSimilarity: number
  documentQuality: number
  proceduralStage: number
  filterBoost: number
  lexicalCausaOverlap: number
  graphRelevance?: number
}) {
  const total =
    params.textualSimilarity +
    params.documentQuality +
    params.proceduralStage +
    params.filterBoost +
    params.lexicalCausaOverlap +
    (params.graphRelevance || 0)

  return {
    textualSimilarity: Number(params.textualSimilarity.toFixed(4)),
    documentQuality: Number(params.documentQuality.toFixed(4)),
    proceduralStage: Number(params.proceduralStage.toFixed(4)),
    filterBoost: Number(params.filterBoost.toFixed(4)),
    lexicalCausaOverlap: Number(params.lexicalCausaOverlap.toFixed(4)),
    graphRelevance: Number((params.graphRelevance || 0).toFixed(4)),
    total: Number(total.toFixed(4)),
  }
}

function buildScoreDrivers(breakdown: {
  textualSimilarity: number
  documentQuality: number
  proceduralStage: number
  filterBoost: number
  lexicalCausaOverlap: number
  graphRelevance?: number
}) {
  const up: string[] = []
  const down: string[] = []

  if (breakdown.textualSimilarity >= 1.4) up.push("Alta similitud textual con la reclamacion.")
  else if (breakdown.textualSimilarity <= 0.7) down.push("Similitud textual limitada frente a otras causas.")

  if (breakdown.documentQuality >= 1.1) up.push("Cobertura documental fuerte, con foco en informe/sentencia.")
  else if (breakdown.documentQuality <= 0.5) down.push("Cobertura documental parcial o poco robusta.")

  if (breakdown.proceduralStage >= 0.8) up.push("Buena compatibilidad de etapa procesal con la estrategia actual.")
  else if (breakdown.proceduralStage <= 0.55) down.push("Etapa procesal menos alineada para uso inmediato.")

  if (breakdown.filterBoost > 0) up.push("Cumple filtros estrategicos definidos por el usuario.")
  if (breakdown.lexicalCausaOverlap < 0.18) down.push("Coincidencia lexical causa/reclamacion moderada o baja.")
  if ((breakdown.graphRelevance || 0) >= 0.45) up.push("El grafo legal refuerza la similitud por normas, autoridades o materias compartidas.")
  else if ((breakdown.graphRelevance || 0) <= 0.08) down.push("El grafo legal no aporta demasiadas coincidencias estructurales.")

  return {
    up: up.slice(0, 4),
    down: down.slice(0, 3),
  }
}

function confidenceRules() {
  return {
    alta: "Se alcanza cuando hay alta similitud textual, cobertura documental robusta y buena alineacion procesal.",
    media: "Se alcanza con coincidencias relevantes, pero con alguna brecha en evidencia o etapa procesal.",
    baja: "Se asigna cuando la similitud o respaldo documental son limitados; usar como referencia secundaria.",
  }
}

function boolEnv(name: string, fallback = false) {
  const raw = String(process.env[name] || "")
    .trim()
    .toLowerCase()
  if (!raw) return fallback
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false
  return fallback
}

function numberEnv(name: string, fallback: number, min: number, max: number) {
  const raw = String(process.env[name] || "").trim()
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function normalizeUtilityLabel(value: string): UtilityLabel {
  const clean = String(value || "")
    .trim()
    .toLowerCase()
  if (clean === "core") return "core"
  if (clean === "discard") return "discard"
  return "support"
}

function normalizeUtilityRisk(value: string): UtilityRisk {
  const clean = String(value || "")
    .trim()
    .toLowerCase()
  if (clean === "low") return "low"
  if (clean === "high") return "high"
  return "medium"
}

function defaultUtilityLabelFromConfidence(confidence: string): UtilityLabel {
  const clean = String(confidence || "")
    .trim()
    .toLowerCase()
  if (clean === "alta") return "core"
  if (clean === "baja") return "discard"
  return "support"
}

function defaultUtilityRiskFromConfidence(confidence: string): UtilityRisk {
  const clean = String(confidence || "")
    .trim()
    .toLowerCase()
  if (clean === "alta") return "low"
  if (clean === "baja") return "high"
  return "medium"
}

function utilityLabelRank(label: string) {
  const clean = normalizeUtilityLabel(label)
  if (clean === "core") return 0
  if (clean === "support") return 1
  return 2
}

function applyDefenseAnchorGate(params: {
  recommendations: any[]
  anchors: string[]
  criticalAnchors: string[]
  enabled: boolean
  requireCriticalMatch: boolean
  minCoreAnchorHits: number
  minSupportAnchorHits: number
  minCoreCriticalAnchorHits: number
  minSupportCriticalAnchorHits: number
}) {
  const recommendations = Array.isArray(params.recommendations) ? params.recommendations : []
  const anchors = Array.isArray(params.anchors)
    ? params.anchors.map((x) => normalizeText(x)).filter(Boolean)
    : []
  const criticalAnchors = Array.isArray(params.criticalAnchors)
    ? params.criticalAnchors.map((x) => normalizeText(x)).filter(Boolean)
    : []
  const criticalAnchorSet = new Set(criticalAnchors)

  if (!recommendations.length) {
    return {
      recommendations,
      summary: {
        enabled: false,
        criticalEnabled: false,
        minCoreHits: 0,
        minSupportHits: 0,
        minCoreCriticalHits: 0,
        minSupportCriticalHits: 0,
        anchorCount: anchors.length,
        criticalAnchorCount: criticalAnchors.length,
        matchedCauses: 0,
        criticalMatchedCauses: 0,
        supportPassedCauses: 0,
        downgradedCore: 0,
        downgradedToDiscard: 0,
        downgradedByCritical: 0,
      },
    }
  }

  const gateEnabled = params.enabled && anchors.length > 0
  const criticalEnabled = gateEnabled && params.requireCriticalMatch && criticalAnchors.length > 0
  const minCoreHits = Math.max(0, Math.min(params.minCoreAnchorHits, anchors.length || params.minCoreAnchorHits))
  const minSupportHits = Math.max(
    0,
    Math.min(Math.max(params.minSupportAnchorHits, 0), anchors.length || params.minSupportAnchorHits)
  )
  const minCoreCriticalHits = Math.max(
    0,
    Math.min(Math.max(params.minCoreCriticalAnchorHits, 0), criticalAnchors.length || params.minCoreCriticalAnchorHits)
  )
  const minSupportCriticalHits = Math.max(
    0,
    Math.min(
      Math.max(params.minSupportCriticalAnchorHits, 0),
      criticalAnchors.length || params.minSupportCriticalAnchorHits
    )
  )

  let downgradedCore = 0
  let downgradedToDiscard = 0
  let downgradedByCritical = 0

  const adjusted = recommendations.map((rec: any) => {
    const anchorHits = Number(rec?.anchorHits || 0)
    const anchorCoverage = Number(rec?.anchorCoverage || 0)
    const matchedAnchors = Array.isArray(rec?.matchedAnchors)
      ? rec.matchedAnchors.map((x: any) => normalizeText(x)).filter(Boolean)
      : []
    const missingAnchors = Array.isArray(rec?.missingAnchors)
      ? rec.missingAnchors.map((x: any) => normalizeText(x)).filter(Boolean)
      : anchors.filter((anchor) => !matchedAnchors.includes(anchor)).slice(0, 8)

    const matchedCriticalAnchors = matchedAnchors
      .filter((anchor: string) => criticalAnchorSet.has(anchor))
      .slice(0, 8)
    const criticalAnchorHits = matchedCriticalAnchors.length
    const missingCriticalAnchors = criticalAnchors.filter((anchor) => !matchedCriticalAnchors.includes(anchor)).slice(0, 8)

    const passedCoreByTotal = !gateEnabled || anchorHits >= minCoreHits
    const passedSupportByTotal = !gateEnabled || anchorHits >= minSupportHits
    const passedCoreByCritical = !criticalEnabled || criticalAnchorHits >= minCoreCriticalHits
    const passedSupportByCritical = !criticalEnabled || criticalAnchorHits >= minSupportCriticalHits
    const passedCore = passedCoreByTotal && passedCoreByCritical
    const passedSupport = passedSupportByTotal && passedSupportByCritical

    let utilityLabel = normalizeUtilityLabel(String(rec?.utilityLabel || "support"))
    let utilityRisk = normalizeUtilityRisk(String(rec?.utilityRisk || "medium"))
    let utilityReason = safeText(rec?.utilityReason || "", 220)

    if (gateEnabled && utilityLabel !== "discard") {
      if (utilityLabel === "core" && !passedCore) {
        downgradedCore += 1
        if (!passedCoreByCritical) downgradedByCritical += 1
        utilityLabel = passedSupport ? "support" : "discard"
        utilityRisk = passedSupport ? (utilityRisk === "low" ? "medium" : utilityRisk) : "high"
        if (!passedSupport) downgradedToDiscard += 1
        const coreThresholds = [
          `anclas ${anchorHits}/${Math.max(1, minCoreHits)}`,
          criticalEnabled
            ? `anclas criticas ${criticalAnchorHits}/${Math.max(1, minCoreCriticalHits)}`
            : null,
        ]
          .filter(Boolean)
          .join(" y ")
        const supportThresholds = [
          `anclas ${anchorHits}/${Math.max(1, minSupportHits)}`,
          criticalEnabled
            ? `anclas criticas ${criticalAnchorHits}/${Math.max(1, minSupportCriticalHits)}`
            : null,
        ]
          .filter(Boolean)
          .join(" y ")
        const gateReason = passedSupport
          ? `Bajada de core a support: ${coreThresholds} fuera de umbral core.`
          : `Descartada por anclas: ${supportThresholds} fuera de umbral defensivo.`
        utilityReason = safeText([gateReason, utilityReason].filter(Boolean).join(" "), 220)
      } else if (utilityLabel === "support" && !passedSupport) {
        downgradedToDiscard += 1
        if (!passedSupportByCritical) downgradedByCritical += 1
        utilityLabel = "discard"
        utilityRisk = "high"
        const supportThresholds = [
          `anclas ${anchorHits}/${Math.max(1, minSupportHits)}`,
          criticalEnabled
            ? `anclas criticas ${criticalAnchorHits}/${Math.max(1, minSupportCriticalHits)}`
            : null,
        ]
          .filter(Boolean)
          .join(" y ")
        const gateReason = `Descartada por anclas: ${supportThresholds} fuera de umbral de soporte defensivo.`
        utilityReason = safeText([gateReason, utilityReason].filter(Boolean).join(" "), 220)
      }
    }

    return {
      ...rec,
      utilityLabel,
      utilityRisk,
      utilityReason,
      anchorHits,
      anchorCoverage,
      matchedAnchors: matchedAnchors.slice(0, 8),
      missingAnchors: missingAnchors.slice(0, 8),
      criticalAnchorHits,
      matchedCriticalAnchors,
      missingCriticalAnchors,
      anchorGate: {
        enabled: gateEnabled,
        criticalEnabled,
        passedCore,
        passedSupport,
        passedCoreByCritical,
        passedSupportByCritical,
        minCoreHits,
        minSupportHits,
        minCoreCriticalHits,
        minSupportCriticalHits,
      },
    }
  })

  const ordered = gateEnabled
    ? adjusted
        .map((rec, idx) => ({ rec, idx }))
        .sort((a, b) => {
          const labelDiff =
            utilityLabelRank(String(a.rec?.utilityLabel || "support")) -
            utilityLabelRank(String(b.rec?.utilityLabel || "support"))
          if (labelDiff !== 0) return labelDiff

          if (criticalEnabled) {
            const criticalDiff = Number(b.rec?.criticalAnchorHits || 0) - Number(a.rec?.criticalAnchorHits || 0)
            if (criticalDiff !== 0) return criticalDiff
          }

          const hitDiff = Number(b.rec?.anchorHits || 0) - Number(a.rec?.anchorHits || 0)
          if (hitDiff !== 0) return hitDiff

          const scoreDiff = Number(b.rec?.score || 0) - Number(a.rec?.score || 0)
          if (scoreDiff !== 0) return scoreDiff

          return a.idx - b.idx
        })
        .map((entry) => entry.rec)
    : adjusted

  const matchedCauses = ordered.filter((rec: any) => Number(rec?.anchorHits || 0) > 0).length
  const criticalMatchedCauses = ordered.filter((rec: any) => Number(rec?.criticalAnchorHits || 0) > 0).length
  const supportPassedCauses = ordered.filter((rec: any) => Boolean(rec?.anchorGate?.passedSupport)).length

  return {
    recommendations: ordered,
    summary: {
      enabled: gateEnabled,
      criticalEnabled,
      minCoreHits,
      minSupportHits,
      minCoreCriticalHits,
      minSupportCriticalHits,
      anchorCount: anchors.length,
      criticalAnchorCount: criticalAnchors.length,
      matchedCauses,
      criticalMatchedCauses,
      supportPassedCauses,
      downgradedCore,
      downgradedToDiscard,
      downgradedByCritical,
    },
  }
}

function applyEvidenceGroundingGuard(recommendations: any[]) {
  return (Array.isArray(recommendations) ? recommendations : []).map((rec: any) => {
    const keyQuotesCount = Array.isArray(rec?.keyQuotes) ? rec.keyQuotes.length : 0
    const matchedDocsCount = Array.isArray(rec?.matchedDocuments) ? rec.matchedDocuments.length : 0

    const evidenceLevel: "high" | "medium" | "low" =
      keyQuotesCount >= 2 ? "high" : keyQuotesCount === 1 ? "medium" : "low"
    const evidenceBacked = keyQuotesCount > 0

    let confidence = String(rec?.confidence || "media").toLowerCase()
    if (!evidenceBacked && confidence === "alta") {
      confidence = "media"
    }

    const reasons = Array.isArray(rec?.reasons) ? [...rec.reasons] : []
    if (!evidenceBacked) {
      reasons.unshift(
        "Similitud preliminar por metadatos y documentos; falta validacion con citas textuales directas de la causa."
      )
    }

    const defenseSummary =
      !evidenceBacked && rec?.defenseSummary
        ? `${String(rec.defenseSummary)} (Referencia preliminar, requiere validacion documental puntual).`
        : rec?.defenseSummary || null

    return {
      ...rec,
      confidence,
      evidenceBacked,
      evidenceLevel,
      keyQuotesCount,
      matchedDocsCount,
      reasons: reasons.slice(0, 5),
      defenseSummary,
    }
  })
}

async function rerankRecommendationsForDefense(params: {
  question: string
  claimText: string
  defenseAnchors: string[]
  criticalDefenseAnchors: string[]
  recommendations: any[]
}) {
  const enabled = boolEnv("ONBOARDING_RERANK_ENABLED", true)
  if (!enabled || !params.recommendations.length) {
    return {
      recommendations: params.recommendations,
      applied: false,
      model: null as string | null,
      warnings: [] as string[],
      topK: 0,
    }
  }

  const topK = numberEnv("ONBOARDING_RERANK_TOP_K", 12, 4, 24)
  const minHeuristicKeep = numberEnv("ONBOARDING_RERANK_MIN_HEURISTIC_KEEP", 2, 1, 5)
  const candidates = params.recommendations.slice(0, topK)
  if (candidates.length <= 2) {
    return {
      recommendations: params.recommendations,
      applied: false,
      model: null as string | null,
      warnings: [] as string[],
      topK,
    }
  }

  const candidateBlock = candidates
    .map((rec, idx) => {
      const docs = Array.isArray(rec?.interestingDocuments) ? rec.interestingDocuments : []
      const topDocs = docs
        .slice(0, 2)
        .map((doc: any) => `${doc?.documentType || "doc"}:${safeText(doc?.name || "", 80)}`)
        .join(" | ")
      const reasons = (Array.isArray(rec?.reasons) ? rec.reasons : [])
        .slice(0, 2)
        .map((r: any) => safeText(r, 120))
        .join(" | ")
      const score = Number(rec?.score || 0)
      const confidence = String(rec?.confidence || "media")
      const evidenceLevel = String(rec?.evidenceLevel || "low")
      const evidenceBacked = Boolean(rec?.evidenceBacked)
      const anchorHits = Number(rec?.anchorHits || 0)
      const matchedAnchors = Array.isArray(rec?.matchedAnchors)
        ? rec.matchedAnchors.map((x: any) => normalizeText(x)).filter(Boolean).slice(0, 5)
        : []
      const criticalAnchorSet = new Set(
        (Array.isArray(params.criticalDefenseAnchors) ? params.criticalDefenseAnchors : [])
          .map((x) => normalizeText(x))
          .filter(Boolean)
      )
      const matchedCriticalAnchors = matchedAnchors.filter((x: string) => criticalAnchorSet.has(x))

      return (
        `CANDIDATE ${idx + 1}: causeId=${String(rec?.causeId || "")}` +
        `\nrol=${safeText(rec?.rol || "", 80)}` +
        `\nscore=${Number.isFinite(score) ? score.toFixed(3) : "0.000"}` +
        `\nconfidence=${confidence}` +
        `\nevidence=${evidenceBacked ? "backed" : "preliminary"} (${evidenceLevel})` +
        `\nanchor_hits=${anchorHits}` +
        `\nanchor_terms=${matchedAnchors.join(", ") || "N/A"}` +
        `\ncritical_anchor_hits=${matchedCriticalAnchors.length}` +
        `\ncritical_anchor_terms=${matchedCriticalAnchors.join(", ") || "N/A"}` +
        `\nreasons=${reasons || "N/A"}` +
        `\ndocs=${topDocs || "N/A"}`
      )
    })
    .join("\n\n---\n\n")

  const schema = {
    type: "object",
    properties: {
      decisions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            causeId: { type: "string" },
            label: {
              type: "string",
              enum: ["core", "support", "discard"],
            },
            risk: {
              type: "string",
              enum: ["low", "medium", "high"],
            },
            reason: { type: "string" },
          },
          required: ["causeId", "label", "risk", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["decisions"],
    additionalProperties: false,
  } as const

  const warnings: string[] = []

  try {
    const rerank = await generateOpenAIJson({
      system:
        "Eres un analista juridico experto en estrategia de defensa ambiental chilena. Tu tarea es priorizar causas que sirvan de verdad para defender la reclamacion, con criterio conservador: evita falsos positivos.",
      prompt:
        `Pregunta/contexto del usuario:\n${safeText(params.question, 1200)}\n\n` +
        `Resumen reclamacion:\n${safeText(params.claimText, 1600)}\n\n` +
        `Anclas del caso detectadas:\n${params.defenseAnchors.join(", ") || "N/A"}\n\n` +
        `Anclas criticas del caso (obligatorias para utilidad alta):\n${params.criticalDefenseAnchors.join(", ") || "N/A"}\n\n` +
        `Candidatos:\n\n${candidateBlock}\n\n` +
        "Instrucciones:\n" +
        "- Devuelve decisions ordenadas de mayor a menor utilidad para defensa.\n" +
        "- Prioriza candidatos con mejor match de anclas (entidades, organos, instrumentos y procedimiento del caso).\n" +
        "- Penaliza fuertemente candidatos sin match de anclas criticas del caso.\n" +
        "- label=core solo si hay alta utilidad practica y soporte documental robusto.\n" +
        "- label=support si puede ayudar pero no debe ser pilar principal.\n" +
        "- label=discard si no aporta valor defensivo real o es demasiado debil.\n" +
        "- risk=low/medium/high segun riesgo de mal uso del precedente.\n" +
        "- reason debe ser breve y concreta (1 linea).\n",
      schemaName: "onboarding_defense_rerank",
      schema,
      maxCompletionTokens: 700,
      reasoningEffort: "minimal",
      model: String(process.env.ONBOARDING_RERANK_MODEL || process.env.OPENAI_RERANK_MODEL || "gpt-5-nano"),
    })

    const decisionRows = Array.isArray((rerank.output as any)?.decisions)
      ? ((rerank.output as any).decisions as any[])
      : []

    const byId = new Map<string, RerankDecision>()
    for (const row of decisionRows) {
      const causeId = String(row?.causeId || "").trim()
      if (!causeId) continue
      if (!candidates.some((rec) => String(rec?.causeId || "") === causeId)) continue
      byId.set(causeId, {
        causeId,
        label: normalizeUtilityLabel(String(row?.label || "support")),
        risk: normalizeUtilityRisk(String(row?.risk || "medium")),
        reason: safeText(row?.reason || "", 220) || "Utilidad defensiva evaluada para esta causa.",
      })
    }

    const ordered: any[] = []
    const seen = new Set<string>()

    for (const row of decisionRows) {
      const causeId = String(row?.causeId || "").trim()
      if (!causeId || seen.has(causeId)) continue
      const rec = candidates.find((x) => String(x?.causeId || "") === causeId)
      if (!rec) continue
      seen.add(causeId)
      const decision = byId.get(causeId)
      const preliminary = !Boolean(rec?.evidenceBacked)
      let utilityLabel = decision?.label || defaultUtilityLabelFromConfidence(String(rec?.confidence || ""))
      let utilityRisk = decision?.risk || defaultUtilityRiskFromConfidence(String(rec?.confidence || ""))
      if (preliminary && utilityLabel === "core") utilityLabel = "support"
      if (preliminary && utilityRisk === "low") utilityRisk = "medium"
      ordered.push({
        ...rec,
        utilityLabel,
        utilityRisk,
        utilityReason: decision?.reason || safeText(rec?.defenseSummary || "", 220),
      })
    }

    const fallbackByScore = candidates
      .slice()
      .sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0))
      .slice(0, minHeuristicKeep)

    for (const rec of fallbackByScore) {
      const causeId = String(rec?.causeId || "")
      if (!causeId || seen.has(causeId)) continue
      seen.add(causeId)
      ordered.unshift({
        ...rec,
        utilityLabel: "support" as UtilityLabel,
        utilityRisk: !Boolean(rec?.evidenceBacked)
          ? "medium"
          : defaultUtilityRiskFromConfidence(String(rec?.confidence || "")),
        utilityReason: "Conservado por respaldo heuristico para evitar perder precedentes potencialmente utiles.",
      })
    }

    for (const rec of candidates) {
      const causeId = String(rec?.causeId || "")
      if (!causeId || seen.has(causeId)) continue
      seen.add(causeId)
      const preliminary = !Boolean(rec?.evidenceBacked)
      let utilityLabel = defaultUtilityLabelFromConfidence(String(rec?.confidence || ""))
      let utilityRisk = defaultUtilityRiskFromConfidence(String(rec?.confidence || ""))
      if (preliminary && utilityLabel === "core") utilityLabel = "support"
      if (preliminary && utilityRisk === "low") utilityRisk = "medium"
      ordered.push({
        ...rec,
        utilityLabel,
        utilityRisk,
        utilityReason: safeText(rec?.defenseSummary || "", 220),
      })
    }

    const remaining = params.recommendations.slice(topK).map((rec) => ({
      ...rec,
      utilityLabel: (() => {
        let label = defaultUtilityLabelFromConfidence(String(rec?.confidence || ""))
        if (!Boolean(rec?.evidenceBacked) && label === "core") label = "support"
        return label
      })(),
      utilityRisk: (() => {
        let risk = defaultUtilityRiskFromConfidence(String(rec?.confidence || ""))
        if (!Boolean(rec?.evidenceBacked) && risk === "low") risk = "medium"
        return risk
      })(),
      utilityReason: safeText(rec?.defenseSummary || "", 220),
    }))

    return {
      recommendations: [...ordered, ...remaining],
      applied: true,
      model: rerank.model,
      warnings,
      topK,
    }
  } catch (err: any) {
    warnings.push(`Rerank warning: ${err?.message || String(err)}`)
    return {
      recommendations: params.recommendations.map((rec) => ({
        ...rec,
        utilityLabel: (() => {
          let label = defaultUtilityLabelFromConfidence(String(rec?.confidence || ""))
          if (!Boolean(rec?.evidenceBacked) && label === "core") label = "support"
          return label
        })(),
        utilityRisk: (() => {
          let risk = defaultUtilityRiskFromConfidence(String(rec?.confidence || ""))
          if (!Boolean(rec?.evidenceBacked) && risk === "low") risk = "medium"
          return risk
        })(),
        utilityReason: safeText(rec?.defenseSummary || "", 220),
      })),
      applied: false,
      model: null as string | null,
      warnings,
      topK,
    }
  }
}

async function buildDefenseMarcoPlan(params: {
  question: string
  recommendations: any[]
}) {
  const candidates = (Array.isArray(params.recommendations) ? params.recommendations : []).slice(0, 6)
  if (!candidates.length) {
    return {
      applied: false,
      model: null as string | null,
      plan: null as any,
    }
  }

  const candidateBlock = candidates
    .map((rec, idx) => {
      const docs = (Array.isArray(rec?.interestingDocuments) ? rec.interestingDocuments : [])
        .slice(0, 3)
        .map((doc: any) => `${doc?.documentType || "doc"}: ${safeText(doc?.name || "", 90)}`)
        .join(" | ")
      const reasons = (Array.isArray(rec?.reasons) ? rec.reasons : [])
        .slice(0, 2)
        .map((item: any) => safeText(item, 120))
        .join(" | ")
      return [
        `CANDIDATE ${idx + 1}`,
        `causeId=${String(rec?.causeId || "")}`,
        `rol=${safeText(rec?.rol || "", 80)}`,
        `utility=${String(rec?.utilityLabel || "support")}`,
        `risk=${String(rec?.utilityRisk || "medium")}`,
        `docs=${docs || "N/A"}`,
        `reasons=${reasons || "N/A"}`,
      ].join("\n")
    })
    .join("\n\n---\n\n")

  try {
    const generated = await generateOpenAIJson({
      system:
        "Eres un estratega juridico ambiental. Debes planificar un marco teorico orientado a defensa del SEA, priorizando documentos verdaderamente utiles y evitando que la reclamacion quede como pilar principal.",
      prompt:
        `Pregunta del usuario:\n${safeText(params.question, 1400)}\n\n` +
        `Candidatos:\n\n${candidateBlock}\n\n` +
        "Devuelve un plan breve para sintetizar el marco teorico. Debe priorizar informe y sentencia cuando existan, usar la reclamacion solo como contexto y bajar cada precedente a utilidad practica para defensa.",
      schemaName: "onboarding_defense_marco_plan",
      schema: {
        type: "object",
        properties: {
          openingDirective: { type: "string" },
          documentPriorityRules: { type: "array", items: { type: "string" } },
          actionLines: { type: "array", items: { type: "string" } },
          riskAlerts: { type: "array", items: { type: "string" } },
          preferredCauseIds: { type: "array", items: { type: "string" } },
        },
        required: [
          "openingDirective",
          "documentPriorityRules",
          "actionLines",
          "riskAlerts",
          "preferredCauseIds",
        ],
        additionalProperties: false,
      },
      maxCompletionTokens: 520,
      reasoningEffort: "minimal",
      model: String(process.env.ONBOARDING_MARCO_PLAN_MODEL || process.env.OPENAI_RERANK_MODEL || "gpt-5-nano"),
    })

    return {
      applied: true,
      model: generated.model,
      plan: generated.output,
    }
  } catch {
    return {
      applied: false,
      model: null as string | null,
      plan: null as any,
    }
  }
}

function selectSummaryEvidenceForMarco(params: {
  recommendations: any[]
  chunkById: Map<string, RankedChunk>
  limit: number
}) {
  const selectedRows: Array<RankedChunk & { docRole?: string | null; documentType?: string | null; documentTitle?: string | null; name?: string | null; title?: string | null }> = []
  const seenChunkIds = new Set<string>()

  const addChunk = (chunk: RankedChunk | undefined) => {
    if (!chunk || seenChunkIds.has(chunk.chunkId)) return false
    seenChunkIds.add(chunk.chunkId)
    selectedRows.push({
      ...chunk,
      documentType: chunk.docRole,
      documentTitle: chunk.docName,
      name: chunk.docName,
      title: chunk.docName,
    })
    return selectedRows.length >= params.limit
  }

  const summaryCandidates = (Array.isArray(params.recommendations) ? params.recommendations : []).slice(0, 6)

  const seededQuotes = summaryCandidates.flatMap((rec) => Array.isArray(rec?.keyQuotes) ? rec.keyQuotes : [])
  const balancedSeed = selectRoleBalancedItems(
    seededQuotes
      .map((quote: any) => {
        const chunk = params.chunkById.get(String(quote?.chunkId || ""))
        if (!chunk) return null
        return {
          ...chunk,
          docRole: chunk.docRole,
          documentType: chunk.docRole,
          documentTitle: chunk.docName,
          name: chunk.docName,
          title: chunk.docName,
        }
      })
      .filter(Boolean) as Array<RankedChunk & { docRole?: string | null; documentType?: string | null; documentTitle?: string | null; name?: string | null; title?: string | null }>,
    {
      limit: Math.min(params.limit, 10),
      preferredRoles: ["informe", "sentencia", "reclamacion"],
      requiredRoles: ["informe", "sentencia"],
      maxContextReclamaciones: 1,
    }
  )

  for (const row of balancedSeed) {
    if (addChunk(row)) break
  }

  for (const rec of summaryCandidates) {
    for (const quote of rec.keyQuotes || []) {
      if (addChunk(params.chunkById.get(String(quote.chunkId)))) break
    }
    if (selectedRows.length >= params.limit) break
  }

  return selectedRows.slice(0, params.limit).map((chunk) => ({
    chunkId: chunk.chunkId,
    content: chunk.content,
    sourceUrl: chunk.sourceUrl,
    snapshotId: chunk.snapshotId,
    page: chunk.page,
    section: chunk.section,
    docRole: chunk.docRole,
    documentType: chunk.docRole,
    documentTitle: chunk.docName,
  })) as EvidenceChunk[]
}

function sanitizeFilters(value: any): RecommendFilters {
  const projectType = safeText(value?.projectType || "", 160)
  const region = safeText(value?.region || "", 120)
  const yearFrom =
    typeof value?.yearFrom === "number" && Number.isFinite(value.yearFrom)
      ? Math.floor(value.yearFrom)
      : null
  const yearTo =
    typeof value?.yearTo === "number" && Number.isFinite(value.yearTo)
      ? Math.floor(value.yearTo)
      : null
  const themes = Array.isArray(value?.themes)
    ? value.themes.map((x: any) => safeText(x, 120)).filter(Boolean).slice(0, 15)
    : []

  return {
    projectType: projectType || null,
    region: region || null,
    yearFrom,
    yearTo,
    themes,
  }
}

function causeMatchesFilters(params: {
  cause: any
  docs: any[]
  filters: RecommendFilters
}) {
  const { cause, docs, filters } = params
  const hasFilters =
    !!filters.projectType || !!filters.region || !!filters.themes.length || filters.yearFrom || filters.yearTo
  if (!hasFilters) {
    return { pass: true, boost: 0, reasons: [] as string[] }
  }

  const causeYear = cause?.fecha_ingreso ? Number(String(cause.fecha_ingreso).slice(0, 4)) : null
  if (filters.yearFrom && causeYear && causeYear < filters.yearFrom) {
    return { pass: false, boost: 0, reasons: [] as string[] }
  }
  if (filters.yearTo && causeYear && causeYear > filters.yearTo) {
    return { pass: false, boost: 0, reasons: [] as string[] }
  }

  const docsText = (docs || [])
    .slice(0, 20)
    .map((d: any) => `${d?.document_type || ""} ${d?.name || ""}`)
    .join(" ")
  const haystack = normalizeText(
    `${cause?.caratula || ""} ${cause?.estado || ""} ${cause?.estado_subtipo || ""} ${docsText}`
  )

  let boost = 0
  const reasons: string[] = []

  if (filters.projectType) {
    const projectTokens = tokenize(filters.projectType)
    const hit = projectTokens.length
      ? projectTokens.some((token) => haystack.includes(token))
      : haystack.includes(normalizeText(filters.projectType))
    if (!hit) return { pass: false, boost: 0, reasons: [] as string[] }
    boost += 0.8
    reasons.push(`Alinea con tipo de proyecto filtrado: ${filters.projectType}.`)
  }

  if (filters.region) {
    const regionNorm = normalizeText(filters.region)
    if (regionNorm && !haystack.includes(regionNorm)) {
      return { pass: false, boost: 0, reasons: [] as string[] }
    }
    if (regionNorm) {
      boost += 0.45
      reasons.push(`Coincide con region filtrada: ${filters.region}.`)
    }
  }

  if (filters.themes.length) {
    const themeHits = filters.themes.filter((theme) => {
      const tokens = tokenize(theme)
      if (!tokens.length) return false
      return tokens.some((token) => haystack.includes(token))
    })

    if (!themeHits.length) {
      return { pass: false, boost: 0, reasons: [] as string[] }
    }

    boost += Math.min(1.2, themeHits.length * 0.25)
    reasons.push(`Temas relacionados detectados: ${themeHits.slice(0, 3).join(", ")}.`)
  }

  if ((filters.yearFrom || filters.yearTo) && causeYear) {
    reasons.push(`Rango temporal compatible (${causeYear}).`)
  }

  return { pass: true, boost, reasons }
}

function isEligibleCorpusCause(cause: any) {
  if (!cause) return false
  return isEligibleOnboardingCause({
    tribunal: cause.tribunal ? String(cause.tribunal) : null,
    caratula: cause.caratula ? String(cause.caratula) : null,
  })
}

async function saveOnboardingRunMetadata(params: {
  supabase: any
  workspaceId: string
  userId: string
  runId: string
  payload: any
}) {
  const { supabase, workspaceId, userId, runId, payload } = params
  const now = new Date().toISOString()

  const { data: profile } = await supabase
    .from("gob_workspace_profiles")
    .select("workspace_id,metadata")
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  const metadataBase =
    profile?.metadata && typeof profile.metadata === "object" && !Array.isArray(profile.metadata)
      ? profile.metadata
      : {}
  const onboardingBase =
    metadataBase?.onboarding && typeof metadataBase.onboarding === "object" ? metadataBase.onboarding : {}
  const runsBase =
    onboardingBase?.analysis_runs && typeof onboardingBase.analysis_runs === "object"
      ? onboardingBase.analysis_runs
      : {}

  const mergedMetadata = {
    ...metadataBase,
    onboarding: {
      ...onboardingBase,
      last_run_id: runId,
      last_run_at: now,
      analysis_runs: {
        ...runsBase,
        [runId]: payload,
      },
      hitl: {
        ...(onboardingBase?.hitl && typeof onboardingBase.hitl === "object" ? onboardingBase.hitl : {}),
        latest_run_id: runId,
      },
    },
  }

  if (!profile?.workspace_id) {
    await supabase.from("gob_workspace_profiles").insert({
      workspace_id: workspaceId,
      created_at: now,
      updated_at: now,
      created_by: userId,
      metadata: mergedMetadata,
    })
  } else {
    await supabase
      .from("gob_workspace_profiles")
      .update({ metadata: mergedMetadata, updated_at: now })
      .eq("workspace_id", workspaceId)
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
  const parsed = RecommendSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const now = new Date().toISOString()
  const runId = randomUUID()
  const question = safeText(parsed.data.question || "", 3600)
  const structuredFilters = sanitizeFilters(parsed.data.filters)

  const { data: claimSnapshot, error: claimSnapshotErr } = await supabase
    .from("gob_source_snapshots")
    .select("id,workspace_id,source_id,status,content_hash,url,storage_path")
    .eq("id", parsed.data.snapshotId)
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (claimSnapshotErr) {
    return NextResponse.json({ error: claimSnapshotErr.message }, { status: 500 })
  }
  if (!claimSnapshot) {
    return NextResponse.json({ error: "Claim snapshot not found" }, { status: 404 })
  }

  const claimStatus = String(claimSnapshot.status || "")
  if (claimStatus !== "ready") {
    return NextResponse.json(
      {
        error: "Claim snapshot is not ready yet",
        snapshotId: claimSnapshot.id,
        status: claimStatus || "pending",
      },
      { status: 409 }
    )
  }

  const { data: claimSource } = await supabase
    .from("gob_sources")
    .select("id,title,filename,url,doc_type,attributes")
    .eq("id", claimSnapshot.source_id)
    .maybeSingle()

  const { data: claimChunks, error: claimChunksErr } = await supabase
    .from("gob_chunks")
    .select("id,content")
    .eq("workspace_id", workspaceId)
    .eq("snapshot_id", claimSnapshot.id)
    .order("created_at", { ascending: true })
    .limit(140)

  if (claimChunksErr) {
    return NextResponse.json({ error: claimChunksErr.message }, { status: 500 })
  }

  if (!claimChunks?.length) {
    return NextResponse.json(
      { error: "Claim has no extracted text chunks yet. Wait for processing to finish." },
      { status: 409 }
    )
  }

  const claimText = claimChunks.map((c: any) => String(c.content || "")).join("\n").slice(0, 28_000)
  const claimTokens = tokenSet(claimText)
  const maxDefenseAnchors = numberEnv("ONBOARDING_MAX_DEFENSE_ANCHORS", 16, 6, 24)
  const maxCriticalDefenseAnchors = numberEnv("ONBOARDING_MAX_CRITICAL_DEFENSE_ANCHORS", 6, 1, 12)
  const defenseAnchors = extractDefenseAnchors({
    question,
    claimText,
    sourceTitle: safeText(claimSource?.title || claimSource?.filename || "", 220),
    maxAnchors: maxDefenseAnchors,
  })
  const criticalDefenseAnchors = extractCriticalDefenseAnchors({
    question,
    claimText,
    sourceTitle: safeText(claimSource?.title || claimSource?.filename || "", 220),
    anchors: defenseAnchors,
    maxCriticalAnchors: maxCriticalDefenseAnchors,
  })
  const requireAnchorMatch = boolEnv("ONBOARDING_REQUIRE_ANCHOR_MATCH", true)
  const requireCriticalAnchorMatch = boolEnv("ONBOARDING_REQUIRE_CRITICAL_ANCHOR_MATCH", true)
  const minCoreAnchorHits = numberEnv("ONBOARDING_MIN_ANCHOR_HITS_CORE", 2, 0, 8)
  const minSupportAnchorHits = numberEnv("ONBOARDING_MIN_ANCHOR_HITS_SUPPORT", 1, 0, 6)
  const minCoreCriticalAnchorHits = numberEnv("ONBOARDING_MIN_CRITICAL_ANCHOR_HITS_CORE", 1, 0, 4)
  const minSupportCriticalAnchorHits = numberEnv("ONBOARDING_MIN_CRITICAL_ANCHOR_HITS_SUPPORT", 1, 0, 4)
  const anchorGateEnabled = requireAnchorMatch && defenseAnchors.length > 0
  const criticalAnchorGateEnabled =
    anchorGateEnabled && requireCriticalAnchorMatch && criticalDefenseAnchors.length > 0
  const claimChunksLex: ClaimChunkLex[] = (claimChunks || []).map((chunk: any) => ({
    chunkId: String(chunk.id || ""),
    content: String(chunk.content || ""),
    tokens: tokenSet(String(chunk.content || "")),
  }))

  const baseQueries = buildSearchQueries({
    question,
    claimText,
    firstChunk: String(claimChunks[0]?.content || ""),
    sourceTitle: safeText(claimSource?.title || claimSource?.filename || "", 200),
    filters: structuredFilters,
  })

  const anchorQueries = uniqueStrings([
    defenseAnchors.slice(0, 6).join(" "),
    defenseAnchors.slice(0, 4).join(" OR "),
  ]).filter((q) => q.length >= 4)

  const queries = uniqueStrings([...anchorQueries, ...baseQueries]).slice(0, 11)

  if (!queries.length) {
    return NextResponse.json({ error: "Unable to build retrieval query" }, { status: 400 })
  }

  const admin = createAdminClient()
  const warnings: string[] = []
  if (requireAnchorMatch && !defenseAnchors.length) {
    warnings.push("No se detectaron anclas distintivas en la reclamacion; gate de anclas desactivado para esta corrida.")
  }
  if (requireCriticalAnchorMatch && !criticalDefenseAnchors.length) {
    warnings.push(
      "No se detectaron anclas criticas distintivas en la reclamacion; gate critico desactivado para esta corrida."
    )
  }

  const corpus = await ensureTribunalCorpusWorkspace(admin)
  const claimSourceAttrs =
    claimSource?.attributes && typeof claimSource.attributes === "object" ? claimSource.attributes : {}
  const claimGraphRowsResponse = await admin
    .from("gob_entities")
    .select("entity_type,entity_value,normalized_value")
    .eq("workspace_id", workspaceId)
    .eq("snapshot_id", claimSnapshot.id)
    .limit(80)
  const claimGraphEntities = (claimGraphRowsResponse.data || []).length
    ? (claimGraphRowsResponse.data || []).map((row: any) => ({
        entityType: String(row?.entity_type || ""),
        entityValue: String(row?.entity_value || ""),
        normalizedValue: String(row?.normalized_value || ""),
      }))
    : extractLegalGraphEntities({
        text: claimText,
        rol: claimSourceAttrs?.rol ? String(claimSourceAttrs.rol) : null,
      })
  const claimGraphValues = uniqueStrings(
    claimGraphEntities.map((row: any) => String(row?.normalizedValue || row?.entityValue || ""))
  ).slice(0, 18)
  let syncStats = {
    scannedDocuments: 0,
    readySnapshots: 0,
    totalSnapshots: 0,
    existingSources: 0,
    newSources: 0,
    newSnapshots: 0,
    retriedSnapshots: 0,
    queuedJobs: 0,
  }

  try {
    syncStats = await syncTribunalCorpusDocuments({
      admin,
      corpusWorkspaceId: corpus.id,
      maxNewSources: 2500,
      maxRetries: 200,
    })
  } catch (err: any) {
    warnings.push(`Sync corpus warning: ${err?.message ?? String(err)}`)
  }

  const poolState = await loadOnboardingEligibleCauseIds(admin)
  const eligibleCauseIds = poolState.ids
  if (!poolState.available && poolState.error) {
    warnings.push(`Pool warning: ${poolState.error}`)
  }

  if (eligibleCauseIds.size > 0) {
    warnings.push(`Pool defensivo activo: ${eligibleCauseIds.size} causas SEA elegibles.`)
  }

  const chunkScores = new Map<string, ScoreRow>()
  let candidateChunkCount = 0

  for (let i = 0; i < queries.length; i += 1) {
    const query = queries[i]
    const weight = i === 0 ? 1.35 : 1

    const { data: matches, error: matchErr } = await admin.rpc("gob_search_chunks_text", {
      p_workspace_id: corpus.id,
      p_query_text: query,
      p_match_count: 140,
    })

    if (matchErr) {
      warnings.push(`Search warning (${i + 1}): ${matchErr.message}`)
      continue
    }

    for (const row of matches || []) {
      const chunkId = String((row as any).chunk_id || "")
      if (!chunkId) continue

      const rankRaw = Number((row as any).rank || 0)
      if (!Number.isFinite(rankRaw) || rankRaw <= 0) continue

      candidateChunkCount += 1
      const weighted = rankRaw * weight
      const prev = chunkScores.get(chunkId) || { score: 0, best: 0, hits: 0 }
      chunkScores.set(chunkId, {
        score: prev.score + weighted,
        best: Math.max(prev.best, weighted),
        hits: prev.hits + 1,
      })
    }
  }

  const topChunkIds = Array.from(chunkScores.entries())
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 380)
    .map(([id]) => id)

  const chunkRows: any[] = []
  if (topChunkIds.length) {
    for (const batch of chunkArray(topChunkIds, 180)) {
      const { data, error } = await admin
        .from("gob_chunks")
        .select("id,snapshot_id,content,source_url,page,section")
        .in("id", batch)
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      chunkRows.push(...(data || []))
    }
  }

  const snapshotIds = uniqueStrings((chunkRows || []).map((row: any) => String(row.snapshot_id || "")))
  const snapshotRows: any[] = []
  if (snapshotIds.length) {
    for (const batch of chunkArray(snapshotIds, 220)) {
      const { data, error } = await admin
        .from("gob_source_snapshots")
        .select("id,source_id,content_hash,status")
        .in("id", batch)
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      snapshotRows.push(...(data || []))
    }
  }

  const snapshotById = new Map<string, any>()
  for (const row of snapshotRows || []) {
    snapshotById.set(String((row as any).id), row)
  }

  const sourceIds = uniqueStrings((snapshotRows || []).map((row: any) => String((row as any).source_id || "")))
  const sourceRows: any[] = []
  if (sourceIds.length) {
    for (const batch of chunkArray(sourceIds, 220)) {
      const { data, error } = await admin
        .from("gob_sources")
        .select("id,url,title,doc_type,year,project_name,source_origin,attributes")
        .in("id", batch)
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      sourceRows.push(...(data || []))
    }
  }

  const sourceById = new Map<string, any>()
  for (const row of sourceRows || []) {
    sourceById.set(String((row as any).id), row)
  }

  const sourceUrls = uniqueStrings((sourceRows || []).map((row: any) => String(row.url || "")))
  const attrDocIds = uniqueStrings(
    (sourceRows || []).map((row: any) => {
      const attrs = row?.attributes && typeof row.attributes === "object" ? row.attributes : {}
      return attrs?.tribunal_document_id ? String(attrs.tribunal_document_id) : ""
    })
  )

  const docsByUrlRows: any[] = []
  if (sourceUrls.length) {
    for (const batch of chunkArray(sourceUrls, 24)) {
      const { data, error } = await admin
        .from("gob_tribunal_documents")
        .select("id,cause_id,document_type,date,name,storage_path,url")
        .in("url", batch)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      docsByUrlRows.push(...(data || []))
    }
  }

  const docsByIdRows: any[] = []
  if (attrDocIds.length) {
    for (const batch of chunkArray(attrDocIds, 220)) {
      const { data, error } = await admin
        .from("gob_tribunal_documents")
        .select("id,cause_id,document_type,date,name,storage_path,url")
        .in("id", batch)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      docsByIdRows.push(...(data || []))
    }
  }

  const tribunalDocByUrl = new Map<string, any>()
  const tribunalDocById = new Map<string, any>()
  for (const row of [...(docsByUrlRows || []), ...(docsByIdRows || [])]) {
    const id = String((row as any).id)
    tribunalDocById.set(id, row)
    if ((row as any).url) {
      tribunalDocByUrl.set(String((row as any).url), row)
    }
  }

  const claimHash = claimSnapshot.content_hash ? String(claimSnapshot.content_hash) : ""
  const duplicateSourceIds = new Set<string>()
  const duplicateDocIds = new Set<string>()
  let exactHashMatches = 0
  let nearDuplicateMatches = 0

  if (claimHash) {
    const { data: sameHashSnapshots, error: sameHashErr } = await admin
      .from("gob_source_snapshots")
      .select("id,source_id")
      .eq("workspace_id", corpus.id)
      .eq("content_hash", claimHash)
      .limit(60)

    if (sameHashErr) {
      warnings.push(`Duplicate hash check warning: ${sameHashErr.message}`)
    }

    const sameHashSourceIds = uniqueStrings(
      (sameHashSnapshots || []).map((row: any) => String((row as any).source_id || ""))
    )

    for (const sourceId of sameHashSourceIds) {
      duplicateSourceIds.add(sourceId)
    }

    if (sameHashSourceIds.length) {
      const { data: sameHashSources } = await admin
        .from("gob_sources")
        .select("id,attributes,url")
        .in("id", sameHashSourceIds)

      for (const row of sameHashSources || []) {
        const attrs = row?.attributes && typeof row.attributes === "object" ? row.attributes : {}
        if (attrs?.tribunal_document_id) {
          duplicateDocIds.add(String(attrs.tribunal_document_id))
        }
        if (row?.url && tribunalDocByUrl.has(String(row.url))) {
          duplicateDocIds.add(String(tribunalDocByUrl.get(String(row.url))?.id))
        }
      }
    }

    exactHashMatches = sameHashSourceIds.length
  }

  const sourceTextMap = new Map<string, string[]>()
  for (const row of chunkRows || []) {
    const snapshotId = String((row as any).snapshot_id || "")
    const snapshot = snapshotById.get(snapshotId)
    const sourceId = snapshot?.source_id ? String(snapshot.source_id) : ""
    if (!sourceId) continue
    const list = sourceTextMap.get(sourceId) || []
    if (list.length < 8) {
      list.push(String((row as any).content || "").slice(0, 1000))
      sourceTextMap.set(sourceId, list)
    }
  }

  for (const [sourceId, textParts] of sourceTextMap.entries()) {
    if (duplicateSourceIds.has(sourceId)) continue
    const source = sourceById.get(sourceId)
    if (!source) continue

    const attrs = source?.attributes && typeof source.attributes === "object" ? source.attributes : {}
    const role = classifyTribunalDocumentRole({
      documentType: source?.doc_type ? String(source.doc_type) : null,
      name: source?.title ? String(source.title) : null,
      title: attrs?.doc_role ? String(attrs.doc_role) : null,
    })

    if (role !== "reclamacion") continue
    const sourceTokens = tokenSet(textParts.join(" "))
    const ratio = overlapRatio(claimTokens, sourceTokens)
    if (ratio >= 0.92) {
      duplicateSourceIds.add(sourceId)
      nearDuplicateMatches += 1
    }
  }

  const rankedChunks: RankedChunk[] = []

  for (const row of chunkRows || []) {
    const chunkId = String((row as any).id || "")
    if (!chunkId) continue

    const score = chunkScores.get(chunkId)
    if (!score || score.score <= 0) continue

    const snapshotId = String((row as any).snapshot_id || "")
    const snapshot = snapshotById.get(snapshotId)
    const sourceId = snapshot?.source_id ? String(snapshot.source_id) : ""
    if (!sourceId) continue
    if (duplicateSourceIds.has(sourceId)) continue

    const source = sourceById.get(sourceId)
    if (!source) continue

    const causeId = resolveCauseId(source, tribunalDocByUrl, tribunalDocById)
    if (!causeId) continue
    if (eligibleCauseIds.size > 0 && !eligibleCauseIds.has(causeId)) continue

    const docId = resolveDocId(source, tribunalDocByUrl, tribunalDocById)
    if (docId && duplicateDocIds.has(docId)) continue
    const docMeta = docId ? tribunalDocById.get(docId) : null
    if (!docMeta) continue
    if (
      !isStrictTribunalKeyDocument({
        documentType: docMeta?.document_type ? String(docMeta.document_type) : null,
        name: docMeta?.name ? String(docMeta.name) : null,
        title: docMeta?.document_type ? String(docMeta.document_type) : null,
      })
    ) {
      continue
    }

    const docRole = classifyTribunalDocumentRole({
      documentType: docMeta?.document_type ? String(docMeta.document_type) : source?.doc_type ? String(source.doc_type) : null,
      name: docMeta?.name ? String(docMeta.name) : source?.title ? String(source.title) : null,
      title: docMeta?.document_type ? String(docMeta.document_type) : source?.title ? String(source.title) : null,
    })
    if (docRole === "documento") continue

    rankedChunks.push({
      chunkId,
      score: Number((score.score * defenseRoleWeight(docRole)).toFixed(4)),
      content: String((row as any).content || ""),
      sourceUrl: (row as any).source_url ? String((row as any).source_url) : null,
      snapshotId: snapshotId || null,
      page: typeof (row as any).page === "number" ? (row as any).page : null,
      section: (row as any).section ? String((row as any).section) : null,
      sourceId,
      causeId,
      docId,
      docRole,
      docUrl: docMeta?.url ? String(docMeta.url) : (row as any).source_url ? String((row as any).source_url) : null,
      docName: docMeta?.name ? String(docMeta.name) : source?.title ? String(source.title) : null,
    })
  }

  rankedChunks.sort((a, b) => b.score - a.score)

  const causeAggMap = new Map<string, CauseAggregate>()
  for (const chunk of rankedChunks) {
    const agg =
      causeAggMap.get(chunk.causeId) ||
      ({
        causeId: chunk.causeId,
        score: 0,
        best: 0,
        chunkHits: 0,
        chunkIds: new Set<string>(),
        matchedDocIds: new Set<string>(),
        docRoles: new Set<string>(),
        topChunks: [],
      } satisfies CauseAggregate)

    agg.score += chunk.score
    agg.best = Math.max(agg.best, chunk.score)
    agg.chunkHits += 1
    agg.docRoles.add(chunk.docRole)

    if (chunk.docId) {
      agg.matchedDocIds.add(chunk.docId)
    }

    if (!agg.chunkIds.has(chunk.chunkId)) {
      agg.chunkIds.add(chunk.chunkId)
      agg.topChunks.push(chunk)
    }

    causeAggMap.set(chunk.causeId, agg)
  }

  const causeIds = uniqueStrings(Array.from(causeAggMap.keys()))
  const causeRows: any[] = []
  const causeDocRows: any[] = []
  if (causeIds.length) {
    for (const batch of chunkArray(causeIds, 220)) {
      const [{ data: causeData, error: causeErr }, { data: docData, error: docErr }] = await Promise.all([
        admin
          .from("gob_tribunal_causes")
          .select("id,tribunal,rol,fecha_ingreso,caratula,estado_subtipo,estado,link_causa")
          .in("id", batch),
        admin
          .from("gob_tribunal_documents")
          .select("id,cause_id,document_type,date,name,storage_path,url")
          .in("cause_id", batch),
      ])

      if (causeErr) return NextResponse.json({ error: causeErr.message }, { status: 500 })
      if (docErr) return NextResponse.json({ error: docErr.message }, { status: 500 })

      causeRows.push(...(causeData || []))
      causeDocRows.push(...(docData || []))
    }
  }

  const causeById = new Map<string, any>()
  for (const row of causeRows || []) {
    causeById.set(String((row as any).id), row)
  }

  const causeProfilesById = await loadOnboardingCauseProfiles(admin, causeIds)

  const causeDocsByCauseId = new Map<string, any[]>()
  for (const row of causeDocRows || []) {
    const causeId = String((row as any).cause_id || "")
    if (!causeId) continue
    const list = causeDocsByCauseId.get(causeId) || []
    list.push(row)
    causeDocsByCauseId.set(causeId, list)
  }

  const docProfileIds = uniqueStrings((causeDocRows || []).map((row: any) => String(row?.id || "")))
  const docProfilesById = await loadOnboardingDocumentProfiles(admin, docProfileIds)

  const graphRowsByCauseId = new Map<string, any[]>()
  if (causeIds.length && claimGraphValues.length) {
    for (const batch of chunkArray(causeIds, 180)) {
      const { data } = await admin
        .from("gob_entities")
        .select("cause_id,entity_type,entity_value,normalized_value")
        .eq("workspace_id", corpus.id)
        .in("cause_id", batch)
        .in("normalized_value", claimGraphValues)
        .limit(2400)

      for (const row of data || []) {
        const causeId = String((row as any)?.cause_id || "")
        if (!causeId) continue
        const list = graphRowsByCauseId.get(causeId) || []
        list.push(row)
        graphRowsByCauseId.set(causeId, list)
      }
    }
  }

  const claimCauseId = claimSourceAttrs?.tribunal_cause_id ? String(claimSourceAttrs.tribunal_cause_id) : null
  const claimRol = claimSourceAttrs?.rol ? String(claimSourceAttrs.rol) : null
  const graphSimilarityByCauseId = new Map<string, any>()
  if (causeIds.length && claimCauseId) {
    const [similarityA, similarityB] = await Promise.all([
      admin
        .from("gob_cause_similarity")
        .select("cause_a_id,cause_b_id,cause_a_rol,cause_b_rol,similarity_score,shared_factors")
        .eq("workspace_id", corpus.id)
        .eq("cause_a_id", claimCauseId)
        .in("cause_b_id", causeIds)
        .limit(220),
      admin
        .from("gob_cause_similarity")
        .select("cause_a_id,cause_b_id,cause_a_rol,cause_b_rol,similarity_score,shared_factors")
        .eq("workspace_id", corpus.id)
        .eq("cause_b_id", claimCauseId)
        .in("cause_a_id", causeIds)
        .limit(220),
    ])

    for (const row of [...(similarityA.data || []), ...(similarityB.data || [])]) {
      const left = String((row as any)?.cause_a_id || "")
      const right = String((row as any)?.cause_b_id || "")
      const otherCauseId = left === claimCauseId ? right : left
      if (!otherCauseId) continue
      graphSimilarityByCauseId.set(otherCauseId, row)
    }
  }

  const maxCauses = Math.max(3, Math.min(20, Number(parsed.data.maxCauses ?? 8)))

  const recommendations = Array.from(causeAggMap.values())
    .map((agg) => {
      const cause = causeById.get(agg.causeId)
      if (!cause) return null
      if (eligibleCauseIds.size > 0 && !eligibleCauseIds.has(String(cause.id))) return null
      if (!isEligibleCorpusCause(cause)) return null

      const profile = causeProfilesById.get(agg.causeId) || null
      const graphSignal = buildGraphOverlapSignal({
        matchedEntities: (graphRowsByCauseId.get(agg.causeId) || []).map((row: any) => ({
          entityType: String(row?.entity_type || ""),
          entityValue: String(row?.entity_value || ""),
          normalizedValue: String(row?.normalized_value || ""),
        })),
        similarityScore: Number((graphSimilarityByCauseId.get(agg.causeId) as any)?.similarity_score || 0) || null,
        relatedRoles: uniqueStrings([
          String((graphSimilarityByCauseId.get(agg.causeId) as any)?.cause_a_rol || ""),
          String((graphSimilarityByCauseId.get(agg.causeId) as any)?.cause_b_rol || ""),
          claimRol || "",
        ]).filter((role) => role !== claimRol),
      })

      const caratulaOverlap = overlapRatio(claimTokens, tokenSet(String(cause.caratula || "")))
      const textualSimilarity = agg.score
      const documentQuality = roleBonus(agg.docRoles)
      const proceduralStage = proceduralStageFit(cause, agg.docRoles) * 0.9 + Math.log1p(agg.chunkHits) * 0.12
      const lexicalCausaOverlap = caratulaOverlap * 1.8

      const allCauseDocs = (causeDocsByCauseId.get(agg.causeId) || [])
        .filter((doc: any) =>
          isStrictTribunalKeyDocument({
            documentType: doc?.document_type ? String(doc.document_type) : null,
            name: doc?.name ? String(doc.name) : null,
            title: doc?.document_type ? String(doc.document_type) : null,
          })
        )
        .slice()

      const filterEval = causeMatchesFilters({
        cause,
        docs: allCauseDocs,
        filters: structuredFilters,
      })
      if (!filterEval.pass) return null

      allCauseDocs.sort((a: any, b: any) => {
        const da = parseDate(String(a.date || ""))
        const db = parseDate(String(b.date || ""))
        if (!da && !db) return 0
        if (!da) return 1
        if (!db) return -1
        return db.getTime() - da.getTime()
      })

      const preferredDocRoles = Array.isArray(profile?.recommended_doc_roles)
        ? profile.recommended_doc_roles.map((role: any) => String(role || ""))
        : null
      const relevanceById = new Map<string, number>()
      for (const doc of allCauseDocs) {
        const docProfile = docProfilesById.get(String(doc.id)) || null
        const relevance = Number(docProfile?.relevance_score || 0)
        if (Number.isFinite(relevance)) {
          relevanceById.set(String(doc.id), relevance)
        }
      }

      const defenseDocMix = selectDefenseDocumentMix(allCauseDocs, {
        preferredRoles: preferredDocRoles,
        matchedDocIds: agg.matchedDocIds,
        relevanceById,
        limit: 5,
        requireCorePair: true,
        maxContextReclamaciones: 1,
      })
      const docsOut = defenseDocMix.selected

      const docById = new Map<string, any>()
      for (const doc of allCauseDocs) {
        docById.set(String(doc.id), doc)
      }

      const reasons = [...filterEval.reasons, ...buildFallbackReason(cause, agg.docRoles, caratulaOverlap)]
      if (defenseDocMix.coverage.missingCoreRoles.length > 0) {
        reasons.unshift(
          `Cobertura documental incompleta: falta ${defenseDocMix.coverage.missingCoreRoles.join(" y ")} entre los documentos clave de esta causa.`
        )
      }
      if (profile?.summary) {
        reasons.unshift(`Perfil defensivo: ${safeText(String(profile.summary || ""), 220)}`)
      }
      if (Array.isArray(profile?.risky_if) && profile.risky_if.length) {
        reasons.push(`Riesgo de uso: ${safeText(String(profile.risky_if[0] || ""), 200)}`)
      }
      if (agg.topChunks.length > 0) {
        reasons.push(`Se encontraron ${agg.topChunks.length} citas textuales relevantes para esta causa.`)
      }
      if (graphSignal.score > 0) {
        reasons.push(
          `Coincidencias estructurales del grafo: ${graphSignal.matchedValues.slice(0, 3).join(", ")}${graphSignal.relatedRoles.length ? ` | causas relacionadas: ${graphSignal.relatedRoles.join(", ")}` : ""}.`
        )
      }

      const keyQuotes = agg.topChunks
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((chunk) => {
          const matchedDoc = chunk.docId ? docById.get(String(chunk.docId)) : null
          const claimMatch = findBestClaimMatch(chunk.content, claimChunksLex)
          const commonTerms = commonTermsBetween(claimMatch.quote, chunk.content, 8)
          const similarityType = classifySimilarityType({
            claimQuote: claimMatch.quote,
            precedentQuote: chunk.content,
            docRole: chunk.docRole,
          })
          const findingId = randomUUID()
          return {
            findingId,
            chunkId: chunk.chunkId,
            quote: clipQuote(chunk.content, 260),
            sourceUrl: chunk.sourceUrl,
            page: chunk.page,
            section: chunk.section,
            score: Number(chunk.score.toFixed(4)),
            claimQuote: claimMatch.quote,
            lexicalOverlapWithClaim: claimMatch.overlap,
            commonTerms,
            similarityType,
            similarityTypeLabel: similarityTypeLabel(similarityType),
            documentId: matchedDoc?.id ? String(matchedDoc.id) : chunk.docId,
            documentName: matchedDoc?.name ? String(matchedDoc.name) : chunk.docName,
            documentUrl: matchedDoc?.url ? String(matchedDoc.url) : chunk.docUrl,
            analysisComment: buildSimilarityComment({
              overlap: claimMatch.overlap,
              docRole: chunk.docRole,
              hasClaimQuote: Boolean(claimMatch.quote),
            }),
          }
        })

      const confidence = inferConfidence({
        lexicalScore: caratulaOverlap,
        docRoles: agg.docRoles,
        quoteCount: keyQuotes.length,
      })

      const scoreBreakdown = buildScoreBreakdown({
        textualSimilarity,
        documentQuality,
        proceduralStage,
        filterBoost: filterEval.boost,
        lexicalCausaOverlap,
        graphRelevance: graphSignal.score,
      })
      const scoreDrivers = buildScoreDrivers(scoreBreakdown)
      const strategicActions = buildStrategicActions({
        cause,
        lexicalScore: caratulaOverlap,
        docRoles: agg.docRoles,
        confidence,
      })
      if (Array.isArray(profile?.interesting_if)) {
        strategicActions.unshift(
          ...profile.interesting_if
            .map((x: any) => safeText(String(x || ""), 180))
            .filter(Boolean)
            .slice(0, 2)
        )
      }

      const defenseSummary =
        profile?.summary && String(profile.summary || "").trim()
          ? safeText(String(profile.summary || ""), 560)
          : confidence === "alta"
            ? "Alta utilidad para defensa: combina evidencia documental relevante y coincidencia tematica robusta."
            : confidence === "media"
              ? "Utilidad media: aporta argumentos y documentos valiosos, aunque requiere validacion adicional antes de usarla como eje principal."
              : "Utilidad baja o complementaria: usar como referencia secundaria y no como precedente principal."

      const interestingDocMix = selectDefenseDocumentMix(allCauseDocs, {
        preferredRoles: preferredDocRoles,
        matchedDocIds: agg.matchedDocIds,
        relevanceById,
        limit: 3,
        requireCorePair: true,
        maxContextReclamaciones: 1,
      })

      const interestingDocuments = interestingDocMix.selected.map((doc: any) => {
        const profile = docProfilesById.get(String(doc.id)) || null
        return {
          id: String(doc.id),
          name: doc.name ? String(doc.name) : null,
          documentType: doc.document_type ? String(doc.document_type) : null,
          docRole: resolveRecommendationDocRole(doc),
          date: doc.date ? String(doc.date) : null,
          url: doc.url ? String(doc.url) : null,
          contribution: profile?.summary
            ? safeText(String(profile.summary), 220)
            : docDefenseContribution(doc),
        }
      })

      const anchorEval = anchorSignal({
        anchors: defenseAnchors,
        cause,
        docs: docsOut,
        topChunks: agg.topChunks,
      })

      return {
        causeId: String(cause.id),
        tribunal: cause.tribunal ? String(cause.tribunal) : null,
        rol: cause.rol ? String(cause.rol) : null,
        fechaIngreso: cause.fecha_ingreso ? String(cause.fecha_ingreso) : null,
        caratula: cause.caratula ? String(cause.caratula) : null,
        estado: cause.estado ? String(cause.estado) : null,
        estadoSubtipo: cause.estado_subtipo ? String(cause.estado_subtipo) : null,
        linkCausa: cause.link_causa ? String(cause.link_causa) : null,
        score: scoreBreakdown.total,
        scoreBreakdown,
        scoreDrivers,
        graphSignal,
        reasons: reasons.slice(0, 4),
        confidence,
        defenseSummary,
        strategicActions,
        documentRoleCoverage: defenseDocMix.coverage,
        interestingDocuments,
        matchedDocuments: docsOut.map((doc: any) => ({
          id: String(doc.id),
          documentType: doc.document_type ? String(doc.document_type) : null,
          docRole: resolveRecommendationDocRole(doc),
          date: doc.date ? String(doc.date) : null,
          name: doc.name ? String(doc.name) : null,
          storagePath: doc.storage_path ? String(doc.storage_path) : null,
          url: doc.url ? String(doc.url) : null,
        })),
        keyQuotes,
        anchorHits: anchorEval.anchorHits,
        anchorCoverage: anchorEval.anchorCoverage,
        matchedAnchors: anchorEval.matchedAnchors,
        missingAnchors: anchorEval.missingAnchors,
      }
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCauses)

  let finalRecommendations: any[] = recommendations

  if (!finalRecommendations.length) {
    const fallbackCauseIds = eligibleCauseIds.size
      ? Array.from(eligibleCauseIds).slice(0, 2600)
      : []

    let fallbackCauseQuery = admin
      .from("gob_tribunal_causes")
      .select("id,tribunal,rol,fecha_ingreso,caratula,estado_subtipo,estado,link_causa")
      .limit(2600)

    if (fallbackCauseIds.length) {
      fallbackCauseQuery = fallbackCauseQuery.in("id", fallbackCauseIds)
    }

    let fallbackDocsQuery = admin
      .from("gob_tribunal_documents")
      .select("id,cause_id,document_type,date,name,storage_path,url")
      .limit(12000)

    if (fallbackCauseIds.length) {
      fallbackDocsQuery = fallbackDocsQuery.in("cause_id", fallbackCauseIds)
    }

    const [{ data: fallbackCauses, error: fallbackCauseErr }, { data: fallbackDocs, error: fallbackDocsErr }] =
      await Promise.all([fallbackCauseQuery, fallbackDocsQuery])

    if (fallbackCauseErr) return NextResponse.json({ error: fallbackCauseErr.message }, { status: 500 })
    if (fallbackDocsErr) return NextResponse.json({ error: fallbackDocsErr.message }, { status: 500 })

    const fallbackCauseIdsFromRows = uniqueStrings((fallbackCauses || []).map((row: any) => String(row?.id || "")))
    const fallbackProfilesById = await loadOnboardingCauseProfiles(admin, fallbackCauseIdsFromRows)
    const fallbackDocProfileIds = uniqueStrings((fallbackDocs || []).map((row: any) => String(row?.id || "")))
    const fallbackDocProfilesById = await loadOnboardingDocumentProfiles(admin, fallbackDocProfileIds)
    const fallbackGraphRowsByCauseId = new Map<string, any[]>()
    if (fallbackCauseIdsFromRows.length && claimGraphValues.length) {
      for (const batch of chunkArray(fallbackCauseIdsFromRows, 180)) {
        const { data } = await admin
          .from("gob_entities")
          .select("cause_id,entity_type,entity_value,normalized_value")
          .eq("workspace_id", corpus.id)
          .in("cause_id", batch)
          .in("normalized_value", claimGraphValues)
          .limit(2400)

        for (const row of data || []) {
          const causeId = String((row as any)?.cause_id || "")
          if (!causeId) continue
          const list = fallbackGraphRowsByCauseId.get(causeId) || []
          list.push(row)
          fallbackGraphRowsByCauseId.set(causeId, list)
        }
      }
    }

    const fallbackGraphSimilarityByCauseId = new Map<string, any>()
    if (fallbackCauseIdsFromRows.length && claimCauseId) {
      const [similarityA, similarityB] = await Promise.all([
        admin
          .from("gob_cause_similarity")
          .select("cause_a_id,cause_b_id,cause_a_rol,cause_b_rol,similarity_score,shared_factors")
          .eq("workspace_id", corpus.id)
          .eq("cause_a_id", claimCauseId)
          .in("cause_b_id", fallbackCauseIdsFromRows)
          .limit(320),
        admin
          .from("gob_cause_similarity")
          .select("cause_a_id,cause_b_id,cause_a_rol,cause_b_rol,similarity_score,shared_factors")
          .eq("workspace_id", corpus.id)
          .eq("cause_b_id", claimCauseId)
          .in("cause_a_id", fallbackCauseIdsFromRows)
          .limit(320),
      ])

      for (const row of [...(similarityA.data || []), ...(similarityB.data || [])]) {
        const left = String((row as any)?.cause_a_id || "")
        const right = String((row as any)?.cause_b_id || "")
        const otherCauseId = left === claimCauseId ? right : left
        if (!otherCauseId) continue
        fallbackGraphSimilarityByCauseId.set(otherCauseId, row)
      }
    }

    const docsByCause = new Map<string, any[]>()
    for (const doc of fallbackDocs || []) {
      const causeId = String((doc as any).cause_id || "")
      if (!causeId) continue
      if (duplicateDocIds.has(String((doc as any).id))) continue
      if (
        !isStrictTribunalKeyDocument({
          documentType: (doc as any).document_type ? String((doc as any).document_type) : null,
          name: (doc as any).name ? String((doc as any).name) : null,
          title: (doc as any).document_type ? String((doc as any).document_type) : null,
        })
      ) {
        continue
      }
      const list = docsByCause.get(causeId) || []
      list.push(doc)
      docsByCause.set(causeId, list)
    }

    finalRecommendations = (fallbackCauses || [])
      .map((cause: any) => {
        if (eligibleCauseIds.size > 0 && !eligibleCauseIds.has(String(cause.id))) return null
        if (!isEligibleCorpusCause(cause)) return null
        const profile = fallbackProfilesById.get(String(cause.id)) || null
        const graphSignal = buildGraphOverlapSignal({
          matchedEntities: (fallbackGraphRowsByCauseId.get(String(cause.id)) || []).map((row: any) => ({
            entityType: String(row?.entity_type || ""),
            entityValue: String(row?.entity_value || ""),
            normalizedValue: String(row?.normalized_value || ""),
          })),
          similarityScore: Number((fallbackGraphSimilarityByCauseId.get(String(cause.id)) as any)?.similarity_score || 0) || null,
          relatedRoles: uniqueStrings([
            String((fallbackGraphSimilarityByCauseId.get(String(cause.id)) as any)?.cause_a_rol || ""),
            String((fallbackGraphSimilarityByCauseId.get(String(cause.id)) as any)?.cause_b_rol || ""),
            claimRol || "",
          ]).filter((role) => role !== claimRol),
        })
        const docs = docsByCause.get(String(cause.id)) || []
        const filterEval = causeMatchesFilters({
          cause,
          docs,
          filters: structuredFilters,
        })
        if (!filterEval.pass) return null

        const docsText = docs
          .slice(0, 10)
          .map((d: any) => `${d.document_type || ""} ${d.name || ""}`)
          .join(" ")

        const lexicalScore = overlapRatio(
          claimTokens,
          tokenSet(`${cause.caratula || ""} ${cause.estado || ""} ${docsText}`)
        )

        const docRoles = new Set<string>(
          docs.slice(0, 12).map((d: any) =>
            classifyTribunalDocumentRole({ documentType: d.document_type, name: d.name })
          )
        )

        const score = lexicalScore * 4 + roleBonus(docRoles) + filterEval.boost
        if (score <= 0.05) return null

        const scoreBreakdown = buildScoreBreakdown({
          textualSimilarity: lexicalScore * 4,
          documentQuality: roleBonus(docRoles),
          proceduralStage: proceduralStageFit(cause, docRoles) * 0.9,
          filterBoost: filterEval.boost,
          lexicalCausaOverlap: lexicalScore * 0.6,
          graphRelevance: graphSignal.score,
        })
        const scoreDrivers = buildScoreDrivers(scoreBreakdown)

        const confidence = inferConfidence({
          lexicalScore,
          docRoles,
          quoteCount: 0,
        })

        const strategicActions = buildStrategicActions({
          cause,
          lexicalScore,
          docRoles,
          confidence,
        })
        if (Array.isArray(profile?.interesting_if)) {
          strategicActions.unshift(
            ...profile.interesting_if
              .map((x: any) => safeText(String(x || ""), 180))
              .filter(Boolean)
              .slice(0, 2)
          )
        }

        const preferredDocRoles = Array.isArray(profile?.recommended_doc_roles)
          ? profile.recommended_doc_roles.map((role: any) => String(role || ""))
          : null
        const relevanceById = new Map<string, number>()
        for (const doc of docs) {
          const docProfile = fallbackDocProfilesById.get(String(doc.id)) || null
          const relevance = Number(docProfile?.relevance_score || 0)
          if (Number.isFinite(relevance)) {
            relevanceById.set(String(doc.id), relevance)
          }
        }

        const defenseSummary =
          profile?.summary && String(profile.summary || "").trim()
            ? safeText(String(profile.summary || ""), 560)
            : confidence === "alta"
              ? "Alta utilidad potencial para defensa, sujeta a contraste puntual de hechos y fecha procesal."
              : confidence === "media"
                ? "Utilidad media para defensa; se recomienda usar con soporte adicional de evidencia directa."
                : "Referencia complementaria para defensa, no prioritaria en la estrategia principal."

        const defenseDocMix = selectDefenseDocumentMix(docs, {
          preferredRoles: preferredDocRoles,
          relevanceById,
          limit: 5,
          requireCorePair: true,
          maxContextReclamaciones: 1,
        })
        const orderedDocs = defenseDocMix.selected

        const interestingDocMix = selectDefenseDocumentMix(docs, {
          preferredRoles: preferredDocRoles,
          relevanceById,
          limit: 3,
          requireCorePair: true,
          maxContextReclamaciones: 1,
        })

        const interestingDocuments = interestingDocMix.selected.map((doc: any) => {
          const profile = fallbackDocProfilesById.get(String(doc.id)) || null
          return {
            id: String(doc.id),
            name: doc.name ? String(doc.name) : null,
            documentType: doc.document_type ? String(doc.document_type) : null,
            docRole: resolveRecommendationDocRole(doc),
            date: doc.date ? String(doc.date) : null,
            url: doc.url ? String(doc.url) : null,
            contribution: profile?.summary
              ? safeText(String(profile.summary), 220)
              : docDefenseContribution(doc),
          }
        })

        const anchorEval = anchorSignal({
          anchors: defenseAnchors,
          cause,
          docs,
          topChunks: [],
        })

        return {
          causeId: String(cause.id),
          tribunal: cause.tribunal ? String(cause.tribunal) : null,
          rol: cause.rol ? String(cause.rol) : null,
          fechaIngreso: cause.fecha_ingreso ? String(cause.fecha_ingreso) : null,
          caratula: cause.caratula ? String(cause.caratula) : null,
          estado: cause.estado ? String(cause.estado) : null,
          estadoSubtipo: cause.estado_subtipo ? String(cause.estado_subtipo) : null,
          linkCausa: cause.link_causa ? String(cause.link_causa) : null,
          score: scoreBreakdown.total,
          scoreBreakdown,
          scoreDrivers,
          graphSignal,
          reasons: [
            ...(profile?.summary ? [`Perfil defensivo: ${safeText(String(profile.summary || ""), 220)}`] : []),
            ...(graphSignal.score > 0
              ? [
                  `Coincidencias estructurales del grafo: ${graphSignal.matchedValues.slice(0, 3).join(", ")}${graphSignal.relatedRoles.length ? ` | causas relacionadas: ${graphSignal.relatedRoles.join(", ")}` : ""}.`,
                ]
              : []),
            ...filterEval.reasons,
            ...buildFallbackReason(cause, docRoles, lexicalScore),
          ].slice(0, 4),
          confidence,
          defenseSummary,
          strategicActions,
          documentRoleCoverage: defenseDocMix.coverage,
          interestingDocuments,
          matchedDocuments: orderedDocs.slice(0, 5).map((doc: any) => ({
            id: String(doc.id),
            documentType: doc.document_type ? String(doc.document_type) : null,
            docRole: resolveRecommendationDocRole(doc),
            date: doc.date ? String(doc.date) : null,
            name: doc.name ? String(doc.name) : null,
            storagePath: doc.storage_path ? String(doc.storage_path) : null,
            url: doc.url ? String(doc.url) : null,
          })),
          keyQuotes: [],
          anchorHits: anchorEval.anchorHits,
          anchorCoverage: anchorEval.anchorCoverage,
          matchedAnchors: anchorEval.matchedAnchors,
          missingAnchors: anchorEval.missingAnchors,
        }
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxCauses)
  }

  finalRecommendations = applyEvidenceGroundingGuard(finalRecommendations)

  const evidenceBackedCount = finalRecommendations.filter((rec: any) => Boolean(rec?.evidenceBacked)).length
  if (evidenceBackedCount === 0) {
    warnings.push("No hubo coincidencias con citas textuales directas; resultados se consideran preliminares.")
  }

  const rerankResult = await rerankRecommendationsForDefense({
    question,
    claimText,
    defenseAnchors,
    criticalDefenseAnchors,
    recommendations: finalRecommendations,
  })

  const anchorGateResult = applyDefenseAnchorGate({
    recommendations: rerankResult.recommendations,
    anchors: defenseAnchors,
    criticalAnchors: criticalDefenseAnchors,
    enabled: anchorGateEnabled,
    requireCriticalMatch: requireCriticalAnchorMatch,
    minCoreAnchorHits,
    minSupportAnchorHits,
    minCoreCriticalAnchorHits,
    minSupportCriticalAnchorHits,
  })

  finalRecommendations = anchorGateResult.recommendations.slice(0, maxCauses)
  warnings.push(...(rerankResult.warnings || []))
  if (anchorGateEnabled && finalRecommendations.length && anchorGateResult.summary.supportPassedCauses === 0) {
    warnings.push("Gate de anclas activo: ninguna causa supero anclas minimas de soporte en esta corrida.")
  }
  if (criticalAnchorGateEnabled && finalRecommendations.length && anchorGateResult.summary.criticalMatchedCauses === 0) {
    warnings.push("Gate critico activo: ninguna causa incluyo anclas criticas del caso en esta corrida.")
  }

  const anchorPolicy = {
    enabled: anchorGateResult.summary.enabled,
    criticalEnabled: anchorGateResult.summary.criticalEnabled,
    terms: defenseAnchors,
    criticalTerms: criticalDefenseAnchors,
    minCoreHits: anchorGateResult.summary.minCoreHits,
    minSupportHits: anchorGateResult.summary.minSupportHits,
    minCoreCriticalHits: anchorGateResult.summary.minCoreCriticalHits,
    minSupportCriticalHits: anchorGateResult.summary.minSupportCriticalHits,
    matchedCauses: anchorGateResult.summary.matchedCauses,
    criticalMatchedCauses: anchorGateResult.summary.criticalMatchedCauses,
    supportPassedCauses: anchorGateResult.summary.supportPassedCauses,
    downgradedCore: anchorGateResult.summary.downgradedCore,
    downgradedToDiscard: anchorGateResult.summary.downgradedToDiscard,
    downgradedByCritical: anchorGateResult.summary.downgradedByCritical,
  }

  const softFilterHideDiscardDefault = boolEnv("ONBOARDING_RERANK_HIDE_DISCARD_DEFAULT", true)
  const visibleRecommendationsCount = finalRecommendations.filter(
    (rec: any) => String(rec.utilityLabel || "support") !== "discard"
  ).length
  const recommendationsForSummary =
    visibleRecommendationsCount > 0
      ? finalRecommendations.filter((rec: any) => String(rec.utilityLabel || "support") !== "discard")
      : finalRecommendations

  const chunkById = new Map<string, RankedChunk>()
  for (const chunk of rankedChunks) {
    if (!chunkById.has(chunk.chunkId)) chunkById.set(chunk.chunkId, chunk)
  }

  const marcoPlanResult = await buildDefenseMarcoPlan({
    question,
    recommendations: recommendationsForSummary,
  })

  const preferredCauseIds = new Set(
    Array.isArray(marcoPlanResult.plan?.preferredCauseIds)
      ? marcoPlanResult.plan.preferredCauseIds.map((item: any) => String(item || "")).filter(Boolean)
      : []
  )
  const recommendationsForMarco = preferredCauseIds.size
    ? recommendationsForSummary
        .slice()
        .sort((a, b) => {
          const aRank = preferredCauseIds.has(String(a?.causeId || "")) ? 0 : 1
          const bRank = preferredCauseIds.has(String(b?.causeId || "")) ? 0 : 1
          if (aRank !== bRank) return aRank - bRank
          return Number(b?.score || 0) - Number(a?.score || 0)
        })
    : recommendationsForSummary

  const summaryEvidence = selectSummaryEvidenceForMarco({
    recommendations: recommendationsForMarco,
    chunkById,
    limit: 26,
  })

  const summaryEvidenceCoverage = summarizeDefenseDocumentCoverage(
    summaryEvidence.map((chunk) => ({
      docRole: chunk.docRole,
      document_type: chunk.documentType,
      name: chunk.documentTitle,
      section: chunk.section,
    }))
  )
  if (!summaryEvidenceCoverage.hasCorePair) {
    warnings.push(
      `Marco teorico con cobertura documental incompleta: falta ${summaryEvidenceCoverage.missingCoreRoles.join(" y ") || "documentacion clave"} en la evidencia resumida.`
    )
  }

  let summaryText = ""
  let summaryCitations: Array<{
    chunkId: string
    quote: string
    sourceUrl: string | null
    snapshotId: string | null
    page: number | null
    section: string | null
  }> = []

  if (summaryEvidence.length >= 3) {
    try {
        const planDirectives = [
          marcoPlanResult.plan?.openingDirective ? `Apertura sugerida: ${safeText(marcoPlanResult.plan.openingDirective, 260)}` : "",
          Array.isArray(marcoPlanResult.plan?.documentPriorityRules) && marcoPlanResult.plan.documentPriorityRules.length
            ? `Reglas de prioridad documental: ${marcoPlanResult.plan.documentPriorityRules.map((item: any) => safeText(item, 180)).join(" | ")}`
            : "",
          Array.isArray(marcoPlanResult.plan?.riskAlerts) && marcoPlanResult.plan.riskAlerts.length
            ? `Alertas de riesgo: ${marcoPlanResult.plan.riskAlerts.map((item: any) => safeText(item, 180)).join(" | ")}`
            : "",
          Array.isArray(marcoPlanResult.plan?.actionLines) && marcoPlanResult.plan.actionLines.length
            ? `Baja la sintesis a acciones: ${marcoPlanResult.plan.actionLines.map((item: any) => safeText(item, 180)).join(" | ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n")

        const out = await generateStrictAnswer({
          question:
            `${question || ""}\n\n` +
          "Construye un marco teorico orientado a defensa de la causa. Prioriza Evacua Informe e instrumentos equivalentes del SEA, luego sentencia o resolucion final, y usa la reclamacion solo como contexto. Debe explicar: (1) por que cada causa sugerida es util, (2) que documentos son clave y como usarlos, (3) riesgos de usar mal cada precedente, y (4) plan accionable para escrito/informe.\n" +
          `Cobertura documental de la evidencia: informe=${summaryEvidenceCoverage.counts.informe}, sentencia=${summaryEvidenceCoverage.counts.sentencia}, reclamacion=${summaryEvidenceCoverage.counts.reclamacion}.\n` +
          (planDirectives ? `Plan de sintesis:\n${planDirectives}` : ""),
          evidence: summaryEvidence,
          mode: "checklist",
          responseProfile: "deep",
        difficulty: "complex",
      })

      summaryText = safeText(out.answer, 15000)
      const byChunk = new Map(summaryEvidence.map((e) => [e.chunkId, e]))
      summaryCitations = (out.citations || []).map((c: any) => {
        const meta = byChunk.get(String(c.chunkId))
        return {
          chunkId: String(c.chunkId),
          quote: String(c.quote),
          sourceUrl: meta?.sourceUrl ?? null,
          snapshotId: meta?.snapshotId ?? null,
          page: meta?.page ?? null,
          section: meta?.section ?? null,
        }
      })
    } catch (err: any) {
      warnings.push(`Summary generation warning: ${err?.message ?? String(err)}`)
    }
  }

  if (!summaryText) {
    const lines: string[] = []
    lines.push("Marco teorico inicial (borrador):")
    lines.push("")
    if (recommendationsForSummary.length) {
      lines.push("Casos mas utiles detectados:")
      for (let i = 0; i < Math.min(6, recommendationsForSummary.length); i += 1) {
        const rec = recommendationsForSummary[i]
        const reason = rec.reasons?.[0] || "Coincidencia de temas y soporte documental."
        lines.push(`${i + 1}. ${rec.rol || "Sin rol"}: ${reason}`)
      }
      lines.push("")
      lines.push("Proximo paso recomendado: revisar primero reclamacion + evacua informe + sentencia de cada causa priorizada.")
    } else {
      lines.push("No se encontraron causas similares con evidencia suficiente en este momento.")
      lines.push("Espera a que termine la indexacion del corpus o ajusta la consulta.")
    }
    summaryText = lines.join("\n")
  }

  const shortlisted = recommendationsForSummary
    .slice(0, 5)
    .map((rec, idx) => `${idx + 1}. ${rec.rol || "(sin rol)"} - ${safeText(rec.caratula || "", 160)}`)

  if (shortlisted.length) {
    summaryText = `${summaryText}\n\nCausas priorizadas:\n${shortlisted.join("\n")}`.trim()
  }
  if (marcoPlanResult.applied && Array.isArray(marcoPlanResult.plan?.actionLines) && marcoPlanResult.plan.actionLines.length) {
    summaryText = `${summaryText}\n\nPlan accionable:\n${marcoPlanResult.plan.actionLines
      .slice(0, 4)
      .map((line: any, idx: number) => `${idx + 1}. ${safeText(line, 220)}`)
      .join("\n")}`.trim()
  }

  const matrix = finalRecommendations.map((rec: any) => {
    const topDoc = (rec.interestingDocuments && rec.interestingDocuments[0]) || (rec.matchedDocuments && rec.matchedDocuments[0]) || null
    const topFinding = rec.keyQuotes?.[0] || null
    return {
      causeId: rec.causeId,
      rol: rec.rol,
      confidence: rec.confidence,
      riskLevel:
        rec.utilityRisk === "low"
          ? "bajo"
          : rec.utilityRisk === "high"
            ? "alto"
            : rec.confidence === "alta"
              ? "bajo"
              : rec.confidence === "media"
                ? "medio"
                : "alto",
      score: rec.score,
      utilityLabel: rec.utilityLabel || null,
      utilityRisk: rec.utilityRisk || null,
      utilityReason: rec.utilityReason || null,
      evidenceBacked: Boolean(rec.evidenceBacked),
      evidenceLevel: rec.evidenceLevel || null,
      documentRoleCoverage: rec.documentRoleCoverage || null,
      anchorHits: Number(rec.anchorHits || 0),
      anchorCoverage: Number(rec.anchorCoverage || 0),
      matchedAnchors: Array.isArray(rec.matchedAnchors) ? rec.matchedAnchors.slice(0, 8) : [],
      missingAnchors: Array.isArray(rec.missingAnchors) ? rec.missingAnchors.slice(0, 8) : [],
      criticalAnchorHits: Number(rec.criticalAnchorHits || 0),
      matchedCriticalAnchors: Array.isArray(rec.matchedCriticalAnchors)
        ? rec.matchedCriticalAnchors.slice(0, 8)
        : [],
      missingCriticalAnchors: Array.isArray(rec.missingCriticalAnchors)
        ? rec.missingCriticalAnchors.slice(0, 8)
        : [],
      anchorGate: rec.anchorGate || null,
      document: topDoc
        ? {
            id: topDoc.id,
            name: topDoc.name || topDoc.documentType || "Documento",
            url: topDoc.url || null,
            documentType: topDoc.documentType || null,
            docRole: topDoc.docRole || null,
            contribution: topDoc.contribution || rec.defenseSummary || null,
          }
        : null,
      whereToCite: topFinding
        ? {
            findingId: topFinding.findingId,
            quote: topFinding.quote,
            claimQuote: topFinding.claimQuote || null,
            similarityType: topFinding.similarityType || "hecho",
            similarityTypeLabel: topFinding.similarityTypeLabel || "Hecho",
            commonTerms: topFinding.commonTerms || [],
            documentUrl: topFinding.documentUrl || topFinding.sourceUrl || null,
          }
        : null,
    }
  })

  await saveOnboardingRunMetadata({
    supabase,
    workspaceId,
    userId: user.id,
    runId,
    payload: {
      run_id: runId,
      created_at: now,
      question,
      filters: structuredFilters,
      recommendation_count: finalRecommendations.length,
      visible_recommendation_count: visibleRecommendationsCount,
      evidence_backed_count: evidenceBackedCount,
      pool_eligible_causes: eligibleCauseIds.size,
      candidate_chunks: rankedChunks.length,
      exact_hash_matches: exactHashMatches,
      near_duplicate_matches: nearDuplicateMatches,
      rerank: {
        applied: rerankResult.applied,
        model: rerankResult.model,
        top_k: rerankResult.topK,
        soft_filter_hide_discard_default: softFilterHideDiscardDefault,
      },
      marco_plan: {
        applied: marcoPlanResult.applied,
        model: marcoPlanResult.model,
      },
      anchors: anchorPolicy,
        recommendations: finalRecommendations.map((rec: any) => ({
          cause_id: rec.causeId,
          rol: rec.rol,
          score: rec.score,
          confidence: rec.confidence,
          defense_summary: rec.defenseSummary || null,
          evidence_backed: Boolean(rec.evidenceBacked),
          evidence_level: rec.evidenceLevel || null,
          utility_label: rec.utilityLabel || null,
          utility_risk: rec.utilityRisk || null,
          utility_reason: rec.utilityReason || null,
          document_role_coverage: rec.documentRoleCoverage || null,
          selected_documents: Array.isArray(rec.interestingDocuments)
            ? rec.interestingDocuments.slice(0, 4).map((doc: any) => ({
                id: doc?.id ? String(doc.id) : null,
                name: doc?.name ? String(doc.name) : null,
                url: doc?.url ? String(doc.url) : null,
                document_type: doc?.documentType ? String(doc.documentType) : null,
                doc_role: doc?.docRole ? String(doc.docRole) : null,
                contribution: doc?.contribution ? String(doc.contribution) : null,
              }))
            : [],
          anchor_hits: Number(rec.anchorHits || 0),
          anchor_coverage: Number(rec.anchorCoverage || 0),
        matched_anchors: Array.isArray(rec.matchedAnchors) ? rec.matchedAnchors.slice(0, 8) : [],
        missing_anchors: Array.isArray(rec.missingAnchors) ? rec.missingAnchors.slice(0, 8) : [],
        critical_anchor_hits: Number(rec.criticalAnchorHits || 0),
        matched_critical_anchors: Array.isArray(rec.matchedCriticalAnchors)
          ? rec.matchedCriticalAnchors.slice(0, 8)
          : [],
        missing_critical_anchors: Array.isArray(rec.missingCriticalAnchors)
          ? rec.missingCriticalAnchors.slice(0, 8)
          : [],
      })),
      matrix,
      hitl: {
        cause_reviews: {},
        finding_feedback: {},
        frozen_precedents: null,
      },
      kpis: {
        perceived_precision: null,
        used_causes_ratio: 0,
        time_to_first_use_minutes: null,
      },
    },
  }).catch(() => null)

  await recordRetrievalTrace({
    supabase,
    workspaceId,
    stage: "search",
    provider: "local",
    query: question || queries[0] || "onboarding-recommend",
      filters: {
        mode: "onboarding",
        queries,
        structured_filters: structuredFilters,
        corpus_workspace_id: corpus.id,
        max_causes: maxCauses,
      },
    results: rankedChunks.slice(0, 30).map((chunk) => ({
      chunkId: chunk.chunkId,
      content: chunk.content,
      sourceUrl: chunk.sourceUrl,
      snapshotId: chunk.snapshotId,
      score: chunk.score,
    })),
    createdBy: user.id,
    metadata: {
      onboarding: true,
      run_id: runId,
      recommendation_count: finalRecommendations.length,
      visible_recommendation_count: visibleRecommendationsCount,
      evidence_backed_count: evidenceBackedCount,
      pool_eligible_causes: eligibleCauseIds.size,
      exact_hash_matches: exactHashMatches,
      near_duplicate_matches: nearDuplicateMatches,
      excluded_sources: duplicateSourceIds.size,
      candidate_chunks: rankedChunks.length,
      candidate_chunk_hits: candidateChunkCount,
      rerank_applied: rerankResult.applied,
      rerank_model: rerankResult.model,
      rerank_top_k: rerankResult.topK,
      marco_plan_applied: marcoPlanResult.applied,
      marco_plan_model: marcoPlanResult.model,
      soft_filter_hide_discard_default: softFilterHideDiscardDefault,
      anchor_gate_enabled: anchorPolicy.enabled,
      anchor_critical_gate_enabled: anchorPolicy.criticalEnabled,
      anchor_terms: anchorPolicy.terms,
      anchor_critical_terms: anchorPolicy.criticalTerms,
      anchor_min_core_hits: anchorPolicy.minCoreHits,
      anchor_min_support_hits: anchorPolicy.minSupportHits,
      anchor_min_core_critical_hits: anchorPolicy.minCoreCriticalHits,
      anchor_min_support_critical_hits: anchorPolicy.minSupportCriticalHits,
      anchor_matched_causes: anchorPolicy.matchedCauses,
      anchor_critical_matched_causes: anchorPolicy.criticalMatchedCauses,
      anchor_support_passed_causes: anchorPolicy.supportPassedCauses,
      anchor_downgraded_core: anchorPolicy.downgradedCore,
      anchor_downgraded_to_discard: anchorPolicy.downgradedToDiscard,
      anchor_downgraded_by_critical: anchorPolicy.downgradedByCritical,
      warnings,
    },
  }).catch(() => null)

  await supabase.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "workspace.onboarding.recommend",
    target_resource: "gob_tribunal_causes",
    details: {
      workspace_id: workspaceId,
      run_id: runId,
      claim_snapshot_id: claimSnapshot.id,
      corpus_workspace_id: corpus.id,
      filters: structuredFilters,
      recommendation_count: finalRecommendations.length,
      visible_recommendation_count: visibleRecommendationsCount,
      evidence_backed_count: evidenceBackedCount,
      pool_eligible_causes: eligibleCauseIds.size,
      exact_hash_matches: exactHashMatches,
      near_duplicate_matches: nearDuplicateMatches,
      excluded_sources: duplicateSourceIds.size,
      rerank_applied: rerankResult.applied,
      rerank_model: rerankResult.model,
      rerank_top_k: rerankResult.topK,
      soft_filter_hide_discard_default: softFilterHideDiscardDefault,
      anchor_gate_enabled: anchorPolicy.enabled,
      anchor_critical_gate_enabled: anchorPolicy.criticalEnabled,
      anchor_terms: anchorPolicy.terms,
      anchor_critical_terms: anchorPolicy.criticalTerms,
      anchor_min_core_hits: anchorPolicy.minCoreHits,
      anchor_min_support_hits: anchorPolicy.minSupportHits,
      anchor_min_core_critical_hits: anchorPolicy.minCoreCriticalHits,
      anchor_min_support_critical_hits: anchorPolicy.minSupportCriticalHits,
      anchor_matched_causes: anchorPolicy.matchedCauses,
      anchor_critical_matched_causes: anchorPolicy.criticalMatchedCauses,
      anchor_support_passed_causes: anchorPolicy.supportPassedCauses,
      anchor_downgraded_core: anchorPolicy.downgradedCore,
      anchor_downgraded_to_discard: anchorPolicy.downgradedToDiscard,
      anchor_downgraded_by_critical: anchorPolicy.downgradedByCritical,
    },
    timestamp: now,
  })

  return NextResponse.json({
    analysisRun: {
      runId,
      generatedAt: now,
      confidenceRules: confidenceRules(),
    },
    claim: {
      snapshotId: String(claimSnapshot.id),
      sourceId: claimSource?.id ? String(claimSource.id) : null,
      title: claimSource?.title ? String(claimSource.title) : claimSource?.filename ? String(claimSource.filename) : null,
      hash: claimHash || null,
    },
    summary: {
      text: summaryText,
      citations: summaryCitations,
    },
    recommendationPolicy: {
      softFilter: {
        enabled: true,
        hideDiscardDefault: softFilterHideDiscardDefault,
      },
      rerank: {
        applied: rerankResult.applied,
        model: rerankResult.model,
        topK: rerankResult.topK,
      },
      marcoPlan: {
        applied: marcoPlanResult.applied,
        model: marcoPlanResult.model,
      },
      evidence: {
        backedCount: evidenceBackedCount,
        preliminaryCount: Math.max(0, finalRecommendations.length - evidenceBackedCount),
      },
      pool: {
        eligibleCauses: eligibleCauseIds.size,
      },
      anchors: anchorPolicy,
    },
    recommendations: finalRecommendations,
    matrix,
    hitl: {
      runId,
      causeReviews: finalRecommendations.map((rec: any) => ({
        causeId: rec.causeId,
        status: "pendiente",
        comment: null,
      })),
      findingFeedback: [],
      frozenPrecedents: null,
    },
    sync: {
      corpusWorkspaceId: corpus.id,
      corpusWorkspaceTitle: corpus.title,
      createdWorkspace: corpus.created,
      ...syncStats,
    },
    duplicateDetection: {
      exactHashMatches,
      nearDuplicateMatches,
      excludedSources: duplicateSourceIds.size,
      excludedDocuments: duplicateDocIds.size,
    },
    stats: {
      queries,
      filters: structuredFilters,
      candidateChunks: rankedChunks.length,
      candidateCauses: finalRecommendations.length,
      visibleCandidateCauses: visibleRecommendationsCount,
      evidenceBackedCauses: evidenceBackedCount,
      poolEligibleCauses: eligibleCauseIds.size,
      rerank: {
        applied: rerankResult.applied,
        model: rerankResult.model,
        topK: rerankResult.topK,
      },
      anchors: anchorPolicy,
      warnings,
    },
  })
}
