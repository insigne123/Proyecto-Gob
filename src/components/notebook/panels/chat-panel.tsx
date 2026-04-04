"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  ArrowUpRight,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  ThumbsDown,
  ThumbsUp,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  Plus,
  Quote,
  Send,
  UploadCloud,
  X,
} from "lucide-react"

type Citation = {
  chunkId: string
  quote: string
  sourceUrl: string | null
  snapshotId: string | null
  page: number | null
  section: string | null
  citationType?: "db_chunk" | "managed_file_span" | "synthetic" | string
  verification?: "db_chunk_text" | "retrieval_snippet" | string
}

type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  created_at: string | null
  citations: Citation[] | null
   model?: string | null
   usage?: any
}

type ChatStyle = "auto" | "fast" | "balanced" | "deep"

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

type SourceLite = {
  id: string
  workspace_id: string | null
  title: string | null
  filename: string | null
  status: "pending" | "processing" | "ready" | "error"
  snapshots_count: number | null
  updated_at: string | null
  last_error: string | null
}

type AttachmentSource = {
  id: string
  title: string
  status: "pending" | "processing" | "ready" | "error"
  snapshotsCount: number | null
  updatedAt: string | null
  lastError: string | null
}

type IncomingReviewAsk = {
  paragraphIndex: number | null
  sourceTitle: string | null
  preview: string
}

type ChatThread = {
  id: string
  title: string
  purpose: string | null
  mode: "extractive" | "comparison" | "checklist" | "resolution"
  createdAt: string | null
  updatedAt: string | null
}

type AssistantReport = {
  mode: "extractive" | "comparison" | "checklist" | "resolution"
  requestedProfile: ChatStyle | string
  resolvedProfile: ChatStyle | string
  difficulty: "simple" | "medium" | "complex" | string
  retrievalProvider: "local" | "openai" | "hybrid" | string
  sourceScope: "workspace_only" | "workspace_plus_members" | "attached_source" | string
  evidenceCount: number
  citationsCount: number
  retrievalMs: number
  generationMs: number
  totalMs: number
  expandedScope: boolean
  deepened: boolean
  rerankApplied: boolean
  verificationApplied: boolean
  verificationDroppedParagraphs: number
  supportStrength: "none" | "weak" | "partial" | "strong" | string | null
  supportReason: string | null
  supportParagraphRatio: number | null
  supportCandidateParagraphs: number | null
  supportSupportedParagraphs: number | null
  supportUniqueCitationChunks: number | null
  retrievalQueryCount: number
  retrievalQueries: string[]
  attachedSourceTitle: string | null
  model: string | null
  skipReason: "smalltalk" | "meta_assistant" | null
  worklog: Array<{ label: string; detail: string }>
}

type AssistantFeedback = {
  vote: "useful" | "not_useful"
  reason: string | null
  at: string
  byUser: string | null
}

type LiveStage = {
  label: string
  detail: string
}

function splitParagraphs(text: string) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
}

function shortInline(value: string, max = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function highlightQuoteInChunk(content: string, quote: string) {
  const text = String(content || "")
  const needle = String(quote || "").trim()
  if (!text || !needle || needle.length < 8) return text

  const idx = text.toLowerCase().indexOf(needle.toLowerCase())
  if (idx < 0) return text

  const end = Math.min(text.length, idx + needle.length)
  return (
    <>
      <span>{text.slice(0, idx)}</span>
      <mark className="rounded-sm bg-emerald-500/20 px-0.5">{text.slice(idx, end)}</mark>
      <span>{text.slice(end)}</span>
    </>
  )
}

function formatDuration(ms: number | null | undefined) {
  const value = Number(ms || 0)
  if (!Number.isFinite(value) || value <= 0) return "-"
  if (value < 1000) return `${value} ms`
  return `${(value / 1000).toFixed(1)} s`
}

function profileLabel(profile: string | null | undefined) {
  if (profile === "fast") return "Rapida"
  if (profile === "balanced") return "Balanceada"
  if (profile === "deep") return "Potente"
  if (profile === "auto") return "Auto"
  return String(profile || "-")
}

function difficultyLabel(difficulty: string | null | undefined) {
  if (difficulty === "simple") return "Simple"
  if (difficulty === "medium") return "Media"
  if (difficulty === "complex") return "Compleja"
  return String(difficulty || "-")
}

function modeLabel(mode: string | null | undefined) {
  if (mode === "extractive") return "Extractivo"
  if (mode === "comparison") return "Comparativo"
  if (mode === "checklist") return "Checklist"
  if (mode === "resolution") return "Resolutivo"
  return String(mode || "-")
}

function scopeLabel(scope: string | null | undefined) {
  if (scope === "attached_source") return "Adjunto"
  if (scope === "workspace_plus_members") return "Workspace + vinculados"
  if (scope === "workspace_only") return "Solo workspace"
  return String(scope || "-")
}

function supportLabel(strength: string | null | undefined) {
  if (strength === "strong") return "Sustento fuerte"
  if (strength === "partial") return "Sustento parcial"
  if (strength === "weak") return "Sustento debil"
  if (strength === "none") return "Sin sustento"
  return String(strength || "-")
}

function threadStorageKey(workspaceId: string) {
  return `ca:chat:thread:${workspaceId}`
}

function assistantReportFromUsage(usage: any): AssistantReport | null {
  if (!usage || typeof usage !== "object") return null
  const report = (usage as any).assistantReport
  if (!report || typeof report !== "object") return null
  return report as AssistantReport
}

function assistantFeedbackFromUsage(usage: any): AssistantFeedback | null {
  if (!usage || typeof usage !== "object") return null
  const feedback = (usage as any).assistantFeedback
  if (!feedback || typeof feedback !== "object") return null
  const vote = String(feedback.vote || "")
  if (vote !== "useful" && vote !== "not_useful") return null
  return {
    vote,
    reason: feedback.reason ? String(feedback.reason) : null,
    at: feedback.at ? String(feedback.at) : "",
    byUser: feedback.byUser ? String(feedback.byUser) : null,
  }
}

async function readSseStream(params: {
  response: Response
  onStage: (stage: LiveStage) => void
  onFinal: (payload: any) => void
}) {
  const reader = params.response.body?.getReader()
  if (!reader) throw new Error("No se pudo abrir el stream de respuesta")

  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    while (buffer.includes("\n\n")) {
      const boundary = buffer.indexOf("\n\n")
      const rawEvent = buffer.slice(0, boundary).trim()
      buffer = buffer.slice(boundary + 2)

      if (!rawEvent) continue

      let eventName = "message"
      let data = ""
      for (const line of rawEvent.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim()
        if (line.startsWith("data:")) data += line.slice(5).trim()
      }

      const payload = data ? JSON.parse(data) : null

      if (eventName === "stage" && payload) {
        params.onStage({ label: String(payload.label || "Trabajando"), detail: String(payload.detail || "") })
      }

      if (eventName === "error") {
        throw new Error(String(payload?.error || "No se pudo completar la respuesta"))
      }

      if (eventName === "final") {
        params.onFinal(payload)
      }
    }
  }
}

