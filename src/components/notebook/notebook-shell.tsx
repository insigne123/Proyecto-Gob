"use client"

import { useMemo, useState } from "react"

import { Topbar } from "@/components/notebook/topbar"
import { SourcesPanel } from "@/components/notebook/panels/sources-panel"
import { ChatPanel } from "@/components/notebook/panels/chat-panel"
import { StudioPanel } from "@/components/notebook/panels/studio-panel"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export type NotebookWorkspace = {
  id: string
  title: string
  description: string | null
  status: string | null
}

export function NotebookShell({ workspace }: { workspace: NotebookWorkspace }) {
  const [activeMobileTab, setActiveMobileTab] = useState<"sources" | "chat" | "studio">(
    "chat"
  )

  const title = useMemo(() => workspace.title || "Expediente", [workspace.title])

  return (
    <div className="min-h-svh">
      <Topbar workspaceId={workspace.id} title={title} />

      <div className="mx-auto w-full max-w-[1800px] px-3 pb-6 pt-4 md:px-4">
        <div className="hidden gap-4 lg:grid lg:grid-cols-[360px_minmax(0,1fr)_360px]">
          <SourcesPanel workspaceId={workspace.id} />
          <ChatPanel workspaceId={workspace.id} />
          <StudioPanel workspaceId={workspace.id} />
        </div>

        <div className="lg:hidden">
          <Tabs value={activeMobileTab} onValueChange={(v) => setActiveMobileTab(v as any)}>
            <TabsList className="grid w-full grid-cols-3 bg-card/60">
              <TabsTrigger value="sources">Fuentes</TabsTrigger>
              <TabsTrigger value="chat">Chat</TabsTrigger>
              <TabsTrigger value="studio">Studio</TabsTrigger>
            </TabsList>
            <TabsContent value="sources" className="mt-4">
              <SourcesPanel workspaceId={workspace.id} />
            </TabsContent>
            <TabsContent value="chat" className="mt-4">
              <ChatPanel workspaceId={workspace.id} />
            </TabsContent>
            <TabsContent value="studio" className="mt-4">
              <StudioPanel workspaceId={workspace.id} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
