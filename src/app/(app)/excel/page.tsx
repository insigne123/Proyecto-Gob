import Link from "next/link"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FileSpreadsheet } from "lucide-react"

export default async function ExcelModulePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const { data: workspaces } = await supabase
    .from("gob_workspaces")
    .select("id,title,status,updated_at")
    .order("updated_at", { ascending: false })
    .limit(200)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Monitor Excel</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Selecciona un proyecto para crear y gestionar monitores de hojas de calculo.
          </p>
        </div>
        <Link href="/workspaces" className="text-sm text-muted-foreground hover:text-foreground">
          Volver a modulos
        </Link>
      </div>

      {!workspaces?.length ? (
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="text-base">Sin proyectos</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Primero crea un proyecto para configurar monitores de Excel.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {workspaces.map((w) => (
            <Link key={w.id} href={`/excel/${w.id}`} className="group block">
              <Card className="bg-card/70 transition-colors group-hover:bg-card/90">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-start justify-between gap-3 text-base leading-5">
                    <span className="inline-flex items-center gap-2">
                      <FileSpreadsheet className="h-4 w-4 text-sky-300" />
                      {w.title}
                    </span>
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
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>ID: {String(w.id).slice(0, 8)}...</span>
                    <span>{w.updated_at ? new Date(w.updated_at).toLocaleString("es-CL") : ""}</span>
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