function buildPendingWorklog(params: { chatStyle: ChatStyle; attachedSourceTitle: string | null }) {
  const styleDetail =
    params.chatStyle === "deep"
      ? "Profundidad alta"
      : params.chatStyle === "balanced"
        ? "Profundidad balanceada"
        : params.chatStyle === "fast"
          ? "Respuesta agil"
          : "Perfil automatico"

  return [
    {
      label: "Interpretando consulta",
      detail: `${styleDetail}. Estoy detectando el tipo de tarea y el mejor camino de analisis.`,
    },
    {
      label: "Planificando la busqueda",
      detail: params.attachedSourceTitle
        ? `Priorizo el adjunto ${params.attachedSourceTitle} y lo conecto con el resto del workspace.`
        : "Defino alcance, perfiles y variantes de retrieval para traer evidencia util.",
    },
    {
      label: "Contrastando evidencia",
      detail: "Busco fuentes relevantes y descarto fragmentos que no ayuden a responder con trazabilidad.",
    },
    {
      label: "Verificando respaldo",
      detail: "Reviso citas y preparo una respuesta clara, practica y sustentada.",
    },
  ]
}

function AssistantReportCard({ report }: { report: AssistantReport }) {
  return (
    <details className="mt-3 rounded-xl border border-border/55 bg-background/25 p-3 text-xs text-muted-foreground">
      <summary className="cursor-pointer list-none text-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <BrainCircuit className="h-3.5 w-3.5 text-emerald-300" />
          <span className="font-medium">Bitacora de trabajo</span>
          <span className="rounded-full border border-border/60 px-2 py-0.5">{profileLabel(report.resolvedProfile)}</span>
          <span className="rounded-full border border-border/60 px-2 py-0.5">{difficultyLabel(report.difficulty)}</span>
          <span className="rounded-full border border-border/60 px-2 py-0.5">{report.evidenceCount} evidencia(s)</span>
          <span className="rounded-full border border-border/60 px-2 py-0.5">{formatDuration(report.totalMs)}</span>
        </div>
      </summary>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div className="rounded-lg border border-border/50 bg-background/25 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Enfoque</div>
          <div className="mt-1 text-foreground/90">
            Modo {modeLabel(report.mode)} · Provider {report.retrievalProvider} · Alcance {scopeLabel(report.sourceScope)}
          </div>
        </div>
        <div className="rounded-lg border border-border/50 bg-background/25 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Control de calidad</div>
          <div className="mt-1 text-foreground/90">
            {report.verificationApplied ? "Verificacion final activa" : "Sin verificacion extra"}
            {report.verificationDroppedParagraphs > 0
              ? ` · ${report.verificationDroppedParagraphs} tramo(s) depurados`
              : ""}
          </div>
          {report.supportStrength ? (
            <div className="mt-1 text-foreground/90">
              {supportLabel(report.supportStrength)}
              {typeof report.supportParagraphRatio === "number"
                ? ` · cobertura ${(report.supportParagraphRatio * 100).toFixed(0)}%`
                : ""}
            </div>
          ) : null}
          {report.supportReason ? <div className="mt-1 leading-5">{report.supportReason}</div> : null}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {report.worklog.map((step, idx) => (
          <div key={`${step.label}_${idx}`} className="rounded-lg border border-border/45 bg-background/25 px-2.5 py-2">
            <div className="font-medium text-foreground/95">{step.label}</div>
            <div className="mt-1 leading-5">{step.detail}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <span className="rounded-full border border-border/60 px-2 py-0.5">Retrieval {formatDuration(report.retrievalMs)}</span>
        <span className="rounded-full border border-border/60 px-2 py-0.5">Generacion {formatDuration(report.generationMs)}</span>
        <span className="rounded-full border border-border/60 px-2 py-0.5">{report.citationsCount} cita(s)</span>
        <span className="rounded-full border border-border/60 px-2 py-0.5">{report.retrievalQueryCount} consulta(s)</span>
        {report.deepened ? <span className="rounded-full border border-emerald-500/35 px-2 py-0.5 text-emerald-100">Busqueda ampliada</span> : null}
        {report.rerankApplied ? <span className="rounded-full border border-emerald-500/35 px-2 py-0.5 text-emerald-100">Rerank</span> : null}
        {report.model ? <span className="rounded-full border border-border/60 px-2 py-0.5">{report.model}</span> : null}
      </div>

      {report.retrievalQueries.length ? (
        <div className="mt-3 rounded-lg border border-border/45 bg-background/25 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Consultas de retrieval</div>
          <div className="mt-1 space-y-1">
            {report.retrievalQueries.map((query, idx) => (
              <div key={`${query}_${idx}`} className="leading-5 text-foreground/90">
                {idx + 1}. {query}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </details>
  )
}

export function ChatPanel({ workspaceId }: { workspaceId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [question, setQuestion] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [isCreatingThread, setIsCreatingThread] = useState(false)
  const [feedbackSubmitting, setFeedbackSubmitting] = useState<Record<string, boolean>>({})
  const [liveStages, setLiveStages] = useState<LiveStage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [readySources, setReadySources] = useState(0)
  const [sourceCatalog, setSourceCatalog] = useState<SourceLite[]>([])
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [attachedSource, setAttachedSource] = useState<AttachmentSource | null>(null)
  const [incomingReviewAsk, setIncomingReviewAsk] = useState<IncomingReviewAsk | null>(null)

  const [chatStyle, setChatStyle] = useState<ChatStyle>("auto")

  const [openCitation, setOpenCitation] = useState<Citation | null>(null)
  const [chunkDetail, setChunkDetail] = useState<ChunkDetail | null>(null)
  const [snapshotMeta, setSnapshotMeta] = useState<SnapshotMeta | null>(null)
  const [snapshotMetaError, setSnapshotMetaError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const messagesViewportRef = useRef<HTMLDivElement | null>(null)
  const questionRef = useRef<HTMLTextAreaElement | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement | null>(null)
  const [sendingHintIdx, setSendingHintIdx] = useState(0)

  const profileMeta = useMemo(
    () => ({
      auto: {
        label: "Auto",
        description: "Ajusta profundidad segun la dificultad de la pregunta.",
        placeholder: "Escribe una consulta y el sistema elegira el mejor perfil...",
      },
      fast: {
        label: "Rapida",
        description: "Respuestas breves para orientacion y hallazgos puntuales.",
        placeholder: "Escribe una pregunta puntual o una solicitud breve...",
      },
      balanced: {
        label: "Balanceada",
        description: "Equilibra velocidad, evidencia y contexto.",
        placeholder: "Escribe una consulta de trabajo con contexto moderado...",
      },
      deep: {
        label: "Profunda",
        description: "Profundiza en estrategia, comparaciones y resolucion.",
        placeholder: "Pide un analisis tecnico o una revision juridica detallada...",
      },
    }),
    []
  )

  const pendingWorklog = useMemo(
    () => buildPendingWorklog({ chatStyle, attachedSourceTitle: attachedSource?.title || null }),
    [attachedSource?.title, chatStyle]
  )

  const currentWorklog = liveStages.length ? liveStages : pendingWorklog
  const activeWorklogIndex = liveStages.length
    ? Math.max(0, currentWorklog.length - 1)
    : Math.min(sendingHintIdx, Math.max(0, currentWorklog.length - 1))
  const currentWorklogStep = currentWorklog[activeWorklogIndex] || null

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) || null,
    [selectedThreadId, threads]
  )

  const starterPrompts = useMemo(
    () => [
      "Resume el marco teorico del proyecto y dime cuales son las 3 causas mas utiles para defensa.",
      "Que criterios del SEA aparecen en los evacua informes y como terminaron esas causas?",
      "Compara esta causa con los precedentes mas fuertes y dime que estrategia conviene mantener.",
      "Revisa mi borrador y senala debilidades, riesgos y mejoras con citas verificables.",
    ],
    []
  )

  async function loadMessages(threadId = selectedThreadId) {
    const query = threadId ? `?threadId=${encodeURIComponent(threadId)}` : ""
    const res = await fetch(`/api/workspaces/${workspaceId}/chat${query}`, {
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
    if (res.ok) {
      setThreads(Array.isArray(json?.threads) ? (json.threads as ChatThread[]) : [])
    }
  }

  async function loadSourceReadiness() {
    const res = await fetch(`/api/workspaces/${workspaceId}/sources`, {
      method: "GET",
      headers: { accept: "application/json" },
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) return
    const sources = (json?.sources ?? []) as SourceLite[]
    setSourceCatalog(sources)
    const count = sources.filter((s) => s.status === "ready").length
    setReadySources(count)

    setAttachedSource((prev) => {
      if (!prev) return null
      const next = sources.find((s) => String(s.id) === prev.id)
      if (!next) return prev
      return {
        id: String(next.id),
        title: String(next.title || next.filename || prev.title || "Documento"),
        status: next.status,
        snapshotsCount: next.snapshots_count,
        updatedAt: next.updated_at,
        lastError: next.last_error,
      }
    })
  }

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(threadStorageKey(workspaceId))
      setSelectedThreadId(saved ? String(saved) : null)
    } catch {
      setSelectedThreadId(null)
    }
  }, [workspaceId])

  useEffect(() => {
    try {
      if (selectedThreadId) {
        window.localStorage.setItem(threadStorageKey(workspaceId), selectedThreadId)
      } else {
        window.localStorage.removeItem(threadStorageKey(workspaceId))
      }
    } catch {
      // ignore
    }
  }, [selectedThreadId, workspaceId])

  useEffect(() => {
    let alive = true
    setIsLoading(true)
    setAttachedSource(null)
    setAttachmentError(null)
    Promise.all([loadMessages(selectedThreadId), loadSourceReadiness(), loadThreads()])
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
  }, [workspaceId, selectedThreadId])

  useEffect(() => {
    const viewport = messagesViewportRef.current
    if (!viewport) return
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" })
  }, [messages.length, isSending])

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`ca:chat:style:${workspaceId}`)
      if (saved === "auto" || saved === "fast" || saved === "balanced" || saved === "deep") {
        setChatStyle(saved)
      }
    } catch {
      // ignore
    }
  }, [workspaceId])

  useEffect(() => {
    try {
      window.localStorage.setItem(`ca:chat:style:${workspaceId}`, chatStyle)
    } catch {
      // ignore
    }
  }, [workspaceId, chatStyle])

  useEffect(() => {
    if (!isSending) {
      setSendingHintIdx(0)
      return
    }
    if (liveStages.length > 0) {
      return
    }
    const id = window.setInterval(() => {
      setSendingHintIdx((x) => Math.min(x + 1, pendingWorklog.length - 1))
    }, 1400)
    return () => window.clearInterval(id)
  }, [isSending, liveStages.length, pendingWorklog.length])

  useEffect(() => {
    if (!attachedSource?.id) return
    if (attachedSource.status === "ready" || attachedSource.status === "error") return

    const id = window.setInterval(() => {
      loadSourceReadiness().catch(() => null)
    }, 3000)

    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachedSource?.id, attachedSource?.status, workspaceId])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail || {}
      const text = String(detail.question || "").trim()
      if (!text) return

      const origin = String(detail.origin || "")
      const paragraphIndexRaw = Number(detail.paragraphIndex)
      const paragraphIndex = Number.isFinite(paragraphIndexRaw) && paragraphIndexRaw >= 0 ? Math.floor(paragraphIndexRaw) : null
      const sourceTitle = detail.sourceTitle ? String(detail.sourceTitle) : null

      const sourceId = detail.sourceId ? String(detail.sourceId) : null
      if (sourceId) {
        attachSourceById(sourceId)
      }

      if (origin === "document-review") {
        setIncomingReviewAsk({
          paragraphIndex,
          sourceTitle,
          preview: shortInline(text, 170),
        })
      }

      setQuestion(text)

      if (!isSending) {
        onSend(text, sourceId).catch(() => null)
      }
    }

    window.addEventListener("ca:chat-ask", handler as any)
    return () => window.removeEventListener("ca:chat-ask", handler as any)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSending, sourceCatalog, workspaceId, attachedSource?.id])

  useEffect(() => {
    if (!incomingReviewAsk) return
    const id = window.setTimeout(() => setIncomingReviewAsk(null), 12000)
    return () => window.clearTimeout(id)
  }, [incomingReviewAsk])

  const canAsk = readySources > 0 && !isSending

  function styleToPayload(style: ChatStyle) {
    if (style === "deep") {
      return { mode: "resolution" as const, responseProfile: "deep" as const }
    }
    if (style === "balanced") {
      return { mode: "comparison" as const, responseProfile: "balanced" as const }
    }
    if (style === "auto") {
      return { mode: "resolution" as const, responseProfile: "auto" as const }
    }
    return { mode: "extractive" as const, responseProfile: "fast" as const }
  }

  async function createThread(options?: { title?: string; keepMessages?: boolean }) {
    if (isCreatingThread) return null

    const stylePayload = styleToPayload(chatStyle)
    const fallbackTitle = `Conversacion ${new Date().toLocaleString("es-CL", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })}`
    const title = (options?.title || question || fallbackTitle).replace(/\s+/g, " ").trim().slice(0, 140)

    setIsCreatingThread(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/threads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.length >= 2 ? title : fallbackTitle,
          purpose: null,
          mode: stylePayload.mode,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.id) {
        throw new Error(json?.error || "No se pudo crear la conversacion")
      }

      const nextThreadId = String(json.id)
      await loadThreads().catch(() => null)
      setSelectedThreadId(nextThreadId)
      if (!options?.keepMessages) {
        setMessages([])
      }
      return nextThreadId
    } catch (err: any) {
      setError(err?.message || "No se pudo crear la conversacion")
      return null
    } finally {
      setIsCreatingThread(false)
    }
  }

  async function submitAssistantFeedback(messageId: string, vote: "useful" | "not_useful", reason?: string | null) {
    setFeedbackSubmitting((prev) => ({ ...prev, [messageId]: true }))
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/chat/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId, vote, reason: reason || null }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(json?.error || "No se pudo guardar el feedback")
      }

      setMessages((prev) =>
        prev.map((message) => {
          if (message.id !== messageId) return message
          const usage = message.usage && typeof message.usage === "object" ? { ...message.usage } : {}
          return {
            ...message,
            usage: {
              ...usage,
              assistantFeedback: json?.feedback || null,
            },
          }
        })
      )
    } catch (err: any) {
      setError(err?.message || "No se pudo guardar el feedback")
    } finally {
      setFeedbackSubmitting((prev) => ({ ...prev, [messageId]: false }))
    }
  }

  async function onAttachmentPicked(file: File | null) {
    if (!file) return

    setAttachmentError(null)
    const mime = String(file.type || "").toLowerCase()
    const lowerName = String(file.name || "").toLowerCase().trim()
    const isPdf = mime.includes("pdf") || lowerName.endsWith(".pdf")
    const isDocx = mime.includes("wordprocessingml.document") || lowerName.endsWith(".docx")
    const isSupported = isPdf || isDocx

    if (!isSupported) {
      setAttachmentError("Solo PDF o DOCX por ahora.")
      return
    }

    if (file.size > 50 * 1024 * 1024) {
      setAttachmentError("Archivo demasiado grande (maximo 50MB)")
      return
    }

    setIsUploadingAttachment(true)
    try {
      const fd = new FormData()
      fd.set("kind", "upload")
      fd.set("file", file)
      fd.set("docType", "Informe externo")
      fd.set("sourceOrigin", "chat-upload")

      const res = await fetch(`/api/workspaces/${workspaceId}/sources`, {
        method: "POST",
        body: fd,
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(json?.error || "No se pudo subir el archivo")
      }

      const sourceId = String(json?.id || "")
      if (!sourceId) {
        throw new Error("No se pudo identificar la fuente subida")
      }

      setAttachedSource({
        id: sourceId,
        title: file.name,
        status: "pending",
        snapshotsCount: null,
        updatedAt: null,
        lastError: null,
      })

      if (!question.trim()) {
        setQuestion(
          "Revisa profesionalmente el documento adjunto y entrega: fortalezas, hallazgos criticos/mayores/menores y recomendaciones accionables."
        )
      }

      await loadSourceReadiness().catch(() => null)
      try {
        window.dispatchEvent(new CustomEvent("ca:sources-changed"))
      } catch {
        // ignore
      }
    } catch (err: any) {
      setAttachmentError(err?.message ?? "Error subiendo archivo")
    } finally {
      setIsUploadingAttachment(false)
    }
  }

  function clearAttachment() {
    setAttachedSource(null)
    setAttachmentError(null)
  }

  function attachSourceById(sourceId: string | null | undefined) {
    if (!sourceId) return
    const found = sourceCatalog.find((source) => String(source.id) === String(sourceId))
    if (!found) return

    setAttachedSource({
      id: String(found.id),
      title: String(found.title || found.filename || "Documento"),
      status: found.status,
      snapshotsCount: found.snapshots_count,
      updatedAt: found.updated_at,
      lastError: found.last_error,
    })
  }

  async function onSend(forcedQuestion?: string, forcedSourceId?: string | null) {
    if (isSending) return

    const q = (forcedQuestion ?? question).trim()
    if (!q) return

    if (!forcedSourceId && attachedSource && attachedSource.status !== "ready") {
      setError("El archivo adjunto aun se esta procesando. Espera a que quede en estado Listo.")
      return
    }

    setError(null)
    setIsSending(true)
    setLiveStages([])
    setQuestion("")

    const optimisticId = `tmp_${Date.now()}`
    setMessages((prev) => [
      ...prev,
      { id: optimisticId, role: "user", content: q, created_at: null, citations: null },
    ])

    try {
      const stylePayload = styleToPayload(chatStyle)

      const res = await fetch(`/api/workspaces/${workspaceId}/chat/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: q,
          threadId: selectedThreadId || undefined,
          sourceId:
            forcedSourceId ||
            (attachedSource?.status === "ready" ? attachedSource.id : undefined),
          mode: stylePayload.mode,
          responseProfile: stylePayload.responseProfile,
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error || "No se pudo enviar la consulta")
      }

      let finalPayload: any = null
      await readSseStream({
        response: res,
        onStage: (stage) => {
          setLiveStages((prev) => {
            const last = prev[prev.length - 1]
            if (last?.label === stage.label && last?.detail === stage.detail) return prev
            return [...prev, stage]
          })
        },
        onFinal: (payload) => {
          finalPayload = payload
        },
      })

      if (Array.isArray(finalPayload?.messages)) {
        setMessages(finalPayload.messages)
      } else if (finalPayload?.assistantMessage) {
        setMessages((prev) => {
          const withoutTmp = prev.filter((m) => m.id !== optimisticId)
          return [...withoutTmp, finalPayload.userMessage, finalPayload.assistantMessage]
        })
        await loadThreads().catch(() => null)
      } else {
        await loadMessages()
      }
    } catch (err: any) {
      const message = err?.message ?? "Error inesperado"
      setError(message)
      setMessages((prev) => {
        const optimisticMessage: ChatMessage = {
          id: optimisticId,
          role: "user",
          content: q,
          created_at: null,
          citations: null,
        }
        const errorAssistantMessage: ChatMessage = {
          id: `assistant_error_${Date.now()}`,
          role: "assistant",
          content:
            "No pude responder esta consulta en este intento. Intenta nuevamente en unos segundos. Si estabas usando un adjunto, verifica que este en estado Listo.",
          created_at: null,
          citations: null,
        }

        const hasOptimistic = prev.some((m) => m.id === optimisticId)
        const next = hasOptimistic ? prev : [...prev, optimisticMessage]

        return [...next, errorAssistantMessage]
      })
    } finally {
      setLiveStages([])
      setIsSending(false)
    }
  }

  function runAttachedReviewPrompt() {
    onSend(
      "Revisa profesionalmente el documento adjunto y entrega: 1) fortalezas, 2) hallazgos criticos/mayores/menores, 3) recomendaciones concretas para mejorar el escrito."
    ).catch(() => null)
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
          <div className="text-sm font-semibold">Asistente experto</div>
          <div className="text-[11px] text-muted-foreground">
            Consulta sobre la causa, el marco teorico, los documentos y la estrategia de defensa. Responde con citas verificables.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="hidden rounded-full border border-border/60 bg-background/35 px-3 py-1 text-[11px] text-muted-foreground md:block">
            {readySources} fuente{readySources === 1 ? "" : "s"} lista{readySources === 1 ? "" : "s"}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={isCreatingThread}
            onClick={() => createThread().catch(() => null)}
          >
            {isCreatingThread ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />}
            Nueva conversacion
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 md:grid-cols-[270px_minmax(0,1fr)]">
        <aside className="hidden border-r border-border/60 bg-background/20 md:flex md:min-h-0 md:flex-col">
          <div className="border-b border-border/50 px-3 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conversaciones</div>
            <div className="mt-2 space-y-2">
              <Button
                variant={selectedThreadId ? "outline" : "default"}
                size="sm"
                className="w-full justify-start gap-2"
                onClick={() => setSelectedThreadId(null)}
              >
                <Plus className="h-4 w-4" />
                Conversacion general
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2"
                disabled={isCreatingThread}
                onClick={() => createThread().catch(() => null)}
              >
                {isCreatingThread ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />}
                Nuevo hilo
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            <div className="space-y-1.5">
              {threads.length ? (
                threads.map((thread) => {
                  const active = thread.id === selectedThreadId
                  return (
                    <button
                      key={thread.id}
                      type="button"
                      onClick={() => setSelectedThreadId(thread.id)}
                      className={cn(
                        "w-full rounded-xl border px-3 py-2 text-left transition-colors",
                        active
                          ? "border-emerald-400/50 bg-emerald-500/12 text-foreground"
                          : "border-border/55 bg-background/25 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <div className="line-clamp-2 text-sm font-medium">{thread.title}</div>
                      <div className="mt-1 flex items-center gap-2 text-[11px]">
                        <span>{modeLabel(thread.mode)}</span>
                        <span>·</span>
                        <span>{thread.updatedAt ? new Date(thread.updatedAt).toLocaleDateString("es-CL") : "Reciente"}</span>
                      </div>
                      {thread.purpose ? <div className="mt-1 line-clamp-2 text-[11px]">{thread.purpose}</div> : null}
                    </button>
                  )
                })
              ) : (
                <div className="rounded-xl border border-dashed border-border/60 px-3 py-6 text-xs text-muted-foreground">
                  Aun no hay hilos guardados. Puedes crear uno para separar estrategias, informes o temas por expediente.
                </div>
              )}
            </div>
          </div>
        </aside>

        <div className="relative min-h-0 flex-1">
          <div className="border-b border-border/50 px-4 py-2 text-[11px] text-muted-foreground md:hidden">
            {activeThread ? `Hilo activo: ${activeThread.title}` : "Modo general"}
          </div>

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
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => {
                      try {
                        window.dispatchEvent(new CustomEvent("ca:open-sources"))
                      } catch {
                        // ignore
                      }
                    }}
                  >
                    <Paperclip className="h-4 w-4" />
                    Abrir Fuentes
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => attachmentInputRef.current?.click()}
                  >
                    <UploadCloud className="h-4 w-4" />
                    Subir informe al chat
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div ref={messagesViewportRef} className="hide-scrollbar h-full overflow-y-auto">
              <div className="space-y-4 px-4 py-4">
                <div className="rounded-xl border border-border/55 bg-background/20 px-3 py-2 text-[11px] text-muted-foreground">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      {activeThread ? (
                        <>
                          <span className="font-medium text-foreground/90">{activeThread.title}</span>
                          <span> · {modeLabel(activeThread.mode)}</span>
                        </>
                      ) : (
                        <span className="font-medium text-foreground/90">Conversacion general</span>
                      )}
                    </div>
                    <div className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5">
                      <Clock3 className="h-3.5 w-3.5" />
                      Historial {selectedThreadId ? "por hilo" : "compartido"}
                    </div>
                  </div>
                </div>

                {isLoading ? (
                  <div className="text-sm text-muted-foreground">Cargando conversacion...</div>
                ) : messages.length ? (
                  messages.map((m) => {
                    const assistantReport = assistantReportFromUsage(m.usage)
                    const assistantFeedback = assistantFeedbackFromUsage(m.usage)
                    return (
                      <div
                        key={m.id}
                        className={cn(
                          "max-w-[92%] rounded-2xl border border-border/55 px-4 py-3",
                          m.role === "user" ? "ml-auto bg-emerald-500/12" : "mr-auto bg-background/25"
                        )}
                      >
                        {m.role === "assistant" && assistantReport?.supportStrength && assistantReport.supportStrength !== "strong" ? (
                          <div className="mb-3 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                            <div className="font-medium">{supportLabel(assistantReport.supportStrength)}</div>
                            <div className="mt-1 text-amber-50/90">
                              {assistantReport.supportReason || "La respuesta se sostiene con evidencia parcial y conviene contrastarla con mas fuentes."}
                            </div>
                          </div>
                        ) : null}
                        <div className="space-y-3 break-words text-[15px] leading-7">
                          {splitParagraphs(m.content).map((paragraph, idx) => (
                            <p key={`${m.id}_p_${idx}`} className="whitespace-pre-wrap text-foreground/95">
                              {paragraph}
                            </p>
                          ))}
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
                        {m.role === "assistant" ? (
                          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>Te sirvio esta respuesta?</span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className={cn(
                                "h-7 gap-1.5 rounded-full px-3 text-xs",
                                assistantFeedback?.vote === "useful" && "border-emerald-500/40 text-emerald-200"
                              )}
                              disabled={Boolean(feedbackSubmitting[m.id])}
                              onClick={() => submitAssistantFeedback(m.id, "useful").catch(() => null)}
                            >
                              {feedbackSubmitting[m.id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ThumbsUp className="h-3.5 w-3.5" />}
                              Util
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className={cn(
                                "h-7 gap-1.5 rounded-full px-3 text-xs",
                                assistantFeedback?.vote === "not_useful" && "border-amber-500/40 text-amber-100"
                              )}
                              disabled={Boolean(feedbackSubmitting[m.id])}
                              onClick={() => submitAssistantFeedback(m.id, "not_useful", "weak_evidence").catch(() => null)}
                            >
                              {feedbackSubmitting[m.id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ThumbsDown className="h-3.5 w-3.5" />}
                              Falto evidencia
                            </Button>
                            {assistantFeedback?.vote ? (
                              <span className="rounded-full border border-border/60 px-2 py-0.5">
                                Feedback: {assistantFeedback.vote === "useful" ? "util" : "no util"}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        {m.role === "assistant" && assistantReport ? <AssistantReportCard report={assistantReport} /> : null}
                      </div>
                    )
                  })
                ) : (
                  <div className="rounded-2xl border border-dashed border-border/60 bg-background/20 p-4">
                    <div className="text-sm font-medium text-foreground">Puedes pedirme cosas como estas</div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {starterPrompts.map((prompt, idx) => (
                        <button
                          key={`${prompt}_${idx}`}
                          type="button"
                          onClick={() => setQuestion(prompt)}
                          className="rounded-xl border border-border/55 bg-background/25 px-3 py-3 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {isSending ? (
                  <div className="mr-auto max-w-[92%] rounded-2xl border border-emerald-500/20 bg-emerald-500/8 px-4 py-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground/95">
                      <Loader2 className="h-4 w-4 animate-spin text-emerald-300" />
                      Trabajando en la respuesta
                    </div>
                    <div className="space-y-2">
                      {currentWorklog.map((step, idx) => {
                        const done = idx < activeWorklogIndex
                        const active = idx === activeWorklogIndex
                        return (
                          <div
                            key={`${step.label}_${idx}`}
                            className={cn(
                              "rounded-xl border px-3 py-2 text-xs transition-colors",
                              done
                                ? "border-emerald-500/35 bg-emerald-500/12 text-emerald-100"
                                : active
                                  ? "border-emerald-400/35 bg-background/30 text-foreground"
                                  : "border-border/45 bg-background/20 text-muted-foreground"
                            )}
                          >
                            <div className="flex items-center gap-2 font-medium">
                              {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="h-3.5 w-3.5 rounded-full border border-current/50" />}
                              {step.label}
                            </div>
                            <div className="mt-1 leading-5">{step.detail}</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : null}

                <div ref={bottomRef} />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border/60 p-3">
        <input
          ref={attachmentInputRef}
          type="file"
          accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
          className="hidden"
          disabled={isSending || isUploadingAttachment}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] || null
            onAttachmentPicked(file).catch(() => null)
            event.currentTarget.value = ""
          }}
        />

        {error && (
          <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {attachmentError && (
          <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {attachmentError}
          </div>
        )}

        {incomingReviewAsk ? (
          <div className="mb-3 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100">
            <div className="flex items-start justify-between gap-2">
              <div>
                Consulta recibida desde Revision de informe
                {incomingReviewAsk.paragraphIndex !== null
                  ? ` (Parrafo ${incomingReviewAsk.paragraphIndex + 1})`
                  : ""}
                .
                {incomingReviewAsk.sourceTitle ? ` Documento: ${incomingReviewAsk.sourceTitle}.` : ""}
              </div>
              <button
                type="button"
                className="text-emerald-200 hover:text-emerald-100"
                onClick={() => setIncomingReviewAsk(null)}
              >
                Ocultar
              </button>
            </div>
            {incomingReviewAsk.preview ? (
              <div className="mt-1 text-emerald-50/90">{"\""}{incomingReviewAsk.preview}{"\""}</div>
            ) : null}
          </div>
        ) : null}

        {attachedSource ? (
          <div className="mb-3 rounded-lg border border-border/55 bg-background/20 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                <div className="truncate text-xs font-medium">Adjunto: {attachedSource.title}</div>
              </div>
              <button
                type="button"
                onClick={clearAttachment}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
                Quitar
              </button>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                {attachedSource.status === "processing" || attachedSource.status === "pending" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : null}
                Estado: {attachedSource.status === "ready"
                  ? "Listo"
                  : attachedSource.status === "processing"
                    ? "Procesando"
                    : attachedSource.status === "pending"
                      ? "Pendiente"
                      : "Error"}
              </span>
              {attachedSource.status === "ready" ? (
                <button
                  type="button"
                  onClick={runAttachedReviewPrompt}
                  className="text-emerald-300 hover:text-emerald-200"
                >
                  Analizar adjunto ahora
                </button>
              ) : null}
            </div>
            {attachedSource.status === "processing" || attachedSource.status === "pending" ? (
              <div className="mt-1 text-[11px] text-amber-100">
                Estamos procesando el archivo para poder analizarlo con IA. Esto puede tardar unos segundos.
              </div>
            ) : null}
            {attachedSource.lastError ? (
              <div className="mt-1 text-[11px] text-destructive">{attachedSource.lastError}</div>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-2xl border border-border/60 bg-background/30 p-2">
          <div className="flex items-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0 rounded-xl"
              onClick={() => attachmentInputRef.current?.click()}
              disabled={isSending || isUploadingAttachment}
              title={isUploadingAttachment ? "Subiendo informe" : "Adjuntar informe"}
            >
              {isUploadingAttachment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
            </Button>

              <Textarea
                ref={questionRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={
                  readySources > 0 ? profileMeta[chatStyle].placeholder : "Sube una fuente para comenzar"
                }
                className="min-h-[58px] resize-none border-0 bg-transparent text-[15px] leading-7 shadow-none focus-visible:ring-0"
                disabled={readySources === 0}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  onSend().catch(() => null)
                }
              }}
            />

            <Button
              className="h-10 w-10 shrink-0 rounded-xl"
              onClick={() => onSend().catch(() => null)}
              disabled={!canAsk || !question.trim()}
              title="Enviar"
            >
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <div className="mt-1 flex items-center justify-between px-1 text-[11px] text-muted-foreground">
            <span>
              {isSending
                ? `${currentWorklogStep?.label || "Trabajando..."}`
                : activeThread
                  ? `Hilo activo: ${activeThread.title}`
                  : "Ctrl/Cmd + Enter para enviar"}
            </span>
            <div className="flex items-center gap-1.5">
              {(["fast", "balanced", "deep", "auto"] as ChatStyle[]).map((style) => (
                <button
                  key={style}
                  type="button"
                  onClick={() => setChatStyle(style)}
                  title={profileMeta[style].description}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                    chatStyle === style
                      ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-100"
                      : "border-border/60 bg-background/25 text-muted-foreground hover:text-foreground"
                  )}
                >
                  {profileMeta[style].label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-1 px-1 text-[11px] text-muted-foreground">
            {isSending ? currentWorklogStep?.detail || profileMeta[chatStyle].description : profileMeta[chatStyle].description}
          </div>
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
                  <div className="mt-1 text-xs text-muted-foreground">
                    {openCitation?.citationType ? `Tipo cita: ${openCitation.citationType}` : ""}
                    {openCitation?.verification ? ` · verificacion: ${openCitation.verification}` : ""}
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

    </Card>
  )
}
