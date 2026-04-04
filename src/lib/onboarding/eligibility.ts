import {
  isSeaDefendantCaratula,
  isSmaDefendantCaratula,
  normalizeTribunalCode,
} from "@/lib/tribunal/one-ta"

function normalizeTribunalToken(value: string) {
  const normalized = normalizeTribunalCode(value)
  if (!normalized) return null
  return String(normalized).toUpperCase()
}

export function onboardingAllowedTribunals() {
  const raw = String(process.env.ONBOARDING_ELIGIBLE_TRIBUNALS || "1TA,2TA")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)

  const allowed = new Set<string>()
  for (const token of raw) {
    const normalized = normalizeTribunalToken(token)
    if (!normalized) continue
    allowed.add(normalized)
  }

  if (!allowed.size) {
    allowed.add("1TA")
    allowed.add("2TA")
  }

  return allowed
}

export function onboardingAllowedAuthorities() {
  const raw = String(process.env.ONBOARDING_ELIGIBLE_AUTHORITIES || "SEA,SMA")
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean)

  const allowed = new Set<string>()
  for (const token of raw) {
    if (token === "SEA" || token === "SMA") {
      allowed.add(token)
    }
  }

  if (!allowed.size) {
    allowed.add("SEA")
  }

  return allowed
}

function isEligibleAuthority(caratula: string | null | undefined) {
  const allowed = onboardingAllowedAuthorities()
  if (allowed.has("SEA") && isSeaDefendantCaratula(caratula || null)) return true
  if (allowed.has("SMA") && isSmaDefendantCaratula(caratula || null)) return true
  return false
}

export function isEligibleOnboardingCause(cause: {
  tribunal?: string | null
  caratula?: string | null
}) {
  if (!cause) return false
  const tribunal = normalizeTribunalToken(String(cause.tribunal || ""))
  if (!tribunal) return false

  const allowed = onboardingAllowedTribunals()
  if (!allowed.has(tribunal)) return false

  return isEligibleAuthority(cause.caratula || null)
}

export function onboardingEligibilityReason(cause: {
  tribunal?: string | null
  caratula?: string | null
}) {
  const tribunal = normalizeTribunalToken(String(cause?.tribunal || ""))
  if (!tribunal) return "tribunal_no_reconocido"

  const allowed = onboardingAllowedTribunals()
  if (!allowed.has(tribunal)) return "tribunal_fuera_del_scope"

  if (!isEligibleAuthority(cause?.caratula || null)) return "caratula_fuera_autoridad"

  return "eligible"
}
