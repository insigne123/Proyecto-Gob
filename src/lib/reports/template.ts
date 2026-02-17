export type ReportSectionTemplate = {
  key: string
  heading: string
  instruction: string
  minSimilarity: number
}

export type ReportTemplate = {
  id: string
  title: string
  sections: ReportSectionTemplate[]
}

export const TEMPLATE_INFORME_EVALUACION: ReportTemplate = {
  id: "informe-evaluacion",
  title: "Informe de evaluacion ambiental (borrador)",
  sections: [
    {
      key: "resumen_ejecutivo",
      heading: "Resumen ejecutivo",
      instruction:
        "Sintetiza en formato ejecutivo el objeto del proyecto, hallazgos centrales y conclusion preliminar. Debe ser factual y breve.",
      minSimilarity: 0.2,
    },
    {
      key: "antecedentes",
      heading: "Antecedentes y contexto del proyecto",
      instruction:
        "Describe antecedentes administrativos y tecnicos del proyecto en modo extractivo. No agregues interpretaciones juridicas no sustentadas.",
      minSimilarity: 0.23,
    },
    {
      key: "marco_normativo",
      heading: "Marco normativo aplicable",
      instruction:
        "Identifica normas, exigencias y criterios regulatorios que aparezcan en las fuentes del proyecto. Evita citar normas externas no incluidas.",
      minSimilarity: 0.25,
    },
    {
      key: "linea_base",
      heading: "Linea base y estado actual",
      instruction:
        "Consolida informacion de linea base ambiental (agua, aire, biodiversidad, componentes sociales u otros) segun la evidencia disponible.",
      minSimilarity: 0.27,
    },
    {
      key: "impactos",
      heading: "Identificacion y evaluacion de impactos",
      instruction:
        "Describe impactos directos, indirectos y acumulativos solo cuando esten explicitamente sustentados por evidencia del proyecto.",
      minSimilarity: 0.3,
    },
    {
      key: "alternativas",
      heading: "Alternativas evaluadas y justificacion",
      instruction:
        "Resume alternativas tecnicas o de localizacion descritas en las fuentes y su justificacion comparativa segun evidencia.",
      minSimilarity: 0.25,
    },
    {
      key: "medidas",
      heading: "Medidas de mitigacion, compensacion y reparacion",
      instruction:
        "Detalla medidas propuestas y su alcance. Diferencia claramente entre medidas obligatorias, sugeridas o condicionadas, solo con sustento documental.",
      minSimilarity: 0.28,
    },
    {
      key: "monitoreo",
      heading: "Plan de monitoreo y seguimiento",
      instruction:
        "Describe indicadores, frecuencias, responsables y mecanismos de seguimiento mencionados en los antecedentes del proyecto.",
      minSimilarity: 0.27,
    },
    {
      key: "brechas",
      heading: "Brechas de informacion, incertidumbres y riesgos",
      instruction:
        "Identifica vacios de evidencia, incertidumbres tecnicas y riesgos de implementacion. Cuando falte sustento, solicita explicitamente el antecedente requerido.",
      minSimilarity: 0.3,
    },
    {
      key: "conclusiones",
      heading: "Conclusiones y recomendaciones",
      instruction:
        "Entrega conclusiones finales y recomendaciones accionables en estilo institucional, sin inferencias no respaldadas.",
      minSimilarity: 0.31,
    },
    {
      key: "resumen_no_tecnico",
      heading: "Resumen no tecnico",
      instruction:
        "Reescribe los hallazgos principales en lenguaje claro para publico no especializado, manteniendo fidelidad factual.",
      minSimilarity: 0.2,
    },
  ],
}

export const TEMPLATE_RESOLUCION_CHILE: ReportTemplate = {
  id: "resolucion-chile",
  title: "Resolucion (borrador)",
  sections: [
    {
      key: "vistos",
      heading: "Vistos",
      instruction:
        "Redacta la seccion 'Vistos' en estilo resolucion chilena. Lista antecedentes, documentos y actuaciones que consten explicitamente en las fuentes. Modo extractivo. Sin inferir ni completar vacios.",
      minSimilarity: 0.25,
    },
    {
      key: "considerandos",
      heading: "Considerandos",
      instruction:
        "Redacta 'Considerandos' numerados (1., 2., 3., ...). Cada considerando debe estar explicitamente sustentado por evidencia. Si un considerando no puede citarse, no lo incluyas.",
      minSimilarity: 0.28,
    },
    {
      key: "resuelvo",
      heading: "Resuelvo",
      instruction:
        "Redacta 'Resuelvo' con puntos resolutivos numerados. No inferir. Si no hay evidencia suficiente para resolver, escribe literalmente: 'No se encuentra en las fuentes disponibles.'",
      minSimilarity: 0.3,
    },
  ],
}

export function getReportTemplate(id?: string | null): ReportTemplate {
  if (!id) return TEMPLATE_RESOLUCION_CHILE
  if (id === TEMPLATE_RESOLUCION_CHILE.id) return TEMPLATE_RESOLUCION_CHILE
  if (id === TEMPLATE_INFORME_EVALUACION.id) return TEMPLATE_INFORME_EVALUACION
  return TEMPLATE_RESOLUCION_CHILE
}
