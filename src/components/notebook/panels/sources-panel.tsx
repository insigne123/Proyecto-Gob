"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import {
  ChevronDown,
  FileText,
  Download,
  Globe,
  Loader2,
  Search,
  Plus,
  RefreshCw,
  Upload,
  X,
} from "lucide-react"

type SourceRow = {
  id: string
  workspace_id: string | null
  workspace_title: string | null
  kind: "url" | "upload"
  url: string | null
  filename: string | null
  title: string | null
  doc_type: string | null
  year: number | null
  region: string | null
  sector: string | null
  project_name: string | null
  source_origin: string | null
  language: string | null
  attributes: Record<string, string | number | boolean> | null
  status: "pending" | "processing" | "ready" | "error"
  updated_at: string | null
  last_error: string | null
  snapshots_count: number | null
}

function hostFromUrl(input: string | null) {
  if (!input) return ""
  try {
    return new URL(input).host
  } catch {
    return ""
  }
}

function statusLabel(status: SourceRow["status"]) {
  if (status === "pending") return "Pendiente"
  if (status === "processing") return "Procesando"
  if (status === "ready") return "Listo"
  return "Error"
}

function statusDotClass(status: SourceRow["status"]) {
  if (status === "ready") return "bg-emerald-400"
  if (status === "processing") return "bg-amber-400"
  if (status === "pending") return "bg-slate-400"
  return "bg-red-400"
}

