import { NextResponse } from "next/server"

import { envHealth, validateWebEnv } from "@/lib/env"

export async function GET() {
  const ts = new Date().toISOString()
  try {
    validateWebEnv()
    return NextResponse.json({ ok: true, ts, env: envHealth() })
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        ts,
        env: envHealth(),
        error: err?.message ?? String(err),
      },
      { status: 500 }
    )
  }
}
