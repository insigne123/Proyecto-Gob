import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { requestHasHealthToken } from "@/lib/health-access"
import { buildWorkerHealthPayload } from "@/lib/health-response"

export async function GET(request: Request) {
  const ts = new Date().toISOString()
  const hasToken = requestHasHealthToken(request)

  if (!hasToken) {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, ts, error: "Unauthorized" }, { status: 401 })
    }
  }

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from("gob_workers")
      .select("worker_id,started_at,last_seen_at,hostname,pid,version")
      .order("last_seen_at", { ascending: false })
      .limit(20)

    if (error) {
      return NextResponse.json(
        { ok: false, ts, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json(buildWorkerHealthPayload({ ts, hasToken, rows: data ?? [] }))
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, ts, error: err?.message ?? String(err) },
      { status: 500 }
    )
  }
}
