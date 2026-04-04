"use client"

import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Search } from "lucide-react"

type AuditRow = {
  id: string
  timestamp: string | null
  user_id: string | null
  action: string
  target_resource: string | null
  workspace_id: string | null
  workspace_title: string | null
  details: Record<string, unknown> | null
}

function previewPairs(record: Record<string, unknown> | null) {
  if (!record || typeof record !== "object") return []
  return Object.entries(record)
    .filter(([key, value]) => key !== "workspace_id" && value !== null && value !== undefined && value !== "")
    .slice(0, 5)
}

export function AuditDashboard({ logs }: { logs: AuditRow[] }) {
  const [search, setSearch] = useState("")
  const [actionFilter, setActionFilter] = useState("all")
  const [workspaceFilter, setWorkspaceFilter] = useState("all")

  const actionOptions = useMemo(
    () => Array.from(new Set(logs.map((log) => log.action).filter(Boolean))).slice(0, 120),
    [logs]
  )

  const workspaceOptions = useMemo(
    () => Array.from(new Set(logs.map((log) => log.workspace_title).filter(Boolean))) as string[],
    [logs]
  )

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return logs.filter((log) => {
      if (actionFilter !== "all" && log.action !== actionFilter) return false
      if (workspaceFilter !== "all" && log.workspace_title !== workspaceFilter) return false
      if (!needle) return true
      const haystack = [
        log.action,
        log.target_resource,
        log.workspace_title,
        log.workspace_id,
        log.user_id,
        ...previewPairs(log.details).flatMap(([key, value]) => [key, String(value)]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [actionFilter, logs, search, workspaceFilter])

  const feedbackSummary = useMemo(() => {
    return filtered.reduce(
      (acc, log) => {
        if (log.action !== "chat.message.feedback") return acc
        const vote = String(log.details?.vote || "")
        if (vote === "useful") acc.useful += 1
        if (vote === "not_useful") acc.notUseful += 1
        return acc
      },
      { useful: 0, notUseful: 0 }
    )
  }, [filtered])

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Card className="bg-background/35">
          <CardContent className="pt-4">
            <div className="text-[11px] text-muted-foreground">Eventos visibles</div>
            <div className="text-xl font-semibold">{filtered.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-background/35">
          <CardContent className="pt-4">
            <div className="text-[11px] text-muted-foreground">Acciones distintas</div>
            <div className="text-xl font-semibold">{new Set(filtered.map((log) => log.action)).size}</div>
          </CardContent>
        </Card>
        <Card className="bg-background/35">
          <CardContent className="pt-4">
            <div className="text-[11px] text-muted-foreground">Workspaces</div>
            <div className="text-xl font-semibold">{new Set(filtered.map((log) => log.workspace_id).filter(Boolean)).size}</div>
          </CardContent>
        </Card>
        <Card className="bg-background/35">
          <CardContent className="pt-4">
            <div className="text-[11px] text-muted-foreground">Recursos distintos</div>
            <div className="text-xl font-semibold">{new Set(filtered.map((log) => log.target_resource).filter(Boolean)).size}</div>
          </CardContent>
        </Card>
        <Card className="bg-background/35">
          <CardContent className="pt-4">
            <div className="text-[11px] text-muted-foreground">Feedback util</div>
            <div className="text-xl font-semibold">{feedbackSummary.useful}</div>
          </CardContent>
        </Card>
        <Card className="bg-background/35">
          <CardContent className="pt-4">
            <div className="text-[11px] text-muted-foreground">Feedback no util</div>
            <div className="text-xl font-semibold">{feedbackSummary.notUseful}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_240px_220px]">
        <div className="relative">
          <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por accion, usuario, recurso o detalle"
            className="pl-9"
          />
        </div>

        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Accion" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las acciones</SelectItem>
            {actionOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={workspaceFilter} onValueChange={setWorkspaceFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Workspace" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los workspaces</SelectItem>
            {workspaceOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length ? (
        <div className="overflow-x-auto rounded-xl border border-border/55">
          <table className="w-full text-left text-sm">
            <thead className="bg-background/35 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Accion</th>
                <th className="px-3 py-2">Workspace</th>
                <th className="px-3 py-2">Usuario</th>
                <th className="px-3 py-2">Recurso</th>
                <th className="px-3 py-2">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((log) => (
                <tr key={log.id} className="border-t border-border/55 align-top">
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {log.timestamp ? new Date(log.timestamp).toLocaleString("es-CL") : "-"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline">{log.action}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{log.workspace_title || "-"}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {log.user_id ? log.user_id.slice(0, 8) : "-"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{log.target_resource || "-"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {previewPairs(log.details).length ? (
                      <div className="flex max-w-[420px] flex-wrap gap-2">
                        {previewPairs(log.details).map(([key, value]) => (
                          <span key={`${log.id}_${key}`} className="rounded-full border border-border/50 bg-background/30 px-2.5 py-1">
                            {key}: {String(value)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
          No hay eventos que coincidan con los filtros.
        </div>
      )}
    </div>
  )
}
