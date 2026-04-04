export const DEFAULT_OPENAI_RAG_MODEL = "gpt-5-nano"
export const DEFAULT_OPENAI_ANSWER_MODEL = "gpt-5-nano"
export const DEFAULT_OPENAI_WRITING_MODEL = "gpt-5-nano"
export const DEFAULT_OPENAI_FAST_MODEL = "gpt-4.1-nano"

export function resolveOpenAIRagModel() {
  return String(process.env.OPENAI_RAG_MODEL || DEFAULT_OPENAI_RAG_MODEL).trim()
}

export function resolveOpenAIFastModel() {
  return String(process.env.OPENAI_FAST_MODEL || DEFAULT_OPENAI_FAST_MODEL).trim()
}

export function resolveOpenAIAnswerModel() {
  return String(process.env.OPENAI_ANSWER_MODEL || process.env.OPENAI_RAG_MODEL || DEFAULT_OPENAI_ANSWER_MODEL).trim()
}

export function resolveOpenAIBalancedModel() {
  return String(process.env.OPENAI_BALANCED_MODEL || resolveOpenAIAnswerModel()).trim()
}

export function resolveOpenAIDeepModel() {
  return String(process.env.OPENAI_DEEP_MODEL || resolveOpenAIAnswerModel()).trim()
}

export function resolveOpenAIRescueModel() {
  return String(process.env.OPENAI_RESCUE_MODEL || process.env.OPENAI_FAST_MODEL || DEFAULT_OPENAI_FAST_MODEL).trim()
}

export function resolveOpenAIWritingModel() {
  return String(
    process.env.OPENAI_WRITING_MODEL || process.env.OPENAI_ANSWER_MODEL || process.env.OPENAI_RAG_MODEL || DEFAULT_OPENAI_WRITING_MODEL
  ).trim()
}

export function resolveOpenAIReviewInlineModel() {
  return String(process.env.OPENAI_REVIEW_INLINE_MODEL || process.env.OPENAI_BALANCED_MODEL || resolveOpenAIBalancedModel()).trim()
}

export function resolveOpenAIReviewProfessionalModel() {
  return String(process.env.OPENAI_REVIEW_PRO_MODEL || process.env.OPENAI_DEEP_MODEL || resolveOpenAIDeepModel()).trim()
}

export function resolveOpenAIWritingProofreadModel() {
  return String(
    process.env.OPENAI_WRITING_PROOFREAD_MODEL || process.env.OPENAI_BALANCED_MODEL || resolveOpenAIBalancedModel()
  ).trim()
}

export function resolveOpenAIWritingCounterargueModel() {
  return String(
    process.env.OPENAI_WRITING_COUNTERARGUE_MODEL || process.env.OPENAI_DEEP_MODEL || resolveOpenAIDeepModel()
  ).trim()
}
