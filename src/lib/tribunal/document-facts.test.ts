import test from "node:test"
import assert from "node:assert/strict"

import { buildFactSnapshotReferences, extractTribunalDocumentFact } from "@/lib/tribunal/document-facts"

test("extractTribunalDocumentFact collects claimant, fojas and resolution snippets", () => {
  const fact = extractTribunalDocumentFact({
    rol: "R-27-2019",
    docRole: "reclamacion",
    content:
      "RECLAMANTE: Comunidad Indigena de Peine. El SEA invoca el articulo 11 de la Ley 19.300. A lo principal, tengase por evacuado el informe. Fojas 3691. Fojas 3692. Esta magistratura concluye que no se advierte ilegalidad y rechaza la reclamacion.",
  })

  assert.ok(fact.claimants.some((item) => /Comunidad Indigena de Peine/i.test(item)))
  assert.deepEqual(fact.fojas.slice(0, 2), ["3691", "3692"])
  assert.ok(fact.citedNorms.some((item) => /art/i.test(item) || /19\.300/i.test(item)))
  assert.ok(fact.authorities.some((item) => /SEA/i.test(item)))
  assert.ok(fact.outcomeSignals.some((item) => /rechaza/i.test(item)))
  assert.ok(fact.holdings.some((item) => /no se advierte ilegalidad/i.test(item)))
  assert.ok(fact.resolutionSnippets.some((item) => /evacuado el informe/i.test(item)))
})

test("buildFactSnapshotReferences returns compact retrieval refs", () => {
  const refs = buildFactSnapshotReferences({
    question: "Existe sentencia para R-107-2024?",
    facts: [
      {
        documentId: "d1",
        causeId: "c1",
        rol: "R-107-2024",
        docRole: "sentencia",
        sourceId: "s1",
        snapshotId: "snap1",
        sourceTitle: "R-107-2024 - Sentencia",
        documentType: "sentencia",
        documentName: "Sentencia",
        documentUrl: "https://example.com",
        claimants: [],
        fojas: [],
        dates: [],
        citedNorms: [],
        authorities: [],
        outcomeSignals: [],
        holdings: [],
        resolutionSnippets: [],
        keySignals: [],
      },
    ],
  })

  assert.deepEqual(refs, [
    {
      snapshotId: "snap1",
      title: "R-107-2024 - Sentencia",
      docType: "sentencia",
      docRole: "sentencia",
      rol: "R-107-2024",
    },
  ])
})
