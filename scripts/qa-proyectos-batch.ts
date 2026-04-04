import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

import "dotenv/config"

type BatchCase = {
  label?: string
  pdfPath: string
  rol: string
  tribunal?: string
  caratula?: string
  titlePrefix?: string
}

type BatchConfig = {
  appUrl?: string
  reportDir?: string
  cases: BatchCase[]
}

type CaseResult = {
  caseLabel: string
  startedAt: string
  finishedAt: string
  durationMs: number
  workspaceId: string | null
  recommendStatus: number | null
  recommendationCount: number
  onboardingCompleted: boolean
  success: boolean
  warnings: string[]
  markdownReportPath: string
  screenshotPath: string | null
}

function nowIsoCompact() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function safeText(value: unknown, max = 220) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > max ? `${text.slice(0, max)}...` : text
}

async function waitForApp(appUrl: string, timeoutMs = 25_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${appUrl}/login`, { method: "GET" })
      if (res.ok || res.status === 401 || res.status === 302) return true
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1200))
  }
  return false
}

function loadConfig(configPath: string): BatchConfig {
  const raw = fs.readFileSync(configPath, "utf8")
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as any).cases)) {
    throw new Error("Config invalida: debe tener { cases: [] }")
  }
  return {
    appUrl: typeof (parsed as any).appUrl === "string" ? (parsed as any).appUrl : undefined,
    reportDir: typeof (parsed as any).reportDir === "string" ? (parsed as any).reportDir : undefined,
    cases: (parsed as any).cases,
  }
}

function resolvePdfPath(baseDir: string, value: string) {
  if (path.isAbsolute(value)) return path.normalize(value)

  const fromConfigDir = path.resolve(baseDir, value)
  if (fs.existsSync(fromConfigDir)) return path.normalize(fromConfigDir)

  const fromCwd = path.resolve(process.cwd(), value)
  return path.normalize(fromCwd)
}

function quoteArg(value: string) {
  const escaped = String(value).replace(/"/g, '\\"')
  return `"${escaped}"`
}

function runCase(params: {
  appUrl: string
  reportDir: string
  item: BatchCase
  caseIndex: number
  configDir: string
}) {
  const tribunal = String(params.item.tribunal || "1TA").trim() || "1TA"
  const caratula = String(params.item.caratula || "").trim() || "Causa tribunal ambiental"
  const titlePrefix = String(params.item.titlePrefix || "E2E Batch Marco Teorico").trim()

  const pdfPath = resolvePdfPath(params.configDir, String(params.item.pdfPath || ""))
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`Caso ${params.caseIndex + 1}: no existe PDF ${pdfPath}`)
  }

  const caseSlug = `${String(params.item.rol || "sin-rol").replace(/[^a-zA-Z0-9_-]/g, "_")}_${params.caseIndex + 1}`
  const jsonOut = path.resolve(params.reportDir, `resultado_${caseSlug}.json`)

  const args = [
    "run",
    "e2e:proyectos",
    "--",
    "--app-url",
    params.appUrl,
    "--pdf",
    pdfPath,
    "--rol",
    String(params.item.rol || "").trim(),
    "--tribunal",
    tribunal,
    "--caratula",
    caratula,
    "--title-prefix",
    titlePrefix,
    "--report-dir",
    params.reportDir,
    "--json-out",
    jsonOut,
  ]

  const command = `npm ${args.map((x) => quoteArg(String(x))).join(" ")}`

  const child = spawnSync(command, {
    cwd: process.cwd(),
    shell: true,
    stdio: "inherit",
    env: process.env,
    timeout: 20 * 60_000,
  })

  if (child.error) {
    throw child.error
  }

  if (child.status !== 0) {
    throw new Error(`Caso ${params.caseIndex + 1} termino con codigo ${child.status}`)
  }

  if (!fs.existsSync(jsonOut)) {
    throw new Error(`Caso ${params.caseIndex + 1}: no se encontro salida JSON ${jsonOut}`)
  }

  const result = JSON.parse(fs.readFileSync(jsonOut, "utf8")) as CaseResult
  return result
}

async function main() {
  const configArg = process.argv[2] && !String(process.argv[2]).startsWith("--") ? process.argv[2] : "qa/proyectos-cases.json"
  const configPath = path.resolve(configArg)
  if (!fs.existsSync(configPath)) {
    throw new Error(`No existe archivo de configuracion: ${configPath}`)
  }

  const configDir = path.dirname(configPath)
  const config = loadConfig(configPath)
  if (!config.cases.length) {
    throw new Error("No hay casos en la configuracion")
  }

  const appUrl = String(config.appUrl || process.env.E2E_APP_URL || "http://localhost:9002")
    .trim()
    .replace(/\/+$/, "")

  const appReady = await waitForApp(appUrl, 25_000)
  if (!appReady) {
    throw new Error(`La app no responde en ${appUrl}. Inicia 'npm run dev' antes de correr QA batch.`)
  }

  const runId = nowIsoCompact()
  const baseReportDir = path.resolve(config.reportDir || path.resolve(process.cwd(), "reports", `batch_${runId}`))
  fs.mkdirSync(baseReportDir, { recursive: true })

  const markdown: string[] = []
  markdown.push("# QA Batch - Sistema de Proyectos")
  markdown.push("")
  markdown.push(`- Config: ${configPath}`)
  markdown.push(`- App URL: ${appUrl}`)
  markdown.push(`- Inicio: ${new Date().toISOString()}`)
  markdown.push("")

  const results: Array<CaseResult & { error?: string; index: number; rol: string }> = []

  for (let i = 0; i < config.cases.length; i += 1) {
    const item = config.cases[i]
    const rol = String(item.rol || "").trim()
    markdown.push(`## Caso ${i + 1}: ${item.label || rol || "sin etiqueta"}`)
    markdown.push(`- Rol: ${rol || "N/A"}`)
    markdown.push(`- PDF: ${safeText(item.pdfPath, 400)}`)

    try {
      const result = runCase({
        appUrl,
        reportDir: baseReportDir,
        item,
        caseIndex: i,
        configDir,
      })
      results.push({ ...result, index: i + 1, rol })

      markdown.push(`- Resultado: ${result.success ? "OK" : "FAIL"}`)
      markdown.push(`- Workspace: ${result.workspaceId || "N/A"}`)
      markdown.push(`- Recommend status: ${result.recommendStatus ?? "N/A"}`)
      markdown.push(`- Recomendaciones: ${result.recommendationCount}`)
      markdown.push(`- Onboarding completado: ${result.onboardingCompleted ? "si" : "no"}`)
      markdown.push(`- Duracion: ${(result.durationMs / 1000).toFixed(1)}s`)
      markdown.push(`- Reporte caso: ${result.markdownReportPath}`)
    } catch (err: any) {
      const errorMessage = safeText(err?.message || String(err), 500)
      results.push({
        caseLabel: item.label || rol || `Caso ${i + 1}`,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        workspaceId: null,
        recommendStatus: null,
        recommendationCount: 0,
        onboardingCompleted: false,
        success: false,
        warnings: [errorMessage],
        markdownReportPath: "",
        screenshotPath: null,
        error: errorMessage,
        index: i + 1,
        rol,
      })
      markdown.push(`- Resultado: FAIL`)
      markdown.push(`- Error: ${errorMessage}`)
    }

    markdown.push("")
  }

  const successCount = results.filter((r) => r.success).length
  const failCount = results.length - successCount
  const avgDurationMs =
    results.length > 0
      ? Math.round(results.reduce((acc, row) => acc + Number(row.durationMs || 0), 0) / results.length)
      : 0
  const totalRecommendations = results.reduce((acc, row) => acc + Number(row.recommendationCount || 0), 0)

  markdown.push("## Resumen Ejecutivo")
  markdown.push(`- Casos ejecutados: ${results.length}`)
  markdown.push(`- Exitosos: ${successCount}`)
  markdown.push(`- Fallidos: ${failCount}`)
  markdown.push(`- Duracion promedio: ${(avgDurationMs / 1000).toFixed(1)}s`)
  markdown.push(`- Recomendaciones totales: ${totalRecommendations}`)
  markdown.push("")
  markdown.push("## Mejoras sugeridas")

  if (failCount > 0) {
    markdown.push("- Endurecer pre-check de login/sesion antes de navegar a /projects/new en pruebas automáticas.")
    markdown.push("- Guardar evidencia de error de endpoint (status + body) para cada caso fallido.")
  }
  markdown.push("- Incorporar este batch en CI nocturno con alerta si la tasa de exito baja de 90%.")
  markdown.push("- Agregar matriz de casos por tema (agua, ruido, consulta indigena) para medir calidad de marco teorico.")
  markdown.push("- Agregar validacion post-onboarding: calidad minima del resumen (longitud + citas + top causas).")

  const summaryMdPath = path.resolve(baseReportDir, `qa_proyectos_batch_${runId}.md`)
  const summaryJsonPath = path.resolve(baseReportDir, `qa_proyectos_batch_${runId}.json`)
  fs.writeFileSync(summaryMdPath, markdown.join("\n"), "utf8")
  fs.writeFileSync(
    summaryJsonPath,
    JSON.stringify(
      {
        runId,
        appUrl,
        configPath,
        successCount,
        failCount,
        avgDurationMs,
        totalRecommendations,
        results,
      },
      null,
      2
    ),
    "utf8"
  )

  console.log(`\nBatch finalizado. Reporte: ${summaryMdPath}`)
  console.log(`JSON: ${summaryJsonPath}`)
}

main().catch((err) => {
  console.error("QA batch fallo:", err)
  process.exit(1)
})
