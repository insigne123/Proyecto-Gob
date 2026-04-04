import fs from "node:fs"
import path from "node:path"

import { createClient } from "@supabase/supabase-js"
import "dotenv/config"

type LocalFile = {
  absPath: string
  relPath: string
  ext: "pdf" | "html"
}

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim()
}

function inferDocType(name: string) {
  const n = normalizeText(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
  if (n.includes("sentencia")) return "Sentencia"
  if (n.includes("informe")) return "Evacua informe"
  if (n.includes("reclam") || n.includes("demanda") || n.includes("escrito inicial")) {
    return "Reclamacion"
  }
  return "Documento"
}

function inferYear(name: string) {
  const match = String(name).match(/(19\d{2}|20\d{2})/)
  if (!match) return null
  const y = Number(match[1])
  if (!Number.isFinite(y) || y < 1900 || y > 2200) return null
  return y
}

function walkFiles(rootDir: string, out: LocalFile[], base = rootDir) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true })
  for (const entry of entries) {
    const abs = path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      walkFiles(abs, out, base)
      continue
    }

    const extRaw = path.extname(entry.name).toLowerCase()
    const ext = extRaw === ".pdf" ? "pdf" : extRaw === ".html" || extRaw === ".htm" ? "html" : null
    if (!ext) continue

    out.push({
      absPath: abs,
      relPath: path.relative(base, abs).replace(/\\/g, "/"),
      ext,
    })
  }
}

async function main() {
  const workspaceId = normalizeText(process.argv[2])
  const datasetDir = normalizeText(process.argv[3] || process.env.PASANTE_DATASET_DIR)
  const limitRaw = Number(process.argv[4] || process.env.PASANTE_DATASET_LIMIT || 0)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 0

  if (!workspaceId) {
    throw new Error("Uso: tsx scripts/import-pasante-dataset.ts <workspaceId> [datasetDir] [limit]")
  }
  if (!datasetDir) {
    throw new Error("Falta datasetDir (argumento 2 o PASANTE_DATASET_DIR)")
  }
  if (!fs.existsSync(datasetDir)) {
    throw new Error(`No existe directorio dataset: ${datasetDir}`)
  }

  const supabaseUrl = normalizeText(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)
  const serviceKey = normalizeText(process.env.SUPABASE_SERVICE_ROLE_KEY)
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Faltan SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY")
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  const { data: workspace, error: workspaceErr } = await supabase
    .from("gob_workspaces")
    .select("id,title")
    .eq("id", workspaceId)
    .maybeSingle()

  if (workspaceErr || !workspace) {
    throw new Error(workspaceErr?.message || `Workspace no encontrado: ${workspaceId}`)
  }

  const allFiles: LocalFile[] = []
  walkFiles(datasetDir, allFiles)

  const files = limit > 0 ? allFiles.slice(0, limit) : allFiles
  if (!files.length) {
    console.log("No se encontraron PDF/HTML para importar.")
    return
  }

  console.log(`Importando ${files.length} archivos al workspace ${workspaceId}...`)

  let created = 0
  let skipped = 0
  let queued = 0

  for (const file of files) {
    const filename = path.basename(file.relPath)
    const title = normalizeText(filename.replace(path.extname(filename), ""))
    const storageExt = file.ext === "pdf" ? "pdf" : "html"
    const now = new Date().toISOString()

    const sourceOrigin = "pasante-dataset"
    const year = inferYear(filename)
    const docType = inferDocType(filename)

    const pseudoUrl = `local-dataset://${file.relPath}`
    const { data: existing } = await supabase
      .from("gob_sources")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("url", pseudoUrl)
      .maybeSingle()

    if (existing?.id) {
      skipped += 1
      continue
    }

    const { data: source, error: sourceErr } = await supabase
      .from("gob_sources")
      .insert({
        workspace_id: workspaceId,
        kind: "upload",
        url: pseudoUrl,
        filename,
        title,
        doc_type: docType,
        year,
        region: null,
        sector: null,
        project_name: workspace.title || null,
        source_origin: sourceOrigin,
        language: "es",
        attributes: {
          dataset: "pasante",
          rel_path: file.relPath,
        },
        status: "pending",
        created_by: null,
        updated_at: now,
      })
      .select("id")
      .single()

    if (sourceErr || !source?.id) {
      console.log(`- Error source ${file.relPath}: ${sourceErr?.message || "insert failed"}`)
      continue
    }

    const { data: snapshot, error: snapshotErr } = await supabase
      .from("gob_source_snapshots")
      .insert({
        workspace_id: workspaceId,
        source_id: source.id,
        url: pseudoUrl,
        original_filename: filename,
        content_type: file.ext === "pdf" ? "application/pdf" : "text/html",
        status: "pending",
        created_at: now,
      })
      .select("id")
      .single()

    if (snapshotErr || !snapshot?.id) {
      console.log(`- Error snapshot ${file.relPath}: ${snapshotErr?.message || "insert failed"}`)
      continue
    }

    const buffer = fs.readFileSync(file.absPath)
    const storagePath = `datasets/pasante/${workspaceId}/${source.id}/${snapshot.id}.${storageExt}`
    const { error: uploadErr } = await supabase.storage
      .from("gob_sources")
      .upload(storagePath, buffer, {
        contentType: file.ext === "pdf" ? "application/pdf" : "text/html",
        upsert: false,
      })

    if (uploadErr) {
      console.log(`- Error upload ${file.relPath}: ${uploadErr.message}`)
      continue
    }

    const { error: updateErr } = await supabase
      .from("gob_source_snapshots")
      .update({ storage_path: storagePath })
      .eq("id", snapshot.id)

    if (updateErr) {
      console.log(`- Error updating snapshot path ${file.relPath}: ${updateErr.message}`)
      continue
    }

    const { error: jobErr } = await supabase.from("gob_jobs").insert({
      type: "source_ingest",
      status: "pending",
      available_at: now,
      attempts: 0,
      max_attempts: 5,
      payload: {
        workspace_id: workspaceId,
        source_id: source.id,
        snapshot_id: snapshot.id,
      },
      created_at: now,
    })

    if (jobErr) {
      console.log(`- Error encolando job ${file.relPath}: ${jobErr.message}`)
      continue
    }

    created += 1
    queued += 1
    console.log(`+ ${file.relPath}`)
  }

  console.log("\nResumen importacion:")
  console.log(`- Archivos detectados: ${files.length}`)
  console.log(`- Importados: ${created}`)
  console.log(`- Omitidos (ya existentes): ${skipped}`)
  console.log(`- Jobs encolados: ${queued}`)
}

main().catch((err) => {
  console.error("Error importando dataset:", err)
  process.exit(1)
})
