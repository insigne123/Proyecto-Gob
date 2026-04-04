import Link from "next/link"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertsDashboard } from "@/components/ops/alerts-dashboard"
import { getAccessibleWorkspaceIdsForUser } from "@/lib/workspaces/access"
import { ArrowLeft } from "lucide-react"

export default async function AlertsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const workspaceIdsResult = await getAccessibleWorkspaceIdsForUser({ supabase, userId: user.id }).catch(
    () => null
  )
  const workspaceIds = Array.isArray(workspaceIdsResult) ? workspaceIdsResult : []

  const { data: workspaces } = workspaceIds.length
    ? await supabase.from("gob_workspaces").select("id,title").in("id", workspaceIds)
    : { data: [] as any[] }
  const workspaceTitleById = new Map((workspaces || []).map((workspace: any) => [String(workspace.id), String(workspace.title || "Proyecto")]))

  const { data: alerts } = await supabase
    .from("gob_alerts")
    .select("id,created_at,workspace_id,message,severity,is_read,metadata")
    .in("workspace_id", workspaceIds.length ? workspaceIds : ["00000000-0000-0000-0000-000000000000"])
    .order("created_at", { ascending: false })
    .limit(300)

  const rows = (alerts || []).map((alert: any) => ({
    ...alert,
    workspace_title: alert.workspace_id ? workspaceTitleById.get(String(alert.workspace_id)) || "Proyecto" : null,
  }))

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6">
        <Link
          href="/projects"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a proyectos
        </Link>
      </div>

      <Card className="bg-card/70">
        <CardHeader>
          <CardTitle className="text-base">Alertas accesibles</CardTitle>
        </CardHeader>
        <CardContent>
          <AlertsDashboard alerts={rows as any} />
        </CardContent>
      </Card>
    </div>
  )
}
