import "dotenv/config"

import { createServerClient } from "@supabase/ssr"

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
  const question = String(
    args.question || "Segun el marco teorico del proyecto, que criterios defensivos del SEA aparecen en los evacua informes y como terminaron esas causas?"
  ).trim()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ""
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
  const email = process.env.E2E_USER_EMAIL || "e2e.proyectos@local.test"
  const password = process.env.E2E_USER_PASSWORD || "E2E_Proyecto_2026!"

  if (!supabaseUrl || !anonKey) throw new Error("Missing Supabase env")

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

  const res = await fetch(`${appUrl}/api/workspaces/${workspaceId}/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      cookie,
    },
    body: JSON.stringify({
      question,
      mode: "checklist",
      responseProfile: "deep",
    }),
  })

  const raw = await res.text()
  const json = (() => {
    try {
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })()
  if (!res.ok) throw new Error(raw || JSON.stringify(json || { status: res.status }))

  const assistantMessage = json?.assistantMessage || json?.messages?.[json.messages.length - 1] || null
  console.log(
    JSON.stringify(
      {
        content: String(assistantMessage?.content || "").slice(0, 1800),
        citations: Array.isArray(assistantMessage?.citations) ? assistantMessage.citations.slice(0, 5) : [],
        assistantReport: assistantMessage?.usage?.assistantReport || null,
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
