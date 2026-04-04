import { fetch1TACauseSnapshotByRol, normalizeTribunalCode } from "@/lib/tribunal/one-ta"

type SupremaRemoteResult = {
  ok: boolean
  status?: string | null
  stage?: string | null
  recursoTipo?: string | null
  rolSuprema?: string | null
  sentenciaUrl?: string | null
  items?: Array<Record<string, any>>
  error?: string | null
}

function safeText(value: unknown, maxLen = 200) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > maxLen ? text.slice(0, maxLen) : text
}

export function buildSupremaSearchHints(params: { rol: string; tribunal?: string | null }) {
  const rol = safeText(params.rol, 80)
  const tribunal = safeText(params.tribunal || "1TA", 20) || "1TA"
  const query = `${rol} corte suprema casacion tribunal ambiental ${tribunal}`
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(`site:pjud.cl ${query}`)}`
  return {
    query,
    suggestedUrls: [googleUrl],
    source: "fallback-search",
  }
}

export async function searchSupremaByRol(params: { rol: string; tribunal?: string | null }) {
  const rol = safeText(params.rol, 80)
  if (!rol) {
    throw new Error("Missing rol")
  }

  const tribunalCode = normalizeTribunalCode(params.tribunal || "1TA") || "1TA"
  const hints = buildSupremaSearchHints({ rol, tribunal: params.tribunal })
  const endpoint = safeText(process.env.SUPREMA_CONNECTOR_ENDPOINT || "", 500)
  const token = safeText(process.env.SUPREMA_CONNECTOR_TOKEN || "", 500)

  if (!endpoint) {
    if (tribunalCode === "1TA") {
      const local = await fetch1TACauseSnapshotByRol({ rol }).catch(() => null)
      const hasCasacion = Boolean(local?.hasCasacion)
      return {
        connectorConfigured: false,
        status: hasCasacion ? "recurso_detectado" : "designed_not_configured",
        stage: hasCasacion ? "recurso_detectado" : "sin_senal",
        recursoTipo: local?.recursoTipo || null,
        rolSuprema: null,
        sentenciaUrl: null,
        hints,
        raw: {
          source: "1ta_local_signal",
          latestMovement: local?.latestMovement || null,
          hasCasacion,
        },
      }
    }

    return {
      connectorConfigured: false,
      status: "designed_not_configured",
      stage: null,
      recursoTipo: null,
      rolSuprema: null,
      sentenciaUrl: null,
      hints,
      raw: null,
    }
  }

  try {
    const url = new URL(endpoint)
    url.searchParams.set("rol", rol)
    if (params.tribunal) url.searchParams.set("tribunal", String(params.tribunal))

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: token
        ? {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          }
        : { Accept: "application/json" },
    })

    const json = (await res.json().catch(() => null)) as SupremaRemoteResult | null
    if (!res.ok || !json || json.ok === false) {
      return {
        connectorConfigured: true,
        status: "remote_error",
        stage: null,
        recursoTipo: null,
        rolSuprema: null,
        sentenciaUrl: null,
        hints,
        raw: json,
      }
    }

    return {
      connectorConfigured: true,
      status: json.status || "ok",
      stage: json.stage || null,
      recursoTipo: json.recursoTipo || null,
      rolSuprema: json.rolSuprema || null,
      sentenciaUrl: json.sentenciaUrl || null,
      hints,
      raw: json,
    }
  } catch (err: any) {
    return {
      connectorConfigured: true,
      status: "network_error",
      stage: null,
      recursoTipo: null,
      rolSuprema: null,
      sentenciaUrl: null,
      hints,
      raw: { error: err?.message ?? String(err) },
    }
  }
}
