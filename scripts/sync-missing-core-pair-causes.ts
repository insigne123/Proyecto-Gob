import "dotenv/config"

import { createClient } from "@supabase/supabase-js"

import { ensureTribunalCorpusWorkspace, syncTribunalCorpusDocuments } from "@/lib/onboarding/tribunal-corpus"

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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const limit = Math.max(10, Math.min(300, Number(args.limit || 80)))
  const maxNewSources = Math.max(10, Math.min(300, Number(args.maxNewSources || 120)))
  const maxRetries = Math.max(0, Math.min(100, Number(args.maxRetries || 40)))

  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
  if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase env vars")

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const { data: causes, error: causeErr } = await admin
    .from("gob_tribunal_causes")
    .select("id,rol,caratula,estado")
    .order("rol", { ascending: true })
    .limit(4000)

  if (causeErr) throw causeErr
  const causeIds = (causes || []).map((row: any) => String(row.id)).filter(Boolean)
  const { data: facts, error: factErr } = await admin
    .from("gob_tribunal_document_facts")
    .select("cause_id,doc_role")
    .in("cause_id", causeIds)

  if (factErr) throw factErr

  const countsByCause = new Map<string, { informe: number; sentencia: number }>()
  for (const causeId of causeIds) {
    countsByCause.set(causeId, { informe: 0, sentencia: 0 })
  }
  for (const row of facts || []) {
    const causeId = String((row as any)?.cause_id || "")
    const current = countsByCause.get(causeId)
    if (!current) continue
    const role = String((row as any)?.doc_role || "").toLowerCase()
    if (role === "informe") current.informe += 1
    if (role === "sentencia") current.sentencia += 1
  }

  const missingCorePairCauseIds = causeIds
    .filter((causeId) => {
      const counts = countsByCause.get(causeId) || { informe: 0, sentencia: 0 }
      return counts.informe <= 0 || counts.sentencia <= 0
    })
    .slice(0, limit)

  const workspace = await ensureTribunalCorpusWorkspace(admin)
  const stats = await syncTribunalCorpusDocuments({
    admin,
    corpusWorkspaceId: workspace.id,
    maxNewSources,
    maxRetries,
    targetCauseIds: missingCorePairCauseIds,
  })

  console.log(
    JSON.stringify(
      {
        targetedCauses: missingCorePairCauseIds.length,
        corpusWorkspaceId: workspace.id,
        stats,
      },
      null,
      2
    )
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
