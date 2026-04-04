export type ThreadMemoryMessage = {
  role: string | null
  content: string | null
  citations?: unknown
  usage?: unknown
  createdAt?: string | null
}

export type ThreadMemoryResult = {
  block: string
  roleTokens: string[]
}

export function buildPersistedThreadMemory(params: {
  messages: ThreadMemoryMessage[]
  currentQuestion?: string | null
  assistantAnswer?: string | null
}) {
  const extendedMessages = Array.isArray(params.messages) ? params.messages.slice() : []
  if (params.currentQuestion) {
    extendedMessages.push({ role: "user", content: String(params.currentQuestion) })
  }
  if (params.assistantAnswer) {
    extendedMessages.push({ role: "assistant", content: String(params.assistantAnswer) })
  }

  const memory = buildThreadMemory({
    messages: extendedMessages,
    currentQuestion: params.currentQuestion,
  })

  const summary = memory.block
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" | ")

  return {
    summary,
    roleTokens: memory.roleTokens,
  }
}

function safeText(value: unknown, maxLen = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > maxLen ? `${text.slice(0, maxLen).trim()}...` : text
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function uniqueStrings(values: string[], max = 8) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = String(value || "").trim()
    if (!clean) continue
    const key = normalizeText(clean)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(clean)
    if (out.length >= max) break
  }
  return out
}

function extractRoleTokens(text: string) {
  const tokens: string[] = []
  for (const match of String(text || "").matchAll(/\bR-\d{1,5}-\d{4}\b/gi)) {
    const token = String(match[0] || "").toUpperCase()
    if (token) tokens.push(token)
  }
  return uniqueStrings(tokens, 6)
}

function summarizeAssistantContent(text: string) {
  const clean = String(text || "").trim()
  if (!clean) return ""
  const lines = clean
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)

  const preferred = lines.find((line) =>
    /(orden recomendado|lineas de defensa|contexto, no como prueba principal|riesgo principal|criterio util|precedente m[aá]s util|la evidencia recuperada no cubre)/i.test(
      line
    )
  )
  if (preferred) return safeText(preferred, 260)

  const bullet = lines.find((line) => /^([-*]|\d+\.)\s+/.test(line))
  if (bullet) return safeText(bullet.replace(/^([-*]|\d+\.)\s+/, ""), 260)

  const firstSentence = clean.split(/(?<=[\.!?])\s+/).find((item) => item.trim().length >= 24) || clean
  return safeText(firstSentence, 260)
}

export function buildThreadMemory(params: {
  messages: ThreadMemoryMessage[]
  currentQuestion?: string | null
}) {
  const messages = Array.isArray(params.messages) ? params.messages : []
  const userQuestions = uniqueStrings(
    messages
      .filter((row) => String(row.role || "") === "user")
      .map((row) => safeText(row.content || "", 220)),
    3
  )

  const assistantSignals = uniqueStrings(
    messages
      .filter((row) => String(row.role || "") === "assistant")
      .map((row) => summarizeAssistantContent(String(row.content || ""))),
    4
  )

  const roleTokens = uniqueStrings(
    [
      ...messages.flatMap((row) => extractRoleTokens(String(row.content || ""))),
      ...extractRoleTokens(String(params.currentQuestion || "")),
    ],
    6
  )

  const lines: string[] = []
  if (userQuestions.length) {
    lines.push(`historial_usuario: ${userQuestions.join(" | ")}`)
  }
  if (assistantSignals.length) {
    lines.push(`consensos_previos: ${assistantSignals.join(" | ")}`)
  }
  if (roleTokens.length) {
    lines.push(`roles_en_conversacion: ${roleTokens.join(" | ")}`)
  }

  return {
    block: lines.slice(0, 3).join("\n"),
    roleTokens,
  } satisfies ThreadMemoryResult
}
