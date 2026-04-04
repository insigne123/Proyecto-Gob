import crypto from "crypto"
import { NextResponse } from "next/server"
import { google } from "googleapis"

import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const next = new URL(request.url).searchParams.get("next") || "/workspaces"
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const url = new URL("/login", request.url)
    url.searchParams.set("next", next)
    return NextResponse.redirect(url)
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    const back = new URL(next, request.url)
    back.searchParams.set("oauth_error", "google_app_not_configured")
    return NextResponse.redirect(back)
  }

  const origin = new URL(request.url).origin
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || `${origin}/api/oauth/google/callback`

  const state = crypto.randomBytes(24).toString("base64url")
  const now = new Date().toISOString()

  await supabase.from("gob_oauth_states").insert({
    provider: "google",
    user_id: user.id,
    state,
    redirect_to: next,
    created_at: now,
  })

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri)
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/drive.readonly"],
    state,
  })

  return NextResponse.redirect(url)
}
