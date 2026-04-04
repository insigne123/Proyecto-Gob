"use client"

import { useEffect, useMemo, useState } from "react"

import { Topbar } from "@/components/notebook/topbar"
import { ChatPanel } from "@/components/notebook/panels/chat-panel"
import { DocumentReviewPanel } from "@/components/notebook/panels/document-review-panel"
import { ProfessionalReviewPanel } from "@/components/notebook/panels/professional-review-panel"
import { RetrievalTracesPanel } from "@/components/notebook/panels/retrieval-traces-panel"
import { SourcesPanel } from "@/components/notebook/panels/sources-panel"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export type NotebookWorkspace = {
  id: string
  title: string
  description: string | null
  status: string | null
}

const NOTEBOOK_TAB_META = {
  sources: {
    label: "Fuentes",
    description: "Carga y administra documentos del proyecto y del marco teorico para que la IA pueda citarlos.",
  },
  assistant: {
    label: "Asistente experto",
    description: "Haz preguntas sobre la causa, el marco teorico, los documentos y la estrategia de defensa con citas verificables.",
  },
  review: {
    label: "Revision guiada",
    description: "Revisa el escrito paso a paso, con observaciones y sugerencias accionables sobre el documento.",
  },
  "professional-review": {
    label: "Dictamen profesional",
    description: "Obtén una evaluacion mas profunda sobre riesgos, fortalezas, estrategia y calidad del escrito.",
  },
  traces: {
    label: "Trazas RAG",
    description: "Mira como recupero evidencia el sistema, que fuentes uso y que consultas lanzo para responder.",
  },
} as const

export function NotebookShell({ workspace }: { workspace: NotebookWorkspace }) {
  const title = useMemo(() => workspace.title || "Proyecto", [workspace.title])
  const [tab, setTab] = useState<"sources" | "assistant" | "review" | "professional-review" | "traces">("assistant")

  useEffect(() => {
    const onOpenSources = () => setTab("sources")
    const onOpenAssistant = () => setTab("assistant")
    const onOpenReview = () => setTab("review")
    const onOpenProfessionalReview = () => setTab("professional-review")
    const onOpenTraces = () => setTab("traces")
    window.addEventListener("ca:open-sources", onOpenSources as any)
    window.addEventListener("ca:open-assistant", onOpenAssistant as any)
    window.addEventListener("ca:open-review", onOpenReview as any)
    window.addEventListener("ca:open-professional-review", onOpenProfessionalReview as any)
    window.addEventListener("ca:open-traces", onOpenTraces as any)
    return () => {
      window.removeEventListener("ca:open-sources", onOpenSources as any)
      window.removeEventListener("ca:open-assistant", onOpenAssistant as any)
      window.removeEventListener("ca:open-review", onOpenReview as any)
      window.removeEventListener("ca:open-professional-review", onOpenProfessionalReview as any)
      window.removeEventListener("ca:open-traces", onOpenTraces as any)
    }
  }, [])

  return (
    <div className="min-h-svh">
      <Topbar workspaceId={workspace.id} title={title} />

      <div className="mx-auto w-full max-w-[1800px] px-3 pb-6 pt-4 md:px-4">
        <Tabs
          value={tab}
          onValueChange={(value) =>
            setTab(
              value as
                | "sources"
                | "assistant"
                | "review"
                | "professional-review"
                | "traces"
            )
          }
        >
          <TabsList className="mb-3 flex h-auto w-full flex-wrap justify-start gap-2 bg-transparent p-0">
            <TabsTrigger value="sources" title={NOTEBOOK_TAB_META.sources.description} className="rounded-full border border-border/60 bg-card/60 px-4">
              {NOTEBOOK_TAB_META.sources.label}
            </TabsTrigger>
            <TabsTrigger value="assistant" title={NOTEBOOK_TAB_META.assistant.description} className="rounded-full border border-border/60 bg-card/60 px-4">
              {NOTEBOOK_TAB_META.assistant.label}
            </TabsTrigger>
            <TabsTrigger value="review" title={NOTEBOOK_TAB_META.review.description} className="rounded-full border border-border/60 bg-card/60 px-4">
              {NOTEBOOK_TAB_META.review.label}
            </TabsTrigger>
            <TabsTrigger
              value="professional-review"
              title={NOTEBOOK_TAB_META["professional-review"].description}
              className="rounded-full border border-border/60 bg-card/60 px-4"
            >
              {NOTEBOOK_TAB_META["professional-review"].label}
            </TabsTrigger>
            <TabsTrigger value="traces" title={NOTEBOOK_TAB_META.traces.description} className="rounded-full border border-border/60 bg-card/60 px-4">
              {NOTEBOOK_TAB_META.traces.label}
            </TabsTrigger>
          </TabsList>

          <div className="mb-3 rounded-2xl border border-border/60 bg-card/45 px-4 py-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{NOTEBOOK_TAB_META[tab].label}:</span> {NOTEBOOK_TAB_META[tab].description}
          </div>

          <TabsContent value="sources" className="mt-0">
            <SourcesPanel workspaceId={workspace.id} />
          </TabsContent>

          <TabsContent value="assistant" className="mt-0">
            <ChatPanel workspaceId={workspace.id} />
          </TabsContent>

          <TabsContent value="review" className="mt-0">
            <DocumentReviewPanel workspaceId={workspace.id} />
          </TabsContent>

          <TabsContent value="professional-review" className="mt-0">
            <ProfessionalReviewPanel workspaceId={workspace.id} />
          </TabsContent>

          <TabsContent value="traces" className="mt-0">
            <RetrievalTracesPanel workspaceId={workspace.id} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
