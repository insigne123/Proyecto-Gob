"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Mail,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  Sheet,
  Trash2,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

type Provider = "google" | "microsoft"

type OAuthConnection = {
  id: string
  provider: Provider
  created_at: string | null
}

type WatchlistRow = {
  id: string
  provider: Provider
  connection_id?: string | null
  file_id?: string | null
  file_name: string | null
  sheet_name?: string | null
  status: string
  next_check_at: string | null
  next_email_at?: string | null
  email_schedule?: { type?: "daily" | "immediate" | "interval"; time?: string | null; interval_minutes?: number | null } | null
  key_columns?: string[]
  watched_columns?: string[]
  check_every_minutes?: number | null
  recipients?: string[]
  rules?: Record<string, any> | null
}

type ProviderFile = {
  id: string
  name: string
  provider: Provider
  modifiedAt: string | null
  webUrl: string | null
  mimeType: string | null
}

type PreviewPayload = {
  file: {
    id: string
    name: string
    provider: Provider
    modifiedAt: string | null
    webUrl: string | null
    mimeType: string | null
  }
  sheetNames: string[]
  selectedSheet: string
  rowCount: number
  columns: string[]
  sampleRows: Array<Record<string, any>>
}

type WatchedRowSelection = {
  rowKey: string
  label: string
}

type WatchedCellSelection = {
  rowKey: string
  rowLabel: string
  column: string
}

type CellContextMenu = {
  x: number
  y: number
  rowKey: string
  rowLabel: string
  column: string
}

type WatchRule = {
  type: "column_changed" | "column_equals" | "new_row" | "removed_row" | "column_condition"
  column?: string
  equals?: string
  operator?: "equals" | "contains" | "empty" | "not_empty" | "gt" | "gte" | "lt" | "lte"
  trigger?: "changed" | "current"
  value?: string
  severity?: "info" | "warning" | "critical"
  message?: string
}

function connectionLabel(connection: OAuthConnection, index: number) {
  const provider = connection.provider === "google" ? "Google Drive" : "OneDrive"
  const createdAt = connection.created_at ? new Date(connection.created_at).toLocaleDateString("es-CL") : "sin fecha"
  return `${provider} · cuenta ${index + 1} · ${createdAt}`
}

function ruleSummary(rule: WatchRule) {
  if (rule.type === "new_row") return "Alerta cuando aparezca una fila nueva."
  if (rule.type === "removed_row") return "Alerta cuando desaparezca una fila existente."
  if (rule.type === "column_changed") return rule.column ? `Alerta si cambia la columna ${rule.column}.` : "Alerta si cambia una columna elegida."
  if (rule.type === "column_equals") {
    return rule.column && rule.equals
      ? `Alerta cuando ${rule.column} pase a ser ${rule.equals}.`
      : "Alerta cuando una columna tome un valor exacto."
  }

  const trigger = rule.trigger === "current" ? "estado actual" : "cambio detectado"
  const operatorMap: Record<string, string> = {
    equals: "sea igual a",
    contains: "contenga",
    empty: "quede vacia",
    not_empty: "tenga valor",
    gt: "sea mayor que",
    gte: "sea mayor o igual que",
    lt: "sea menor que",
    lte: "sea menor o igual que",
  }
  const operatorLabel = operatorMap[rule.operator || "equals"] || "cumpla la condicion"
  const suffix = rule.value && !["empty", "not_empty"].includes(rule.operator || "equals") ? ` ${rule.value}` : ""
  return rule.column
    ? `Evalua ${rule.column} sobre ${trigger}: ${operatorLabel}${suffix}.`
    : "Evalua una condicion de columna personalizada."
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = value.trim()
    if (!clean) continue
    if (seen.has(clean.toLowerCase())) continue
    seen.add(clean.toLowerCase())
    out.push(clean)
  }
  return out
}

function parseCsv(raw: string) {
  return uniqueStrings(
    raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
  )
}

