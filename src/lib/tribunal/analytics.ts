export type TribunalDocLite = {
  id: string
  document_type: string | null
  date: string | null
  name: string | null
  storage_path: string | null
  url: string | null
}

export type TribunalCauseLite = {
  id: string
  tribunal: string | null
  rol: string | null
  fecha_ingreso: string | null
  caratula: string | null
  estado: string | null
  estado_subtipo: string | null
  link_causa: string | null
  gob_tribunal_documents: TribunalDocLite[]
}

export type JurisprudenceOutcome =
  | "favorable_sea"
  | "desfavorable_sea"
  | "mixto"
  | "pendiente"
  | "indeterminado"

export type SupremaSignal = {
  hasCasacion: boolean
  recursoTipo: string | null
  stage: "sin_senal" | "recurso_detectado" | "en_suprema"
  searchUrl: string | null
}

export type JurisprudenceRow = {
  causeId: string
  tribunal: string
  rol: string
  fechaIngreso: string | null
  caratula: string
  estado: string | null
  docsCount: number
  themes: string[]
  temaPrincipal: string
  outcome: JurisprudenceOutcome
  outcomeLabel: string
  argumentPattern: string
  suprema: SupremaSignal
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

function joinCauseText(cause: TribunalCauseLite) {
  const docsText = (cause.gob_tribunal_documents || [])
    .slice(0, 40)
    .map((d) => `${d.document_type || ""} ${d.name || ""}`)
    .join(" ")
  return normalizeText(`${cause.caratula || ""} ${cause.estado || ""} ${cause.estado_subtipo || ""} ${docsText}`)
}

const THEME_RULES: Array<{ theme: string; tokens: string[] }> = [
  { theme: "Evaluacion ambiental", tokens: ["evaluacion ambiental", "impacto ambiental", "sea", "rca"] },
  { theme: "Consulta indigena", tokens: ["consulta indigena", "pueblo indigena", "convenio 169"] },
  { theme: "Participacion ciudadana", tokens: ["participacion ciudadana", "pac", "observaciones ciudadanas"] },
  { theme: "Ruido y vibraciones", tokens: ["ruido", "vibracion", "acustico", "decibel"] },
  { theme: "Agua y recursos hidricos", tokens: ["agua", "hidrico", "acuifero", "caudal", "rio"] },
  { theme: "Biodiversidad", tokens: ["biodiversidad", "fauna", "flora", "ecosistema"] },
  { theme: "Aire y emisiones", tokens: ["aire", "emisiones", "material particulado", "pm10", "pm2 5"] },
  { theme: "Residuos", tokens: ["residuos", "relleno sanitario", "vertedero"] },
  { theme: "Patrimonio arqueologico", tokens: ["arqueologico", "patrimonio", "monumento"] },
  { theme: "Ordenamiento territorial", tokens: ["uso de suelo", "plan regulador", "ordenamiento territorial"] },
]

function detectThemes(text: string) {
  const themes: string[] = []
  for (const rule of THEME_RULES) {
    if (rule.tokens.some((token) => text.includes(normalizeText(token)))) {
      themes.push(rule.theme)
    }
  }
  if (!themes.length) {
    themes.push("General")
  }
  return themes.slice(0, 3)
}

function inferOutcome(text: string, hasSentencia: boolean): JurisprudenceOutcome {
  if (!hasSentencia) return "pendiente"

  const favorableSignals = [
    "rechaza la reclamacion",
    "rechazar la reclamacion",
    "no ha lugar",
    "desestima",
    "confirma",
    "confirma la resolucion",
  ]
  const unfavorableSignals = [
    "acoge la reclamacion",
    "acoger la reclamacion",
    "deja sin efecto",
    "anula",
    "revoca",
    "retrotrae",
  ]

  const favor = favorableSignals.some((x) => text.includes(x))
  const unfavor = unfavorableSignals.some((x) => text.includes(x))

  if (favor && unfavor) return "mixto"
  if (favor) return "favorable_sea"
  if (unfavor) return "desfavorable_sea"
  return "indeterminado"
}

function outcomeLabel(outcome: JurisprudenceOutcome) {
  if (outcome === "favorable_sea") return "Favorable SEA"
  if (outcome === "desfavorable_sea") return "Desfavorable SEA"
  if (outcome === "mixto") return "Mixto"
  if (outcome === "pendiente") return "Pendiente"
  return "Indeterminado"
}

function inferRecursoTipo(text: string) {
  const hasFondo = text.includes("casacion en el fondo")
  const hasForma = text.includes("casacion en la forma")
  if (hasFondo && hasForma) return "Forma y fondo"
  if (hasFondo) return "Fondo"
  if (hasForma) return "Forma"
  if (text.includes("casacion")) return "Casacion"
  return null
}

function buildSupremaSearchUrl(rol: string | null) {
  if (!rol) return null
  const query = encodeURIComponent(`site:pjud.cl ${rol} corte suprema casacion ambiental`)
  return `https://www.google.com/search?q=${query}`
}

function inferSupremaSignal(text: string, rol: string | null): SupremaSignal {
  const hasCasacion = text.includes("casacion")
  const mentionsSuprema = text.includes("corte suprema") || text.includes("suprema")
  return {
    hasCasacion,
    recursoTipo: inferRecursoTipo(text),
    stage: mentionsSuprema ? "en_suprema" : hasCasacion ? "recurso_detectado" : "sin_senal",
    searchUrl: hasCasacion ? buildSupremaSearchUrl(rol) : null,
  }
}

function buildArgumentPattern(theme: string, outcome: JurisprudenceOutcome) {
  const baseByTheme: Record<string, string> = {
    "Evaluacion ambiental": "Refuerza trazabilidad entre impactos, medidas y fundamentos de la RCA.",
    "Consulta indigena": "Prioriza estandar de consulta temprana, buena fe y pertinencia cultural.",
    "Participacion ciudadana": "Vincula observaciones ciudadanas con respuestas tecnicas verificables.",
    "Ruido y vibraciones": "Sustenta lineas base y modelaciones con umbrales y puntos de control claros.",
    "Agua y recursos hidricos": "Acredita balance hidrico, caudales y medidas de mitigacion con series temporales.",
    Biodiversidad: "Conecta impactos sobre especies/habitat con medidas de monitoreo y efectividad.",
    "Aire y emisiones": "Ordena fuentes emisoras, modelacion y cumplimiento normativo por escenario.",
    Residuos: "Justifica gestion integral y riesgos de disposicion con evidencia operativa.",
    "Patrimonio arqueologico": "Documenta lineamientos de resguardo y protocolos de hallazgos fortuitos.",
    "Ordenamiento territorial": "Relaciona compatibilidad territorial con instrumentos de planificacion vigentes.",
    General: "Consolida hechos, normativa y medidas con citas directas en cada afirmacion clave.",
  }

  const outcomeHint: Record<JurisprudenceOutcome, string> = {
    favorable_sea: "Enfatiza patrones de validacion judicial de la decision administrativa.",
    desfavorable_sea: "Refuerza puntos debiles historicos y corrige vacios probatorios recurrentes.",
    mixto: "Distingue criterios acogidos y rechazados para ajustar la estrategia por modulo.",
    pendiente: "Anticipa riesgos argumentativos antes de sentencia con foco preventivo.",
    indeterminado: "Mantiene enfoque prudente y exige respaldo documental en cada tesis.",
  }

  return `${baseByTheme[theme] || baseByTheme.General} ${outcomeHint[outcome]}`
}

export function buildJurisprudenceRows(causes: TribunalCauseLite[]): JurisprudenceRow[] {
  return (causes || []).map((cause) => {
    const text = joinCauseText(cause)
    const themes = detectThemes(text)
    const hasSentencia = (cause.gob_tribunal_documents || []).some((doc) => {
      const t = normalizeText(`${doc.document_type || ""} ${doc.name || ""}`)
      return t.includes("sentencia")
    })
    const outcome = inferOutcome(text, hasSentencia)
    const suprema = inferSupremaSignal(text, cause.rol || null)
    const temaPrincipal = themes[0] || "General"

    return {
      causeId: String(cause.id),
      tribunal: String(cause.tribunal || "1TA"),
      rol: String(cause.rol || ""),
      fechaIngreso: cause.fecha_ingreso || null,
      caratula: String(cause.caratula || ""),
      estado: cause.estado || null,
      docsCount: Array.isArray(cause.gob_tribunal_documents) ? cause.gob_tribunal_documents.length : 0,
      themes,
      temaPrincipal,
      outcome,
      outcomeLabel: outcomeLabel(outcome),
      argumentPattern: buildArgumentPattern(temaPrincipal, outcome),
      suprema,
    }
  })
}
