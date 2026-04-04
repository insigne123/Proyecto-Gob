export const EXCEL_MONITOR_WORKSPACE_MARKER_PREFIX = "[system] excel-monitor-v1:user="

export function excelMonitorWorkspaceMarkerForUser(userId: string) {
  return `${EXCEL_MONITOR_WORKSPACE_MARKER_PREFIX}${userId}`
}

export function isExcelMonitorWorkspaceDescription(description: unknown) {
  return (
    typeof description === "string" &&
    description.startsWith(EXCEL_MONITOR_WORKSPACE_MARKER_PREFIX)
  )
}
