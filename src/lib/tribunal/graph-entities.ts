export type LegalGraphEntityType =
  | "norma_legal"
  | "autoridad"
  | "materia"
  | "resultado"
  | "rol_causa"

export type LegalGraphEntity = {
  entityType: LegalGraphEntityType
  entityValue: string
  normalizedValue: string
  confidence: number
  metadata?: Record<string, unknown>
}

function normalize(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function uniqueEntities(values: LegalGraphEntity[]) {
  const seen = new Set<string>()
  const out: LegalGraphEntity[] = []
  for (const value of values) {
    const key = `${value.entityType}|${value.normalizedValue}`
    if (!value.normalizedValue || seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function matchAll(text: string, regex: RegExp) {
  return Array.from(text.matchAll(regex))
}

export function extractLegalGraphEntities(params: { text: string; rol?: string | null }) {
  const text = String(params.text || "")
  const normalized = normalize(text)
  const entities: LegalGraphEntity[] = []

  for (const match of matchAll(text, /\b(?:art\.?|articulo)\s*\d+[a-z]?\b/gi)) {
    const entityValue = String(match[0] || "").trim()
    entities.push({
      entityType: "norma_legal",
      entityValue,
      normalizedValue: normalize(entityValue),
      confidence: 0.82,
    })
  }

  const lawSignals = ["ley 19.300", "lbgma", "ley 20417", "reglamento del seia", "ds 40"]
  for (const signal of lawSignals) {
    if (!normalized.includes(normalize(signal))) continue
    entities.push({
      entityType: "norma_legal",
      entityValue: signal.toUpperCase(),
      normalizedValue: normalize(signal),
      confidence: 0.88,
    })
  }

  const authoritySignals = [
    "SEA",
    "SMA",
    "Comite de Ministros",
    "Servicio de Evaluacion Ambiental",
    "Superintendencia del Medio Ambiente",
    "Tribunal Ambiental",
  ]
  for (const signal of authoritySignals) {
    if (!normalized.includes(normalize(signal))) continue
    entities.push({
      entityType: "autoridad",
      entityValue: signal,
      normalizedValue: normalize(signal),
      confidence: 0.9,
    })
  }

  const topicSignals = [
    "participacion ciudadana",
    "linea de base",
    "impactos acumulativos",
    "consulta indigena",
    "motivacion de la rca",
    "trazabilidad",
    "seguimiento ambiental",
    "pertinencia",
  ]
  for (const signal of topicSignals) {
    if (!normalized.includes(normalize(signal))) continue
    entities.push({
      entityType: "materia",
      entityValue: signal,
      normalizedValue: normalize(signal),
      confidence: 0.76,
    })
  }

  if (/\bacog[eaio]?\b/i.test(text)) {
    entities.push({
      entityType: "resultado",
      entityValue: "acogida",
      normalizedValue: "acogida",
      confidence: 0.8,
    })
  }
  if (/\brechaz[ao]?\b/i.test(text)) {
    entities.push({
      entityType: "resultado",
      entityValue: "rechazada",
      normalizedValue: "rechazada",
      confidence: 0.8,
    })
  }

  const rol = String(params.rol || "").trim().toUpperCase()
  if (rol) {
    entities.push({
      entityType: "rol_causa",
      entityValue: rol,
      normalizedValue: normalize(rol),
      confidence: 1,
    })
  }

  return uniqueEntities(entities)
}

export function scoreCauseSimilarity(params: {
  left: { normas?: string[]; autoridades?: string[]; materias?: string[]; resultado?: string | null }
  right: { normas?: string[]; autoridades?: string[]; materias?: string[]; resultado?: string | null }
}) {
  const sharedNormas = intersect(params.left.normas || [], params.right.normas || [])
  const sharedAutoridades = intersect(params.left.autoridades || [], params.right.autoridades || [])
  const sharedMaterias = intersect(params.left.materias || [], params.right.materias || [])
  const sameOutcome =
    params.left.resultado && params.right.resultado
      ? normalize(params.left.resultado) === normalize(params.right.resultado)
      : false

  const score = Math.min(
    1,
    sharedNormas.length * 0.28 +
      sharedAutoridades.length * 0.24 +
      sharedMaterias.length * 0.18 +
      (sameOutcome ? 0.12 : 0)
  )

  return {
    similarityScore: Number(score.toFixed(4)),
    sharedFactors: {
      normas: sharedNormas,
      autoridades: sharedAutoridades,
      materias: sharedMaterias,
      sameOutcome,
    },
  }
}

function intersect(left: string[], right: string[]) {
  const rightSet = new Set(right.map((item) => normalize(item)).filter(Boolean))
  const out: string[] = []
  for (const value of left) {
    const normalized = normalize(value)
    if (!normalized || !rightSet.has(normalized)) continue
    if (!out.some((item) => normalize(item) === normalized)) out.push(value)
  }
  return out
}
