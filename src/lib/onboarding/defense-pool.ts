import { createHash } from "node:crypto"

import { generateOpenAIJson } from "@/lib/llm/openai-json"
import { isEligibleOnboardingCause, onboardingEligibilityReason } from "@/lib/onboarding/eligibility"
import { classifyTribunalDocumentRole, isStrictTribunalKeyDocument } from "@/lib/onboarding/tribunal-corpus"

type CauseRow = {
  id: string
  tribunal: string | null
  rol: string | null
  caratula: string | null
  estado: string | null
  estado_subtipo: string | null
  fecha_ingreso: string | null
}

type DocRow = {
  id: string
  cause_id: string
  document_type: string | null
  name: string | null
  date: string | null
  url: string | null
  storage_path: string | null
}

function safeText(value: unknown, maxLen = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen)
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

function boolEnv(name: string, fallback = false) {
  const raw = String(process.env[name] || "")
    .trim()
    .toLowerCase()
  if (!raw) return fallback
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false
  return fallback
}

function numberEnv(name: string, fallback: number, min: number, max: number) {
  const raw = String(process.env[name] || "").trim()
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function chunked<T>(rows: T[], size: number) {
  const out: T[][] = []
  const n = Math.max(1, size)
  for (let i = 0; i < rows.length; i += n) {
    out.push(rows.slice(i, i + n))
  }
  return out
}

function listToString(list: string[], max = 4) {
  return list
    .map((x) => safeText(x, 160))
    .filter(Boolean)
    .slice(0, max)
}

function roleWeight(role: string) {
  if (role === "informe") return 1.25
  if (role === "sentencia") return 1.15
  if (role === "reclamacion") return 0.7
  return 0.35
}

function summarizeDocForDefense(doc: DocRow, role: string) {
  const label = safeText(doc.document_type || doc.name || "Documento", 160)
  if (role === "sentencia") {
    return `Sentencia (${label}): util para extraer ratio decidendi, estandar de control y criterios de rechazo/acogida.`
  }
  if (role === "informe") {
    return `Informe (${label}): util para mapear defensa tecnica del SEA y anticipar contraargumentos.`
  }
  if (role === "reclamacion") {
    return `Reclamacion (${label}): util para comparar hechos base y estructura argumental inicial.`
  }
  return `Documento complementario (${label}) para contexto procesal y trazabilidad.`
}

function hashCauseInput(cause: CauseRow, docs: DocRow[]) {
  const payload = {
    cause: {
      id: cause.id,
      tribunal: cause.tribunal,
      rol: cause.rol,
      caratula: cause.caratula,
      estado: cause.estado,
      estado_subtipo: cause.estado_subtipo,
      fecha_ingreso: cause.fecha_ingreso,
    },
    docs: docs
      .slice()
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map((doc) => ({
        id: doc.id,
        type: doc.document_type,
        name: doc.name,
        date: doc.date,
        url: doc.url,
      })),
  }
  return createHash("sha1").update(JSON.stringify(payload)).digest("hex")
}

function hashDocInput(doc: DocRow, role: string) {
  const payload = {
    id: doc.id,
    cause_id: doc.cause_id,
    role,
    type: doc.document_type,
    name: doc.name,
    date: doc.date,
    url: doc.url,
  }
  return createHash("sha1").update(JSON.stringify(payload)).digest("hex")
}

function heuristicCauseProfile(cause: CauseRow, docs: DocRow[]) {
  const roles = docs.map((doc) => classifyTribunalDocumentRole({ documentType: doc.document_type, name: doc.name }))
  const roleSet = new Set(roles)
  const roleCount = {
    reclamacion: roles.filter((r) => r === "reclamacion").length,
    informe: roles.filter((r) => r === "informe").length,
    sentencia: roles.filter((r) => r === "sentencia").length,
  }

  const proceduralSignals = listToString([
    cause.estado ? `Estado actual: ${cause.estado}` : "",
    cause.estado_subtipo ? `Subestado: ${cause.estado_subtipo}` : "",
    cause.fecha_ingreso ? `Ingreso: ${cause.fecha_ingreso}` : "",
  ])

  const docTypes = listToString(
    docs.map((doc) => safeText(doc.document_type || doc.name || "", 120)).filter(Boolean),
    6
  )

  const summaryParts: string[] = []
  summaryParts.push(
    `Causa ${safeText(cause.rol || "sin rol", 80)} (${safeText(cause.tribunal || "", 20)}): ${safeText(
      cause.caratula || "",
      260
    )}.`
  )

  if (roleCount.informe > 0) {
    summaryParts.push("Incluye evacuación de informe del SEA, útil para comparar estrategia técnica defensiva.")
  }
  if (roleCount.sentencia > 0) {
    summaryParts.push("Tiene sentencia disponible, apta para extraer criterios de decisión y evaluar si la estrategia funcionó o falló.")
  }
  if (roleCount.reclamacion > 0) {
    summaryParts.push("Incluye escrito inicial, útil para contraste de hechos y estructura argumental, pero como soporte secundario.")
  }

  const summary = summaryParts.join(" ").trim()

  const interestingIf = listToString([
    roleSet.has("sentencia")
      ? "Necesitas precedentes con decisión final y criterios explícitos de rechazo/acogida."
      : "",
    roleSet.has("informe")
      ? "Necesitas comparar o refutar argumentos técnicos del SEA en etapa de informe."
      : "",
    roleSet.has("reclamacion")
      ? "Necesitas patrones de estructuración de la reclamación judicial inicial."
      : "",
    "Buscas jurisprudencia con carátula SEA comparable en hechos y fundamento normativo.",
  ])

  const riskyIf = listToString([
    roleCount.sentencia === 0 ? "No hay sentencia en el set documental; no usar como precedente central." : "",
    roleCount.informe === 0 ? "Sin informe del SEA, la comparabilidad técnica puede ser limitada." : "",
    docs.length <= 1 ? "Cobertura documental baja; validar con fuentes adicionales antes de citar." : "",
  ])

  const recommendedRoleOrder: Array<"sentencia" | "informe" | "reclamacion"> = [
    "informe",
    "sentencia",
    "reclamacion",
  ]
  const recommendedDocRoles = recommendedRoleOrder.filter((role) => roleSet.has(role))

  return {
    summary,
    interestingIf,
    riskyIf,
    keySignals: proceduralSignals,
    recommendedDocRoles,
    metadata: {
      role_counts: roleCount,
      doc_types: docTypes,
      docs_count: docs.length,
    },
  }
}

const CauseProfileSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    interestingIf: {
      type: "array",
      items: { type: "string" },
    },
    riskyIf: {
      type: "array",
      items: { type: "string" },
    },
    keySignals: {
      type: "array",
      items: { type: "string" },
    },
    recommendedDocRoles: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["summary", "interestingIf", "riskyIf", "keySignals", "recommendedDocRoles"],
  additionalProperties: false,
} as const

