"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { ArrowLeft, FileText, Loader2, UploadCloud, Sparkles, ExternalLink } from "lucide-react"

type OnboardingFilters = {
  projectType: string | null
  region: string | null
  yearFrom: number | null
  yearTo: number | null
  themes: string[]
}

type SummaryCitation = {
  chunkId: string
  quote: string
  sourceUrl: string | null
  snapshotId: string | null
  page: number | null
  section: string | null
}

type Recommendation = {
  causeId: string
  tribunal: string | null
  rol: string | null
  fechaIngreso: string | null
  caratula: string | null
  estado: string | null
  estadoSubtipo: string | null
  linkCausa: string | null
  score: number
  scoreBreakdown?: {
    textualSimilarity: number
    documentQuality: number
    proceduralStage: number
    filterBoost: number
    lexicalCausaOverlap: number
    total: number
  }
  scoreDrivers?: {
    up: string[]
    down: string[]
  }
  reasons: string[]
  confidence?: "alta" | "media" | "baja" | string
  defenseSummary?: string | null
  strategicActions?: string[]
  interestingDocuments?: Array<{
    id: string
    name: string | null
    documentType: string | null
    date: string | null
    url: string | null
    contribution: string | null
  }>
  matchedDocuments: Array<{
    id: string
    documentType: string | null
    date: string | null
    name: string | null
    storagePath: string | null
    url: string | null
  }>
  keyQuotes: Array<{
    findingId?: string
    chunkId: string
    quote: string
    claimQuote?: string | null
    lexicalOverlapWithClaim?: number
    commonTerms?: string[]
    similarityType?: "hecho" | "norma" | "criterio_judicial" | "estrategia_procesal" | string
    similarityTypeLabel?: string
    sourceUrl: string | null
    documentId?: string | null
    documentName?: string | null
    documentUrl?: string | null
    analysisComment?: string | null
    page: number | null
    section: string | null
    score: number
  }>
  utilityLabel?: "core" | "support" | "discard" | string
  utilityRisk?: "low" | "medium" | "high" | string
  utilityReason?: string | null
  evidenceBacked?: boolean
  evidenceLevel?: "high" | "medium" | "low" | string | null
  anchorHits?: number
  anchorCoverage?: number
  matchedAnchors?: string[]
  missingAnchors?: string[]
  criticalAnchorHits?: number
  matchedCriticalAnchors?: string[]
  missingCriticalAnchors?: string[]
  anchorGate?: {
    enabled: boolean
    criticalEnabled: boolean
    passedCore: boolean
    passedSupport: boolean
    passedCoreByCritical: boolean
    passedSupportByCritical: boolean
    minCoreHits: number
    minSupportHits: number
    minCoreCriticalHits: number
    minSupportCriticalHits: number
  } | null
}

type AutoReportResponse = {
  status: string
  noteId: string | null
  generatedAt: string | null
  report: {
    title: string
    content: string
    structured?: DefenseReportStructured | null
  }
  versions?: {
    currentVersionId: string | null
    previousVersionId: string | null
    comparison?: {
      similarity: number
      addedCount: number
      removedCount: number
      addedPreview: string[]
      removedPreview: string[]
    } | null
  }
}

type DefenseReportCauseAnalysis = {
  index: number
  rol: string
  whySelected: string
  defenseContribution: string
  keyDocumentUsage: string[]
  criticalSimilarity: string[]
  whereToCite?: string[]
  risks: string
  priority: string
}

type DefenseReportStructured = {
  executiveSummary: string
  defenseHypothesis: string
  comparableFacts?: string[]
  usefulCriteria?: string[]
  misuseRisks?: string[]
  draftParagraphs?: string[]
  causeAnalyses: DefenseReportCauseAnalysis[]
  immediateActions: string[]
}

type RecommendationResponse = {
  analysisRun?: {
    runId: string
    generatedAt: string
    confidenceRules?: {
      alta: string
      media: string
      baja: string
    }
  }
  claim: {
    snapshotId: string
    sourceId: string | null
    title: string | null
    hash: string | null
  }
  summary: {
    text: string
    citations: SummaryCitation[]
  }
  recommendationPolicy?: {
    softFilter?: {
      enabled: boolean
      hideDiscardDefault: boolean
    }
    rerank?: {
      applied: boolean
      model: string | null
      topK: number
    }
    evidence?: {
      backedCount: number
      preliminaryCount: number
    }
    anchors?: {
      enabled: boolean
      criticalEnabled: boolean
      terms: string[]
      criticalTerms: string[]
      minCoreHits: number
      minSupportHits: number
      minCoreCriticalHits: number
      minSupportCriticalHits: number
      matchedCauses: number
      criticalMatchedCauses: number
      supportPassedCauses: number
      downgradedCore: number
      downgradedToDiscard: number
      downgradedByCritical: number
    }
  }
  recommendations: Recommendation[]
  matrix?: Array<{
    causeId: string
    rol: string | null
    confidence: string | null
    riskLevel: string
    score: number
    utilityLabel?: string | null
    utilityRisk?: string | null
    utilityReason?: string | null
    evidenceBacked?: boolean
    evidenceLevel?: string | null
    anchorHits?: number
    anchorCoverage?: number
    matchedAnchors?: string[]
    missingAnchors?: string[]
    criticalAnchorHits?: number
    matchedCriticalAnchors?: string[]
    missingCriticalAnchors?: string[]
    anchorGate?: {
      enabled: boolean
      criticalEnabled: boolean
      passedCore: boolean
      passedSupport: boolean
      passedCoreByCritical: boolean
      passedSupportByCritical: boolean
      minCoreHits: number
      minSupportHits: number
      minCoreCriticalHits: number
      minSupportCriticalHits: number
    } | null
    document: {
      id: string
      name: string
      url: string | null
      contribution: string | null
    } | null
    whereToCite: {
      findingId?: string
      quote: string
      claimQuote: string | null
      similarityType: string
      similarityTypeLabel: string
      commonTerms: string[]
      documentUrl: string | null
    } | null
  }>
  hitl?: {
    runId: string
    causeReviews: Array<{ causeId: string; status: string; comment: string | null }>
  }
  duplicateDetection: {
    exactHashMatches: number
    nearDuplicateMatches: number
    excludedSources: number
    excludedDocuments: number
  }
  sync: {
    corpusWorkspaceId: string
    corpusWorkspaceTitle: string
    createdWorkspace: boolean
    scannedDocuments: number
    readySnapshots: number
    totalSnapshots: number
    existingSources: number
    newSources: number
    newSnapshots: number
    retriedSnapshots: number
    queuedJobs: number
  }
  stats: {
    queries: string[]
    filters: OnboardingFilters
    candidateChunks: number
    candidateCauses: number
    visibleCandidateCauses?: number
    evidenceBackedCauses?: number
    poolEligibleCauses?: number
    rerank?: {
      applied: boolean
      model: string | null
      topK: number
    }
    anchors?: {
      enabled: boolean
      criticalEnabled: boolean
      terms: string[]
      criticalTerms: string[]
      minCoreHits: number
      minSupportHits: number
      minCoreCriticalHits: number
      minSupportCriticalHits: number
      matchedCauses: number
      criticalMatchedCauses: number
      supportPassedCauses: number
      downgradedCore: number
      downgradedToDiscard: number
      downgradedByCritical: number
    }
    warnings: string[]
  }
}

type OnboardingSourceRow = {
  id: string
  workspace_id: string | null
  source_origin: string | null
  status: "pending" | "processing" | "ready" | "error"
  updated_at: string | null
  latest_snapshot_id: string | null
  latest_snapshot_status: "pending" | "processing" | "ready" | "error" | null
}

type SupportingDocumentCard = {
  key: string
  id: string | null
  name: string | null
  documentType: string | null
  date: string | null
  url: string | null
  contribution: string | null
  relatedRoles: string[]
  usages: string[]
}

type HitlDashboardResponse = {
  latestRunId: string | null
  latestRunKpis: {
    used_causes_ratio: number
    perceived_precision: number | null
    time_to_first_use_minutes: number | null
    approved_causes: number
    reviewed_findings: number
  } | null
  dashboard: {
    total_runs: number
    avg_used_causes_ratio: number | null
    avg_perceived_precision: number | null
    avg_time_to_first_use_minutes: number | null
  }
}

