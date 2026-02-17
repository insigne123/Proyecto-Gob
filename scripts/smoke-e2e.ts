import "dotenv/config"

import crypto from "crypto"
import fs from "fs"
import path from "path"
import { spawn } from "child_process"

import { createServerClient } from "@supabase/ssr"

import { createAdminClient } from "../src/lib/supabase/admin"
import { ingestSourceJob } from "../src/worker/jobs/source-ingest"
import { reportGenerateJob } from "../src/worker/jobs/report-generate"

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function mustGet(name: string) {
  const v = String(process.env[name] || "").trim()
  if (!v) throw new Error(`Missing env ${name}`)
  return v
}

function nowId() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  const rnd = crypto.randomBytes(4).toString("hex")
  return `${ts}-${rnd}`
}

function buildCookieHeader(jar: Map<string, string>) {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")
}

function applySetCookies(jar: Map<string, string>, setCookies: string[]) {
  for (const raw of setCookies) {
    const first = String(raw || "").split(";", 1)[0] || ""
    const idx = first.indexOf("=")
    if (idx <= 0) continue
    const name = first.slice(0, idx)
    const value = first.slice(idx + 1)
    if (!value) {
      jar.delete(name)
    } else {
      jar.set(name, value)
    }
  }
}

async function waitForOk(url: string, timeoutMs = 60_000) {
  const started = Date.now()
  let lastErr = "unknown"
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: "manual" })
      if (res.ok) return
      lastErr = `status ${res.status}`
    } catch (err: any) {
      lastErr = err?.message ?? String(err)
    }
    await sleep(800)
  }
  throw new Error(`Timeout waiting for ${url} (${lastErr})`)
}

async function runCommand(cmd: string, args: string[]) {
  const child = spawn(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  })
  const code: number = await new Promise((resolve) => {
    child.on("exit", (c) => resolve(typeof c === "number" ? c : 1))
  })
  if (code !== 0) throw new Error(`Command failed (${cmd} ${args.join(" ")}) code=${code}`)
}

async function startNextServer(port: number) {
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm"
  const child = spawn(npmBin, ["run", "start", "--", "-p", String(port)], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  })

  return child
}

async function stopNextServer(child: any) {
  if (!child || typeof child.pid !== "number") return
  try {
    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          shell: true,
        })
        killer.on("exit", () => resolve())
      })
      return
    }
    child.kill("SIGTERM")
  } catch {
    // ignore
  }
}

async function createSessionCookieJar(params: {
  email: string
  password: string
}) {
  const url = mustGet("NEXT_PUBLIC_SUPABASE_URL")
  const anon = mustGet("NEXT_PUBLIC_SUPABASE_ANON_KEY")

  const jar = new Map<string, string>()
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return Array.from(jar.entries()).map(([name, value]) => ({ name, value }))
      },
      setAll(cookiesToSet) {
        for (const c of cookiesToSet) {
          if (c.value) jar.set(c.name, c.value)
          else jar.delete(c.name)
        }
      },
    },
  })

  const { error } = await supabase.auth.signInWithPassword({
    email: params.email,
    password: params.password,
  })
  if (error) throw new Error(`signIn failed: ${error.message}`)

  // Ensure cookies were written.
  const header = buildCookieHeader(jar)
  if (!header) throw new Error("No auth cookies were set after sign-in")
  return jar
}

async function httpJson(params: {
  baseUrl: string
  jar?: Map<string, string>
  method: "GET" | "POST" | "PATCH" | "DELETE"
  path: string
  body?: any
}) {
  const headers: Record<string, string> = {
    accept: "application/json",
  }
  if (params.jar) headers.cookie = buildCookieHeader(params.jar)
  if (typeof params.body !== "undefined") headers["content-type"] = "application/json"

  const res = await fetch(`${params.baseUrl}${params.path}`, {
    method: params.method,
    headers,
    body: typeof params.body !== "undefined" ? JSON.stringify(params.body) : undefined,
    redirect: "manual",
  })

  const setCookies = (res.headers as any).getSetCookie?.() as string[] | undefined
  if (params.jar && Array.isArray(setCookies) && setCookies.length) {
    applySetCookies(params.jar, setCookies)
  }

  const text = await res.text()
  const json = (() => {
    try {
      return text ? JSON.parse(text) : null
    } catch {
      return null
    }
  })()

  return { res, json, text }
}

