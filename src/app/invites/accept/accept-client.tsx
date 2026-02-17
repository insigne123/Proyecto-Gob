"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2 } from "lucide-react"

export default function AcceptInviteClient() {
  const router = useRouter()
  const sp = useSearchParams()
  const token = sp.get("token")

  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const nextLoginUrl = useMemo(() => {
    const next = token ? `/invites/accept?token=${encodeURIComponent(token)}` : "/projects"
    return `/login?next=${encodeURIComponent(next)}`
  }, [token])

  useEffect(() => {
    if (!token) return

    let alive = true
    setStatus("loading")
    setError(null)

    fetch("/api/invites/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => null)
        if (res.status === 401) {
          router.replace(nextLoginUrl)
          return
        }
        if (!res.ok) throw new Error(json?.error || "No se pudo aceptar la invitacion")
        const workspaceId = String(json?.workspaceId || "")
        if (!workspaceId) throw new Error("Respuesta invalida")
        router.replace(`/projects/${workspaceId}`)
        router.refresh()
      })
      .catch((err: any) => {
        if (!alive) return
        setStatus("error")
        setError(err?.message ?? "Error inesperado")
      })

    return () => {
      alive = false
    }
  }, [router, token, nextLoginUrl])

  if (!token) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-10">
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle>Invitacion</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Falta el parametro `token`.</p>
            <Button asChild variant="outline">
              <Link href="/projects">Volver</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-10">
      <Card className="bg-card/70">
        <CardHeader>
          <CardTitle>Aceptar invitacion</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "loading" ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Procesando...
            </div>
          ) : status === "error" ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Preparando...</div>
          )}

          <div className="flex items-center justify-between">
            <Button asChild variant="outline">
              <Link href="/projects">Ir a proyectos</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href={nextLoginUrl}>Iniciar sesion</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
