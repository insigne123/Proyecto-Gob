export type TribunalDocumentRole = "reclamacion" | "informe" | "sentencia" | "documento"

type TribunalDocumentRoleInput = {
  documentType?: string | null
  name?: string | null
  title?: string | null
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function hasAnyPattern(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text))
}

function detectRoleFromText(value: string): TribunalDocumentRole {
  if (!value) return "documento"

  const reclamacionPatterns = [
    /\bescrito\s+inicial\b/,
    /\brecurso\s+de\s+reclamacion\b/,
    /\breclamacion(?:es)?\b/,
    /\bdemanda\b/,
    /\bdesistim\w*\b/,
  ]
  if (hasAnyPattern(value, reclamacionPatterns)) return "reclamacion"

  const informePatterns = [
    /\bevacua(?:\s+el)?\s+informe\b/,
    /\bacompan\w*\s+informe\b/,
    /\bpor\s+evacuad\w*\s+informe\b/,
    /\bse\s+tenga\s+presente\b.*\binforme\b/,
    /\binforme\s+en\s+derecho\b/,
    /\bevacua\s+traslado\b/,
    /\binforme\b/,
  ]
  if (hasAnyPattern(value, informePatterns)) return "informe"

  const sentenciaPatterns = [
    /\bsentencia(?:\s+definitiva)?\b/,
    /\bfallo\b/,
    /\bacoge\s+el\s+recurso\b/,
    /\brechaza\s+el\s+recurso\b/,
  ]
  const looksLikeSentenciaCertificate =
    /\bcertific\w*\b/.test(value) && /\bsentencia\b/.test(value) && !/\bresolucion\b/.test(value)
  const looksLikeSentenciaNotice =
    /\bnotific\w*\b/.test(value) && /\bsentencia\b/.test(value) && !/\bresolucion\b/.test(value)
  const looksLikeSentenceResolution =
    /\bresolucion\b/.test(value) &&
    (/(\bsentencia\b|\bfallo\b|\bacoge\b|\brechaza\b)/.test(value)) &&
    !/\bcertific\w*\b/.test(value) &&
    !/\bnotific\w*\b/.test(value)
  if (
    !looksLikeSentenciaCertificate &&
    !looksLikeSentenciaNotice &&
    (hasAnyPattern(value, sentenciaPatterns) || looksLikeSentenceResolution)
  ) {
    return "sentencia"
  }

  return "documento"
}

export function classifyTribunalDocumentRole(input: TribunalDocumentRoleInput): TribunalDocumentRole {
  const headlineText = normalizeText(`${input.title || ""} ${input.documentType || ""}`)
  const roleFromHeadline = detectRoleFromText(headlineText)
  if (roleFromHeadline !== "documento") return roleFromHeadline

  const auxText = normalizeText(input.name || "")
  const roleFromAux = detectRoleFromText(auxText)
  if (roleFromAux !== "documento") return roleFromAux

  return "documento"
}

export function isStrictTribunalKeyDocument(input: TribunalDocumentRoleInput) {
  return classifyTribunalDocumentRole(input) !== "documento"
}
