function mustGet(name: string) {
  const v = process.env[name]
  if (!v || !String(v).trim()) {
    throw new Error(`Missing ${name}`)
  }
  return String(v).trim()
}

function has(name: string) {
  const v = process.env[name]
  return !!v && !!String(v).trim()
}

export type RagProvider = "local" | "openai" | "hybrid"
export type RagAnswerProvider = "google" | "openai" | "auto"

function mustHaveOneOf(names: string[], label: string) {
  if (names.some((n) => has(n))) return
  throw new Error(`Missing ${label} (${names.join(" | ")})`)
}

function parseEncryptionKeys() {
  const multi = process.env.APP_ENCRYPTION_KEYS
  const single = process.env.APP_ENCRYPTION_KEY

  const list = (multi
    ? multi
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : single
      ? [single.trim()]
      : [])

  if (list.length === 0) {
    throw new Error(
      "Missing APP_ENCRYPTION_KEYS (preferred) or APP_ENCRYPTION_KEY (base64, 32 bytes)"
    )
  }

  for (const raw of list) {
    const key = Buffer.from(raw, "base64")
    if (key.length !== 32) {
      throw new Error("APP_ENCRYPTION_KEYS entries must be 32 bytes (base64)")
    }
  }

  return list
}

export function getRagProvider(): RagProvider {
  const raw = String(process.env.RAG_PROVIDER || "")
    .trim()
    .toLowerCase()

  if (raw === "local" || raw === "openai" || raw === "hybrid") {
    return raw
  }

  if (has("OPENAI_API_KEY")) {
    return "openai"
  }
  return "local"
}

export function getRagAnswerProvider(): RagAnswerProvider {
  const raw = String(process.env.RAG_ANSWER_PROVIDER || "")
    .trim()
    .toLowerCase()

  if (raw === "google" || raw === "openai" || raw === "auto") {
    return raw
  }

  if (has("OPENAI_API_KEY")) {
    return "openai"
  }
  return "google"
}

export function resolveRagAnswerProvider(): "google" | "openai" {
  const p = getRagAnswerProvider()
  if (p === "google" || p === "openai") return p
  return has("OPENAI_API_KEY") ? "openai" : "google"
}

function validateProviderEnv() {
  const ragProvider = getRagProvider()
  const answerProvider = resolveRagAnswerProvider()

  const needsGoogle =
    ragProvider === "local" || ragProvider === "hybrid" || answerProvider === "google"
  const needsOpenAI =
    ragProvider === "openai" || ragProvider === "hybrid" || answerProvider === "openai"

  if (needsGoogle) {
    mustHaveOneOf(
      ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_API_KEY"],
      "Google AI API key"
    )
  }

  if (needsOpenAI && !has("OPENAI_API_KEY")) {
    throw new Error("Missing OPENAI_API_KEY for configured RAG/answer provider")
  }
}

let webValidated = false
let workerValidated = false

export function validateWebEnv() {
  if (webValidated) return

  mustGet("NEXT_PUBLIC_SUPABASE_URL")
  mustGet("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  mustGet("SUPABASE_SERVICE_ROLE_KEY")
  validateProviderEnv()
  parseEncryptionKeys()

  webValidated = true
}

export function validateWorkerEnv() {
  if (workerValidated) return

  if (!has("SUPABASE_URL")) {
    mustGet("NEXT_PUBLIC_SUPABASE_URL")
  }
  mustGet("SUPABASE_SERVICE_ROLE_KEY")
  validateProviderEnv()
  parseEncryptionKeys()

  workerValidated = true
}

export function envHealth() {
  const encryptionKeys = (() => {
    try {
      return parseEncryptionKeys().length
    } catch {
      return 0
    }
  })()

  return {
    ragProvider: getRagProvider(),
    ragAnswerProvider: resolveRagAnswerProvider(),
    supabaseUrl: has("SUPABASE_URL") || has("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseAnonKey: has("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    supabaseServiceRoleKey: has("SUPABASE_SERVICE_ROLE_KEY"),
    googleApiKey: has("GEMINI_API_KEY") || has("GOOGLE_API_KEY") || has("GOOGLE_GENAI_API_KEY"),
    openaiApiKey: has("OPENAI_API_KEY"),
    encryptionKeys,
    smtp: has("SMTP_HOST") && has("SMTP_USER") && has("SMTP_PASS"),
    appPublicUrl: has("APP_PUBLIC_URL"),
  }
}
