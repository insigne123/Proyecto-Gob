import { createClient } from "@supabase/supabase-js"

type CacheEntry = {
  value: unknown
  expiresAt: number
}

declare global {
  // eslint-disable-next-line no-var
  var __proyectoGobRuntimeCache: Map<string, CacheEntry> | undefined
}

function cacheStore() {
  if (!globalThis.__proyectoGobRuntimeCache) {
    globalThis.__proyectoGobRuntimeCache = new Map<string, CacheEntry>()
  }
  return globalThis.__proyectoGobRuntimeCache
}

function truthyEnv(name: string, fallback: boolean) {
  const raw = String(process.env[name] || "")
    .trim()
    .toLowerCase()
  if (!raw) return fallback
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false
  return fallback
}

let sharedCacheClient: any | null | undefined

function getSharedCacheClient() {
  if (sharedCacheClient !== undefined) return sharedCacheClient

  const enabled = truthyEnv("RAG_ENABLE_SHARED_CACHE", true)
  const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()

  if (!enabled || !url || !key) {
    sharedCacheClient = null
    return sharedCacheClient
  }

  sharedCacheClient = createClient(url, key, { auth: { persistSession: false } })
  return sharedCacheClient
}

async function getSharedCached<T>(cacheKey: string) {
  const client = getSharedCacheClient()
  if (!client) return { hit: false } as { hit: false } | { hit: true; value: T }

  const { data, error } = await client
    .from("gob_runtime_cache_entries")
    .select("value,expires_at")
    .eq("cache_key", cacheKey)
    .maybeSingle()

  if (error || !data?.expires_at) return { hit: false }
  const expiresAt = Date.parse(String(data.expires_at))
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    await client.from("gob_runtime_cache_entries").delete().eq("cache_key", cacheKey)
    return { hit: false }
  }

  return { hit: true, value: data.value as T }
}

async function setSharedCached(cacheKey: string, namespace: string, value: unknown, ttlMs: number) {
  const client = getSharedCacheClient()
  if (!client) return
  const expiresAt = new Date(Date.now() + ttlMs).toISOString()
  await client.from("gob_runtime_cache_entries").upsert(
    {
      cache_key: cacheKey,
      namespace,
      value,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "cache_key" }
  )
}

async function clearSharedCache(namespace?: string) {
  const client = getSharedCacheClient()
  if (!client) return
  if (!namespace) {
    await client.from("gob_runtime_cache_entries").delete().gte("updated_at", "1970-01-01T00:00:00.000Z")
    return
  }
  await client.from("gob_runtime_cache_entries").delete().eq("namespace", namespace)
}

export async function getRuntimeCached<T>(params: {
  namespace: string
  key: string
  ttlMs: number
  loader: () => Promise<T>
}) {
  const ttlMs = Math.max(1000, Number(params.ttlMs || 0))
  const cacheKey = `${params.namespace}:${params.key}`
  const store = cacheStore()
  const now = Date.now()
  const existing = store.get(cacheKey)
  if (existing && existing.expiresAt > now) {
    return existing.value as T
  }

  const shared = await getSharedCached<T>(cacheKey)
  if (shared && shared.hit) {
    store.set(cacheKey, { value: shared.value, expiresAt: now + ttlMs })
    return shared.value
  }

  const value = await params.loader()
  store.set(cacheKey, {
    value,
    expiresAt: now + ttlMs,
  })
  await setSharedCached(cacheKey, params.namespace, value, ttlMs).catch(() => null)
  return value
}

export async function clearRuntimeCache(namespace?: string) {
  const store = cacheStore()
  if (!namespace) {
    store.clear()
    await clearSharedCache().catch(() => null)
    return
  }

  const prefix = `${namespace}:`
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key)
  }
  await clearSharedCache(namespace).catch(() => null)
}
