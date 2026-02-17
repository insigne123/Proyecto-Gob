import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"

export async function GET() {
  const ts = new Date().toISOString()

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

    const now = Date.now()
    const workers = (data ?? []).map((w: any) => {
      const last = w.last_seen_at ? Date.parse(String(w.last_seen_at)) : 0
      const ageSeconds = last ? Math.floor((now - last) / 1000) : null
      return {
        workerId: w.worker_id,
        startedAt: w.started_at,
        lastSeenAt: w.last_seen_at,
        ageSeconds,
        hostname: w.hostname,
        pid: w.pid,
        version: w.version,
      }
    })

    const fresh = workers.filter((w) => typeof w.ageSeconds === "number" && w.ageSeconds <= 90)
      .length

    return NextResponse.json({ ok: fresh > 0, ts, fresh, workers })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, ts, error: err?.message ?? String(err) },
      { status: 500 }
    )
  }
}
