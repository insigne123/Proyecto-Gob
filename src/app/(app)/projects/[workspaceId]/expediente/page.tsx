import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { ArrowLeft } from "lucide-react"

import ExpedienteClient from "@/app/(app)/workspaces/[workspaceId]/expediente/expediente-client"

export default async function ProjectMetadataPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect(`/login?next=${encodeURIComponent(`/projects/${workspaceId}/expediente`)}`)

  const { data: workspace } = await supabase
    .from("gob_workspaces")
    .select("id,title,description,status,allowed_domains,created_at,updated_at")
    .eq("id", workspaceId)
    .maybeSingle()

  if (!workspace) notFound()

  const { data: member } = await supabase
    .from("gob_workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!member) notFound()

  const { data: profile } = await supabase
    .from("gob_workspace_profiles")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  const { data: parties } = await supabase
    .from("gob_workspace_parties")
    .select("id,role,name,entity_type,contact_email,contact_phone,notes,created_at,updated_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(200)

  const { data: events } = await supabase
    .from("gob_workspace_timeline_events")
    .select("id,occurred_at,kind,title,description,created_at,updated_at")
    .eq("workspace_id", workspaceId)
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(250)

  const eventIds = (events ?? []).map((e) => String(e.id))
  const { data: links } = eventIds.length
    ? await supabase
        .from("gob_workspace_timeline_event_snapshots")
        .select("event_id,snapshot_id")
        .in("event_id", eventIds)
    : { data: [] as any[] }

  const { data: members } = await supabase
    .from("gob_workspace_members")
    .select("user_id,role,created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true })
    .limit(200)

  const { data: invites } =
    member.role === "admin"
      ? await supabase
          .from("gob_workspace_invites")
          .select("id,email,role,token,created_at,expires_at,accepted_at,accepted_by")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(100)
      : { data: [] as any[] }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6">
        <Link
          href={`/projects/${workspaceId}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al cuaderno
        </Link>
      </div>

      <ExpedienteClient
        workspace={{
          id: workspace.id,
          title: workspace.title,
          description: workspace.description,
          status: workspace.status,
          allowedDomains: Array.isArray((workspace as any).allowed_domains)
            ? ((workspace as any).allowed_domains as string[])
            : [],
          createdAt: workspace.created_at ?? null,
          updatedAt: workspace.updated_at ?? null,
        }}
        memberRole={member.role}
        initial={{
          profile,
          parties: parties ?? [],
          events: events ?? [],
          eventSnapshotLinks: Array.isArray(links) ? links : [],
          members: members ?? [],
          invites: invites ?? [],
        }}
      />
    </div>
  )
}
