import Link from "next/link"
import { redirect } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"
import { ArrowLeft, CalendarClock, Mail, RefreshCw, ServerCog, Siren, Table2 } from "lucide-react"

function formatDateTime(value: string | null) {
  if (!value) return "-"
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return value
  return new Date(parsed).toLocaleString("es-CL")
}

function formatDate(value: string | null) {
  if (!value) return "-"
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return value
  return new Date(parsed).toLocaleDateString("es-CL")
}

function formatRelativeAge(value: string | null) {
  if (!value) return "-"
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return value
  const diffSeconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000))
  if (diffSeconds < 60) return `${diffSeconds}s`
  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes} min`
  const diffHours = Math.floor(diffMinutes / 60)
  return `${diffHours} h`
}

function tribunalStatus(run: any | null) {
  if (!run) {
    return {
      label: "Sin corridas",
      className: "border-border/50 text-muted-foreground",
    }
  }

  const status = String(run.status || "")
  const entries = Number(run.entry_count || 0)
  if (status === "ok" && entries > 0) {
    return {
      label: `OK · ${entries} entrada(s)`,
      className: "border-emerald-500/25 text-emerald-200",
    }
  }
  if (status === "ok") {
    return {
      label: "OK · sin novedades",
      className: "border-sky-500/25 text-sky-200",
    }
  }
  return {
    label: status || "error",
    className: "border-destructive/40 text-destructive",
  }
}

function shortText(value: string | null, max = 120) {
  const clean = String(value || "").replace(/\s+/g, " ").trim()
  if (!clean) return "-"
  return clean.length > max ? `${clean.slice(0, max)}...` : clean
}

export default async function EstadoDiarioPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const [{ data: runs }, { data: changes }, { data: updates }, { data: emailRuns }, { data: workers }, { data: nextJobs }] = await Promise.all([
    supabase
      .from("gob_estado_diario_runs")
      .select("id,tribunal,daily_date,status,is_signed,entry_count,error,fetched_at,metadata")
      .order("fetched_at", { ascending: false })
      .limit(60),
    supabase
      .from("gob_estado_diario_changes")
      .select(
        "id,tribunal,daily_date,rol,caratula,change_kind,providencias_before,providencias_after,created_at"
      )
      .order("created_at", { ascending: false })
      .limit(80),
    supabase
      .from("gob_tribunal_cause_updates")
      .select(
        "id,tribunal,rol,source_date,previous_estado,current_estado,previous_movimiento,current_movimiento,has_casacion,recurso_tipo,created_at,metadata"
      )
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("gob_estado_diario_email_runs")
      .select("id,daily_date,subject,status,error,recipients,created_at")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("gob_workers")
      .select("worker_id,last_seen_at,hostname,pid,version")
      .order("last_seen_at", { ascending: false })
      .limit(5),
    supabase
      .from("gob_jobs")
      .select("id,available_at,payload")
      .eq("type", "estado_diario_poll")
      .eq("status", "pending")
      .order("available_at", { ascending: true })
      .limit(10),
  ])

  const latestDailyDate = (runs || []).length ? String(runs?.[0]?.daily_date || "") : ""
  const latestRuns = (runs || []).filter((row: any) => String(row.daily_date || "") === latestDailyDate)
  const latestChanges = (changes || []).filter((row: any) => String(row.daily_date || "") === latestDailyDate)
  const latestEmails = (emailRuns || []).filter((row: any) => String(row.daily_date || "") === latestDailyDate)
  const okRuns = latestRuns.filter((row: any) => row.status === "ok").length
  const errorRuns = latestRuns.filter((row: any) => row.status === "error").length
  const latestWorker = (workers || [])[0] || null
  const freshWorkers = (workers || []).filter((row: any) => {
    const parsed = Date.parse(String(row.last_seen_at || ""))
    return Number.isFinite(parsed) && Date.now() - parsed <= 3 * 60 * 1000
  }).length
  const latestRunByTribunal = {
    "1TA": (runs || []).find((row: any) => String(row.tribunal || "") === "1TA") || null,
    "2TA": (runs || []).find((row: any) => String(row.tribunal || "") === "2TA") || null,
  }
  const nextJobByTribunal = {
    "1TA": (nextJobs || []).find((row: any) => String(row.payload?.tribunal || "") === "1TA") || null,
    "2TA": (nextJobs || []).find((row: any) => String(row.payload?.tribunal || "") === "2TA") || null,
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/workspaces"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver a modulos
          </Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Estado Diario</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Seguimiento operativo de corridas 1TA/2TA, cambios detectados y envios de digest.
          </p>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/50 px-4 py-3 text-right text-sm text-muted-foreground">
          <div className="font-medium text-foreground">Fecha de referencia</div>
          <div>{latestDailyDate ? formatDate(latestDailyDate) : "Sin corridas"}</div>
        </div>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Card className="bg-card/70">
          <CardContent className="flex items-center gap-3 pt-5">
            <CalendarClock className="h-5 w-5 text-emerald-300" />
            <div>
              <div className="text-[11px] text-muted-foreground">Corridas del dia</div>
              <div className="text-xl font-semibold">{latestRuns.length}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/70">
          <CardContent className="flex items-center gap-3 pt-5">
            <RefreshCw className="h-5 w-5 text-sky-300" />
            <div>
              <div className="text-[11px] text-muted-foreground">Corridas OK</div>
              <div className="text-xl font-semibold">{okRuns}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/70">
          <CardContent className="flex items-center gap-3 pt-5">
            <Siren className="h-5 w-5 text-amber-300" />
            <div>
              <div className="text-[11px] text-muted-foreground">Errores del dia</div>
              <div className="text-xl font-semibold">{errorRuns}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/70">
          <CardContent className="flex items-center gap-3 pt-5">
            <Table2 className="h-5 w-5 text-violet-300" />
            <div>
              <div className="text-[11px] text-muted-foreground">Cambios detectados</div>
              <div className="text-xl font-semibold">{latestChanges.length}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/70">
          <CardContent className="flex items-center gap-3 pt-5">
            <Mail className="h-5 w-5 text-rose-300" />
            <div>
              <div className="text-[11px] text-muted-foreground">Digests del dia</div>
              <div className="text-xl font-semibold">{latestEmails.length}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mb-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
        {(["1TA", "2TA"] as const).map((tribunal) => {
          const latestRun = latestRunByTribunal[tribunal]
          const status = tribunalStatus(latestRun)
          const nextJob = nextJobByTribunal[tribunal]
          return (
            <Card key={tribunal} className="bg-card/70">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span>{tribunal}</span>
                  <Badge variant="outline" className={status.className}>
                    {status.label}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <div>
                  Ultima corrida: <span className="text-foreground">{latestRun ? formatDateTime(latestRun.fetched_at) : "Sin corridas"}</span>
                </div>
                <div>
                  Fecha diaria: <span className="text-foreground">{latestRun ? formatDate(latestRun.daily_date) : "-"}</span>
                </div>
                <div>
                  Proxima programada: <span className="text-foreground">{nextJob ? formatDateTime(nextJob.available_at) : "Sin job pendiente"}</span>
                </div>
                <div>
                  Slot: <span className="text-foreground">{String(latestRun?.metadata?.slot || nextJob?.payload?.slot || "-")}</span>
                </div>
              </CardContent>
            </Card>
          )
        })}

        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ServerCog className="h-4 w-4 text-cyan-300" />
              Worker y cola
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <div>
              Workers frescos: <span className="text-foreground">{freshWorkers}</span>
            </div>
            <div>
              Ultimo heartbeat: <span className="text-foreground">{latestWorker ? formatDateTime(latestWorker.last_seen_at) : "Sin worker"}</span>
            </div>
            <div>
              Antiguedad: <span className="text-foreground">{latestWorker ? formatRelativeAge(latestWorker.last_seen_at) : "-"}</span>
            </div>
            <div>
              Proceso: <span className="text-foreground">{latestWorker?.hostname || "-"}{latestWorker?.pid ? ` · PID ${latestWorker.pid}` : ""}</span>
            </div>
            <div>
              Siguiente cola: <span className="text-foreground">{(nextJobs || []).length ? formatDateTime(nextJobs?.[0]?.available_at || null) : "Sin jobs pendientes"}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="text-base">Corridas recientes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(runs || []).length ? (
              <div className="overflow-x-auto rounded-xl border border-border/60">
                <table className="w-full text-left text-sm">
                  <thead className="bg-background/35 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Tribunal</th>
                      <th className="px-3 py-2">Fecha</th>
                      <th className="px-3 py-2">Estado</th>
                      <th className="px-3 py-2">Entradas</th>
                      <th className="px-3 py-2">Firmado</th>
                      <th className="px-3 py-2">Slot</th>
                      <th className="px-3 py-2">Ejecucion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(runs || []).map((run: any) => (
                      <tr key={run.id} className="border-t border-border/60 align-top">
                        <td className="px-3 py-2 font-medium">{run.tribunal}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(run.daily_date)}</td>
                        <td className="px-3 py-2">
                          <Badge
                            variant="outline"
                            className={
                              run.status === "ok"
                                ? "border-emerald-500/25 text-emerald-200"
                                : "border-destructive/40 text-destructive"
                            }
                          >
                            {run.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{Number(run.entry_count || 0)}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {typeof run.is_signed === "boolean" ? (run.is_signed ? "Si" : "No") : "-"}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {String(run.metadata?.slot || "-")}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          <div>{formatDateTime(run.fetched_at)}</div>
                          {run.error ? <div className="mt-1 text-destructive">{String(run.error)}</div> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Aun no hay corridas registradas.</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="text-base">Cambios detectados</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(changes || []).length ? (
              (changes || []).slice(0, 12).map((change: any) => (
                <div key={change.id} className="rounded-xl border border-border/60 bg-background/25 px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">{change.rol}</div>
                      <div className="text-xs text-muted-foreground">{change.caratula || "Sin caratula"}</div>
                    </div>
                    <Badge variant="outline">{change.change_kind}</Badge>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {change.tribunal} · {formatDate(change.daily_date)}
                    {typeof change.providencias_before === "number" || typeof change.providencias_after === "number"
                      ? ` · ${String(change.providencias_before ?? "-")} -> ${String(change.providencias_after ?? "-")}`
                      : ""}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">Sin cambios detectados por ahora.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="text-base">Actualizaciones de causas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(updates || []).length ? (
              (updates || []).slice(0, 12).map((update: any) => (
                <div key={update.id} className="rounded-xl border border-border/60 bg-background/25 px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">{update.rol}</div>
                      <div className="text-xs text-muted-foreground">
                        {update.tribunal} · {formatDate(update.source_date)}
                      </div>
                    </div>
                    {update.has_casacion ? (
                      <Badge variant="outline" className="border-amber-500/35 text-amber-100">
                        {update.recurso_tipo || "Casacion"}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Estado: {update.previous_estado || "-"} {"->"} {update.current_estado || "-"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Movimiento: {update.previous_movimiento || "-"} {"->"} {update.current_movimiento || "-"}
                  </div>
                  {Array.isArray(update.metadata?.inserted_documents) && update.metadata.inserted_documents.length ? (
                    <div className="mt-2 rounded-lg border border-border/50 bg-background/30 p-2">
                      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Documentos agregados
                      </div>
                      <div className="space-y-1.5">
                        {update.metadata.inserted_documents.slice(0, 4).map((doc: any, idx: number) => (
                          <div key={`${update.id}_doc_${idx}`} className="text-xs text-muted-foreground">
                            <span className="text-foreground">{shortText(String(doc?.name || doc?.documentType || "Documento"), 90)}</span>
                            {doc?.role ? ` · ${String(doc.role)}` : ""}
                            {doc?.date ? ` · ${formatDate(String(doc.date))}` : ""}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">Sin actualizaciones de causas.</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="text-base">Digests enviados</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(emailRuns || []).length ? (
              (emailRuns || []).map((email: any) => (
                <div key={email.id} className="rounded-xl border border-border/60 bg-background/25 px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">{email.subject}</div>
                      <div className="text-xs text-muted-foreground">{formatDateTime(email.created_at)}</div>
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        email.status === "sent"
                          ? "border-emerald-500/25 text-emerald-200"
                          : email.status === "skipped"
                            ? "opacity-70"
                            : "border-destructive/40 text-destructive"
                      }
                    >
                      {email.status}
                    </Badge>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {Array.isArray(email.recipients) && email.recipients.length
                      ? email.recipients.join(", ")
                      : "Sin destinatarios"}
                  </div>
                  {email.error ? <div className="mt-2 text-xs text-destructive">{String(email.error)}</div> : null}
                </div>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">Sin digests registrados.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
