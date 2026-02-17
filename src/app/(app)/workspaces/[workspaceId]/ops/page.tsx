import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Activity } from "lucide-react"

function ageSeconds(iso: string | null) {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.floor((Date.now() - t) / 1000)
}

function statusBadgeClass(status: string) {
  if (status === "completed") return "opacity-70"
  if (status === "running") return "border-amber-500/25 text-amber-200"
  if (status === "failed") return "border-destructive/40 text-destructive"
  return "border-emerald-500/25 text-emerald-200"
}

export default async function WorkspaceOpsPage({
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

  const { data: jobs } = await supabase.rpc("gob_list_jobs_for_workspace", {
    p_workspace_id: workspaceId,
    p_limit: 120,
  })

  const { data: workers } = await supabase
    .from("gob_workers")
    .select("worker_id,started_at,last_seen_at,hostname,pid,version")
    .order("last_seen_at", { ascending: false })
    .limit(10)

  const list = Array.isArray(jobs) ? (jobs as any[]) : []
  const counts = list.reduce(
    (acc, j) => {
      const s = String(j.status || "")
      acc.total++
      if (s === "pending") acc.pending++
      else if (s === "running") acc.running++
      else if (s === "failed") acc.failed++
      else if (s === "completed") acc.completed++
      return acc
    },
    { total: 0, pending: 0, running: 0, failed: 0, completed: 0 }
  )

  const workerList = Array.isArray(workers) ? (workers as any[]) : []
  const freshWorkers = workerList.filter((w) => {
    const a = ageSeconds(w.last_seen_at || null)
    return typeof a === "number" && a <= 90
  }).length

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6">
        <Link
          href={`/workspaces/${workspaceId}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al cuaderno
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="bg-card/70 lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Worker</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Activos (&lt;=90s)</span>
              <Badge variant="outline" className={freshWorkers ? "border-emerald-500/25 text-emerald-200" : "border-destructive/40 text-destructive"}>
                {freshWorkers}
              </Badge>
            </div>

            {workerList.length ? (
              <div className="space-y-2">
                {workerList.slice(0, 6).map((w) => {
                  const a = ageSeconds(w.last_seen_at || null)
                  return (
                    <div
                      key={w.worker_id}
                      className="rounded-xl border border-border/55 bg-background/25 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate font-code text-xs">{String(w.worker_id)}</div>
                        <div className="text-xs text-muted-foreground">
                          {typeof a === "number" ? `${a}s` : "-"}
                        </div>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {w.hostname ? `${w.hostname}` : ""}
                        {w.pid ? ` · pid ${w.pid}` : ""}
                        {w.version ? ` · ${w.version}` : ""}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Sin heartbeats aun.</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/70 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Jobs ({workspace.title})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">Total: {counts.total}</Badge>
              <Badge variant="outline" className="border-emerald-500/25 text-emerald-200">
                Pendientes: {counts.pending}
              </Badge>
              <Badge variant="outline" className="border-amber-500/25 text-amber-200">
                En ejecucion: {counts.running}
              </Badge>
              <Badge variant="outline" className="opacity-70">
                Completados: {counts.completed}
              </Badge>
              <Badge variant="outline" className="border-destructive/40 text-destructive">
                Fallidos: {counts.failed}
              </Badge>
            </div>

            {list.length ? (
              <div className="overflow-x-auto rounded-xl border border-border/55">
                <table className="w-full text-left text-sm">
                  <thead className="bg-background/35 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Estado</th>
                      <th className="px-3 py-2">Tipo</th>
                      <th className="px-3 py-2">Creado</th>
                      <th className="px-3 py-2">Intentos</th>
                      <th className="px-3 py-2">Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.slice(0, 80).map((j) => (
                      <tr key={j.id} className="border-t border-border/55 align-top">
                        <td className="px-3 py-2">
                          <Badge
                            variant="outline"
                            className={statusBadgeClass(String(j.status || ""))}
                          >
                            {String(j.status || "-")}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 font-medium">{String(j.type || "-")}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {j.created_at ? new Date(j.created_at).toLocaleString("es-CL") : ""}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {Number(j.attempts ?? 0)}/{Number(j.max_attempts ?? 0)}
                        </td>
                        <td className="px-3 py-2">
                          {j.last_error ? (
                            <div className="max-w-[520px] whitespace-pre-wrap text-xs text-destructive">
                              {String(j.last_error)}
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground">
                              <Activity className="mr-1 inline h-3.5 w-3.5 opacity-70" />
                              {j.available_at ? `Disponible: ${new Date(j.available_at).toLocaleString("es-CL")}` : ""}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Sin jobs para este expediente.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
