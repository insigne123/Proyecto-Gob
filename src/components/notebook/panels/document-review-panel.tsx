"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpenText,
  Check,
  Download,
  FileText,
  Layers3,
  Loader2,
  MessageSquare,
  RotateCcw,
  Sparkles,
  UploadCloud,
  Wand2,
  X,
} from "lucide-react"

type SourceRow = {
  id: string
  workspace_id: string | null
  title: string | null
  filename: string | null
  status: "pending" | "processing" | "ready" | "error"
  snapshots_count: number | null
  updated_at: string | null
  last_error: string | null
}

type CitationTags = {
  tribunal: string | null
  rol: string | null
  fecha: string | null
  materia: string | null
  region: string | null
}

type ReviewCitation = {
  chunkId: string
  quote: string
  sourceUrl: string | null
  snapshotId: string | null
  page: number | null
  section: string | null
  origin: "document" | "cross_case"
  tags?: CitationTags
}

type ReviewSuggestion = {
  id: string
  paragraphIndex: number
  severity: "critical" | "major" | "minor"
  category:
    | "ortografia"
    | "redaccion"
    | "claridad"
    | "coherencia"
    | "evidencia"
    | "estrategia"
    | "precedentes"
  issue: string
  recommendation: string
  why: string
  targetText: string | null
  proposedText: string | null
  citations: ReviewCitation[]
}

type ReviewData = {
  generatedAt: string
  document: {
    sourceId: string
    sourceTitle: string
    snapshotId: string
    kind: "docx" | "pdf"
    paragraphs: Array<{
      index: number
      text: string
      chunkId: string
      page: number | null
      section: string | null
    }>
  }
  summary: {
    riskLevel: "low" | "medium" | "high"
    overallVerdict: string
    strengths: string[]
    additions: string[]
  }
  suggestions: ReviewSuggestion[]
  strategyInsights: Array<{
    title: string
    insight: string
    recommendation: string
    citations: ReviewCitation[]
  }>
  similarCases: Array<{
    id: string
    caseLabel: string
    similarityReason: string
    argumentsWorked: string[]
    argumentsFailed: string[]
    outcome: string
    criterion: string
    citations: ReviewCitation[]
  }>
  riskAlerts: Array<{
    severity: "critical" | "major" | "minor"
    title: string
    detail: string
    mitigation: string
    citations: ReviewCitation[]
  }>
  stats: {
    paragraphs: number
    suggestions: number
    criticalCount: number
    majorCount: number
    crossEvidence: number
    model: string | null
    usage: any
  }
}

type SuggestionStatus = "pending" | "applied" | "discarded"

type ReviewVersion = {
  id: string
  label: string
  createdAt: string
  paragraphDrafts: Record<number, string>
  suggestionStatus: Record<string, SuggestionStatus>
}

type ReviewActionRecord = {
  suggestionId: string
  previousStatus: SuggestionStatus
  nextStatus: SuggestionStatus
  paragraphIndex: number
  previousText: string
  nextText: string
  at: string
}

type ReviewViewMode = "document" | "annotations" | "versions"

function sourceLabel(source: SourceRow) {
  return source.title || source.filename || "Documento"
}

function statusLabel(status: SourceRow["status"]) {
  if (status === "ready") return "Listo"
  if (status === "processing") return "Procesando"
  if (status === "pending") return "Pendiente"
  return "Error"
}

function severityLabel(severity: ReviewSuggestion["severity"]) {
  if (severity === "critical") return "Critico"
  if (severity === "major") return "Mayor"
  return "Menor"
}

function severityClass(severity: ReviewSuggestion["severity"]) {
  if (severity === "critical") return "border-red-500/40 bg-red-500/10 text-red-100"
  if (severity === "major") return "border-amber-500/40 bg-amber-500/10 text-amber-100"
  return "border-slate-500/40 bg-slate-500/10 text-slate-100"
}

function riskLabel(level: "low" | "medium" | "high") {
  if (level === "high") return "Alto"
  if (level === "medium") return "Medio"
  return "Bajo"
}

function riskClass(level: "low" | "medium" | "high") {
  if (level === "high") return "border-red-500/40 text-red-100"
  if (level === "medium") return "border-amber-500/40 text-amber-100"
  return "border-emerald-500/40 text-emerald-100"
}

function categoryLabel(category: ReviewSuggestion["category"]) {
  if (category === "ortografia") return "Ortografia"
  if (category === "redaccion") return "Redaccion"
  if (category === "claridad") return "Claridad"
  if (category === "coherencia") return "Coherencia"
  if (category === "evidencia") return "Evidencia"
  if (category === "estrategia") return "Estrategia"
  return "Precedentes"
}

function replaceFirstInsensitive(input: string, target: string, replacement: string) {
  const source = String(input || "")
  const needle = String(target || "")
  if (!needle) return source

  const sourceLower = source.toLowerCase()
  const needleLower = needle.toLowerCase()
  const idx = sourceLower.indexOf(needleLower)
  if (idx < 0) return source

  return `${source.slice(0, idx)}${replacement}${source.slice(idx + needle.length)}`
}

function highestSeverity(items: ReviewSuggestion[]) {
  if (items.some((s) => s.severity === "critical")) return "critical"
  if (items.some((s) => s.severity === "major")) return "major"
  if (items.length) return "minor"
  return null
}

function reviewStorageKey(workspaceId: string, sourceId: string) {
  return `ca:review-session:${workspaceId}:${sourceId}`
}

function buildDocumentSheets(
  paragraphs: Array<{ index: number; text: string; chunkId: string; page: number | null; section: string | null }>
) {
  const hasPages = paragraphs.some((paragraph) => typeof paragraph.page === "number")
  if (hasPages) {
    const groups = new Map<string, typeof paragraphs>()
    for (const paragraph of paragraphs) {
      const key = typeof paragraph.page === "number" ? `page_${paragraph.page}` : `section_${paragraph.section || "doc"}`
      const current = groups.get(key) || []
      current.push(paragraph)
      groups.set(key, current)
    }
    return Array.from(groups.entries()).map(([key, items], idx) => ({
      id: key,
      label:
        typeof items[0]?.page === "number"
          ? `Pagina ${items[0].page}`
          : items[0]?.section
            ? `Seccion ${items[0].section}`
            : `Hoja ${idx + 1}`,
      paragraphs: items,
    }))
  }

  const sheets: Array<{ id: string; label: string; paragraphs: typeof paragraphs }> = []
  for (let i = 0; i < paragraphs.length; i += 5) {
    sheets.push({
      id: `sheet_${i}`,
      label: `Hoja ${Math.floor(i / 5) + 1}`,
      paragraphs: paragraphs.slice(i, i + 5),
    })
  }
  return sheets
}

