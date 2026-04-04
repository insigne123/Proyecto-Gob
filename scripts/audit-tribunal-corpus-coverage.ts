import "dotenv/config"

import { createClient } from "@supabase/supabase-js"

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
  const limit = Math.max(20, Math.min(4000, Number(args.limit || 200)))

  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
  if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase env vars")

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const { data: causes, error: causeErr } = await admin
    .from("gob_tribunal_causes")
    .select("id,rol,caratula,estado")
    .order("rol", { ascending: true })
    .limit(limit)

  if (causeErr) throw causeErr
  const causeIds = (causes || []).map((row: any) => String(row.id)).filter(Boolean)
  if (!causeIds.length) {
    console.log(JSON.stringify({ totalCauses: 0, completeCorePair: 0, missingInforme: 0, missingSentencia: 0 }, null, 2))
    return
  }

  const { data: facts, error: factErr } = await admin
    .from("gob_tribunal_document_facts")
    .select("cause_id,rol,doc_role,document_name")
    .in("cause_id", causeIds)

  if (factErr) throw factErr

  const countsByCause = new Map<string, { informe: number; sentencia: number; reclamacion: number; docs: string[]; rol: string | null }>()
  for (const cause of causes || []) {
    countsByCause.set(String((cause as any).id), {
      informe: 0,
      sentencia: 0,
      reclamacion: 0,
      docs: [],
      rol: (cause as any)?.rol ? String((cause as any).rol) : null,
    })
  }

  for (const row of facts || []) {
    const causeId = String((row as any)?.cause_id || "")
    const current = countsByCause.get(causeId)
    if (!current) continue
    const role = String((row as any)?.doc_role || "").toLowerCase()
    if (role === "informe") current.informe += 1
    if (role === "sentencia") current.sentencia += 1
    if (role === "reclamacion") current.reclamacion += 1
    if ((row as any)?.document_name) current.docs.push(String((row as any).document_name))
  }

  const rows = Array.from(countsByCause.entries()).map(([causeId, counts]) => {
    const cause = (causes || []).find((row: any) => String(row.id) === causeId)
    return {
      causeId,
      rol: counts.rol,
      caratula: cause?.caratula ? String(cause.caratula) : null,
      estado: cause?.estado ? String(cause.estado) : null,
      informe: counts.informe,
      sentencia: counts.sentencia,
      reclamacion: counts.reclamacion,
      hasCorePair: counts.informe > 0 && counts.sentencia > 0,
      sampleDocs: counts.docs.slice(0, 4),
    }
  })

  const missingInforme = rows.filter((row) => row.informe <= 0)
  const missingSentencia = rows.filter((row) => row.sentencia <= 0)
  const missingCorePair = rows.filter((row) => !row.hasCorePair)

  console.log(
    JSON.stringify(
      {
        totalCauses: rows.length,
        completeCorePair: rows.filter((row) => row.hasCorePair).length,
        missingInforme: missingInforme.length,
        missingSentencia: missingSentencia.length,
        missingCorePair: missingCorePair.length,
        sampleMissingCorePair: missingCorePair.slice(0, 20),
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
