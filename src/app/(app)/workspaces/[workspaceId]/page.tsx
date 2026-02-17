import { notFound, redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { NotebookShell } from "@/components/notebook/notebook-shell"

export default async function WorkspaceNotebookPage({
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
    .select("id,title,description,status")
    .eq("id", workspaceId)
    .maybeSingle()

  if (!workspace) notFound()

  return (
    <NotebookShell
      workspace={{
        id: workspace.id,
        title: workspace.title,
        description: workspace.description,
        status: workspace.status,
      }}
    />
  )
}
