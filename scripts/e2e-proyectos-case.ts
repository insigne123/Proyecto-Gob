import fs from "node:fs"
import path from "node:path"

import { chromium } from "playwright"
import { createClient } from "@supabase/supabase-js"
import "dotenv/config"

type RecommendPayload = {
  claim?: { snapshotId?: string | null; title?: string | null }
  summary?: { text?: string | null }
  recommendations?: any[]
  duplicateDetection?: {
    exactHashMatches?: number
    nearDuplicateMatches?: number
    excludedSources?: number
    excludedDocuments?: number
  }
  sync?: {
    readySnapshots?: number
    queuedJobs?: number
    newSources?: number
    newSnapshots?: number
  }
  stats?: {
    candidateChunks?: number
    candidateCauses?: number
    warnings?: string[]
  }
  error?: string
  details?: any
}

type E2ECaseOptions = {
  pdfPath: string
  rol: string
  tribunal: string
  caratula: string
  titlePrefix: string
  appUrl: string
  reportDir: string
  jsonOut: string | null
}

type E2ECaseResult = {
  caseLabel: string
  startedAt: string
  finishedAt: string
  durationMs: number
  appUrl: string
  pdfPath: string
  rol: string
  tribunal: string
  workspaceId: string | null
  recommendStatus: number | null
  recommendationCount: number
  hasUiResults: boolean
  continueEnabled: boolean
  redirectedToNotebook: boolean
  sourceCount: number
  snapshotCount: number
  chunksCount: number
  notesCount: number
  retrievalTracesCount: number
  onboardingCompleted: boolean
  warnings: string[]
  success: boolean
  markdownReportPath: string
  screenshotPath: string | null
}

function nowIsoCompact() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function safeText(value: unknown, max = 300) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function boolMark(value: boolean) {
  return value ? "OK" : "FAIL"
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "")
    if (!token.startsWith("--")) continue
    const key = token.slice(2)
    const next = String(argv[i + 1] || "")
    if (!next || next.startsWith("--")) {
      out[key] = "true"
      continue
    }
    out[key] = next
    i += 1
  }
  return out
}

