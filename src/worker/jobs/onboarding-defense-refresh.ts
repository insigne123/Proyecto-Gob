import { refreshOnboardingDefensePool } from "../../lib/onboarding/defense-pool"
import { ensureTribunalCorpusWorkspace } from "../../lib/onboarding/tribunal-corpus"

function intEnv(name: string, fallback: number, min: number, max: number) {
  const raw = Number(process.env[name] || fallback)
  if (!Number.isFinite(raw)) return fallback
  return Math.max(min, Math.min(max, Math.floor(raw)))
}

export async function onboardingDefenseRefreshJob(params: { supabase: any; job: any }) {
  const { supabase, job } = params
  const nowIso = new Date().toISOString()

  const corpus = await ensureTribunalCorpusWorkspace(supabase)

  const maxCauseProfilesPerRun = intEnv("ONBOARDING_PROFILE_MAX_CAUSES_PER_RUN", 240, 20, 800)
  const maxDocProfilesPerRun = intEnv("ONBOARDING_PROFILE_MAX_DOCS_PER_RUN", 900, 40, 4000)

  const refreshProfiles =
    String(process.env.ONBOARDING_PROFILE_REFRESH_ENABLED || "")
      .trim()
      .toLowerCase() !== "false"

  const stats = await refreshOnboardingDefensePool({
    admin: supabase,
    refreshProfiles,
    maxCauseProfilesPerRun,
    maxDocProfilesPerRun,
  })

  await supabase.from("gob_audit_logs").insert({
    user_id: null,
    action: "onboarding.defense_pool.refresh.ok",
    target_resource: "gob_onboarding_cause_pool",
    details: {
      source: String(job.payload?.source || "job"),
      corpus_workspace_id: corpus.id,
      refresh_profiles: refreshProfiles,
      max_cause_profiles_per_run: maxCauseProfilesPerRun,
      max_doc_profiles_per_run: maxDocProfilesPerRun,
      ...stats,
    },
    timestamp: nowIso,
  })
}
