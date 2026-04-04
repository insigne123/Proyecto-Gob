import test from "node:test"
import assert from "node:assert/strict"

import { inferRagQueryIntent } from "@/lib/rag/query-intent"
import {
  classifyRagQuestionDifficulty,
  decideRagExecutionPlan,
  resolveRagResponseProfile,
} from "@/lib/rag/router"

test("classifyRagQuestionDifficulty marks marco teorico questions as complex", () => {
  const difficulty = classifyRagQuestionDifficulty(
    "Genera un marco teorico con precedentes comparables, riesgos y jurisprudencia relevante",
    "checklist"
  )

  assert.equal(difficulty, "complex")
})

test("decideRagExecutionPlan enables deep pipeline for precedent comparison questions", () => {
  const question = "Compara precedentes utiles para el marco teorico y explica diferencias"
  const difficulty = classifyRagQuestionDifficulty(question, "comparison")
  const responseProfile = resolveRagResponseProfile("auto", difficulty)
  const intent = inferRagQueryIntent(question)

  const plan = decideRagExecutionPlan({
    question,
    mode: "comparison",
    difficulty,
    responseProfile,
    intent,
  })

  assert.equal(plan.pipeline, "deep")
  assert.equal(plan.allowHyDE, true)
  assert.equal(plan.allowCorrectiveRetrieval, true)
  assert.equal(plan.allowSelfReflection, true)
})

test("decideRagExecutionPlan keeps attached-source review on direct pipeline", () => {
  const question = "Resume el informe adjunto"
  const difficulty = classifyRagQuestionDifficulty(question, "extractive")
  const intent = inferRagQueryIntent(question)

  const plan = decideRagExecutionPlan({
    question,
    mode: "extractive",
    difficulty,
    responseProfile: "balanced",
    intent,
    hasAttachedSource: true,
  })

  assert.equal(plan.pipeline, "direct")
  assert.equal(plan.allowHyDE, false)
})

test("decideRagExecutionPlan uses factual pipeline for simple extractive factual questions", () => {
  const question = "Para R-107-2024, existe una sentencia en el corpus?"
  const difficulty = classifyRagQuestionDifficulty(question, "extractive")
  const intent = inferRagQueryIntent(question)

  const plan = decideRagExecutionPlan({
    question,
    mode: "extractive",
    difficulty,
    responseProfile: "balanced",
    intent,
  })

  assert.equal(plan.pipeline, "factual")
  assert.equal(plan.allowHyDE, false)
  assert.equal(plan.allowCorrectiveRetrieval, false)
  assert.equal(plan.allowSelfReflection, false)
})
