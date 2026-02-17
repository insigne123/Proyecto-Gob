import { redirect } from "next/navigation"

export default async function LegacyWorkspaceWatchlistsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  redirect(`/excel/${workspaceId}`)
}
