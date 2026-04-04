import "dotenv/config"

import { createAdminClient } from "../src/lib/supabase/admin"
import { classifyTribunalDocumentRole } from "../src/lib/tribunal/document-role"
import { isSeaOnlyCaratula } from "../src/lib/tribunal/one-ta"
import { create2TASessionForWorker, fetch2TACauseDetail, fetch2TATramitesByCuaderno } from "../src/lib/tribunal/two-ta"

type KeyRole = "reclamacion" | "informe" | "sentencia"

function hasFlag(name: string) {
  return process.argv.slice(2).some((arg) => String(arg).trim() === name)
}

function getArg(prefix: string) {
  const hit = process.argv.slice(2).find((arg) => String(arg).trim().startsWith(prefix))
  if (!hit) return null
  const value = String(hit).trim().slice(prefix.length).trim()
  return value || null
}

function intArg(prefix: string, fallback: number, min: number, max: number) {
  const raw = Number(getArg(prefix) || fallback)
  if (!Number.isFinite(raw)) return fallback
  return Math.max(min, Math.min(max, Math.floor(raw)))
}

function safeText(value: unknown, maxLen = 260) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > maxLen ? text.slice(0, maxLen) : text
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalize2TADocId(value: unknown) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n)
}

function extract2TADocumentsFromTramite(row: any) {
  const docs: any[] = []
  if (row?.documento && typeof row.documento === "object") docs.push(row.documento)
  if (Array.isArray(row?.documentos)) docs.push(...row.documentos)
  return unique2TADocuments(docs)
}

function extract2TADocumentsFromEscrito(row: any) {
  const docs: any[] = []
  if (row?.documento && typeof row.documento === "object") docs.push(row.documento)
  if (Array.isArray(row?.documentos)) docs.push(...row.documentos)
  if (Array.isArray(row?.documentosArchivo)) docs.push(...row.documentosArchivo)
  return unique2TADocuments(docs)
}

function unique2TADocuments(rows: any[]) {
  const out: any[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    if (!row || typeof row !== "object") continue

    const id = normalize2TADocId((row as any)?.id ?? (row as any)?.idDocumento)
    const path = safeText((row as any)?.path, 260)
    const name = safeText((row as any)?.nombre || (row as any)?.name, 260)

    const key = id ? `id:${id}` : path ? `path:${path}` : name ? `name:${normalizeText(name)}` : null
    if (!key || seen.has(key)) continue

    seen.add(key)
    out.push(row)
  }

  return out
}

function isPublic2TADocument(row: any) {
  if (!row || typeof row !== "object") return false
  const publico = (row as any).publico
  if (publico === false || String(publico).toLowerCase() === "false") return false
  return true
}

function classify2TAKeyRoleFromContext(params: {
  tramiteTipo: string | null
  tramiteReferencia: string | null
  tipoEscrito: string | null
  referencia: string | null
  parteText: string | null
  docDescription: string | null
  docName: string | null
}) {
  const role = classifyTribunalDocumentRole({
    documentType: [params.tramiteTipo, params.tipoEscrito].filter(Boolean).join(" "),
    title: [params.tramiteReferencia, params.referencia, params.parteText, params.docDescription]
      .filter(Boolean)
      .join(" "),
    name: params.docName,
  })

  if (role === "reclamacion" || role === "informe" || role === "sentencia") return role
  return null
}

