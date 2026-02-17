import Link from "next/link"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft } from "lucide-react"

export default async function AlertsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const { data: alerts } = await supabase
    .from("gob_alerts")
    .select("id,created_at,workspace_id,message,severity,is_read,metadata")
    .order("created_at", { ascending: false })
    .limit(200)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6">
        <Link
          href="/workspaces"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Link>
      </div>

      <Card className="bg-card/70">
        <CardHeader>
          <CardTitle className="text-base">Alertas</CardTitle>
        </CardHeader>
        <CardContent>
          {alerts?.length ? (
            <div className="space-y-2">
              {alerts.map((a) => (
                <div
                  key={a.id}
                  className="rounded-xl border border-border/55 bg-background/25 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">{a.message}</div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{a.severity}</Badge>
                      <Badge
                        variant="outline"
                        className={a.is_read ? "opacity-60" : "border-emerald-500/25 text-emerald-200"}
                      >
                        {a.is_read ? "Leida" : "Nueva"}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {a.created_at ? new Date(a.created_at).toLocaleString("es-CL") : ""}
                    {a.workspace_id ? ` - ws ${String(a.workspace_id).slice(0, 8)}...` : ""}
                  </div>
                  {a.metadata ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {JSON.stringify(a.metadata)}
                    </div>
                  ) : null}
                  {!a.is_read ? (
                    <div className="mt-2">
                      <form action={`/api/alerts/${a.id}/read`} method="post">
                        <button className="text-xs text-emerald-200 hover:text-foreground" type="submit">
                          Marcar como leida
                        </button>
                      </form>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Sin alertas.</div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
