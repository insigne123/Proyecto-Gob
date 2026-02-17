import Link from "next/link"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft } from "lucide-react"

export default async function AuditPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const { data: logs } = await supabase
    .from("gob_audit_logs")
    .select("id,timestamp,user_id,action,target_resource,details")
    .order("timestamp", { ascending: false })
    .limit(200)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
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
          <CardTitle className="text-base">Auditoria</CardTitle>
        </CardHeader>
        <CardContent>
          {logs?.length ? (
            <div className="overflow-x-auto rounded-xl border border-border/55">
              <table className="w-full text-left text-sm">
                <thead className="bg-background/35 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Accion</th>
                    <th className="px-3 py-2">Usuario</th>
                    <th className="px-3 py-2">Recurso</th>
                    <th className="px-3 py-2">Detalles</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} className="border-t border-border/55">
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {l.timestamp ? new Date(l.timestamp).toLocaleString("es-CL") : ""}
                      </td>
                      <td className="px-3 py-2 font-medium">{l.action}</td>
                      <td className="px-3 py-2 font-code text-xs">
                        {(l.user_id as any)?.slice?.(0, 8) || "-"}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {l.target_resource || ""}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {l.details ? JSON.stringify(l.details) : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Sin eventos.</div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
