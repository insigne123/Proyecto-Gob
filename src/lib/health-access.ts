function trimText(value: unknown) {
  return String(value || "").trim()
}

export function requestHasHealthToken(request: Request) {
  const expected = trimText(process.env.HEALTHCHECK_TOKEN)
  if (!expected) return false

  const headerToken = trimText(request.headers.get("x-health-token"))
  const authHeader = trimText(request.headers.get("authorization"))
  const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
    ? trimText(authHeader.slice(7))
    : ""

  return headerToken === expected || bearerToken === expected
}
