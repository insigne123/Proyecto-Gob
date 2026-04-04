import type { RagQueryIntent } from "@/lib/rag/query-intent"

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function uniqueStrings(values: unknown[], max = 8) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = String(value ?? "").replace(/\s+/g, " ").trim()
    if (!clean) continue
    const key = normalize(clean)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(clean)
    if (out.length >= max) break
  }
  return out
}

export function buildAgenticCorrectiveQueries(params: {
  question: string
  intent: RagQueryIntent
  missingRoles?: string[]
  graphRelatedRoles?: string[]
  graphRelatedQueries?: string[]
  agentPlanQueries?: string[]
  evidenceQualityQueries?: string[]
  triedQueries?: string[]
  toolOrder?: string[]
  maxQueries?: number
}) {
  const maxQueries = Math.max(1, Math.min(8, Number(params.maxQueries || 4)))
  const tried = new Set((params.triedQueries || []).map((item) => normalize(item)).filter(Boolean))

  const missingRoleQueries = (params.missingRoles || []).flatMap((role) => {
    const cleanRole = String(role || "").trim()
    if (!cleanRole) return [] as string[]
    const base = `${params.question} ${cleanRole}`
    const graphAnchored = (params.graphRelatedRoles || [])
      .slice(0, 2)
      .map((rol) => `${rol} ${cleanRole} ${params.question}`)
    return [base, ...graphAnchored]
  })

  const graphPriorityQueries = params.intent.needsGraphLookup
    ? uniqueStrings([
        ...(params.graphRelatedQueries || []),
        ...(params.graphRelatedRoles || []).slice(0, 2).map((rol) => `${rol} ${params.question}`),
      ], 4)
    : []

  const factsQueries = params.intent.needsFactsFirst
    ? uniqueStrings([
        `${params.question} resultado final`,
        `${params.question} hechos acreditados`,
      ], 2)
    : []

  const priorityPools = [
    ...(Array.isArray(params.toolOrder) && params.toolOrder.includes("graph") ? [graphPriorityQueries] : []),
    missingRoleQueries,
    params.evidenceQualityQueries || [],
    params.agentPlanQueries || [],
    ...(Array.isArray(params.toolOrder) && params.toolOrder.includes("facts") ? [factsQueries] : []),
  ]

  const queries = uniqueStrings(priorityPools.flat(), maxQueries).filter((query) => !tried.has(normalize(query))).slice(0, maxQueries)

  const rationale = uniqueStrings([
    (params.missingRoles || []).length ? `Cubrir roles faltantes: ${(params.missingRoles || []).join(", ")}.` : "",
    params.intent.needsGraphLookup && (params.graphRelatedRoles || []).length
      ? `Reusar causas relacionadas del grafo: ${(params.graphRelatedRoles || []).slice(0, 3).join(", ")}.`
      : "",
    params.intent.needsFactsFirst ? "Forzar una vuelta adicional centrada en hechos y resultado." : "",
  ], 4)

  return {
    queries,
    rationale,
  }
}
