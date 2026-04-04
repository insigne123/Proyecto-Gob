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
import { Textarea } from "@/components/ui/textarea"
import {
  FileSpreadsheet,
  Loader2,
  NotebookPen,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react"

type NoteRow = {
  id: string
  title: string | null
  content: string
  created_at: string | null
  visibility?: "shared" | "private" | null
}

type WritingTask = "proofread" | "counterargue"

type WritingAssistOutput = {
  revisedText: string
  observations: string[]
  suggestions: string[]
  counterArguments: string[]
}

export function StudioPanel({ workspaceId }: { workspaceId: string }) {
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const [isNoteOpen, setIsNoteOpen] = useState(false)
  const [noteTitle, setNoteTitle] = useState("")
  const [noteContent, setNoteContent] = useState("")
  const [noteVisibility, setNoteVisibility] = useState<"shared" | "private">("shared")
  const [isSavingNote, setIsSavingNote] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)
  const [writingTask, setWritingTask] = useState<WritingTask>("proofread")
  const [isAssistingWriting, setIsAssistingWriting] = useState(false)
  const [writingOutput, setWritingOutput] = useState<WritingAssistOutput | null>(null)
  const [writingError, setWritingError] = useState<string | null>(null)

  async function loadAll() {
    const nRes = await fetch(`/api/workspaces/${workspaceId}/notes`)
    const nJson = await nRes.json().catch(() => null)
    if (nRes.ok) setNotes(nJson?.notes ?? [])
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
      setWritingOutput(null)
      setWritingError(null)
      await loadAll()
    } catch (err: any) {
      setNoteError(err?.message ?? "Error inesperado")
    } finally {
      setIsSavingNote(false)
    }
  }

  async function assistWriting() {
    setWritingError(null)
    setWritingOutput(null)

    const content = noteContent.trim()
    if (content.length < 20) {
      setWritingError("Escribe al menos 20 caracteres para ejecutar la asistencia.")
      return
    }

    setIsAssistingWriting(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/writing-assistant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task: writingTask,
          text: content,
          context: noteTitle ? `Titulo de nota: ${noteTitle}` : null,
        }),
      })

      const json = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(json?.error || "No se pudo ejecutar asistencia de redaccion")
      }

      setWritingOutput({
        revisedText: String(json?.revisedText || content),
        observations: Array.isArray(json?.observations)
          ? json.observations.map((x: any) => String(x)).slice(0, 10)
          : [],
        suggestions: Array.isArray(json?.suggestions)
          ? json.suggestions.map((x: any) => String(x)).slice(0, 10)
          : [],
        counterArguments: Array.isArray(json?.counterArguments)
          ? json.counterArguments.map((x: any) => String(x)).slice(0, 10)
          : [],
      })
    } catch (err: any) {
      setWritingError(err?.message ?? "Error inesperado")
    } finally {
      setIsAssistingWriting(false)
    }
  }

  return (
    <Card className="flex h-[calc(100svh-104px)] min-h-0 flex-col overflow-hidden rounded-2xl border-border/60 bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/45">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div>
          <div className="text-sm font-semibold">Studio</div>
          <div className="text-[11px] text-muted-foreground">Notas y apoyo de escritura del proyecto</div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link href="/excel">
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
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <NotebookPen className="h-4 w-4" />
          Notas del proyecto
        </div>

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
                  <div className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
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
      </div>

      <div className="mt-auto border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
        El monitor de Excel ahora vive en una seccion aparte para no mezclarlo con el notebook.
      </div>

      <Dialog
        open={isNoteOpen}
        onOpenChange={(open) => {
          setIsNoteOpen(open)
          if (!open) {
            setWritingOutput(null)
            setWritingError(null)
            setIsAssistingWriting(false)
          }
        }}
      >
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

            <div className="space-y-2 rounded-lg border border-border/55 bg-background/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm">Asistencia de escritura</Label>
                <select
                  className="h-8 rounded-md border border-input bg-background/35 px-2 text-xs"
                  value={writingTask}
                  onChange={(e) => setWritingTask(e.target.value as WritingTask)}
                >
                  <option value="proofread">Revisar redaccion y gramatica</option>
                  <option value="counterargue">Refutar argumento</option>
                </select>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] text-muted-foreground">
                  Usa el texto actual de la nota como insumo del asistente.
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => assistWriting().catch(() => null)}
                  disabled={isAssistingWriting}
                  className="gap-2"
                >
                  {isAssistingWriting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Ejecutar
                </Button>
              </div>

              {writingError ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {writingError}
                </div>
              ) : null}

              {writingOutput ? (
                <div className="space-y-2 text-xs">
                  <div className="rounded-md border border-border/50 bg-background/30 p-2">
                    <div className="mb-1 font-medium text-foreground">Texto sugerido</div>
                    <div className="max-h-36 overflow-y-auto whitespace-pre-wrap text-muted-foreground">
                      {writingOutput.revisedText}
                    </div>
                    <div className="mt-2 flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setNoteContent(writingOutput.revisedText)}
                      >
                        Aplicar texto sugerido
                      </Button>
                    </div>
                  </div>

                  {writingOutput.observations.length ? (
                    <div className="rounded-md border border-border/50 bg-background/30 p-2">
                      <div className="mb-1 font-medium text-foreground">Observaciones</div>
                      <div className="space-y-1 text-muted-foreground">
                        {writingOutput.observations.map((item, idx) => (
                          <div key={`obs_${idx}`}>- {item}</div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {writingOutput.suggestions.length ? (
                    <div className="rounded-md border border-border/50 bg-background/30 p-2">
                      <div className="mb-1 font-medium text-foreground">Sugerencias</div>
                      <div className="space-y-1 text-muted-foreground">
                        {writingOutput.suggestions.map((item, idx) => (
                          <div key={`sug_${idx}`}>- {item}</div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {writingOutput.counterArguments.length ? (
                    <div className="rounded-md border border-border/50 bg-background/30 p-2">
                      <div className="mb-1 font-medium text-foreground">Contraargumentos sugeridos</div>
                      <div className="space-y-1 text-muted-foreground">
                        {writingOutput.counterArguments.map((item, idx) => (
                          <div key={`ctr_${idx}`}>{idx + 1}. {item}</div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
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

    </Card>
  )
}
