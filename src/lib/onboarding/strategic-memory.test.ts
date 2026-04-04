import test from "node:test"
import assert from "node:assert/strict"

import {
  buildCauseInventoryBlock,
  buildStrategicProfilesBlock,
  extractStrategicRoleTokens,
} from "@/lib/onboarding/strategic-memory"

test("extractStrategicRoleTokens merges thread, memory and question roles", () => {
  const tokens = extractStrategicRoleTokens({
    question: "Y que dos lineas de defensa priorizarias para R-35-2019?",
    threadRoleTokens: ["R-44-2021"],
    structuredMemory: {
      version: 1,
      summary: null,
      defenseHypothesis: null,
      defenseCriteria: [],
      documentPriorityRules: [],
      outcomeLessons: [],
      misuseRisks: [],
      contextFacts: [],
      precedentRationales: [],
      preferredCauses: [{ causeId: "c1", rol: "R-1-2017", reason: null, defenseSummary: null, score: null, confidence: null, riskLevel: null }],
      keyDocuments: [],
    },
  })

  assert.deepEqual(tokens.slice(0, 3), ["R-44-2021", "R-1-2017", "R-35-2019"])
})

test("buildStrategicProfilesBlock renders cause and document profile lines", () => {
  const block = buildStrategicProfilesBlock({
    causeProfiles: [
      {
        rol: "R-44-2021",
        summary: "Precedente util para defensa del SEA.",
        keySignals: ["uniformidad decisional"],
        riskyIf: ["si se extrapola fuera del contexto"],
      },
    ],
    documentProfiles: [
      {
        rol: "R-44-2021",
        docRole: "informe",
        name: "Evacua informe",
        summary: "Resume criterios tecnicos del SEA.",
      },
    ],
  })

  assert.match(block, /perfiles_estrategicos/i)
  assert.match(block, /documentos_perfilados/i)
})

test("buildCauseInventoryBlock renders per-cause document counts", () => {
  const block = buildCauseInventoryBlock({
    causes: [
      {
        rol: "R-44-2021",
        estado: "fallada",
        caratula: "Comunidad con SEA",
        counts: { informe: 2, sentencia: 1, reclamacion: 1 },
      },
    ],
  })

  assert.match(block, /inventario_causas/i)
  assert.match(block, /informe=2/i)
  assert.match(block, /sentencia=1/i)
})
