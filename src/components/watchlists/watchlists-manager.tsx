"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"

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

type Provider = "google" | "microsoft"

type OAuthConnection = {
  id: string
  provider: Provider
  created_at: string | null
}

type WatchlistRow = {
  id: string
  provider: Provider
  file_name: string | null
  status: string
  next_check_at: string | null
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

type WatchRule = {
  type: "column_changed" | "column_equals" | "new_row"
  column?: string
  equals?: string
  severity?: "info" | "warning" | "critical"
  message?: string
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

      {suggestions.length ? (
        <div className="space-y-1">
          <div className="text-[11px] text-muted-foreground">Sugerencias detectadas</div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((column) => {
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

  const [sheetName, setSheetName] = useState("")
  const [keyColumns, setKeyColumns] = useState<string[]>([])
  const [watchedColumns, setWatchedColumns] = useState<string[]>([])
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
  const [actingWatchlistId, setActingWatchlistId] = useState<string | null>(null)
  const [actingKind, setActingKind] = useState<"pause" | "resume" | "check" | "delete" | null>(null)

  const connectionsForProvider = useMemo(
    () => connections.filter((c) => c.provider === watchProvider),
    [connections, watchProvider]
  )

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
    setFileResults([])
    setSelectedFile(null)
    setPreview(null)
    setPreviewError(null)
    setSheetName("")
    setKeyColumns([])
    setWatchedColumns([])
  }, [watchConnectionId])

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
  }) {
    setPreviewError(null)
    setIsPreviewLoading(true)

    try {
      const query = new URLSearchParams()
      query.set("connectionId", watchConnectionId)
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
        const first = data.columns[0] ? [data.columns[0]] : []
        const suggestedWatch = data.columns.slice(first.length, 4)
        setKeyColumns(first)
        setWatchedColumns(suggestedWatch)
      } else {
        setKeyColumns((prev) => {
          const kept = prev.filter((c) => data.columns.includes(c))
          return kept.length ? kept : data.columns[0] ? [data.columns[0]] : []
        })
        setWatchedColumns((prev) => prev.filter((c) => data.columns.includes(c)))
      }
    } catch (err: any) {
      setPreview(null)
      setPreviewError(err?.message ?? "Error al previsualizar")
    } finally {
      setIsPreviewLoading(false)
    }
  }

  async function selectFile(file: ProviderFile) {
    setSelectedFile(file)
    setPreview(null)
    setKeyColumns([])
    setWatchedColumns([])
    setWatchlistError(null)
    await loadPreview({ file, seedColumns: true })
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

    setIsSavingWatchlist(true)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/watchlists`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
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
          rules: { rules: watchRules },
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || "No se pudo crear el monitor")
      }

      setFileQuery("")
      setFileResults([])
      setSelectedFile(null)
      setPreview(null)
      setSheetName("")
      setKeyColumns([])
      setWatchedColumns([])
      setRecipients("")
      setWatchRules([])

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
    setActionError(null)
    setActionInfo(null)
    setActingWatchlistId(watchlist.id)
    setActingKind(kind)

    try {
      if (kind === "delete") {
        const ok = window.confirm(
          `Se eliminara el monitor '${watchlist.file_name || "Archivo"}' junto a su historial. Esta accion no se puede deshacer.`
        )
        if (!ok) return
      }

      let response: Response
      if (kind === "check") {
        response = await fetch(
          `/api/workspaces/${workspaceId}/watchlists/${watchlist.id}/check`,
          {
            method: "POST",
          }
        )
      } else if (kind === "delete") {
        response = await fetch(`/api/workspaces/${workspaceId}/watchlists/${watchlist.id}`, {
          method: "DELETE",
        })
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
      if (kind === "delete") setActionInfo("Monitor eliminado.")

      await loadAll()
    } catch (err: any) {
      setActionError(err?.message ?? "Error al ejecutar accion")
    } finally {
      setActingWatchlistId(null)
      setActingKind(null)
    }
  }

  const availableColumns = preview?.columns ?? []

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8">
      <div className="mb-5">
        <Link
          href={`/workspaces/${workspaceId}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al cuaderno
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
                <a href={`/api/oauth/google/start?next=${encodeURIComponent(`/workspaces/${workspaceId}/watchlists`)}`}>
                  Conectar Google Drive
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a
                  href={`/api/oauth/microsoft/start?next=${encodeURIComponent(
                    `/workspaces/${workspaceId}/watchlists`
                  )}`}
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

            {loadError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {loadError}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="bg-card/70 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Crear monitor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Proveedor</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background/35 px-3 py-2 text-sm"
                  value={watchProvider}
                  onChange={(e) => setWatchProvider(e.target.value as Provider)}
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
                  onChange={(e) => setWatchConnectionId(e.target.value)}
                >
                  {connectionsForProvider.length ? (
                    connectionsForProvider.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.id.slice(0, 8)}...
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

                  <ColumnTagsEditor
                    label="Clave de fila"
                    value={keyColumns}
                    onChange={setKeyColumns}
                    suggestions={availableColumns}
                    placeholder="Ej: ID, Codigo"
                    hint="Usa columnas que identifiquen una fila de forma unica."
                  />

                  <ColumnTagsEditor
                    label="Columnas a monitorear"
                    value={watchedColumns}
                    onChange={setWatchedColumns}
                    suggestions={availableColumns.filter(
                      (column) => !keyColumns.some((k) => k.toLowerCase() === column.toLowerCase())
                    )}
                    placeholder="Ej: Estado, Responsable"
                    hint="Solo estas columnas disparan cambios en el diff."
                  />

                  {preview.sampleRows.length ? (
                    <div className="space-y-2">
                      <Label>Muestra rapida</Label>
                      <div className="overflow-x-auto rounded-xl border border-border/55">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-background/35 text-muted-foreground">
                            <tr>
                              {availableColumns.slice(0, 8).map((column) => (
                                <th key={column} className="px-2.5 py-2 font-medium">
                                  {column}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {preview.sampleRows.slice(0, 6).map((row, idx) => (
                              <tr key={idx} className="border-t border-border/55">
                                {availableColumns.slice(0, 8).map((column) => (
                                  <td key={`${idx}:${column}`} className="px-2.5 py-2 text-muted-foreground">
                                    {String(row?.[column] ?? "")}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
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

                      {rule.type !== "new_row" ? (
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
                Guardar monitor
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/70 lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Monitores</CardTitle>
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
                    href={`/workspaces/${workspaceId}/watchlists/${watchlist.id}`}
                    className="block rounded-md px-1 py-1 hover:bg-background/30"
                  >
                    <div className="text-sm font-medium">{watchlist.file_name || "Archivo"}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {watchlist.provider} - {watchlist.status}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Prox revision: {formatDate(watchlist.next_check_at)}
                    </div>
                  </Link>

                  <div className="mt-2 flex flex-wrap gap-2">
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
    </div>
  )
}
