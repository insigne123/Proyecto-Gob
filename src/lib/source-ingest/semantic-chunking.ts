export type SemanticBlock = {
  text: string
  page: number | null
  section: string | null
}

function normalizeWhitespace(value: string) {
  return String(value || "").replace(/[ \t]+/g, " ").replace(/\u00a0/g, " ").trim()
}

function normalizeForHeuristics(value: string) {
  return normalizeWhitespace(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

function hasLetters(value: string) {
  return /[a-záéíóúñ]/i.test(value)
}

function uppercaseRatio(value: string) {
  const letters = Array.from(String(value || "")).filter((char) => /[A-Za-zÁÉÍÓÚÑÜ]/.test(char))
  if (!letters.length) return 0
  const upper = letters.filter((char) => char === char.toUpperCase()).length
  return upper / letters.length
}

export function isLikelySectionHeading(value: string) {
  const line = normalizeWhitespace(value)
  if (!line) return false
  if (line.length < 4 || line.length > 140) return false
  if (!hasLetters(line)) return false

  const normalized = normalizeForHeuristics(line)
  if (/^(anexo|anexos|indice|índice|tabla de contenido|contenido)$/i.test(line)) return true
  if (/^\d+(\.\d+)*[\)\.-]?\s+[a-z]/i.test(normalized)) return true
  if (/^[ivxlcdm]+[\)\.-]?\s+[a-z]/i.test(normalized)) return true
  if (uppercaseRatio(line) >= 0.72 && line.split(" ").length <= 12) return true
  if (!/[\.;:]$/.test(line) && line.split(" ").length <= 10 && /^[A-ZÁÉÍÓÚÑÜ0-9]/.test(line)) return true
  return false
}

export function isLowValueChunkText(value: string) {
  const text = normalizeWhitespace(value)
  if (!text) return true
  if (text.length < 40) return true

  const normalized = normalizeForHeuristics(text)
  if (!normalized) return true
  if (/^pagina\s*\d+$/i.test(text)) return true
  if (/^\d+$/.test(normalized)) return true
  if (/^(anexo|anexos|adjunto|adjuntos|indice|indice general)$/i.test(normalized)) return true

  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length < 6) return false

  const unique = new Set(tokens)
  const uniqueRatio = unique.size / tokens.length
  if (uniqueRatio < 0.18) return true

  const alphaChars = Array.from(text).filter((char) => /[A-Za-zÁÉÍÓÚÑÜáéíóúñü]/.test(char)).length
  if (alphaChars / Math.max(1, text.length) < 0.22) return true

  return false
}

export function splitTextSemantically(
  text: string,
  opts?: { maxChars?: number; overlap?: number }
) {
  const maxChars = Math.max(420, Number(opts?.maxChars || 1100))
  const overlap = Math.max(0, Math.min(280, Number(opts?.overlap || 140)))
  const raw = String(text || "").replace(/\r/g, "")
  const blocks = raw
    .split(/\n{2,}/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean)

  const seeds = blocks.length ? blocks : [normalizeWhitespace(raw)].filter(Boolean)
  const out: string[] = []

  for (const seed of seeds) {
    if (seed.length <= maxChars) {
      out.push(seed)
      continue
    }

    const sentences = seed
      .split(/(?<=[\.!?;:])\s+/)
      .map((part) => normalizeWhitespace(part))
      .filter(Boolean)

    let buffer = ""
    for (const sentence of sentences) {
      const trial = buffer ? `${buffer} ${sentence}` : sentence
      if (trial.length <= maxChars) {
        buffer = trial
        continue
      }

      if (buffer) {
        out.push(buffer)
      }

      if (sentence.length <= maxChars) {
        buffer = sentence
        continue
      }

      let offset = 0
      while (offset < sentence.length) {
        const end = Math.min(sentence.length, offset + maxChars)
        const piece = normalizeWhitespace(sentence.slice(offset, end))
        if (piece) out.push(piece)
        if (end >= sentence.length) break
        offset = Math.max(0, end - overlap)
      }
      buffer = ""
    }

    if (buffer) out.push(buffer)
  }

  return out.filter((piece) => !isLowValueChunkText(piece))
}

export function extractPdfSemanticBlocks(pageText: string, pageNumber: number) {
  const lines = String(pageText || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)

  if (!lines.length) return [] as SemanticBlock[]

  const out: SemanticBlock[] = []
  let currentSection: string | null = `p.${pageNumber}`
  let buffer: string[] = []

  const flush = () => {
    const text = normalizeWhitespace(buffer.join(" "))
    if (text && !isLowValueChunkText(text)) {
      out.push({ text, page: pageNumber, section: currentSection })
    }
    buffer = []
  }

  for (const line of lines) {
    if (isLikelySectionHeading(line)) {
      flush()
      currentSection = `p.${pageNumber} | ${line.slice(0, 120)}`
      continue
    }

    buffer.push(line)
    if (buffer.join(" ").length >= 1800) {
      flush()
    }
  }

  flush()
  return out
}

export function topSectionLabels(blocks: Array<{ section: string | null }>, max = 8) {
  const labels = Array.from(
    new Set(
      blocks
        .map((block) => normalizeWhitespace(String(block?.section || "")))
        .filter(Boolean)
    )
  )
  return labels.slice(0, Math.max(1, max))
}
