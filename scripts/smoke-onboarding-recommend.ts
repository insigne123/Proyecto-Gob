import "dotenv/config"

import { createServerClient } from "@supabase/ssr"
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
  if (!workspaceId) throw new Error("Missing --workspaceId")

  const appUrl = String(args.appUrl || "http://localhost:9010").trim().replace(/\/+$/, "")
  const question = String(args.question || "Genera marco teorico de defensa priorizando criterios del SEA").trim()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ""
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  const email = process.env.E2E_USER_EMAIL || "e2e.proyectos@local.test"
  const password = process.env.E2E_USER_PASSWORD || "E2E_Proyecto_2026!"

  if (!supabaseUrl || !anonKey || !serviceKey) throw new Error("Missing Supabase env")

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const { data: sourceRows, error: sourceErr } = await admin
    .from("gob_sources")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("source_origin", "onboarding-claim")
    .order("created_at", { ascending: false })
    .limit(1)
  if (sourceErr) throw sourceErr
  const sourceId = sourceRows?.[0]?.id
  if (!sourceId) throw new Error("No onboarding claim source found")

  const { data: snapshotRows, error: snapshotErr } = await admin
    .from("gob_source_snapshots")
    .select("id,status")
    .eq("source_id", sourceId)
    .order("created_at", { ascending: false })
    .limit(1)
  if (snapshotErr) throw snapshotErr
  const snapshotId = snapshotRows?.[0]?.id
  if (!snapshotId) throw new Error("No snapshot found for onboarding claim")

  const jar = new Map<string, string>()
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return Array.from(jar.entries()).map(([name, value]) => ({ name, value }))
      },
      setAll(cookies) {
        for (const cookie of cookies) {
          if (cookie.value) jar.set(cookie.name, cookie.value)
          else jar.delete(cookie.name)
        }
      },
    },
  })

  const { error: signErr } = await supabase.auth.signInWithPassword({ email, password })
  if (signErr) throw signErr

  const cookie = Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ")

  const res = await fetch(`${appUrl}/api/workspaces/${workspaceId}/onboarding/recommend`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      cookie,
    },
    body: JSON.stringify({ snapshotId, question }),
  })

  const json = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(JSON.stringify(json || { status: res.status }))
  }

  const preview = (json?.recommendations || []).slice(0, 5).map((rec: any) => ({
    rol: rec.rol,
    score: rec.score,
    interestingDocuments: (rec.interestingDocuments || []).map((doc: any) => ({
      type: doc.documentType,
      name: doc.name,
    })),
  }))

  console.log(JSON.stringify({ snapshotId, preview }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
