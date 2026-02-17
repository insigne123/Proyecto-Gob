import { redirect } from "next/navigation"

export default async function LegacyWorkspaceWatchlistRunPage({
  params,
}: {
  params: Promise<{ workspaceId: string; watchlistId: string; runId: string }>
}) {
  const { workspaceId, watchlistId, runId } = await params
  redirect(`/excel/${workspaceId}/${watchlistId}/runs/${runId}`)
}
