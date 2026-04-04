"use client"

import { useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AlertTriangle, CheckSquare2, Loader2, RefreshCw, ShieldCheck, Sparkles } from "lucide-react"

type SourceRow = {
  id: string
  workspace_id: string | null
  title: string | null
  filename: string | null
  status: "pending" | "processing" | "ready" | "error"
  snapshots_count: number | null
  updated_at: string | null
  last_error: string | null
}

type FocusKey = "evidence" | "coherence" | "strategy" | "writing"

type ReviewResult = {
  generatedAt: string
  source: {
    id: string
    title: string
    snapshotId: string
  }
  focus: FocusKey[]
  summary: {
    riskLevel: "low" | "medium" | "high"
    verdict: string
    strengths: string[]
    priorities: string[]
  }
  findings: Array<{
    id: string
    title: string
    severity: "critical" | "major" | "minor"
    category: "evidence" | "coherence" | "strategy" | "writing"
    issue: string
    recommendation: string
    appliesTo: string | null
    evidence: Array<{
      chunkId: string
      quote: string
      sourceUrl: string | null
      snapshotId: string | null
      page: number | null
      section: string | null
      origin: "reviewed_document" | "project_evidence"
    }>
  }>
  checklist: string[]
  stats: {
    reviewedChunks: number
    externalEvidenceChunks: number
    findingsCount: number
    criticalCount: number
    majorCount: number
    model: string | null
    usage: any
  }
}

type ReviewHistoryRow = {
  id: string
  title: string
  createdAt: string | null
  riskLevel: "low" | "medium" | "high" | null
  snippet: string
}

const FOCUS_OPTIONS: Array<{ key: FocusKey; title: string; description: string }> = [
  {
    key: "evidence",
    title: "Sustento probatorio",
    description: "Busca afirmaciones fuertes sin respaldo verificable.",
  },
  {
    key: "coherence",
    title: "Coherencia interna",
    description: "Detecta contradicciones de hechos, fechas o actores.",
  },
  {
    key: "strategy",
    title: "Estrategia argumental",
    description: "Evalua si la linea de defensa es util y accionable.",
  },
  {
    key: "writing",
    title: "Redaccion profesional",
    description: "Mejora precision, claridad y tono institucional.",
  },
]

function statusLabel(status: SourceRow["status"]) {
  if (status === "ready") return "Listo"
  if (status === "processing") return "Procesando"
  if (status === "pending") return "Pendiente"
  return "Error"
}

function riskLabel(level: ReviewResult["summary"]["riskLevel"] | ReviewHistoryRow["riskLevel"]) {
  if (level === "high") return "Alto"
  if (level === "medium") return "Medio"
  if (level === "low") return "Bajo"
  return "-"
}

function riskClass(level: ReviewResult["summary"]["riskLevel"] | ReviewHistoryRow["riskLevel"]) {
  if (level === "high") return "border-red-500/40 text-red-200"
  if (level === "medium") return "border-amber-500/40 text-amber-200"
  if (level === "low") return "border-emerald-500/40 text-emerald-200"
  return "border-border/60 text-muted-foreground"
}

function severityLabel(level: "critical" | "major" | "minor") {
  if (level === "critical") return "Critico"
  if (level === "major") return "Mayor"
  return "Menor"
}

function severityClass(level: "critical" | "major" | "minor") {
  if (level === "critical") return "border-red-500/40 text-red-200"
  if (level === "major") return "border-amber-500/40 text-amber-200"
  return "border-slate-500/40 text-slate-200"
}

function categoryLabel(category: "evidence" | "coherence" | "strategy" | "writing") {
  if (category === "evidence") return "Sustento"
  if (category === "coherence") return "Coherencia"
  if (category === "strategy") return "Estrategia"
  return "Redaccion"
}