function detectUploadKind(file: File): "pdf" | "docx" | null {
  const mime = String(file.type || "").toLowerCase()
  const name = String(file.name || "").toLowerCase().trim()
  if (mime.includes("pdf") || name.endsWith(".pdf")) return "pdf"
  if (mime.includes("wordprocessingml.document") || name.endsWith(".docx")) return "docx"
  return null
}

function diffParagraphPreview(before: string, after: string, max = 180) {
  const a = String(before || "").replace(/\s+/g, " ").trim()
  const b = String(after || "").replace(/\s+/g, " ").trim()
  if (a === b) return null
  return {
    before: a.length > max ? `${a.slice(0, max)}...` : a,
    after: b.length > max ? `${b.slice(0, max)}...` : b,
  }
}

function shortInline(value: string, max = 220) {
  const text = String(value || "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function normalizeInline(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

function citationTagEntries(tags?: CitationTags) {
  return [
    tags?.tribunal ? { label: "Tribunal", value: tags.tribunal } : null,
    tags?.rol ? { label: "Rol", value: tags.rol } : null,
    tags?.fecha ? { label: "Fecha", value: tags.fecha } : null,
    tags?.materia ? { label: "Materia", value: tags.materia } : null,
    tags?.region ? { label: "Region", value: tags.region } : null,
  ].filter((entry): entry is { label: string; value: string } => Boolean(entry?.value))
}

function citationContextLabel(citation: ReviewCitation) {
  const out: string[] = []
  if (typeof citation.page === "number") out.push(`p.${citation.page}`)
  if (citation.section) out.push(citation.section)
  out.push(citation.origin === "cross_case" ? "Cruce" : "Documento")
  return out.join(" - ")
}

function CitationEvidenceCard({ citation }: { citation: ReviewCitation }) {
  const tags = citationTagEntries(citation.tags)
  return (
    <div className="rounded-md border border-border/45 bg-background/35 px-2 py-1.5 text-[11px]">
      <div>{"\""}{citation.quote}{"\""}</div>

      <div className="mt-1 text-[10px] text-muted-foreground">{citationContextLabel(citation)}</div>

      {tags.length ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span
              key={`${citation.chunkId}_${tag.label}`}
              className="rounded-full border border-border/55 bg-background/45 px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {tag.label}: {tag.value}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-1 flex flex-wrap items-center gap-2">
        {citation.sourceUrl ? (
          <a
            href={citation.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-emerald-300 hover:text-emerald-200"
          >
            Abrir fuente
          </a>
        ) : null}
        {citation.snapshotId ? (
          <a
            href={`/api/snapshots/${citation.snapshotId}/open`}
            target="_blank"
            rel="noreferrer"
            className="text-emerald-300 hover:text-emerald-200"
          >
            Abrir snapshot
          </a>
        ) : null}
      </div>
    </div>
  )
}

function renderHighlightedParagraph(params: {
  text: string
  targets: Array<{ text: string; severity: "critical" | "major" | "minor" }>
}) {
  const text = params.text || ""
  if (!text) return text

  const normalizedBase = normalizeInline(text)
  const picked = params.targets
    .map((target) => {
      const needle = normalizeInline(target.text)
      if (!needle || needle.length < 8) return null
      const idx = normalizedBase.indexOf(needle)
      if (idx < 0) return null
      return { ...target, idx, len: target.text.length }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => a.idx - b.idx)

  if (!picked.length) return text

  const first = picked[0]
  const start = Math.max(0, first.idx)
  const end = Math.min(text.length, start + Math.max(8, first.len))
  if (end <= start) return text

  const className =
    first.severity === "critical"
      ? "rounded-sm bg-red-500/20 px-0.5"
      : first.severity === "major"
        ? "rounded-sm bg-amber-500/20 px-0.5"
        : "rounded-sm bg-emerald-500/15 px-0.5"

  return (
    <>
      <span>{text.slice(0, start)}</span>
      <mark className={className}>{text.slice(start, end)}</mark>
      <span>{text.slice(end)}</span>
    </>
  )
}

export function DocumentReviewPanel({ workspaceId }: { workspaceId: string }) {
  const [sources, setSources] = useState<SourceRow[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState("")
  const [review, setReview] = useState<ReviewData | null>(null)
  const [paragraphDrafts, setParagraphDrafts] = useState<Record<number, string>>({})
  const [suggestionStatus, setSuggestionStatus] = useState<Record<string, SuggestionStatus>>({})
  const [severityFilter, setSeverityFilter] = useState<"all" | "critical" | "major" | "minor">("all")
  const [statusFilter, setStatusFilter] = useState<"all" | SuggestionStatus>("all")
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportMode, setExportMode] = useState<"clean" | "changes">("clean")
  const [viewMode, setViewMode] = useState<ReviewViewMode>("document")
  const [showOriginalPreview, setShowOriginalPreview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(null)
  const [versions, setVersions] = useState<ReviewVersion[]>([])
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [actionHistory, setActionHistory] = useState<ReviewActionRecord[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const paragraphRefs = useRef<Record<number, HTMLDivElement | null>>({})

  async function loadSources() {
    const res = await fetch(`/api/workspaces/${workspaceId}/sources`, {
      method: "GET",
      headers: { accept: "application/json" },
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      throw new Error(json?.error || "No se pudieron cargar documentos")
    }

    const rows = (Array.isArray(json?.sources) ? json.sources : []) as SourceRow[]
    const currentWorkspaceRows = rows
      .filter((row) => String(row.workspace_id || "") === workspaceId)
      .sort((a, b) => {
        const aDate = a.updated_at ? Date.parse(a.updated_at) : 0
        const bDate = b.updated_at ? Date.parse(b.updated_at) : 0
        return bDate - aDate
      })

    setSources(currentWorkspaceRows)
    setSelectedSourceId((prev) => {
      if (prev && currentWorkspaceRows.some((row) => row.id === prev)) return prev
      const firstReady = currentWorkspaceRows.find((row) => row.status === "ready")
      return firstReady?.id || currentWorkspaceRows[0]?.id || ""
    })
  }

  useEffect(() => {
    let active = true
    setIsLoading(true)
    loadSources()
      .catch((err: any) => {
        if (!active) return
        setError(err?.message || "No se pudo cargar el modulo de revision")
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  useEffect(() => {
    const onSourcesChanged = () => {
      loadSources().catch(() => null)
    }
    window.addEventListener("ca:sources-changed", onSourcesChanged as any)
    return () => window.removeEventListener("ca:sources-changed", onSourcesChanged as any)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId) || null,
    [sources, selectedSourceId]
  )

  const isSelectedProcessing =
    selectedSource?.status === "pending" || selectedSource?.status === "processing"

  useEffect(() => {
    if (!selectedSource) return
    if (selectedSource.status === "ready" || selectedSource.status === "error") return

    const id = window.setInterval(() => {
      loadSources().catch(() => null)
    }, 3000)

    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSource?.id, selectedSource?.status])

  const filteredSuggestions = useMemo(() => {
    if (!review) return []
    return review.suggestions.filter((suggestion) => {
      if (severityFilter !== "all" && suggestion.severity !== severityFilter) return false
      const currentStatus = suggestionStatus[suggestion.id] || "pending"
      if (statusFilter !== "all" && currentStatus !== statusFilter) return false
      return true
    })
  }, [review, severityFilter, statusFilter, suggestionStatus])

  const suggestionsByParagraph = useMemo(() => {
    const map = new Map<number, ReviewSuggestion[]>()
    if (!review) return map
    for (const suggestion of review.suggestions) {
      const existing = map.get(suggestion.paragraphIndex) || []
      existing.push(suggestion)
      map.set(suggestion.paragraphIndex, existing)
    }
    return map
  }, [review])

  const activeSuggestion = useMemo(
    () => review?.suggestions.find((item) => item.id === activeSuggestionId) || null,
    [review, activeSuggestionId]
  )

  const activeVersion = useMemo(
    () => versions.find((version) => version.id === selectedVersionId) || null,
    [versions, selectedVersionId]
  )

  const previousVersion = useMemo(() => {
    if (!activeVersion) return null
    const index = versions.findIndex((version) => version.id === activeVersion.id)
    if (index <= 0) return null
    return versions[index - 1]
  }, [versions, activeVersion])

  const activeVersionDiff = useMemo(() => {
    if (!activeVersion || !previousVersion || !review) return []

    const out: Array<{ paragraphIndex: number; before: string; after: string }> = []
    for (const paragraph of review.document.paragraphs) {
      const before = previousVersion.paragraphDrafts[paragraph.index] || paragraph.text
      const after = activeVersion.paragraphDrafts[paragraph.index] || paragraph.text
      const preview = diffParagraphPreview(before, after, 220)
      if (preview) {
        out.push({ paragraphIndex: paragraph.index, before: preview.before, after: preview.after })
      }
    }
    return out
  }, [activeVersion, previousVersion, review])

  const documentSheets = useMemo(
    () => (review ? buildDocumentSheets(review.document.paragraphs) : []),
    [review]
  )

  useEffect(() => {
    if (!selectedSourceId) return
    if (review && String(review.document.sourceId) === selectedSourceId) return

    try {
      const raw = window.localStorage.getItem(reviewStorageKey(workspaceId, selectedSourceId))
      if (!raw) return
      const parsed = JSON.parse(raw) as {
        review?: ReviewData
        paragraphDrafts?: Record<number, string>
        suggestionStatus?: Record<string, SuggestionStatus>
        versions?: ReviewVersion[]
        selectedVersionId?: string | null
        actionHistory?: ReviewActionRecord[]
      }

      if (!parsed?.review || String(parsed.review.document.sourceId || "") !== selectedSourceId) return

      setReview(parsed.review)
      setParagraphDrafts(parsed.paragraphDrafts || {})
      setSuggestionStatus(parsed.suggestionStatus || {})
      setVersions(Array.isArray(parsed.versions) ? parsed.versions : [])
      setSelectedVersionId(parsed.selectedVersionId || null)
      setActionHistory(Array.isArray(parsed.actionHistory) ? parsed.actionHistory : [])
      setInfo("Se recupero la ultima sesion de revision guardada localmente.")
    } catch {
      // ignore local restore failures
    }
  }, [review, selectedSourceId, workspaceId])

  useEffect(() => {
    if (!review?.document.sourceId) return
    try {
      window.localStorage.setItem(
        reviewStorageKey(workspaceId, String(review.document.sourceId)),
        JSON.stringify({
          review,
          paragraphDrafts,
          suggestionStatus,
          versions,
          selectedVersionId,
          actionHistory,
        })
      )
    } catch {
      // ignore local persist failures
    }
  }, [actionHistory, paragraphDrafts, review, selectedVersionId, suggestionStatus, versions, workspaceId])

  function pushVersionSnapshot(label: string, nextDrafts: Record<number, string>, nextStatus: Record<string, SuggestionStatus>) {
    const version: ReviewVersion = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      label,
      createdAt: new Date().toISOString(),
      paragraphDrafts: { ...nextDrafts },
      suggestionStatus: { ...nextStatus },
    }

    setVersions((prev) => {
      const merged = [...prev, version].slice(-30)
      return merged
    })
    setSelectedVersionId(version.id)
  }

  function resetReviewView(nextReview: ReviewData) {
    const initialDrafts: Record<number, string> = {}
    for (const paragraph of nextReview.document.paragraphs) {
      initialDrafts[paragraph.index] = paragraph.text
    }
    setParagraphDrafts(initialDrafts)
    setSuggestionStatus({})
    setActionHistory([])
    setSeverityFilter("all")
    setStatusFilter("all")
    setActiveSuggestionId(null)
    setViewMode("document")
    setShowOriginalPreview(false)

    const firstVersion: ReviewVersion = {
      id: `${Date.now()}_original`,
      label: "Original",
      createdAt: new Date().toISOString(),
      paragraphDrafts: { ...initialDrafts },
      suggestionStatus: {},
    }
    setVersions([firstVersion])
    setSelectedVersionId(firstVersion.id)
  }

  async function uploadDocument(file: File | null) {
    if (!file) return

    setError(null)
    setInfo(null)
    const kind = detectUploadKind(file)
    if (!kind) {
      setError("Solo PDF o DOCX.")
      return
    }
    if (file.size > 50 * 1024 * 1024) {
      setError("Archivo demasiado grande (maximo 50MB)")
      return
    }

    setIsUploading(true)
    try {
      const fd = new FormData()
      fd.set("kind", "upload")
      fd.set("file", file)
      fd.set("docType", "Informe usuario")
      fd.set("sourceOrigin", "review-upload")

      const res = await fetch(`/api/workspaces/${workspaceId}/sources`, {
        method: "POST",
        body: fd,
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(json?.error || "No se pudo subir el documento")
      }

      setSelectedSourceId(String(json?.id || ""))
      setInfo("Documento subido. Iniciando procesamiento... te avisaremos cuando quede Listo.")
      await loadSources()
      try {
        window.dispatchEvent(new CustomEvent("ca:sources-changed"))
      } catch {
        // ignore
      }
    } catch (err: any) {
      setError(err?.message || "Error subiendo documento")
    } finally {
      setIsUploading(false)
    }
  }

  async function runAnalysis() {
    if (!selectedSourceId) {
      setError("Selecciona un documento para revisar")
      return
    }

    if (selectedSource?.status !== "ready") {
      setError("El documento aun no esta listo. Espera a que termine de procesar.")
      return
    }

    setError(null)
    setInfo(null)
    setIsAnalyzing(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/reviews/inline`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: selectedSourceId }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(json?.error || "No se pudo analizar el documento")
      }

      const nextReview = (json?.review as ReviewData) || null
      if (!nextReview) throw new Error("Respuesta de revision invalida")

      setReview(nextReview)
      resetReviewView(nextReview)
    } catch (err: any) {
      setError(err?.message || "Error ejecutando revision")
    } finally {
      setIsAnalyzing(false)
    }
  }

  function setParagraphText(index: number, text: string) {
    setParagraphDrafts((prev) => ({ ...prev, [index]: text }))
  }

  function applySuggestion(suggestion: ReviewSuggestion) {
    if (!review || review.document.kind !== "docx") return
    const currentStatus = suggestionStatus[suggestion.id] || "pending"
    if (currentStatus !== "pending") return

    const paragraphIndex = suggestion.paragraphIndex
    const currentText = paragraphDrafts[paragraphIndex] || ""
    let nextText = currentText

    if (suggestion.targetText && suggestion.proposedText) {
      nextText = replaceFirstInsensitive(currentText, suggestion.targetText, suggestion.proposedText)
    } else if (suggestion.proposedText) {
      nextText = `${currentText} ${suggestion.proposedText}`.trim()
    }

    const nextDrafts = { ...paragraphDrafts, [paragraphIndex]: nextText }
    const nextStatus = { ...suggestionStatus, [suggestion.id]: "applied" as SuggestionStatus }

    setParagraphDrafts(nextDrafts)
    setSuggestionStatus(nextStatus)
    setActionHistory((prev) => [
      ...prev,
      {
        suggestionId: suggestion.id,
        previousStatus: currentStatus,
        nextStatus: "applied",
        paragraphIndex,
        previousText: currentText,
        nextText,
        at: new Date().toISOString(),
      },
    ])
    pushVersionSnapshot(`Aplicada: ${categoryLabel(suggestion.category)}`, nextDrafts, nextStatus)
  }

  function discardSuggestion(suggestionId: string) {
    const currentStatus = suggestionStatus[suggestionId] || "pending"
    if (currentStatus !== "pending") return
    const suggestion = review?.suggestions.find((item) => item.id === suggestionId)
    const paragraphIndex = suggestion?.paragraphIndex ?? 0
    const paragraphText = paragraphDrafts[paragraphIndex] || review?.document.paragraphs.find((p) => p.index === paragraphIndex)?.text || ""

    const nextStatus = { ...suggestionStatus, [suggestionId]: "discarded" as SuggestionStatus }
    setSuggestionStatus(nextStatus)
    setActionHistory((prev) => [
      ...prev,
      {
        suggestionId,
        previousStatus: currentStatus,
        nextStatus: "discarded",
        paragraphIndex,
        previousText: paragraphText,
        nextText: paragraphText,
        at: new Date().toISOString(),
      },
    ])
    pushVersionSnapshot("Sugerencia descartada", paragraphDrafts, nextStatus)
  }

  function undoSuggestion(suggestionId: string) {
    const last = [...actionHistory].reverse().find((item) => item.suggestionId === suggestionId)
    if (!last) return

    const nextDrafts = {
      ...paragraphDrafts,
      [last.paragraphIndex]: last.previousText,
    }
    const nextStatus = {
      ...suggestionStatus,
      [suggestionId]: last.previousStatus,
    }

    setParagraphDrafts(nextDrafts)
    setSuggestionStatus(nextStatus)
    setActionHistory((prev) => prev.filter((item) => item !== last))
    pushVersionSnapshot("Deshacer accion", nextDrafts, nextStatus)
  }

  function undoLastAction() {
    const last = actionHistory[actionHistory.length - 1]
    if (!last) return

    const nextDrafts = {
      ...paragraphDrafts,
      [last.paragraphIndex]: last.previousText,
    }
    const nextStatus = {
      ...suggestionStatus,
      [last.suggestionId]: last.previousStatus,
    }

    setParagraphDrafts(nextDrafts)
    setSuggestionStatus(nextStatus)
    setActionHistory((prev) => prev.slice(0, -1))
    pushVersionSnapshot("Deshacer ultima accion", nextDrafts, nextStatus)
  }

  function applyOrthographyBatch() {
    if (!review || review.document.kind !== "docx") return
    review.suggestions
      .filter((suggestion) => suggestion.category === "ortografia")
      .forEach((suggestion) => applySuggestion(suggestion))
  }

  function askAboutParagraph(paragraphIndex: number) {
    const paragraph = review?.document.paragraphs.find((item) => item.index === paragraphIndex)
    if (!paragraph) return

    const text = (paragraphDrafts[paragraphIndex] || paragraph.text || "").trim()
    if (!text) return

    try {
      window.dispatchEvent(new CustomEvent("ca:open-assistant"))
      window.dispatchEvent(
        new CustomEvent("ca:chat-ask", {
          detail: {
            origin: "document-review",
            paragraphIndex,
            sourceTitle: selectedSource ? sourceLabel(selectedSource) : review?.document.sourceTitle,
            question:
              "Analiza este parrafo del informe y sugiere mejoras de redaccion y estrategia (indicando que parte requiere evidencia adicional):\n\n" +
              text,
            sourceId: selectedSourceId || undefined,
          },
        })
      )
      setInfo(`Se envio el parrafo ${paragraphIndex + 1} al Asistente experto.`)
    } catch {
      setError("No se pudo abrir el Asistente experto.")
    }
  }

  async function exportRevisedDocx() {
    if (!review || review.document.kind !== "docx") return

    setIsExporting(true)
    try {
      const sortedParagraphs = [...review.document.paragraphs].sort((a, b) => a.index - b.index)
      const orderedParagraphs = sortedParagraphs.map((paragraph) => paragraphDrafts[paragraph.index] || paragraph.text).filter(Boolean)

      const originalParagraphs = sortedParagraphs.map((paragraph) => paragraph.text).filter(Boolean)

      const res = await fetch(`/api/workspaces/${workspaceId}/reviews/inline/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: `${review.document.sourceTitle} - revisado`,
          mode: exportMode,
          originalParagraphs,
          paragraphs: orderedParagraphs,
        }),
      })

      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error || "No se pudo exportar DOCX")
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = exportMode === "changes" ? "informe-revisado-con-cambios.docx" : "informe-revisado.docx"
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      setError(err?.message || "Error exportando DOCX")
    } finally {
      setIsExporting(false)
    }
  }

  function jumpToParagraph(paragraphIndex: number, suggestionId: string) {
    setActiveSuggestionId(suggestionId)
    const el = paragraphRefs.current[paragraphIndex]
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }

  return (
    <Card className="flex h-[calc(100svh-104px)] min-h-0 flex-col overflow-hidden rounded-2xl border-border/60 bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/45">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div>
          <div className="text-sm font-semibold">Revision inteligente de informe</div>
          <div className="text-[11px] text-muted-foreground">
            Sube tu informe (DOCX/PDF), analiza y aplica mejoras sugeridas sobre el documento.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={() => {
              try {
                window.dispatchEvent(new CustomEvent("ca:open-professional-review"))
              } catch {
                // ignore
              }
            }}
          >
            <Sparkles className="h-4 w-4" />
            Dictamen profesional
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
            className="hidden"
            disabled={isUploading || isAnalyzing}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0] || null
              uploadDocument(file).catch(() => null)
              event.currentTarget.value = ""
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={isUploading || isAnalyzing}
            onClick={() => fileInputRef.current?.click()}
          >
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {isUploading ? "Subiendo..." : "Subir informe"}
          </Button>
          <Button
            size="sm"
            className="gap-2"
            disabled={isAnalyzing || !selectedSourceId || selectedSource?.status !== "ready"}
            onClick={() => runAnalysis().catch(() => null)}
          >
            {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            Analizar
          </Button>
        </div>
      </div>

      <div className="border-b border-border/60 px-4 py-3">
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
          <select
            className="h-10 rounded-md border border-input bg-background/35 px-3 text-sm"
            value={selectedSourceId}
            onChange={(event) => setSelectedSourceId(event.target.value)}
          >
            <option value="">Selecciona documento...</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {sourceLabel(source)} - {statusLabel(source.status)}
              </option>
            ))}
          </select>

          <div className="text-xs text-muted-foreground">
            {selectedSource?.updated_at
              ? `Ultima actualizacion: ${new Date(selectedSource.updated_at).toLocaleString("es-CL")}`
              : ""}
          </div>

          {review?.document.kind === "docx" ? (
            <div className="flex items-center gap-2">
              <select
                className="h-9 rounded-md border border-input bg-background/35 px-2 text-xs"
                value={exportMode}
                onChange={(event) => setExportMode(event.target.value as "clean" | "changes")}
              >
                <option value="clean">DOCX limpio</option>
                <option value="changes">DOCX con cambios</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={isExporting || !review}
                onClick={() => exportRevisedDocx().catch(() => null)}
              >
                {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Exportar
              </Button>
            </div>
          ) : null}
        </div>

        {isSelectedProcessing ? (
          <div className="mt-2 rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>
                Procesando {"\""}{selectedSource ? sourceLabel(selectedSource) : "documento"}{"\""}. Estamos extrayendo texto y preparando el analisis.
              </span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-amber-500/15">
              <div className="h-full w-2/5 rounded-full bg-amber-300/70 animate-pulse" />
            </div>
          </div>
        ) : null}

        {selectedSource?.status !== "ready" && selectedSource && !isSelectedProcessing ? (
          <div className="mt-2 rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            El documento esta en estado {statusLabel(selectedSource.status)}. Cuando quede en Listo podras analizarlo.
          </div>
        ) : null}

        {error ? (
          <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {info ? (
          <div className="mt-2 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
            {info}
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <div className="px-4 py-4 text-sm text-muted-foreground">Cargando modulo...</div>
      ) : !review ? (
        <div className="px-4 py-6">
          <div className="rounded-xl border border-dashed border-border/60 bg-background/20 p-6 text-center">
            <FileText className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
            <div className="text-sm font-medium">Aun no hay analisis de informe</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Sube un documento y ejecuta Analizar para ver sugerencias inteligentes en el texto.
            </div>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 px-4 py-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={riskClass(review.summary.riskLevel)}>
              Riesgo {riskLabel(review.summary.riskLevel)}
            </Badge>
            <Badge variant="outline">{review.suggestions.length} sugerencias</Badge>
            <Badge variant="outline">{review.stats.crossEvidence} evidencias cruzadas</Badge>
            {review.document.kind === "pdf" ? (
              <Badge variant="outline" className="border-amber-500/40 text-amber-100">
                PDF: modo anotaciones
              </Badge>
            ) : (
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-100">
                DOCX: sugerencias aplicables
              </Badge>
            )}
            <Button
              asChild
              variant="outline"
              size="sm"
              className="gap-2"
            >
              <a href={`/api/snapshots/${review.document.snapshotId}/open`} target="_blank" rel="noreferrer">
                <ArrowUpRight className="h-4 w-4" />
                Abrir documento original
              </a>
            </Button>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            {([
              { key: "document", label: "Documento", icon: BookOpenText },
              { key: "annotations", label: "Anotaciones", icon: Layers3 },
              { key: "versions", label: "Versiones", icon: RotateCcw },
            ] as Array<{ key: ReviewViewMode; label: string; icon: any }>).map((item) => {
              const Icon = item.icon
              const active = viewMode === item.key
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setViewMode(item.key)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors",
                    active
                      ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-100"
                      : "border-border/60 bg-background/25 text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              )
            })}
            {review.document.kind === "pdf" ? (
              <button
                type="button"
                onClick={() => setShowOriginalPreview((prev) => !prev)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors",
                  showOriginalPreview
                    ? "border-sky-400/60 bg-sky-500/15 text-sky-100"
                    : "border-border/60 bg-background/25 text-muted-foreground hover:text-foreground"
                )}
              >
                <FileText className="h-3.5 w-3.5" />
                {showOriginalPreview ? "Ocultar PDF original" : "Ver PDF original"}
              </button>
            ) : null}
          </div>

          <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_380px]">
            <Card className="min-h-0 overflow-hidden border-border/55 bg-background/20">
              <ScrollArea className="h-[calc(100svh-310px)] px-4 py-3">
                <div className="space-y-4">
                  <div className="rounded-xl border border-border/55 bg-background/25 p-3">
                    <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
                      <Sparkles className="h-4 w-4 text-emerald-300" />
                      Dictamen general
                    </div>
                    <p className="text-sm leading-7 text-foreground/95">{review.summary.overallVerdict || "Sin dictamen"}</p>
                  </div>

                  {viewMode === "document" ? (
                    <div className="space-y-5">
                      {review.document.kind === "pdf" && showOriginalPreview ? (
                        <div className="overflow-hidden rounded-2xl border border-border/55 bg-background/25">
                          <div className="border-b border-border/55 px-3 py-2 text-xs text-muted-foreground">
                            Documento original en paralelo
                          </div>
                          <iframe
                            src={`/api/snapshots/${review.document.snapshotId}/open`}
                            className="h-[70svh] w-full bg-white"
                            title="Documento PDF original"
                          />
                        </div>
                      ) : null}

                      {documentSheets.map((sheet) => (
                        <div
                          key={sheet.id}
                          className="rounded-[28px] border border-stone-300/40 bg-[linear-gradient(180deg,rgba(247,241,227,0.98),rgba(243,236,219,0.96))] p-5 text-slate-900 shadow-[0_18px_50px_rgba(15,23,42,0.12)]"
                        >
                          <div className="mb-4 flex items-center justify-between gap-2 border-b border-stone-400/25 pb-3 text-xs uppercase tracking-[0.18em] text-slate-500">
                            <span>{sheet.label}</span>
                            <span>
                              {sheet.paragraphs.reduce(
                                (count, paragraph) => count + (suggestionsByParagraph.get(paragraph.index)?.length || 0),
                                0
                              )} anotacion(es)
                            </span>
                          </div>

                          <div className="space-y-5">
                            {sheet.paragraphs.map((paragraph) => {
                              const paragraphSuggestions = suggestionsByParagraph.get(paragraph.index) || []
                              const pendingSuggestions = paragraphSuggestions.filter(
                                (item) => (suggestionStatus[item.id] || "pending") === "pending"
                              )
                              const severity = highestSeverity(pendingSuggestions)
                              const paragraphText = paragraphDrafts[paragraph.index] || paragraph.text
                              const active = paragraphSuggestions.some((item) => item.id === activeSuggestionId)

                              return (
                                <div
                                  key={`p_${paragraph.index}`}
                                  ref={(el) => {
                                    paragraphRefs.current[paragraph.index] = el
                                  }}
                                  className={cn(
                                    "grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px] xl:items-start",
                                    active && "rounded-2xl bg-emerald-500/8 p-3"
                                  )}
                                >
                                  <div>
                                    <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                                      <span className="font-medium">Tramo {paragraph.index + 1}</span>
                                      <div className="flex items-center gap-2">
                                        <span>
                                          {typeof paragraph.page === "number" ? `p.${paragraph.page}` : ""}
                                          {paragraph.section ? ` ${paragraph.section}` : ""}
                                        </span>
                                        <button
                                          type="button"
                                          className="inline-flex items-center gap-1 rounded-full border border-slate-300/60 bg-white/60 px-2 py-0.5 text-[10px] text-slate-600 hover:text-slate-900"
                                          onClick={() => askAboutParagraph(paragraph.index)}
                                        >
                                          <MessageSquare className="h-3 w-3" />
                                          Preguntar
                                        </button>
                                      </div>
                                    </div>

                                    <div className="rounded-2xl border border-transparent px-1 py-1">
                                      <p className="whitespace-pre-wrap font-serif text-[17px] leading-8 text-slate-800">
                                        {renderHighlightedParagraph({
                                          text: paragraphText,
                                          targets: pendingSuggestions
                                            .map((item) => ({
                                              text: item.targetText || "",
                                              severity: item.severity,
                                            }))
                                            .filter((item) => item.text.length >= 8),
                                        })}
                                      </p>
                                    </div>
                                  </div>

                                  <aside className="space-y-2">
                                    {paragraphSuggestions.length ? (
                                      paragraphSuggestions.slice(0, 2).map((suggestion, noteIndex) => {
                                        const currentStatus = suggestionStatus[suggestion.id] || "pending"
                                        return (
                                          <button
                                            key={suggestion.id}
                                            type="button"
                                            onClick={() => jumpToParagraph(suggestion.paragraphIndex, suggestion.id)}
                                            className={cn(
                                              "w-full rounded-2xl border px-3 py-2 text-left text-xs shadow-sm",
                                              severityClass(suggestion.severity),
                                              currentStatus !== "pending" && "opacity-70"
                                            )}
                                          >
                                            <div className="flex items-center justify-between gap-2">
                                              <span className="font-medium">Nota {noteIndex + 1}</span>
                                              <span className="text-[10px] uppercase tracking-wide">{currentStatus}</span>
                                            </div>
                                            <div className="mt-1 line-clamp-3">{suggestion.issue}</div>
                                            <div className="mt-1 text-[10px] uppercase tracking-wide opacity-85">
                                              {severityLabel(suggestion.severity)} · {categoryLabel(suggestion.category)}
                                            </div>
                                          </button>
                                        )
                                      })
                                    ) : (
                                      <div className="rounded-2xl border border-dashed border-stone-300/70 bg-white/45 px-3 py-3 text-[11px] text-slate-500">
                                        Sin anotaciones en este tramo.
                                      </div>
                                    )}
                                  </aside>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : viewMode === "annotations" ? (
                    <div className="space-y-3">
                      {filteredSuggestions.length ? (
                        filteredSuggestions.map((suggestion) => {
                          const currentStatus = suggestionStatus[suggestion.id] || "pending"
                          const paragraph = review.document.paragraphs.find((item) => item.index === suggestion.paragraphIndex)
                          const paragraphText = paragraph ? paragraphDrafts[paragraph.index] || paragraph.text : ""
                          const preview = suggestion.proposedText && suggestion.targetText
                            ? diffParagraphPreview(suggestion.targetText, suggestion.proposedText, 220)
                            : null

                          return (
                            <div key={suggestion.id} className={cn("rounded-xl border p-3", severityClass(suggestion.severity))}>
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <div className="text-sm font-semibold">
                                    Tramo {suggestion.paragraphIndex + 1} · {categoryLabel(suggestion.category)}
                                  </div>
                                  <div className="text-xs opacity-85">{suggestion.issue}</div>
                                </div>
                                <div className="text-[10px] uppercase tracking-wide">{currentStatus}</div>
                              </div>

                              {paragraphText ? (
                                <div className="mt-2 rounded-xl border border-current/20 bg-white/10 px-3 py-2 text-sm leading-6 text-foreground/95">
                                  {shortInline(paragraphText, 420)}
                                </div>
                              ) : null}

                              <div className="mt-2 text-sm text-foreground/95">
                                <span className="font-medium">Recomendacion:</span> {suggestion.recommendation}
                              </div>

                              {preview ? (
                                <div className="mt-2 rounded-xl border border-current/20 bg-white/10 px-3 py-2 text-xs">
                                  <div className="text-red-100">- {preview.before}</div>
                                  <div className="mt-1 text-emerald-100">+ {preview.after}</div>
                                </div>
                              ) : null}

                              <div className="mt-2 flex flex-wrap gap-2">
                                <Button variant="outline" size="sm" onClick={() => jumpToParagraph(suggestion.paragraphIndex, suggestion.id)}>
                                  Ir al documento
                                </Button>
                                {review.document.kind === "docx" && currentStatus === "pending" ? (
                                  <Button size="sm" onClick={() => applySuggestion(suggestion)}>
                                    Aplicar sugerencia
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          )
                        })
                      ) : (
                        <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-sm text-muted-foreground">
                          No hay anotaciones con los filtros actuales.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-border/55 bg-background/25 p-3 text-sm text-muted-foreground">
                        Selecciona una version a la derecha para revisar el diff y la evolucion del documento.
                      </div>
                      {activeVersionDiff.length ? (
                        activeVersionDiff.map((change) => (
                          <div key={`version_diff_${change.paragraphIndex}`} className="rounded-xl border border-border/55 bg-background/25 p-3">
                            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Tramo {change.paragraphIndex + 1}
                            </div>
                            <div className="mt-2 text-sm text-red-200">- {change.before}</div>
                            <div className="mt-2 text-sm text-emerald-200">+ {change.after}</div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-sm text-muted-foreground">
                          Aun no hay cambios comparables en la version seleccionada.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </Card>

            <Card className="min-h-0 overflow-hidden border-border/55 bg-background/20">
              <div className="border-b border-border/55 px-3 py-2">
                <div className="text-sm font-semibold">Sugerencias inteligentes</div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {(["all", "critical", "major", "minor"] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setSeverityFilter(level)}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-[11px]",
                        severityFilter === level
                          ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-100"
                          : "border-border/60 bg-background/30 text-muted-foreground"
                      )}
                    >
                      {level === "all" ? "Todas" : severityLabel(level)}
                    </button>
                  ))}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {(["all", "pending", "applied", "discarded"] as const).map((state) => (
                    <button
                      key={state}
                      type="button"
                      onClick={() => setStatusFilter(state)}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-[11px]",
                        statusFilter === state
                          ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-100"
                          : "border-border/60 bg-background/30 text-muted-foreground"
                      )}
                    >
                      {state === "all"
                        ? "Estado: todos"
                        : state === "pending"
                          ? "Pendientes"
                          : state === "applied"
                            ? "Aplicadas"
                            : "Descartadas"}
                    </button>
                  ))}
                </div>

                {review.document.kind === "docx" ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" className="gap-2" onClick={applyOrthographyBatch}>
                      <Check className="h-4 w-4" />
                      Aplicar ortografia
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={actionHistory.length === 0}
                      onClick={undoLastAction}
                    >
                      <RotateCcw className="h-4 w-4" />
                      Deshacer ultima
                    </Button>
                  </div>
                ) : (
                  <div className="mt-2 rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100">
                    En PDF las sugerencias son anotaciones (sin aplicacion automatica).
                  </div>
                )}
              </div>

              <ScrollArea className="h-[calc(100svh-335px)] px-3 py-3">
                <div className="space-y-2.5">
                  {activeSuggestion ? (
                    <div className="rounded-lg border border-border/55 bg-background/30 p-2.5">
                      <div className="mb-1 text-xs font-semibold">Panel de evidencia (sugerencia activa)</div>
                      <div className="text-xs leading-5 text-muted-foreground">{activeSuggestion.issue}</div>
                      <div className="mt-2 space-y-1.5">
                        {activeSuggestion.citations.slice(0, 3).map((citation, idx) => (
                          <CitationEvidenceCard key={`ev_${idx}`} citation={citation} />
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {filteredSuggestions.length ? (
                    filteredSuggestions.map((suggestion) => {
                      const currentStatus = suggestionStatus[suggestion.id] || "pending"
                      return (
                        <div
                          key={suggestion.id}
                          className={cn("rounded-lg border p-2.5", severityClass(suggestion.severity))}
                        >
                          <div className="mb-1 flex items-start justify-between gap-2">
                            <div className="text-xs font-medium">
                              {categoryLabel(suggestion.category)} - {severityLabel(suggestion.severity)}
                            </div>
                            <div className="text-[10px] uppercase tracking-wide">{currentStatus}</div>
                          </div>

                          <div className="text-xs leading-5">{suggestion.issue}</div>
                          <div className="mt-1 text-xs leading-5 text-foreground/90">
                            <span className="font-medium">Sugerencia:</span> {suggestion.recommendation}
                          </div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">{suggestion.why}</div>

                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              className="rounded-md border border-border/55 bg-background/40 px-2 py-1 text-[11px]"
                              onClick={() => jumpToParagraph(suggestion.paragraphIndex, suggestion.id)}
                            >
                              Ir a parrafo {suggestion.paragraphIndex + 1}
                            </button>
                            {review.document.kind === "docx" && currentStatus === "pending" ? (
                              <button
                                type="button"
                                className="rounded-md border border-emerald-500/35 bg-emerald-500/15 px-2 py-1 text-[11px] text-emerald-100"
                                onClick={() => applySuggestion(suggestion)}
                              >
                                Aplicar
                              </button>
                            ) : null}
                            {currentStatus === "pending" ? (
                              <button
                                type="button"
                                className="rounded-md border border-border/55 bg-background/40 px-2 py-1 text-[11px]"
                                onClick={() => discardSuggestion(suggestion.id)}
                              >
                                Descartar
                              </button>
                            ) : null}
                            {currentStatus !== "pending" ? (
                              <button
                                type="button"
                                className="rounded-md border border-border/55 bg-background/40 px-2 py-1 text-[11px]"
                                onClick={() => undoSuggestion(suggestion.id)}
                              >
                                Deshacer
                              </button>
                            ) : null}
                          </div>

                          {suggestion.citations.length ? (
                            <div className="mt-2 space-y-1">
                              {suggestion.citations.slice(0, 2).map((citation, idx) => (
                                <CitationEvidenceCard key={`${suggestion.id}_${idx}`} citation={citation} />
                              ))}
                            </div>
                          ) : null}
                        </div>
                      )
                    })
                  ) : (
                    <div className="text-xs text-muted-foreground">No hay sugerencias con estos filtros.</div>
                  )}

                  {review.strategyInsights.length ? (
                    <div className="mt-4 rounded-lg border border-border/55 bg-background/30 p-2.5">
                      <div className="mb-2 text-xs font-semibold">Estrategias de defensa (cruce historico)</div>
                      <div className="space-y-2">
                        {review.strategyInsights.map((insight, idx) => (
                          <div key={`st_${idx}`} className="rounded-md border border-border/45 bg-background/35 px-2 py-2 text-xs leading-5">
                            <div className="font-medium">{insight.title}</div>
                            <div className="mt-1">{insight.insight}</div>
                            <div className="mt-1 text-foreground/90">{insight.recommendation}</div>
                            {insight.citations.length ? (
                              <div className="mt-1.5 space-y-1">
                                {insight.citations.slice(0, 2).map((citation, citationIdx) => (
                                  <CitationEvidenceCard key={`st_${idx}_c_${citationIdx}`} citation={citation} />
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {review.similarCases?.length ? (
                    <div className="rounded-lg border border-border/55 bg-background/30 p-2.5">
                      <div className="mb-2 text-xs font-semibold">Casos similares (que funciono / que fallo)</div>
                      <div className="space-y-2">
                        {review.similarCases.slice(0, 4).map((item) => (
                          <div key={item.id} className="rounded-md border border-border/45 bg-background/35 px-2 py-2 text-xs leading-5">
                            <div className="font-medium">{item.caseLabel}</div>
                            <div className="text-muted-foreground">{item.similarityReason}</div>
                            <div className="mt-1 text-foreground/90">Criterio: {item.criterion}</div>
                            <div className="mt-1 text-foreground/90">Resultado: {item.outcome}</div>
                            {item.argumentsWorked.length ? (
                              <div className="mt-1">Funciona: {item.argumentsWorked.slice(0, 2).join(" | ")}</div>
                            ) : null}
                            {item.argumentsFailed.length ? (
                              <div className="mt-1">No funciona: {item.argumentsFailed.slice(0, 2).join(" | ")}</div>
                            ) : null}
                            {item.citations.length ? (
                              <div className="mt-1.5 space-y-1">
                                {item.citations.slice(0, 2).map((citation, citationIdx) => (
                                  <CitationEvidenceCard key={`${item.id}_c_${citationIdx}`} citation={citation} />
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {review.riskAlerts?.length ? (
                    <div className="rounded-lg border border-border/55 bg-background/30 p-2.5">
                      <div className="mb-2 text-xs font-semibold">Alertas de riesgo procesal</div>
                      <div className="space-y-2">
                        {review.riskAlerts.map((alert, idx) => (
                          <div key={`risk_${idx}`} className={cn("rounded-md border px-2 py-2 text-xs leading-5", severityClass(alert.severity))}>
                            <div className="font-medium">{alert.title}</div>
                            <div className="mt-1">{alert.detail}</div>
                            <div className="mt-1 text-foreground/90">Mitigacion: {alert.mitigation}</div>
                            {alert.citations.length ? (
                              <div className="mt-1.5 space-y-1">
                                {alert.citations.slice(0, 2).map((citation, citationIdx) => (
                                  <CitationEvidenceCard key={`risk_${idx}_c_${citationIdx}`} citation={citation} />
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {review.summary.additions.length ? (
                    <div className="rounded-lg border border-border/55 bg-background/30 p-2.5">
                      <div className="mb-2 text-xs font-semibold">Informacion que conviene agregar</div>
                      <div className="space-y-1 text-xs">
                        {review.summary.additions.map((item, idx) => (
                          <div key={`ad_${idx}`}>- {item}</div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {versions.length ? (
                    <div className="rounded-lg border border-border/55 bg-background/30 p-2.5">
                      <div className="mb-2 text-xs font-semibold">Historial de versiones</div>
                      <div className="space-y-1.5">
                        {versions
                          .slice()
                          .reverse()
                          .slice(0, 8)
                          .map((version) => {
                            const isActive = selectedVersionId === version.id
                            return (
                              <button
                                key={version.id}
                                type="button"
                                onClick={() => setSelectedVersionId(version.id)}
                                className={cn(
                                  "w-full rounded-md border px-2 py-1.5 text-left text-[11px]",
                                  isActive
                                    ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-100"
                                    : "border-border/45 bg-background/35 text-muted-foreground"
                                )}
                              >
                                <div className="font-medium">{version.label}</div>
                                <div>{new Date(version.createdAt).toLocaleTimeString("es-CL")}</div>
                              </button>
                            )
                          })}
                      </div>

                      {activeVersionDiff.length ? (
                        <div className="mt-2 rounded-md border border-border/45 bg-background/35 px-2 py-2 text-[11px]">
                          <div className="mb-1 font-medium">Diff vs version anterior</div>
                          {activeVersionDiff.slice(0, 6).map((change) => (
                            <div key={`diff_${change.paragraphIndex}`} className="mb-1">
                              <div className="text-muted-foreground">Parrafo {change.paragraphIndex + 1}</div>
                              <div className="text-red-200">- {change.before}</div>
                              <div className="text-emerald-200">+ {change.after}</div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </ScrollArea>
            </Card>
          </div>

          <div className="mt-2 rounded-md border border-border/55 bg-background/25 px-3 py-2 text-[11px] text-muted-foreground">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
              <span>
                Las sugerencias son apoyo profesional. La decision final y firma del documento siempre debe pasar por revision humana.
              </span>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}
