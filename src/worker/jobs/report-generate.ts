import { ai } from "../../ai/genkit"
import { getRagProvider } from "../../lib/env"
import { toVectorLiteral } from "../../lib/pgvector"
import {
  isHybridRagMode,
  listKnowledgeBasesForWorkspaces,
  mapResultsToEvidence,
  searchKnowledgeBaseWithFileSearch,
  shouldUseManagedRetrieval,
} from "../../lib/rag/openai-managed"
import { recordRetrievalTrace } from "../../lib/rag/retrieval-trace"
import { getReportTemplate } from "../../lib/reports/template"
import type { EvidenceChunk } from "../../lib/rag/strict-answer"
import { generateStrictReportBatch } from "../../lib/rag/strict-report-batch"

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function uniqueByChunkId(list: any[]) {
  const seen = new Set<string>()
  const out: any[] = []
  for (const x of list) {
    const id = String(x.chunk_id ?? x.chunkId ?? x.id ?? "")
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(x)
  }
  return out
}

function citationKey(c: { chunkId: string; quote: string }) {
  return `${c.chunkId}|${c.quote}`
}

function toEvidenceChunk(m: any): EvidenceChunk {
  return {
    chunkId: String(m.chunk_id ?? m.chunkId ?? m.id),
    content: String(m.content ?? ""),
    sourceUrl: m.source_url ? String(m.source_url) : null,
    snapshotId: m.snapshot_id ? String(m.snapshot_id) : null,
    page: typeof m.page === "number" ? m.page : m.page ? Number(m.page) : null,
    section: m.section ? String(m.section) : null,
  }
}

function localRank(row: any) {
  const bySimilarity =
    typeof row?.similarity === "number"
      ? row.similarity
      : row?.similarity
        ? Number(row.similarity)
        : null
  if (typeof bySimilarity === "number" && Number.isFinite(bySimilarity)) return bySimilarity

  const byRank = typeof row?.rank === "number" ? row.rank : row?.rank ? Number(row.rank) : null
  if (typeof byRank === "number" && Number.isFinite(byRank)) return byRank
  return 0
}

type ProfileSummary = {
  region: string | null
  causeType: string | null
  tribunalRole: string | null
  seaRole: string | null
  proceduralStatus: string | null
  sector: string | null
}

type RelatedPrecedent = {
  reportId: string
  workspaceId: string
  workspaceTitle: string
  status: string
  createdAt: string | null
  templateId: string | null
  score: number
  why: string
  excerpt: string
}

type PersistedPrecedent = {
  reportId: string
  workspaceId: string
  status: string
  createdAt: string | null
  templateId: string | null
  score: number
  why: string
}

