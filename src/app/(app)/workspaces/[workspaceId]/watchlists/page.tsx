import { notFound, redirect } from "next/navigation"

import { WatchlistsManager } from "@/components/watchlists/watchlists-manager"
import { createClient } from "@/lib/supabase/server"

export default async function WatchlistsHomePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const { data: workspace } = await supabase
    .from("gob_workspaces")
    .select("id,title")
    .eq("id", workspaceId)
    .maybeSingle()

  if (!workspace) notFound()

  return <WatchlistsManager workspaceId={workspaceId} workspaceTitle={workspace.title || "Expediente"} />
}
