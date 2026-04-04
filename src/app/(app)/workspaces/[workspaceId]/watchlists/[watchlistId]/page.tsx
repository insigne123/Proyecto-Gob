import { redirect } from "next/navigation"

export default async function LegacyWorkspaceWatchlistPage({
  params,
}: {
  params: Promise<{ workspaceId: string; watchlistId: string }>
}) {
  await params
  redirect(`/excel`)
}