function safeText(value: unknown, maxLen = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text
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

function tokenize(value: string) {
  return normalizeText(value)
    .split(" ")
    .map((x) => x.trim())
    .filter((x) => x.length >= 3)
    .slice(0, 80)
}

function toTokenSet(value: string) {
  return new Set(tokenize(value))
}

function overlapRatio(a: Set<string>, b: Set<string>) {
  if (a.size === 0 || b.size === 0) return 0
  let hit = 0
  for (const token of a) {
    if (b.has(token)) hit++
  }
  return hit / Math.max(1, Math.min(a.size, b.size))
}

function profileFromRow(row: any): ProfileSummary {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {}
  return {
    region: safeText(row?.region, 120) || null,
    causeType: safeText(row?.cause_type, 140) || null,
    tribunalRole: safeText(row?.tribunal_role, 140) || null,
    seaRole: safeText(row?.sea_role, 140) || null,
    proceduralStatus: safeText(row?.procedural_status, 140) || null,
    sector: safeText((metadata as any)?.sector, 120) || null,
  }
}

function collectReportText(contentJson: any) {
  const sections = Array.isArray(contentJson?.sections) ? contentJson.sections : []
  const out: string[] = []

  for (const section of sections.slice(0, 8)) {
    const heading = safeText(section?.heading ?? section?.key ?? "Seccion", 140)
    const paragraphs = Array.isArray(section?.paragraphs)
      ? section.paragraphs
          .map((p: any) => safeText(p?.text, 420))
          .filter(Boolean)
      : []
    const body = safeText(section?.body, 700)
    const text = paragraphs.length ? paragraphs.join(" ") : body
    if (!text) continue
    out.push(`${heading}: ${text}`)
  }

  return out.join(" ")
}

function scorePrecedent(params: {
  currentWorkspaceTitle: string
  currentProfile: ProfileSummary
  currentTemplateId: string
  candidateWorkspaceTitle: string
  candidateProfile: ProfileSummary
  candidateTemplateId: string | null
  candidateCreatedAt: string | null
  candidateReportText: string
}) {
  const {
    currentWorkspaceTitle,
    currentProfile,
    currentTemplateId,
    candidateWorkspaceTitle,
    candidateProfile,
    candidateTemplateId,
    candidateCreatedAt,
    candidateReportText,
  } = params

  let score = 0
  const reasons: string[] = []

  if (
    currentProfile.region &&
    candidateProfile.region &&
    normalizeText(currentProfile.region) === normalizeText(candidateProfile.region)
  ) {
    score += 2.2
    reasons.push("misma region")
  }

  if (
    currentProfile.causeType &&
    candidateProfile.causeType &&
    normalizeText(currentProfile.causeType) === normalizeText(candidateProfile.causeType)
  ) {
    score += 2.4
    reasons.push("mismo tipo de causa")
  }

  if (
    currentProfile.proceduralStatus &&
    candidateProfile.proceduralStatus &&
    normalizeText(currentProfile.proceduralStatus) ===
      normalizeText(candidateProfile.proceduralStatus)
  ) {
    score += 1.4
    reasons.push("estado procesal similar")
  }

  if (
    currentProfile.tribunalRole &&
    candidateProfile.tribunalRole &&
    normalizeText(currentProfile.tribunalRole) === normalizeText(candidateProfile.tribunalRole)
  ) {
    score += 0.9
    reasons.push("rol institucional similar")
  }

  if (
    currentProfile.seaRole &&
    candidateProfile.seaRole &&
    normalizeText(currentProfile.seaRole) === normalizeText(candidateProfile.seaRole)
  ) {
    score += 0.8
    reasons.push("rol SEA similar")
  }

  if (
    currentProfile.sector &&
    candidateProfile.sector &&
    normalizeText(currentProfile.sector) === normalizeText(candidateProfile.sector)
  ) {
    score += 0.8
    reasons.push("sector similar")
  }

  if (candidateTemplateId && candidateTemplateId === currentTemplateId) {
    score += 0.7
    reasons.push("misma plantilla")
  }

  const titleOverlap = overlapRatio(
    toTokenSet(currentWorkspaceTitle),
    toTokenSet(`${candidateWorkspaceTitle} ${candidateReportText}`)
  )
  if (titleOverlap > 0) {
    score += Math.min(1.8, titleOverlap * 2.2)
    reasons.push("coincidencia tematica")
  }

  const createdTs = candidateCreatedAt ? Date.parse(candidateCreatedAt) : Number.NaN
  if (Number.isFinite(createdTs)) {
    const ageDays = Math.max(0, (Date.now() - createdTs) / 86_400_000)
    const freshness = Math.max(0, 1 - ageDays / 540)
    score += freshness * 0.9
  }

  return {
    score,
    why: reasons.length ? reasons.slice(0, 3).join(", ") : "similitud semantica",
  }
}

async function findRelatedPrecedents(params: {
  supabase: any
  reportId: string
  workspaceId: string
  workspaceTitle: string
  currentTemplateId: string
  currentProfile: ProfileSummary
  createdBy: string | null
}) {
  const { supabase, reportId, workspaceId, workspaceTitle, currentTemplateId, currentProfile, createdBy } =
    params

  if (!createdBy) return [] as RelatedPrecedent[]

  const { data: memberships, error: memErr } = await supabase
    .from("gob_workspace_members")
    .select("workspace_id")
    .eq("user_id", createdBy)

  if (memErr) throw new Error(memErr.message)

  const candidateWorkspaceIds = Array.from(
    new Set(
      (memberships || [])
        .map((m: any) => String(m.workspace_id || ""))
        .filter((id: string) => !!id && id !== workspaceId)
    )
  )

  if (!candidateWorkspaceIds.length) return [] as RelatedPrecedent[]

  const [{ data: reports, error: reportsErr }, { data: workspaces, error: wsErr }, { data: profiles, error: pErr }] =
    await Promise.all([
      supabase
        .from("gob_reports")
        .select("id,workspace_id,status,created_at,content_json")
        .in("workspace_id", candidateWorkspaceIds)
        .in("status", ["review", "final"])
        .order("created_at", { ascending: false })
        .limit(180),
      supabase
        .from("gob_workspaces")
        .select("id,title")
        .in("id", candidateWorkspaceIds),
      supabase
        .from("gob_workspace_profiles")
        .select("workspace_id,region,cause_type,tribunal_role,sea_role,procedural_status,metadata")
        .in("workspace_id", candidateWorkspaceIds),
    ])

  if (reportsErr) throw new Error(reportsErr.message)
  if (wsErr) throw new Error(wsErr.message)
  if (pErr) throw new Error(pErr.message)

  const workspaceById = new Map<string, string>(
    (workspaces || []).map((w: any) => [String(w.id), safeText(w.title, 180) || "Proyecto"])
  )
  const profileByWorkspace = new Map<string, ProfileSummary>(
    (profiles || []).map((p: any) => [String(p.workspace_id), profileFromRow(p)])
  )

  const ranked: RelatedPrecedent[] = (reports || [])
    .map((r: any) => {
      const candidateWorkspaceId = String(r.workspace_id)
      const candidateWorkspaceTitle = workspaceById.get(candidateWorkspaceId) || "Proyecto"
      const candidateProfile = profileByWorkspace.get(candidateWorkspaceId) || {
        region: null,
        causeType: null,
        tribunalRole: null,
        seaRole: null,
        proceduralStatus: null,
        sector: null,
      }

      const reportText = collectReportText(r.content_json)
      if (!reportText) return null

      const candidateTemplateId =
        r?.content_json?.generation?.template && typeof r.content_json.generation.template === "string"
          ? String(r.content_json.generation.template)
          : null

      const scored = scorePrecedent({
        currentWorkspaceTitle: workspaceTitle,
        currentProfile,
        currentTemplateId,
        candidateWorkspaceTitle,
        candidateProfile,
        candidateTemplateId,
        candidateCreatedAt: r.created_at ? String(r.created_at) : null,
        candidateReportText: reportText,
      })

      return {
        reportId: String(r.id),
        workspaceId: candidateWorkspaceId,
        workspaceTitle: candidateWorkspaceTitle,
        status: String(r.status || "draft"),
        createdAt: r.created_at ? String(r.created_at) : null,
        templateId: candidateTemplateId,
        score: scored.score,
        why: scored.why,
        excerpt: safeText(reportText, 1500),
      } satisfies RelatedPrecedent
    })
    .filter((x: RelatedPrecedent | null): x is RelatedPrecedent => !!x)
    .sort((a: RelatedPrecedent, b: RelatedPrecedent) => {
      if (b.score !== a.score) return b.score - a.score
      const at = a.createdAt ? Date.parse(a.createdAt) : 0
      const bt = b.createdAt ? Date.parse(b.createdAt) : 0
      return bt - at
    })

  return ranked.filter((x: RelatedPrecedent) => x.score > 0.3).slice(0, 5)
}

async function getRetrievalWorkspaceIds(params: {
  supabase: any
  reportWorkspaceId: string
  createdBy: string | null
}) {
  const { supabase, reportWorkspaceId, createdBy } = params
  if (!createdBy) return [reportWorkspaceId]

  const { data: memberships, error } = await supabase
    .from("gob_workspace_members")
    .select("workspace_id")
    .eq("user_id", createdBy)

  if (error) throw new Error(error.message)

  const ids = Array.from(
    new Set<string>(
      (memberships || [])
        .map((m: any) => String(m.workspace_id || ""))
        .filter((id: string) => !!id)
        .concat([reportWorkspaceId])
    )
  ).slice(0, 60)

  return ids.length ? ids : [reportWorkspaceId]
}

export async function reportGenerateJob(params: { supabase: any; job: any }) {
  const { supabase, job } = params
  const reportId = String(job.payload?.report_id || "")
  if (!reportId) throw new Error("Missing report_id")

  const nowIso = new Date().toISOString()

  const { data: report, error: rErr } = await supabase
    .from("gob_reports")
    .select("id,workspace_id,content_json,created_by")
    .eq("id", reportId)
    .single()
  if (rErr) throw new Error(rErr.message)

  const workspaceId = String(report.workspace_id)
  const contentJson: any = report.content_json || {}
  const templateId = contentJson?.generation?.template || "informe-evaluacion"
  const template = getReportTemplate(templateId)

  const aggCitations = new Map<string, any>()
  const sectionsOut: any[] = Array.isArray(contentJson?.sections)
    ? contentJson.sections
    : template.sections.map((s) => ({
        heading: s.heading,
        body: "Generando...",
        citations: [],
      }))

  try {
    const { data: workspace, error: wErr } = await supabase
      .from("gob_workspaces")
      .select("id,title")
      .eq("id", workspaceId)
      .single()
    if (wErr) throw new Error(wErr.message)

    const { data: profile } = await supabase
      .from("gob_workspace_profiles")
      .select("region,cause_type,tribunal_role,sea_role,procedural_status,metadata")
      .eq("workspace_id", workspaceId)
      .maybeSingle()

    const currentProfile = profileFromRow(profile)

    const { data: notes, error: nErr } = await supabase
      .from("gob_notes")
      .select("title,content")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(30)
    if (nErr) throw new Error(nErr.message)

    const { data: timeline } = await supabase
      .from("gob_workspace_timeline_events")
      .select("occurred_at,kind,title,description,created_at")
      .eq("workspace_id", workspaceId)
      .order("occurred_at", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(500)

    const chronology = (timeline ?? []).map((e: any) => ({
      occurredAt: e.occurred_at ?? null,
      kind: e.kind ?? null,
      title: e.title ?? null,
      description: e.description ?? null,
    }))

    const noteList = (notes ?? []).map((n: any) => ({
      title: n.title ? String(n.title) : null,
      content: String(n.content ?? ""),
    }))

    const relatedPrecedents = await findRelatedPrecedents({
      supabase,
      reportId,
      workspaceId,
      workspaceTitle: String(workspace.title || "Proyecto"),
      currentTemplateId: template.id,
      currentProfile,
      createdBy: report.created_by ? String(report.created_by) : null,
    })

    const retrievalWorkspaceIds = await getRetrievalWorkspaceIds({
      supabase,
      reportWorkspaceId: workspaceId,
      createdBy: report.created_by ? String(report.created_by) : null,
    }).catch(() => [workspaceId])

    const persistedPrecedents: PersistedPrecedent[] = relatedPrecedents.map((p) => ({
      reportId: p.reportId,
      workspaceId: p.workspaceId,
      status: p.status,
      createdAt: p.createdAt,
      templateId: p.templateId,
      score: p.score,
      why: p.why,
    }))

    if (relatedPrecedents.length) {
      await recordRetrievalTrace({
        supabase,
        workspaceId,
        stage: "report",
        provider: "local",
        query: `precedentes relacionados para ${workspace.title}`,
        filters: { scope: "member_workspaces", max: 5 },
        results: [],
        reportId,
        metadata: {
          stage: "precedent_selection",
          count: relatedPrecedents.length,
        },
      }).catch(() => null)
    }

     // Load existing citations (if retry)
     if (Array.isArray(contentJson?.citations)) {
       for (const c of contentJson.citations) {
         if (c?.chunkId && c?.quote) {
           const key = citationKey(c)
           aggCitations.set(key, {
             ...c,
             usages: Array.isArray((c as any).usages) ? (c as any).usages : [],
           })
         }
       }
     }

    // Build per-section retrieval (OpenAI managed + local fallback)
    const queries = template.sections.map(
      (s) => `${workspace.title}. Seccion: ${s.heading}. ${s.instruction}`
    )

    const sectionHints: Record<string, string[]> = {}

    const union = new Map<
      string,
      { evidence: EvidenceChunk; similarity: number; firstSeen: number }
    >()

    const kbs = shouldUseManagedRetrieval()
      ? await listKnowledgeBasesForWorkspaces({
          supabase,
          workspaceIds: retrievalWorkspaceIds,
        }).catch(() => [])
      : []

    const ragProvider = getRagProvider()
    const useLocalFallback =
      ragProvider !== "openai" && (ragProvider === "local" || isHybridRagMode() || kbs.length === 0)
    const embedded = useLocalFallback
      ? await ai.embedMany({
          embedder: "googleai/gemini-embedding-001",
          content: queries,
          options: { taskType: "RETRIEVAL_QUERY", outputDimensionality: 768 },
        })
      : []

    const baseRegions = profile?.region ? [String(profile.region)] : []

    for (let i = 0; i < template.sections.length; i++) {
      const s = template.sections[i]
      const queryText = queries[i]
      const sectionRows: Array<{ evidence: EvidenceChunk; similarity: number }> = []

      if (kbs.length > 0) {
        for (const kb of kbs) {
          const managed = await searchKnowledgeBaseWithFileSearch({
            vectorStoreId: kb.vectorStoreId,
            query: queryText,
            filters: {
              regions: baseRegions,
            },
            maxResults: 12,
            scoreThreshold: Math.max(0.1, s.minSimilarity - 0.05),
          })

          const mapped = await mapResultsToEvidence({
            supabase,
            workspaceIds: retrievalWorkspaceIds,
            results: managed.results,
          })

          for (const row of mapped as any[]) {
            const scoreRaw = row?._meta?.score
            const score = typeof scoreRaw === "number" ? scoreRaw : Number(scoreRaw || 0)
            sectionRows.push({
              evidence: {
                chunkId: String(row.chunkId),
                content: String(row.content ?? ""),
                sourceUrl: row.sourceUrl ? String(row.sourceUrl) : null,
                snapshotId: row.snapshotId ? String(row.snapshotId) : null,
                page: typeof row.page === "number" ? row.page : null,
                section: row.section ? String(row.section) : null,
              },
              similarity: Number.isFinite(score) ? score : 0,
            })
          }

          await recordRetrievalTrace({
            supabase,
            workspaceId,
            stage: "report",
            provider: "openai",
            query: queryText,
            filters: { regions: baseRegions },
            results: mapped as any[],
            responseId: managed.responseId,
            model: managed.model,
            reportId,
            metadata: {
              section_key: s.key,
              section_heading: s.heading,
              kb_workspace_id: kb.workspaceId,
              source_scope: "member_workspaces",
            },
          }).catch(() => null)
        }
      }

      if (useLocalFallback && sectionRows.length < 6) {
        const vec = (embedded as any[])?.[i]?.embedding as number[] | undefined
        let matches: any[] = []

        const perWorkspaceCount = Math.max(
          3,
          Math.min(12, Math.ceil(18 / Math.max(1, retrievalWorkspaceIds.length)))
        )

        if (Array.isArray(vec) && vec.length > 0) {
          const vectorBatches = await Promise.all(
            retrievalWorkspaceIds.map((wsId) =>
              supabase.rpc("gob_search_chunks", {
                p_workspace_id: wsId,
                p_query_embedding: toVectorLiteral(vec),
                p_match_count: perWorkspaceCount,
                p_min_similarity: s.minSimilarity,
              })
            )
          )

          matches = vectorBatches.flatMap((batch: any) => {
            if (!batch || batch.error || !Array.isArray(batch.data)) return []
            return batch.data
          })
        }

        if (matches.length < 6) {
          const textBatches = await Promise.all(
            retrievalWorkspaceIds.map((wsId) =>
              supabase.rpc("gob_search_chunks_text", {
                p_workspace_id: wsId,
                p_query_text: `${workspace.title} ${s.heading}`,
                p_match_count: perWorkspaceCount,
              })
            )
          )

          const textMatches = textBatches.flatMap((batch: any) => {
            if (!batch || batch.error || !Array.isArray(batch.data)) return []
            return batch.data
          })
          matches = [...matches, ...textMatches]
        }

        const uniq = uniqueByChunkId(matches).sort((a: any, b: any) => localRank(b) - localRank(a))
        for (const m of uniq) {
          const simRaw = localRank(m)
          sectionRows.push({
            evidence: toEvidenceChunk(m),
            similarity: Number.isFinite(simRaw) ? simRaw : 0,
          })
        }

        await recordRetrievalTrace({
          supabase,
          workspaceId,
          stage: "report",
          provider: kbs.length > 0 ? "hybrid" : "local",
          query: queryText,
          filters: {},
          results: uniq,
          reportId,
          metadata: {
            section_key: s.key,
            section_heading: s.heading,
            fallback: true,
            source_scope: "member_workspaces",
            source_workspace_count: retrievalWorkspaceIds.length,
          },
        }).catch(() => null)
      }

      const dedup = new Map<string, { evidence: EvidenceChunk; similarity: number }>()
      for (const row of sectionRows) {
        const id = String(row.evidence.chunkId)
        if (!id) continue
        const prev = dedup.get(id)
        if (!prev || row.similarity > prev.similarity) {
          dedup.set(id, row)
        }
      }

      const ranked = Array.from(dedup.values()).sort((a, b) => b.similarity - a.similarity)
      sectionHints[s.key] = ranked.slice(0, 6).map((x) => x.evidence.chunkId)

      for (const row of ranked) {
        const id = String(row.evidence.chunkId)
        const prev = union.get(id)
        if (!prev || row.similarity > prev.similarity) {
          union.set(id, {
            evidence: row.evidence,
            similarity: row.similarity,
            firstSeen: i,
          })
        }
      }
    }

    // Select top-N union evidence by similarity
    const selected = Array.from(union.values())
      .sort((a, b) => {
        if (b.similarity !== a.similarity) return b.similarity - a.similarity
        return a.firstSeen - b.firstSeen
      })
      .slice(0, Math.min(56, Math.max(28, template.sections.length * 4)))
      .map((x) => x.evidence)

    const byId = new Map(selected.map((e) => [e.chunkId, e]))

    const out = await generateStrictReportBatch({
      workspaceTitle: workspace.title,
      template,
      notes: noteList,
      evidence: selected,
      sectionHints,
      precedents: relatedPrecedents,
    })

     const finalSections = out.sections.map((s: any) => ({
       key: s.key,
       heading: s.heading,
       body: s.body,
       paragraphs: Array.isArray(s.paragraphs) ? s.paragraphs : undefined,
       citations: s.citations,
       notFound: Boolean(s.notFound),
     }))

     for (const c of out.citations as any[]) {
       const meta = byId.get(c.chunkId)
       if (!meta) continue
       const full = {
         chunkId: c.chunkId,
         quote: c.quote,
         reportSectionKey: c.section ? String(c.section) : null,
         reportParagraph: typeof c.paragraph === "number" ? c.paragraph : null,
         sourceUrl: meta.sourceUrl,
         snapshotId: meta.snapshotId,
         page: meta.page,
         section: meta.section,
         usages: [],
       }

       const key = citationKey(full)
       const prev = aggCitations.get(key)
       if (!prev) {
         aggCitations.set(key, full)
       }

       const entry = aggCitations.get(key)
       if (entry) {
         const usage = {
           reportSectionKey: full.reportSectionKey,
           reportParagraph: full.reportParagraph,
         }
         const list: any[] = Array.isArray(entry.usages) ? entry.usages : []
         const exists = list.some(
           (u) =>
             u?.reportSectionKey === usage.reportSectionKey &&
             u?.reportParagraph === usage.reportParagraph
         )
         if (!exists) list.push(usage)
         entry.usages = list
         aggCitations.set(key, entry)
       }
     }

     await supabase
       .from("gob_reports")
       .update({
         created_by_model: out.model ?? null,
          content_json: {
            title: out.title,
            sections: finalSections,
            citations: Array.from(aggCitations.values()),
            annexes: {
              chronology,
              glossary: [],
              precedents: persistedPrecedents,
            },
            generation: {
              status: "completed",
              step: template.sections.length,
              total: template.sections.length,
              template: template.id,
              precedents_count: relatedPrecedents.length,
              started_at: contentJson?.generation?.started_at || nowIso,
              completed_at: new Date().toISOString(),
            },
            retrieval: {
              provider:
                kbs.length > 0
                  ? useLocalFallback
                    ? "hybrid"
                    : "openai"
                  : ragProvider === "openai"
                    ? "openai"
                    : "local",
              traced: true,
            },
            last_model: out.model ?? null,
            last_usage: out.usage ?? null,
            mode: "batch",
         },
         citations: Array.from(aggCitations.values()),
       })
       .eq("id", reportId)

    // done
  } catch (err: any) {
    const message = err?.message ?? String(err)
    await supabase
      .from("gob_reports")
      .update({
        content_json: {
          title: contentJson?.title || template.title,
          sections: sectionsOut,
          citations: Array.from(aggCitations.values()),
          generation: {
            status: "error",
            step: Number(contentJson?.generation?.step ?? 0),
            total: template.sections.length,
            template: template.id,
            started_at: contentJson?.generation?.started_at || nowIso,
            error: message,
            updated_at: new Date().toISOString(),
          },
        },
        citations: Array.from(aggCitations.values()),
      })
      .eq("id", reportId)
    throw err
  }
}
