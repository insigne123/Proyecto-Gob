import test from "node:test"
import assert from "node:assert/strict"

import { inferDocTypeHintFromQuestion } from "@/lib/rag/local-retrieval"

test("inferDocTypeHintFromQuestion prioritizes explicit retrieval filters", () => {
  const docType = inferDocTypeHintFromQuestion({
    question: "En R-27-2019, que fojas se mencionan en el documento de desistimiento?",
    filters: { docTypes: ["reclamacion"] },
  })

  assert.equal(docType, "reclamacion")
})

test("inferDocTypeHintFromQuestion detects reclamacion-style queries without relying on default role order", () => {
  const docType = inferDocTypeHintFromQuestion({
    question: "En R-27-2019, que fojas se mencionan en el documento de desistimiento?",
  })

  assert.equal(docType, "reclamacion")
})
