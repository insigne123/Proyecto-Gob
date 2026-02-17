import { redirect } from "next/navigation"

export default async function LegacyWorkspaceReportPage({
  params,
}: {
  params: Promise<{ workspaceId: string; reportId: string }>
}) {
  const { workspaceId, reportId } = await params
  redirect(`/projects/${workspaceId}/reports/${reportId}`)
}