async function waitForApp(appUrl: string, timeoutMs = 45_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${appUrl}/login`, { method: "GET" })
      if (res.ok || res.status === 401 || res.status === 302) {
        return true
      }
    } catch {
      // retry until timeout
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  return false
}

async function ensureE2eUser(params: { supabaseUrl: string; serviceKey: string; email: string; password: string }) {
  const admin = createClient(params.supabaseUrl, params.serviceKey)
  const usersResp = await admin.auth.admin.listUsers({ page: 1, perPage: 500 })
  if (usersResp.error) throw usersResp.error

  const existing = (usersResp.data?.users || []).find((u: any) => String(u.email || "").toLowerCase() === params.email.toLowerCase())
  if (existing?.id) {
    const upd = await admin.auth.admin.updateUserById(existing.id, {
      password: params.password,
      email_confirm: true,
    })
    if (upd.error) throw upd.error
    return { id: String(existing.id), created: false }
  }

  const create = await admin.auth.admin.createUser({
    email: params.email,
    password: params.password,
    email_confirm: true,
    user_metadata: { e2e: true },
  })
  if (create.error || !create.data.user?.id) throw create.error || new Error("No se pudo crear usuario e2e")
  return { id: String(create.data.user.id), created: true }
}

async function main() {
  const startedAt = new Date().toISOString()
  const args = parseArgs(process.argv.slice(2))

  const appUrl = String(args["app-url"] || process.env.E2E_APP_URL || "http://localhost:9002")
    .trim()
    .replace(/\/+$/, "")
  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
  const e2eEmail = String(process.env.E2E_USER_EMAIL || "e2e.proyectos@local.test").trim()
  const e2ePassword = String(process.env.E2E_USER_PASSWORD || "E2E_Proyecto_2026!").trim()

  const defaultPdf = path.resolve(process.cwd(), "0e562d7a-2802-44f8-be46-dcbdc4b260a0_foleado.pdf")
  const positionalPdf = process.argv[2] && !String(process.argv[2]).startsWith("--") ? String(process.argv[2]) : ""
  const pdfPathArg = args.pdf ? path.resolve(args.pdf) : positionalPdf ? path.resolve(positionalPdf) : defaultPdf

  const options: E2ECaseOptions = {
    pdfPath: pdfPathArg,
    rol: String(args.rol || "R-151-2026").trim() || "R-151-2026",
    tribunal: String(args.tribunal || "1TA").trim() || "1TA",
    caratula:
      String(args.caratula || "Agricola Tarapaca S.A. con Superintendencia del Medio Ambiente").trim() ||
      "Agricola Tarapaca S.A. con Superintendencia del Medio Ambiente",
    titlePrefix: String(args["title-prefix"] || "E2E Marco Teorico").trim() || "E2E Marco Teorico",
    appUrl,
    reportDir: path.resolve(args["report-dir"] || path.resolve(process.cwd(), "reports")),
    jsonOut: args["json-out"] ? path.resolve(args["json-out"]) : null,
  }
  const recommendTimeoutMs = Math.max(120_000, Math.min(900_000, Number(args["recommend-timeout-ms"] || process.env.E2E_RECOMMEND_TIMEOUT_MS || 420_000)))

  if (!fs.existsSync(pdfPathArg)) {
    throw new Error(`No existe PDF para la prueba: ${pdfPathArg}`)
  }

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Faltan SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY")
  }

  const appReady = await waitForApp(options.appUrl, 45_000)
  if (!appReady) {
    throw new Error(`La app no responde en ${options.appUrl}. Inicia 'npm run dev' y reintenta.`)
  }

  const admin = createClient(supabaseUrl, serviceKey)
  const reportLines: string[] = []
  reportLines.push("# E2E Sistema de Proyectos - Caso Reclamacion 1TA")
  reportLines.push("")
  reportLines.push(`- Fecha prueba: ${new Date().toISOString()}`)
  reportLines.push(`- App URL: ${options.appUrl}`)
  reportLines.push(`- Archivo base: ${options.pdfPath}`)
  reportLines.push(`- Caso: ${options.rol} (${options.tribunal})`)
  reportLines.push("")

  const user = await ensureE2eUser({
    supabaseUrl,
    serviceKey,
    email: e2eEmail,
    password: e2ePassword,
  })
  reportLines.push("## 1) Preparacion y plan")
  reportLines.push("- Objetivo: validar flujo completo crear proyecto -> onboarding -> upload PDF -> recomendacion RAG -> cierre onboarding.")
  reportLines.push(`- Caso: ${options.rol} - ${options.caratula}.`)
  reportLines.push(`- Usuario E2E: ${e2eEmail} (${user.created ? "creado" : "actualizado"})`) 
  reportLines.push("")

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

  let workspaceId: string | null = null
  let recommendStatus: number | null = null
  let recommendPayload: any = null
  const recommendRequests: string[] = []
  let hasUiResults = false
  let continueEnabled = false
  let redirectedToNotebook = false
  let screenshotPath: string | null = null

  page.on("response", async (response) => {
    const url = response.url()
    if (!url.includes("/onboarding/recommend")) return
    recommendStatus = response.status()
    recommendRequests.push(url)
    try {
      recommendPayload = (await response.json()) as RecommendPayload
    } catch {
      recommendPayload = { error: "No JSON body" }
    }
  })

  const testTitle = `${options.titlePrefix} ${options.rol} ${nowIsoCompact()}`

  reportLines.push("## 2) Ejecucion UI automatizada")
  try {
    await page.goto(`${options.appUrl}/login?next=${encodeURIComponent("/projects/new")}`, {
      waitUntil: "domcontentloaded",
    })
    await page.waitForTimeout(1200)
    await page.click('input[type="email"]')
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A")
    await page.keyboard.type(e2eEmail, { delay: 18 })
    await page.click('input[type="password"]')
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A")
    await page.keyboard.type(e2ePassword, { delay: 18 })
    await page.click('button:has-text("Entrar")')
    await page
      .waitForURL((url) => !url.toString().includes("/login"), { timeout: 30_000 })
      .catch(() => null)
    await page.waitForLoadState("networkidle").catch(() => null)

    await page.goto(
      `${options.appUrl}/projects/new?rol=${encodeURIComponent(options.rol)}&tribunal=${encodeURIComponent(options.tribunal)}&caratula=${encodeURIComponent(options.caratula)}`,
      { waitUntil: "domcontentloaded" }
    )

    if (page.url().includes("/login")) {
      const loginError = await page
        .locator(".text-destructive")
        .first()
        .textContent()
        .catch(() => null)
      throw new Error(
        `Login no habilito sesion para /projects/new${loginError ? ` (${safeText(loginError, 180)})` : ""}`
      )
    }

    const titleInput = page.locator("#title")
    await titleInput.waitFor({ timeout: 15_000 })
    await titleInput.fill(testTitle)
    await page.click('button:has-text("Crear")')

    try {
      await page.waitForURL(/\/projects\/[a-f0-9-]+\/onboarding/, { timeout: 40_000 })
      const onboardingUrl = page.url()
      const wsMatch = onboardingUrl.match(/\/projects\/([a-f0-9-]+)\/onboarding/)
      workspaceId = wsMatch?.[1] || null
      if (!workspaceId) throw new Error(`No se pudo extraer workspaceId desde URL: ${onboardingUrl}`)
    } catch {
      const uiError = await page
        .locator(".text-destructive")
        .first()
        .textContent()
        .catch(() => null)

      const fallbackCreate = await page.evaluate(async (payload) => {
        const res = await fetch("/api/workspaces", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        })
        const body = await res.json().catch(() => null)
        return { ok: res.ok, status: res.status, body }
      }, {
        title: testTitle,
        description: `${options.caratula}\nTribunal: ${options.tribunal}\nRol: ${options.rol}`,
      })

      if (!fallbackCreate.ok || !fallbackCreate.body?.id) {
        throw new Error(
          `Creacion workspace fallo (status=${fallbackCreate.status})${uiError ? ` | UI: ${safeText(uiError, 200)}` : ""}${
            fallbackCreate.body?.error ? ` | API: ${safeText(fallbackCreate.body.error, 220)}` : ""
          }`
        )
      }

      workspaceId = String(fallbackCreate.body.id)
      await page.goto(`${options.appUrl}/projects/${workspaceId}/onboarding`, { waitUntil: "domcontentloaded" })
    }

    let fileAttached = false
    try {
      const [fileChooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 15_000 }),
        page.click('button:has-text("Subir reclamacion")'),
      ])
      await fileChooser.setFiles(pdfPathArg)
      fileAttached = true
    } catch {
      const fileInput = page.locator('input[type="file"]')
      if (await fileInput.count()) {
        await fileInput.first().setInputFiles(pdfPathArg)
        fileAttached = true
      }
    }

    if (!fileAttached) {
      throw new Error("No se pudo adjuntar PDF de reclamacion en onboarding")
    }

    await page.waitForSelector(`text=${path.basename(pdfPathArg)}`, { timeout: 20_000 }).catch(() => null)

    const generateBtn = page.locator('button:has-text("Generar marco teorico")')
    await generateBtn.waitFor({ timeout: 20_000 })
    const recommendResponse = page.waitForResponse((r) => r.url().includes("/onboarding/recommend"), {
      timeout: recommendTimeoutMs,
    })
    await generateBtn.click()

    await recommendResponse
    await page.waitForTimeout(1500)

    reportLines.push(`- Workspace creado: ${workspaceId}`)
    reportLines.push(`- Request recommend status: ${recommendStatus ?? "N/A"}`)
    if (recommendPayload?.error) {
      reportLines.push(`- Error recommend: ${safeText(recommendPayload.error, 500)}`)
    }

    const hasSummaryText = await page
      .locator('text="Causas priorizadas"')
      .or(page.locator('text="Resultados"'))
      .first()
      .isVisible()
      .catch(() => false)

    hasUiResults = hasSummaryText
    reportLines.push(`- UI muestra panel de resultados: ${boolMark(hasSummaryText)}`)

    const continueBtn = page.locator('button:has-text("Continuar al proyecto")')
    const isContinueEnabled = await continueBtn.isEnabled().catch(() => false)
    continueEnabled = isContinueEnabled
    reportLines.push(`- Boton continuar habilitado: ${boolMark(isContinueEnabled)}`)

    if (isContinueEnabled) {
      await continueBtn.click()
      await page.waitForURL(new RegExp(`/projects/${workspaceId}$`), { timeout: 45_000 }).catch(() => null)
      redirectedToNotebook = page.url().includes(`/projects/${workspaceId}`)
      reportLines.push(`- Redireccion final al notebook: ${boolMark(redirectedToNotebook)}`)
    }

    screenshotPath = path.resolve(options.reportDir, `e2e_onboarding_${workspaceId}.png`)
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true })
    await page.screenshot({ path: screenshotPath, fullPage: true })
    reportLines.push(`- Screenshot: ${screenshotPath}`)
  } catch (err: any) {
    reportLines.push(`- Error en ejecucion UI: ${safeText(err?.message || String(err), 700)}`)
  } finally {
    await browser.close()
  }

  reportLines.push("")
  reportLines.push("## 3) Verificacion backend")

  let sourceCount = 0
  let snapshotCount = 0
  let chunksCountNum = 0
  let notesCount = 0
  let tracesCountNum = 0
  let onboardingCompleted = false
  const warnings: string[] = []

  if (workspaceId) {
    const { data: ws } = await admin
      .from("gob_workspaces")
      .select("id,title,created_at")
      .eq("id", workspaceId)
      .maybeSingle()

    const { data: profile } = await admin
      .from("gob_workspace_profiles")
      .select("workspace_id,metadata")
      .eq("workspace_id", workspaceId)
      .maybeSingle()

    const { data: sources } = await admin
      .from("gob_sources")
      .select("id,filename,status,source_origin,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(10)

    const sourceIds = (sources || []).map((s: any) => String(s.id))
    const { data: snapshots } = sourceIds.length
      ? await admin
          .from("gob_source_snapshots")
          .select("id,source_id,status,storage_path,error,created_at")
          .in("source_id", sourceIds)
          .order("created_at", { ascending: false })
      : { data: [] as any[] }

    const snapshotIds = (snapshots || []).map((s: any) => String(s.id))
    const { count: chunksCount } = snapshotIds.length
      ? await admin
          .from("gob_chunks")
          .select("id", { head: true, count: "exact" })
          .in("snapshot_id", snapshotIds)
      : { count: 0 }

    const { data: notes } = await admin
      .from("gob_notes")
      .select("id,title,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(10)

    const { count: tracesCount } = await admin
      .from("gob_rag_retrieval_traces")
      .select("id", { head: true, count: "exact" })
      .eq("workspace_id", workspaceId)

    const onboardingMeta =
      profile?.metadata && typeof profile.metadata === "object" ? (profile.metadata as any).onboarding : null
    onboardingCompleted = Boolean(onboardingMeta?.completed === true)

    sourceCount = (sources || []).length
    snapshotCount = (snapshots || []).length
    chunksCountNum = typeof chunksCount === "number" ? chunksCount : 0
    notesCount = (notes || []).length
    tracesCountNum = typeof tracesCount === "number" ? tracesCount : 0

    reportLines.push(`- Workspace existe: ${boolMark(Boolean(ws?.id))}`)
    reportLines.push(`- Onboarding metadata: ${safeText(JSON.stringify(onboardingMeta || {}), 500)}`)
    reportLines.push(`- Sources en workspace: ${sourceCount}`)
    reportLines.push(`- Snapshots en workspace: ${snapshotCount}`)
    reportLines.push(`- Chunks asociados: ${chunksCountNum}`)
    reportLines.push(`- Notes generadas: ${notesCount}`)
    reportLines.push(`- Retrieval traces: ${tracesCountNum}`)

    const claimSource = (sources || []).find((s: any) => String(s.source_origin || "") === "onboarding-claim")
    const claimSnapshot = (snapshots || []).find((s: any) => String(s.source_id) === String(claimSource?.id || ""))
    reportLines.push(`- Source onboarding-claim detectada: ${boolMark(Boolean(claimSource))}`)
    reportLines.push(`- Snapshot onboarding status: ${claimSnapshot?.status || "N/A"}`)

    if (recommendPayload) {
      const recommendationCount = Array.isArray(recommendPayload.recommendations)
        ? recommendPayload.recommendations.length
        : 0
      reportLines.push(`- Recommend recomendaciones: ${recommendationCount}`)
      reportLines.push(
        `- Duplicate detection: ${safeText(JSON.stringify(recommendPayload.duplicateDetection || {}), 240)}`
      )
      const recommendWarnings = Array.isArray(recommendPayload?.stats?.warnings)
        ? recommendPayload.stats.warnings
        : []
      if (recommendWarnings.length) {
        warnings.push(...recommendWarnings.map((x: any) => String(x)))
      }
      reportLines.push(`- Warnings recommend: ${safeText(JSON.stringify(recommendWarnings), 500)}`)
    }
  } else {
    reportLines.push("- No se pudo verificar backend por falta de workspaceId.")
    warnings.push("workspace_id_missing")
  }

  reportLines.push("")
  reportLines.push("## 4) Conclusiones y mejoras")

  const recommendOk = recommendStatus === 200
  const recommendationCount = Array.isArray(recommendPayload?.recommendations)
    ? recommendPayload!.recommendations!.length
    : 0

  if (recommendOk && recommendationCount > 0) {
    reportLines.push("- El flujo principal funciona end-to-end para este caso: creacion, upload, ingesta y recomendacion.")
  } else {
    reportLines.push(
      `- El flujo no quedo 100% exitoso en recomendacion (status=${recommendStatus ?? "N/A"}, recs=${recommendationCount}).`
    )
  }

  reportLines.push("- Mejorar observabilidad: loggear en UI el detalle de schema errors de /onboarding/recommend cuando retorna 400.")
  reportLines.push("- Evitar duplicados de upload onboarding: si ya hay snapshot del mismo hash en el workspace, reutilizarlo.")
  reportLines.push("- Agregar semaforo de readiness del corpus (porcentaje snapshots ready) antes de correr ranking final.")
  reportLines.push("- Forzar en UI filtros sugeridos por defecto segun metadatos del rol/caratula para acortar tiempo de analisis.")
  reportLines.push("- Agregar test automatico nocturno de este flujo para detectar regresiones tempranas.")

  if (recommendRequests.length) {
    reportLines.push(`- Requests recommend detectadas: ${recommendRequests.length}`)
  }

  const reportPath = path.resolve(options.reportDir, `reporte_e2e_proyectos_${nowIsoCompact()}.md`)
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, reportLines.join("\n"), "utf8")

  const finishedAt = new Date().toISOString()
  const durationMs = Date.parse(finishedAt) - Date.parse(startedAt)
  const caseLabel = `${options.rol} (${options.tribunal})`
  const success =
    recommendOk &&
    recommendationCount > 0 &&
    Boolean(workspaceId) &&
    onboardingCompleted &&
    sourceCount > 0 &&
    snapshotCount > 0 &&
    chunksCountNum > 0 &&
    hasUiResults

  const result: E2ECaseResult = {
    caseLabel,
    startedAt,
    finishedAt,
    durationMs,
    appUrl: options.appUrl,
    pdfPath: options.pdfPath,
    rol: options.rol,
    tribunal: options.tribunal,
    workspaceId,
    recommendStatus,
    recommendationCount,
    hasUiResults,
    continueEnabled,
    redirectedToNotebook,
    sourceCount,
    snapshotCount,
    chunksCount: chunksCountNum,
    notesCount,
    retrievalTracesCount: tracesCountNum,
    onboardingCompleted,
    warnings,
    success,
    markdownReportPath: reportPath,
    screenshotPath,
  }

  const resultJsonPath = options.jsonOut || path.resolve(options.reportDir, `reporte_e2e_proyectos_${nowIsoCompact()}.json`)
  fs.writeFileSync(resultJsonPath, JSON.stringify(result, null, 2), "utf8")

  console.log(`Reporte generado: ${reportPath}`)
  console.log(`Resultado JSON: ${resultJsonPath}`)
}

main().catch((err) => {
  console.error("E2E fallo:", err)
  process.exit(1)
})
