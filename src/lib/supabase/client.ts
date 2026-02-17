import { createBrowserClient } from "@supabase/ssr"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Browser client that integrates with SSR cookies (middleware/server).
export const supabase = createBrowserClient(supabaseUrl, supabaseKey)
