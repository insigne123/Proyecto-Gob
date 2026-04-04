import test from "node:test"
import assert from "node:assert/strict"

import { buildAgenticCorrectiveQueries } from "@/lib/rag/agent-corrective"
import { inferRagQueryIntent } from "@/lib/rag/query-intent"

test("buildAgenticCorrectiveQueries prioritizes missing roles and graph-related causes", () => {
  const question = "Que criterios sirven para la defensa del SEA y como resolvio la sentencia?"
  const result = buildAgenticCorrectiveQueries({
    question,
    intent: inferRagQueryIntent(question),
    missingRoles: ["sentencia"],
    graphRelatedRoles: ["R-44-2021"],
    graphRelatedQueries: ["R-44-2021 sentencia criterios SEA"],
    evidenceQualityQueries: ["resultado final sentencia SEA"],
    maxQueries: 4,
  })

  assert.ok(result.queries.some((item) => item.includes("sentencia")))
  assert.ok(result.queries.some((item) => item.includes("R-44-2021")))
  assert.ok(result.rationale.some((item) => item.includes("roles faltantes")))
})
