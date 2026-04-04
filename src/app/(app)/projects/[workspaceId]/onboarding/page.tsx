import { notFound, redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

import OnboardingClient from "./onboarding-client"

export default async function ProjectOnboardingPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect(`/login?next=${encodeURIComponent(`/projects/${workspaceId}/onboarding`)}`)

  const { data: workspace } = await supabase
    .from("gob_workspaces")
    .select("id,title,description,status")
    .eq("id", workspaceId)
    .maybeSingle()

  if (!workspace) notFound()

  const { data: profile } = await supabase
    .from("gob_workspace_profiles")
    .select("workspace_id,metadata")
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  const metadata =
    profile?.metadata && typeof profile.metadata === "object" && !Array.isArray(profile.metadata)
      ? profile.metadata
      : {}
  const onboarding =
    metadata?.onboarding && typeof metadata.onboarding === "object" ? metadata.onboarding : null

  if (onboarding?.completed === true) {
    redirect(`/projects/${workspaceId}`)
  }

  return <OnboardingClient workspaceId={workspaceId} workspaceTitle={workspace.title} />
}
