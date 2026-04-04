import type { EvidenceChunk } from "@/lib/rag/strict-answer"

export type FactualAnswerKind =
  | "fojas"
  | "claimant"
  | "existence"
  | "resolution"
  | "date"
  | "norms"
  | "authority"
  | "outcome"
  | "holding"
  | "none"

export type FactualAnswerCitation = {
  chunkId: string
  quote: string
  paragraph: number | null
}

export type DeterministicFactualAnswer = {
  applied: boolean
  kind: FactualAnswerKind
  answer: string
  citations: FactualAnswerCitation[]
}

function normalize(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function extractRoleToken(question: string) {
  const match = String(question || "").match(/\bR-\d{1,5}-\d{4}\b/i)
  return match ? String(match[0]).toUpperCase() : ""
}

function inferExplicitDocType(question: string) {
  const q = normalize(question)
  if (q.includes("sentencia") || q.includes("fallo")) return "sentencia"
  if (q.includes("informe") || q.includes("evacua")) return "informe"
  if (
    q.includes("reclamacion") ||
    q.includes("reclamante") ||
    q.includes("escrito inicial") ||
    q.includes("desistim")
  ) {
    return "reclamacion"
  }
  return null
}

function inferFactualAnswerKind(question: string): FactualAnswerKind {
  const q = normalize(question)
  if (q.includes("foja")) return "fojas"
  if (q.includes("reclamante") || q.includes("quien figura") || q.includes("quien aparece")) {
    return "claimant"
  }
  if (q.includes("norma") || q.includes("articulo") || q.includes("ley")) return "norms"
  if (q.includes("autoridad") || q.includes("sea") || q.includes("sma") || q.includes("comite de ministros")) return "authority"
  if (q.includes("resultado") || q.includes("como termino") || q.includes("se acogio") || q.includes("se rechazo")) return "outcome"
  if (q.includes("criterio") || q.includes("conclusion") || q.includes("holding")) return "holding"
  if (q.includes("resolucion") || q.includes("se resuelve") || q.includes("que resolucion")) {
    return "resolution"
  }
  if (q.includes("fecha") || q.includes("cuando")) return "date"
  if (q.includes("existe") || q.includes("hay")) return "existence"
  return "none"
}

function chunkMatchesQuestion(chunk: EvidenceChunk, params: { question: string; explicitDocType: string | null; roleToken: string }) {
  const hay = normalize(
    [chunk.content, chunk.section, chunk.documentTitle, chunk.documentType, chunk.docRole]
      .filter(Boolean)
      .join(" ")
  )
  if (params.roleToken) {
    const roleNeedle = normalize(params.roleToken)
    if (roleNeedle && !hay.includes(roleNeedle)) return false
  }
  if (params.explicitDocType) {
    const docNeedle = normalize(params.explicitDocType)
    if (docNeedle && !hay.includes(docNeedle)) return false
  }
  return true
}

function firstMatchingChunk(evidence: EvidenceChunk[], question: string) {
  const roleToken = extractRoleToken(question)
  const explicitDocType = inferExplicitDocType(question)
  return evidence.find((chunk) => chunkMatchesQuestion(chunk, { question, explicitDocType, roleToken })) || evidence[0] || null
}

function sentenceFromIndex(content: string, index: number, maxChars = 220) {
  const clean = String(content || "").replace(/\s+/g, " ")
  if (!clean) return ""
  const safeIndex = Math.max(0, Math.min(clean.length - 1, index))
  const before = clean.lastIndexOf(". ", safeIndex)
  const after = clean.indexOf(". ", safeIndex)
  const start = before >= 0 ? before + 2 : 0
  const end = after >= 0 ? after + 1 : clean.length
  const sentence = clean.slice(start, end).trim()
  if (!sentence) return clean.slice(0, maxChars).trim()
  return sentence.length > maxChars ? `${sentence.slice(0, maxChars).trim()}...` : sentence
}

function fallbackQuote(content: string, maxChars = 220) {
  const clean = String(content || "").replace(/\s+/g, " ").trim()
  if (!clean) return ""
  const firstSentence = clean.split(/(?<=[\.!?;])\s+/).find((item) => item.trim().length >= 18) || clean
  return firstSentence.length > maxChars ? `${firstSentence.slice(0, maxChars).trim()}...` : firstSentence
}

function quoteAroundRegex(content: string, regex: RegExp, maxChars = 220) {
  const match = regex.exec(content)
  if (!match || typeof match.index !== "number") return ""
  return sentenceFromIndex(content, match.index, maxChars)
}

function extractFojasAnswer(question: string, evidence: EvidenceChunk[]): DeterministicFactualAnswer {
  const roleToken = extractRoleToken(question)
  const explicitDocType = inferExplicitDocType(question)
  const normalizedQuestion = normalize(question)
  const requireDesist = normalizedQuestion.includes("desist")
  const seen = new Set<string>()
  const citations: FactualAnswerCitation[] = []
  const numbers: string[] = []

  for (const chunk of evidence) {
    if (!chunkMatchesQuestion(chunk, { question, explicitDocType, roleToken })) continue
    if (requireDesist) {
      const context = normalize([chunk.content, chunk.section, chunk.documentTitle].filter(Boolean).join(" "))
      if (!context.includes("desist")) continue
    }
    for (const match of String(chunk.content || "").matchAll(/fojas?\s+(\d{1,6})/gi)) {
      const number = String(match[1] || "").trim()
      if (!number || seen.has(number)) continue
      seen.add(number)
      numbers.push(number)
      citations.push({
        chunkId: chunk.chunkId,
        quote: quoteAroundRegex(String(chunk.content || ""), new RegExp(`fojas?\\s+${number}`, "i")) || String(match[0] || "").trim(),
        paragraph: 0,
      })
      if (numbers.length >= 4) break
    }
    if (numbers.length >= 4) break
  }

  if (!numbers.length) {
    return { applied: false, kind: "fojas", answer: "", citations: [] }
  }

  const formatted =
    numbers.length === 1
      ? numbers[0]
      : numbers.length === 2
        ? `${numbers[0]} y ${numbers[1]}`
        : `${numbers.slice(0, -1).join(", ")} y ${numbers[numbers.length - 1]}`

  return {
    applied: true,
    kind: "fojas",
    answer: `En ${roleToken || "el documento consultado"}, se mencionan las fojas ${formatted}.`,
    citations: citations.slice(0, 3),
  }
}

function extractClaimantAnswer(question: string, evidence: EvidenceChunk[]): DeterministicFactualAnswer {
  const roleToken = extractRoleToken(question)
  const explicitDocType = inferExplicitDocType(question)
  const patterns = [
    /RECLAMANTE\s*:\s*([^\n]+)/i,
    /en representaci[oó]n de la reclamante,\s*([^,.;\n]+)/i,
    /la reclamante,\s*([^,.;\n]+)/i,
    /parte reclamante[:\s]+([^,.;\n]+)/i,
    /reclamante[:\s]+([^,.;\n]+)/i,
  ]

  for (const chunk of evidence) {
    if (!chunkMatchesQuestion(chunk, { question, explicitDocType, roleToken })) continue
    const content = String(chunk.content || "")
    for (const pattern of patterns) {
      const match = content.match(pattern)
      const claimant = String(match?.[1] || "")
        .replace(/\s+/g, " ")
        .replace(/\bMATERIA\b.*$/i, "")
        .replace(/\bRUT\b.*$/i, "")
        .trim()
      if (!claimant || claimant.length < 3) continue
      const quote = quoteAroundRegex(content, pattern) || fallbackQuote(content)
      if (!quote) continue
      return {
        applied: true,
        kind: "claimant",
        answer: `En ${roleToken || "la causa consultada"}, figura como reclamante ${claimant}.`,
        citations: [{ chunkId: chunk.chunkId, quote, paragraph: 0 }],
      }
    }
  }

  return { applied: false, kind: "claimant", answer: "", citations: [] }
}

function extractResolutionAnswer(question: string, evidence: EvidenceChunk[]): DeterministicFactualAnswer {
  const roleToken = extractRoleToken(question)
  const explicitDocType = inferExplicitDocType(question)
  const patterns = [
    /a lo principal,\s*([^.;\n]+)/i,
    /se resuelve[:\s]+([^.;\n]+)/i,
    /t[eé]ngase[^.;\n]*/i,
    /por evacuad[oa][^.;\n]*/i,
    /t[eé]ngase por cumplido[^.;\n]*/i,
  ]

  for (const chunk of evidence) {
    if (!chunkMatchesQuestion(chunk, { question, explicitDocType, roleToken })) continue
    const content = String(chunk.content || "")
    for (const pattern of patterns) {
      const match = content.match(pattern)
      const quote = quoteAroundRegex(content, pattern) || (match?.[0] ? sentenceFromIndex(content, content.toLowerCase().indexOf(String(match[0]).toLowerCase())) : "")
      if (!quote) continue
      return {
        applied: true,
        kind: "resolution",
        answer: `${roleToken ? `En ${roleToken}, ` : ""}la resolución relevante indica: ${quote}`,
        citations: [{ chunkId: chunk.chunkId, quote, paragraph: 0 }],
      }
    }
  }

  return { applied: false, kind: "resolution", answer: "", citations: [] }
}

function extractDateAnswer(question: string, evidence: EvidenceChunk[]): DeterministicFactualAnswer {
  const roleToken = extractRoleToken(question)
  const explicitDocType = inferExplicitDocType(question)
  const datePatterns = [
    /\b\d{1,2}\s+de\s+[a-záéíóúñ]+\s+de\s+\d{4}\b/i,
    /\b\d{1,2}-\d{1,2}-\d{4}\b/,
    /\b\d{4}-\d{2}-\d{2}\b/,
  ]

  for (const chunk of evidence) {
    if (!chunkMatchesQuestion(chunk, { question, explicitDocType, roleToken })) continue
    const content = String(chunk.content || "")
    for (const pattern of datePatterns) {
      const match = content.match(pattern)
      const date = String(match?.[0] || "").trim()
      if (!date) continue
      const quote = quoteAroundRegex(content, pattern) || sentenceFromIndex(content, content.toLowerCase().indexOf(date.toLowerCase()))
      if (!quote) continue
      return {
        applied: true,
        kind: "date",
        answer: `${roleToken ? `En ${roleToken}, ` : ""}la fecha que aparece en la evidencia es ${date}.`,
        citations: [{ chunkId: chunk.chunkId, quote, paragraph: 0 }],
      }
    }
  }

  return { applied: false, kind: "date", answer: "", citations: [] }
}

function extractNormsAnswer(question: string, evidence: EvidenceChunk[]): DeterministicFactualAnswer {
  const roleToken = extractRoleToken(question)
  const explicitDocType = inferExplicitDocType(question)
  const patterns = [
    /\b(?:art\.?|articulo)\s*\d+[a-z]?\b/i,
    /\bLey\s+\d{2,5}(?:\.\d{3})?\b/i,
    /\bDS\s+\d{1,3}\b/i,
    /\bLBGMA\b/i,
  ]

  for (const chunk of evidence) {
    if (!chunkMatchesQuestion(chunk, { question, explicitDocType, roleToken })) continue
    const content = String(chunk.content || "")
    const matches = patterns
      .map((pattern) => content.match(pattern)?.[0] || "")
      .map((item) => String(item || "").trim())
      .filter(Boolean)
    if (!matches.length) continue
    const unique = Array.from(new Set(matches)).slice(0, 3)
    const quote =
      quoteAroundRegex(content, /\b(?:art\.?|articulo)\s*\d+[a-z]?\b|\bLey\s+\d{2,5}(?:\.\d{3})?\b|\bDS\s+\d{1,3}\b|\bLBGMA\b/i) ||
      fallbackQuote(content)
    if (!quote) continue
    return {
      applied: true,
      kind: "norms",
      answer: `${roleToken ? `En ${roleToken}, ` : ""}la evidencia cita ${unique.join(", ")}.`,
      citations: [{ chunkId: chunk.chunkId, quote, paragraph: 0 }],
    }
  }

  return { applied: false, kind: "norms", answer: "", citations: [] }
}

function extractAuthorityAnswer(question: string, evidence: EvidenceChunk[]): DeterministicFactualAnswer {
  const roleToken = extractRoleToken(question)
  const explicitDocType = inferExplicitDocType(question)
  const authorities = [
    "Servicio de Evaluacion Ambiental",
    "SEA",
    "Superintendencia del Medio Ambiente",
    "SMA",
    "Comite de Ministros",
    "Tribunal Ambiental",
  ]

  for (const chunk of evidence) {
    if (!chunkMatchesQuestion(chunk, { question, explicitDocType, roleToken })) continue
    const content = String(chunk.content || "")
    const matched = authorities.filter((authority) => normalize(content).includes(normalize(authority)))
    if (!matched.length) continue
    const authority = matched[0]
    const quote = fallbackQuote(content)
    if (!quote) continue
    return {
      applied: true,
      kind: "authority",
      answer: `${roleToken ? `En ${roleToken}, ` : ""}la autoridad que aparece en la evidencia es ${authority}.`,
      citations: [{ chunkId: chunk.chunkId, quote, paragraph: 0 }],
    }
  }

  return { applied: false, kind: "authority", answer: "", citations: [] }
}

function extractOutcomeAnswer(question: string, evidence: EvidenceChunk[]): DeterministicFactualAnswer {
  const roleToken = extractRoleToken(question)
  const explicitDocType = inferExplicitDocType(question)
  const patterns = [/\bacoge\b/i, /\brechaza\b/i, /\binadmisible\b/i, /se tiene presente/i, /tengase por evacuado el informe/i]

  for (const chunk of evidence) {
    if (!chunkMatchesQuestion(chunk, { question, explicitDocType, roleToken })) continue
    const content = String(chunk.content || "")
    for (const pattern of patterns) {
      if (!content.match(pattern)) continue
      const quote = quoteAroundRegex(content, pattern) || fallbackQuote(content)
      if (!quote) continue
      return {
        applied: true,
        kind: "outcome",
        answer: `${roleToken ? `En ${roleToken}, ` : ""}el resultado que aparece en la evidencia es: ${quote}`,
        citations: [{ chunkId: chunk.chunkId, quote, paragraph: 0 }],
      }
    }
  }

  return { applied: false, kind: "outcome", answer: "", citations: [] }
}

function extractHoldingAnswer(question: string, evidence: EvidenceChunk[]): DeterministicFactualAnswer {
  const roleToken = extractRoleToken(question)
  const explicitDocType = inferExplicitDocType(question)
  const patterns = [/esta magistratura/i, /se concluye/i, /no se advierte ilegalidad/i, /la reclamacion sera rechazad/i, /la reclamacion sera acogid/i]

  for (const chunk of evidence) {
    if (!chunkMatchesQuestion(chunk, { question, explicitDocType, roleToken })) continue
    const content = String(chunk.content || "")
    for (const pattern of patterns) {
      if (!content.match(pattern)) continue
      const quote = quoteAroundRegex(content, pattern) || fallbackQuote(content)
      if (!quote) continue
      return {
        applied: true,
        kind: "holding",
        answer: `${roleToken ? `En ${roleToken}, ` : ""}la conclusion relevante que aparece en la evidencia es: ${quote}`,
        citations: [{ chunkId: chunk.chunkId, quote, paragraph: 0 }],
      }
    }
  }

  return { applied: false, kind: "holding", answer: "", citations: [] }
}

function extractExistenceAnswer(question: string, evidence: EvidenceChunk[]): DeterministicFactualAnswer {
  const roleToken = extractRoleToken(question)
  const explicitDocType = inferExplicitDocType(question)
  const chunk = firstMatchingChunk(evidence, question)
  if (!chunk || !explicitDocType) {
    return { applied: false, kind: "existence", answer: "", citations: [] }
  }
  const quote = fallbackQuote(chunk.content)
  if (!quote) {
    return { applied: false, kind: "existence", answer: "", citations: [] }
  }
  const article = explicitDocType === "informe" ? "un informe" : `una ${explicitDocType}`
  return {
    applied: true,
    kind: "existence",
    answer: `Sí, existe ${article} en el corpus${roleToken ? ` para ${roleToken}` : ""}.`,
    citations: [{ chunkId: chunk.chunkId, quote, paragraph: 0 }],
  }
}

export function buildDeterministicFactualAnswer(params: {
  question: string
  evidence: EvidenceChunk[]
}): DeterministicFactualAnswer {
  const kind = inferFactualAnswerKind(params.question)
  if (kind === "fojas") return extractFojasAnswer(params.question, params.evidence)
  if (kind === "claimant") return extractClaimantAnswer(params.question, params.evidence)
  if (kind === "norms") return extractNormsAnswer(params.question, params.evidence)
  if (kind === "authority") return extractAuthorityAnswer(params.question, params.evidence)
  if (kind === "outcome") return extractOutcomeAnswer(params.question, params.evidence)
  if (kind === "holding") return extractHoldingAnswer(params.question, params.evidence)
  if (kind === "resolution") return extractResolutionAnswer(params.question, params.evidence)
  if (kind === "date") return extractDateAnswer(params.question, params.evidence)
  if (kind === "existence") return extractExistenceAnswer(params.question, params.evidence)
  return { applied: false, kind: "none", answer: "", citations: [] }
}

export function isLikelyFactualQuestion(question: string) {
  return inferFactualAnswerKind(question) !== "none"
}
