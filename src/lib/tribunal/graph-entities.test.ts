import test from "node:test"
import assert from "node:assert/strict"

import { extractLegalGraphEntities, scoreCauseSimilarity } from "@/lib/tribunal/graph-entities"

test("extractLegalGraphEntities detects norms, authorities, topics, outcome, and rol", () => {
  const entities = extractLegalGraphEntities({
    rol: "R-44-2021",
    text:
      "El SEA sostuvo, con apoyo en el articulo 11 de la Ley 19.300, que la participacion ciudadana y la linea de base eran suficientes. La sentencia rechazo la reclamacion.",
  })

  assert.ok(entities.some((row) => row.entityType === "autoridad" && row.normalizedValue.includes("sea")))
  assert.ok(entities.some((row) => row.entityType === "norma_legal" && row.normalizedValue.includes("articulo 11")))
  assert.ok(entities.some((row) => row.entityType === "norma_legal" && row.normalizedValue.includes("ley 19.300")))
  assert.ok(entities.some((row) => row.entityType === "materia" && row.normalizedValue.includes("participacion ciudadana")))
  assert.ok(entities.some((row) => row.entityType === "resultado" && row.normalizedValue === "rechazada"))
  assert.ok(entities.some((row) => row.entityType === "rol_causa" && row.entityValue === "R-44-2021"))
})

test("scoreCauseSimilarity rewards shared legal factors", () => {
  const result = scoreCauseSimilarity({
    left: {
      normas: ["Ley 19.300", "articulo 11"],
      autoridades: ["SEA"],
      materias: ["participacion ciudadana", "linea de base"],
      resultado: "rechazada",
    },
    right: {
      normas: ["ley 19.300", "articulo 11"],
      autoridades: ["Servicio de Evaluacion Ambiental", "SEA"],
      materias: ["participacion ciudadana"],
      resultado: "rechazada",
    },
  })

  assert.ok(result.similarityScore > 0.5)
  assert.ok(result.sharedFactors.normas.length >= 1)
  assert.equal(result.sharedFactors.sameOutcome, true)
})
