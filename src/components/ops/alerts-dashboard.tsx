"use client"

import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Search } from "lucide-react"

type AlertRow = {
  id: string
  created_at: string | null
  workspace_id: string | null
  workspace_title: string | null
  message: string
  severity: string
  is_read: boolean
  metadata: Record<string, unknown> | null
}

function previewPairs(record: Record<string, unknown> | null) {
  if (!record || typeof record !== "object") return []
  return Object.entries(record)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .slice(0, 6)
}

export function AlertsDashboard({ alerts }: { alerts: AlertRow[] }) {
  const [search, setSearch] = useState("")
  const [severity, setSeverity] = useState("all")
  const [readFilter, setReadFilter] = useState("all")
  const [workspaceFilter, setWorkspaceFilter] = useState("all")

  const workspaceOptions = useMemo(
    () => Array.from(new Set(alerts.map((alert) => alert.workspace_title).filter(Boolean))) as string[],
    [alerts]
  )

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return alerts.filter((alert) => {
      if (severity !== "all" && alert.severity !== severity) return false
      if (readFilter === "read" && !alert.is_read) return false
      if (readFilter === "unread" && alert.is_read) return false
      if (workspaceFilter !== "all" && alert.workspace_title !== workspaceFilter) return false
      if (!needle) return true
      const haystack = [
        alert.message,
        alert.severity,
        alert.workspace_title,
        alert.workspace_id,
        ...previewPairs(alert.metadata).flatMap(([key, value]) => [key, String(value)]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [alerts, readFilter, search, severity, workspaceFilter])

  const unreadCount = filtered.filter((alert) => !alert.is_read).length

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="bg-background/35">
          <CardContent className="pt-4">
            <div className="text-[11px] text-muted-foreground">Alertas visibles</div>
            <div className="text-xl font-semibold">{filtered.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-background/35">
          <CardContent className="pt-4">
            <div className="text-[11px] text-muted-foreground">No leidas</div>
            <div className="text-xl font-semibold">{unreadCount}</div>
          </CardContent>
        </Card>
        <Card className="bg-background/35">
          <CardContent className="pt-4">
            <div className="text-[11px] text-muted-foreground">Criticas</div>
            <div className="text-xl font-semibold">{filtered.filter((alert) => alert.severity === "critical").length}</div>
          </CardContent>
        </Card>
        <Card className="bg-background/35">
          <CardContent className="pt-4">
            <div className="text-[11px] text-muted-foreground">Workspaces con alertas</div>
            <div className="text-xl font-semibold">{new Set(filtered.map((alert) => alert.workspace_id).filter(Boolean)).size}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_180px_220px]">
        <div className="relative">
          <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por mensaje, workspace o metadata"
            className="pl-9"
          />
        </div>

        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger>
            <SelectValue placeholder="Severidad" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>

        <Select value={readFilter} onValueChange={setReadFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Lectura" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="unread">Solo nuevas</SelectItem>
            <SelectItem value="read">Solo leidas</SelectItem>
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
        <div className="space-y-3">
          {filtered.map((alert) => (
            <div key={alert.id} className="rounded-xl border border-border/55 bg-background/25 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{alert.message}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {alert.created_at ? new Date(alert.created_at).toLocaleString("es-CL") : "-"}
                    {alert.workspace_title ? ` · ${alert.workspace_title}` : ""}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Badge variant="outline">{alert.severity}</Badge>
                  <Badge
                    variant="outline"
                    className={alert.is_read ? "opacity-60" : "border-emerald-500/25 text-emerald-200"}
                  >
                    {alert.is_read ? "Leida" : "Nueva"}
                  </Badge>
                </div>
              </div>

              {previewPairs(alert.metadata).length ? (
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  {previewPairs(alert.metadata).map(([key, value]) => (
                    <span key={`${alert.id}_${key}`} className="rounded-full border border-border/50 bg-background/35 px-2.5 py-1">
                      {key}: {String(value)}
                    </span>
                  ))}
                </div>
              ) : null}

              {!alert.is_read ? (
                <div className="mt-3">
                  <form action={`/api/alerts/${alert.id}/read`} method="post">
                    <button className="text-xs text-emerald-200 hover:text-foreground" type="submit">
                      Marcar como leida
                    </button>
                  </form>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
          No hay alertas que coincidan con los filtros.
        </div>
      )}
    </div>
  )
}
