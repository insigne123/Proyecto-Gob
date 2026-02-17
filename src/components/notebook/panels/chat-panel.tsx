"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  ArrowUpRight,
  Loader2,
  Plus,
  Quote,
  Send,
  SlidersHorizontal,
  Sparkles,
  UploadCloud,
} from "lucide-react"

type Citation = {
  chunkId: string
  quote: string
  sourceUrl: string | null
  snapshotId: string | null
  page: number | null
  section: string | null
}

type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  created_at: string | null
  citations: Citation[] | null
}

type ThreadRow = {
  id: string
  title: string
  purpose: string | null
  mode: "extractive" | "comparison" | "checklist" | "resolution"
  updatedAt: string | null
}

type ResponseProfile = "auto" | "fast" | "balanced" | "deep"

type ChunkDetail = {
  id: string
  content: string
  sourceUrl: string | null
  snapshotId: string | null
  page: number | null
  section: string | null
}

type SnapshotMeta = {
  id: string
  createdAt: string | null
  fetchedAt: string | null
  contentHash: string | null
  contentType: string | null
  storagePath: string | null
  url: string | null
  httpStatus: number | null
  openaiFileId: string | null
  openaiVectorStoreFileId: string | null
  openaiIndexStatus: string | null
  openaiLastError: string | null
  openaiIndexedAt: string | null
}

function formatInlineText(text: string) {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .join("\n")
}

