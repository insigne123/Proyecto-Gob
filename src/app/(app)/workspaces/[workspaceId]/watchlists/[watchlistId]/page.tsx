import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { WatchlistActions } from "@/components/watchlists/watchlist-actions"
import { ArrowLeft } from "lucide-react"

export default async function WatchlistPage({
  params,
}: {
  params: Promise<{ workspaceId: string; watchlistId: string }>
}) {
  const { workspaceId, watchlistId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const { data: watch } = await supabase
    .from("gob_excel_watchlists")
    .select("*")
    .eq("id", watchlistId)
    .eq("workspace_id", workspaceId)
    .maybeSingle()
  if (!watch) notFound()

  const { data: runs } = await supabase
    .from("gob_excel_runs")
    .select("id,created_at,kind,summary,etag,modified_time,error")
    .eq("watchlist_id", watchlistId)
    .order("created_at", { ascending: false })
    .limit(30)

  const { data: emails } = await supabase
    .from("gob_email_runs")
    .select("id,created_at,status,subject,error,recipients")
    .eq("watchlist_id", watchlistId)
    .order("created_at", { ascending: false })
    .limit(30)

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-6">
        <Link
          href={`/workspaces/${workspaceId}/watchlists`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a monitores
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="bg-card/70 lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Monitor Excel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Proveedor</span>
              <Badge variant="outline">{watch.provider}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Estado</span>
              <Badge variant="outline">{watch.status}</Badge>
            </div>
            <div>
              <div className="text-muted-foreground">Archivo</div>
              <div className="mt-1 font-medium">{watch.file_name || watch.file_id}</div>
              {watch.sheet_name ? (
                <div className="mt-1 text-xs text-muted-foreground">Hoja: {watch.sheet_name}</div>
              ) : null}
            </div>
            <div className="pt-1 text-xs text-muted-foreground">
              Prox revision: {watch.next_check_at ? new Date(watch.next_check_at).toLocaleString("es-CL") : "-"}
            </div>
            {watch.last_error ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {watch.last_error}
              </div>
            ) : null}

            <div className="pt-2">
              <WatchlistActions
                workspaceId={workspaceId}
                watchlistId={watchlistId}
                status={String(watch.status || "")}
                fileName={String(watch.file_name || watch.file_id || "Archivo")}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/70 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Historial de revisiones</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {runs?.length ? (
              runs.map((r) => (
                <Link
                  key={r.id}
                  href={`/workspaces/${workspaceId}/watchlists/${watchlistId}/runs/${r.id}`}
                  className="block rounded-xl border border-border/55 bg-background/25 px-3 py-2 hover:bg-background/35"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">{r.kind}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.created_at ? new Date(r.created_at).toLocaleString("es-CL") : ""}
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {r.summary ? JSON.stringify(r.summary) : ""}
                  </div>
                  {r.error ? (
                    <div className="mt-2 text-xs text-destructive">{r.error}</div>
                  ) : null}
                </Link>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">Sin revisiones aun.</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/70 lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Correos enviados</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {emails?.length ? (
              emails.map((e) => (
                <div
                  key={e.id}
                  className="rounded-xl border border-border/55 bg-background/25 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">{e.subject}</div>
                    <Badge variant="outline">{e.status}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {e.created_at ? new Date(e.created_at).toLocaleString("es-CL") : ""} - {Array.isArray(e.recipients) ? e.recipients.join(", ") : ""}
                  </div>
                  {e.error ? (
                    <div className="mt-2 text-xs text-destructive">{e.error}</div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">Sin correos aun.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
