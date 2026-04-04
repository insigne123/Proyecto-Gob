import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { envHealth, validateWebEnv } from "@/lib/env"
import { requestHasHealthToken } from "@/lib/health-access"
import { buildWebHealthPayload } from "@/lib/health-response"

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
    validateWebEnv()
    return NextResponse.json(buildWebHealthPayload({ ts, hasToken, env: envHealth() }))
  } catch (err: any) {
    return NextResponse.json(buildWebHealthPayload({ ts, hasToken, env: envHealth(), error: err }), { status: 500 })
  }
}
