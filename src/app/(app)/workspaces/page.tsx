import Link from "next/link"
import { redirect } from "next/navigation"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"
import { Briefcase, FileSpreadsheet, ArrowRight } from "lucide-react"

export default async function ModulesHomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Selecciona un modulo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Elige si quieres trabajar en Proyectos o en el Monitor de Excel.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Link href="/projects" className="group block">
          <Card className="h-full bg-card/70 transition-colors group-hover:bg-card/90">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3 text-lg">
                <span className="inline-flex items-center gap-2">
                  <Briefcase className="h-5 w-5 text-emerald-300" />
                  Proyectos
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Gestiona tus proyectos, fuentes, chat con citas, informes y operaciones.
            </CardContent>
          </Card>
        </Link>

        <Link href="/excel" className="group block">
          <Card className="h-full bg-card/70 transition-colors group-hover:bg-card/90">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3 text-lg">
                <span className="inline-flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5 text-sky-300" />
                  Monitor Excel
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Crea y administra monitores de hojas Excel/Sheets y revisa alertas por cambios.
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  )
}