function detect2TAKeyRole(params: {
  tramiteTipo: string | null
  tramiteReferencia: string | null
  tipoEscrito: string | null
  referencia: string | null
  parteText: string | null
  docDescription: string | null
  docName: string | null
}): KeyRole | null {
  const tramiteTipo = normalizeText(params.tramiteTipo)
  const tramiteRef = normalizeText(params.tramiteReferencia)
  const tipo = normalizeText(params.tipoEscrito)
  const ref = normalizeText(params.referencia)
  const docDescription = normalizeText(params.docDescription)
  const name = normalizeText(params.docName)
  const roleHint = classify2TAKeyRoleFromContext(params)

  const isReclamacionEscrito =
    tipo.includes("reclamacion") ||
    ref.includes("reclamacion") ||
    tipo.includes("escrito inicial") ||
    ref.includes("escrito inicial")
  const hasDemandaAdjunto = docDescription.includes("demanda") || name.includes("demanda")
  const hasReclamacionAdjunto =
    docDescription.includes("reclamacion") ||
    name.includes("reclamacion") ||
    docDescription.includes("escrito inicial") ||
    name.includes("escrito inicial")
  if (isReclamacionEscrito && (hasDemandaAdjunto || hasReclamacionAdjunto || roleHint === "reclamacion")) {
    return "reclamacion"
  }

  const hasInforme =
    tipo.includes("informe") ||
    ref.includes("informe") ||
    tipo.includes("evacua") ||
    tramiteRef.includes("informe")
  const hasEscritoAdjunto =
    docDescription.includes("escrito") ||
    docDescription.includes("informe") ||
    name.includes("escrito") ||
    name.includes("informe")
  if (hasInforme && (hasEscritoAdjunto || roleHint === "informe")) {
    return "informe"
  }

  const isResolucion = tramiteTipo.includes("resolucion")
  const isSentenciaRef =
    tramiteRef.includes("sentencia") || ref.includes("sentencia") || docDescription.includes("sentencia")
  const hasSentenciaDocName = name.includes("sentencia")
  const isSentenciaCertificate =
    (tramiteRef.includes("certific") ||
      ref.includes("certific") ||
      docDescription.includes("certific") ||
      name.includes("certific") ||
      tramiteRef.includes("notific") ||
      ref.includes("notific")) &&
    (isSentenciaRef || hasSentenciaDocName)

  if (!isSentenciaCertificate && ((isResolucion && isSentenciaRef) || (isSentenciaRef && hasSentenciaDocName))) {
    return "sentencia"
  }

  if (roleHint === "reclamacion" && (isReclamacionEscrito || hasDemandaAdjunto || hasReclamacionAdjunto)) {
    return "reclamacion"
  }
  if (roleHint === "informe" && (hasInforme || hasEscritoAdjunto)) {
    return "informe"
  }
  if (roleHint === "sentencia" && !isSentenciaCertificate && (isResolucion || isSentenciaRef || hasSentenciaDocName)) {
    return "sentencia"
  }

  return null
}

function extractIdCausaFromLink(link: string | null) {
  const text = String(link || "")
  const match = text.match(/[?&]idCausa=(\d+)/i)
  return match ? match[1] : null
}

function sumRoleCounts(map: Record<KeyRole, number>) {
  return map.reclamacion + map.informe + map.sentencia
}