async function main() {
  const smokeId = nowId()
  const port = Number(process.env.SMOKE_PORT || "9010")
  const baseUrl = `http://127.0.0.1:${port}`
  const cleanupEnabled = String(process.env.SMOKE_SKIP_CLEANUP || "").trim() ? false : true

  // 0) Ensure build exists (next start).
  const buildIdPath = path.join(process.cwd(), ".next", "BUILD_ID")
  if (!fs.existsSync(buildIdPath)) {
    // eslint-disable-next-line no-console
    console.log("[smoke] .next missing; running build...")
    await runCommand(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"])
  }

  // 1) Start server
  // eslint-disable-next-line no-console
  console.log(`[smoke] starting next server on ${baseUrl}`)
  const server = await startNextServer(port)
  try {
    await waitForOk(`${baseUrl}/api/health`, 80_000)

    // 2) Public health check
    {
      const { res, json } = await httpJson({ baseUrl, method: "GET", path: "/api/health" })
      if (!res.ok || !json?.ok) {
        throw new Error(`health failed: status=${res.status} body=${JSON.stringify(json)}`)
      }
      // eslint-disable-next-line no-console
      console.log("[smoke] /api/health ok")
    }

    // 3) Create test user
    const admin = createAdminClient()
    const email = `smoke+${smokeId}@example.com`
    const password = `S!m0ke-${crypto.randomBytes(12).toString("hex")}`
    const { data: createdUser, error: userErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (userErr) throw new Error(`createUser failed: ${userErr.message}`)
    const userId = String(createdUser.user?.id || "")
    if (!userId) throw new Error("createUser returned no id")
    // eslint-disable-next-line no-console
    console.log(`[smoke] created test user ${email}`)

    const createdWorkspaceIds: string[] = []
    const createdJobIds: string[] = []
    const createdReportIds: string[] = []

    try {
      // 4) Create session cookies for app HTTP calls
      const jar = await createSessionCookieJar({ email, password })
      // eslint-disable-next-line no-console
      console.log(`[smoke] session cookies set (${jar.size})`)

      // 5) Verify redirects without auth
      {
        const res = await fetch(`${baseUrl}/workspaces`, { redirect: "manual" })
        if (!(res.status === 302 || res.status === 307)) {
          throw new Error(`expected redirect for /workspaces, got ${res.status}`)
        }
      }

      // 6) Create two workspaces via API
      const wsA = await httpJson({
        baseUrl,
        jar,
        method: "POST",
        path: "/api/workspaces",
        body: {
          title: `[SMOKE A] Planta tratamiento Los Lagos ${smokeId}`,
          description: "Smoke test workspace (precedente)",
        },
      })
      if (!wsA.res.ok) throw new Error(`workspace A create failed: ${wsA.res.status} ${wsA.text}`)
      const workspaceA = String(wsA.json?.id || "")
      if (!workspaceA) throw new Error("workspace A id missing")
      createdWorkspaceIds.push(workspaceA)

      const wsB = await httpJson({
        baseUrl,
        jar,
        method: "POST",
        path: "/api/workspaces",
        body: {
          title: `[SMOKE B] Planta tratamiento Los Lagos ${smokeId}`,
          description: "Smoke test workspace (nuevo informe)",
        },
      })
      if (!wsB.res.ok) throw new Error(`workspace B create failed: ${wsB.res.status} ${wsB.text}`)
      const workspaceB = String(wsB.json?.id || "")
      if (!workspaceB) throw new Error("workspace B id missing")
      createdWorkspaceIds.push(workspaceB)

      // eslint-disable-next-line no-console
      console.log(`[smoke] created workspaces A=${workspaceA.slice(0, 8)} B=${workspaceB.slice(0, 8)}`)

      // 7) Patch profiles (needed for precedent scoring)
      for (const ws of [workspaceA, workspaceB]) {
        const resp = await httpJson({
          baseUrl,
          jar,
          method: "PATCH",
          path: `/api/workspaces/${ws}/profile`,
          body: {
            region: "Los Lagos",
            comuna: "Puerto Varas",
            causeType: "Reclamacion RCA",
            tribunalRole: "Evaluador ambiental",
            seaRole: "SEA",
            proceduralStatus: "En analisis",
            metadata: { sector: "Saneamiento" },
          },
        })
        if (!resp.res.ok) {
          throw new Error(`profile patch failed: ws=${ws} status=${resp.res.status} body=${resp.text}`)
        }
      }

      // 8) Create a precedent report (final) in workspace A (direct insert; no job)
      {
        const now = new Date().toISOString()
        const { data, error } = await admin
          .from("gob_reports")
          .insert({
            workspace_id: workspaceA,
            created_at: now,
            status: "final",
            content_json: {
              title: `Informe precedente ${smokeId}`,
              sections: [
                {
                  heading: "Resumen ejecutivo",
                  paragraphs: [
                    {
                      text:
                        "Este informe precedente describe la estructura institucional usada para evaluar impactos, marco normativo y medidas de mitigacion.",
                      citations: [],
                      notFound: false,
                    },
                  ],
                  citations: [],
                },
                {
                  heading: "Conclusiones",
                  paragraphs: [
                    {
                      text:
                        "Se recomienda verificar que toda afirmacion relevante este respaldada por evidencia documental y citas verificables.",
                      citations: [],
                      notFound: false,
                    },
                  ],
                  citations: [],
                },
              ],
              generation: { template: "informe-evaluacion", status: "manual" },
            },
            citations: [],
            created_by_model: null,
            created_by: userId,
          })
          .select("id")
          .single()

        if (error) throw new Error(`precedent report insert failed: ${error.message}`)
        const precedentReportId = String((data as any)?.id || "")
        if (!precedentReportId) throw new Error("precedentReportId missing")
        createdReportIds.push(precedentReportId)
        // eslint-disable-next-line no-console
        console.log(`[smoke] precedent report=${precedentReportId.slice(0, 8)}`)
      }

      // 9) Ingest a tiny data: URL source into workspace B (uses sources API + worker ingest job)
      const sharedHtml = [
        "<html><body>",
        "<h1>Antecedente compartido</h1>",
        "<p>Este antecedente se carga en el expediente A y debe quedar visible desde el expediente B.</p>",
        "</body></html>",
      ].join("")
      const sharedDataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(sharedHtml)}`

      const sharedSourceResp = await httpJson({
        baseUrl,
        jar,
        method: "POST",
        path: `/api/workspaces/${workspaceA}/sources`,
        body: {
          kind: "url",
          url: sharedDataUrl,
          title: `Fuente compartida smoke ${smokeId}`,
          metadata: {
            docType: "Antecedente",
            year: 2025,
            region: "Los Lagos",
            sector: "Saneamiento",
            projectName: "Base compartida",
            sourceOrigin: "smoke",
            language: "es",
          },
        },
      })
      if (!sharedSourceResp.res.ok) {
        throw new Error(
          `shared source create failed: ${sharedSourceResp.res.status} ${sharedSourceResp.text}`
        )
      }
      const sharedSnapshotId = String(sharedSourceResp.json?.snapshotId || "")
      if (!sharedSnapshotId) throw new Error("shared snapshotId missing")

      const { data: sharedJob, error: sharedJobErr } = await admin
        .from("gob_jobs")
        .select("*")
        .eq("type", "source_ingest")
        .filter("payload->>snapshot_id", "eq", sharedSnapshotId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (sharedJobErr) throw new Error(`shared job lookup failed: ${sharedJobErr.message}`)
      if (!sharedJob) throw new Error("shared source_ingest job not found")
      createdJobIds.push(String((sharedJob as any).id))

      await ingestSourceJob({ supabase: admin, job: sharedJob })
      // eslint-disable-next-line no-console
      console.log(`[smoke] source_ingest completed for shared snapshot=${sharedSnapshotId.slice(0, 8)}`)

      const evidenceHtml = [
        "<html><body>",
        "<h1>Proyecto Planta de Tratamiento de Aguas</h1>",
        "<p>El proyecto se ubica en la Region de Los Lagos, comuna de Puerto Varas.</p>",
        "<p>La evaluacion considera impactos sobre recurso hidrico, calidad de aire y ruido.</p>",
        "<h2>Marco normativo</h2>",
        "<p>La RCA establece limites de ruido nocturno de 45 dB(A) y condiciones de monitoreo.</p>",
        "<h2>Medidas</h2>",
        "<p>Se implementara una barrera acustica y un monitoreo trimestral de ruido.</p>",
        "</body></html>",
      ].join("")
      const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(evidenceHtml)}`

      // Force local mode for this smoke run to avoid creating OpenAI vector stores/files.
      const prevRagProvider = process.env.RAG_PROVIDER
      const prevAnswerProvider = process.env.RAG_ANSWER_PROVIDER
      process.env.RAG_PROVIDER = "local"
      process.env.RAG_ANSWER_PROVIDER = "google"

      const sourceResp = await httpJson({
        baseUrl,
        jar,
        method: "POST",
        path: `/api/workspaces/${workspaceB}/sources`,
        body: {
          kind: "url",
          url: dataUrl,
          title: `Fuente smoke ${smokeId}`,
          metadata: {
            docType: "Antecedente",
            year: 2026,
            region: "Los Lagos",
            sector: "Saneamiento",
            projectName: "Planta de Tratamiento de Aguas",
            sourceOrigin: "smoke",
            language: "es",
          },
        },
      })
      if (!sourceResp.res.ok) {
        throw new Error(`source create failed: ${sourceResp.res.status} ${sourceResp.text}`)
      }
      const snapshotId = String(sourceResp.json?.snapshotId || "")
      if (!snapshotId) throw new Error("snapshotId missing")

      // Find job and run it directly.
      const { data: jobRow, error: jobErr } = await admin
        .from("gob_jobs")
        .select("*")
        .eq("type", "source_ingest")
        .filter("payload->>snapshot_id", "eq", snapshotId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (jobErr) throw new Error(`job lookup failed: ${jobErr.message}`)
      if (!jobRow) throw new Error("source_ingest job not found")
      createdJobIds.push(String((jobRow as any).id))

      await ingestSourceJob({ supabase: admin, job: jobRow })
      // eslint-disable-next-line no-console
      console.log(`[smoke] source_ingest completed for snapshot=${snapshotId.slice(0, 8)}`)

      // Verify shared source list from workspace B includes source from workspace A.
      const sharedList = await httpJson({
        baseUrl,
        jar,
        method: "GET",
        path: `/api/workspaces/${workspaceB}/sources`,
      })
      if (!sharedList.res.ok) {
        throw new Error(`sources list failed: ${sharedList.res.status} ${sharedList.text}`)
      }
      const listRows = Array.isArray(sharedList.json?.sources) ? sharedList.json.sources : []
      const hasSharedFromA = listRows.some((row: any) => String(row?.workspace_id || "") === workspaceA)
      if (!hasSharedFromA) {
        throw new Error("shared sources check failed: workspace B did not list source from workspace A")
      }
      // eslint-disable-next-line no-console
      console.log("[smoke] shared sources visible across projects")

      // 10) Generate report in workspace B via API (enqueues report_generate job)
      const genResp = await httpJson({
        baseUrl,
        jar,
        method: "POST",
        path: `/api/workspaces/${workspaceB}/reports/generate`,
        body: { template: "informe-evaluacion" },
      })
      if (!genResp.res.ok) {
        throw new Error(`report generate API failed: ${genResp.res.status} ${genResp.text}`)
      }
      const newReportId = String(genResp.json?.id || "")
      if (!newReportId) throw new Error("new report id missing")
      createdReportIds.push(newReportId)

      const { data: reportJob, error: reportJobErr } = await admin
        .from("gob_jobs")
        .select("*")
        .eq("type", "report_generate")
        .filter("payload->>report_id", "eq", newReportId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (reportJobErr) throw new Error(`report job lookup failed: ${reportJobErr.message}`)
      if (!reportJob) throw new Error("report_generate job not found")
      createdJobIds.push(String((reportJob as any).id))

      await reportGenerateJob({ supabase: admin, job: reportJob })
      // eslint-disable-next-line no-console
      console.log(`[smoke] report_generate completed report=${newReportId.slice(0, 8)}`)

      // Restore provider
      if (typeof prevRagProvider === "string") process.env.RAG_PROVIDER = prevRagProvider
      else delete (process.env as any).RAG_PROVIDER
      if (typeof prevAnswerProvider === "string") process.env.RAG_ANSWER_PROVIDER = prevAnswerProvider
      else delete (process.env as any).RAG_ANSWER_PROVIDER

      // 11) Validate generated report content
      const { data: reportRow, error: repErr } = await admin
        .from("gob_reports")
        .select("id,workspace_id,status,content_json,citations")
        .eq("id", newReportId)
        .eq("workspace_id", workspaceB)
        .maybeSingle()
      if (repErr) throw new Error(`report fetch failed: ${repErr.message}`)
      if (!reportRow) throw new Error("generated report row missing")

      const generationStatus = String((reportRow as any)?.content_json?.generation?.status || "")
      if (generationStatus !== "completed") {
        throw new Error(`expected generation.status=completed, got ${generationStatus}`)
      }

      const outSections = Array.isArray((reportRow as any)?.content_json?.sections)
        ? ((reportRow as any).content_json.sections as any[])
        : []
      if (outSections.length < 6) {
        throw new Error(`expected >=6 sections, got ${outSections.length}`)
      }

      const precedents = (reportRow as any)?.content_json?.annexes?.precedents
      if (!Array.isArray(precedents) || precedents.length === 0) {
        throw new Error("expected precedents in annexes")
      }
      // eslint-disable-next-line no-console
      console.log(`[smoke] precedents count=${precedents.length}`)

      // 12) Fetch report page HTML as authenticated user
      {
        const res = await fetch(`${baseUrl}/workspaces/${workspaceB}/reports/${newReportId}`, {
          headers: { cookie: buildCookieHeader(jar) },
          redirect: "manual",
        })
        const html = await res.text()
        if (!res.ok) throw new Error(`report page failed: ${res.status}`)
        if (!html.includes("Precedentes")) {
          throw new Error("report page did not render precedents section")
        }
      }

      // 13) Smoke: watchlists page renders
      {
        const res = await fetch(`${baseUrl}/workspaces/${workspaceB}/watchlists`, {
          headers: { cookie: buildCookieHeader(jar) },
          redirect: "manual",
        })
        if (!res.ok) throw new Error(`watchlists page failed: ${res.status}`)
      }

      // eslint-disable-next-line no-console
      console.log("[smoke] OK")

      // Cleanup
      if (cleanupEnabled) {
        for (const id of createdJobIds) {
          try {
            await admin.from("gob_jobs").delete().eq("id", id)
          } catch {
            // ignore
          }
        }
        for (const ws of createdWorkspaceIds) {
          try {
            await admin.from("gob_workspaces").delete().eq("id", ws)
          } catch {
            // ignore
          }
        }
        await admin.auth.admin.deleteUser(userId).catch(() => null)
        // eslint-disable-next-line no-console
        console.log("[smoke] cleaned up")
      } else {
        // eslint-disable-next-line no-console
        console.log("[smoke] cleanup skipped (SMOKE_SKIP_CLEANUP set)")
      }
    } catch (err) {
      // Best-effort cleanup on failure
      if (cleanupEnabled) {
        const admin = createAdminClient()
        for (const id of createdJobIds) {
          try {
            await admin.from("gob_jobs").delete().eq("id", id)
          } catch {
            // ignore
          }
        }
        for (const ws of createdWorkspaceIds) {
          try {
            await admin.from("gob_workspaces").delete().eq("id", ws)
          } catch {
            // ignore
          }
        }
        await admin.auth.admin.deleteUser(userId).catch(() => null)
      }
      throw err
    }
  } finally {
    await stopNextServer(server)
  }
}

main().catch((err: any) => {
  // eslint-disable-next-line no-console
  console.error("[smoke] FAILED", err?.message ?? String(err))
  process.exit(1)
})