export function ProfessionalReviewPanel({ workspaceId }: { workspaceId: string }) {
  const [sources, setSources] = useState<SourceRow[]>([])
  const [history, setHistory] = useState<ReviewHistoryRow[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState("")
  const [focus, setFocus] = useState<Record<FocusKey, boolean>>({
    evidence: true,
    coherence: true,
    strategy: true,
    writing: true,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [noteWarning, setNoteWarning] = useState<string | null>(null)
  const [result, setResult] = useState<ReviewResult | null>(null)

  async function loadSources() {
    const res = await fetch(`/api/workspaces/${workspaceId}/sources`, {
      method: "GET",
      headers: { accept: "application/json" },
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      throw new Error(json?.error || "No se pudieron cargar las fuentes")
    }

    const rows = (Array.isArray(json?.sources) ? json.sources : []) as SourceRow[]
    const currentWorkspaceRows = rows.filter((row) => String(row.workspace_id || "") === workspaceId)
    setSources(currentWorkspaceRows)

    setSelectedSourceId((prev) => {
      if (prev && currentWorkspaceRows.some((row) => row.id === prev)) return prev
      const firstReady = currentWorkspaceRows.find(
        (row) => row.status === "ready" && Number(row.snapshots_count || 0) > 0
      )
      return firstReady?.id || currentWorkspaceRows[0]?.id || ""
    })
  }

  async function loadHistory() {
    const res = await fetch(`/api/workspaces/${workspaceId}/reviews/professional`, {
      method: "GET",
      headers: { accept: "application/json" },
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      throw new Error(json?.error || "No se pudo cargar historial")
    }

    setHistory(Array.isArray(json?.reviews) ? (json.reviews as ReviewHistoryRow[]) : [])
  }

  async function loadAll() {
    await Promise.all([loadSources(), loadHistory()])
  }

  useEffect(() => {
    let active = true
    setIsLoading(true)
    loadAll()
      .catch((err: any) => {
        if (!active) return
        setError(err?.message || "No se pudo cargar panel de revision")
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId) || null,
    [sources, selectedSourceId]
  )

  const selectedFocus = useMemo(
    () => FOCUS_OPTIONS.filter((item) => focus[item.key]).map((item) => item.key),
    [focus]
  )

  async function runReview() {
    setError(null)
    setNoteWarning(null)

    if (!selectedSourceId) {
      setError("Selecciona un documento para revisar.")
      return
    }

    if (selectedFocus.length === 0) {
      setError("Activa al menos un foco de revision.")
      return
    }

    setIsRunning(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/reviews/professional`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: selectedSourceId,
          focus: selectedFocus,
          saveAsNote: true,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(json?.error || "No se pudo ejecutar la revision")
      }

      setResult((json?.review as ReviewResult) || null)
      setNoteWarning(json?.noteWarning ? String(json.noteWarning) : null)
      await loadHistory()
    } catch (err: any) {
      setError(err?.message || "Error inesperado")
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      <ScrollArea className="h-[calc(100svh-220px)] pr-2">
        <div className="space-y-4">
          <Card className="rounded-xl border-border/55 bg-background/20 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Revision profesional IA</div>
                <div className="text-xs text-muted-foreground">
                  Sube un informe externo y revisalo con observaciones trazables en minutos.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2"
                  onClick={() => {
                    try {
                      window.dispatchEvent(new CustomEvent("ca:open-review"))
                    } catch {
                      // ignore
                    }
                  }}
                >
                  <Sparkles className="h-4 w-4" />
                  Revision guiada
                </Button>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => loadAll().catch(() => null)}>
                  <RefreshCw className="h-4 w-4" />
                  Actualizar
                </Button>
              </div>
            </div>
          </Card>

          <Card className="rounded-xl border-border/55 bg-background/20 px-4 py-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Paso 1</div>
            <div className="space-y-2">
              <Label>Selecciona el documento a revisar</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background/35 px-3 py-2 text-sm"
                value={selectedSourceId}
                onChange={(event) => setSelectedSourceId(event.target.value)}
              >
                <option value="">Selecciona...</option>
                {sources.map((source) => {
                  const name = source.title || source.filename || "Documento"
                  return (
                    <option key={source.id} value={source.id}>
                      {name} - {statusLabel(source.status)}
                    </option>
                  )
                })}
              </select>
              {selectedSource ? (
                <div className="text-xs text-muted-foreground">
                  Estado: {statusLabel(selectedSource.status)}
                  {selectedSource.updated_at
                    ? ` - actualizado ${new Date(selectedSource.updated_at).toLocaleString("es-CL")}`
                    : ""}
                </div>
              ) : null}
              {selectedSource?.status !== "ready" ? (
                <div className="rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  El documento debe estar listo antes de revisar. Si recien lo subiste, espera que termine de procesar.
                </div>
              ) : null}
            </div>
          </Card>

          <Card className="rounded-xl border-border/55 bg-background/20 px-4 py-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Paso 2</div>
            <div className="space-y-2">
              <Label>Foco de revision</Label>
              <div className="grid gap-2 md:grid-cols-2">
                {FOCUS_OPTIONS.map((item) => (
                  <label
                    key={item.key}
                    className="flex cursor-pointer items-start gap-2 rounded-md border border-border/55 bg-background/20 px-3 py-2"
                  >
                    <Checkbox
                      checked={focus[item.key]}
                      onCheckedChange={(checked) =>
                        setFocus((prev) => ({
                          ...prev,
                          [item.key]: Boolean(checked),
                        }))
                      }
                    />
                    <span>
                      <span className="block text-sm font-medium">{item.title}</span>
                      <span className="block text-xs text-muted-foreground">{item.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </Card>

          <Card className="rounded-xl border-border/55 bg-background/20 px-4 py-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Paso 3</div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => runReview().catch(() => null)} disabled={isRunning} className="gap-2">
                {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Ejecutar revision profesional
              </Button>
              <div className="text-xs text-muted-foreground">
                Guarda el resultado como nota compartida para el equipo.
              </div>
            </div>
          </Card>

          {isLoading ? <div className="text-sm text-muted-foreground">Cargando panel...</div> : null}

          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {noteWarning ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
              Revision generada, pero no se pudo guardar nota automaticamente: {noteWarning}
            </div>
          ) : null}

          {result ? (
            <Card className="rounded-xl border-border/55 bg-background/20 px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">Resultado de revision</div>
                  <div className="text-xs text-muted-foreground">
                    {result.source.title} - {new Date(result.generatedAt).toLocaleString("es-CL")}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={riskClass(result.summary.riskLevel)}>
                    Riesgo {riskLabel(result.summary.riskLevel)}
                  </Badge>
                  <Badge variant="outline">
                    {result.stats.findingsCount} hallazgo{result.stats.findingsCount === 1 ? "" : "s"}
                  </Badge>
                </div>
              </div>

              <div className="mt-3 rounded-md border border-border/50 bg-background/25 px-3 py-2 text-sm text-foreground/95">
                {result.summary.verdict || "Sin dictamen."}
              </div>

              {result.summary.strengths.length ? (
                <div className="mt-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fortalezas</div>
                  <div className="mt-1 space-y-1 text-sm">
                    {result.summary.strengths.map((item, index) => (
                      <div key={`st_${index}`}>- {item}</div>
                    ))}
                  </div>
                </div>
              ) : null}

              {result.summary.priorities.length ? (
                <div className="mt-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Prioridades</div>
                  <div className="mt-1 space-y-1 text-sm">
                    {result.summary.priorities.map((item, index) => (
                      <div key={`pr_${index}`}>- {item}</div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-4 space-y-3">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hallazgos</div>
                {result.findings.length ? (
                  result.findings.map((finding) => (
                    <div key={finding.id} className="rounded-lg border border-border/55 bg-background/25 px-3 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold">{finding.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {categoryLabel(finding.category)}
                            {finding.appliesTo ? ` - ${finding.appliesTo}` : ""}
                          </div>
                        </div>
                        <Badge variant="outline" className={severityClass(finding.severity)}>
                          {severityLabel(finding.severity)}
                        </Badge>
                      </div>

                      <div className="mt-2 text-sm text-foreground/95">
                        <span className="font-medium">Observacion:</span> {finding.issue}
                      </div>
                      <div className="mt-1 text-sm text-foreground/95">
                        <span className="font-medium">Recomendacion:</span> {finding.recommendation}
                      </div>

                      <div className="mt-2 space-y-2">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Evidencia
                        </div>
                        {finding.evidence.map((ev, idx) => (
                          <div key={`${finding.id}_${idx}`} className="rounded-md border border-border/45 bg-background/30 px-2 py-2 text-xs">
                            <div className="text-foreground/90">{"\""}{ev.quote}{"\""}</div>
                            <div className="mt-1 text-muted-foreground">
                              {ev.origin === "reviewed_document" ? "Documento revisado" : "Fuente del proyecto"}
                              {typeof ev.page === "number" ? ` - p.${ev.page}` : ""}
                              {ev.section ? ` - ${ev.section}` : ""}
                            </div>
                            {ev.sourceUrl ? (
                              <a
                                href={ev.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 inline-block text-emerald-300 hover:text-emerald-200"
                              >
                                Abrir fuente
                              </a>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                    No se detectaron hallazgos con evidencia suficiente en esta corrida.
                  </div>
                )}
              </div>

              {result.checklist.length ? (
                <div className="mt-4 rounded-lg border border-border/55 bg-background/25 px-3 py-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <CheckSquare2 className="h-3.5 w-3.5" />
                    Checklist rapido
                  </div>
                  <div className="space-y-1 text-sm">
                    {result.checklist.map((item, index) => (
                      <div key={`ck_${index}`}>- [ ] {item}</div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-4 text-[11px] text-muted-foreground">
                Base usada: {result.stats.reviewedChunks} bloques del documento + {" "}
                {result.stats.externalEvidenceChunks} bloques de evidencia. Modelo: {result.stats.model || "n/a"}
              </div>
            </Card>
          ) : null}

          <Card className="rounded-xl border-border/55 bg-background/20 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4" />
              Revisiones guardadas
            </div>
            <div className="mt-2 space-y-2">
              {history.length ? (
                history.slice(0, 8).map((item) => (
                  <div key={item.id} className="rounded-lg border border-border/55 bg-background/25 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">{item.title}</div>
                      <Badge variant="outline" className={riskClass(item.riskLevel)}>
                        Riesgo {riskLabel(item.riskLevel)}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {item.createdAt ? new Date(item.createdAt).toLocaleString("es-CL") : "sin fecha"}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.snippet}</div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">Aun no hay revisiones guardadas.</div>
              )}
            </div>
          </Card>
        </div>
      </ScrollArea>

      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
          <span>
            Consejo: ejecuta la revision cuando el archivo este en estado {"\""}Listo{"\""} para obtener hallazgos con evidencia completa.
          </span>
        </div>
      </div>
    </div>
  )
}
