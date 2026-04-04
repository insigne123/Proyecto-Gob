import Link from "next/link"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { AuditDashboard } from "@/components/ops/audit-dashboard"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getAccessibleWorkspaceIdsForUser } from "@/lib/workspaces/access"
import { ArrowLeft } from "lucide-react"

export default async function AuditPage() {
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

  const { data: logs } = await supabase
    .from("gob_audit_logs")
    .select("id,timestamp,user_id,action,target_resource,details")
    .order("timestamp", { ascending: false })
    .limit(500)

  const rows = (logs || [])
    .map((log: any) => {
      const details = log.details && typeof log.details === "object" && !Array.isArray(log.details) ? log.details : {}
      const workspaceId = details?.workspace_id ? String(details.workspace_id) : null
      return {
        ...log,
        workspace_id: workspaceId,
        workspace_title: workspaceId ? workspaceTitleById.get(workspaceId) || null : null,
        details,
      }
    })
    .filter((log: any) => {
      if (log.workspace_id && workspaceIds.includes(log.workspace_id)) return true
      return log.user_id === user.id
    })

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
          <CardTitle className="text-base">Auditoria accesible</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditDashboard logs={rows as any} />
        </CardContent>
      </Card>
    </div>
  )
}