async function maybeLlmCauseProfile(params: {
  cause: CauseRow
  docs: DocRow[]
  heuristic: ReturnType<typeof heuristicCauseProfile>
}) {
  const enabled = boolEnv("ONBOARDING_PROFILE_LLM_ENABLED", false)
  if (!enabled) {
    return {
      profile: params.heuristic,
      model: null as string | null,
      applied: false,
    }
  }

  const docsBlock = params.docs
    .slice(0, 10)
    .map((doc, idx) => {
      const role = classifyTribunalDocumentRole({
        documentType: doc.document_type,
        name: doc.name,
      })
      return `${idx + 1}. role=${role}; type=${safeText(doc.document_type || "", 120)}; name=${safeText(
        doc.name || "",
        160
      )}; date=${safeText(doc.date || "", 20)}`
    })
    .join("\n")

  try {
    const out = await generateOpenAIJson({
      system:
        "Eres un analista jurídico de litigación ambiental. Resume utilidad defensiva de una causa de forma conservadora y accionable, sin inventar hechos.",
      prompt:
        `Causa:\n` +
        `- tribunal: ${safeText(params.cause.tribunal || "", 20)}\n` +
        `- rol: ${safeText(params.cause.rol || "", 80)}\n` +
        `- caratula: ${safeText(params.cause.caratula || "", 320)}\n` +
        `- estado: ${safeText(params.cause.estado || "", 120)}\n` +
        `- estado_subtipo: ${safeText(params.cause.estado_subtipo || "", 120)}\n\n` +
        `Documentos clave:\n${docsBlock}\n\n` +
        `Base heuristica:\n${safeText(params.heuristic.summary, 420)}`,
      schemaName: "onboarding_cause_profile",
      schema: CauseProfileSchema,
      maxCompletionTokens: 500,
      reasoningEffort: "minimal",
      model: String(process.env.ONBOARDING_PROFILE_MODEL || "gpt-5-nano"),
    })

    const profile = {
      summary: safeText((out.output as any)?.summary || params.heuristic.summary, 900),
      interestingIf: listToString(Array.isArray((out.output as any)?.interestingIf) ? (out.output as any).interestingIf : []),
      riskyIf: listToString(Array.isArray((out.output as any)?.riskyIf) ? (out.output as any).riskyIf : []),
      keySignals: listToString(Array.isArray((out.output as any)?.keySignals) ? (out.output as any).keySignals : []),
      recommendedDocRoles: listToString(
        Array.isArray((out.output as any)?.recommendedDocRoles) ? (out.output as any).recommendedDocRoles : [],
        5
      ),
      metadata: params.heuristic.metadata,
    }

    return {
      profile,
      model: out.model,
      applied: true,
    }
  } catch {
    return {
      profile: params.heuristic,
      model: null as string | null,
      applied: false,
    }
  }
}

