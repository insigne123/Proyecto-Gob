export type GraphOverlapEntity = {
  entityType: string
  entityValue: string
  normalizedValue?: string | null
}

export type GraphOverlapSignal = {
  score: number
  matchedValues: string[]
  matchedEntityTypes: string[]
  similarityScore: number | null
  relatedRoles: string[]
}

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeEntityType(value: unknown) {
  return normalize(value).replace(/[\s.-]+/g, "_")
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

export function graphEntityWeight(entityType: string) {
  const normalized = normalizeEntityType(entityType)
  if (normalized === "norma_legal") return 0.34
  if (normalized === "autoridad") return 0.24
  if (normalized === "materia") return 0.18
  if (normalized === "resultado") return 0.12
  if (normalized === "rol_causa") return 0.1
  return 0.08
}

export function graphEntityTypeLabel(entityType: string) {
  const normalized = normalizeEntityType(entityType)
  if (normalized === "norma_legal") return "norma"
  if (normalized === "autoridad") return "autoridad"
  if (normalized === "materia") return "materia"
  if (normalized === "resultado") return "resultado"
  if (normalized === "rol_causa") return "rol"
  return normalized || "otro"
}

export function buildGraphOverlapSignal(params: {
  matchedEntities?: GraphOverlapEntity[]
  similarityScore?: number | null
  relatedRoles?: string[]
}) : GraphOverlapSignal {
  const matchedEntities = Array.isArray(params.matchedEntities) ? params.matchedEntities : []
  const deduped = new Map<string, GraphOverlapEntity>()
  for (const entity of matchedEntities) {
    const key = `${normalize(entity.entityType)}|${normalize(entity.normalizedValue || entity.entityValue)}`
    if (!key || deduped.has(key)) continue
    deduped.set(key, entity)
  }

  const entityScore = Array.from(deduped.values()).reduce((acc, entity) => acc + graphEntityWeight(entity.entityType), 0)
  const similarityScore =
    typeof params.similarityScore === "number" && Number.isFinite(params.similarityScore)
      ? Math.max(0, Math.min(1, params.similarityScore))
      : null
  const total = Math.min(1.8, entityScore + (similarityScore ? similarityScore * 0.75 : 0))

  return {
    score: Number(total.toFixed(4)),
    matchedValues: uniqueStrings(Array.from(deduped.values()).map((entity) => entity.entityValue), 5),
    matchedEntityTypes: uniqueStrings(Array.from(deduped.values()).map((entity) => graphEntityTypeLabel(entity.entityType)), 4),
    similarityScore: similarityScore === null ? null : Number(similarityScore.toFixed(4)),
    relatedRoles: uniqueStrings(params.relatedRoles || [], 4),
  }
}
