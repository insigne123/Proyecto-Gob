import "dotenv/config"

import { createClient } from "@supabase/supabase-js"

import { isEligibleOnboardingCause } from "../src/lib/onboarding/eligibility"
import { classifyTribunalDocumentRole } from "../src/lib/tribunal/document-role"

function parseArgs(argv: string[]) {
  const out = new Set<string>()
  for (const token of argv) {
    if (token.startsWith("--")) out.add(token.slice(2))
  }
  return out
}

type CauseRow = {
  id: string
  tribunal: string | null
  rol: string | null
  caratula: string | null
}

type DocumentRow = {
  id: string
  cause_id: string
  document_type: string | null
  name: string | null
  source_origin: string | null
}

async function main() {
  const flags = parseArgs(process.argv.slice(2))
  const apply = flags.has("apply")

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE URL or service role key")
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const { data: causes, error: causesErr } = await supabase
    .from("gob_tribunal_causes")
    .select("id,tribunal,rol,caratula")
    .limit(10000)
  if (causesErr) throw causesErr

  const { data: docs, error: docsErr } = await supabase
    .from("gob_tribunal_documents")
    .select("id,cause_id,document_type,name,source_origin")
    .limit(20000)
  if (docsErr) throw docsErr

  const causeRows = (causes || []) as CauseRow[]
  const docRows = (docs || []) as DocumentRow[]
  const causeById = new Map(causeRows.map((row) => [String(row.id), row]))

  const deleteDocIds = new Set<string>()
  for (const doc of docRows) {
    if (String(doc.source_origin || "") !== "estado_diario") continue
    const cause = causeById.get(String(doc.cause_id)) || null
    const eligible = Boolean(
      cause &&
        isEligibleOnboardingCause({
          tribunal: cause.tribunal,
          caratula: cause.caratula,
        })
    )
    const strictRole = classifyTribunalDocumentRole({
      documentType: doc.document_type,
      name: doc.name,
      title: doc.document_type,
    })
    if (!eligible || strictRole === "documento") {
      deleteDocIds.add(String(doc.id))
    }
  }

  const remainingDocsByCause = new Map<string, number>()
  const hasNonEstadoDocsByCause = new Map<string, boolean>()
  for (const doc of docRows) {
    const causeId = String(doc.cause_id)
    if (!deleteDocIds.has(String(doc.id))) {
      remainingDocsByCause.set(causeId, (remainingDocsByCause.get(causeId) || 0) + 1)
    }
    if (String(doc.source_origin || "") !== "estado_diario") {
      hasNonEstadoDocsByCause.set(causeId, true)
    }
  }

  const deleteCauseIds = causeRows
    .filter((cause) => !isEligibleOnboardingCause({ tribunal: cause.tribunal, caratula: cause.caratula }))
    .filter((cause) => !hasNonEstadoDocsByCause.get(String(cause.id)))
    .filter((cause) => (remainingDocsByCause.get(String(cause.id)) || 0) === 0)
    .map((cause) => String(cause.id))

  const deleteCauseKeySet = new Set(
    causeRows
      .filter((cause) => deleteCauseIds.includes(String(cause.id)))
      .map((cause) => `${String(cause.tribunal || "")}|${String(cause.rol || "")}`)
  )

  const { data: updates, error: updatesErr } = await supabase
    .from("gob_tribunal_cause_updates")
    .select("id,cause_id,tribunal,rol")
    .eq("source", "estado_diario")
    .limit(20000)
  if (updatesErr) throw updatesErr

  const deleteUpdateIds = (updates || [])
    .filter((row: any) => {
      const causeId = String(row?.cause_id || "")
      if (causeId && deleteCauseIds.includes(causeId)) return true
      const key = `${String(row?.tribunal || "")}|${String(row?.rol || "")}`
      return deleteCauseKeySet.has(key)
    })
    .map((row: any) => String(row.id))

  const summary = {
    apply,
    deleteDocuments: deleteDocIds.size,
    deleteCauses: deleteCauseIds.length,
    deleteCauseUpdates: deleteUpdateIds.length,
    sampleCauseIds: deleteCauseIds.slice(0, 20),
    sampleDocIds: Array.from(deleteDocIds).slice(0, 20),
  }

  if (!apply) {
    console.log(JSON.stringify(summary, null, 2))
    return
  }

  if (deleteUpdateIds.length) {
    for (let i = 0; i < deleteUpdateIds.length; i += 500) {
      const batch = deleteUpdateIds.slice(i, i + 500)
      const { error } = await supabase.from("gob_tribunal_cause_updates").delete().in("id", batch)
      if (error) throw error
    }
  }

  const docIds = Array.from(deleteDocIds)
  if (docIds.length) {
    for (let i = 0; i < docIds.length; i += 500) {
      const batch = docIds.slice(i, i + 500)
      const { error } = await supabase.from("gob_tribunal_documents").delete().in("id", batch)
      if (error) throw error
    }
  }

  if (deleteCauseIds.length) {
    for (let i = 0; i < deleteCauseIds.length; i += 500) {
      const batch = deleteCauseIds.slice(i, i + 500)
      const { error } = await supabase.from("gob_tribunal_causes").delete().in("id", batch)
      if (error) throw error
    }
  }

  console.log(
    JSON.stringify(
      {
        ...summary,
        deleted: true,
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