export async function loadOnboardingEligibleCauseIds(admin: any) {
  const { data, error } = await admin
    .from("gob_onboarding_cause_pool")
    .select("cause_id")
    .limit(5000)

  if (error) {
    return {
      ids: new Set<string>(),
      available: false,
      error: error.message,
    }
  }

  const ids = new Set<string>((data || []).map((row: any) => String(row.cause_id || "")).filter(Boolean))
  return {
    ids,
    available: true,
    error: null as string | null,
  }
}

export async function loadOnboardingCauseProfiles(admin: any, causeIds: string[]) {
  const cleanIds = Array.from(new Set(causeIds.map((x) => String(x || "").trim()).filter(Boolean)))
  if (!cleanIds.length) return new Map<string, any>()

  const map = new Map<string, any>()
  for (const batch of chunked(cleanIds, 400)) {
    const { data, error } = await admin
      .from("gob_onboarding_cause_profiles")
      .select("cause_id,summary,interesting_if,risky_if,key_signals,recommended_doc_roles,metadata")
      .in("cause_id", batch)
    if (error) continue
    for (const row of data || []) {
      const id = String((row as any).cause_id || "")
      if (!id) continue
      map.set(id, row)
    }
  }

  return map
}

export async function loadOnboardingDocumentProfiles(admin: any, documentIds: string[]) {
  const cleanIds = Array.from(new Set(documentIds.map((x) => String(x || "").trim()).filter(Boolean)))
  if (!cleanIds.length) return new Map<string, any>()

  const map = new Map<string, any>()
  for (const batch of chunked(cleanIds, 400)) {
    const { data, error } = await admin
      .from("gob_onboarding_document_profiles")
      .select("document_id,summary,doc_role,relevance_score,key_points,metadata")
      .in("document_id", batch)
    if (error) continue
    for (const row of data || []) {
      const id = String((row as any).document_id || "")
      if (!id) continue
      map.set(id, row)
    }
  }

  return map
}

