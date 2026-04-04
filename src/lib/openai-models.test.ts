import test from "node:test"
import assert from "node:assert/strict"

import {
  resolveOpenAIAnswerModel,
  resolveOpenAIBalancedModel,
  resolveOpenAIDeepModel,
  resolveOpenAIFastModel,
  resolveOpenAIRagModel,
  resolveOpenAIRescueModel,
  resolveOpenAIReviewInlineModel,
  resolveOpenAIReviewProfessionalModel,
  resolveOpenAIWritingCounterargueModel,
  resolveOpenAIWritingModel,
  resolveOpenAIWritingProofreadModel,
} from "@/lib/openai-models"

const MODEL_ENV_KEYS = [
  "OPENAI_RAG_MODEL",
  "OPENAI_ANSWER_MODEL",
  "OPENAI_WRITING_MODEL",
  "OPENAI_FAST_MODEL",
  "OPENAI_BALANCED_MODEL",
  "OPENAI_DEEP_MODEL",
  "OPENAI_RESCUE_MODEL",
  "OPENAI_REVIEW_INLINE_MODEL",
  "OPENAI_REVIEW_PRO_MODEL",
  "OPENAI_WRITING_PROOFREAD_MODEL",
  "OPENAI_WRITING_COUNTERARGUE_MODEL",
] as const

function withModelEnv(values: Partial<Record<(typeof MODEL_ENV_KEYS)[number], string | undefined>>, fn: () => void) {
  const previous = new Map<string, string | undefined>()
  for (const key of MODEL_ENV_KEYS) {
    previous.set(key, process.env[key])
    const next = values[key]
    if (typeof next === "undefined") {
      delete process.env[key]
    } else {
      process.env[key] = next
    }
  }

  try {
    fn()
  } finally {
    for (const key of MODEL_ENV_KEYS) {
      const prev = previous.get(key)
      if (typeof prev === "undefined") {
        delete process.env[key]
      } else {
        process.env[key] = prev
      }
    }
  }
}

test("openai model resolvers expose expected defaults", () => {
  withModelEnv({}, () => {
    assert.equal(resolveOpenAIRagModel(), "gpt-5-nano")
    assert.equal(resolveOpenAIAnswerModel(), "gpt-5-nano")
    assert.equal(resolveOpenAIWritingModel(), "gpt-5-nano")
    assert.equal(resolveOpenAIFastModel(), "gpt-4.1-nano")
    assert.equal(resolveOpenAIBalancedModel(), "gpt-5-nano")
    assert.equal(resolveOpenAIDeepModel(), "gpt-5-nano")
    assert.equal(resolveOpenAIRescueModel(), "gpt-4.1-nano")
    assert.equal(resolveOpenAIReviewInlineModel(), "gpt-5-nano")
    assert.equal(resolveOpenAIReviewProfessionalModel(), "gpt-5-nano")
    assert.equal(resolveOpenAIWritingProofreadModel(), "gpt-5-nano")
    assert.equal(resolveOpenAIWritingCounterargueModel(), "gpt-5-nano")
  })
})

test("openai model resolvers respect explicit overrides", () => {
  withModelEnv(
    {
      OPENAI_RAG_MODEL: "rag-custom",
      OPENAI_ANSWER_MODEL: "answer-custom",
      OPENAI_WRITING_MODEL: "writing-custom",
      OPENAI_FAST_MODEL: "fast-custom",
      OPENAI_BALANCED_MODEL: "balanced-custom",
      OPENAI_DEEP_MODEL: "deep-custom",
      OPENAI_RESCUE_MODEL: "rescue-custom",
      OPENAI_REVIEW_INLINE_MODEL: "review-inline-custom",
      OPENAI_REVIEW_PRO_MODEL: "review-pro-custom",
      OPENAI_WRITING_PROOFREAD_MODEL: "proofread-custom",
      OPENAI_WRITING_COUNTERARGUE_MODEL: "counterarg-custom",
    },
    () => {
      assert.equal(resolveOpenAIRagModel(), "rag-custom")
      assert.equal(resolveOpenAIAnswerModel(), "answer-custom")
      assert.equal(resolveOpenAIWritingModel(), "writing-custom")
      assert.equal(resolveOpenAIFastModel(), "fast-custom")
      assert.equal(resolveOpenAIBalancedModel(), "balanced-custom")
      assert.equal(resolveOpenAIDeepModel(), "deep-custom")
      assert.equal(resolveOpenAIRescueModel(), "rescue-custom")
      assert.equal(resolveOpenAIReviewInlineModel(), "review-inline-custom")
      assert.equal(resolveOpenAIReviewProfessionalModel(), "review-pro-custom")
      assert.equal(resolveOpenAIWritingProofreadModel(), "proofread-custom")
      assert.equal(resolveOpenAIWritingCounterargueModel(), "counterarg-custom")
    }
  )
})
