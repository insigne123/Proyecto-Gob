import Link from "next/link"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Plus, Sparkles } from "lucide-react"

export default async function WorkspacesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const { data: workspaces } = await supabase
    .from("gob_workspaces")
    .select("id,title,status,updated_at,created_at")
    .order("updated_at", { ascending: false })

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Expedientes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cuadernos de trabajo por caso/proyecto, con fuentes versionadas y trazabilidad.
          </p>
        </div>

        <Link href="/workspaces/new">
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Crear expediente
          </Button>
        </Link>
      </div>

      {!workspaces?.length ? (
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-300" />
              Primer expediente
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Crea un expediente para comenzar a cargar fuentes (HTML/PDF) y hacer consultas con citas.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {workspaces.map((w) => (
            <Link key={w.id} href={`/workspaces/${w.id}`} className="group">
              <Card className="bg-card/70 transition-colors group-hover:bg-card/90">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base leading-5">
                      {w.title}
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className={
                        w.status === "archived"
                          ? "border-slate-500/30 text-slate-300"
                          : "border-emerald-500/25 text-emerald-200"
                      }
                    >
                      {w.status === "archived" ? "Archivado" : "Activo"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>ID: {String(w.id).slice(0, 8)}...</span>
                    <span>
                      {w.updated_at ? new Date(w.updated_at).toLocaleString("es-CL") : ""}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
