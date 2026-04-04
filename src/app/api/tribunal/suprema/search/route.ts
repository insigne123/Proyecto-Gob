import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { searchSupremaByRol } from "@/lib/suprema/connector"

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(request.url)
  const rol = String(url.searchParams.get("rol") || "").trim()
  const tribunal = String(url.searchParams.get("tribunal") || "1TA").trim() || "1TA"

  if (!rol) {
    return NextResponse.json({ error: "Missing rol" }, { status: 400 })
  }

  const data = await searchSupremaByRol({ rol, tribunal })
  return NextResponse.json(data)
}
