import test from "node:test"
import assert from "node:assert/strict"

import { orderCorpusCauseDocs } from "@/lib/onboarding/tribunal-corpus"

test("orderCorpusCauseDocs prioritizes targeted causes and causes missing core pairs", () => {
  const ordered = orderCorpusCauseDocs({
    targetCauseIds: ["cause-target"],
    docsByCause: new Map([
      [
        "cause-core",
        [
          { id: "1", cause_id: "cause-core", document_type: "Evacua informe", date: null, name: "Informe", storage_path: "a", url: null },
          { id: "2", cause_id: "cause-core", document_type: "Sentencia", date: null, name: "Sentencia", storage_path: "b", url: null },
        ],
      ],
      [
        "cause-target",
        [
          { id: "3", cause_id: "cause-target", document_type: "Escrito inicial", date: null, name: "Reclamacion", storage_path: "c", url: null },
        ],
      ],
      [
        "cause-missing-core",
        [
          { id: "4", cause_id: "cause-missing-core", document_type: "Escrito inicial", date: null, name: "Reclamacion", storage_path: "d", url: null },
        ],
      ],
    ]),
  })

  assert.deepEqual(
    ordered.map(([causeId]) => causeId),
    ["cause-target", "cause-missing-core", "cause-core"]
  )
})
