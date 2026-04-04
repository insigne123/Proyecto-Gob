import { redirect } from "next/navigation"

export default async function LegacyWorkspaceWatchlistRunPage({
  params,
}: {
  params: Promise<{ workspaceId: string; watchlistId: string; runId: string }>
}) {
  await params
  redirect(`/excel`)
}
