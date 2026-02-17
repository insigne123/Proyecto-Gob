import crypto from "crypto"

const ALGO = "aes-256-gcm"

function parseKey(raw: string) {
  const key = Buffer.from(raw, "base64")
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must be 32 bytes (base64)")
  }
  return key
}

function getKeys() {
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

  return list.map(parseKey)
}

export function encryptJson(value: unknown) {
  const key = getKeys()[0]
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const plaintext = Buffer.from(JSON.stringify(value), "utf8")
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  // payload: iv(12) + tag(16) + ciphertext
  return Buffer.concat([iv, tag, ciphertext]).toString("base64")
}

export function decryptJson<T = any>(payloadB64: string): T {
  const keys = getKeys()
  const payload = Buffer.from(payloadB64, "base64")
  const iv = payload.subarray(0, 12)
  const tag = payload.subarray(12, 28)
  const ciphertext = payload.subarray(28)

  let lastErr: any = null
  for (const key of keys) {
    try {
      const decipher = crypto.createDecipheriv(ALGO, key, iv)
      decipher.setAuthTag(tag)
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ])
      return JSON.parse(plaintext.toString("utf8"))
    } catch (err: any) {
      lastErr = err
    }
  }
  throw lastErr || new Error("Decryption failed")
}
