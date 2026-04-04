import test from "node:test"
import assert from "node:assert/strict"

import { loadLegalGraphContext, loadLegalGraphSnapshotReferences } from "@/lib/tribunal/graph-retrieval"

function makeAdminMock() {
  return {
    from(table: string) {
      let lastInColumn = ""
      const chain = {
        select() {
          return chain
        },
        eq() {
          return chain
        },
        in(column: string) {
          lastInColumn = column
          return chain
        },
        order() {
          return chain
        },
        limit() {
          if (table === "gob_entities" && lastInColumn === "normalized_value") {
            return Promise.resolve({
              data: [
                {
                  cause_id: "cause-1",
                  entity_type: "autoridad",
                  entity_value: "SEA",
                  normalized_value: "sea",
                  metadata: { rol: "R-1-2017" },
                },
              ],
            })
          }
          if (table === "gob_entities" && lastInColumn === "entity_value") {
            return Promise.resolve({
              data: [
                {
                  cause_id: "cause-1",
                  entity_value: "R-1-2017",
                  metadata: { rol: "R-1-2017" },
                },
              ],
            })
          }
          if (table === "gob_cause_similarity") {
            return Promise.resolve({
              data: [
                {
                  cause_a_id: "cause-1",
                  cause_b_id: "cause-2",
                  cause_a_rol: "R-1-2017",
                  cause_b_rol: "R-44-2021",
                  similarity_score: 0.71,
                  shared_factors: { autoridades: ["SEA"], materias: ["participacion ciudadana"] },
                },
              ],
            })
          }
          if (table === "gob_tribunal_document_facts") {
            return Promise.resolve({
              data: [
                {
                  snapshot_id: "snap-1",
                  source_title: "R-44-2021 - Sentencia",
                  document_type: "sentencia",
                  doc_role: "sentencia",
                  rol: "R-44-2021",
                },
              ],
            })
          }
          return Promise.resolve({ data: [] })
        },
      }
      return chain
    },
  }
}

test("loadLegalGraphContext surfaces related causes and graph-derived queries", async () => {
  const result = await loadLegalGraphContext({
    admin: makeAdminMock(),
    workspaceId: "workspace-1",
    question: "Que criterio del SEA sirve como precedente?",
    roleTokens: ["R-1-2017"],
  })

  assert.ok(result.block.includes("R-1-2017"))
  assert.ok(result.relatedRoles.includes("R-44-2021"))
  assert.ok(result.relatedQueries.some((item) => item.includes("R-44-2021")))
})

test("loadLegalGraphSnapshotReferences returns snapshot refs for related roles", async () => {
  const refs = await loadLegalGraphSnapshotReferences({
    admin: makeAdminMock(),
    workspaceId: "workspace-1",
    question: "Que criterio del SEA sirve como precedente?",
    roleTokens: ["R-1-2017"],
    preferredDocRoles: ["sentencia", "informe"],
  })

  assert.deepEqual(refs, [
    {
      snapshotId: "snap-1",
      title: "R-44-2021 - Sentencia",
      docType: "sentencia",
      docRole: "sentencia",
      rol: "R-44-2021",
    },
  ])
})
