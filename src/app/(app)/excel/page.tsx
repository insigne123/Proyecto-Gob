import { redirect } from "next/navigation"

import { WatchlistsManager } from "@/components/watchlists/watchlists-manager"
import { createClient } from "@/lib/supabase/server"
import {
  ensureExcelMonitorWorkspaceForUser,
  pauseLegacyUserWatchlists,
} from "@/lib/watchlists/monitor-workspace"

export default async function ExcelModulePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const monitorWorkspace = await ensureExcelMonitorWorkspaceForUser(user.id)
  await pauseLegacyUserWatchlists({
    userId: user.id,
    monitorWorkspaceId: monitorWorkspace.id,
  }).catch(() => null)

  return (
    <WatchlistsManager
      workspaceId={monitorWorkspace.id}
      workspaceTitle="Monitores de hojas de calculo"
    />
  )
}