export async function refreshOnboardingDefensePool(params: {
  admin: any
  refreshProfiles?: boolean
  refreshCauseProfiles?: boolean
  refreshDocProfiles?: boolean
  maxCauseProfilesPerRun?: number
  maxDocProfilesPerRun?: number
  causeOffset?: number
  docOffset?: number
}) {
  const { admin } = params
  const refreshProfiles = params.refreshProfiles ?? true
  const refreshCauseProfiles = params.refreshCauseProfiles ?? true
  const refreshDocProfiles = params.refreshDocProfiles ?? true
  const maxCauseProfilesPerRun = Math.max(
    20,
    Math.min(
      800,
      Number(params.maxCauseProfilesPerRun ?? numberEnv("ONBOARDING_PROFILE_MAX_CAUSES_PER_RUN", 240, 20, 800))
    )
  )
  const maxDocProfilesPerRun = Math.max(
    40,
    Math.min(
      4000,
      Number(params.maxDocProfilesPerRun ?? numberEnv("ONBOARDING_PROFILE_MAX_DOCS_PER_RUN", 900, 40, 4000))
    )
  )
  const causeOffset = Math.max(0, Math.floor(Number(params.causeOffset ?? 0)))
  const docOffset = Math.max(0, Math.floor(Number(params.docOffset ?? 0)))

  const [{ data: causes, error: causesErr }, { data: docs, error: docsErr }] = await Promise.all([
    admin
      .from("gob_tribunal_causes")
      .select("id,tribunal,rol,caratula,estado,estado_subtipo,fecha_ingreso")
      .limit(6000),
    admin
      .from("gob_tribunal_documents")
      .select("id,cause_id,document_type,name,date,url,storage_path")
      .limit(12000),
  ])

  if (causesErr) throw new Error(causesErr.message)
  if (docsErr) throw new Error(docsErr.message)

  const causeRows: CauseRow[] = (causes || []).map((row: any) => ({
    id: String(row.id),
    tribunal: row.tribunal ? String(row.tribunal) : null,
    rol: row.rol ? String(row.rol) : null,
    caratula: row.caratula ? String(row.caratula) : null,
    estado: row.estado ? String(row.estado) : null,
    estado_subtipo: row.estado_subtipo ? String(row.estado_subtipo) : null,
    fecha_ingreso: row.fecha_ingreso ? String(row.fecha_ingreso) : null,
  }))

  const docRows: DocRow[] = (docs || []).map((row: any) => ({
    id: String(row.id),
    cause_id: String(row.cause_id),
    document_type: row.document_type ? String(row.document_type) : null,
    name: row.name ? String(row.name) : null,
    date: row.date ? String(row.date) : null,
    url: row.url ? String(row.url) : null,
    storage_path: row.storage_path ? String(row.storage_path) : null,
  }))

  const docsByCause = new Map<string, DocRow[]>()
  for (const doc of docRows) {
    const list = docsByCause.get(doc.cause_id) || []
    list.push(doc)
    docsByCause.set(doc.cause_id, list)
  }

  const eligibleCauses = causeRows.filter((cause) => isEligibleOnboardingCause(cause))
  const eligibleCauseIds = new Set(eligibleCauses.map((cause) => cause.id))

  const now = new Date().toISOString()

  const poolRows = eligibleCauses.map((cause) => {
    const docsForCause = docsByCause.get(cause.id) || []
    const keyDocs = docsForCause.filter((doc) =>
      isStrictTribunalKeyDocument({
        documentType: doc.document_type,
        name: doc.name,
        title: doc.document_type,
      })
    )
    const hasSma = normalizeText(cause.caratula).includes("superintendencia del medio ambiente")

    return {
      cause_id: cause.id,
      tribunal: cause.tribunal,
      rol: cause.rol,
      caratula: cause.caratula,
      has_sea_defendant: true,
      has_sma_token: hasSma,
      docs_count: docsForCause.length,
      key_docs_count: keyDocs.length,
      eligibility_reason: onboardingEligibilityReason(cause),
      metadata: {
        estado: cause.estado,
        estado_subtipo: cause.estado_subtipo,
        fecha_ingreso: cause.fecha_ingreso,
      },
      updated_at: now,
    }
  })

  for (const batch of chunked(poolRows, 400)) {
    const { error } = await admin.from("gob_onboarding_cause_pool").upsert(batch, {
      onConflict: "cause_id",
      ignoreDuplicates: false,
    })
    if (error) throw new Error(error.message)
  }

  const { data: existingPoolRows, error: poolErr } = await admin
    .from("gob_onboarding_cause_pool")
    .select("cause_id")
    .limit(6000)
  if (poolErr) throw new Error(poolErr.message)

  const toDelete = (existingPoolRows || [])
    .map((row: any) => String(row.cause_id || ""))
    .filter((id: string) => id && !eligibleCauseIds.has(id))

  for (const batch of chunked(toDelete, 400)) {
    const { error } = await admin.from("gob_onboarding_cause_pool").delete().in("cause_id", batch)
    if (error) throw new Error(error.message)
  }

  let causeProfilesUpdated = 0
  let causeProfilesSkipped = 0
  let docProfilesUpdated = 0
  let docProfilesSkipped = 0
  let llmProfilesApplied = 0

  if (refreshProfiles && refreshCauseProfiles && eligibleCauses.length) {
    const targetCauseRows = eligibleCauses.slice(causeOffset, causeOffset + maxCauseProfilesPerRun)
    const targetCauseIds = targetCauseRows.map((cause) => cause.id)

    const { data: existingProfiles, error: existingProfilesErr } = await admin
      .from("gob_onboarding_cause_profiles")
      .select("cause_id,source_hash")
      .in("cause_id", targetCauseIds)
    if (existingProfilesErr) throw new Error(existingProfilesErr.message)

    const profileHashByCause = new Map<string, string>()
    for (const row of existingProfiles || []) {
      profileHashByCause.set(String((row as any).cause_id || ""), String((row as any).source_hash || ""))
    }

    const causeProfileRows: any[] = []

    for (const cause of targetCauseRows) {
      const docsForCause = (docsByCause.get(cause.id) || []).slice(0, 24)
      const sourceHash = hashCauseInput(cause, docsForCause)
      if (profileHashByCause.get(cause.id) === sourceHash) {
        causeProfilesSkipped += 1
        continue
      }

      const heuristic = heuristicCauseProfile(cause, docsForCause)
      const llm = await maybeLlmCauseProfile({
        cause,
        docs: docsForCause,
        heuristic,
      })
      if (llm.applied) llmProfilesApplied += 1

      causeProfileRows.push({
        cause_id: cause.id,
        source_hash: sourceHash,
        summary: llm.profile.summary,
        interesting_if: llm.profile.interestingIf,
        risky_if: llm.profile.riskyIf,
        key_signals: llm.profile.keySignals,
        recommended_doc_roles: llm.profile.recommendedDocRoles,
        profile_version: "v1",
        model: llm.model,
        metadata: llm.profile.metadata,
        generated_at: now,
        updated_at: now,
      })
    }

    for (const batch of chunked(causeProfileRows, 200)) {
      const { error } = await admin.from("gob_onboarding_cause_profiles").upsert(batch, {
        onConflict: "cause_id",
        ignoreDuplicates: false,
      })
      if (error) throw new Error(error.message)
      causeProfilesUpdated += batch.length
    }
  }

  if (refreshProfiles && refreshDocProfiles && eligibleCauses.length) {
    const eligibleDocs = docRows.filter((doc) => eligibleCauseIds.has(doc.cause_id))
    const targetDocs = eligibleDocs.slice(docOffset, docOffset + maxDocProfilesPerRun)
    const docHashById = new Map<string, string>()
    const targetDocIds = targetDocs.map((doc) => doc.id)
    for (const batch of chunked(targetDocIds, 400)) {
      const { data, error: existingDocProfilesErr } = await admin
        .from("gob_onboarding_document_profiles")
        .select("document_id,source_hash")
        .in("document_id", batch)
      if (existingDocProfilesErr) throw new Error(existingDocProfilesErr.message)
      for (const row of data || []) {
        docHashById.set(String((row as any).document_id || ""), String((row as any).source_hash || ""))
      }
    }

    const docProfileRows: any[] = []
    for (const doc of targetDocs) {
      const role = classifyTribunalDocumentRole({
        documentType: doc.document_type,
        name: doc.name,
      })
      const sourceHash = hashDocInput(doc, role)
      if (docHashById.get(doc.id) === sourceHash) {
        docProfilesSkipped += 1
        continue
      }

      docProfileRows.push({
        document_id: doc.id,
        cause_id: doc.cause_id,
        source_hash: sourceHash,
        doc_role: role,
        relevance_score: Number(
          (
            roleWeight(role) +
            (isStrictTribunalKeyDocument({
              documentType: doc.document_type,
              name: doc.name,
              title: doc.document_type,
            })
              ? 0.35
              : 0)
          ).toFixed(4)
        ),
        summary: summarizeDocForDefense(doc, role),
        key_points: listToString(
          [
            doc.document_type ? `Tipo: ${doc.document_type}` : "",
            doc.name ? `Nombre: ${safeText(doc.name, 120)}` : "",
            doc.date ? `Fecha: ${doc.date}` : "",
          ],
          4
        ),
        profile_version: "v1",
        model: "heuristic",
        metadata: {
          url: doc.url,
          storage_path: doc.storage_path,
        },
        generated_at: now,
        updated_at: now,
      })
    }

    for (const batch of chunked(docProfileRows, 250)) {
      const { error } = await admin.from("gob_onboarding_document_profiles").upsert(batch, {
        onConflict: "document_id",
        ignoreDuplicates: false,
      })
      if (error) throw new Error(error.message)
      docProfilesUpdated += batch.length
    }
  }

  return {
    eligibleCauses: eligibleCauses.length,
    excludedCauses: Math.max(0, causeRows.length - eligibleCauses.length),
    eligibleDocs: docRows.filter((doc) => eligibleCauseIds.has(doc.cause_id)).length,
    poolRowsUpserted: poolRows.length,
    poolRowsDeleted: toDelete.length,
    causeProfilesUpdated,
    causeProfilesSkipped,
    docProfilesUpdated,
    docProfilesSkipped,
    llmProfilesApplied,
    refreshProfiles,
    maxCauseProfilesPerRun,
    maxDocProfilesPerRun,
    causeOffset,
    docOffset,
  }
}