function normalizeColumnName(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function isSameColumn(a: string, b: string) {
  return normalizeColumnName(a) === normalizeColumnName(b)
}

function uniqueColumns(values: string[]) {
  const out: string[] = []
  for (const value of values) {
    const clean = String(value || "").trim()
    if (!clean) continue
    if (out.some((x) => isSameColumn(x, clean))) continue
    out.push(clean)
  }
  return out
}

function sortColumnsAlphabetically(values: string[]) {
  return [...values].sort((a, b) => a.localeCompare(b, "es-CL", { sensitivity: "base" }))
}

function getRowValueByConfiguredColumn(row: Record<string, any>, configuredColumn: string) {
  if (configuredColumn in row) return row?.[configuredColumn]
  const normalizedTarget = normalizeColumnName(configuredColumn)
  const actualKey = Object.keys(row || {}).find((key) => normalizeColumnName(key) === normalizedTarget)
  return actualKey ? row?.[actualKey] : null
}

function buildPreviewRowKey(row: Record<string, any>, keyColumns: string[]) {
  const cols = uniqueColumns(keyColumns)
  if (!cols.length) return null
  const parts = cols.map((column) => String(getRowValueByConfiguredColumn(row, column) ?? "").trim())
  if (parts.every((part) => !part)) return null
  return parts.join("|")
}

function buildPreviewRowLabel(row: Record<string, any>, keyColumns: string[], index: number) {
  const cols = uniqueColumns(keyColumns)
  const parts = cols
    .map((column) => {
      const value = String(getRowValueByConfiguredColumn(row, column) ?? "").trim()
      if (!value) return null
      return `${column}: ${value}`
    })
    .filter(Boolean)
  return parts.length ? parts.join(" · ") : `Fila ${index + 1}`
}

function pickColumnsByKeywords(columns: string[], keywords: string[]) {
  const normalizedKeywords = keywords.map((k) => normalizeColumnName(k))
  return columns.filter((column) => {
    const colNorm = normalizeColumnName(column)
    if (!colNorm) return false
    return normalizedKeywords.some((key) => colNorm.includes(key))
  })
}

type MonitorGroup = {
  id: string
  label: string
  description: string
  keywords: string[]
}

const MONITOR_GROUPS: MonitorGroup[] = [
  {
    id: "estado",
    label: "Estado procesal",
    description: "Cambios de estado, observaciones, admisibilidad y resultado.",
    keywords: [
      "estado",
      "observacion",
      "resultado sentencia",
      "resultado sentencia corte",
      "admisibilidad",
      "materias",
      "evacuado informe",
      "alegato",
      "acuerdo",
    ],
  },
  {
    id: "roles",
    label: "Roles y tribunal",
    description: "ROL TA/ICA/CS, tribunal y region.",
    keywords: ["rol", "tribunal", "region", "rol ica", "rol cs"],
  },
  {
    id: "proyecto",
    label: "Proyecto y partes",
    description: "Proyecto, caratula, recurrente y recurrida.",
    keywords: ["proyecto", "caratula", "recurrente", "recurrida", "conector"],
  },
  {
    id: "fechas",
    label: "Fechas clave",
    description: "Ingresos, resoluciones y fechas de movimiento.",
    keywords: ["fecha", "ingreso recurso", "sentencia", "evacuado", "notificacion"],
  },
]

function buildRecommendedWatchColumns(columns: string[], keyColumns: string[]) {
  const groupColumns = MONITOR_GROUPS.flatMap((group) => pickColumnsByKeywords(columns, group.keywords))
  const filtered = groupColumns.filter(
    (column) => !keyColumns.some((keyColumn) => isSameColumn(keyColumn, column))
  )

  const deduped = uniqueColumns(filtered)
  if (deduped.length) return deduped

  return columns
    .filter((column) => !keyColumns.some((keyColumn) => isSameColumn(keyColumn, column)))
    .slice(0, 10)
}

function buildWatchColumnsFromGroups(columns: string[], keyColumns: string[], selectedGroupIds: string[]) {
  const selectedGroups = MONITOR_GROUPS.filter((group) => selectedGroupIds.includes(group.id))
  const picked = selectedGroups.flatMap((group) => pickColumnsByKeywords(columns, group.keywords))
  const filtered = picked.filter(
    (column) => !keyColumns.some((keyColumn) => isSameColumn(keyColumn, column))
  )
  return uniqueColumns(filtered)
}

function pickDefaultKeyColumns(columns: string[]) {
  const tribunal = columns.find((c) => normalizeColumnName(c).includes("tribunal")) || null
  const rol =
    columns.find((c) => {
      const n = normalizeColumnName(c)
      return n === "rol" || n.includes("numero de rol") || n.includes("n de rol") || n.includes("rol causa")
    }) || null

  const selected = [tribunal, rol].filter(Boolean) as string[]
  if (selected.length >= 2) return selected

  if (selected.length === 1) {
    const fallback = columns.find((c) => c.toLowerCase() !== selected[0].toLowerCase())
    return fallback ? [selected[0], fallback] : selected
  }

  return columns[0] ? [columns[0]] : []
}

function formatDate(iso: string | null) {
  if (!iso) return "-"
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return "-"
  return new Date(ts).toLocaleString("es-CL")
}

function ColumnTagsEditor(props: {
  label: string
  value: string[]
  onChange: (next: string[]) => void
  suggestions: string[]
  placeholder: string
  hint?: string
}) {
  const { label, value, onChange, suggestions, placeholder, hint } = props
  const [draft, setDraft] = useState("")
  const sortedSuggestions = useMemo(() => sortColumnsAlphabetically(suggestions), [suggestions])

  function addDraft() {
    const parsed = parseCsv(draft)
    if (parsed.length === 0) return
    onChange(uniqueStrings([...value, ...parsed]))
    setDraft("")
  }

  function removeColumn(column: string) {
    onChange(value.filter((v) => v.toLowerCase() !== column.toLowerCase()))
  }

  function addSuggestion(column: string) {
    onChange(uniqueStrings([...value, column]))
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault()
              addDraft()
            }
          }}
        />
        <Button type="button" variant="outline" onClick={addDraft}>
          Agregar
        </Button>
      </div>

      {value.length ? (
        <div className="flex flex-wrap gap-2">
          {value.map((column) => (
            <button
              key={column}
              type="button"
              onClick={() => removeColumn(column)}
              className="rounded-full border border-border/60 bg-background/30 px-2.5 py-1 text-xs hover:bg-background/50"
              title="Quitar"
            >
              {column} x
            </button>
          ))}
        </div>
      ) : null}

      {sortedSuggestions.length ? (
        <div className="space-y-1">
          <div className="text-[11px] text-muted-foreground">Sugerencias detectadas</div>
          <div className="flex flex-wrap gap-2">
            {sortedSuggestions.map((column) => {
              const exists = value.some((v) => v.toLowerCase() === column.toLowerCase())
              return (
                <button
                  key={column}
                  type="button"
                  disabled={exists}
                  onClick={() => addSuggestion(column)}
                  className="rounded-full border border-border/60 bg-background/20 px-2.5 py-1 text-xs hover:bg-background/40 disabled:opacity-45"
                >
                  {column}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

export function WatchlistsManager({
  workspaceId,
  workspaceTitle,
}: {
  workspaceId: string
  workspaceTitle: string
}) {
  const [connections, setConnections] = useState<OAuthConnection[]>([])
  const [watchlists, setWatchlists] = useState<WatchlistRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [watchProvider, setWatchProvider] = useState<Provider>("google")
  const [watchConnectionId, setWatchConnectionId] = useState("")

  const [fileQuery, setFileQuery] = useState("")
  const [fileResults, setFileResults] = useState<ProviderFile[]>([])
  const [selectedFile, setSelectedFile] = useState<ProviderFile | null>(null)
  const [isSearchingFiles, setIsSearchingFiles] = useState(false)
  const [filesError, setFilesError] = useState<string | null>(null)

  const [preview, setPreview] = useState<PreviewPayload | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [editingWatchlistId, setEditingWatchlistId] = useState<string | null>(null)

  const [sheetName, setSheetName] = useState("")
  const [keyColumns, setKeyColumns] = useState<string[]>([])
  const [watchedColumns, setWatchedColumns] = useState<string[]>([])
  const [watchedRows, setWatchedRows] = useState<WatchedRowSelection[]>([])
  const [watchedCells, setWatchedCells] = useState<WatchedCellSelection[]>([])
  const [immediateColumns, setImmediateColumns] = useState<string[]>([])
  const [immediateCells, setImmediateCells] = useState<WatchedCellSelection[]>([])
  const [cellContextMenu, setCellContextMenu] = useState<CellContextMenu | null>(null)
  const [monitorMode, setMonitorMode] = useState<"recommended" | "all" | "custom">("recommended")
  const [monitorGroups, setMonitorGroups] = useState<string[]>(["estado", "roles", "proyecto", "fechas"])
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false)
  const [checkEveryMinutes, setCheckEveryMinutes] = useState(15)
  const [emailSchedule, setEmailSchedule] = useState<"daily" | "immediate" | "interval">("daily")
  const [emailTime, setEmailTime] = useState("18:00")
  const [emailEveryMinutes, setEmailEveryMinutes] = useState(60)
  const [recipients, setRecipients] = useState("")
  const [watchRules, setWatchRules] = useState<WatchRule[]>([])
  const [isSavingWatchlist, setIsSavingWatchlist] = useState(false)
  const [watchlistError, setWatchlistError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionInfo, setActionInfo] = useState<string | null>(null)
  const [oauthError, setOauthError] = useState<string | null>(null)
  const [actingWatchlistId, setActingWatchlistId] = useState<string | null>(null)
  const [actingKind, setActingKind] = useState<"pause" | "resume" | "check" | "delete" | null>(null)
  const [pendingDeleteWatchlist, setPendingDeleteWatchlist] = useState<WatchlistRow | null>(null)

  const searchParams = useSearchParams()

  const connectionsForProvider = useMemo(
    () => connections.filter((c) => c.provider === watchProvider),
    [connections, watchProvider]
  )

  const sampleRowSelections = useMemo(
    () =>
      (preview?.sampleRows || []).map((row, index) => ({
        index,
        row,
        rowKey: buildPreviewRowKey(row, keyColumns),
        rowLabel: buildPreviewRowLabel(row, keyColumns, index),
      })),
    [keyColumns, preview?.sampleRows]
  )

  function applyRecommendedConfig(columns: string[]) {
    const keys = pickDefaultKeyColumns(columns)
    setKeyColumns(keys)
    setWatchedColumns(buildRecommendedWatchColumns(columns, keys))
    setWatchedRows([])
    setWatchedCells([])
    setMonitorMode("recommended")
  }

  function applyAllColumnsConfig(columns: string[]) {
    const keys = pickDefaultKeyColumns(columns)
    setKeyColumns(keys)
    setWatchedColumns(
      columns.filter((column) => !keys.some((keyColumn) => isSameColumn(keyColumn, column)))
    )
    setWatchedRows([])
    setWatchedCells([])
    setMonitorMode("all")
  }

  function applyCustomGroupConfig(columns: string[], groups: string[]) {
    const keys = pickDefaultKeyColumns(columns)
    setKeyColumns(keys)
    const custom = buildWatchColumnsFromGroups(columns, keys, groups)
    setWatchedColumns(
      custom.length
        ? custom
        : buildRecommendedWatchColumns(columns, keys)
    )
    setWatchedRows([])
    setWatchedCells([])
    setMonitorMode("custom")
  }

  function resetBuilderForm() {
    setEditingWatchlistId(null)
    setFileQuery("")
    setFileResults([])
    setSelectedFile(null)
    setPreview(null)
    setPreviewError(null)
    setSheetName("")
    setKeyColumns([])
    setWatchedColumns([])
    setWatchedRows([])
    setWatchedCells([])
    setImmediateColumns([])
    setImmediateCells([])
    setCellContextMenu(null)
    setMonitorMode("recommended")
    setMonitorGroups(["estado", "roles", "proyecto", "fechas"])
    setShowAdvancedConfig(false)
    setCheckEveryMinutes(15)
    setEmailSchedule("daily")
    setEmailTime("18:00")
    setEmailEveryMinutes(60)
    setRecipients("")
    setWatchRules([])
    setWatchlistError(null)
  }

  function toggleKeyColumn(column: string) {
    setKeyColumns((prev) => {
      const exists = prev.some((item) => isSameColumn(item, column))
      const next = exists ? prev.filter((item) => !isSameColumn(item, column)) : uniqueColumns([...prev, column])
      return next
    })
    setWatchedColumns((prev) => prev.filter((item) => !isSameColumn(item, column)))
    setImmediateColumns((prev) => prev.filter((item) => !isSameColumn(item, column)))
    setImmediateCells((prev) => prev.filter((item) => !isSameColumn(item.column, column)))
    setWatchedRows([])
    setWatchedCells([])
  }

  function toggleWatchedColumn(column: string) {
    if (keyColumns.some((item) => isSameColumn(item, column))) return
    setWatchedColumns((prev) => {
      const exists = prev.some((item) => isSameColumn(item, column))
      return exists ? prev.filter((item) => !isSameColumn(item, column)) : uniqueColumns([...prev, column])
    })
  }

  function toggleImmediateColumn(column: string) {
    setImmediateColumns((prev) => {
      const exists = prev.some((item) => isSameColumn(item, column))
      return exists ? prev.filter((item) => !isSameColumn(item, column)) : uniqueColumns([...prev, column])
    })
  }

  function setKeyColumnsFromEditor(next: string[]) {
    setKeyColumns(next)
    setWatchedColumns((prev) => prev.filter((item) => !next.some((keyColumn) => isSameColumn(keyColumn, item))))
    setImmediateColumns((prev) => prev.filter((item) => !next.some((keyColumn) => isSameColumn(keyColumn, item))))
    setWatchedRows([])
    setWatchedCells([])
    setImmediateCells([])
    setCellContextMenu(null)
  }

  function toggleWatchedRow(rowKey: string, rowLabel: string) {
    if (!rowKey) return
    setWatchedRows((prev) => {
      const exists = prev.some((item) => item.rowKey === rowKey)
      return exists
        ? prev.filter((item) => item.rowKey !== rowKey)
        : [...prev, { rowKey, label: rowLabel }]
    })
  }

  function toggleWatchedCell(rowKey: string, rowLabel: string, column: string) {
    if (!rowKey || !column) return
    setWatchedCells((prev) => {
      const exists = prev.some((item) => item.rowKey === rowKey && isSameColumn(item.column, column))
      return exists
        ? prev.filter((item) => !(item.rowKey === rowKey && isSameColumn(item.column, column)))
        : [...prev, { rowKey, rowLabel, column }]
    })
  }

  function toggleImmediateCell(rowKey: string, rowLabel: string, column: string) {
    if (!rowKey || !column) return
    setImmediateCells((prev) => {
      const exists = prev.some((item) => item.rowKey === rowKey && isSameColumn(item.column, column))
      return exists
        ? prev.filter((item) => !(item.rowKey === rowKey && isSameColumn(item.column, column)))
        : [...prev, { rowKey, rowLabel, column }]
    })
  }

  async function loadAll() {
    setLoadError(null)

    const [connectionsRes, watchlistsRes] = await Promise.all([
      fetch("/api/oauth/connections"),
      fetch(`/api/workspaces/${workspaceId}/watchlists`),
    ])
    const [connectionsJson, watchlistsJson] = await Promise.all([
      connectionsRes.json().catch(() => null),
      watchlistsRes.json().catch(() => null),
    ])

    if (!connectionsRes.ok) {
      throw new Error(connectionsJson?.error || "No se pudieron cargar conexiones")
    }
    if (!watchlistsRes.ok) {
      throw new Error(watchlistsJson?.error || "No se pudieron cargar monitores")
    }

    setConnections(connectionsJson?.connections ?? [])
    setWatchlists(watchlistsJson?.watchlists ?? [])
  }

  useEffect(() => {
    let alive = true

    setIsLoading(true)
    loadAll()
      .catch((err: any) => {
        if (!alive) return
        setLoadError(err?.message ?? "Error al cargar datos")
      })
      .finally(() => {
        if (alive) setIsLoading(false)
      })

    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  useEffect(() => {
    if (connectionsForProvider.some((c) => c.id === watchConnectionId)) return
    setWatchConnectionId(connectionsForProvider[0]?.id ?? "")
  }, [connectionsForProvider, watchConnectionId])

  useEffect(() => {
    const code = searchParams.get("oauth_error")
    if (!code) {
      setOauthError(null)
      return
    }

    if (code === "google_app_not_configured") {
      setOauthError(
        "Falta configurar GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET en el servidor. Esto no fija un Drive unico: cada usuario autoriza su propia cuenta de Google."
      )
      return
    }

    if (code === "microsoft_app_not_configured") {
      setOauthError(
        "Falta configurar MICROSOFT_CLIENT_ID/MICROSOFT_CLIENT_SECRET en el servidor. Cada usuario conecta su propia cuenta de OneDrive."
      )
      return
    }

    setOauthError("No se pudo iniciar OAuth. Revisa la configuracion del proveedor.")
  }, [searchParams])

  useEffect(() => {
    if (editingWatchlistId) return
    setFileResults([])
    setSelectedFile(null)
    setPreview(null)
    setPreviewError(null)
    setSheetName("")
    setKeyColumns([])
    setWatchedColumns([])
    setMonitorMode("recommended")
    setMonitorGroups(["estado", "roles", "proyecto", "fechas"])
    setShowAdvancedConfig(false)
  }, [editingWatchlistId, watchConnectionId])

  async function searchFiles() {
    setFilesError(null)
    if (!watchConnectionId) {
      setFilesError("Selecciona una conexion primero")
      return
    }

    setIsSearchingFiles(true)
    try {
      const params = new URLSearchParams()
      params.set("connectionId", watchConnectionId)
      if (fileQuery.trim()) params.set("q", fileQuery.trim())

      const response = await fetch(
        `/api/workspaces/${workspaceId}/watchlists/files?${params.toString()}`
      )
      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || "No se pudieron listar archivos")
      }

      setFileResults(Array.isArray(json?.files) ? json.files : [])
    } catch (err: any) {
      setFilesError(err?.message ?? "Error al listar archivos")
      setFileResults([])
    } finally {
      setIsSearchingFiles(false)
    }
  }

  async function loadPreview(params: {
    file: ProviderFile
    desiredSheet?: string
    seedColumns?: boolean
    connectionIdOverride?: string
    preserveConfiguredColumns?: boolean
  }) {
    setPreviewError(null)
    setIsPreviewLoading(true)

    try {
      const query = new URLSearchParams()
      query.set("connectionId", params.connectionIdOverride || watchConnectionId)
      query.set("fileId", params.file.id)
      if (params.desiredSheet) query.set("sheetName", params.desiredSheet)

      const response = await fetch(
        `/api/workspaces/${workspaceId}/watchlists/preview?${query.toString()}`
      )
      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || "No se pudo cargar previsualizacion")
      }

      const data = json as PreviewPayload
      setPreview(data)
      setSheetName(data.selectedSheet || "")

      if (params.seedColumns) {
        setMonitorGroups(["estado", "roles", "proyecto", "fechas"])
        applyRecommendedConfig(data.columns)
      } else if (params.preserveConfiguredColumns) {
        // Keep existing manual configuration when editing an existing monitor.
      } else {
        if (monitorMode === "all") {
          applyAllColumnsConfig(data.columns)
        } else if (monitorMode === "custom") {
          applyCustomGroupConfig(data.columns, monitorGroups)
        } else {
          applyRecommendedConfig(data.columns)
        }
      }
    } catch (err: any) {
      setPreview(null)
      setPreviewError(err?.message ?? "Error al previsualizar")
    } finally {
      setIsPreviewLoading(false)
    }
  }

  async function selectFile(file: ProviderFile) {
    setEditingWatchlistId(null)
    setSelectedFile(file)
    setPreview(null)
    setKeyColumns([])
    setWatchedColumns([])
    setMonitorMode("recommended")
    setMonitorGroups(["estado", "roles", "proyecto", "fechas"])
    setShowAdvancedConfig(false)
    setWatchlistError(null)
    await loadPreview({ file, seedColumns: true })
  }

  async function editWatchlist(watchlist: WatchlistRow) {
    const connectionId = String(watchlist.connection_id || "")
    const fileId = String(watchlist.file_id || "")
    if (!connectionId || !fileId) {
      setActionError("Este monitor no tiene suficiente informacion para editarse desde la UI.")
      return
    }

    const file: ProviderFile = {
      id: fileId,
      name: watchlist.file_name || "Archivo",
      provider: watchlist.provider,
      modifiedAt: null,
      webUrl: null,
      mimeType: null,
    }

    setActionError(null)
    setActionInfo(`Editando monitor: ${watchlist.file_name || "Archivo"}`)
    setEditingWatchlistId(watchlist.id)
    setWatchProvider(watchlist.provider)
    setWatchConnectionId(connectionId)
    setSelectedFile(file)
    setSheetName(String(watchlist.sheet_name || ""))
    setKeyColumns(Array.isArray(watchlist.key_columns) ? watchlist.key_columns : [])
    setWatchedColumns(Array.isArray(watchlist.watched_columns) ? watchlist.watched_columns : [])
    setWatchedRows(
      Array.isArray((watchlist.rules as any)?.watched_rows)
        ? ((watchlist.rules as any).watched_rows as WatchedRowSelection[])
        : []
    )
    setWatchedCells(
      Array.isArray((watchlist.rules as any)?.watched_cells)
        ? ((watchlist.rules as any).watched_cells as WatchedCellSelection[])
        : []
    )
    setImmediateColumns(
      Array.isArray((watchlist.rules as any)?.immediate_columns)
        ? ((watchlist.rules as any).immediate_columns as string[])
        : []
    )
    setImmediateCells(
      Array.isArray((watchlist.rules as any)?.immediate_cells)
        ? ((watchlist.rules as any).immediate_cells as WatchedCellSelection[])
        : []
    )
    setCellContextMenu(null)
    setCheckEveryMinutes(Math.max(1, Math.min(1440, Number(watchlist.check_every_minutes || 15))))
    setEmailSchedule((watchlist.email_schedule?.type as any) || "daily")
    setEmailTime(String(watchlist.email_schedule?.time || "18:00"))
    setEmailEveryMinutes(Math.max(5, Math.min(10080, Number(watchlist.email_schedule?.interval_minutes || 60))))
    setRecipients(Array.isArray(watchlist.recipients) ? watchlist.recipients.join(", ") : "")

    const extractedRules = Array.isArray((watchlist.rules as any)?.rules)
      ? ((watchlist.rules as any).rules as WatchRule[])
      : []
    setWatchRules(extractedRules)
    setShowAdvancedConfig(false)

    await loadPreview({
      file,
      desiredSheet: String(watchlist.sheet_name || "") || undefined,
      seedColumns: false,
      connectionIdOverride: connectionId,
      preserveConfiguredColumns: true,
    })
  }

  async function saveWatchlist() {
    setWatchlistError(null)
    setActionError(null)
    setActionInfo(null)

    if (!watchConnectionId) {
      setWatchlistError("Selecciona una conexion")
      return
    }
    if (!selectedFile) {
      setWatchlistError("Selecciona un archivo")
      return
    }

    const uniqueKeyColumns = uniqueStrings(keyColumns)
    if (uniqueKeyColumns.length === 0) {
      setWatchlistError("Debes indicar al menos una columna clave")
      return
    }

    const uniqueWatchedColumns = uniqueStrings(
      watchedColumns.filter(
        (column) => !uniqueKeyColumns.some((k) => k.toLowerCase() === column.toLowerCase())
      )
    )
    const uniqueWatchedRows = watchedRows.filter((row, index, all) => {
      if (!row.rowKey) return false
      return all.findIndex((candidate) => candidate.rowKey === row.rowKey) === index
    })
    const uniqueWatchedCells = watchedCells.filter((cell, index, all) => {
      if (!cell.rowKey || !cell.column) return false
      return (
        all.findIndex(
          (candidate) => candidate.rowKey === cell.rowKey && isSameColumn(candidate.column, cell.column)
        ) === index
      )
    })

    if (
      uniqueWatchedColumns.length === 0 &&
      uniqueWatchedRows.length === 0 &&
      uniqueWatchedCells.length === 0
    ) {
      setWatchlistError("Selecciona al menos una columna, fila o celda a monitorear")
      return
    }

    const uniqueImmediateColumns = uniqueStrings(
      immediateColumns.filter(
        (column) => !uniqueKeyColumns.some((key) => isSameColumn(key, column))
      )
    )
    const uniqueImmediateCells = immediateCells.filter((cell, index, all) => {
      if (!cell.rowKey || !cell.column) return false
      return (
        all.findIndex(
          (candidate) => candidate.rowKey === cell.rowKey && isSameColumn(candidate.column, cell.column)
        ) === index
      )
    })

    setIsSavingWatchlist(true)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/watchlists`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          watchlistId: editingWatchlistId || undefined,
          provider: watchProvider,
          connectionId: watchConnectionId,
          fileId: selectedFile.id,
          fileName: selectedFile.name || null,
          sheetName: sheetName || null,
          keyColumns: uniqueKeyColumns,
          watchedColumns: uniqueWatchedColumns,
          checkEveryMinutes: Math.min(1440, Math.max(1, Number(checkEveryMinutes) || 15)),
          emailSchedule,
          emailTime,
          emailEveryMinutes:
            emailSchedule === "interval"
              ? Math.min(10080, Math.max(5, Number(emailEveryMinutes) || 60))
              : undefined,
          recipients: parseCsv(recipients),
          criticalAlerts: false,
          rules: {
            rules: watchRules,
            watched_rows: uniqueWatchedRows,
            watched_cells: uniqueWatchedCells,
            immediate_columns: uniqueImmediateColumns,
            immediate_cells: uniqueImmediateCells,
          },
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || "No se pudo crear el monitor")
      }

      setActionInfo(json?.mode === "updated" ? "Monitor actualizado." : "Monitor creado.")

      resetBuilderForm()

      await loadAll()
    } catch (err: any) {
      setWatchlistError(err?.message ?? "Error inesperado")
    } finally {
      setIsSavingWatchlist(false)
    }
  }

  function isActing(params: { watchlistId: string; kind?: "pause" | "resume" | "check" | "delete" }) {
    if (actingWatchlistId !== params.watchlistId) return false
    if (!params.kind) return true
    return actingKind === params.kind
  }

  async function runWatchlistAction(params: {
    watchlist: WatchlistRow
    kind: "pause" | "resume" | "check" | "delete"
  }) {
    const { watchlist, kind } = params
    if (kind === "delete") {
      setPendingDeleteWatchlist(watchlist)
      return
    }

    setActionError(null)
    setActionInfo(null)
    setActingWatchlistId(watchlist.id)
    setActingKind(kind)

    try {
      let response: Response
      if (kind === "check") {
        response = await fetch(
          `/api/workspaces/${workspaceId}/watchlists/${watchlist.id}/check`,
          {
            method: "POST",
          }
        )
      } else {
        response = await fetch(`/api/workspaces/${workspaceId}/watchlists/${watchlist.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: kind }),
        })
      }

      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || "No se pudo ejecutar la accion")
      }

      if (kind === "check") {
        if (json?.queued === false && json?.reason === "already_queued") {
          setActionInfo("Ya existe una revision pendiente o en curso para este monitor.")
        } else {
          setActionInfo("Revision manual encolada. Se ejecutara en breve.")
        }
      }

      if (kind === "pause") setActionInfo("Monitor pausado.")
      if (kind === "resume") setActionInfo("Monitor reanudado y revision encolada.")

      await loadAll()
    } catch (err: any) {
      setActionError(err?.message ?? "Error al ejecutar accion")
    } finally {
      setActingWatchlistId(null)
      setActingKind(null)
    }
  }

  async function confirmDeleteWatchlist() {
    if (!pendingDeleteWatchlist) return

    const watchlist = pendingDeleteWatchlist
    setActionError(null)
    setActionInfo(null)
    setActingWatchlistId(watchlist.id)
    setActingKind("delete")

    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/watchlists/${watchlist.id}`, {
        method: "DELETE",
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || "No se pudo ejecutar la accion")
      }

      setActionInfo("Monitor eliminado.")
      setPendingDeleteWatchlist(null)
      await loadAll()
    } catch (err: any) {
      setActionError(err?.message ?? "Error al ejecutar accion")
    } finally {
      setActingWatchlistId(null)
      setActingKind(null)
    }
  }

  const availableColumns = useMemo(() => preview?.columns ?? [], [preview])
  const groupMatches = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const group of MONITOR_GROUPS) {
      map[group.id] = pickColumnsByKeywords(availableColumns, group.keywords)
    }
    return map
  }, [availableColumns])

  useEffect(() => {
    setCellContextMenu(null)
  }, [preview, keyColumns])

  function toggleMonitorGroup(groupId: string) {
    const next = monitorGroups.includes(groupId)
      ? monitorGroups.filter((id) => id !== groupId)
      : [...monitorGroups, groupId]

    setMonitorGroups(next)
    applyCustomGroupConfig(availableColumns, next)
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8">
      <div className="mb-5">
        <Link
          href="/excel"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a Excel
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Monitor de Excel</h1>
          <p className="text-sm text-muted-foreground">{workspaceTitle}</p>
        </div>
        <Button variant="outline" className="gap-2" onClick={() => loadAll().catch(() => null)}>
          <RefreshCw className="h-4 w-4" />
          Actualizar
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="bg-card/70 lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Conexiones OAuth</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <a href={`/api/oauth/google/start?next=${encodeURIComponent(`/excel`)}`}>
                  Conectar Google Drive
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a
                  href={`/api/oauth/microsoft/start?next=${encodeURIComponent(`/excel`)}`}
                >
                  Conectar OneDrive
                </a>
              </Button>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">Total: {connections.length}</Badge>
              <Badge variant="outline" className="border-emerald-500/25 text-emerald-200">
                Google: {connections.filter((c) => c.provider === "google").length}
              </Badge>
              <Badge variant="outline" className="border-sky-500/25 text-sky-200">
                Microsoft: {connections.filter((c) => c.provider === "microsoft").length}
              </Badge>
            </div>

            <div className="text-xs text-muted-foreground">
              La app usa credenciales OAuth del sistema (Client ID/Secret) para identificarse, pero cada usuario autoriza su propio Google Drive/OneDrive.
            </div>

            {loadError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {loadError}
              </div>
            ) : null}

            {oauthError ? (
              <div className="rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                {oauthError}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="bg-card/70 lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              <span>{editingWatchlistId ? "Editar monitor" : "Configurar monitor"}</span>
              <div className="flex items-center gap-2">
                {editingWatchlistId ? (
                  <Badge variant="outline" className="border-emerald-500/35 text-emerald-200">
                    Edicion activa
                  </Badge>
                ) : null}
                <Button variant="outline" size="sm" onClick={resetBuilderForm}>
                  {editingWatchlistId ? "Cancelar edicion" : "Limpiar"}
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-border/55 bg-background/20 px-3 py-2 text-xs text-muted-foreground">
              Cada monitor funciona de forma independiente. Puedes configurar varios archivos, hojas y reglas dentro del mismo workspace.
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Proveedor</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background/35 px-3 py-2 text-sm"
                  value={watchProvider}
                  onChange={(e) => {
                    setEditingWatchlistId(null)
                    setWatchProvider(e.target.value as Provider)
                  }}
                >
                  <option value="google">Google Drive</option>
                  <option value="microsoft">OneDrive</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label>Conexion</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background/35 px-3 py-2 text-sm"
                  value={watchConnectionId}
                  onChange={(e) => {
                    setEditingWatchlistId(null)
                    setWatchConnectionId(e.target.value)
                  }}
                >
                  {connectionsForProvider.length ? (
                    connectionsForProvider.map((c, idx) => (
                      <option key={c.id} value={c.id}>
                        {connectionLabel(c, idx)}
                      </option>
                    ))
                  ) : (
                    <option value="">(sin conexion para este proveedor)</option>
                  )}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Buscar archivo</Label>
              <div className="flex gap-2">
                <Input
                  value={fileQuery}
                  onChange={(e) => setFileQuery(e.target.value)}
                  placeholder="Nombre del archivo (opcional)"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      searchFiles().catch(() => null)
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => searchFiles().catch(() => null)}
                  disabled={isSearchingFiles || !watchConnectionId}
                  className="gap-2"
                >
                  {isSearchingFiles ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  Buscar
                </Button>
              </div>
              {filesError ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {filesError}
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label>Resultados</Label>
              <ScrollArea className="h-48 rounded-xl border border-border/55 bg-background/20 p-2">
                <div className="space-y-2">
                  {fileResults.length ? (
                    fileResults.map((file) => {
                      const selected = selectedFile?.id === file.id
                      return (
                        <button
                          key={file.id}
                          type="button"
                          onClick={() => selectFile(file).catch(() => null)}
                          className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                            selected
                              ? "border-emerald-500/35 bg-emerald-500/10"
                              : "border-border/55 bg-background/20 hover:bg-background/40"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate text-sm font-medium">{file.name}</div>
                            <Badge variant="outline" className="text-[10px]">
                              {file.provider}
                            </Badge>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {formatDate(file.modifiedAt)}
                          </div>
                        </button>
                      )
                    })
                  ) : (
                    <div className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-sm text-muted-foreground">
                      {isSearchingFiles
                        ? "Buscando archivos..."
                        : "Sin resultados. Conecta una cuenta y presiona Buscar."}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>

            {selectedFile ? (
              <div className="rounded-xl border border-border/55 bg-background/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium">{selectedFile.name}</div>
                  {selectedFile.webUrl ? (
                    <a
                      href={selectedFile.webUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200"
                    >
                      Abrir archivo
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">ID: {selectedFile.id}</div>
              </div>
            ) : null}

            <div className="space-y-3 rounded-xl border border-border/55 bg-background/20 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Previsualizacion</div>
                {isPreviewLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
              </div>

              {previewError ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {previewError}
                </div>
              ) : null}

              {preview ? (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Hoja</Label>
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background/35 px-3 py-2 text-sm"
                        value={sheetName}
                        onChange={(e) => {
                          const next = e.target.value
                          setSheetName(next)
                          if (selectedFile) {
                            loadPreview({ file: selectedFile, desiredSheet: next }).catch(() => null)
                          }
                        }}
                      >
                        {preview.sheetNames.map((sheet) => (
                          <option key={sheet} value={sheet}>
                            {sheet}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Filas detectadas</Label>
                      <div className="flex h-10 items-center rounded-md border border-input bg-background/35 px-3 text-sm">
                        {preview.rowCount}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-lg border border-border/55 bg-background/25 p-3">
                    <div>
                      <div className="text-sm font-medium">Que quieres monitorear</div>
                      <div className="text-xs text-muted-foreground">
                        Elige un preset rapido y despues ajusta directamente sobre la hoja. La configuracion avanzada queda abajo como opcion secundaria.
                      </div>
                    </div>

                    <div className="grid gap-2 md:grid-cols-3">
                      <Button
                        type="button"
                        variant={monitorMode === "recommended" ? "default" : "outline"}
                        size="sm"
                        onClick={() => applyRecommendedConfig(availableColumns)}
                      >
                        Recomendado
                      </Button>
                      <Button
                        type="button"
                        variant={monitorMode === "all" ? "default" : "outline"}
                        size="sm"
                        onClick={() => applyAllColumnsConfig(availableColumns)}
                      >
                        Todo el archivo
                      </Button>
                      <Button
                        type="button"
                        variant={monitorMode === "custom" ? "default" : "outline"}
                        size="sm"
                        onClick={() => applyCustomGroupConfig(availableColumns, monitorGroups)}
                      >
                        Personalizado
                      </Button>
                    </div>

                    {monitorMode === "custom" ? (
                      <div className="grid gap-2 md:grid-cols-2">
                        {MONITOR_GROUPS.map((group) => {
                          const matched = groupMatches[group.id] || []
                          return (
                            <label
                              key={group.id}
                              className="flex items-start gap-2 rounded-md border border-border/55 bg-background/25 px-2.5 py-2"
                            >
                              <input
                                type="checkbox"
                                checked={monitorGroups.includes(group.id)}
                                onChange={() => toggleMonitorGroup(group.id)}
                                className="mt-0.5"
                              />
                              <div>
                                <div className="text-sm font-medium">{group.label}</div>
                                <div className="text-[11px] text-muted-foreground">{group.description}</div>
                                <div className="mt-1 text-[11px] text-muted-foreground">
                                  {matched.length ? `${matched.length} columnas detectadas` : "Sin columnas detectadas"}
                                </div>
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    ) : null}

                    <div className="rounded-md border border-border/55 bg-background/20 px-3 py-2">
                      <div className="text-[11px] text-muted-foreground">Identificador de fila</div>
                      <div className="text-xs">{keyColumns.join(" + ") || "(sin definir)"}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Es la combinacion de columnas que le dice al sistema cual fila es cual entre una revision y la siguiente. Ejemplo recomendado: `Tribunal + Rol` o un `ID` unico.
                      </div>
                      <div className="mt-2 text-[11px] text-muted-foreground">
                        Columnas monitoreadas: {watchedColumns.length} · Filas: {watchedRows.length} · Celdas: {watchedCells.length}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Alertas inmediatas especiales: columnas {immediateColumns.length} · celdas {immediateCells.length}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {watchedColumns.slice(0, 12).map((column) => (
                          <span
                            key={column}
                            className="rounded-full border border-border/55 bg-background/25 px-2 py-0.5 text-[11px] text-muted-foreground"
                          >
                            {column}
                          </span>
                        ))}
                        {watchedColumns.length > 12 ? (
                          <span className="rounded-full border border-border/55 bg-background/25 px-2 py-0.5 text-[11px] text-muted-foreground">
                            +{watchedColumns.length - 12} mas
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 rounded-lg border border-border/55 bg-background/25 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium">Configuracion avanzada</div>
                        <div className="text-[11px] text-muted-foreground">Usala solo si quieres editar manualmente columnas, filas o reglas.</div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowAdvancedConfig((prev) => !prev)}
                      >
                        {showAdvancedConfig ? "Ocultar" : "Editar manualmente"}
                      </Button>
                    </div>

                    {showAdvancedConfig ? (
                      <>
                        <ColumnTagsEditor
                          label="Identificador de fila"
                          value={keyColumns}
                          onChange={setKeyColumnsFromEditor}
                          suggestions={availableColumns}
                          placeholder="Ej: Tribunal, Rol"
                          hint="Usa columnas estables que identifiquen una fila de forma unica. Evita Estado u Observaciones porque esas cambian." 
                        />

                        <ColumnTagsEditor
                          label="Columnas a monitorear"
                          value={watchedColumns}
                          onChange={setWatchedColumns}
                          suggestions={availableColumns.filter(
                            (column) => !keyColumns.some((k) => isSameColumn(k, column))
                          )}
                          placeholder="Ej: Estado, Observaciones"
                          hint="Solo estas columnas disparan cambios en el diff."
                        />
                      </>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        Usa esta seccion solo si quieres controlar manualmente columnas clave y columnas monitoreadas. La seleccion principal deberia hacerse desde la vista tipo hoja.
                      </div>
                    )}
                  </div>

                  {preview.sampleRows.length ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <Label>Vista tipo spreadsheet</Label>
                          <div className="text-[11px] text-muted-foreground">
                            Click en encabezado para monitorear columna, click en numero de fila para monitorear fila y click derecho en celda para monitorear solo esa casilla.
                          </div>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {keyColumns.length ? "El identificador de fila ya permite seleccionar filas y celdas." : "Primero define el identificador de fila si quieres monitorear filas o celdas."}
                        </div>
                      </div>

                      <div className="rounded-lg border border-border/55 bg-background/20 px-3 py-2 text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground">Como empezar:</span> 1) marca el identificador de fila, 2) haz click en las columnas importantes, 3) si quieres algo mas preciso, marca una fila o haz click derecho en una celda.
                      </div>

                      <div className="flex flex-wrap gap-2 text-[11px]">
                        <span className="rounded-full border border-sky-400/40 bg-sky-500/15 px-2 py-1 text-sky-200">Identificador de fila</span>
                        <span className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2 py-1 text-emerald-200">Columna monitoreada</span>
                        <span className="rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-1 text-amber-100">Fila monitoreada</span>
                        <span className="rounded-full border border-fuchsia-400/40 bg-fuchsia-500/15 px-2 py-1 text-fuchsia-100">Celda monitoreada</span>
                      </div>

                      {(watchedRows.length > 0 || watchedCells.length > 0) ? (
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded-xl border border-border/55 bg-background/20 p-3">
                            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Filas monitoreadas</div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {watchedRows.length ? watchedRows.map((row) => (
                                <button
                                  key={row.rowKey}
                                  type="button"
                                  onClick={() => toggleWatchedRow(row.rowKey, row.label)}
                                  className="rounded-full border border-amber-400/40 bg-amber-500/15 px-2.5 py-1 text-[11px] text-amber-100"
                                >
                                  {row.label} x
                                </button>
                              )) : <span className="text-xs text-muted-foreground">Sin filas seleccionadas.</span>}
                            </div>
                          </div>

                          <div className="rounded-xl border border-border/55 bg-background/20 p-3">
                            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Celdas monitoreadas</div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {watchedCells.length ? watchedCells.map((cell) => (
                                <button
                                  key={`${cell.rowKey}:${cell.column}`}
                                  type="button"
                                  onClick={() => toggleWatchedCell(cell.rowKey, cell.rowLabel, cell.column)}
                                  className="rounded-full border border-fuchsia-400/40 bg-fuchsia-500/15 px-2.5 py-1 text-[11px] text-fuchsia-100"
                                >
                                  {cell.rowLabel} · {cell.column} x
                                </button>
                              )) : <span className="text-xs text-muted-foreground">Sin celdas seleccionadas.</span>}
                            </div>
                          </div>
                        </div>
                      ) : null}

                      <div className="relative overflow-x-auto rounded-xl border border-border/55 bg-background/15" onClick={() => setCellContextMenu(null)}>
                        <table className="w-full min-w-[960px] text-left text-xs">
                          <thead className="sticky top-0 z-10 bg-background/90 text-muted-foreground backdrop-blur">
                            <tr>
                              <th className="w-12 px-2 py-2 text-center font-medium">#</th>
                              {availableColumns.slice(0, 24).map((column) => {
                                const isKey = keyColumns.some((item) => isSameColumn(item, column))
                                const isWatched = watchedColumns.some((item) => isSameColumn(item, column))
                                return (
                                  <th
                                    key={column}
                                    className={cn(
                                      "min-w-[180px] border-l border-border/40 px-2.5 py-2 align-top font-medium",
                                      isKey && "bg-sky-500/10",
                                      isWatched && "bg-emerald-500/10"
                                    )}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => toggleWatchedColumn(column)}
                                      className="w-full rounded-lg px-1 py-1 text-left hover:bg-background/30"
                                    >
                                      <div className="truncate text-foreground">{column}</div>
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        <span
                                          className={cn(
                                            "rounded-full border px-2 py-0.5 text-[10px]",
                                            isKey
                                              ? "border-sky-400/50 bg-sky-500/15 text-sky-200"
                                              : "border-border/55 bg-background/25"
                                          )}
                                          onClick={(event) => {
                                            event.stopPropagation()
                                            toggleKeyColumn(column)
                                          }}
                                        >
                                          {isKey ? "ID fila" : "Marcar ID fila"}
                                        </span>
                                        <span
                                          className={cn(
                                            "rounded-full border px-2 py-0.5 text-[10px]",
                                            isWatched
                                              ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
                                              : "border-border/55 bg-background/25"
                                          )}
                                        >
                                          {isWatched ? "Monitoreada" : "Click monitorea"}
                                        </span>
                                      </div>
                                    </button>
                                  </th>
                                )
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            {sampleRowSelections.slice(0, 14).map((sampleRow) => {
                              const rowKey = sampleRow.rowKey
                              const rowMonitored = rowKey ? watchedRows.some((item) => item.rowKey === rowKey) : false
                              return (
                                <tr key={sampleRow.index} className={cn("border-t border-border/55", rowMonitored && "bg-amber-500/8")}>
                                  <td className="px-2 py-2 text-center text-[11px]">
                                    <button
                                      type="button"
                                      disabled={!rowKey}
                                      onClick={() => rowKey && toggleWatchedRow(rowKey, sampleRow.rowLabel)}
                                      className={cn(
                                        "w-full rounded-md px-1 py-1 text-[11px] text-muted-foreground hover:bg-background/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45",
                                        rowMonitored && "bg-amber-500/15 text-amber-100"
                                      )}
                                      title={rowKey ? `Monitorear fila ${sampleRow.rowLabel}` : "Define un identificador de fila para monitorear esta fila"}
                                    >
                                      {sampleRow.index + 1}
                                    </button>
                                  </td>
                                  {availableColumns.slice(0, 24).map((column) => {
                                    const isKey = keyColumns.some((item) => isSameColumn(item, column))
                                    const isWatchedColumn = watchedColumns.some((item) => isSameColumn(item, column))
                                    const isWatchedCell = rowKey
                                      ? watchedCells.some((item) => item.rowKey === rowKey && isSameColumn(item.column, column))
                                      : false
                                    return (
                                      <td
                                        key={`${sampleRow.index}:${column}`}
                                        onContextMenu={(event) => {
                                          if (!rowKey) return
                                          event.preventDefault()
                                          setCellContextMenu({
                                            x: event.clientX,
                                            y: event.clientY,
                                            rowKey,
                                            rowLabel: sampleRow.rowLabel,
                                            column,
                                          })
                                        }}
                                        className={cn(
                                          "border-l border-border/40 px-2.5 py-2 align-top text-muted-foreground",
                                          isKey && "bg-sky-500/8 text-foreground",
                                          isWatchedColumn && "bg-emerald-500/8 text-foreground",
                                          rowMonitored && "bg-amber-500/5 text-foreground",
                                          isWatchedCell && "outline outline-1 outline-fuchsia-400/70 bg-fuchsia-500/10 text-foreground"
                                        )}
                                      >
                                        {String(sampleRow.row?.[column] ?? "")}
                                      </td>
                                    )
                                  })}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>

                        {cellContextMenu ? (
                          <div
                            className="fixed z-50 w-64 rounded-xl border border-border/70 bg-popover p-2 shadow-2xl"
                            style={{ left: cellContextMenu.x, top: cellContextMenu.y }}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <div className="border-b border-border/60 px-2 py-1 text-[11px] text-muted-foreground">
                              {cellContextMenu.rowLabel} · {cellContextMenu.column}
                            </div>
                            <div className="mt-2 space-y-1">
                              <button
                                type="button"
                                onClick={() => {
                                  toggleWatchedCell(cellContextMenu.rowKey, cellContextMenu.rowLabel, cellContextMenu.column)
                                  setCellContextMenu(null)
                                }}
                                className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-background/60"
                              >
                                {watchedCells.some((item) => item.rowKey === cellContextMenu.rowKey && isSameColumn(item.column, cellContextMenu.column))
                                  ? "Quitar monitoreo de esta celda"
                                  : "Monitorear esta celda"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  toggleWatchedRow(cellContextMenu.rowKey, cellContextMenu.rowLabel)
                                  setCellContextMenu(null)
                                }}
                                className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-background/60"
                              >
                                {watchedRows.some((item) => item.rowKey === cellContextMenu.rowKey)
                                  ? "Quitar monitoreo de esta fila"
                                  : "Monitorear toda esta fila"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  toggleWatchedColumn(cellContextMenu.column)
                                  setCellContextMenu(null)
                                }}
                                className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-background/60"
                              >
                                {watchedColumns.some((item) => isSameColumn(item, cellContextMenu.column))
                                  ? "Quitar monitoreo de esta columna"
                                  : "Monitorear esta columna"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  toggleImmediateColumn(cellContextMenu.column)
                                  setCellContextMenu(null)
                                }}
                                className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-background/60"
                              >
                                {immediateColumns.some((item) => isSameColumn(item, cellContextMenu.column))
                                  ? "Quitar alerta inmediata de esta columna"
                                  : "Alerta inmediata para esta columna"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  toggleImmediateCell(cellContextMenu.rowKey, cellContextMenu.rowLabel, cellContextMenu.column)
                                  setCellContextMenu(null)
                                }}
                                className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-background/60"
                              >
                                {immediateCells.some((item) => item.rowKey === cellContextMenu.rowKey && isSameColumn(item.column, cellContextMenu.column))
                                  ? "Quitar alerta inmediata de esta celda"
                                  : "Alerta inmediata para esta celda"}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Selecciona un archivo para detectar hojas y columnas automaticamente.
                </div>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Revisar cada (min)</Label>
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  value={checkEveryMinutes}
                  onChange={(e) => setCheckEveryMinutes(Number(e.target.value || 15))}
                />
              </div>
              <div className="space-y-2">
                <Label>Programacion correo</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background/35 px-3 py-2 text-sm"
                  value={emailSchedule}
                  onChange={(e) => setEmailSchedule(e.target.value as any)}
                >
                  <option value="daily">Diario</option>
                  <option value="immediate">Inmediato</option>
                  <option value="interval">Intervalo (minutos)</option>
                </select>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEmailSchedule("daily")
                      setCheckEveryMinutes(60)
                      setEmailTime("18:00")
                      setImmediateColumns([])
                      setImmediateCells([])
                    }}
                  >
                    Preset diario general
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEmailSchedule("daily")
                      setCheckEveryMinutes(15)
                      setEmailTime("18:00")
                      setImmediateColumns(watchedColumns.slice(0, 2))
                      setImmediateCells([])
                    }}
                  >
                    Preset causa critica
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Hora diaria (America/Santiago)</Label>
                <Input
                  value={emailTime}
                  onChange={(e) => setEmailTime(e.target.value)}
                  placeholder="18:00"
                  disabled={emailSchedule !== "daily"}
                />
              </div>
              <div className="space-y-2">
                <Label>Cada N minutos</Label>
                <Input
                  type="number"
                  min={5}
                  max={10080}
                  value={emailEveryMinutes}
                  onChange={(e) => setEmailEveryMinutes(Number(e.target.value || 60))}
                  disabled={emailSchedule !== "interval"}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Destinatarios (coma)</Label>
              <Input
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
                placeholder="equipo@..., jefatura@..."
              />
            </div>

            <div className="space-y-3 rounded-lg border border-border/55 bg-background/20 px-3 py-3">
              <div>
                <div className="text-sm font-medium">Alertas inmediatas especiales</div>
                <div className="text-xs text-muted-foreground">
                  Sirven para disparar un correo apenas cambie una columna o celda importante, aunque tu programacion normal sea diaria o por intervalo. Si arriba eliges `Inmediato`, entonces todos los cambios mandan correo altiro y estas reglas especiales dejan de ser necesarias.
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-border/55 bg-background/20 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Columnas con alerta inmediata</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {immediateColumns.length ? immediateColumns.map((column) => (
                      <button
                        key={`immediate_${column}`}
                        type="button"
                        onClick={() => toggleImmediateColumn(column)}
                        className="rounded-full border border-rose-400/40 bg-rose-500/15 px-2.5 py-1 text-[11px] text-rose-100"
                      >
                        {column} x
                      </button>
                    )) : <span className="text-xs text-muted-foreground">Sin columnas inmediatas.</span>}
                  </div>
                </div>

                <div className="rounded-xl border border-border/55 bg-background/20 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Celdas con alerta inmediata</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {immediateCells.length ? immediateCells.map((cell) => (
                      <button
                        key={`immediate_cell_${cell.rowKey}:${cell.column}`}
                        type="button"
                        onClick={() => toggleImmediateCell(cell.rowKey, cell.rowLabel, cell.column)}
                        className="rounded-full border border-rose-400/40 bg-rose-500/15 px-2.5 py-1 text-[11px] text-rose-100"
                      >
                        {cell.rowLabel} · {cell.column} x
                      </button>
                    )) : <span className="text-xs text-muted-foreground">Sin celdas inmediatas.</span>}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Reglas (alertas)</Label>
              <div className="space-y-2">
                {watchRules.map((rule, idx) => (
                  <div key={idx} className="rounded-xl border border-border/55 bg-background/20 p-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label className="text-xs">Tipo</Label>
                        <select
                          className="flex h-10 w-full rounded-md border border-input bg-background/35 px-3 py-2 text-sm"
                          value={rule.type}
                          onChange={(e) =>
                            setWatchRules((prev) => {
                              const next = [...prev]
                              next[idx] = { ...next[idx], type: e.target.value as WatchRule["type"] }
                              return next
                            })
                          }
                        >
                          <option value="column_changed">Cuando cambie columna</option>
                          <option value="column_equals">Cuando columna sea igual a...</option>
                          <option value="new_row">Cuando aparezca nueva fila</option>
                          <option value="removed_row">Cuando desaparezca fila</option>
                          <option value="column_condition">Condicion avanzada</option>
                        </select>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs">Severidad</Label>
                        <select
                          className="flex h-10 w-full rounded-md border border-input bg-background/35 px-3 py-2 text-sm"
                          value={rule.severity || "warning"}
                          onChange={(e) =>
                            setWatchRules((prev) => {
                              const next = [...prev]
                              next[idx] = {
                                ...next[idx],
                                severity: e.target.value as WatchRule["severity"],
                              }
                              return next
                            })
                          }
                        >
                          <option value="info">info</option>
                          <option value="warning">warning</option>
                          <option value="critical">critical</option>
                        </select>
                      </div>

                      {rule.type !== "new_row" && rule.type !== "removed_row" ? (
                        <div className="space-y-2 md:col-span-2">
                          <Label className="text-xs">Columna</Label>
                          <Input
                            value={rule.column || ""}
                            onChange={(e) =>
                              setWatchRules((prev) => {
                                const next = [...prev]
                                next[idx] = {
                                  ...next[idx],
                                  column: e.target.value,
                                }
                                return next
                              })
                            }
                            placeholder="Ej: Estado"
                          />
                          {availableColumns.length ? (
                            <div className="flex flex-wrap gap-1.5">
                              {availableColumns.slice(0, 12).map((column) => (
                                <button
                                  key={`${idx}_${column}`}
                                  type="button"
                                  onClick={() =>
                                    setWatchRules((prev) => {
                                      const next = [...prev]
                                      next[idx] = {
                                        ...next[idx],
                                        column,
                                      }
                                      return next
                                    })
                                  }
                                  className="rounded-full border border-border/55 bg-background/25 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                                >
                                  {column}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {rule.type === "column_equals" ? (
                        <div className="space-y-2 md:col-span-2">
                          <Label className="text-xs">Valor esperado</Label>
                          <Input
                            value={rule.equals || ""}
                            onChange={(e) =>
                              setWatchRules((prev) => {
                                const next = [...prev]
                                next[idx] = {
                                  ...next[idx],
                                  equals: e.target.value,
                                }
                                return next
                              })
                            }
                            placeholder="Ej: Critico"
                          />
                        </div>
                      ) : null}

                      {rule.type === "column_condition" ? (
                        <>
                          <div className="space-y-2">
                            <Label className="text-xs">Evaluar sobre</Label>
                            <select
                              className="flex h-10 w-full rounded-md border border-input bg-background/35 px-3 py-2 text-sm"
                              value={rule.trigger || "changed"}
                              onChange={(e) =>
                                setWatchRules((prev) => {
                                  const next = [...prev]
                                  next[idx] = {
                                    ...next[idx],
                                    trigger: e.target.value as WatchRule["trigger"],
                                  }
                                  return next
                                })
                              }
                            >
                              <option value="changed">Cambio detectado</option>
                              <option value="current">Estado actual de la fila</option>
                            </select>
                          </div>

                          <div className="space-y-2">
                            <Label className="text-xs">Operador</Label>
                            <select
                              className="flex h-10 w-full rounded-md border border-input bg-background/35 px-3 py-2 text-sm"
                              value={rule.operator || "equals"}
                              onChange={(e) =>
                                setWatchRules((prev) => {
                                  const next = [...prev]
                                  next[idx] = {
                                    ...next[idx],
                                    operator: e.target.value as WatchRule["operator"],
                                  }
                                  return next
                                })
                              }
                            >
                              <option value="equals">Igual a</option>
                              <option value="contains">Contiene</option>
                              <option value="empty">Vacio</option>
                              <option value="not_empty">No vacio</option>
                              <option value="gt">Mayor que</option>
                              <option value="gte">Mayor o igual que</option>
                              <option value="lt">Menor que</option>
                              <option value="lte">Menor o igual que</option>
                            </select>
                          </div>

                          {!(["empty", "not_empty"] as string[]).includes(rule.operator || "equals") ? (
                            <div className="space-y-2 md:col-span-2">
                              <Label className="text-xs">Valor de referencia</Label>
                              <Input
                                value={rule.value || ""}
                                onChange={(e) =>
                                  setWatchRules((prev) => {
                                    const next = [...prev]
                                    next[idx] = {
                                      ...next[idx],
                                      value: e.target.value,
                                    }
                                    return next
                                  })
                                }
                                placeholder="Ej: Admitido, 10, vencido"
                              />
                            </div>
                          ) : null}
                        </>
                      ) : null}

                      <div className="space-y-2 md:col-span-2">
                        <Label className="text-xs">Mensaje (opcional)</Label>
                        <Input
                          value={rule.message || ""}
                          onChange={(e) =>
                            setWatchRules((prev) => {
                              const next = [...prev]
                              next[idx] = {
                                ...next[idx],
                                message: e.target.value,
                              }
                              return next
                            })
                          }
                          placeholder="Ej: Estado paso a Critico"
                        />
                      </div>

                      <div className="rounded-lg border border-border/45 bg-background/25 px-3 py-2 text-xs text-muted-foreground md:col-span-2">
                        {ruleSummary(rule)}
                      </div>
                    </div>

                    <div className="mt-3 flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setWatchRules((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        Eliminar regla
                      </Button>
                    </div>
                  </div>
                ))}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setWatchRules((prev) => [
                      ...prev,
                      { type: "column_changed", column: "", severity: "warning", message: "" },
                    ])
                  }
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Agregar regla
                </Button>
              </div>
            </div>

            {watchlistError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {watchlistError}
              </div>
            ) : null}

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Mail className="h-4 w-4" />
                Se agenda la primera revision automaticamente.
              </div>
              <Button
                type="button"
                onClick={() => saveWatchlist().catch(() => null)}
                disabled={isSavingWatchlist || !selectedFile}
                className="gap-2"
              >
                {isSavingWatchlist ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sheet className="h-4 w-4" />}
                {editingWatchlistId ? "Guardar cambios" : "Crear monitor"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/70 lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Monitores activos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {actionInfo ? (
              <div className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                {actionInfo}
              </div>
            ) : null}
            {actionError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {actionError}
              </div>
            ) : null}

            {isLoading ? (
              <div className="text-sm text-muted-foreground">Cargando...</div>
            ) : watchlists.length ? (
              watchlists.map((watchlist) => (
                <div
                  key={watchlist.id}
                  className="rounded-xl border border-border/55 bg-background/20 px-3 py-2"
                >
                  <Link
                    href={`/excel/${workspaceId}/${watchlist.id}`}
                    className="block rounded-md px-1 py-1 hover:bg-background/30"
                  >
                    <div className="text-sm font-medium">{watchlist.file_name || "Archivo"}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {watchlist.provider} - {watchlist.status}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Prox revision: {formatDate(watchlist.next_check_at)}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Prox correo: {formatDate(watchlist.next_email_at || null)}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Clave: {(watchlist.key_columns || []).join(", ") || "(sin definir)"}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Hoja: {watchlist.sheet_name || "Primera hoja"} · Columnas monitoreadas: {Array.isArray(watchlist.watched_columns) ? watchlist.watched_columns.length : 0} · Filas: {Array.isArray((watchlist.rules as any)?.watched_rows) ? (watchlist.rules as any).watched_rows.length : 0} · Celdas: {Array.isArray((watchlist.rules as any)?.watched_cells) ? (watchlist.rules as any).watched_cells.length : 0}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Alertas inmediatas especiales: columnas {Array.isArray((watchlist.rules as any)?.immediate_columns) ? (watchlist.rules as any).immediate_columns.length : 0} · celdas {Array.isArray((watchlist.rules as any)?.immediate_cells) ? (watchlist.rules as any).immediate_cells.length : 0}
                    </div>
                    {(Array.isArray((watchlist.rules as any)?.immediate_columns) && (watchlist.rules as any).immediate_columns.length > 0) || (Array.isArray((watchlist.rules as any)?.immediate_cells) && (watchlist.rules as any).immediate_cells.length > 0) ? (
                      <div className="mt-1">
                        <Badge variant="outline" className="border-rose-500/35 text-rose-200">
                          Reglas inmediatas
                        </Badge>
                      </div>
                    ) : null}
                    {Boolean((watchlist.rules as any)?.monitor_tribunal_activity) ? (
                      <div className="mt-1">
                        <Badge variant="outline" className="border-sky-500/35 text-sky-200">
                          Seguimiento tribunal
                        </Badge>
                      </div>
                    ) : null}
                  </Link>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => editWatchlist(watchlist).catch(() => null)}
                    >
                      Editar
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={isActing({ watchlistId: watchlist.id })}
                      onClick={() => runWatchlistAction({ watchlist, kind: "check" }).catch(() => null)}
                    >
                      {isActing({ watchlistId: watchlist.id, kind: "check" }) ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Revisar ahora
                    </Button>

                    {watchlist.status === "paused" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={isActing({ watchlistId: watchlist.id })}
                        onClick={() =>
                          runWatchlistAction({ watchlist, kind: "resume" }).catch(() => null)
                        }
                      >
                        {isActing({ watchlistId: watchlist.id, kind: "resume" }) ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <PlayCircle className="h-3.5 w-3.5" />
                        )}
                        Reanudar
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={isActing({ watchlistId: watchlist.id })}
                        onClick={() => runWatchlistAction({ watchlist, kind: "pause" }).catch(() => null)}
                      >
                        {isActing({ watchlistId: watchlist.id, kind: "pause" }) ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <PauseCircle className="h-3.5 w-3.5" />
                        )}
                        Pausar
                      </Button>
                    )}

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-destructive hover:text-destructive"
                      disabled={isActing({ watchlistId: watchlist.id })}
                      onClick={() => runWatchlistAction({ watchlist, kind: "delete" }).catch(() => null)}
                    >
                      {isActing({ watchlistId: watchlist.id, kind: "delete" }) ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      Eliminar
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">Sin monitores aun.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!pendingDeleteWatchlist} onOpenChange={(open) => !open && setPendingDeleteWatchlist(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar monitor</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminara el monitor &apos;{pendingDeleteWatchlist?.file_name || "Archivo"}&apos; junto con su historial. Esta accion no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actingKind === "delete"}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={actingKind === "delete"}
              onClick={(event) => {
                event.preventDefault()
                confirmDeleteWatchlist().catch(() => null)
              }}
            >
              {actingKind === "delete" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