export function SourcesPanel({ workspaceId }: { workspaceId: string }) {
  const [sources, setSources] = useState<SourceRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState("")

  const [contentQuery, setContentQuery] = useState("")
  const [searchDocType, setSearchDocType] = useState("")
  const [searchRegion, setSearchRegion] = useState("")
  const [searchSector, setSearchSector] = useState("")
  const [searchYearFrom, setSearchYearFrom] = useState("")
  const [searchYearTo, setSearchYearTo] = useState("")
  const [searchResults, setSearchResults] = useState<
    Array<{
      chunkId: string
      snippet: string
      sourceUrl: string | null
      page: number | null
      section: string | null
      rank: number | null
      docType: string | null
      region: string | null
      sector: string | null
      year: number | null
      workspaceId: string | null
      workspaceTitle: string | null
    }>
  >([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [openChunkId, setOpenChunkId] = useState<string | null>(null)
  const [openChunk, setOpenChunk] = useState<
    | {
        id: string
        content: string
        sourceUrl: string | null
        snapshotId: string | null
        page: number | null
        section: string | null
      }
    | null
  >(null)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [addTab, setAddTab] = useState<"url" | "upload">("url")
  const [url, setUrl] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [docType, setDocType] = useState("")
  const [year, setYear] = useState("")
  const [region, setRegion] = useState("")
  const [sector, setSector] = useState("")
  const [projectName, setProjectName] = useState("")
  const [sourceOrigin, setSourceOrigin] = useState("")
  const [language, setLanguage] = useState("es")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const pollRef = useRef<number | null>(null)

  async function loadSources() {
    const res = await fetch(`/api/workspaces/${workspaceId}/sources`, {
      method: "GET",
      headers: { "accept": "application/json" },
    })
    const json = await res.json().catch(() => null)
    if (res.ok) {
      setSources(json?.sources ?? [])
      setLoadError(null)
      try {
        window.dispatchEvent(new CustomEvent("ca:sources-changed"))
      } catch {
        // ignore
      }
    } else {
      setLoadError(json?.error || "No se pudieron cargar las fuentes")
    }
  }

  function buildSearchUrl(format?: "json" | "csv") {
    const query = new URLSearchParams({ q: contentQuery.trim() })
    if (searchDocType.trim()) query.set("docType", searchDocType.trim())
    if (searchRegion.trim()) query.set("region", searchRegion.trim())
    if (searchSector.trim()) query.set("sector", searchSector.trim())
    if (searchYearFrom.trim()) query.set("yearFrom", searchYearFrom.trim())
    if (searchYearTo.trim()) query.set("yearTo", searchYearTo.trim())
    if (format === "csv") query.set("format", "csv")
    return `/api/workspaces/${workspaceId}/search?${query.toString()}`
  }

  async function runContentSearch() {
    const q = contentQuery.trim()
    if (q.length < 2) {
      setSearchError("Escribe al menos 2 caracteres")
      setSearchResults([])
      return
    }
    setSearchError(null)
    setIsSearching(true)
    try {
      const res = await fetch(buildSearchUrl("json"), {
        method: "GET",
        headers: { accept: "application/json" },
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || "No se pudo buscar")
      setSearchResults(Array.isArray(json?.results) ? json.results : [])
    } catch (err: any) {
      setSearchError(err?.message ?? "Error inesperado")
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

  async function loadChunk(chunkId: string) {
    setOpenChunk(null)
    const res = await fetch(`/api/chunks/${chunkId}`, {
      method: "GET",
      headers: { accept: "application/json" },
    })
    const json = await res.json().catch(() => null)
    if (res.ok) setOpenChunk(json)
  }

  useEffect(() => {
    if (!openChunkId) return
    loadChunk(openChunkId).catch(() => null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openChunkId])

  useEffect(() => {
    let isMounted = true
    setIsLoading(true)
    loadSources()
      .catch(() => null)
      .finally(() => {
        if (isMounted) setIsLoading(false)
      })

    const onOpen = () => setIsAddOpen(true)
    window.addEventListener("ca:open-add-source", onOpen as any)
    return () => {
      isMounted = false
      window.removeEventListener("ca:open-add-source", onOpen as any)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  const needsPolling = useMemo(
    () => sources.some((s) => s.status === "pending" || s.status === "processing"),
    [sources]
  )

  useEffect(() => {
    if (!needsPolling) {
      if (pollRef.current) window.clearInterval(pollRef.current)
      pollRef.current = null
      return
    }
    if (pollRef.current) return
    pollRef.current = window.setInterval(() => {
      loadSources().catch(() => null)
    }, 4000)
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
      pollRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsPolling])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return sources
    return sources.filter((s) => {
      return (
        (s.title ?? "").toLowerCase().includes(q) ||
        (s.url ?? "").toLowerCase().includes(q) ||
        (s.filename ?? "").toLowerCase().includes(q)
      )
    })
  }, [filter, sources])

  function buildMetadataPayload() {
    const y = Number(year)
    return {
      docType: docType.trim() || null,
      year: Number.isFinite(y) ? Math.floor(y) : null,
      region: region.trim() || null,
      sector: sector.trim() || null,
      projectName: projectName.trim() || null,
      sourceOrigin: sourceOrigin.trim() || null,
      language: language.trim() || null,
    }
  }

  function resetAddForm() {
    setUrl("")
    setFiles([])
    setDocType("")
    setYear("")
    setRegion("")
    setSector("")
    setProjectName("")
    setSourceOrigin("")
    setLanguage("es")
  }

  async function onSubmitAdd() {
    setError(null)
    setIsSubmitting(true)

    try {
      const metadata = buildMetadataPayload()
      if (addTab === "url") {
        const res = await fetch(`/api/workspaces/${workspaceId}/sources`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: "url", url, metadata }),
        })
        const json = await res.json().catch(() => null)
        if (!res.ok) {
          const fe = json?.details?.fieldErrors
          const fieldHints =
            fe && typeof fe === "object"
              ? Object.entries(fe)
                  .flatMap(([k, v]) => (Array.isArray(v) && v.length ? [`${k}: ${v[0]}`] : []))
                  .slice(0, 2)
              : []
          const hint = fieldHints.length ? ` (${fieldHints.join(" | ")})` : ""
          const msg = (json?.error || "No se pudo agregar la fuente") + hint
          throw new Error(msg)
        }
        resetAddForm()
        setIsAddOpen(false)
        await loadSources()
        return
      }

      if (files.length === 0) throw new Error("Selecciona al menos un archivo")

      const failed: Array<{ file: File; reason: string }> = []
      let uploaded = 0

      for (const file of files) {
        const fd = new FormData()
        fd.set("kind", "upload")
        fd.set("file", file)
        if (metadata.docType) fd.set("docType", metadata.docType)
        if (typeof metadata.year === "number") fd.set("year", String(metadata.year))
        if (metadata.region) fd.set("region", metadata.region)
        if (metadata.sector) fd.set("sector", metadata.sector)
        if (metadata.projectName) fd.set("projectName", metadata.projectName)
        if (metadata.sourceOrigin) fd.set("sourceOrigin", metadata.sourceOrigin)
        if (metadata.language) fd.set("language", metadata.language)

        const res = await fetch(`/api/workspaces/${workspaceId}/sources`, {
          method: "POST",
          body: fd,
        })
        const json = await res.json().catch(() => null)
        if (!res.ok) {
          const fe = json?.details?.fieldErrors
          const fieldHints =
            fe && typeof fe === "object"
              ? Object.entries(fe)
                  .flatMap(([k, v]) => (Array.isArray(v) && v.length ? [`${k}: ${v[0]}`] : []))
                  .slice(0, 2)
              : []
          const hint = fieldHints.length ? ` (${fieldHints.join(" | ")})` : ""
          failed.push({ file, reason: (json?.error || "No se pudo subir la fuente") + hint })
          continue
        }

        uploaded += 1
      }

      await loadSources()

      if (failed.length > 0) {
        setFiles(failed.map((x) => x.file))
        const examples = failed.slice(0, 3).map((x) => `${x.file.name}: ${x.reason}`)
        throw new Error(
          `Subidos ${uploaded}/${files.length}. Fallaron ${failed.length}. ${examples.join(" | ")}`
        )
      }

      resetAddForm()
      setIsAddOpen(false)
    } catch (err: any) {
      setError(err?.message ?? "Error inesperado")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="flex h-[calc(100svh-104px)] min-h-0 flex-col overflow-hidden rounded-2xl border-border/60 bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/45">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Fuentes</div>
          <div className="text-[11px] text-muted-foreground">
            {sources.length} fuentes compartidas - disponibles en todos tus proyectos
          </div>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setIsAddOpen(true)}>
          <Plus className="h-4 w-4" />
          Agregar
        </Button>
      </div>

      <div className="p-4">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar por nombre o URL..."
          className="bg-background/40"
        />

        <div className="mt-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={contentQuery}
              onChange={(e) => setContentQuery(e.target.value)}
              placeholder="Buscar dentro de fuentes..."
              className="bg-background/40 pl-9"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  runContentSearch().catch(() => null)
                }
              }}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => runContentSearch().catch(() => null)}
            disabled={isSearching}
            className="gap-2"
          >
            {isSearching && <Loader2 className="h-4 w-4 animate-spin" />}
            Buscar
          </Button>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <Input
            value={searchDocType}
            onChange={(e) => setSearchDocType(e.target.value)}
            placeholder="Tipo doc"
            className="bg-background/40"
          />
          <Input
            value={searchRegion}
            onChange={(e) => setSearchRegion(e.target.value)}
            placeholder="Region"
            className="bg-background/40"
          />
          <Input
            value={searchSector}
            onChange={(e) => setSearchSector(e.target.value)}
            placeholder="Sector"
            className="bg-background/40"
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={searchYearFrom}
              onChange={(e) => setSearchYearFrom(e.target.value)}
              placeholder="Ano desde"
              className="bg-background/40"
              inputMode="numeric"
            />
            <Input
              value={searchYearTo}
              onChange={(e) => setSearchYearTo(e.target.value)}
              placeholder="Ano hasta"
              className="bg-background/40"
              inputMode="numeric"
            />
          </div>
        </div>

        {searchError && (
          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {searchError}
          </div>
        )}

        {loadError && (
          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {loadError}
          </div>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2 pb-2">
        <div className="space-y-1 px-2">
          {contentQuery.trim().length >= 2 && searchResults.length ? (
            <div className="space-y-2 px-2 pb-2">
              <div className="flex items-center justify-between gap-2 px-1">
                <div className="text-[11px] text-muted-foreground">Resultados: {searchResults.length}</div>
                <Button asChild variant="outline" size="sm" className="h-7 gap-2 rounded-full px-3 text-xs">
                  <a
                    href={buildSearchUrl("csv")}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Exportar
                  </a>
                </Button>
              </div>
              {searchResults.map((r) => (
                <button
                  key={r.chunkId}
                  type="button"
                  onClick={() => setOpenChunkId(r.chunkId)}
                  className="w-full rounded-xl border border-border/50 bg-background/25 px-3 py-2.5 text-left hover:bg-background/35"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="truncate text-sm font-medium">Chunk {r.chunkId.slice(0, 8)}...</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.page ? `p. ${r.page}` : r.section ? r.section : ""}
                    </div>
                  </div>
                  <div className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">
                    {r.snippet}
                  </div>
                  {(r.docType || r.region || r.sector || r.year) && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {[r.docType, r.region, r.sector, r.year ? String(r.year) : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  )}
                  {r.workspaceTitle && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Proyecto: {r.workspaceTitle}
                    </div>
                  )}
                </button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => {
                  setContentQuery("")
                  setSearchDocType("")
                  setSearchRegion("")
                  setSearchSector("")
                  setSearchYearFrom("")
                  setSearchYearTo("")
                  setSearchResults([])
                }}
              >
                Volver a fuentes
              </Button>
            </div>
          ) : isLoading ? (
            <div className="px-2 py-6 text-sm text-muted-foreground">Cargando fuentes...</div>
          ) : filtered.length ? (
            filtered.map((s) => (
              <div
                key={s.id}
                className={cn(
                  "flex items-start gap-3 rounded-xl border border-border/50 bg-background/25 px-3 py-2.5",
                  "hover:bg-background/35"
                )}
              >
                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/15">
                  {s.kind === "url" ? <Globe className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="truncate text-sm font-medium">
                      {s.title || s.filename || hostFromUrl(s.url) || "Fuente"}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", statusDotClass(s.status))} />
                      <span className="text-[11px] text-muted-foreground">{statusLabel(s.status)}</span>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                    <span className="truncate">
                      {s.url ? hostFromUrl(s.url) : s.filename ? "Archivo subido" : ""}
                    </span>
                    <span className="tabular-nums">
                      {s.snapshots_count ? `${s.snapshots_count} v` : ""}
                    </span>
                  </div>
                  {(s.doc_type || s.region || s.sector || s.year) && (
                    <div className="mt-1 truncate text-[11px] text-muted-foreground">
                      {[s.doc_type, s.region, s.sector, s.year ? String(s.year) : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  )}
                  {s.workspace_title && (
                    <div className="mt-1 truncate text-[11px] text-muted-foreground">
                      Proyecto: {s.workspace_title}
                    </div>
                  )}
                  {s.status === "error" && s.last_error && (
                    <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
                      {s.last_error}
                    </div>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="px-2 py-8 text-sm text-muted-foreground">
              No hay fuentes aun.
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
        Las fuentes se descargan como snapshot (hash + fecha) para trazabilidad.
      </div>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
          <DialogHeader>
            <DialogTitle>Agregar fuente</DialogTitle>
          </DialogHeader>

          <Tabs value={addTab} onValueChange={(v) => setAddTab(v as any)}>
            <TabsList className="grid w-full grid-cols-2 bg-background/35">
              <TabsTrigger value="url">URL</TabsTrigger>
              <TabsTrigger value="upload">PDF</TabsTrigger>
            </TabsList>

            <TabsContent value="url" className="mt-4 space-y-2">
              <Label htmlFor="source-url">URL (HTML o PDF publico)</Label>
              <Input
                id="source-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
              />
              <p className="text-xs text-muted-foreground">
                Las fuentes quedan disponibles para todos tus proyectos y el asistente responde con evidencia de ese repositorio compartido.
              </p>
            </TabsContent>

            <TabsContent value="upload" className="mt-4 space-y-3">
              <Label>Subir PDFs</Label>
              <div className="rounded-xl border border-dashed border-border/70 bg-background/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/15">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">
                        {files.length
                          ? `${files.length} archivo(s) seleccionado(s)`
                          : "Selecciona uno o varios archivos"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {files.length
                          ? `${(
                              files.reduce((acc, f) => acc + f.size, 0) /
                              1024 /
                              1024
                            ).toFixed(2)} MB en total`
                          : "PDF hasta 50MB por archivo"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {files.length > 0 && (
                      <Button variant="ghost" size="icon" onClick={() => setFiles([])}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                    <Button asChild variant="outline" size="sm">
                      <label className="cursor-pointer">
                        <input
                          type="file"
                          accept="application/pdf"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            const selected = Array.from(e.target.files ?? [])
                            if (!selected.length) return
                            setFiles((prev) => {
                              const next = new Map<string, File>()
                              for (const f of [...prev, ...selected]) {
                                const key = `${f.name}:${f.size}:${f.lastModified}`
                                if (!next.has(key)) next.set(key, f)
                              }
                              return Array.from(next.values())
                            })
                            e.currentTarget.value = ""
                          }}
                        />
                        Elegir
                      </label>
                    </Button>
                  </div>
                </div>

                {files.length > 0 && (
                  <div className="mt-3 max-h-28 space-y-1 overflow-auto rounded-lg border border-border/50 bg-background/25 p-2">
                    {files.map((f) => {
                      const key = `${f.name}:${f.size}:${f.lastModified}`
                      return (
                        <div key={key} className="flex items-center justify-between gap-3 text-xs">
                          <span className="truncate">{f.name}</span>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => {
                              setFiles((prev) =>
                                prev.filter(
                                  (x) =>
                                    `${x.name}:${x.size}:${x.lastModified}` !==
                                    `${f.name}:${f.size}:${f.lastModified}`
                                )
                              )
                            }}
                          >
                            Quitar
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Luego de agregar, la fuente se procesa en background. Si queda en "Pendiente", revisa que el worker
                este corriendo (`npm run worker:dev`).
              </p>
            </TabsContent>
          </Tabs>

          <Collapsible defaultOpen={false}>
            <div className="rounded-xl border border-border/55 bg-background/20 p-3">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 text-left"
                >
                  <div>
                    <div className="text-xs font-medium text-foreground/85">
                      Metadatos para busqueda (opcional)
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      Ayudan a filtrar resultados en Chat/Busqueda cuando tienes muchas fuentes. Puedes dejarlo vacio.
                    </div>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </button>
              </CollapsibleTrigger>

              <CollapsibleContent className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="meta-doc-type">Tipo doc</Label>
                    <Input
                      id="meta-doc-type"
                      value={docType}
                      onChange={(e) => setDocType(e.target.value)}
                      placeholder="Ej: RCA, EIA, DIA"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="meta-year">Ano</Label>
                    <Input
                      id="meta-year"
                      value={year}
                      onChange={(e) => setYear(e.target.value)}
                      placeholder="Ej: 2024"
                      inputMode="numeric"
                    />
                    <div className="text-[11px] text-muted-foreground">Deja vacio si no aplica.</div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="meta-region">Region</Label>
                    <Input
                      id="meta-region"
                      value={region}
                      onChange={(e) => setRegion(e.target.value)}
                      placeholder="Ej: Los Lagos"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="meta-sector">Sector</Label>
                    <Input
                      id="meta-sector"
                      value={sector}
                      onChange={(e) => setSector(e.target.value)}
                      placeholder="Ej: Energia"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="meta-project">Proyecto</Label>
                    <Input
                      id="meta-project"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      placeholder="Ej: Nombre corto"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="meta-origin">Fuente</Label>
                    <Input
                      id="meta-origin"
                      value={sourceOrigin}
                      onChange={(e) => setSourceOrigin(e.target.value)}
                      placeholder="Ej: SEA, DOF, Upload"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="meta-language">Idioma</Label>
                  <Input
                    id="meta-language"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    placeholder="es"
                  />
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              onClick={() => loadSources().catch(() => null)}
              className="gap-2"
              type="button"
            >
              <RefreshCw className="h-4 w-4" />
              Actualizar
            </Button>
            <Button onClick={onSubmitAdd} disabled={isSubmitting} className="gap-2" type="button">
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Agregar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!openChunkId} onOpenChange={(o) => !o && setOpenChunkId(null)}>
        <DialogContent className="max-w-3xl bg-card/85 backdrop-blur supports-[backdrop-filter]:bg-card/65">
          <DialogHeader>
            <DialogTitle>Resultado</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl border border-border/55 bg-background/25 p-4">
              <div className="text-xs text-muted-foreground">Contexto</div>
              <div className="mt-2 whitespace-pre-wrap font-code text-xs leading-5 text-foreground/90">
                {openChunk ? openChunk.content : "Cargando..."}
              </div>
            </div>

            {openChunk?.sourceUrl ? (
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  {openChunk.page ? `Pagina ${openChunk.page}` : ""}
                  {openChunk.section ? ` - ${openChunk.section}` : ""}
                </div>
                <Button asChild variant="outline" size="sm">
                  <a href={openChunk.sourceUrl} target="_blank" rel="noreferrer">
                    Abrir fuente
                  </a>
                </Button>
              </div>
            ) : openChunk?.snapshotId ? (
              <div className="flex items-center justify-end gap-2">
                <Button asChild variant="outline" size="sm">
                  <a
                    href={`/api/snapshots/${openChunk.snapshotId}/open`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir snapshot
                  </a>
                </Button>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