type ChatMessage = {
  id: string
  role: "assistant" | "user"
  content: string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatDate(value: string | null) {
  if (!value) return "N/A"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString("es-CL")
}

function utilityLabelText(value: string | null | undefined) {
  if (value === "core") return "Principal"
  if (value === "discard") return "Descartable"
  return "Secundaria"
}

function utilityRiskText(value: string | null | undefined) {
  if (value === "low") return "Bajo"
  if (value === "high") return "Alto"
  return "Medio"
}

export default function OnboardingClient(props: { workspaceId: string; workspaceTitle: string }) {
  const { workspaceId, workspaceTitle } = props
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const resultsAnchorRef = useRef<HTMLDivElement | null>(null)

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "m_welcome",
      role: "assistant",
      content:
        "Hola. Este chat te ayudara a construir el marco teorico inicial. Sube la reclamacion en PDF y, opcionalmente, agrega contexto o enfoque de analisis.",
    },
  ])
  const [prompt, setPrompt] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [snapshotId, setSnapshotId] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [isCompleting, setIsCompleting] = useState(false)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RecommendationResponse | null>(null)
  const [autoReportStatus, setAutoReportStatus] = useState<"idle" | "generating" | "ready" | "error">("idle")
  const [autoReportText, setAutoReportText] = useState<string>("")
  const [autoReportTitle, setAutoReportTitle] = useState<string>("Informe automatico de marco teorico")
  const [autoReportError, setAutoReportError] = useState<string | null>(null)
  const [autoReportNoteId, setAutoReportNoteId] = useState<string | null>(null)
  const [autoReportStructured, setAutoReportStructured] = useState<DefenseReportStructured | null>(null)
  const [reportComparison, setReportComparison] = useState<AutoReportResponse["versions"] | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [causeStatusMap, setCauseStatusMap] = useState<Record<string, string>>({})
  const [findingDecisionMap, setFindingDecisionMap] = useState<Record<string, string>>({})
  const [hitlBusy, setHitlBusy] = useState(false)
  const [hitlDashboard, setHitlDashboard] = useState<HitlDashboardResponse | null>(null)
  const [exportBusy, setExportBusy] = useState<"pdf" | "docx" | null>(null)
  const [filterProjectType, setFilterProjectType] = useState("")
  const [filterRegion, setFilterRegion] = useState("")
  const [filterYearFrom, setFilterYearFrom] = useState("")
  const [filterYearTo, setFilterYearTo] = useState("")
  const [filterThemes, setFilterThemes] = useState("")
  const [showDiscardedRecommendations, setShowDiscardedRecommendations] = useState(false)
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false)
  const [pendingCauseDialog, setPendingCauseDialog] = useState<{ causeId: string; status: string } | null>(null)
  const [pendingCauseComment, setPendingCauseComment] = useState("")
  const [pendingFindingDialog, setPendingFindingDialog] = useState<{ findingId: string; decision: string } | null>(null)
  const [pendingFindingComment, setPendingFindingComment] = useState("")

  const canRun = useMemo(() => {
    if (isRunning) return false
    if (file) return true
    return !!snapshotId
  }, [file, snapshotId, isRunning])

  useEffect(() => {
    let active = true

    async function loadExistingClaimSnapshot() {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/sources`, {
          method: "GET",
          headers: { accept: "application/json" },
        })
        const json = await res.json().catch(() => null)
        if (!res.ok || !json) return

        const rows = (Array.isArray((json as any).sources) ? (json as any).sources : []) as OnboardingSourceRow[]
        const source = rows
          .filter((row) => String(row.workspace_id || "") === workspaceId)
          .filter((row) => String(row.source_origin || "") === "onboarding-claim")
          .sort((a, b) => {
            const aMs = a.updated_at ? Date.parse(a.updated_at) : 0
            const bMs = b.updated_at ? Date.parse(b.updated_at) : 0
            return bMs - aMs
          })
          .find((row) => row.latest_snapshot_id && row.latest_snapshot_status === "ready")

        if (!active || !source?.latest_snapshot_id) return
        setSnapshotId((prev) => prev || String(source.latest_snapshot_id))
      } catch {
        // silent fallback: user can upload manually
      }
    }

    loadExistingClaimSnapshot().catch(() => null)

    return () => {
      active = false
    }
  }, [workspaceId])

  const recommendationByRol = useMemo(() => {
    const map = new Map<string, Recommendation>()
    for (const rec of result?.recommendations || []) {
      const key = String(rec.rol || "").trim().toLowerCase()
      if (!key) continue
      map.set(key, rec)
    }
    return map
  }, [result])

  const displayRecommendations = useMemo(() => {
    const rows = result?.recommendations || []
    if (showDiscardedRecommendations) return rows
    return rows.filter((rec) => String(rec.utilityLabel || "support") !== "discard")
  }, [result, showDiscardedRecommendations])

  const recommendationCounts = useMemo(() => {
    const rows = result?.recommendations || []
    const core = rows.filter((rec) => String(rec.utilityLabel || "support") === "core").length
    const support = rows.filter((rec) => String(rec.utilityLabel || "support") === "support").length
    const discard = rows.filter((rec) => String(rec.utilityLabel || "support") === "discard").length
    return {
      total: rows.length,
      visible: displayRecommendations.length,
      core,
      support,
      discard,
    }
  }, [result, displayRecommendations])

  const supportingDocuments = useMemo<SupportingDocumentCard[]>(() => {
    const rows = displayRecommendations.length ? displayRecommendations : result?.recommendations || []
    const grouped = new Map<string, SupportingDocumentCard & { roleSet: Set<string>; usageSet: Set<string> }>()

    for (const rec of rows) {
      const roleLabel = String(rec.rol || rec.caratula || "Sin rol").trim() || "Sin rol"
      const docs = (rec.interestingDocuments && rec.interestingDocuments.length > 0
        ? rec.interestingDocuments
        : rec.matchedDocuments || []) as Array<{
        id: string
        name: string | null
        documentType?: string | null
        date?: string | null
        url?: string | null
        contribution?: string | null
      }>

      for (const doc of docs.slice(0, 4)) {
        const key = String(doc.id || doc.url || `${doc.name || "doc"}_${doc.date || ""}`)
        if (!key) continue

        const existing = grouped.get(key) || {
          key,
          id: doc.id ? String(doc.id) : null,
          name: doc.name || null,
          documentType: doc.documentType || null,
          date: doc.date || null,
          url: doc.url || null,
          contribution: (doc as any).contribution || rec.defenseSummary || null,
          relatedRoles: [],
          usages: [],
          roleSet: new Set<string>(),
          usageSet: new Set<string>(),
        }

        existing.roleSet.add(roleLabel)
        if ((doc as any).contribution) existing.usageSet.add(String((doc as any).contribution))
        else if (rec.defenseSummary) existing.usageSet.add(String(rec.defenseSummary))

        grouped.set(key, existing)
      }
    }

    return Array.from(grouped.values())
      .map((entry) => ({
        key: entry.key,
        id: entry.id,
        name: entry.name,
        documentType: entry.documentType,
        date: entry.date,
        url: entry.url,
        contribution: entry.contribution,
        relatedRoles: Array.from(entry.roleSet).slice(0, 4),
        usages: Array.from(entry.usageSet).slice(0, 3),
      }))
      .sort((a, b) => b.relatedRoles.length - a.relatedRoles.length)
      .slice(0, 10)
  }, [displayRecommendations, result])

  useEffect(() => {
    if (!result) return
    const frame = window.requestAnimationFrame(() => {
      resultsAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [result])

  function pushMessage(role: "assistant" | "user", content: string) {
    setMessages((prev) => [...prev, { id: `m_${Date.now()}_${Math.random()}`, role, content }])
  }

  function initializeHitlState(recommendation: RecommendationResponse) {
    setActiveRunId(recommendation.analysisRun?.runId || recommendation.hitl?.runId || null)
    const nextCauseStatus: Record<string, string> = {}
    for (const rec of recommendation.recommendations || []) {
      nextCauseStatus[rec.causeId] = "pendiente"
    }
    for (const row of recommendation.hitl?.causeReviews || []) {
      nextCauseStatus[row.causeId] = row.status || "pendiente"
    }
    setCauseStatusMap(nextCauseStatus)
    setFindingDecisionMap({})
  }

  async function refreshHitlDashboard() {
    const res = await fetch(`/api/workspaces/${workspaceId}/onboarding/hitl`, {
      method: "GET",
      headers: { accept: "application/json" },
    })
    const json = (await res.json().catch(() => null)) as HitlDashboardResponse | null
    if (res.ok && json) setHitlDashboard(json)
  }

  async function postHitlAction(payload: any) {
    const res = await fetch(`/api/workspaces/${workspaceId}/onboarding/hitl`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new Error(json?.error || "No se pudo guardar revision")
    await refreshHitlDashboard()
    return json
  }

  async function submitCauseStatus(causeId: string, status: string, comment: string | null) {
    if (!activeRunId) return
    await postHitlAction({
      action: "set_cause_status",
      runId: activeRunId,
      causeId,
      status,
      comment,
    })
    setCauseStatusMap((prev) => ({ ...prev, [causeId]: status }))
  }

  async function submitFindingFeedback(findingId: string, decision: string, comment: string | null) {
    if (!activeRunId) return
    await postHitlAction({
      action: "set_finding_feedback",
      runId: activeRunId,
      findingId,
      decision,
      comment,
    })
    setFindingDecisionMap((prev) => ({ ...prev, [findingId]: decision }))
  }

  async function updateCauseStatus(causeId: string, status: string) {
    if (!activeRunId) return
    if (status === "descartada") {
      setPendingCauseDialog({ causeId, status })
      setPendingCauseComment("")
      return
    }
    setHitlBusy(true)
    try {
      await submitCauseStatus(causeId, status, null)
    } catch (err: any) {
      setError(err?.message || "No se pudo actualizar estado de causa")
    } finally {
      setHitlBusy(false)
    }
  }

  async function updateFindingFeedback(findingId: string, decision: string) {
    if (!activeRunId) return
    if (decision === "descartar") {
      setPendingFindingDialog({ findingId, decision })
      setPendingFindingComment("")
      return
    }
    setHitlBusy(true)
    try {
      await submitFindingFeedback(findingId, decision, null)
    } catch (err: any) {
      setError(err?.message || "No se pudo actualizar hallazgo")
    } finally {
      setHitlBusy(false)
    }
  }

  async function confirmCauseDialog() {
    if (!pendingCauseDialog) return
    const trimmed = pendingCauseComment.trim()
    if (!trimmed) {
      setError("Debes indicar un motivo para descartar la causa.")
      return
    }

    setHitlBusy(true)
    try {
      await submitCauseStatus(pendingCauseDialog.causeId, pendingCauseDialog.status, trimmed)
      setPendingCauseDialog(null)
      setPendingCauseComment("")
    } catch (err: any) {
      setError(err?.message || "No se pudo actualizar estado de causa")
    } finally {
      setHitlBusy(false)
    }
  }

  async function confirmFindingDialog() {
    if (!pendingFindingDialog) return

    setHitlBusy(true)
    try {
      await submitFindingFeedback(
        pendingFindingDialog.findingId,
        pendingFindingDialog.decision,
        pendingFindingComment.trim() || null
      )
      setPendingFindingDialog(null)
      setPendingFindingComment("")
    } catch (err: any) {
      setError(err?.message || "No se pudo actualizar hallazgo")
    } finally {
      setHitlBusy(false)
    }
  }

  async function freezePrecedents() {
    if (!activeRunId) return
    const selected = Object.entries(causeStatusMap)
      .filter(([, status]) => status === "aprobada" || status === "usar_en_escrito")
      .map(([causeId]) => causeId)

    if (!selected.length) {
      setError("Para congelar precedentes debes aprobar al menos una causa.")
      return
    }

    setHitlBusy(true)
    try {
      await postHitlAction({
        action: "freeze_precedents",
        runId: activeRunId,
        causeIds: selected,
      })
      pushMessage("assistant", `Precedentes congelados (${selected.length}).`)
    } catch (err: any) {
      setError(err?.message || "No se pudo congelar precedentes")
    } finally {
      setHitlBusy(false)
    }
  }

  async function exportReport(format: "pdf" | "docx") {
    if (!autoReportText || autoReportStatus !== "ready") return
    setExportBusy(format)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/onboarding/report/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: autoReportTitle, content: autoReportText, format }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error || "No se pudo exportar informe")
      }
      const blob = await res.blob()
      const ext = format === "pdf" ? "pdf" : "docx"
      const link = document.createElement("a")
      const url = URL.createObjectURL(blob)
      link.href = url
      link.download = `informe-marco-teorico.${ext}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      setError(err?.message || "No se pudo exportar")
    } finally {
      setExportBusy(null)
    }
  }

  async function uploadClaimPdf(pdfFile: File) {
    const fd = new FormData()
    fd.set("kind", "upload")
    fd.set("file", pdfFile)
    fd.set("docType", "Reclamacion")
    fd.set("sourceOrigin", "onboarding-claim")
    fd.set("projectName", workspaceTitle)
    fd.set("language", "es")
    fd.set("processNow", "1")

    const res = await fetch(`/api/workspaces/${workspaceId}/sources`, {
      method: "POST",
      body: fd,
    })

    const json = await res.json().catch(() => null)
    if (!res.ok) {
      throw new Error(json?.error || "No se pudo subir la reclamacion")
    }

    const newSnapshotId = json?.snapshotId ? String(json.snapshotId) : ""
    if (!newSnapshotId) {
      throw new Error("La carga no devolvio snapshotId")
    }
    return {
      snapshotId: newSnapshotId,
      status: json?.status ? String(json.status) : null,
      ingestMode: json?.ingestMode ? String(json.ingestMode) : null,
    }
  }

  async function waitSnapshotReady(targetSnapshotId: string) {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const res = await fetch(`/api/snapshots/${targetSnapshotId}/meta`, {
        method: "GET",
        headers: { accept: "application/json" },
      })

      const json = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(json?.error || "No se pudo consultar el estado del documento")
      }

      const status = String(json?.status || "")
      if (status === "ready") return
      if (status === "error") {
        throw new Error(json?.openaiLastError || "La ingesta del PDF fallo")
      }

      await sleep(2000)
    }

    const res = await fetch(`/api/snapshots/${targetSnapshotId}/meta`, {
      method: "GET",
      headers: { accept: "application/json" },
    }).catch(() => null)
    const json = await res?.json().catch(() => null)
    const lastStatus = String(json?.status || "pending")
    if (lastStatus === "pending") {
      throw new Error(
        "La ingesta sigue pendiente. Si esto persiste, revisa que el worker este corriendo o vuelve a intentar la carga."
      )
    }
    throw new Error("La ingesta esta tardando mas de lo esperado")
  }

  async function runRecommendation(
    currentSnapshotId: string,
    currentPrompt: string,
    filters: OnboardingFilters
  ) {
    const res = await fetch(`/api/workspaces/${workspaceId}/onboarding/recommend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        snapshotId: currentSnapshotId,
        question: currentPrompt.trim() || null,
        filters,
      }),
    })

    const json = await res.json().catch(() => null)
    if (!res.ok) {
      if (res.status === 409) {
        throw new Error("El documento aun se esta procesando. Espera unos segundos e intenta de nuevo.")
      }
      throw new Error(json?.error || "No se pudo generar recomendaciones")
    }

    return json as RecommendationResponse
  }

  async function generateAutoReport(recommendation: RecommendationResponse, currentSnapshotId: string) {
    setAutoReportStatus("generating")
    setAutoReportError(null)
    setAutoReportText("")
    setAutoReportNoteId(null)
    setAutoReportStructured(null)
    setReportComparison(null)

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/onboarding/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          snapshotId: currentSnapshotId,
          runId: recommendation.analysisRun?.runId || recommendation.hitl?.runId || null,
          summary: recommendation.summary,
          recommendations: recommendation.recommendations.map((rec) => ({
            causeId: rec.causeId,
            rol: rec.rol,
            caratula: rec.caratula,
            estado: rec.estado,
            score: rec.score,
            confidence: rec.confidence || null,
            reasons: rec.reasons || [],
            defenseSummary: rec.defenseSummary || null,
            strategicActions: rec.strategicActions || [],
            interestingDocuments: (rec.interestingDocuments || rec.matchedDocuments || []).map((doc) => ({
              id: doc.id,
              name: doc.name,
              documentType: doc.documentType,
              date: doc.date,
              url: doc.url,
              contribution: (doc as any).contribution || null,
            })),
            keyQuotes: (rec.keyQuotes || []).map((quote) => ({
              quote: quote.quote,
              claimQuote: quote.claimQuote || null,
              documentName: quote.documentName || null,
              documentUrl: quote.documentUrl || null,
              sourceUrl: quote.sourceUrl || null,
            })),
          })),
        }),
      })

      const json = (await res.json().catch(() => null)) as AutoReportResponse | null
      if (!res.ok) {
        throw new Error((json as any)?.error || "No se pudo generar informe automatico")
      }

      setAutoReportStatus("ready")
      setAutoReportTitle(String(json?.report?.title || "Informe automatico de marco teorico"))
      setAutoReportText(String(json?.report?.content || ""))
      setAutoReportNoteId(json?.noteId ? String(json.noteId) : null)
      const structured = json?.report?.structured
      setAutoReportStructured(
        structured && typeof structured === "object" ? (structured as DefenseReportStructured) : null
      )
      setReportComparison(json?.versions || null)
      pushMessage("assistant", "Informe de resumen generado automaticamente. Revisa la seccion de informe debajo del chat.")
    } catch (err: any) {
      const msg = err?.message ?? "Error inesperado al generar informe"
      setAutoReportStatus("error")
      setAutoReportError(msg)
      setAutoReportStructured(null)
      setReportComparison(null)
      pushMessage("assistant", `No pude generar el informe automatico: ${msg}`)
    }
  }

  async function onAnalyze() {
    setError(null)
    setIsRunning(true)
    setResult(null)
    setAutoReportStatus("idle")
    setAutoReportText("")
    setAutoReportError(null)
    setAutoReportNoteId(null)
    setAutoReportStructured(null)
    setReportComparison(null)
    setActiveRunId(null)
    setCauseStatusMap({})
    setFindingDecisionMap({})

    const yearFromRaw = filterYearFrom.trim()
    const yearToRaw = filterYearTo.trim()
    const yearFromParsed = yearFromRaw ? Number(yearFromRaw) : Number.NaN
    const yearToParsed = yearToRaw ? Number(yearToRaw) : Number.NaN
    const requestFilters: OnboardingFilters = {
      projectType: filterProjectType.trim() || null,
      region: filterRegion.trim() || null,
      yearFrom: Number.isFinite(yearFromParsed) ? Math.floor(yearFromParsed) : null,
      yearTo: Number.isFinite(yearToParsed) ? Math.floor(yearToParsed) : null,
      themes: filterThemes
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x.length >= 2)
        .slice(0, 15),
    }

    const hasFilters =
      !!requestFilters.projectType ||
      !!requestFilters.region ||
      !!requestFilters.yearFrom ||
      !!requestFilters.yearTo ||
      requestFilters.themes.length > 0

    const userMessage = prompt.trim() || (file ? `Subi reclamacion: ${file.name}` : "Analiza esta reclamacion")
    pushMessage(
      "user",
      hasFilters
        ? `${userMessage}\n\nFiltros: ${[
            requestFilters.projectType ? `tipo=${requestFilters.projectType}` : null,
            requestFilters.region ? `region=${requestFilters.region}` : null,
            requestFilters.yearFrom ? `desde=${requestFilters.yearFrom}` : null,
            requestFilters.yearTo ? `hasta=${requestFilters.yearTo}` : null,
            requestFilters.themes.length ? `temas=${requestFilters.themes.join("; ")}` : null,
          ]
            .filter(Boolean)
            .join(" | ")}`
        : userMessage
    )

    try {
      let workingSnapshotId = snapshotId
      let uploadedStatus: string | null = null

      if (file) {
        setStatusText("Subiendo reclamacion...")
        const uploaded = await uploadClaimPdf(file)
        workingSnapshotId = uploaded.snapshotId
        uploadedStatus = uploaded.status
        setSnapshotId(workingSnapshotId)
      }

      if (!workingSnapshotId) {
        throw new Error("Debes subir una reclamacion en PDF")
      }

      if (file && uploadedStatus !== "ready") {
        setStatusText("Procesando documento (OCR/chunks/indices)...")
        await waitSnapshotReady(workingSnapshotId)
      }

      setStatusText("Buscando causas similares y generando marco teorico...")
      const recommendation = await runRecommendation(workingSnapshotId, prompt, requestFilters)
      const hideDiscardDefault = recommendation.recommendationPolicy?.softFilter?.hideDiscardDefault !== false
      setShowDiscardedRecommendations(!hideDiscardDefault)
      setResult(recommendation)
      initializeHitlState(recommendation)
      void refreshHitlDashboard()
      void generateAutoReport(recommendation, workingSnapshotId)

      pushMessage("assistant", recommendation.summary?.text || "Analisis completado.")
      setPrompt("")
      setFile(null)
    } catch (err: any) {
      const message = err?.message ?? "Error inesperado"
      setError(message)
      pushMessage("assistant", `No pude completar el analisis: ${message}`)
    } finally {
      setStatusText(null)
      setIsRunning(false)
    }
  }

  async function completeOnboarding() {
    if (!result) return
    setIsCompleting(true)
    setError(null)

    try {
      const recommendationsForCompletion =
        displayRecommendations.length > 0
          ? displayRecommendations
          : (result.recommendations || []).slice(0, Math.min(4, result.recommendations.length))

      const payload = {
        snapshotId: result.claim.snapshotId,
        summary: autoReportStatus === "ready" && autoReportText ? autoReportText : result.summary?.text || null,
        summaryCitations: result.summary?.citations || [],
        recommendations: recommendationsForCompletion.slice(0, 12).map((rec) => ({
          causeId: rec.causeId,
          rol: rec.rol,
          score: rec.score,
          reason: rec.reasons?.[0] || null,
        })),
        matrix: (result.matrix || []).slice(0, 25).map((row) => ({
          causeId: row.causeId,
          rol: row.rol || null,
          confidence: row.confidence || null,
          riskLevel: row.riskLevel,
          score: typeof row.score === "number" ? row.score : null,
          document: row.document
            ? {
                id: row.document.id || null,
                name: row.document.name || null,
                url: row.document.url || null,
                contribution: row.document.contribution || null,
              }
            : null,
          whereToCite: row.whereToCite
            ? {
                findingId: row.whereToCite.findingId || null,
                quote: row.whereToCite.quote || null,
                claimQuote: row.whereToCite.claimQuote || null,
                similarityType: row.whereToCite.similarityType || null,
                similarityTypeLabel: row.whereToCite.similarityTypeLabel || null,
                commonTerms: Array.isArray(row.whereToCite.commonTerms)
                  ? row.whereToCite.commonTerms.slice(0, 20)
                  : [],
                documentUrl: row.whereToCite.documentUrl || null,
              }
            : null,
        })),
        report:
          autoReportStatus === "ready"
            ? {
                title: autoReportTitle,
                content: autoReportText,
                structured: autoReportStructured || null,
              }
            : null,
      }

      const res = await fetch(`/api/workspaces/${workspaceId}/onboarding/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(json?.error || "No se pudo cerrar el onboarding")
      }

      router.replace(`/projects/${workspaceId}`)
      router.refresh()
    } catch (err: any) {
      setError(err?.message ?? "Error inesperado")
    } finally {
      setIsCompleting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href="/projects" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Volver a proyectos
        </Link>
        <div className="text-right text-xs text-muted-foreground">
          Proyecto: <span className="font-medium text-foreground">{workspaceTitle}</span>
        </div>
      </div>

      <Card className="overflow-hidden border-border/60 bg-card/65">
        <div className="border-b border-border/60 px-5 py-4">
          <div className="text-lg font-semibold">Marco teorico inicial</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Sube la reclamacion y genera una busqueda RAG para priorizar causas similares con citas y resumen detallado.
          </p>
        </div>

        <div className="grid gap-0 lg:h-[calc(100vh-220px)] lg:min-h-[680px] lg:grid-cols-[minmax(0,1fr)_440px] lg:items-stretch">
          <div className="border-b border-border/60 lg:flex lg:min-h-0 lg:flex-col lg:border-b-0 lg:border-r lg:border-border/60">
            <div className="space-y-3 overflow-y-auto px-4 py-4 lg:min-h-0 lg:flex-1">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={
                    message.role === "assistant"
                      ? "rounded-2xl border border-border/60 bg-background/35 px-4 py-3"
                      : "ml-auto max-w-[85%] rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3"
                  }
                >
                  <div className="mb-1 text-[11px] text-muted-foreground">
                    {message.role === "assistant" ? "Asistente" : "Tu"}
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-6">{message.content}</div>
                </div>
              ))}
            </div>

            <div className="border-t border-border/60 px-4 py-4 lg:shrink-0">
              {error ? (
                <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              ) : null}

              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const selected = e.target.files?.[0] || null
                    setFile(selected)
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isRunning}
                >
                  <UploadCloud className="h-4 w-4" />
                  {file ? "Cambiar PDF" : "Subir reclamacion (PDF)"}
                </Button>

                {file ? (
                  <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/35 px-3 py-1 text-xs">
                    <FileText className="h-3.5 w-3.5" />
                    {file.name}
                  </div>
                ) : snapshotId ? (
                  <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/35 px-3 py-1 text-xs text-muted-foreground">
                    PDF ya cargado (snapshot listo para reanalizar)
                  </div>
                ) : null}
              </div>

              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Opcional: agrega contexto (tipo de proyecto, foco de riesgo, region, etc.)"
                className="min-h-[90px] bg-background/35"
                disabled={isRunning}
              />

              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                <input
                  value={filterProjectType}
                  onChange={(e) => setFilterProjectType(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background/35 px-3 text-sm"
                  placeholder="Filtro tipo proyecto (ej: hidroelectrica)"
                  disabled={isRunning}
                />
                <input
                  value={filterRegion}
                  onChange={(e) => setFilterRegion(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background/35 px-3 text-sm"
                  placeholder="Filtro region (ej: Araucania)"
                  disabled={isRunning}
                />
                <input
                  value={filterYearFrom}
                  onChange={(e) => setFilterYearFrom(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background/35 px-3 text-sm"
                  placeholder="Ano desde"
                  inputMode="numeric"
                  disabled={isRunning}
                />
                <input
                  value={filterYearTo}
                  onChange={(e) => setFilterYearTo(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background/35 px-3 text-sm"
                  placeholder="Ano hasta"
                  inputMode="numeric"
                  disabled={isRunning}
                />
              </div>

              <input
                value={filterThemes}
                onChange={(e) => setFilterThemes(e.target.value)}
                className="mt-2 h-9 w-full rounded-md border border-input bg-background/35 px-3 text-sm"
                placeholder="Temas (coma): ruido, agua, consulta indigena"
                disabled={isRunning}
              />

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  <Sparkles className="mr-1 inline h-3.5 w-3.5" />
                  {statusText || "El analisis excluye inteligentemente documentos duplicados de la misma reclamacion."}
                </div>

                <div className="flex items-center gap-2">
                  <Button onClick={() => onAnalyze().catch(() => null)} disabled={!canRun} className="gap-2">
                    {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {isRunning ? "Analizando..." : "Generar marco teorico"}
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => completeOnboarding().catch(() => null)}
                    disabled={!result || isCompleting}
                  >
                    {isCompleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continuar al proyecto"}
                  </Button>
                </div>
              </div>

              <div className="mt-2 text-[11px] text-muted-foreground">
                Al continuar, se guarda el resumen y se crea un borrador inicial en Studio para empezar la redaccion.
              </div>

            </div>
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden">
            <div className="border-b border-border/60 bg-background/45 px-4 py-4 backdrop-blur">
              <div className="mb-2 text-sm font-semibold">Resultados</div>
              <div className="mb-3 text-xs text-muted-foreground">
                Aqui tienes una vista compacta para aprobar causas. El detalle completo del resumen, documentos clave e informe aparece abajo.
              </div>

              {result ? (
                <div className="space-y-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-xl border border-border/55 bg-background/30 p-3">
                      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Corrida</div>
                      <div className="mt-1 text-sm font-medium text-foreground">
                        {result.analysisRun?.runId ? result.analysisRun.runId.slice(0, 8) : "N/A"}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">Identificador tecnico de esta corrida de analisis.</div>
                    </div>
                    <div className="rounded-xl border border-border/55 bg-background/30 p-3">
                      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Causas priorizadas</div>
                      <div className="mt-1 text-sm font-medium text-foreground">
                        {recommendationCounts.visible}/{recommendationCounts.total}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">Cuantas causas quedaron visibles para revision y uso.</div>
                    </div>
                    <div className="rounded-xl border border-border/55 bg-background/30 p-3">
                      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Causas con citas</div>
                      <div className="mt-1 text-sm font-medium text-foreground">
                        {result.recommendationPolicy?.evidence?.backedCount ?? 0}/{recommendationCounts.total}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">Cuantas tienen respaldo textual directo y no solo referencia heuristica.</div>
                    </div>
                    <div className="rounded-xl border border-border/55 bg-background/30 p-3">
                      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Documentos del corpus</div>
                      <div className="mt-1 text-sm font-medium text-foreground">{result.sync.readySnapshots}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">Documentos tribunal ya procesados y listos para consultar/citar.</div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/55 bg-background/25 p-3 text-[11px] text-muted-foreground">
                    <div className="font-medium text-foreground">Que hace cada control</div>
                    <div className="mt-2 space-y-1">
                      <div>- `Congelar precedentes`: guarda esta seleccion como base estable para seguir trabajando.</div>
                      <div>- `Mostrar descartables`: deja ver causas secundarias o de baja utilidad que normalmente se ocultan.</div>
                      <div>- `Ver diagnostico tecnico`: muestra metricas internas, filtros y señales del motor.</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      onClick={() => freezePrecedents().catch(() => null)}
                      disabled={!activeRunId || hitlBusy}
                    >
                      Congelar precedentes
                    </Button>
                    {result.recommendationPolicy?.softFilter?.enabled ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px]"
                        onClick={() => setShowDiscardedRecommendations((prev) => !prev)}
                        disabled={hitlBusy}
                      >
                        {showDiscardedRecommendations ? "Ocultar descartables" : "Mostrar descartables"}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      onClick={() => setShowTechnicalDetails((prev) => !prev)}
                    >
                      {showTechnicalDetails ? "Ocultar diagnostico tecnico" : "Ver diagnostico tecnico"}
                    </Button>
                  </div>

                  {showTechnicalDetails ? (
                    <div className="rounded-xl border border-border/55 bg-background/30 p-3 text-xs text-muted-foreground">
                      <div>Docs corpus listos: {result.sync.readySnapshots}</div>
                      <div>Nuevos encolados: {result.sync.queuedJobs}</div>
                      <div>
                        Duplicados excluidos: {result.duplicateDetection.excludedSources} (hash: {result.duplicateDetection.exactHashMatches}, similitud: {result.duplicateDetection.nearDuplicateMatches})
                      </div>
                      <div>
                        Rerank defensivo: {result.recommendationPolicy?.rerank?.applied ? "activo" : "heuristico"}
                        {result.recommendationPolicy?.rerank?.model ? ` (${result.recommendationPolicy.rerank.model})` : ""}
                      </div>
                      <div>Utilidad: core {recommendationCounts.core} · support {recommendationCounts.support} · discard {recommendationCounts.discard}</div>
                    </div>
                  ) : null}

                  {result?.analysisRun?.confidenceRules ? (
                    <div className="rounded-xl border border-border/55 bg-background/30 p-3 text-xs text-muted-foreground">
                      <div className="mb-1 font-medium text-foreground">Como leer la confianza</div>
                      <div>- Alta: {result.analysisRun.confidenceRules.alta}</div>
                      <div>- Media: {result.analysisRun.confidenceRules.media}</div>
                      <div>- Baja: {result.analysisRun.confidenceRules.baja}</div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
                  Aun no hay corrida activa. Cuando generes el marco teorico, aqui quedaran los controles rapidos.
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {!result ? (
                <div className="rounded-xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                  Aun no hay resultados. Sube la reclamacion y ejecuta el analisis para ver las causas sugeridas.
                </div>
              ) : (
                <div className="space-y-3">
                  {displayRecommendations.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
                      No hay causas visibles con el filtro actual. Activa {"\""}Mostrar descartables{"\""} para revisar referencias secundarias.
                    </div>
                  ) : null}
                  {displayRecommendations.map((rec, idx) => (
                  <div key={rec.causeId} className="rounded-xl border border-border/55 bg-background/30 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">
                          {idx + 1}. {rec.rol || "(sin rol)"}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">Score: {rec.score.toFixed(3)}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Confianza: {(rec.confidence || "media").toString().toUpperCase()}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                          <span
                            className={
                              String(rec.utilityLabel || "support") === "core"
                                ? "rounded-full border border-emerald-500/35 bg-emerald-500/15 px-2 py-0.5 text-emerald-100"
                                : String(rec.utilityLabel || "support") === "discard"
                                  ? "rounded-full border border-rose-500/35 bg-rose-500/10 px-2 py-0.5 text-rose-100"
                                  : "rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-amber-100"
                            }
                          >
                            {utilityLabelText(rec.utilityLabel)}
                          </span>
                          <span className="rounded-full border border-border/50 bg-background/40 px-2 py-0.5 text-muted-foreground">
                            Riesgo {utilityRiskText(rec.utilityRisk)}
                          </span>
                          {rec.evidenceBacked === false ? (
                            <span className="rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-amber-100">
                              PRELIMINAR
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {[
                            ["pendiente", "Pendiente"],
                            ["aprobada", "Aprobar"],
                            ["descartada", "Descartar"],
                            ["usar_en_escrito", "Usar en escrito"],
                          ].map(([value, label]) => {
                            const active = (causeStatusMap[rec.causeId] || "pendiente") === value
                            return (
                              <Button
                                key={`${rec.causeId}_${value}`}
                                type="button"
                                size="sm"
                                variant={active ? "default" : "outline"}
                                className="h-6 px-2 text-[11px]"
                                disabled={!activeRunId || hitlBusy}
                                onClick={() => updateCauseStatus(rec.causeId, value).catch(() => null)}
                              >
                                {label}
                              </Button>
                            )
                          })}
                        </div>
                      </div>
                      {rec.linkCausa ? (
                        <a
                          href={rec.linkCausa}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"
                        >
                          Ver causa
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </div>

                    <div className="mt-2 text-xs leading-5 text-muted-foreground">{rec.caratula || "Sin caratula"}</div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {rec.fechaIngreso ? `Ingreso: ${formatDate(rec.fechaIngreso)} · ` : ""}
                      {rec.estado || "Estado N/A"}
                    </div>

                    {rec.scoreBreakdown ? (
                      <div className="mt-2 rounded-md border border-border/50 bg-background/35 p-2 text-xs text-muted-foreground">
                        <div className="mb-1 text-[11px] font-semibold text-foreground">Score explicable</div>
                        <div>Textual: {rec.scoreBreakdown.textualSimilarity.toFixed(3)}</div>
                        <div>Calidad documental: {rec.scoreBreakdown.documentQuality.toFixed(3)}</div>
                        <div>Etapa procesal: {rec.scoreBreakdown.proceduralStage.toFixed(3)}</div>
                        <div>Filtros: {rec.scoreBreakdown.filterBoost.toFixed(3)}</div>
                        <div>Overlap causa: {rec.scoreBreakdown.lexicalCausaOverlap.toFixed(3)}</div>
                        <div className="mt-1 font-medium text-foreground">Total: {rec.scoreBreakdown.total.toFixed(3)}</div>
                        {(rec.scoreDrivers?.up?.length || rec.scoreDrivers?.down?.length) ? (
                          <div className="mt-2 grid gap-1 md:grid-cols-2">
                            <div>
                              <div className="text-[11px] font-semibold text-emerald-300">Sube score</div>
                              {(rec.scoreDrivers?.up || []).slice(0, 3).map((x, idx) => (
                                <div key={`${rec.causeId}_up_${idx}`}>+ {x}</div>
                              ))}
                            </div>
                            <div>
                              <div className="text-[11px] font-semibold text-amber-300">Baja score</div>
                              {(rec.scoreDrivers?.down || []).slice(0, 3).map((x, idx) => (
                                <div key={`${rec.causeId}_down_${idx}`}>- {x}</div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {rec.reasons?.length ? (
                      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {rec.reasons.slice(0, 3).map((reason, rIdx) => (
                          <div key={`${rec.causeId}_reason_${rIdx}`}>- {reason}</div>
                        ))}
                      </div>
                    ) : null}

                    {rec.defenseSummary ? (
                      <div className="mt-2 rounded-md border border-emerald-500/25 bg-emerald-500/10 p-2 text-xs text-emerald-100">
                        <span className="font-medium">Aporte a defensa:</span> {rec.defenseSummary}
                      </div>
                    ) : null}

                    {rec.utilityReason ? (
                      <div className="mt-2 rounded-md border border-border/50 bg-background/35 p-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Criterio de utilidad:</span> {rec.utilityReason}
                      </div>
                    ) : null}

                    {typeof rec.anchorHits === "number" || rec.matchedAnchors?.length || rec.missingAnchors?.length ? (
                      <div className="mt-2 rounded-md border border-sky-500/25 bg-sky-500/10 p-2 text-xs text-sky-100">
                        <div>
                          <span className="font-medium">Anclas defensa:</span> {Number(rec.anchorHits || 0)} hits
                          {typeof rec.anchorCoverage === "number" ? ` (${(rec.anchorCoverage * 100).toFixed(0)}%)` : ""}
                          {rec.anchorGate?.enabled
                            ? ` · core>=${rec.anchorGate.minCoreHits} · support>=${rec.anchorGate.minSupportHits}`
                            : ""}
                        </div>
                        {rec.anchorGate?.criticalEnabled ? (
                          <div className="mt-1">
                            <span className="font-medium">Anclas criticas:</span> {Number(rec.criticalAnchorHits || 0)} hits
                            {` · core>=${rec.anchorGate.minCoreCriticalHits} · support>=${rec.anchorGate.minSupportCriticalHits}`}
                          </div>
                        ) : null}
                        {rec.matchedAnchors?.length ? (
                          <div className="mt-1">Encontradas: {rec.matchedAnchors.slice(0, 8).join(", ")}</div>
                        ) : (
                          <div className="mt-1">Encontradas: ninguna</div>
                        )}
                        {rec.missingAnchors?.length ? (
                          <div className="mt-1 text-sky-200/85">No encontradas: {rec.missingAnchors.slice(0, 8).join(", ")}</div>
                        ) : null}
                        {rec.matchedCriticalAnchors?.length ? (
                          <div className="mt-1">Criticas encontradas: {rec.matchedCriticalAnchors.slice(0, 8).join(", ")}</div>
                        ) : rec.anchorGate?.criticalEnabled ? (
                          <div className="mt-1">Criticas encontradas: ninguna</div>
                        ) : null}
                        {rec.missingCriticalAnchors?.length ? (
                          <div className="mt-1 text-sky-200/85">
                            Criticas no encontradas: {rec.missingCriticalAnchors.slice(0, 8).join(", ")}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {(rec.strategicActions || []).length ? (
                      <div className="mt-2 rounded-md border border-border/50 bg-background/35 p-2">
                        <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Como usar esta causa</div>
                        <div className="space-y-1 text-xs text-muted-foreground">
                          {(rec.strategicActions || []).slice(0, 3).map((action, aIdx) => (
                            <div key={`${rec.causeId}_action_${aIdx}`}>{aIdx + 1}. {action}</div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {((rec.interestingDocuments && rec.interestingDocuments.length > 0) || rec.matchedDocuments?.length) ? (
                      <div className="mt-2 rounded-md border border-border/50 bg-background/35 p-2">
                        <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Documentos especificos de apoyo</div>
                        <div className="space-y-1 text-xs text-muted-foreground">
                          {(rec.interestingDocuments && rec.interestingDocuments.length > 0
                            ? rec.interestingDocuments
                            : rec.matchedDocuments
                          )
                            .slice(0, 3)
                            .map((doc, dIdx) => (
                              <div key={`${rec.causeId}_doc_${dIdx}`} className="rounded-md border border-border/40 bg-background/40 p-2">
                                <div className="font-medium text-foreground">{doc.name || doc.documentType || "Documento"}</div>
                                {doc.documentType ? <div>{doc.documentType}</div> : null}
                                {doc.date ? <div>Fecha: {formatDate(doc.date)}</div> : null}
                                {(doc as any).contribution ? <div>Utilidad: {(doc as any).contribution}</div> : null}
                                {doc.url ? (
                                  <a
                                    href={doc.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-1 inline-flex items-center gap-1 text-blue-400 hover:underline"
                                  >
                                    Abrir documento especifico
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                ) : null}
                              </div>
                            ))}
                        </div>
                      </div>
                    ) : null}

                    {rec.keyQuotes?.length ? (
                      <div className="mt-2 space-y-1">
                        {rec.keyQuotes.slice(0, 2).map((quote, qIdx) => (
                          <div key={`${rec.causeId}_quote_${qIdx}`} className="rounded-md border border-border/50 bg-background/40 p-2 text-xs leading-5">
                            <div className="mb-2 flex flex-wrap items-center gap-1">
                              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-100">
                                {quote.similarityTypeLabel || "Hecho"}
                              </span>
                              {quote.commonTerms?.length ? (
                                <span className="rounded-full border border-border/50 bg-background/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                                  Terminos comunes: {quote.commonTerms.slice(0, 6).join(", ")}
                                </span>
                              ) : null}
                            </div>

                            {quote.claimQuote ? (
                              <div className="mb-2">
                                <div className="text-[11px] font-semibold text-muted-foreground">Fragmento reclamacion</div>
                                <div>{"\""}{quote.claimQuote}{"\""}</div>
                              </div>
                            ) : null}

                            <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Fragmento causa/documento</div>
                            <div>{"\""}{quote.quote}{"\""}</div>
                            {typeof quote.lexicalOverlapWithClaim === "number" ? (
                              <div className="mt-1 text-[11px] text-muted-foreground">
                                Similitud lexical aprox: {(quote.lexicalOverlapWithClaim * 100).toFixed(1)}%
                              </div>
                            ) : null}

                            {quote.analysisComment ? (
                              <div className="mt-1 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100">
                                {quote.analysisComment}
                              </div>
                            ) : null}

                            {quote.findingId ? (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {[
                                  ["util", "Util"],
                                  ["dudoso", "Dudoso"],
                                  ["descartar", "Descartar"],
                                  ["usar_en_escrito", "Usar en escrito"],
                                ].map(([value, label]) => {
                                  const active = (findingDecisionMap[quote.findingId || ""] || "") === value
                                  return (
                                    <Button
                                      key={`${quote.findingId}_${value}`}
                                      type="button"
                                      size="sm"
                                      variant={active ? "default" : "outline"}
                                      className="h-6 px-2 text-[11px]"
                                      disabled={!activeRunId || hitlBusy}
                                      onClick={() =>
                                        quote.findingId
                                          ? updateFindingFeedback(quote.findingId, value).catch(() => null)
                                          : null
                                      }
                                    >
                                      {label}
                                    </Button>
                                  )
                                })}
                              </div>
                            ) : null}

                            <div className="mt-2 flex flex-wrap gap-3">
                              {quote.documentUrl ? (
                                <a
                                  href={quote.documentUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-blue-400 hover:underline"
                                >
                                  Abrir documento especifico
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              ) : null}
                              {quote.sourceUrl && quote.sourceUrl !== quote.documentUrl ? (
                                <a
                                  href={quote.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-blue-400 hover:underline"
                                >
                                  Abrir fuente del hallazgo
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  ))}

                  {result.matrix?.length ? (
                    <div className="rounded-xl border border-border/55 bg-background/30 p-3">
                      <div className="mb-2 text-xs font-semibold text-muted-foreground">Matriz Causa - Documento - Aporte</div>
                      <div className="space-y-2">
                        {result.matrix.slice(0, 10).map((row, idx) => (
                          <div key={`${row.causeId}_${idx}`} className="rounded-md border border-border/50 bg-background/40 p-2 text-xs text-muted-foreground">
                            <div className="font-medium text-foreground">{idx + 1}. {row.rol || "(sin rol)"}</div>
                            <div>
                              Riesgo: {row.riskLevel} | Confianza: {(row.confidence || "media").toUpperCase()} | Score: {row.score.toFixed(3)}
                            </div>
                            {row.document ? (
                              <div>
                                Documento clave: {row.document.name}
                                {row.document.url ? (
                                  <a
                                    href={row.document.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="ml-1 inline-flex items-center gap-1 text-blue-400 hover:underline"
                                  >
                                    abrir
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                ) : null}
                              </div>
                            ) : null}
                            {row.document?.contribution ? <div>Aporte: {row.document.contribution}</div> : null}
                            {row.whereToCite ? (
                              <div>
                                Donde citar: {row.whereToCite.similarityTypeLabel}
                                {row.whereToCite.documentUrl ? (
                                  <a
                                    href={row.whereToCite.documentUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="ml-1 inline-flex items-center gap-1 text-blue-400 hover:underline"
                                  >
                                    ver cita
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {result.summary?.citations?.length ? (
                    <div className="rounded-xl border border-border/55 bg-background/30 p-3">
                      <div className="mb-2 text-xs font-semibold text-muted-foreground">Citas del resumen</div>
                      <div className="space-y-2">
                        {result.summary.citations.slice(0, 6).map((citation, idx) => (
                          <div key={`${citation.chunkId}_${idx}`} className="rounded-md border border-border/50 bg-background/40 p-2 text-xs leading-5">
                            <div className="mb-1">{"\""}{citation.quote}{"\""}</div>
                            {citation.sourceUrl ? (
                              <a
                                href={citation.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-blue-400 hover:underline"
                              >
                                Abrir fuente
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      {(result || autoReportStatus !== "idle") && (
        <div ref={resultsAnchorRef}>
        <Card className="mt-6 overflow-hidden border-border/60 bg-card/70">
          <div className="border-b border-border/60 bg-gradient-to-r from-emerald-500/15 via-cyan-500/10 to-transparent px-6 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-lg font-semibold text-foreground">
                  <Sparkles className="h-4 w-4 text-emerald-300" />
                  Resultados del marco teorico
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Aqui quedan el resumen ejecutivo, los documentos clave para la defensa y el informe automatizado listo para exportar.
                </div>
              </div>

              {autoReportStatus === "ready" ? (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={exportBusy !== null}
                    onClick={() => exportReport("pdf").catch(() => null)}
                  >
                    {exportBusy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Exportar PDF"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={exportBusy !== null}
                    onClick={() => exportReport("docx").catch(() => null)}
                  >
                    {exportBusy === "docx" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Exportar DOCX"}
                  </Button>
                </div>
              ) : null}

              <div
                className={`rounded-full border px-3 py-1 text-xs ${
                  autoReportStatus === "ready"
                    ? "border-emerald-500/35 bg-emerald-500/15 text-emerald-100"
                    : autoReportStatus === "error"
                      ? "border-destructive/40 bg-destructive/10 text-destructive"
                      : "border-border/60 bg-background/30 text-muted-foreground"
                }`}
              >
                {autoReportStatus === "ready"
                  ? "Informe listo"
                  : autoReportStatus === "generating"
                    ? "Generando informe"
                    : autoReportStatus === "error"
                      ? "Error informe"
                      : "Esperando analisis"}
              </div>
            </div>
          </div>

          <div className="px-6 py-5">
            {result ? (
              <div className="mb-5 rounded-xl border border-border/60 bg-background/35 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-foreground">Resumen ejecutivo</div>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-100">
                      Core {recommendationCounts.core}
                    </span>
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-100">
                      Support {recommendationCounts.support}
                    </span>
                    <span className="rounded-full border border-border/50 bg-background/35 px-2 py-1 text-muted-foreground">
                      Evidencia directa {result.recommendationPolicy?.evidence?.backedCount ?? 0}/{recommendationCounts.total}
                    </span>
                  </div>
                </div>
                <p className="text-sm leading-7 text-foreground/90">
                  {result.summary?.text || "Analisis completado. Revisa las causas y el informe para construir la defensa."}
                </p>

                {result.summary?.citations?.length ? (
                  <div className="mt-3 grid gap-2 lg:grid-cols-2">
                    {result.summary.citations.slice(0, 4).map((citation, idx) => (
                      <div key={`${citation.chunkId}_${idx}`} className="rounded-lg border border-border/50 bg-background/40 p-3 text-xs leading-5 text-muted-foreground">
                        <div className="mb-1 font-medium text-foreground">Cita {idx + 1}</div>
                        <div>{"\""}{citation.quote}{"\""}</div>
                        {citation.sourceUrl ? (
                          <a
                            href={citation.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-1 text-blue-400 hover:underline"
                          >
                            Abrir fuente
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {supportingDocuments.length ? (
              <div className="mb-5 rounded-xl border border-border/60 bg-background/35 p-4">
                <div className="mb-2 text-sm font-semibold text-foreground">Documentos que sirven para construir el marco teorico</div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {supportingDocuments.map((doc) => (
                    <div key={doc.key} className="rounded-xl border border-border/50 bg-background/40 p-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-foreground">{doc.name || doc.documentType || "Documento"}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {[doc.documentType, doc.date ? `Fecha: ${formatDate(doc.date)}` : null].filter(Boolean).join(" · ") || "Documento priorizado"}
                          </div>
                        </div>
                        {doc.url ? (
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"
                          >
                            Abrir
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : null}
                      </div>

                      {doc.relatedRoles.length ? (
                        <div className="mt-2 text-xs text-muted-foreground">
                          Sirve para: {doc.relatedRoles.join(", ")}
                        </div>
                      ) : null}

                      {doc.usages.length ? (
                        <div className="mt-2 space-y-1 text-xs text-foreground/85">
                          {doc.usages.map((usage, idx) => (
                            <div key={`${doc.key}_usage_${idx}`}>- {usage}</div>
                          ))}
                        </div>
                      ) : doc.contribution ? (
                        <div className="mt-2 text-xs text-foreground/85">- {doc.contribution}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : result ? (
              <div className="mb-5 rounded-xl border border-dashed border-border/60 bg-background/25 p-4 text-sm text-muted-foreground">
                Aun no hay documentos destacados en la corrida actual. Revisa las causas priorizadas a la derecha para validar soporte documental.
              </div>
            ) : null}

            {result?.recommendations?.length ? (
              <div className="mb-5 rounded-xl border border-border/60 bg-background/35 p-4">
                <div className="mb-2 text-sm font-semibold text-foreground">Causas priorizadas para defensa</div>
                <div className="space-y-2">
                  {displayRecommendations.slice(0, 5).map((rec, idx) => (
                    <div key={`summary_row_${rec.causeId}`} className="rounded-lg border border-border/50 bg-background/40 p-3 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="font-medium text-foreground">{idx + 1}. {rec.rol || "(sin rol)"}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{rec.caratula || "Sin caratula"}</div>
                        </div>
                        <div className="rounded-full border border-border/50 bg-background/35 px-2 py-0.5 text-[11px] text-muted-foreground">
                          Score {rec.score.toFixed(3)}
                        </div>
                      </div>
                      {rec.defenseSummary ? <div className="mt-2 text-xs text-foreground/90">{rec.defenseSummary}</div> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {autoReportStatus === "idle" ? (
              <div className="rounded-xl border border-dashed border-border/60 bg-background/30 p-6 text-center text-sm text-muted-foreground">
                El informe aparecera aqui automaticamente despues de generar el marco teorico.
              </div>
            ) : null}

            {autoReportStatus === "generating" ? (
              <div className="rounded-xl border border-emerald-500/25 bg-background/30 p-8 text-center">
                <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-emerald-300" />
                <div className="text-base font-medium text-foreground">Generando informe de resumen para defensa...</div>
                <div className="mt-1 text-sm text-muted-foreground">En breve se desplegara aqui en formato legible.</div>
              </div>
            ) : null}

            {autoReportStatus === "error" ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {autoReportError || "No se pudo generar informe automatico"}
              </div>
            ) : null}

            {autoReportStatus === "ready" ? (
              <div className="space-y-5">
                <div className="text-base font-semibold text-foreground">{autoReportTitle}</div>

                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/8 p-4 text-sm text-muted-foreground">
                  <div className="mb-1 font-medium text-foreground">Informe de defensa automatizado</div>
                  <div>
                    Este bloque transforma las causas y documentos priorizados en un borrador util para defensa y exportacion.
                  </div>
                </div>

                {autoReportStructured ? (
                  <>
                    <div className="rounded-xl border border-border/60 bg-background/35 p-4">
                      <div className="mb-2 text-sm font-semibold text-foreground">Resumen ejecutivo</div>
                      <p className="text-sm leading-7 text-foreground/90">{autoReportStructured.executiveSummary}</p>
                    </div>

                    <div className="rounded-xl border border-border/60 bg-background/35 p-4">
                      <div className="mb-2 text-sm font-semibold text-foreground">Hipotesis de defensa</div>
                      <p className="text-sm leading-7 text-foreground/90">{autoReportStructured.defenseHypothesis}</p>
                    </div>

                    {(autoReportStructured.comparableFacts || []).length ? (
                      <div className="rounded-xl border border-border/60 bg-background/35 p-4">
                        <div className="mb-2 text-sm font-semibold text-foreground">Hechos comparables</div>
                        {(autoReportStructured.comparableFacts || []).slice(0, 8).map((item, idx) => (
                          <div key={`fact_${idx}`} className="text-sm leading-7 text-foreground/90">
                            - {item}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {(autoReportStructured.usefulCriteria || []).length ? (
                      <div className="rounded-xl border border-border/60 bg-background/35 p-4">
                        <div className="mb-2 text-sm font-semibold text-foreground">Criterios utiles</div>
                        {(autoReportStructured.usefulCriteria || []).slice(0, 8).map((item, idx) => (
                          <div key={`crit_${idx}`} className="text-sm leading-7 text-foreground/90">
                            - {item}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {(autoReportStructured.misuseRisks || []).length ? (
                      <div className="rounded-xl border border-border/60 bg-background/35 p-4">
                        <div className="mb-2 text-sm font-semibold text-foreground">Riesgos por mal uso</div>
                        {(autoReportStructured.misuseRisks || []).slice(0, 8).map((item, idx) => (
                          <div key={`risk_${idx}`} className="text-sm leading-7 text-foreground/90">
                            - {item}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {(autoReportStructured.draftParagraphs || []).length ? (
                      <div className="rounded-xl border border-border/60 bg-background/35 p-4">
                        <div className="mb-2 text-sm font-semibold text-foreground">Parrafos borrador</div>
                        {(autoReportStructured.draftParagraphs || []).slice(0, 5).map((item, idx) => (
                          <p key={`draft_${idx}`} className="mb-3 text-sm leading-7 text-foreground/90">
                            {item}
                          </p>
                        ))}
                      </div>
                    ) : null}

                    <div className="space-y-3">
                      <div className="text-sm font-semibold text-foreground">Analisis por causa priorizada</div>
                      {autoReportStructured.causeAnalyses?.map((item, idx) => {
                        const rec = recommendationByRol.get(String(item.rol || "").trim().toLowerCase())
                        return (
                          <div key={`rep_cause_${idx}`} className="rounded-xl border border-border/60 bg-background/35 p-4">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <div className="text-sm font-semibold text-foreground">
                                {item.index || idx + 1}. {item.rol}
                              </div>
                              <div className="rounded-full border border-border/50 bg-background/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                                Prioridad: {item.priority}
                              </div>
                            </div>

                            <p className="text-sm leading-7 text-foreground/90">
                              <span className="font-medium">Por que se eligio:</span> {item.whySelected}
                            </p>
                            <p className="mt-1 text-sm leading-7 text-foreground/90">
                              <span className="font-medium">Aporte a defensa:</span> {item.defenseContribution}
                            </p>

                            {(item.keyDocumentUsage || []).length ? (
                              <div className="mt-2 text-sm text-foreground/90">
                                <div className="mb-1 font-medium">Uso recomendado de documentos</div>
                                {(item.keyDocumentUsage || []).slice(0, 4).map((line, lineIdx) => (
                                  <div key={`doc_use_${idx}_${lineIdx}`} className="text-sm text-muted-foreground">
                                    - {line}
                                  </div>
                                ))}
                              </div>
                            ) : null}

                            {rec?.interestingDocuments?.length ? (
                              <div className="mt-3 flex flex-wrap gap-3 text-xs">
                                {rec.interestingDocuments.slice(0, 3).map((doc, docIdx) => (
                                  <a
                                    key={`doc_link_${idx}_${docIdx}`}
                                    href={doc.url || undefined}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 ${
                                      doc.url
                                        ? "border-blue-500/35 bg-blue-500/10 text-blue-200 hover:underline"
                                        : "border-border/50 bg-background/30 text-muted-foreground"
                                    }`}
                                  >
                                    {doc.name || doc.documentType || "Documento"}
                                    {doc.url ? <ExternalLink className="h-3.5 w-3.5" /> : null}
                                  </a>
                                ))}
                              </div>
                            ) : null}

                            {(item.criticalSimilarity || []).length ? (
                              <div className="mt-3 rounded-lg border border-border/50 bg-background/30 p-3 text-sm text-muted-foreground">
                                <div className="mb-1 font-medium text-foreground">Similitudes relevantes</div>
                                {(item.criticalSimilarity || []).slice(0, 3).map((s, sIdx) => (
                                  <div key={`sim_${idx}_${sIdx}`}>- {s}</div>
                                ))}
                              </div>
                            ) : null}

                            {(item.whereToCite || []).length ? (
                              <div className="mt-2 rounded-lg border border-border/50 bg-background/30 p-3 text-sm text-muted-foreground">
                                <div className="mb-1 font-medium text-foreground">Donde citar</div>
                                {(item.whereToCite || []).slice(0, 3).map((s, sIdx) => (
                                  <div key={`cite_${idx}_${sIdx}`}>- {s}</div>
                                ))}
                              </div>
                            ) : null}

                            <div className="mt-2 text-sm text-muted-foreground">
                              <span className="font-medium text-foreground">Riesgo/Cautela:</span> {item.risks}
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {(autoReportStructured.immediateActions || []).length ? (
                      <div className="rounded-xl border border-border/60 bg-background/35 p-4">
                        <div className="mb-2 text-sm font-semibold text-foreground">Plan de accion inmediato</div>
                        {(autoReportStructured.immediateActions || []).slice(0, 8).map((action, idx) => (
                          <div key={`act_${idx}`} className="text-sm leading-7 text-foreground/90">
                            {idx + 1}. {action}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="rounded-xl border border-border/60 bg-background/35 p-4">
                    {(autoReportText || "")
                      .split(/\n{2,}/)
                      .map((p) => p.replace(/^#+\s*/g, "").replace(/^[-*]\s+/gm, "").trim())
                      .filter(Boolean)
                      .slice(0, 18)
                      .map((paragraph, idx) => (
                        <p key={`p_${idx}`} className="mb-3 text-sm leading-7 text-foreground/90">
                          {paragraph}
                        </p>
                      ))}
                  </div>
                )}

                {reportComparison?.comparison ? (
                  <div className="rounded-xl border border-border/60 bg-background/35 p-4 text-sm text-muted-foreground">
                    <div className="mb-1 font-semibold text-foreground">Comparacion con version previa</div>
                    <div>Similitud: {(reportComparison.comparison.similarity * 100).toFixed(1)}%</div>
                    <div>Lineas agregadas: {reportComparison.comparison.addedCount}</div>
                    <div>Lineas removidas: {reportComparison.comparison.removedCount}</div>
                  </div>
                ) : null}

                <div className="text-xs text-muted-foreground">
                  Guardado automaticamente en Studio &gt; Notas
                  {autoReportNoteId ? ` (id: ${autoReportNoteId})` : ""}.
                </div>
              </div>
            ) : null}
          </div>
        </Card>
        </div>
      )}

      <Dialog open={!!pendingCauseDialog} onOpenChange={(open) => !open && setPendingCauseDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Descartar causa</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Explica por que esta causa no debe seguir en el set priorizado. Este comentario quedara registrado para el run.
            </p>
            <Textarea
              value={pendingCauseComment}
              onChange={(event) => setPendingCauseComment(event.target.value)}
              placeholder="Ej: baja similitud factica, sustento debil o riesgo de analogia incorrecta"
              className="min-h-[120px]"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPendingCauseDialog(null)} disabled={hitlBusy}>
                Cancelar
              </Button>
              <Button onClick={() => confirmCauseDialog().catch(() => null)} disabled={hitlBusy || !pendingCauseComment.trim()}>
                {hitlBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar descarte"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingFindingDialog} onOpenChange={(open) => !open && setPendingFindingDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Descartar hallazgo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Agrega contexto opcional para explicar por que el hallazgo no es util o debe omitirse del escrito.
            </p>
            <Textarea
              value={pendingFindingComment}
              onChange={(event) => setPendingFindingComment(event.target.value)}
              placeholder="Opcional: por que este hallazgo no aporta o puede inducir a error"
              className="min-h-[120px]"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPendingFindingDialog(null)} disabled={hitlBusy}>
                Cancelar
              </Button>
              <Button onClick={() => confirmFindingDialog().catch(() => null)} disabled={hitlBusy}>
                {hitlBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar decision"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
