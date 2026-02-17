import crypto from "crypto"
import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const url = new URL("/login", request.url)
    url.searchParams.set("next", "/workspaces")
    return NextResponse.redirect(url)
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Missing MICROSOFT_CLIENT_ID/MICROSOFT_CLIENT_SECRET" },
      { status: 500 }
    )
  }

  const origin = new URL(request.url).origin
  const redirectUri =
    process.env.MICROSOFT_REDIRECT_URI || `${origin}/api/oauth/microsoft/callback`

  const state = crypto.randomBytes(24).toString("base64url")
  const now = new Date().toISOString()
  const next = new URL(request.url).searchParams.get("next") || "/workspaces"

  await supabase.from("gob_oauth_states").insert({
    provider: "microsoft",
    user_id: user.id,
    state,
    redirect_to: next,
    created_at: now,
  })

  const authUrl = new URL(
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
  )
  authUrl.searchParams.set("client_id", clientId)
  authUrl.searchParams.set("response_type", "code")
  authUrl.searchParams.set("redirect_uri", redirectUri)
  authUrl.searchParams.set("response_mode", "query")
  authUrl.searchParams.set(
    "scope",
    ["offline_access", "User.Read", "Files.Read"].join(" ")
  )
  authUrl.searchParams.set("state", state)
  authUrl.searchParams.set("prompt", "consent")

  return NextResponse.redirect(authUrl.toString())
}
