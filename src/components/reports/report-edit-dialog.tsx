"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, Pencil } from "lucide-react"

type Section = { heading: string; body: string }

export function ReportEditDialog(props: {
  workspaceId: string
  reportId: string
  canEdit: boolean
  status: string
  title: string
  sections: Section[]
}) {
  const { workspaceId, reportId, canEdit, status, title, sections } = props
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [localTitle, setLocalTitle] = useState(title)
  const [localStatus, setLocalStatus] = useState(status)
  const [localSections, setLocalSections] = useState<Section[]>(sections)
  const [note, setNote] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const locked = String(status) === "final"
  const disabled = !canEdit || locked

  const hasChanges = useMemo(() => {
    if (localTitle !== title) return true
    if (localStatus !== status) return true
    if (localSections.length !== sections.length) return true
    for (let i = 0; i < localSections.length; i++) {
      if (localSections[i]?.body !== sections[i]?.body) return true
    }
    return false
  }, [localTitle, localStatus, localSections, title, status, sections])

  async function onOpenChange(next: boolean) {
    setError(null)
    setOpen(next)
    if (next) {
      setLocalTitle(title)
      setLocalStatus(status)
      setLocalSections(sections)
      setNote("")
    }
  }

  async function onSave() {
    setError(null)
    setIsSaving(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/reports/${reportId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: localTitle,
          status: localStatus,
          sections: localSections,
          note: note.trim() ? note.trim() : undefined,
        }),
      })

      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || "No se pudo guardar")

      setOpen(false)
      router.refresh()
    } catch (err: any) {
      setError(err?.message ?? "Error inesperado")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        className="gap-2"
        onClick={() => onOpenChange(true)}
        disabled={disabled}
        title={locked ? "Reporte final (bloqueado)" : "Editar"}
      >
        <Pencil className="h-4 w-4" />
        Editar
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl bg-card/85 backdrop-blur supports-[backdrop-filter]:bg-card/65">
          <DialogHeader>
            <DialogTitle>Edicion manual</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              La edicion manual NO valida evidencia automaticamente. Mantiene el anexo de citas existente.
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2 md:col-span-2">
                <Label>Titulo</Label>
                <Input value={localTitle} onChange={(e) => setLocalTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Estado</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background/35 px-3 py-2 text-sm"
                  value={localStatus}
                  onChange={(e) => setLocalStatus(e.target.value)}
                >
                  <option value="draft">draft</option>
                  <option value="review">review</option>
                  <option value="final">final (lock)</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Nota (opcional, para version)</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: Ajuste de redaccion" />
            </div>

            <div className="max-h-[52vh] space-y-4 overflow-auto pr-1">
              {localSections.map((s, idx) => (
                <div key={idx} className="space-y-2">
                  <div className="text-sm font-medium">{s.heading}</div>
                  <Textarea
                    value={s.body}
                    onChange={(e) =>
                      setLocalSections((prev) => {
                        const next = [...prev]
                        next[idx] = { ...next[idx], body: e.target.value }
                        return next
                      })
                    }
                    className="min-h-[160px]"
                  />
                </div>
              ))}
            </div>

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={isSaving}>
                Cancelar
              </Button>
              <Button onClick={() => onSave().catch(() => null)} disabled={isSaving || !hasChanges} className="gap-2">
                {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
