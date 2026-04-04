import "dotenv/config"

import { createClient } from "@supabase/supabase-js"

import {
  buildStructuredOnboardingMemoryFromArtifacts,
  extractStructuredOnboardingMemoryFromMetadata,
} from "../src/lib/onboarding/structured-memory"

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "")
    if (!token.startsWith("--")) continue
    const key = token.slice(2)
    const next = String(argv[i + 1] || "")
    if (!next || next.startsWith("--")) {
      out[key] = "true"
      continue
    }
    out[key] = next
    i += 1
  }
  return out
}

function extractRoleTokensFromNotes(notes: Array<{ content?: string | null }>) {
  const roles = new Set<string>()
  for (const note of notes) {
    const content = String(note?.content || "")
    for (const match of content.matchAll(/\bR-\d{1,5}-\d{4}\b/gi)) {
      const rol = String(match[0] || "").toUpperCase()
      if (rol) roles.add(rol)
    }
  }
  return Array.from(roles)
}

async function enrichTribunalReferences(params: {
  supabase: any
  notes: Array<{ title?: string | null; content?: string | null }>
  currentReferences: any[]
}) {
  const roleTokens = extractRoleTokensFromNotes(params.notes).slice(0, 20)
  if (!roleTokens.length) return params.currentReferences

  const { data: corpusSources, error } = await params.supabase
    .from("gob_sources")
    .select("id,title,doc_type,attributes,url")
    .eq("source_origin", "tribunal-corpus")
    .limit(6000)

  if (error) return params.currentReferences

  const byRole = new Map<string, any[]>()
  for (const row of corpusSources || []) {
    const attrs = row?.attributes && typeof row.attributes === "object" ? row.attributes : {}
    const rol = String(attrs?.rol || "").toUpperCase()
    if (!rol || !roleTokens.includes(rol)) continue
    const list = byRole.get(rol) || []
    list.push(row)
    byRole.set(rol, list)
  }

  const existingSnapshotIds = new Set(
    params.currentReferences.map((ref: any) => String(ref?.snapshotId || "")).filter(Boolean)
  )
  const sourceIds = Array.from(new Set((corpusSources || []).map((row: any) => String(row.id)).filter(Boolean)))
  const { data: snapshots } = sourceIds.length
    ? await params.supabase
        .from("gob_source_snapshots")
        .select("id,source_id,status")
        .in("source_id", sourceIds)
        .eq("status", "ready")
        .order("created_at", { ascending: false })
    : { data: [] as any[] }

  const snapshotBySourceId = new Map<string, string>()
  for (const row of snapshots || []) {
    const sourceId = String((row as any)?.source_id || "")
    if (sourceId && !snapshotBySourceId.has(sourceId)) {
      snapshotBySourceId.set(sourceId, String((row as any)?.id || ""))
    }
  }

  const nextRefs = [...params.currentReferences]
  for (const rol of roleTokens) {
    const candidates = (byRole.get(rol) || []).sort((a: any, b: any) => {
      const attrsA = a?.attributes && typeof a.attributes === "object" ? a.attributes : {}
      const attrsB = b?.attributes && typeof b.attributes === "object" ? b.attributes : {}
      const rank = (role: string) => (role === "informe" ? 0 : role === "sentencia" ? 1 : role === "reclamacion" ? 2 : 9)
      const diff = rank(String(attrsA?.doc_role || "")) - rank(String(attrsB?.doc_role || ""))
      if (diff !== 0) return diff
      return String(a?.title || "").localeCompare(String(b?.title || ""))
    })

    for (const candidate of candidates.slice(0, 3)) {
      const attrs = candidate?.attributes && typeof candidate.attributes === "object" ? candidate.attributes : {}
      const snapshotId = snapshotBySourceId.get(String(candidate.id)) || ""
      if (!snapshotId || existingSnapshotIds.has(snapshotId)) continue
      existingSnapshotIds.add(snapshotId)
      nextRefs.push({
        snapshotId,
        sourceId: String(candidate.id),
        sourceTitle: candidate?.title ? String(candidate.title) : null,
        docType: candidate?.doc_type ? String(candidate.doc_type) : null,
        docRole: attrs?.doc_role ? String(attrs.doc_role) : null,
        rol: attrs?.rol ? String(attrs.rol) : rol,
        causeId: attrs?.tribunal_cause_id ? String(attrs.tribunal_cause_id) : null,
        documentId: attrs?.tribunal_document_id ? String(attrs.tribunal_document_id) : null,
        documentName: candidate?.title ? String(candidate.title) : null,
        documentUrl: candidate?.url ? String(candidate.url) : null,
        sampleQuote: null,
        sourceUrl: null,
      })
    }
  }

  return nextRefs.slice(0, 20)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const workspaceId = String(args.workspaceId || "").trim()
  if (!workspaceId) throw new Error("Missing --workspaceId")

  const apply = String(args.apply || "false").toLowerCase() === "true"
  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    { auth: { persistSession: false } }
  )

  const { data: profile, error: profileErr } = await supabase
    .from("gob_workspace_profiles")
    .select("metadata")
    .eq("workspace_id", workspaceId)
    .maybeSingle()
  if (profileErr) throw profileErr

  const metadata = profile?.metadata && typeof profile.metadata === "object" && !Array.isArray(profile.metadata)
    ? profile.metadata
    : {}
  const onboarding = metadata?.onboarding && typeof metadata.onboarding === "object" ? metadata.onboarding : {}

  const { data: notes, error: notesErr } = await supabase
    .from("gob_notes")
    .select("title,content")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(6)
  if (notesErr) throw notesErr

  const tribunalReferences = Array.isArray((onboarding as any)?.tribunal_references)
    ? (onboarding as any).tribunal_references
    : []
  const enrichedReferences = await enrichTribunalReferences({
    supabase,
    notes: Array.isArray(notes) ? notes : [],
    currentReferences: tribunalReferences,
  })

  const memory = buildStructuredOnboardingMemoryFromArtifacts({
    metadataMemory: extractStructuredOnboardingMemoryFromMetadata(metadata),
    notes: Array.isArray(notes) ? notes : [],
    tribunalReferences: enrichedReferences,
  })

  console.log(
    JSON.stringify(
      {
        workspaceId,
        apply,
        summary: memory?.summary || null,
        defenseHypothesis: memory?.defenseHypothesis || null,
        defenseCriteria: memory?.defenseCriteria || [],
        outcomeLessons: memory?.outcomeLessons || [],
        contextFacts: memory?.contextFacts || [],
        keyDocuments: memory?.keyDocuments || [],
      },
      null,
      2
    )
  )

  if (!apply || !memory) return

  const nextMetadata = {
        ...metadata,
        onboarding: {
          ...(onboarding as Record<string, unknown>),
          structured_memory: memory,
          tribunal_references: enrichedReferences,
        },
      }

  const { error: updateErr } = await supabase
    .from("gob_workspace_profiles")
    .upsert({
      workspace_id: workspaceId,
      metadata: nextMetadata,
    })

  if (updateErr) throw updateErr
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
