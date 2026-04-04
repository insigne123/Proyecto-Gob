import { redirect } from "next/navigation"

export default async function LegacyWorkspaceWatchlistsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  await params
  redirect(`/excel`)
}
