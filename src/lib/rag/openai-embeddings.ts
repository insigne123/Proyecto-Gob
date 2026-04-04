type EmbeddingTask = "query" | "document"

type EmbedOptions = {
  task?: EmbeddingTask
  maxRetries?: number
  batchSize?: number
}

function envNumber(name: string, fallback: number) {
  const raw = String(process.env[name] || "").trim()
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return n
}

function openAIKey() {
  const key = String(process.env.OPENAI_API_KEY || "").trim()
  if (!key) {
    throw new Error("Missing OPENAI_API_KEY for local embeddings")
  }
  return key
}

function openAIBaseUrl() {
  return String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "")
}

function embeddingModel(task: EmbeddingTask) {
  const specific =
    task === "query"
      ? String(process.env.OPENAI_QUERY_EMBEDDING_MODEL || "").trim()
      : String(process.env.OPENAI_DOCUMENT_EMBEDDING_MODEL || "").trim()

  if (specific) return specific
  return String(process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small").trim()
}

function embeddingDimensions() {
  const n = Math.floor(envNumber("OPENAI_EMBEDDING_DIMENSIONS", 768))
  return Math.max(128, Math.min(3072, n))
}

function defaultBatchSize() {
  const n = Math.floor(envNumber("OPENAI_EMBEDDING_BATCH_SIZE", 64))
  return Math.max(1, Math.min(256, n))
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

function messageOf(err: unknown) {
  return String((err as any)?.message || err || "")
}

function parseRetryAfterMs(message: string, retryAfterHeader: string | null) {
  if (retryAfterHeader) {
    const numeric = Number(retryAfterHeader)
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.ceil(numeric * 1000)
    }

    const at = Date.parse(retryAfterHeader)
    if (Number.isFinite(at)) {
      const delta = at - Date.now()
      if (delta > 0) return delta
    }
  }

  const msMatch = message.match(/retry in\s+([0-9]+(?:\.[0-9]+)?)ms/i)
  if (msMatch?.[1]) {
    const n = Number(msMatch[1])
    if (Number.isFinite(n) && n > 0) return Math.ceil(n)
  }

  const secMatch = message.match(/retry in\s+([0-9]+(?:\.[0-9]+)?)s/i)
  if (secMatch?.[1]) {
    const n = Number(secMatch[1])
    if (Number.isFinite(n) && n > 0) return Math.ceil(n * 1000)
  }

  return null
}

function isRateLimitLike(error: unknown) {
  const msg = messageOf(error).toLowerCase()
  return msg.includes("429") || msg.includes("rate limit") || msg.includes("quota")
}

async function requestEmbeddingsBatch(inputs: string[], task: EmbeddingTask) {
  const body: Record<string, unknown> = {
    model: embeddingModel(task),
    input: inputs,
  }

  const dims = embeddingDimensions()
  if (dims > 0) {
    body.dimensions = dims
  }

  const res = await fetch(`${openAIBaseUrl()}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAIKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }

  if (!res.ok) {
    const msg =
      (data?.error?.message && String(data.error.message)) ||
      text ||
      `OpenAI embeddings failed (${res.status})`

    const error = new Error(msg) as Error & {
      status?: number
      retryAfterMs?: number | null
    }
    error.status = res.status
    error.retryAfterMs = parseRetryAfterMs(msg, res.headers.get("retry-after"))
    throw error
  }

  const rows = Array.isArray(data?.data) ? data.data : []
  const vectors = rows
    .slice()
    .sort((a: any, b: any) => Number(a?.index || 0) - Number(b?.index || 0))
    .map((row: any) => (Array.isArray(row?.embedding) ? row.embedding : []))

  if (vectors.length !== inputs.length) {
    throw new Error(`Embedding count mismatch: got ${vectors.length}, expected ${inputs.length}`)
  }

  const expectedDims = embeddingDimensions()
  for (const vec of vectors) {
    if (!Array.isArray(vec) || vec.length !== expectedDims) {
      throw new Error(
        `Embedding dimension mismatch: got ${Array.isArray(vec) ? vec.length : 0}, expected ${expectedDims}`
      )
    }
  }

  return vectors as number[][]
}

async function embedBatchWithRetry(inputs: string[], task: EmbeddingTask, maxRetries: number) {
  let lastErr: unknown = null

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await requestEmbeddingsBatch(inputs, task)
    } catch (err: any) {
      lastErr = err
      if (!isRateLimitLike(err) || attempt >= maxRetries) {
        break
      }

      const retryAfterMs =
        typeof err?.retryAfterMs === "number" && Number.isFinite(err.retryAfterMs)
          ? err.retryAfterMs
          : null
      const waitMs = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : Math.min(45_000, 2000 * (attempt + 1))
      await sleep(waitMs)
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(messageOf(lastErr))
}

export function openAIEmbeddingsEnabled() {
  return !!String(process.env.OPENAI_API_KEY || "").trim()
}

export function isOpenAIEmbeddingRateLimitError(err: unknown) {
  return isRateLimitLike(err)
}

export async function embedTextsWithOpenAI(inputs: string[], options?: EmbedOptions) {
  const task = options?.task || "document"
  const maxRetries = Math.max(0, Math.min(10, Math.floor(options?.maxRetries ?? 4)))
  const batchSize = Math.max(1, Math.min(256, Math.floor(options?.batchSize ?? defaultBatchSize())))

  if (!inputs.length) return [] as number[][]
  const safeInputs = inputs.map((text) => {
    const clean = String(text || "").trim()
    return clean || "[empty]"
  })

  const out: number[][] = []
  for (let i = 0; i < safeInputs.length; i += batchSize) {
    const batch = safeInputs.slice(i, i + batchSize)
    const vectors = await embedBatchWithRetry(batch, task, maxRetries)
    out.push(...vectors)
  }

  return out
}

export async function embedTextWithOpenAI(input: string, options?: EmbedOptions) {
  const vectors = await embedTextsWithOpenAI([input], options)
  return vectors[0] || []
}
