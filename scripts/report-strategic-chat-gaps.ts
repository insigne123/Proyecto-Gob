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
  const workspaceId = String(args.workspaceId || "").trim()
  const limit = Math.max(5, Math.min(100, Number(args.limit || 30)))
  if (!workspaceId) throw new Error("Missing --workspaceId")

  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
  if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase env vars")

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const { data, error } = await admin
    .from("gob_audit_logs")
    .select("timestamp,details")
    .eq("action", "chat.ask")
    .eq("details->>workspace_id", workspaceId)
    .order("timestamp", { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = (data || [])
    .map((row: any) => ({
      timestamp: row?.timestamp || null,
      question: row?.details?.question || null,
      support: row?.details?.answer_support_strength || null,
      supportReason: row?.details?.answer_support_reason || null,
      coverage: row?.details?.defense_coverage_status || null,
      missingRoles: row?.details?.defense_missing_roles || [],
      evidenceCount: row?.details?.evidence_count || 0,
      citations: row?.details?.cited_chunks_count || 0,
      partialLike:
        row?.details?.answer_support_strength === "partial" ||
        row?.details?.answer_support_strength === "weak" ||
        row?.details?.answer_support_strength === "none",
    }))
    .filter((row) => row.partialLike)

  console.log(JSON.stringify({ workspaceId, totalReviewed: (data || []).length, partialOrWeak: rows.length, rows }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
