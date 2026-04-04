import { createClient } from "@supabase/supabase-js"

export function createAdminClient() {
  const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
  if (!url || !serviceKey) {
    throw new Error(
      "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY"
    )
  }

  try {
    // Validate early to avoid noisy runtime fetch errors.
    // eslint-disable-next-line no-new
    new URL(url)
  } catch {
    throw new Error("Invalid SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) format")
  }

  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
