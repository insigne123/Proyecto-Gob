import test from "node:test"
import assert from "node:assert/strict"

import {
  buildStructuredOnboardingMemory,
  buildStructuredOnboardingMemoryBlock,
  buildWritingGuidanceFromStructuredMemory,
  extractStructuredOnboardingMemoryFromMetadata,
  normalizeStructuredOnboardingMemory,
} from "@/lib/onboarding/structured-memory"

test("buildStructuredOnboardingMemory organizes causes, criteria, and key documents", () => {
  const memory = buildStructuredOnboardingMemory({
    summary: "Resumen del marco teorico.",
    recommendations: [
      {
        causeId: "c1",
        rol: "R-44-2021",
        score: 42.1,
        reason: "Muy util para defensa",
        defenseSummary: "La causa aporta una combinacion de informe y sentencia.",
        selectedDocuments: [
          {
            id: "d1",
            name: "Evacua informe",
            url: "https://example.com/doc.pdf",
            docRole: "informe",
            documentType: "informe",
            contribution: "Muestra una linea defensiva que luego fue acogida por el tribunal.",
          },
          {
            id: "d2",
            name: "Sentencia definitiva",
            url: "https://example.com/sentencia.pdf",
            docRole: "sentencia",
            documentType: "sentencia",
            contribution: "La sentencia confirmo el criterio usado en la defensa.",
          },
        ],
      },
    ],
    matrix: [
      {
        causeId: "c1",
        rol: "R-44-2021",
        confidence: "alta",
        riskLevel: "medio",
        document: {
          name: "Evacua informe",
          url: "https://example.com/doc.pdf",
          contribution: "Muestra una linea defensiva que luego fue acogida por el tribunal.",
        },
      },
      {
        causeId: "c1",
        rol: "R-44-2021",
        confidence: "alta",
        riskLevel: "medio",
        document: {
          name: "Sentencia definitiva",
          url: "https://example.com/sentencia.pdf",
          contribution: "La sentencia confirmo el criterio usado en la defensa.",
        },
      },
    ],
    report: {
      structured: {
        defenseHypothesis: "La defensa mejora cuando se apoya en el informe del SEA.",
        usefulCriteria: ["El informe debe responder observaciones ciudadanas con trazabilidad."],
        misuseRisks: ["No extrapolar el precedente fuera de su contexto."],
        comparableFacts: ["La reclamacion cuestiona la motivacion de la RCA."],
      },
    },
  })

  assert.equal(memory.preferredCauses.length, 1)
  assert.equal(memory.keyDocuments.length, 2)
  assert.equal(memory.keyDocuments[0]?.docRole, "informe")
  assert.equal(memory.keyDocuments[1]?.docRole, "sentencia")
  assert.ok(memory.defenseCriteria.some((item) => item.includes("trazabilidad")))
  assert.ok(memory.documentPriorityRules.some((item) => item.includes("Priorizar informes del SEA")))
  assert.ok(memory.outcomeLessons.some((item) => item.includes("precedente") || item.includes("contexto")))
  assert.ok(memory.misuseRisks.some((item) => item.includes("No extrapolar")))
  assert.ok(memory.precedentRationales.some((item) => item.includes("R-44-2021")))

  const normalized = normalizeStructuredOnboardingMemory(memory)
  assert.ok(normalized)
  assert.ok(buildStructuredOnboardingMemoryBlock(normalized).includes("Hipotesis de defensa"))
  assert.ok(buildStructuredOnboardingMemoryBlock(normalized).includes("Prioridad documental"))
  assert.ok(buildWritingGuidanceFromStructuredMemory(normalized).includes("Criterios a mantener"))
  assert.ok(buildWritingGuidanceFromStructuredMemory(normalized).includes("Riesgos por mal uso"))
  assert.ok(
    extractStructuredOnboardingMemoryFromMetadata({ onboarding: { structured_memory: memory } })?.preferredCauses.length === 1
  )
})

test("normalizeStructuredOnboardingMemory reorders key documents toward informe and sentencia", () => {
  const normalized = normalizeStructuredOnboardingMemory({
    summary: "Resumen",
    keyDocuments: [
      {
        rol: "R-120-2025",
        docRole: "reclamacion",
        name: "Escrito inicial",
        url: "https://example.com/reclamacion.pdf",
      },
      {
        rol: "R-44-2021",
        docRole: "informe",
        name: "Evacua informe",
        url: "https://example.com/informe.pdf",
      },
      {
        rol: "R-1-2017",
        docRole: "sentencia",
        name: "Sentencia definitiva",
        url: "https://example.com/sentencia.pdf",
      },
    ],
  })

  assert.ok(normalized)
  assert.deepEqual(
    normalized?.keyDocuments.slice(0, 3).map((doc) => doc.docRole),
    ["informe", "sentencia", "reclamacion"]
  )
})

test("buildStructuredOnboardingMemory deprioritizes reclamacion-only causes when core-pair causes exist", () => {
  const memory = buildStructuredOnboardingMemory({
    summary: "Resumen",
    recommendations: [
      {
        causeId: "c-reclamacion",
        rol: "R-120-2025",
        selectedDocuments: [
          {
            id: "d-r1",
            name: "Escrito Inicial",
            documentType: "Escrito Inicial",
            docRole: "reclamacion",
            url: "https://example.com/r1.pdf",
          },
        ],
      },
      {
        causeId: "c-core",
        rol: "R-44-2021",
        selectedDocuments: [
          {
            id: "d-i1",
            name: "Evacua informe",
            documentType: "Evacua informe",
            docRole: "informe",
            url: "https://example.com/i1.pdf",
          },
          {
            id: "d-s1",
            name: "Sentencia definitiva",
            documentType: "Sentencia",
            docRole: "sentencia",
            url: "https://example.com/s1.pdf",
          },
        ],
      },
      {
        causeId: "c-core-2",
        rol: "R-35-2019",
        selectedDocuments: [
          {
            id: "d-i2",
            name: "Evacua informe 2",
            documentType: "Evacua informe",
            docRole: "informe",
            url: "https://example.com/i2.pdf",
          },
          {
            id: "d-s2",
            name: "Sentencia 2",
            documentType: "Sentencia",
            docRole: "sentencia",
            url: "https://example.com/s2.pdf",
          },
        ],
      },
    ],
  })

  assert.deepEqual(
    memory.keyDocuments.slice(0, 4).map((doc) => doc.docRole),
    ["informe", "sentencia", "informe", "sentencia"]
  )
})
