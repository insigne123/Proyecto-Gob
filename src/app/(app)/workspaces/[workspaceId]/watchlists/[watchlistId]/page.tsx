import { redirect } from "next/navigation"

export default async function LegacyWorkspaceWatchlistPage({
  params,
}: {
  params: Promise<{ workspaceId: string; watchlistId: string }>
}) {
  const { workspaceId, watchlistId } = await params
  redirect(`/excel/${workspaceId}/${watchlistId}`)
}
