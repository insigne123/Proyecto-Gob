import Link from "next/link"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Plus, Sparkles, FolderOpen, Database } from "lucide-react"

import { TribunalCausesTable } from "@/components/tribunal-causes-table"
import { TribunalAnalyticsTable } from "@/components/tribunal-analytics-table"
import { isEligibleOnboardingCause, onboardingAllowedAuthorities } from "@/lib/onboarding/eligibility"
import { isStrictTribunalKeyDocument } from "@/lib/tribunal/document-role"
import { isExcelMonitorWorkspaceDescription } from "@/lib/workspaces/system-workspaces"

export default async function ProjectsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const { data: workspaces } = await supabase
    .from("gob_workspaces")
    .select("id,title,description,status,updated_at,created_at")
    .order("updated_at", { ascending: false })

  const visibleWorkspaces = (workspaces ?? []).filter(
    (workspace) => !isExcelMonitorWorkspaceDescription((workspace as any).description)
  )

  const { data: tribunalCauses, error } = await supabase
    .from("gob_tribunal_causes")
    .select(`
      *,
      gob_tribunal_documents(*)
    `)
    .order("fecha_ingreso", { ascending: false, nullsFirst: false })

  if (error) {
    console.error("Error fetching tribunal causes:", error)
  }

  const filteredTribunalCauses = ((tribunalCauses as any[]) || []).filter((cause: any) => {
    if (!isEligibleOnboardingCause({ tribunal: cause?.tribunal, caratula: cause?.caratula })) {
      return false
    }

    const docs = Array.isArray(cause?.gob_tribunal_documents) ? cause.gob_tribunal_documents : []
    return docs.some((doc: any) =>
      isStrictTribunalKeyDocument({
        documentType: doc?.document_type,
        name: doc?.name,
        title: doc?.document_type,
      })
    )
  })

  const tribunalSummary = filteredTribunalCauses.reduce(
    (acc: { total: number; docs: number; byTribunal: Record<string, number> }, cause: any) => {
      acc.total += 1
      const docs = Array.isArray(cause?.gob_tribunal_documents) ? cause.gob_tribunal_documents : []
      acc.docs += docs.filter((doc: any) =>
        isStrictTribunalKeyDocument({
          documentType: doc?.document_type,
          name: doc?.name,
          title: doc?.document_type,
        })
      ).length
      const tribunal = String(cause?.tribunal || "-")
      acc.byTribunal[tribunal] = (acc.byTribunal[tribunal] || 0) + 1
      return acc
    },
    { total: 0, docs: 0, byTribunal: {} }
  )

  const allowedAuthorities = Array.from(onboardingAllowedAuthorities()).join(" / ")

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Área de Trabajo</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gestiona tus proyectos y consulta la base de documentos y jurisprudencia.
          </p>
        </div>

        <Link href="/projects/new">
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Crear proyecto
          </Button>
        </Link>
      </div>

      <Tabs defaultValue="projects" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="projects" className="gap-2">
            <FolderOpen className="h-4 w-4" />
            Mis Proyectos
          </TabsTrigger>
          <TabsTrigger value="document-base" className="gap-2">
            <Database className="h-4 w-4" />
            Base de Documentos (Jurisprudencia)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="mt-0">
          {!visibleWorkspaces.length ? (
            <Card className="bg-card/70">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-emerald-300" />
                  Primer proyecto
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Crea un proyecto para comenzar a analizar causas y redactar documentos con IA.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {visibleWorkspaces.map((w) => (
                <Link key={w.id} href={`/projects/${w.id}`} className="group">
                  <Card className="bg-card/70 transition-colors group-hover:bg-card/90">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle className="text-base leading-5">{w.title}</CardTitle>
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
                        <span>{w.updated_at ? new Date(w.updated_at).toLocaleString("es-CL") : ""}</span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="document-base" className="mt-0 space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="bg-card/70">
              <CardContent className="pt-5">
                <div className="text-[11px] text-muted-foreground">Causas elegibles</div>
                <div className="text-2xl font-semibold">{tribunalSummary.total}</div>
              </CardContent>
            </Card>
            <Card className="bg-card/70">
              <CardContent className="pt-5">
                <div className="text-[11px] text-muted-foreground">Documentos clave</div>
                <div className="text-2xl font-semibold">{tribunalSummary.docs}</div>
              </CardContent>
            </Card>
            <Card className="bg-card/70">
              <CardContent className="pt-5">
                <div className="text-[11px] text-muted-foreground">Cobertura</div>
                <div className="text-sm font-medium text-foreground">
                  1TA {tribunalSummary.byTribunal["1TA"] || 0} · 2TA {tribunalSummary.byTribunal["2TA"] || 0}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="space-y-1">
              <CardTitle>Base de Documentos (1TA + 2TA)</CardTitle>
              <CardDescription>
                  Visualiza solo causas dentro del scope elegible actual ({allowedAuthorities}) y con documentos clave utiles para consulta y redaccion.
               </CardDescription>
             </div>
             <Badge variant="outline" className="border-emerald-500/25 text-emerald-200">
               Dataset depurado
             </Badge>
           </CardHeader>
           <CardContent className="pt-4">
               <TribunalCausesTable initialData={filteredTribunalCauses as any} />
          </CardContent>
        </Card>

          <TribunalAnalyticsTable causes={filteredTribunalCauses as any} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
