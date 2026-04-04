import type { EvidenceChunk } from "@/lib/rag/strict-answer"

export type RetrievalVerificationInput = {
  evidence: EvidenceChunk[]
  coverageScore: number
  targetEvidenceCount: number
  profileMaxResults: number
  isFactualPipeline: boolean
  defenseCoverage: {
    status: string
    missingRequiredRoles: string[]
  }
}

export function verifyRetrievalSufficiency(params: RetrievalVerificationInput) {
  const enoughEvidence =
    params.evidence.length >= Math.max(4, Math.min(params.targetEvidenceCount, params.profileMaxResults + 2))
  const enoughCoverage = params.isFactualPipeline ? params.coverageScore >= 0.16 : params.coverageScore >= 0.22
  const roleReady =
    params.defenseCoverage.status === "ready" || params.defenseCoverage.status === "not_applicable"
  const continueLoop = !(enoughEvidence && enoughCoverage && roleReady)

  return {
    continueLoop,
    reason: continueLoop ? "need_more_evidence" : "coverage_sufficient",
    metadata: {
      evidenceCount: params.evidence.length,
      coverageScore: params.coverageScore,
      defenseCoverageStatus: params.defenseCoverage.status,
      missingRoles: params.defenseCoverage.missingRequiredRoles,
      enoughEvidence,
      enoughCoverage,
      roleReady,
    },
  }
}
