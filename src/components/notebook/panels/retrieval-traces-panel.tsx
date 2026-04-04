"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { Loader2, RefreshCw, Search } from "lucide-react"

type TraceRow = {
  id: string
  created_at: string | null
  stage: string | null
  provider: string | null
  query: string | null
  filters: Record<string, unknown> | null
  results: unknown
  response_id: string | null
  model: string | null
  thread_id: string | null
  message_id: string | null
  report_id: string | null
  metadata: Record<string, unknown> | null
}

function feedbackVote(meta: Record<string, unknown> | null) {
  const feedback = meta?.assistant_feedback
  if (!feedback || typeof feedback !== "object") return null
  const vote = String((feedback as any).vote || "")
  return vote === "useful" || vote === "not_useful" ? vote : null
}

function shortText(value: unknown, max = 220) {
  const text = String(value || "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function resultCount(value: unknown) {
  if (Array.isArray(value)) return value.length
  if (value && typeof value === "object") {
    for (const key of ["count", "results", "items", "chunks"]) {
      const next = (value as any)[key]
      if (typeof next === "number") return next
      if (Array.isArray(next)) return next.length
    }
  }
  return null
}

function numericMetadata(meta: Record<string, unknown> | null, key: string) {
  const raw = meta?.[key]
  const value = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(value) ? value : null
}

function prettyJson(value: unknown) {
  if (!value || typeof value !== "object") return "-"
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function RetrievalTracesPanel({ workspaceId }: { workspaceId: string }) {
  const [traces, setTraces] = useState<TraceRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [stageFilter, setStageFilter] = useState<string>("all")
  const [providerFilter, setProviderFilter] = useState<string>("all")

  const loadTraces = useCallback(async () => {
    setError(null)
    const res = await fetch(`/api/workspaces/${workspaceId}/retrieval-traces?limit=150`, {
      method: "GET",
      headers: { accept: "application/json" },
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      throw new Error(json?.error || "No se pudieron cargar las trazas")
    }
    setTraces(Array.isArray(json?.traces) ? (json.traces as TraceRow[]) : [])
  }, [workspaceId])

  async function refresh() {
    setIsRefreshing(true)
    try {
      await loadTraces()
    } catch (err: any) {
      setError(err?.message || "No se pudieron cargar las trazas")
    } finally {
      setIsRefreshing(false)
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    setIsLoading(true)
    loadTraces()
      .catch((err: any) => {
        if (!active) return
        setError(err?.message || "No se pudieron cargar las trazas")
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [loadTraces])

  const stageOptions = useMemo(
    () => Array.from(new Set(traces.map((trace) => String(trace.stage || "")).filter(Boolean))),
    [traces]
  )

  const providerOptions = useMemo(
    () => Array.from(new Set(traces.map((trace) => String(trace.provider || "")).filter(Boolean))),
    [traces]
  )

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return traces.filter((trace) => {
      if (stageFilter !== "all" && String(trace.stage || "") !== stageFilter) return false
      if (providerFilter !== "all" && String(trace.provider || "") !== providerFilter) return false
      if (!needle) return true
      const haystack = [
        trace.query,
        trace.stage,
        trace.provider,
        trace.model,
        trace.response_id,
        trace.thread_id,
        trace.message_id,
        trace.report_id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [providerFilter, search, stageFilter, traces])

  const summary = useMemo(() => {
    return filtered.reduce(
      (acc, trace) => {
        const support = typeof trace.metadata?.answer_support_strength === "string"
          ? String(trace.metadata.answer_support_strength)
          : null
        const vote = feedbackVote(trace.metadata)
        if (support === "strong") acc.strong += 1
        else if (support === "partial") acc.partial += 1
        else if (support === "weak" || support === "none") acc.weak += 1
        if (vote === "useful") acc.useful += 1
        if (vote === "not_useful") acc.notUseful += 1
        return acc
      },
      { strong: 0, partial: 0, weak: 0, useful: 0, notUseful: 0 }
    )
  }, [filtered])

  return (
    <Card className="flex h-[calc(100svh-104px)] min-h-0 flex-col overflow-hidden rounded-2xl border-border/60 bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/45">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div>
          <div className="text-sm font-semibold">Trazas de retrieval</div>
          <div className="text-[11px] text-muted-foreground">
            Inspecciona consultas, proveedores, cantidad de evidencia y tiempos del RAG.
          </div>
        </div>

        <Button variant="outline" size="sm" className="gap-2" onClick={() => refresh().catch(() => null)}>
          {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Actualizar
        </Button>
      </div>

      <div className="grid gap-2 border-b border-border/60 px-4 py-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
        <div className="relative">
          <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por consulta, modelo o ids..."
            className="pl-9"
          />
        </div>

        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Etapa" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las etapas</SelectItem>
            {stageOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={providerFilter} onValueChange={setProviderFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Proveedor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los proveedores</SelectItem>
            {providerOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="border-b border-border/60 px-4 py-2 text-xs text-muted-foreground">
        Mostrando {filtered.length} de {traces.length} trazas.
      </div>

      <div className="grid gap-3 border-b border-border/60 px-4 py-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-xl border border-border/55 bg-background/25 px-3 py-2 text-xs text-muted-foreground">
          <div>Soporte fuerte</div>
          <div className="mt-1 text-lg font-semibold text-foreground">{summary.strong}</div>
        </div>
        <div className="rounded-xl border border-border/55 bg-background/25 px-3 py-2 text-xs text-muted-foreground">
          <div>Soporte parcial</div>
          <div className="mt-1 text-lg font-semibold text-foreground">{summary.partial}</div>
        </div>
        <div className="rounded-xl border border-border/55 bg-background/25 px-3 py-2 text-xs text-muted-foreground">
          <div>Soporte debil</div>
          <div className="mt-1 text-lg font-semibold text-foreground">{summary.weak}</div>
        </div>
        <div className="rounded-xl border border-border/55 bg-background/25 px-3 py-2 text-xs text-muted-foreground">
          <div>Feedback util</div>
          <div className="mt-1 text-lg font-semibold text-foreground">{summary.useful}</div>
        </div>
        <div className="rounded-xl border border-border/55 bg-background/25 px-3 py-2 text-xs text-muted-foreground">
          <div>Feedback no util</div>
          <div className="mt-1 text-lg font-semibold text-foreground">{summary.notUseful}</div>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-4 py-4">
        <div className="space-y-3">
          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {isLoading ? (
            <div className="text-sm text-muted-foreground">Cargando trazas...</div>
          ) : filtered.length ? (
            filtered.map((trace) => {
              const results = resultCount(trace.results)
              const totalMs = numericMetadata(trace.metadata, "total_ms")
              const retrievalMs = numericMetadata(trace.metadata, "retrieval_ms")
              const generationMs = numericMetadata(trace.metadata, "generation_ms")
              const evidenceCount = numericMetadata(trace.metadata, "evidence_count")
              const retrievalDeepened = Boolean(trace.metadata?.retrieval_deepened)
              const preferredDocRoles = Array.isArray(trace.metadata?.retrieval_preferred_doc_roles)
                ? (trace.metadata?.retrieval_preferred_doc_roles as string[])
                : []
              const intentHints = Array.isArray(trace.metadata?.retrieval_intent_hints)
                ? (trace.metadata?.retrieval_intent_hints as string[])
                : []
              const supportStrength =
                typeof trace.metadata?.answer_support_strength === "string"
                  ? String(trace.metadata.answer_support_strength)
                  : null
              const feedback = feedbackVote(trace.metadata)

              return (
                <div key={trace.id} className="rounded-2xl border border-border/60 bg-background/25 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">{trace.stage || "stage"}</Badge>
                        <Badge variant="outline" className="border-emerald-500/30 text-emerald-100">
                          {trace.provider || "provider"}
                        </Badge>
                        {trace.model ? <Badge variant="outline">{trace.model}</Badge> : null}
                        {retrievalDeepened ? (
                          <Badge variant="outline" className="border-sky-500/35 text-sky-100">
                            Deep retrieval
                          </Badge>
                        ) : null}
                        {preferredDocRoles.map((role) => (
                          <Badge key={`${trace.id}_${role}`} variant="outline" className="border-emerald-500/25 text-emerald-100">
                            {role}
                          </Badge>
                        ))}
                        {supportStrength ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              supportStrength === "strong"
                                ? "border-emerald-500/25 text-emerald-100"
                                : supportStrength === "partial"
                                  ? "border-sky-500/25 text-sky-100"
                                  : "border-amber-500/35 text-amber-100"
                            )}
                          >
                            soporte {supportStrength}
                          </Badge>
                        ) : null}
                        {feedback ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              feedback === "useful"
                                ? "border-emerald-500/25 text-emerald-100"
                                : "border-amber-500/35 text-amber-100"
                            )}
                          >
                            {feedback === "useful" ? "feedback util" : "feedback no util"}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-sm font-medium text-foreground">{shortText(trace.query || "(sin query)", 360)}</div>
                    </div>

                    <div className="text-right text-[11px] text-muted-foreground">
                      {trace.created_at ? new Date(trace.created_at).toLocaleString("es-CL") : "-"}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    {typeof results === "number" ? <span>Resultados: {results}</span> : null}
                    {typeof evidenceCount === "number" ? <span>Evidencia: {evidenceCount}</span> : null}
                    {typeof retrievalMs === "number" ? <span>Retrieval: {retrievalMs} ms</span> : null}
                    {typeof generationMs === "number" ? <span>Generacion: {generationMs} ms</span> : null}
                    {typeof totalMs === "number" ? <span>Total: {totalMs} ms</span> : null}
                  </div>

                  {intentHints.length ? (
                    <div className="mt-3 rounded-xl border border-border/50 bg-background/35 p-3">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Hints de retrieval
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {intentHints.map((hint, idx) => (
                          <span key={`${trace.id}_hint_${idx}`} className="rounded-full border border-border/50 bg-background/30 px-2.5 py-1">
                            {hint}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <div className="rounded-xl border border-border/50 bg-background/35 p-3">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Contexto
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <div>ID: <span className="font-mono text-foreground/90">{trace.id}</span></div>
                        {trace.response_id ? (
                          <div>response_id: <span className="font-mono text-foreground/90">{trace.response_id}</span></div>
                        ) : null}
                        {trace.thread_id ? (
                          <div>thread_id: <span className="font-mono text-foreground/90">{trace.thread_id}</span></div>
                        ) : null}
                        {trace.message_id ? (
                          <div>message_id: <span className="font-mono text-foreground/90">{trace.message_id}</span></div>
                        ) : null}
                        {trace.report_id ? (
                          <div>report_id: <span className="font-mono text-foreground/90">{trace.report_id}</span></div>
                        ) : null}
                      </div>
                    </div>

                    <div className="rounded-xl border border-border/50 bg-background/35 p-3">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Filtros aplicados
                      </div>
                      <pre className={cn("whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground")}>{prettyJson(trace.filters)}</pre>
                    </div>
                  </div>

                  <details className="mt-3 rounded-xl border border-border/50 bg-background/35 p-3 text-xs text-muted-foreground">
                    <summary className="cursor-pointer font-medium text-foreground">Ver metadata tecnica</summary>
                    <pre className="mt-3 whitespace-pre-wrap break-words leading-5">{prettyJson(trace.metadata)}</pre>
                  </details>
                </div>
              )
            })
          ) : (
            <div className="rounded-xl border border-dashed border-border/60 bg-background/20 p-6 text-sm text-muted-foreground">
              No hay trazas que coincidan con los filtros actuales.
            </div>
          )}
        </div>
      </ScrollArea>
    </Card>
  )
}
