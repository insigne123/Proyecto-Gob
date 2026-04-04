import type { AgentRetrievalJob } from "@/lib/rag/agent-tool-loop"

export async function executeAgenticRetrievalJobs(params: {
  jobs: AgentRetrievalJob[]
  evidenceLimit: number
  consumeBudget: (label: string) => boolean
  getEvidenceCount: () => number
  runManaged: (workspaceIds: string[], queries: string[]) => Promise<void>
  runLocal: (workspaceIds: string[], query: string) => Promise<void>
  verifyAfterJob?: (job: AgentRetrievalJob) => Promise<{ continueLoop: boolean; reason?: string | null; metadata?: Record<string, unknown> }>
  onJobStarted?: (job: AgentRetrievalJob) => void
  onJobFinished?: (job: AgentRetrievalJob) => void
}) {
  const executedJobIds: string[] = []
  const verificationReports: Array<{ jobId: string; continueLoop: boolean; reason: string | null; metadata: Record<string, unknown> }> = []
  let budgetExhausted = false
  let exhaustedLabel: string | null = null
  let stopReason: string | null = null

  for (const job of params.jobs) {
    params.onJobStarted?.(job)
    const budgetLabel = `${job.kind}:${job.phase}`
    if (!params.consumeBudget(budgetLabel)) {
      budgetExhausted = true
      exhaustedLabel = budgetLabel
      break
    }

    executedJobIds.push(job.id)

    if (job.kind === "managed") {
      await params.runManaged(job.workspaceIds, job.queries)
    } else {
      for (const queryVariant of job.queries) {
        await params.runLocal(job.workspaceIds, queryVariant)
        if (params.getEvidenceCount() >= params.evidenceLimit) break
      }
    }

    params.onJobFinished?.(job)

    if (params.verifyAfterJob) {
      const verification = await params.verifyAfterJob(job)
      verificationReports.push({
        jobId: job.id,
        continueLoop: verification.continueLoop,
        reason: verification.reason ?? null,
        metadata: verification.metadata || {},
      })
      if (!verification.continueLoop) {
        stopReason = verification.reason ?? null
        break
      }
    }

    if (params.getEvidenceCount() >= params.evidenceLimit) {
      stopReason = stopReason || "evidence_limit_reached"
      break
    }
  }

  return {
    executedJobIds,
    budgetExhausted,
    exhaustedLabel,
    stopReason,
    verificationReports,
  }
}
