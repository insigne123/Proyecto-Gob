import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ alertId: string }> }
) {
  const { alertId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // RLS ensures user can see this alert
  const { error } = await supabase
    .from("gob_alerts")
    .update({ is_read: true })
    .eq("id", alertId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const referer = request.headers.get("referer")
  if (referer) return NextResponse.redirect(referer)
  return NextResponse.json({ ok: true })
}
