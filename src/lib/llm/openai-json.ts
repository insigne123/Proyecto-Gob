type JsonObject = Record<string, any>

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function extractJsonObject(text: string): JsonObject | null {
  const clean = String(text || "").trim()
  if (!clean) return null

  const direct = safeJsonParse(clean)
  if (direct && typeof direct === "object") return direct

  const fenced = clean.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  const parsedFenced = safeJsonParse(fenced)
  if (parsedFenced && typeof parsedFenced === "object") return parsedFenced

  const start = clean.indexOf("{")
  const end = clean.lastIndexOf("}")
  if (start >= 0 && end > start) {
    const sliced = safeJsonParse(clean.slice(start, end + 1))
    if (sliced && typeof sliced === "object") return sliced
  }

  return null
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content

  if (Array.isArray(content)) {
    return content
      .map((item) => extractTextFromContent(item))
      .filter(Boolean)
      .join("\n")
  }

  if (!content || typeof content !== "object") return ""

  const anyContent = content as Record<string, unknown>

  if (typeof anyContent.text === "string") return anyContent.text
  if (typeof anyContent.output_text === "string") return anyContent.output_text
  if (typeof anyContent.value === "string") return anyContent.value
  if (Array.isArray(anyContent.content)) return extractTextFromContent(anyContent.content)

  return ""
}

function parseTemperature() {
  const raw = String(process.env.OPENAI_ANSWER_TEMPERATURE || "").trim()
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return n
}

type GenerateOpenAIJsonParams = {
  system: string
  prompt: string
  schemaName: string
  schema: JsonObject
  model?: string
  maxCompletionTokens?: number
  reasoningEffort?: string
}

export async function generateOpenAIJson(params: GenerateOpenAIJsonParams) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim()
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY")
  }

  const model = String(
    params.model || process.env.OPENAI_ANSWER_MODEL || process.env.OPENAI_RAG_MODEL || "gpt-4o-mini"
  ).trim()
  const baseUrl = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "")
  const temperature = parseTemperature()

  const requestBody: any = {
    model,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: params.schemaName,
        strict: true,
        schema: params.schema,
      },
    },
  }

  const maxCompletionTokens =
    typeof params.maxCompletionTokens === "number" && Number.isFinite(params.maxCompletionTokens)
      ? Math.max(64, Math.floor(params.maxCompletionTokens))
      : null

  if (typeof maxCompletionTokens === "number") {
    requestBody.max_completion_tokens = maxCompletionTokens
  }

  const reasoningEffortRaw =
    typeof params.reasoningEffort === "string" && params.reasoningEffort.trim()
      ? params.reasoningEffort.trim()
      : /^gpt-5/i.test(model)
        ? "minimal"
        : ""

  if (reasoningEffortRaw) {
    requestBody.reasoning_effort = reasoningEffortRaw
  }

  if (typeof temperature === "number") {
    requestBody.temperature = temperature
  }

  async function send(body: any) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    })

    const text = await res.text()
    const payload = safeJsonParse(text)
    return { res, text, payload }
  }

  let { res, text, payload } = await send(requestBody)
  if (!res.ok) {
    const message =
      (payload && payload.error && typeof payload.error.message === "string"
        ? payload.error.message
        : text) || `OpenAI error ${res.status}`

    const tempUnsupported =
      String(message).toLowerCase().includes("temperature") &&
      String(message).toLowerCase().includes("default")
    const reasoningUnsupported =
      String(message).toLowerCase().includes("reasoning_effort") ||
      String(message).toLowerCase().includes("reasoning effort")

    if (typeof requestBody.temperature !== "undefined" && tempUnsupported) {
      delete requestBody.temperature
      ;({ res, text, payload } = await send(requestBody))
    } else if (typeof requestBody.reasoning_effort !== "undefined" && reasoningUnsupported) {
      delete requestBody.reasoning_effort
      ;({ res, text, payload } = await send(requestBody))
    }
  }

  if (!res.ok) {
    const message =
      (payload && payload.error && typeof payload.error.message === "string"
        ? payload.error.message
        : text) || `OpenAI error ${res.status}`
    throw new Error(message)
  }

  let output: JsonObject | null = null

  const parsedContent = payload?.choices?.[0]?.message?.parsed
  if (parsedContent && typeof parsedContent === "object") {
    output = parsedContent as JsonObject
  }

  if (!output) {
    const rawContent =
      payload?.choices?.[0]?.message?.content ??
      payload?.output_text ??
      payload?.output?.[0]?.content ??
      ""

    const textContent = extractTextFromContent(rawContent)
    if (textContent) {
      output = extractJsonObject(textContent)
    }

    if (!output && rawContent && typeof rawContent === "object") {
      output = extractJsonObject(JSON.stringify(rawContent))
    }
  }

  if (!output) {
    throw new Error("OpenAI did not return valid JSON output")
  }

  return {
    output,
    model: String(payload?.model || model),
    usage: payload?.usage ?? null,
  }
}
