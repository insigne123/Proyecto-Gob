"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  FileSpreadsheet,
  FileText,
  Loader2,
  NotebookPen,
  Plus,
  RefreshCw,
} from "lucide-react"

type NoteRow = {
  id: string
  title: string | null
  content: string
  created_at: string | null
  visibility?: "shared" | "private" | null
}

type ReportRow = {
  id: string
  status: string
  created_at: string | null
  title?: string | null
  template?: string | null
  generation_status?: string | null
  generation_step?: number | null
  generation_total?: number | null
}

export function StudioPanel({ workspaceId }: { workspaceId: string }) {
  const [tab, setTab] = useState<"notes" | "report">("notes")
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [reports, setReports] = useState<ReportRow[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const [isNoteOpen, setIsNoteOpen] = useState(false)
  const [noteTitle, setNoteTitle] = useState("")
  const [noteContent, setNoteContent] = useState("")
  const [noteVisibility, setNoteVisibility] = useState<"shared" | "private">("shared")
  const [isSavingNote, setIsSavingNote] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)

  const [isReportOpen, setIsReportOpen] = useState(false)
  const [isGeneratingReport, setIsGeneratingReport] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)
  const [reportTemplate, setReportTemplate] = useState<"resolucion-chile" | "informe-evaluacion">(
    "informe-evaluacion"
  )

  async function loadAll() {
    const [nRes, rRes] = await Promise.all([
      fetch(`/api/workspaces/${workspaceId}/notes`),
      fetch(`/api/workspaces/${workspaceId}/reports`),
    ])

    const [nJson, rJson] = await Promise.all([
      nRes.json().catch(() => null),
      rRes.json().catch(() => null),
    ])

    if (nRes.ok) setNotes(nJson?.notes ?? [])
    if (rRes.ok) setReports(rJson?.reports ?? [])
  }

  useEffect(() => {
    let alive = true
    setIsLoading(true)
    loadAll()
      .catch(() => null)
      .finally(() => {
        if (alive) setIsLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  async function saveNote() {
    setNoteError(null)
    setIsSavingNote(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: noteTitle || null,
          content: noteContent,
          visibility: noteVisibility,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || "No se pudo guardar la nota")
      setIsNoteOpen(false)
      setNoteTitle("")
      setNoteContent("")
      setNoteVisibility("shared")
      await loadAll()
    } catch (err: any) {
      setNoteError(err?.message ?? "Error inesperado")
    } finally {
      setIsSavingNote(false)
    }
  }

  async function generateReport() {
    setReportError(null)
    setIsGeneratingReport(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/reports/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ template: reportTemplate }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || "No se pudo generar el informe")
      setIsReportOpen(false)
      await loadAll()
    } catch (err: any) {
      setReportError(err?.message ?? "Error inesperado")
    } finally {
      setIsGeneratingReport(false)
    }
  }

  return (
    <Card className="flex h-[calc(100svh-104px)] min-h-0 flex-col overflow-hidden rounded-2xl border-border/60 bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/45">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div>
          <div className="text-sm font-semibold">Studio</div>
          <div className="text-[11px] text-muted-foreground">Notas e informes del expediente</div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link href={`/workspaces/${workspaceId}/watchlists`}>
              <FileSpreadsheet className="h-4 w-4" />
              Monitor Excel
            </Link>
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => loadAll().catch(() => null)}>
            <RefreshCw className="h-4 w-4" />
            Actualizar
          </Button>
        </div>
      </div>

      <div className="px-4 pt-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="grid w-full grid-cols-2 bg-background/35">
            <TabsTrigger value="notes" className="gap-2">
              <NotebookPen className="h-4 w-4" />
              Notas
            </TabsTrigger>
            <TabsTrigger value="report" className="gap-2">
              <FileText className="h-4 w-4" />
              Informe
            </TabsTrigger>
          </TabsList>

          <TabsContent value="notes" className="mt-4">
            <ScrollArea className="h-[calc(100svh-220px)] pr-2">
              <div className="space-y-2">
                {isLoading ? (
                  <div className="text-sm text-muted-foreground">Cargando...</div>
                ) : notes.length ? (
                  notes.map((n) => (
                    <div
                      key={n.id}
                      className="rounded-xl border border-border/55 bg-background/25 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">{n.title || "Nota"}</div>
                        {n.visibility === "private" ? (
                          <Badge variant="outline" className="border-slate-500/30 text-slate-300">
                            Privada
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                        {n.content}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">No hay notas aun.</div>
                )}
              </div>
            </ScrollArea>

            <div className="mt-4">
              <Button className="w-full gap-2" onClick={() => setIsNoteOpen(true)}>
                <Plus className="h-4 w-4" />
                Agregar nota
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="report" className="mt-4">
            <ScrollArea className="h-[calc(100svh-220px)] pr-2">
              <div className="space-y-2">
                {isLoading ? (
                  <div className="text-sm text-muted-foreground">Cargando...</div>
                ) : reports.length ? (
                  reports.map((r) => (
                    <Link
                      key={r.id}
                      href={`/workspaces/${workspaceId}/reports/${r.id}`}
                      className="block rounded-xl border border-border/55 bg-background/25 px-3 py-2 hover:bg-background/35"
                    >
                      <div className="text-sm font-medium">{r.title || "Informe"}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Estado: {r.status}
                        {r.generation_status ? ` - gen: ${r.generation_status}` : ""}
                        {typeof r.generation_step === "number" && typeof r.generation_total === "number"
                          ? ` (${r.generation_step}/${r.generation_total})`
                          : ""}
                        {r.created_at ? ` - ${new Date(r.created_at).toLocaleString("es-CL")}` : ""}
                      </div>
                      {r.template ? (
                        <div className="mt-1 text-[11px] text-muted-foreground">Template: {r.template}</div>
                      ) : null}
                    </Link>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">Aun no generas informes.</div>
                )}
              </div>
            </ScrollArea>

            <div className="mt-4">
              <Button className="w-full gap-2" onClick={() => setIsReportOpen(true)}>
                <FileText className="h-4 w-4" />
                Generar borrador
              </Button>
              {reportError && (
                <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {reportError}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <div className="mt-auto border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
        El monitor de Excel ahora vive en una seccion aparte para no mezclarlo con el notebook.
      </div>

      <Dialog open={isNoteOpen} onOpenChange={setIsNoteOpen}>
        <DialogContent className="bg-card/85 backdrop-blur supports-[backdrop-filter]:bg-card/65">
          <DialogHeader>
            <DialogTitle>Agregar nota</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Titulo (opcional)</Label>
              <Input value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Visibilidad</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background/35 px-3 py-2 text-sm"
                value={noteVisibility}
                onChange={(e) => setNoteVisibility(e.target.value as any)}
              >
                <option value="shared">Compartida (equipo)</option>
                <option value="private">Privada (solo yo)</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Contenido</Label>
              <Textarea
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                className="min-h-[160px]"
              />
            </div>
            {noteError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {noteError}
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={() => saveNote().catch(() => null)} disabled={isSavingNote} className="gap-2">
                {isSavingNote && <Loader2 className="h-4 w-4 animate-spin" />}
                Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isReportOpen} onOpenChange={setIsReportOpen}>
        <DialogContent className="bg-card/85 backdrop-blur supports-[backdrop-filter]:bg-card/65">
          <DialogHeader>
            <DialogTitle>Generar informe (borrador)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Template</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background/35 px-3 py-2 text-sm"
                value={reportTemplate}
                onChange={(e) => setReportTemplate(e.target.value as any)}
              >
                <option value="informe-evaluacion">Informe de evaluacion ambiental (profesional)</option>
                <option value="resolucion-chile">Resolucion (Vistos/Considerandos/Resuelvo)</option>
              </select>
            </div>
            <p className="text-sm text-muted-foreground">
              Se generara un borrador con evidencia del expediente y precedentes relacionados de otros expedientes donde tengas acceso.
            </p>
            {reportError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {reportError}
              </div>
            )}
            <div className="flex justify-end">
              <Button
                onClick={() => generateReport().catch(() => null)}
                disabled={isGeneratingReport}
                className="gap-2"
              >
                {isGeneratingReport && <Loader2 className="h-4 w-4 animate-spin" />}
                Generar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
