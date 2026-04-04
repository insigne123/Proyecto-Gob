import test from "node:test"
import assert from "node:assert/strict"

import { buildPersistedThreadMemory, buildThreadMemory } from "@/lib/rag/thread-memory"

test("buildThreadMemory summarizes prior thread goals and role tokens", () => {
  const out = buildThreadMemory({
    currentQuestion: "Y que dos lineas de defensa priorizarias?",
    messages: [
      {
        role: "user",
        content: "Para R-44-2021, que documentos deberian priorizarse para la defensa del SEA?",
      },
      {
        role: "assistant",
        content: "Orden recomendado para la defensa: 1) informe, 2) sentencia, 3) reclamacion solo como contexto.",
      },
      {
        role: "user",
        content: "Como deberia usarse la reclamacion dentro del marco teorico?",
      },
    ],
  })

  assert.match(out.block, /historial_usuario/i)
  assert.match(out.block, /consensos_previos/i)
  assert.ok(out.roleTokens.includes("R-44-2021"))
})

test("buildPersistedThreadMemory creates compact persisted summary", () => {
  const out = buildPersistedThreadMemory({
    currentQuestion: "Y como usar la reclamacion?",
    assistantAnswer: "En el marco teorico, la reclamacion debe usarse como contexto, no como prueba principal.",
    messages: [
      {
        role: "user",
        content: "Para R-44-2021, que documentos deberian priorizarse?",
      },
    ],
  })

  assert.match(out.summary, /historial_usuario|consensos_previos/i)
  assert.ok(Array.isArray(out.roleTokens))
})