export function ChatPanel({ workspaceId }: { workspaceId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [question, setQuestion] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [readySources, setReadySources] = useState(0)

  const [threads, setThreads] = useState<ThreadRow[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [askMode, setAskMode] = useState<ThreadRow["mode"]>("extractive")
  const [filterDocType, setFilterDocType] = useState("")
  const [filterRegion, setFilterRegion] = useState("")
  const [filterYearFrom, setFilterYearFrom] = useState("")
  const [filterYearTo, setFilterYearTo] = useState("")
  const [responseProfile, setResponseProfile] = useState<ResponseProfile>("auto")
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [isThreadOpen, setIsThreadOpen] = useState(false)
  const [threadTitle, setThreadTitle] = useState("")
  const [threadPurpose, setThreadPurpose] = useState("")
  const [threadMode, setThreadMode] = useState<ThreadRow["mode"]>("extractive")
  const [threadError, setThreadError] = useState<string | null>(null)

  const [openCitation, setOpenCitation] = useState<Citation | null>(null)
  const [chunkDetail, setChunkDetail] = useState<ChunkDetail | null>(null)
  const [snapshotMeta, setSnapshotMeta] = useState<SnapshotMeta | null>(null)
  const [snapshotMetaError, setSnapshotMetaError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const messagesViewportRef = useRef<HTMLDivElement | null>(null)
  const questionRef = useRef<HTMLTextAreaElement | null>(null)
  const [sendingHintIdx, setSendingHintIdx] = useState(0)

  const quickPrompts = useMemo(
    () => [
      "Resume el documento en 5 puntos clave",
      "Enumera los 6 modulos principales (A a F)",
      "Que dice sobre auto-entrenamiento continuo",
      "Riesgos y mitigaciones principales del sistema",
    ],
    []
  )

  const sendingHints = useMemo(
    () => [
      "Buscando evidencia relevante...",
      "Verificando citas para evitar alucinaciones...",
      "Redactando respuesta con fuentes...",
    ],
    []
  )

  async function loadMessages(threadId?: string | null) {
    const qs = threadId ? `?threadId=${encodeURIComponent(threadId)}` : ""
    const res = await fetch(`/api/workspaces/${workspaceId}/chat${qs}`, {
      method: "GET",
      headers: { accept: "application/json" },
    })
    const json = await res.json().catch(() => null)
    if (res.ok) setMessages(json?.messages ?? [])
  }

  async function loadThreads() {
    const res = await fetch(`/api/workspaces/${workspaceId}/threads`, {
      method: "GET",
      headers: { accept: "application/json" },
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) return
    const list = Array.isArray(json?.threads) ? (json.threads as any[]) : []
    setThreads(
      list.map((t) => ({
        id: String(t.id),
        title: String(t.title || "Hilo"),
        purpose: t.purpose ? String(t.purpose) : null,
        mode: (t.mode as any) || "extractive",
        updatedAt: t.updatedAt ? String(t.updatedAt) : null,
      }))
    )
  }

  async function loadSourceReadiness() {
    const res = await fetch(`/api/workspaces/${workspaceId}/sources`, {
      method: "GET",
      headers: { accept: "application/json" },
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) return
    const sources = (json?.sources ?? []) as Array<{ status?: string }>
    const count = sources.filter((s) => s.status === "ready").length
    setReadySources(count)
  }

  useEffect(() => {
    let alive = true
    setIsLoading(true)
    Promise.all([loadMessages(activeThreadId), loadThreads(), loadSourceReadiness()])
      .catch(() => null)
      .finally(() => {
        if (alive) setIsLoading(false)
      })

    const onSourcesChanged = () => loadSourceReadiness().catch(() => null)
    window.addEventListener("ca:sources-changed", onSourcesChanged)
    return () => {
      alive = false
      window.removeEventListener("ca:sources-changed", onSourcesChanged)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  useEffect(() => {
    const selected = threads.find((t) => t.id === activeThreadId)
    if (selected?.mode) {
      setAskMode(selected.mode)
      return
    }
    setAskMode("extractive")
  }, [activeThreadId, threads])

  useEffect(() => {
    loadMessages(activeThreadId).catch(() => null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId])

  useEffect(() => {
    const viewport = messagesViewportRef.current
    if (!viewport) return
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" })
  }, [messages.length])

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`ca:chat:advanced:${workspaceId}`)
      setShowAdvanced(saved === "1")
    } catch {
      // ignore
    }
  }, [workspaceId])

  useEffect(() => {
    try {
      window.localStorage.setItem(`ca:chat:advanced:${workspaceId}`, showAdvanced ? "1" : "0")
    } catch {
      // ignore
    }
  }, [workspaceId, showAdvanced])

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`ca:chat:response-profile:${workspaceId}`)
      if (saved === "fast" || saved === "balanced" || saved === "deep" || saved === "auto") {
        setResponseProfile(saved)
      }
    } catch {
      // ignore
    }
  }, [workspaceId])

  useEffect(() => {
    try {
      window.localStorage.setItem(`ca:chat:response-profile:${workspaceId}`, responseProfile)
    } catch {
      // ignore
    }
  }, [workspaceId, responseProfile])

  useEffect(() => {
    if (!isSending) {
      setSendingHintIdx(0)
      return
    }
    const id = window.setInterval(() => {
      setSendingHintIdx((x) => (x + 1) % sendingHints.length)
    }, 1800)
    return () => window.clearInterval(id)
  }, [isSending, sendingHints.length])

  const canAsk = readySources > 0 && !isSending
  const hasAdvancedActive =
    askMode !== "extractive" ||
    responseProfile !== "auto" ||
    !!filterDocType.trim() ||
    !!filterRegion.trim() ||
    !!filterYearFrom.trim() ||
    !!filterYearTo.trim()

  const showQuickPrompts = readySources > 0 && !question.trim()

  function resetAdvancedOptions() {
    setAskMode("extractive")
    setResponseProfile("auto")
    setFilterDocType("")
    setFilterRegion("")
    setFilterYearFrom("")
    setFilterYearTo("")
  }

  function applyQuickPrompt(text: string) {
    setQuestion(text)
    requestAnimationFrame(() => {
      questionRef.current?.focus()
    })
  }

  async function onSend() {
    const q = question.trim()
    if (!q) return
    setError(null)
    setIsSending(true)
    setQuestion("")

    const optimisticId = `tmp_${Date.now()}`
    setMessages((prev) => [
      ...prev,
      { id: optimisticId, role: "user", content: q, created_at: null, citations: null },
    ])

    try {
      const yearFromRaw = filterYearFrom.trim()
      const yearToRaw = filterYearTo.trim()
      const yearFrom = yearFromRaw ? Number(yearFromRaw) : Number.NaN
      const yearTo = yearToRaw ? Number(yearToRaw) : Number.NaN
      const filters = {
        docTypes: filterDocType.trim() ? [filterDocType.trim()] : undefined,
        regions: filterRegion.trim() ? [filterRegion.trim()] : undefined,
        yearFrom: Number.isFinite(yearFrom) ? Math.floor(yearFrom) : undefined,
        yearTo: Number.isFinite(yearTo) ? Math.floor(yearTo) : undefined,
      }

      const res = await fetch(`/api/workspaces/${workspaceId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: q,
          threadId: activeThreadId,
          mode: askMode,
          responseProfile,
          filters,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || "No se pudo enviar la consulta")

      if (Array.isArray(json?.messages)) {
        setMessages(json.messages)
      } else if (json?.assistantMessage) {
        setMessages((prev) => {
          const withoutTmp = prev.filter((m) => m.id !== optimisticId)
          return [...withoutTmp, json.userMessage, json.assistantMessage]
        })
      } else {
        await loadMessages()
      }
    } catch (err: any) {
      setError(err?.message ?? "Error inesperado")
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
      setQuestion(q)
    } finally {
      setIsSending(false)
    }
  }

  async function createThread() {
    const title = threadTitle.trim()
    if (!title) {
      setThreadError("Escribe un titulo")
      return
    }
    setThreadError(null)

    const res = await fetch(`/api/workspaces/${workspaceId}/threads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        purpose: threadPurpose.trim() ? threadPurpose.trim() : null,
        mode: threadMode,
      }),
    })

    const json = await res.json().catch(() => null)
    if (!res.ok) {
      setThreadError(json?.error || "No se pudo crear el hilo")
      return
    }

    const id = String(json?.id || "")
    await loadThreads().catch(() => null)
    setIsThreadOpen(false)
    setThreadTitle("")
    setThreadPurpose("")
    setThreadMode("extractive")
    if (id) setActiveThreadId(id)
  }

  const emptyState = useMemo(() => {
    if (isLoading) return false
    if (readySources > 0) return false
    return true
  }, [isLoading, readySources])

  async function loadChunk(chunkId: string) {
    setChunkDetail(null)
    const res = await fetch(`/api/chunks/${chunkId}`, {
      method: "GET",
      headers: { accept: "application/json" },
    })
    const json = await res.json().catch(() => null)
    if (res.ok) setChunkDetail(json)
  }

  async function loadSnapshotMeta(snapshotId: string) {
    setSnapshotMeta(null)
    setSnapshotMetaError(null)
    const res = await fetch(`/api/snapshots/${snapshotId}/meta`, {
      method: "GET",
      headers: { accept: "application/json" },
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      setSnapshotMetaError(json?.error || "No se pudo cargar metadata")
      return
    }
    setSnapshotMeta(json as any)
  }

  useEffect(() => {
    if (!openCitation?.chunkId) return
    loadChunk(openCitation.chunkId).catch(() => null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCitation?.chunkId])

  useEffect(() => {
    const sid = openCitation?.snapshotId
    if (!sid) {
      setSnapshotMeta(null)
      setSnapshotMetaError(null)
      return
    }
    loadSnapshotMeta(sid).catch(() => null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCitation?.snapshotId])

  return (
    <Card className="flex h-[calc(100svh-104px)] min-h-0 flex-col overflow-hidden rounded-2xl border-border/60 bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/45">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div>
          <div className="text-sm font-semibold">Chat</div>
          <div className="text-[11px] text-muted-foreground">
            Haz preguntas sobre tus fuentes ({readySources} listas). El asistente responde con citas.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            className="h-9 rounded-md border border-input bg-background/35 px-3 text-xs"
            value={activeThreadId ?? "legacy"}
            onChange={(e) => {
              const v = e.target.value
              setActiveThreadId(v === "legacy" ? null : v)
            }}
            title="Hilo"
          >
            <option value="legacy">General</option>
            {threads.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>

          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2"
            onClick={() => setIsThreadOpen(true)}
            type="button"
          >
            <Plus className="h-4 w-4" />
            Nuevo
          </Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {emptyState ? (
          <div className="flex h-full items-center justify-center px-6">
            <div className="max-w-md text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/20">
                <UploadCloud className="h-5 w-5" />
              </div>
              <div className="text-lg font-semibold">Agrega una fuente para empezar</div>
              <p className="mt-2 text-sm text-muted-foreground">
                Para evitar alucinaciones, el asistente solo usa contenido cargado en el proyecto.
              </p>
              <div className="mt-5 flex items-center justify-center">
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => window.dispatchEvent(new CustomEvent("ca:open-add-source"))}
                >
                  <UploadCloud className="h-4 w-4" />
                  Subir una fuente
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div
            ref={messagesViewportRef}
            className="hide-scrollbar h-full overflow-y-auto"
          >
            <div className="space-y-4 px-4 py-4">
              {isLoading ? (
                <div className="text-sm text-muted-foreground">Cargando conversacion...</div>
              ) : messages.length ? (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "rounded-2xl border border-border/55 px-4 py-3",
                      m.role === "user"
                        ? "bg-emerald-500/10"
                        : "bg-background/25"
                    )}
                  >
                    <div className="text-[11px] text-muted-foreground">
                      {m.role === "user" ? "Tu" : "Asistente"}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">
                      {formatInlineText(m.content)}
                    </div>
                    {!!m.citations?.length && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {m.citations.map((c, idx) => (
                          <Button
                            key={`${c.chunkId}_${idx}`}
                            variant="outline"
                            size="sm"
                            className="h-7 gap-2 rounded-full px-3 text-xs"
                            onClick={() => setOpenCitation(c)}
                          >
                            <Quote className="h-3.5 w-3.5" />
                            Cita {idx + 1}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">Sin mensajes aun.</div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border/60 p-3">
        {error && (
          <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {showQuickPrompts && (
          <div className="mb-2">
            <div className="mb-1 text-[11px] text-muted-foreground">Sugerencias rapidas</div>
            <div className="flex flex-wrap gap-1.5">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => applyQuickPrompt(prompt)}
                  className="rounded-full border border-border/60 bg-background/25 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-background/35 hover:text-foreground"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {showAdvanced ? "Ocultar opciones" : "Mostrar opciones"}
          </button>

          {hasAdvancedActive && (
            <button
              type="button"
              onClick={resetAdvancedOptions}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Restablecer
            </button>
          )}
        </div>

        {showAdvanced && (
          <div className="mb-2 rounded-lg border border-border/50 bg-background/15 px-2 py-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[11px] text-muted-foreground">Modo de respuesta</div>
              <select
                className="h-8 rounded-md border border-input bg-background/35 px-2 text-xs"
                value={askMode}
                onChange={(e) => setAskMode(e.target.value as any)}
              >
                <option value="extractive">Extractivo</option>
                <option value="comparison">Comparacion</option>
                <option value="checklist">Checklist</option>
                <option value="resolution">Resolucion formal</option>
              </select>
            </div>

            <div className="mb-2 text-[11px] text-muted-foreground">
              Extractivo = breve, Comparacion = diferencias, Checklist = lista de items, Resolucion = redaccion formal.
            </div>

            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[11px] text-muted-foreground">Perfil de respuesta</div>
              <select
                className="h-8 rounded-md border border-input bg-background/35 px-2 text-xs"
                value={responseProfile}
                onChange={(e) => setResponseProfile(e.target.value as ResponseProfile)}
              >
                <option value="auto">Auto (recomendado)</option>
                <option value="fast">Rapida</option>
                <option value="balanced">Balanceada</option>
                <option value="deep">Potente</option>
              </select>
            </div>

            <div className="mb-2 text-[11px] text-muted-foreground">
              Rapida = menos latencia, Potente = mas contexto y detalle, Auto = decide segun dificultad.
            </div>

            <div className="mb-1 text-[11px] text-muted-foreground">Filtros (opcional)</div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={filterDocType}
                onChange={(e) => setFilterDocType(e.target.value)}
                className="h-8 rounded-md border border-input bg-background/35 px-2 text-xs"
                placeholder="Tipo doc"
              />
              <input
                value={filterRegion}
                onChange={(e) => setFilterRegion(e.target.value)}
                className="h-8 rounded-md border border-input bg-background/35 px-2 text-xs"
                placeholder="Region"
              />
              <input
                value={filterYearFrom}
                onChange={(e) => setFilterYearFrom(e.target.value)}
                className="h-8 rounded-md border border-input bg-background/35 px-2 text-xs"
                placeholder="Ano desde"
                inputMode="numeric"
              />
              <input
                value={filterYearTo}
                onChange={(e) => setFilterYearTo(e.target.value)}
                className="h-8 rounded-md border border-input bg-background/35 px-2 text-xs"
                placeholder="Ano hasta"
                inputMode="numeric"
              />
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Usa filtros solo si etiquetaste metadatos en las fuentes.
            </div>
          </div>
        )}

        <div className="flex items-end gap-2">
          <Textarea
            ref={questionRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={
              readySources > 0
                ? "Ej: Resume el documento en 5 puntos"
                : "Agrega una fuente para habilitar el chat"
            }
            className="min-h-[44px] resize-none bg-background/35"
            disabled={readySources === 0 || isSending}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                onSend().catch(() => null)
              }
            }}
          />
          <Button
            className="h-11 w-11 rounded-xl"
            onClick={() => onSend().catch(() => null)}
            disabled={!canAsk || !question.trim()}
            title="Enviar"
          >
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            <Sparkles className="mr-1 inline h-3.5 w-3.5" />
            {isSending ? sendingHints[sendingHintIdx] : "Ctrl/Cmd + Enter para enviar"}
          </span>
          <span className="flex items-center gap-1">
            <ArrowUpRight className="h-3.5 w-3.5" />
            Respuestas con citas verificables
          </span>
        </div>
      </div>

      <Dialog open={!!openCitation} onOpenChange={(o) => !o && setOpenCitation(null)}>
        <DialogContent className="max-w-3xl bg-card/85 backdrop-blur supports-[backdrop-filter]:bg-card/65">
          <DialogHeader>
            <DialogTitle>Vista de cita</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-xl border border-border/55 bg-background/25 p-4">
              <div className="text-xs text-muted-foreground">Fragmento citado</div>
              <div className="mt-2 whitespace-pre-wrap text-sm leading-6">
                {openCitation?.quote}
              </div>
            </div>

            <div className="rounded-xl border border-border/55 bg-background/25 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">Ubicacion</div>
                  <div className="mt-1 text-sm">
                    {openCitation?.sourceUrl ? (
                      <span className="font-medium">{openCitation.sourceUrl}</span>
                    ) : (
                      <span className="text-muted-foreground">(sin URL)</span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {openCitation?.page ? `Pagina ${openCitation.page}` : ""}
                    {openCitation?.section ? ` - ${openCitation.section}` : ""}
                  </div>
                </div>
                {openCitation?.sourceUrl && (
                  <Button asChild variant="outline" size="sm" className="gap-2">
                    <a href={openCitation.sourceUrl} target="_blank" rel="noreferrer">
                      <ArrowUpRight className="h-4 w-4" />
                      Abrir fuente
                    </a>
                  </Button>
                )}
                {!openCitation?.sourceUrl && openCitation?.snapshotId && (
                  <Button asChild variant="outline" size="sm" className="gap-2">
                    <a
                      href={`/api/snapshots/${openCitation.snapshotId}/open`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ArrowUpRight className="h-4 w-4" />
                      Abrir snapshot
                    </a>
                  </Button>
                )}
              </div>
            </div>

            {openCitation?.snapshotId ? (
              <div className="rounded-xl border border-border/55 bg-background/25 p-4">
                <div className="text-xs text-muted-foreground">Cadena de custodia</div>
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <div>
                    snapshot_id: <span className="font-code text-foreground/90">{openCitation.snapshotId}</span>
                  </div>
                  {snapshotMetaError ? (
                    <div className="text-destructive">{snapshotMetaError}</div>
                  ) : snapshotMeta ? (
                    <>
                      {snapshotMeta.fetchedAt ? (
                        <div>
                          fetched_at: <span className="font-code text-foreground/90">{snapshotMeta.fetchedAt}</span>
                        </div>
                      ) : null}
                      {snapshotMeta.contentHash ? (
                        <div>
                          hash: <span className="font-code text-foreground/90">{snapshotMeta.contentHash}</span>
                        </div>
                      ) : null}
                      {snapshotMeta.contentType ? (
                        <div>
                          content_type: <span className="font-code text-foreground/90">{snapshotMeta.contentType}</span>
                        </div>
                      ) : null}
                      {snapshotMeta.openaiIndexStatus ? (
                        <div>
                          openai_status: <span className="font-code text-foreground/90">{snapshotMeta.openaiIndexStatus}</span>
                        </div>
                      ) : null}
                      {snapshotMeta.openaiIndexedAt ? (
                        <div>
                          openai_indexed_at:{" "}
                          <span className="font-code text-foreground/90">{snapshotMeta.openaiIndexedAt}</span>
                        </div>
                      ) : null}
                      {snapshotMeta.openaiFileId ? (
                        <div>
                          openai_file_id: <span className="font-code text-foreground/90">{snapshotMeta.openaiFileId}</span>
                        </div>
                      ) : null}
                      {snapshotMeta.openaiLastError ? (
                        <div className="text-destructive">openai_error: {snapshotMeta.openaiLastError}</div>
                      ) : null}
                    </>
                  ) : (
                    <div>Cargando...</div>
                  )}
                </div>
              </div>
            ) : null}

            <div className="rounded-xl border border-border/55 bg-background/25 p-4">
              <div className="text-xs text-muted-foreground">Contexto (chunk)</div>
              <div className="mt-2 whitespace-pre-wrap font-code text-xs leading-5 text-foreground/90">
                {chunkDetail ? chunkDetail.content : "Cargando..."}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isThreadOpen} onOpenChange={setIsThreadOpen}>
        <DialogContent className="max-w-lg bg-card/85 backdrop-blur supports-[backdrop-filter]:bg-card/65">
          <DialogHeader>
            <DialogTitle>Nuevo hilo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Titulo</div>
              <input
                value={threadTitle}
                onChange={(e) => setThreadTitle(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background/35 px-3 py-2 text-sm"
                placeholder="Ej: Ruido"
              />
            </div>
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Finalidad (opcional)</div>
              <textarea
                value={threadPurpose}
                onChange={(e) => setThreadPurpose(e.target.value)}
                className="min-h-[90px] w-full rounded-md border border-input bg-background/35 px-3 py-2 text-sm"
                placeholder="Ej: Extraer hechos y citas sobre mediciones de ruido"
              />
            </div>
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Modo por defecto</div>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background/35 px-3 py-2 text-sm"
                value={threadMode}
                onChange={(e) => setThreadMode(e.target.value as any)}
              >
                <option value="extractive">Extractivo</option>
                <option value="comparison">Comparacion</option>
                <option value="checklist">Checklist</option>
                <option value="resolution">Modo Resolucion</option>
              </select>
            </div>

            {threadError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {threadError}
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={() => createThread().catch(() => null)} className="gap-2" type="button">
                <Plus className="h-4 w-4" />
                Crear
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
