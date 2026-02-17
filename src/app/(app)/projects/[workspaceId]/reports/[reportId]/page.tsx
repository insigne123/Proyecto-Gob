import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ReportEditDialog } from "@/components/reports/report-edit-dialog"
import { PrintButton } from "@/components/reports/print-button"
import { createClient } from "@/lib/supabase/server"
import { ArrowLeft } from "lucide-react"

export default async function ProjectReportPage({
  params,
}: {
  params: Promise<{ workspaceId: string; reportId: string }>
}) {
  const { workspaceId, reportId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const { data: workspace } = await supabase
    .from("gob_workspaces")
    .select("id,title")
    .eq("id", workspaceId)
    .maybeSingle()
  if (!workspace) notFound()

  const { data: report } = await supabase
    .from("gob_reports")
    .select("id,status,created_at,content_json,citations")
    .eq("id", reportId)
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (!report) notFound()

  const { data: member } = await supabase
    .from("gob_workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle()

  const canEdit = !!member && member.role !== "viewer"

  const title = (report.content_json as any)?.title || "Informe (borrador)"
  const sections = Array.isArray((report.content_json as any)?.sections)
    ? ((report.content_json as any).sections as any[])
    : []
  const citations = Array.isArray(report.citations) ? (report.citations as any[]) : []
  const annexes = (report.content_json as any)?.annexes || null
  const chronology = Array.isArray(annexes?.chronology) ? annexes.chronology : []
  const precedents = Array.isArray(annexes?.precedents) ? annexes.precedents : []

  const precedentWorkspaceIds = Array.from(
    new Set(
      precedents
        .map((p: any) => (p?.workspaceId ? String(p.workspaceId) : ""))
        .filter(Boolean)
    )
  )

  const precedentWorkspaceTitleById = new Map<string, string>()
  if (precedentWorkspaceIds.length) {
    const { data: precWs } = await supabase
      .from("gob_workspaces")
      .select("id,title")
      .in("id", precedentWorkspaceIds)

    for (const w of precWs ?? []) {
      precedentWorkspaceTitleById.set(String((w as any).id), String((w as any).title || "Proyecto"))
    }
  }

  const snapshotIds = Array.from(
    new Set(
      citations
        .map((c) => (c?.snapshotId ? String(c.snapshotId) : ""))
        .filter(Boolean)
    )
  )

  const snapshotById = new Map<string, any>()
  if (snapshotIds.length) {
    const { data: snaps } = await supabase
      .from("gob_source_snapshots")
      .select("id,fetched_at,created_at,content_hash")
      .in("id", snapshotIds)

    for (const s of snaps ?? []) snapshotById.set(String((s as any).id), s)
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link
          href={`/projects/${workspaceId}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al cuaderno
        </Link>

        <div className="flex items-center gap-2">
          <Badge variant="outline">{report.status}</Badge>
          <PrintButton />
          <ReportEditDialog
            workspaceId={workspaceId}
            reportId={report.id}
            canEdit={canEdit}
            status={String(report.status)}
            title={String(title)}
            sections={sections.map((s: any) => ({
              heading: String(s.heading ?? "Seccion"),
              body: String(s.body ?? ""),
            }))}
          />
        </div>
      </div>

      <Card className="bg-card/70">
        <CardHeader>
          <CardTitle className="text-xl">{title}</CardTitle>
          <div className="text-xs text-muted-foreground">
            {workspace.title}
            {report.created_at ? ` - ${new Date(report.created_at).toLocaleString("es-CL")}` : ""}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {sections.length ? (
            sections.map((s, idx) => (
              <section key={idx} className="space-y-2">
                <h2 className="text-base font-semibold">{s.heading}</h2>
                {Array.isArray(s.paragraphs) && s.paragraphs.length ? (
                  <div className="space-y-3">
                    {s.paragraphs.map((p: any, pIdx: number) => (
                      <p key={pIdx} className="whitespace-pre-wrap text-sm leading-6 text-foreground/95">
                        {p.text}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/95">{s.body}</p>
                )}
              </section>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Sin contenido.</p>
          )}

          {chronology.length ? (
            <div className="pt-2">
              <h3 className="text-sm font-semibold">Anexos - Cronologia</h3>
              <div className="mt-2 space-y-2">
                {chronology.slice(0, 80).map((e: any, idx: number) => (
                  <div key={idx} className="rounded-xl border border-border/55 bg-background/25 p-3">
                    <div className="text-xs text-muted-foreground">
                      {e.kind ? String(e.kind) : ""}
                      {e.occurredAt ? ` - ${new Date(e.occurredAt).toLocaleString("es-CL")}` : ""}
                    </div>
                    <div className="mt-1 text-sm font-medium">{e.title || "Hito"}</div>
                    {e.description ? (
                      <div className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                        {String(e.description)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {precedents.length ? (
            <div className="pt-2">
              <h3 className="text-sm font-semibold">Anexos - Precedentes usados</h3>
              <div className="mt-2 space-y-2">
                {precedents.slice(0, 10).map((p: any, idx: number) => (
                  <div key={idx} className="rounded-xl border border-border/55 bg-background/25 p-3">
                    <div className="text-xs text-muted-foreground">
                      {p.workspaceId && precedentWorkspaceTitleById.has(String(p.workspaceId))
                        ? precedentWorkspaceTitleById.get(String(p.workspaceId))
                        : "(sin acceso al precedente)"}
                      {p.createdAt && Number.isFinite(Date.parse(String(p.createdAt)))
                        ? ` - ${new Date(Date.parse(String(p.createdAt))).toLocaleDateString("es-CL")}`
                        : ""}
                      {p.templateId ? ` - template: ${String(p.templateId)}` : ""}
                    </div>
                    <div className="mt-1 text-sm font-medium">
                      score: {typeof p.score === "number" ? p.score.toFixed(3) : "n/a"}
                    </div>
                    {p.why ? <div className="mt-1 text-xs text-muted-foreground">{String(p.why)}</div> : null}

                    {p.workspaceId && p.reportId && precedentWorkspaceTitleById.has(String(p.workspaceId)) ? (
                      <div className="mt-2">
                        <Link
                          href={`/projects/${String(p.workspaceId)}/reports/${String(p.reportId)}`}
                          className="text-xs text-emerald-300 hover:text-emerald-200"
                        >
                          Abrir precedente
                        </Link>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {citations.length ? (
            <div className="pt-2">
              <h3 className="text-sm font-semibold">Citas</h3>
              <div className="mt-2 space-y-2">
                {citations.map((c, idx) => (
                  <div key={idx} className="rounded-xl border border-border/55 bg-background/25 p-3">
                    <div className="text-xs text-muted-foreground">
                      {c.sourceUrl ? (
                        <a href={c.sourceUrl} className="hover:text-foreground" target="_blank" rel="noreferrer">
                          {c.sourceUrl}
                        </a>
                      ) : (
                        "(sin URL)"
                      )}
                      {c.page ? ` - Pagina ${c.page}` : ""}
                      {c.section ? ` - ${c.section}` : ""}
                    </div>
                    {c.snapshotId ? (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {(() => {
                          const s = snapshotById.get(String(c.snapshotId))
                          const fetchedAt = s?.fetched_at || s?.created_at || null
                          const hash = s?.content_hash || null
                          return (
                            <>
                              snapshot_id: <span className="font-code text-foreground/90">{String(c.snapshotId)}</span>
                              {fetchedAt ? (
                                <>
                                  {" "}- snapshot_at: <span className="font-code text-foreground/90">{new Date(fetchedAt).toISOString()}</span>
                                </>
                              ) : null}
                              {hash ? (
                                <>
                                  {" "}- hash: <span className="font-code text-foreground/90">{String(hash)}</span>
                                </>
                              ) : null}
                            </>
                          )
                        })()}
                      </div>
                    ) : null}
                    <blockquote className="mt-2 border-l border-border/70 pl-3 text-sm italic text-foreground/90">
                      {c.quote}
                    </blockquote>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
