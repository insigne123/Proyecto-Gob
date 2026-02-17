import { redirect } from "next/navigation"

export default async function LegacyExpedientePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  redirect(`/projects/${workspaceId}/expediente`)
}
