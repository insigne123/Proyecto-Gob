type WorkerHealthRow = {
  worker_id?: string | null
  started_at?: string | null
  last_seen_at?: string | null
  hostname?: string | null
  pid?: number | null
  version?: string | null
}

type WorkerHealthItem = {
  workerId: string | null
  startedAt: string | null
  lastSeenAt: string | null
  ageSeconds: number | null
  hostname: string | null
  pid: number | null
  version: string | null
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function buildWebHealthPayload(params: {
  ts: string
  hasToken: boolean
  env?: Record<string, unknown>
  error?: unknown
}) {
  if (typeof params.error === "undefined") {
    return {
      ok: true,
      ts: params.ts,
      env: params.hasToken ? undefined : params.env,
    }
  }

  return {
    ok: false,
    ts: params.ts,
    env: params.hasToken ? undefined : params.env,
    error: toErrorMessage(params.error),
  }
}

export function summarizeWorkers(rows: WorkerHealthRow[], nowMs = Date.now()) {
  const workers: WorkerHealthItem[] = (Array.isArray(rows) ? rows : []).map((worker) => {
    const lastSeenAt = worker.last_seen_at ?? null
    const lastSeenMs = lastSeenAt ? Date.parse(String(lastSeenAt)) : Number.NaN
    const ageSeconds = Number.isFinite(lastSeenMs) ? Math.floor((nowMs - lastSeenMs) / 1000) : null

    return {
      workerId: worker.worker_id ?? null,
      startedAt: worker.started_at ?? null,
      lastSeenAt,
      ageSeconds,
      hostname: worker.hostname ?? null,
      pid: typeof worker.pid === "number" ? worker.pid : null,
      version: worker.version ?? null,
    }
  })

  const fresh = workers.filter((worker) => typeof worker.ageSeconds === "number" && worker.ageSeconds <= 90).length

  return { workers, fresh }
}

export function buildWorkerHealthPayload(params: {
  ts: string
  hasToken: boolean
  rows: WorkerHealthRow[]
  nowMs?: number
}) {
  const { workers, fresh } = summarizeWorkers(params.rows, params.nowMs)

  return {
    ok: fresh > 0,
    ts: params.ts,
    fresh,
    workers: params.hasToken ? undefined : workers,
  }
}