async function main() {
  const admin = createAdminClient()
  const limit = intArg("--limit=", 80, 1, 500)
  const sampleSize = intArg("--sample=", 25, 1, 200)
  const dryRun = hasFlag("--dry-run")

  const pageSize = 1000
  const causes: any[] = []
  for (let from = 0; from <= 30_000; from += pageSize) {
    const to = from + pageSize - 1
    const { data, error } = await admin
      .from("gob_tribunal_causes")
      .select("rol,caratula,estado,link_causa")
      .eq("tribunal", "2TA")
      .range(from, to)

    if (error) throw new Error(error.message)
    const rows = Array.isArray(data) ? data : []
    causes.push(...rows)
    if (rows.length < pageSize) break
  }

  const seaCauses = causes.filter((row) => isSeaOnlyCaratula((row as any).caratula))

  const updates: any[] = []
  for (let from = 0; from <= 100_000; from += pageSize) {
    const to = from + pageSize - 1
    const { data, error } = await admin
      .from("gob_tribunal_cause_updates")
      .select("rol,metadata")
      .eq("tribunal", "2TA")
      .range(from, to)

    if (error) throw new Error(error.message)
    const rows = Array.isArray(data) ? data : []
    updates.push(...rows)
    if (rows.length < pageSize) break
  }

  const roleHasDocs = new Map<string, boolean>()
  const roleIdCausa = new Map<string, string | null>()

  for (const row of updates) {
    const rol = safeText((row as any)?.rol, 120)
    if (!rol) continue

    const docs = Array.isArray((row as any)?.metadata?.inserted_documents)
      ? ((row as any).metadata.inserted_documents as any[])
      : []
    if (docs.length > 0) {
      roleHasDocs.set(rol, true)
    } else if (!roleHasDocs.has(rol)) {
      roleHasDocs.set(rol, false)
    }

    const idRaw =
      (row as any)?.metadata?.source_id_causa_2ta ??
      (row as any)?.metadata?.id_causa_2ta ??
      (row as any)?.metadata?.idCausa2TA ??
      null
    const id = normalize2TADocId(idRaw)
    if (id && !roleIdCausa.has(rol)) {
      roleIdCausa.set(rol, String(id))
    }
  }

  const withoutDocs = seaCauses
    .filter((row) => !roleHasDocs.get(safeText((row as any).rol, 120)))
    .map((row) => {
      const rol = safeText((row as any).rol, 120)
      const idCausa = roleIdCausa.get(rol) || extractIdCausaFromLink((row as any).link_causa)
      return {
        rol,
        estado: safeText((row as any).estado, 120) || null,
        idCausa,
        link: safeText((row as any).link_causa, 1000) || null,
      }
    })
    .filter((row) => Boolean(row.rol))

  const target = withoutDocs.slice(0, limit)
  const session = await create2TASessionForWorker()

  const reasonCount: Record<string, number> = {}
  const rows: Array<any> = []

  for (const row of target) {
    const rol = row.rol
    const idCausa = normalize2TADocId(row.idCausa)

    const countsAny: Record<KeyRole, number> = { reclamacion: 0, informe: 0, sentencia: 0 }
    const countsPublic: Record<KeyRole, number> = { reclamacion: 0, informe: 0, sentencia: 0 }
    const firstDocByRole: Partial<Record<KeyRole, any>> = {}

    let reason = ""
    let errorText: string | null = null
    let tramitesTotal = 0
    let escritosTotal = 0
    let docsTotal = 0

    if (!idCausa) {
      reason = "missing_id_causa"
    } else {
      try {
        const detail = await fetch2TACauseDetail({ session, idCausa })
        const cuadernosRaw =
          (Array.isArray((detail as any)?.causa?.cuadernos) && (detail as any).causa.cuadernos) ||
          (Array.isArray((detail as any)?.cuadernos) && (detail as any).cuadernos) ||
          []

        const cuadernos = (cuadernosRaw as any[])
          .map((c) => normalize2TADocId((c as any)?.idCuaderno ?? (c as any)?.id ?? (c as any)?.id_cuaderno))
          .filter((id): id is number => Boolean(id))

        if (!cuadernos.length) {
          reason = "no_cuadernos"
        } else {
          for (const idCuaderno of cuadernos.slice(0, 8)) {
            for (let page = 1; page <= 8; page += 1) {
              const batch = await fetch2TATramitesByCuaderno({
                session,
                idCuaderno,
                pageSize: 200,
                page,
                isPublic: true,
              }).catch(() => ({ results: [] as any[], resultsCount: 0 }))

              const tramites = Array.isArray(batch.results) ? batch.results : []
              if (!tramites.length) break

              tramitesTotal += tramites.length

              for (const tramite of tramites) {
                const tramiteTipo = safeText((tramite as any)?.tipoTramite?.name, 160) || null
                const tramiteReferencia = safeText((tramite as any)?.referencia, 260) || null

                const docsFromTramite = extract2TADocumentsFromTramite(tramite)
                docsTotal += docsFromTramite.length

                for (const doc of docsFromTramite) {
                  const docName = safeText((doc as any)?.nombre || (doc as any)?.name, 260) || null
                  const docDescription = safeText((doc as any)?.descripcion, 160) || null

                  const keyRole = detect2TAKeyRole({
                    tramiteTipo,
                    tramiteReferencia,
                    tipoEscrito: null,
                    referencia: null,
                    parteText: null,
                    docDescription,
                    docName,
                  })

                  if (!keyRole) continue
                  countsAny[keyRole] += 1
                  if (!firstDocByRole[keyRole]) {
                    firstDocByRole[keyRole] = {
                      source: "tramite",
                      name: docName,
                      description: docDescription,
                      tramiteTipo,
                      tramiteReferencia,
                      publico: (doc as any)?.publico ?? null,
                    }
                  }

                  if (isPublic2TADocument(doc)) {
                    countsPublic[keyRole] += 1
                  }
                }

                const escritos = Array.isArray((tramite as any)?.escritos) ? (tramite as any).escritos : []
                escritosTotal += escritos.length

                for (const escrito of escritos) {
                  const tipoEscrito = safeText((escrito as any)?.tipoEscrito?.name, 160) || null
                  const referencia = safeText((escrito as any)?.referencia, 260) || null
                  const parteText =
                    safeText(
                      (escrito as any)?.parteQuePresenta?.razonSocial ||
                        (escrito as any)?.parteQuePresenta?.nombre ||
                        (escrito as any)?.parteQuePresenta?.nombreCompleto ||
                        (escrito as any)?.nombreParte ||
                        (tramite as any)?.persona?.razonSocial ||
                        (tramite as any)?.persona?.nombre,
                      220
                    ) || null

                  const docsFromEscrito = extract2TADocumentsFromEscrito(escrito)
                  docsTotal += docsFromEscrito.length

                  for (const doc of docsFromEscrito) {
                    const docName = safeText((doc as any)?.nombre || (doc as any)?.name, 260) || null
                    const docDescription = safeText((doc as any)?.descripcion, 160) || null

                    const keyRole = detect2TAKeyRole({
                      tramiteTipo,
                      tramiteReferencia,
                      tipoEscrito,
                      referencia,
                      parteText,
                      docDescription,
                      docName,
                    })

                    if (!keyRole) continue
                    countsAny[keyRole] += 1
                    if (!firstDocByRole[keyRole]) {
                      firstDocByRole[keyRole] = {
                        source: "escrito",
                        name: docName,
                        description: docDescription,
                        tipoEscrito,
                        referencia,
                        parteText,
                        publico: (doc as any)?.publico ?? null,
                      }
                    }

                    if (isPublic2TADocument(doc)) {
                      countsPublic[keyRole] += 1
                    }
                  }
                }
              }

              const hint = Number(batch.resultsCount || 0)
              const reachedHint = hint > 0 && page * 200 >= hint
              if (tramites.length < 200 || reachedHint) break
            }
          }

          if (!reason) {
            const anyCount = sumRoleCounts(countsAny)
            const publicCount = sumRoleCounts(countsPublic)

            if (tramitesTotal === 0) {
              reason = "no_tramites"
            } else if (anyCount === 0) {
              reason = "no_key_docs_detected"
            } else if (publicCount === 0) {
              reason = "key_docs_non_public"
            } else {
              reason = "key_docs_present_not_inserted"
            }
          }
        }
      } catch (error: any) {
        reason = "api_error"
        errorText = safeText(error?.message || error, 220) || "api_error"
      }
    }

    reasonCount[reason] = (reasonCount[reason] || 0) + 1

    rows.push({
      rol,
      idCausa: idCausa ? String(idCausa) : null,
      estado: row.estado,
      link: row.link,
      reason,
      error: errorText,
      tramites: tramitesTotal,
      escritos: escritosTotal,
      docs: docsTotal,
      candidates_any: countsAny,
      candidates_public: countsPublic,
      first_candidate: firstDocByRole,
    })
  }

  const report = {
    action: "diagnose_2ta_no_docs",
    dryRun,
    seaWithoutDocsTotal: withoutDocs.length,
    analyzed: rows.length,
    reasonCount,
    sample: rows.slice(0, sampleSize),
  }

  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error("diagnose-2ta-no-docs failed:", error)
  process.exit(1)
})
