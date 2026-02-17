import { NextResponse } from "next/server"
import { google } from "googleapis"

import { createClient } from "@/lib/supabase/server"
import { encryptJson } from "@/lib/crypto"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")

  if (!code || !state) {
    return NextResponse.json({ error: "Missing code/state" }, { status: 400 })
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET" },
      { status: 500 }
    )
  }

  const origin = url.origin
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || `${origin}/api/oauth/google/callback`

  const supabase = await createClient()

  const { data: oauthState } = await supabase
    .from("gob_oauth_states")
    .select("id,user_id,redirect_to")
    .eq("provider", "google")
    .eq("state", state)
    .maybeSingle()

  if (!oauthState) {
    return NextResponse.json({ error: "Invalid state" }, { status: 400 })
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri)
  const { tokens } = await oauth2Client.getToken(code)
  const tokensEnc = encryptJson(tokens)
  const now = new Date().toISOString()

  const { error: upErr } = await supabase
    .from("gob_oauth_connections")
    .upsert(
      {
        provider: "google",
        user_id: oauthState.user_id,
        tokens_enc: tokensEnc,
        scopes: Array.isArray(tokens.scope) ? tokens.scope.join(" ") : tokens.scope ?? null,
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
