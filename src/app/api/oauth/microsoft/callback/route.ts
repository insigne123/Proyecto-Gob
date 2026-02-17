import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { encryptJson } from "@/lib/crypto"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const error = url.searchParams.get("error")

  if (error) {
    return NextResponse.json(
      {
        error: "OAuth error",
        details: url.searchParams.get("error_description") || error,
      },
      { status: 400 }
    )
  }

  if (!code || !state) {
    return NextResponse.json({ error: "Missing code/state" }, { status: 400 })
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Missing MICROSOFT_CLIENT_ID/MICROSOFT_CLIENT_SECRET" },
      { status: 500 }
    )
  }

  const origin = url.origin
  const redirectUri =
    process.env.MICROSOFT_REDIRECT_URI || `${origin}/api/oauth/microsoft/callback`

  const supabase = await createClient()
  const { data: oauthState } = await supabase
    .from("gob_oauth_states")
    .select("id,user_id,redirect_to")
    .eq("provider", "microsoft")
    .eq("state", state)
    .maybeSingle()

  if (!oauthState) {
    return NextResponse.json({ error: "Invalid state" }, { status: 400 })
  }

  const tokenUrl = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
  const body = new URLSearchParams()
  body.set("client_id", clientId)
  body.set("client_secret", clientSecret)
  body.set("grant_type", "authorization_code")
  body.set("code", code)
  body.set("redirect_uri", redirectUri)
  body.set("scope", ["offline_access", "User.Read", "Files.Read"].join(" "))

  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  })
  const tokens = await tokenRes.json().catch(() => null)
  if (!tokenRes.ok) {
    return NextResponse.json(
      { error: "Token exchange failed", details: tokens },
      { status: 400 }
    )
  }

  const tokensEnc = encryptJson(tokens)
  const now = new Date().toISOString()

  const { error: upErr } = await supabase
    .from("gob_oauth_connections")
    .upsert(
      {
        provider: "microsoft",
        user_id: oauthState.user_id,
        tokens_enc: tokensEnc,
        scopes: typeof tokens?.scope === "string" ? tokens.scope : null,
        updated_at: now,
        created_at: now,
      },
      { onConflict: "user_id,provider" }
    )

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  await supabase.from("gob_oauth_states").delete().eq("id", oauthState.id)

  const redirectTo = oauthState.redirect_to || "/workspaces"
  return NextResponse.redirect(new URL(redirectTo, origin))
}
