"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"

import { supabase } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2 } from "lucide-react"

export default function LoginClient({ next }: { next: string }) {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (signInError) throw signInError

      router.replace(next)
      router.refresh()
    } catch (err: any) {
      setError(err?.message ?? "No se pudo iniciar sesion")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-svh flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/20">
            <span className="font-semibold">CA</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Cuaderno Ambiental</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Acceso para analisis documental con citas, monitor Excel y Estado Diario.
          </p>
        </div>

        <Card className="bg-card/70 backdrop-blur supports-[backdrop-filter]:bg-card/60">
          <CardHeader>
            <CardTitle>Iniciar sesion</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Correo</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nombre@tribunalambiental.cl"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Contrasena</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Entrar
              </Button>
            </form>
          </CardContent>
          <CardFooter className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Zona horaria: America/Santiago</span>
            <Link href="/" className="hover:text-foreground">
              Volver
            </Link>
          </CardFooter>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Si no tienes acceso, solicita creacion de usuario al administrador.
        </p>
      </div>
    </div>
  )
}
