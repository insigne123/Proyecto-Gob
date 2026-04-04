import { NextResponse } from "next/server"

import { loadOnboardingArtifactVersions, loadPersistedOnboardingArtifacts } from "@/lib/onboarding/artifacts"
import { createClient } from "@/lib/supabase/server"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: member } = await supabase
    .from("gob_workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const [latest, versions] = await Promise.all([
    loadPersistedOnboardingArtifacts({ supabase, workspaceId }).catch(() => null),
    loadOnboardingArtifactVersions({ supabase, workspaceId, limit: 12 }).catch(() => []),
  ])

  return NextResponse.json({
    latest,
    versions,
  })
}
