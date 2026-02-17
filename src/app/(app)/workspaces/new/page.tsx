"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ArrowLeft, Loader2 } from "lucide-react"

export default function NewWorkspacePage() {
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setIsSaving(true)

    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description }),
      })

      const json = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(json?.error || "No se pudo crear el expediente")
      }

      router.replace(`/workspaces/${json.id}`)
      router.refresh()
    } catch (err: any) {
      setError(err?.message ?? "Error inesperado")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
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
          <CardTitle>Crear expediente</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-5" id="new-workspace-form">
            <div className="space-y-2">
              <Label htmlFor="title">Nombre</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ej: Parque Eolico Vientos del Sur"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descripcion breve (opcional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Contexto del caso, expediente, objetivos de analisis..."
                className="min-h-[120px]"
              />
            </div>

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
          </form>
        </CardContent>
        <CardFooter className="flex items-center justify-end gap-2 border-t border-border/60">
          <Link href="/workspaces">
            <Button variant="outline">Cancelar</Button>
          </Link>
          <Button type="submit" form="new-workspace-form" disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Crear
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
