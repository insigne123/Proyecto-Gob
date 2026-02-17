export async function getAccessibleWorkspaceIdsForUser(params: {
  supabase: any
  userId: string
  requiredWorkspaceId?: string | null
}): Promise<string[]> {
  const { supabase, userId, requiredWorkspaceId } = params

  const { data: memberships, error } = await supabase
    .from("gob_workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)

  if (error) throw new Error(error.message)

  const ids = Array.from(
    new Set<string>(
      (memberships || [])
        .map((m: any) => String(m.workspace_id || ""))
        .filter((id: string) => !!id)
    )
  )

  if (requiredWorkspaceId) {
    const required = String(requiredWorkspaceId)
    if (required && !ids.includes(required)) {
      throw new Error("Forbidden")
    }
  }

  return ids
}
