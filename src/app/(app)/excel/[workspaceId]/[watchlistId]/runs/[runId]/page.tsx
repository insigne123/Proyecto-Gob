import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft } from "lucide-react"

type DiffPayload = {
  added?: Array<{ key: string; row: Record<string, any> }>
  removed?: Array<{ key: string; row: Record<string, any> }>
  modified?: Array<{
    key: string
    changes: Record<string, { before: any; after: any }>
    row: Record<string, any>
  }>
  tribunal_updates?: Array<{
    key: string
    tribunal: string
    rol: string
    previousEstado: string | null
    currentEstado: string | null
    previousMovimiento: string | null
    currentMovimiento: string | null
    hasCasacion: boolean
    recursoTipo: string | null
    linkCausa: string | null
  }>
  tribunal_errors?: Array<{ key: string; rol: string; error: string }>
}

function previewEntries(row: Record<string, any>, limit = 6) {
  return Object.entries(row || {})
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .slice(0, limit)
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-"
  if (typeof value === "object") {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

async function downloadJsonFromStorage(path: string) {
  const admin = createAdminClient()
  const { data, error } = await admin.storage.from("gob_excel").download(path)
  if (error) throw new Error(error.message)
  const ab = await (data as Blob).arrayBuffer()
  const buf = Buffer.from(ab)
  return JSON.parse(buf.toString("utf8"))
}

export default async function ExcelWatchlistRunPage({
  params,
}: {
  params: Promise<{ workspaceId: string; watchlistId: string; runId: string }>
}) {
  const { workspaceId, watchlistId, runId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const { data: watch } = await supabase
    .from("gob_excel_watchlists")
    .select("id,workspace_id,provider,file_name,file_id")
    .eq("id", watchlistId)
    .eq("workspace_id", workspaceId)
    .maybeSingle()
  if (!watch) notFound()

  const { data: run } = await supabase
    .from("gob_excel_runs")
    .select(
      "id,created_at,kind,summary,etag,modified_time,diff_storage_path,snapshot_storage_path,error"
    )
    .eq("id", runId)
    .eq("watchlist_id", watchlistId)
    .maybeSingle()
  if (!run) notFound()

  let diff: DiffPayload | null = null
  let diffError: string | null = null

  if (run.diff_storage_path) {
    try {
      diff = (await downloadJsonFromStorage(run.diff_storage_path)) as DiffPayload
    } catch (e: any) {
      diffError = e?.message ?? "No se pudo descargar el diff"
    }
  }

  const added = diff?.added ?? []
  const removed = diff?.removed ?? []
  const modified = diff?.modified ?? []
  const tribunalMonitoring =
    run.summary && typeof run.summary === "object" && !Array.isArray(run.summary)
      ? (run.summary as any).tribunal_monitoring
      : null
  const tribunalUpdates = Array.isArray(tribunalMonitoring?.updates)
    ? tribunalMonitoring.updates
    : Array.isArray(diff?.tribunal_updates)
      ? diff.tribunal_updates
      : []
  const tribunalErrors = Array.isArray(tribunalMonitoring?.errors_preview)
    ? tribunalMonitoring.errors_preview
    : Array.isArray(diff?.tribunal_errors)
      ? diff.tribunal_errors
      : []

  const modifiedCells = modified
    .flatMap((m) =>
      Object.entries(m.changes || {}).map(([col, v]) => ({
        key: m.key,
        col,
        before: v?.before ?? null,
        after: v?.after ?? null,
      }))
    )
    .slice(0, 120)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6">
        <Link
          href={`/excel/${workspaceId}/${watchlistId}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al monitor
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="bg-card/70 lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Revision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Archivo</span>
              <Badge variant="outline">{watch.provider}</Badge>
            </div>
            <div className="font-medium">{watch.file_name || watch.file_id}</div>
            <div className="text-xs text-muted-foreground">
              {run.created_at ? new Date(run.created_at).toLocaleString("es-CL") : ""}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{run.kind}</Badge>
              {run.etag ? <span className="text-xs text-muted-foreground">etag</span> : null}
            </div>
            {run.error ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {run.error}
              </div>
            ) : null}
            {diffError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {diffError}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="bg-card/70 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Resumen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">Agregadas: {added.length}</Badge>
              <Badge variant="outline">Eliminadas: {removed.length}</Badge>
              <Badge variant="outline">Modificadas: {modified.length}</Badge>
            </div>
            <div className="rounded-xl border border-border/55 bg-background/25 p-3 text-xs text-muted-foreground">
              {run.summary && typeof run.summary === "object" && !Array.isArray(run.summary) ? (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(run.summary as Record<string, unknown>)
                    .filter(([, value]) => value !== null && value !== undefined && value !== "")
                    .slice(0, 12)
                    .map(([key, value]) => (
                      <span key={key} className="rounded-full border border-border/50 bg-background/35 px-2.5 py-1">
                        {key}: {formatValue(value)}
                      </span>
                    ))}
                </div>
              ) : (
                <span>{run.summary ? formatValue(run.summary) : "Sin resumen estructurado"}</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/70 lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Cambios (celdas)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {run.kind !== "changed" ? (
              <div className="text-sm text-muted-foreground">Sin cambios.</div>
            ) : modifiedCells.length ? (
              <div className="overflow-x-auto rounded-xl border border-border/55">
                <table className="w-full text-left text-sm">
                  <thead className="bg-background/35 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Clave</th>
                      <th className="px-3 py-2">Columna</th>
                      <th className="px-3 py-2">Antes</th>
                      <th className="px-3 py-2">Despues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modifiedCells.map((c, idx) => (
                      <tr key={idx} className="border-t border-border/55">
                        <td className="px-3 py-2 font-code text-xs">{c.key}</td>
                        <td className="px-3 py-2">{c.col}</td>
                        <td className="px-3 py-2 text-muted-foreground">{String(c.before ?? "")}</td>
                        <td className="px-3 py-2">{String(c.after ?? "")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                No se encontro diff detallado para esta revision.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/70 lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Actividad Tribunal (1TA)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">Rows 1TA: {Number(tribunalMonitoring?.one_ta_rows || 0)}</Badge>
              <Badge variant="outline">Consultadas: {Number(tribunalMonitoring?.looked_up || 0)}</Badge>
              <Badge variant="outline">Actualizadas: {tribunalUpdates.length}</Badge>
              <Badge variant="outline">Errores: {tribunalErrors.length}</Badge>
            </div>

            {tribunalUpdates.length ? (
              <div className="overflow-x-auto rounded-xl border border-border/55">
                <table className="w-full text-left text-sm">
                  <thead className="bg-background/35 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Rol</th>
                      <th className="px-3 py-2">Estado</th>
                      <th className="px-3 py-2">Movimiento</th>
                      <th className="px-3 py-2">Casacion</th>
                      <th className="px-3 py-2">Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tribunalUpdates.slice(0, 120).map((row: any, idx: number) => (
                      <tr key={idx} className="border-t border-border/55">
                        <td className="px-3 py-2 font-code text-xs">{String(row?.rol || "")}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {String(row?.previousEstado || "(sin dato)")} {"->"} {String(row?.currentEstado || "(sin dato)")}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {String(row?.previousMovimiento || "(sin dato)")} {"->"} {String(row?.currentMovimiento || "(sin dato)")}
                        </td>
                        <td className="px-3 py-2">
                          {row?.hasCasacion
                            ? `Casacion${row?.recursoTipo ? ` (${String(row.recursoTipo)})` : ""}`
                            : "Sin casacion"}
                        </td>
                        <td className="px-3 py-2">
                          {row?.linkCausa ? (
                            <a
                              href={String(row.linkCausa)}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-blue-400 hover:underline"
                            >
                              abrir
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Sin cambios de actividad tribunal en esta corrida.</div>
            )}

            {tribunalErrors.length ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {tribunalErrors.slice(0, 6).map((item: any, idx: number) => (
                  <div key={idx}>
                    {String(item?.rol || "(sin rol)")}: {String(item?.error || "error")}
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {(added.length > 0 || removed.length > 0) && (
          <Card className="bg-card/70 lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base">Altas y bajas (filas)</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              <div>
                <div className="mb-2 text-sm font-medium">Agregadas</div>
                <div className="space-y-2">
                  {added.slice(0, 25).map((a, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-border/55 bg-background/25 px-3 py-2"
                    >
                      <div className="font-code text-xs">{a.key}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                        {previewEntries(a.row).map(([key, value]) => (
                          <span key={`${a.key}_${key}`} className="rounded-full border border-border/50 bg-background/35 px-2 py-1">
                            {key}: {formatValue(value)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {!added.length ? <div className="text-sm text-muted-foreground">Sin filas nuevas.</div> : null}
                </div>
              </div>
              <div>
                <div className="mb-2 text-sm font-medium">Eliminadas</div>
                <div className="space-y-2">
                  {removed.slice(0, 25).map((a, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-border/55 bg-background/25 px-3 py-2"
                    >
                      <div className="font-code text-xs">{a.key}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                        {previewEntries(a.row).map(([key, value]) => (
                          <span key={`${a.key}_${key}`} className="rounded-full border border-border/50 bg-background/35 px-2 py-1">
                            {key}: {formatValue(value)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {!removed.length ? (
                    <div className="text-sm text-muted-foreground">Sin filas eliminadas.</div>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
