export type FinalAnswerSupportStrength = "none" | "weak" | "partial" | "strong"

export function resolveFinalAnswerSupport(params: {
  initialStrength?: string | null
  defenseCoverageStatus?: string | null
  citations?: Array<{ chunkId?: string | null }> | null
  rescueApplied?: boolean
  mode?: string | null
}) {
  const normalizedInitial = String(params.initialStrength || "").trim().toLowerCase()
  const citations = Array.isArray(params.citations) ? params.citations : []
  const uniqueCitationChunks = new Set(
    citations.map((item) => String(item?.chunkId || "").trim()).filter(Boolean)
  ).size
  const coverage = String(params.defenseCoverageStatus || "").trim().toLowerCase()
  const mode = String(params.mode || "").trim().toLowerCase()
  const rescueApplied = Boolean(params.rescueApplied)

  if (normalizedInitial === "strong") {
    return {
      strength: "strong" as FinalAnswerSupportStrength,
      reason: "La respuesta final mantiene un nivel de soporte fuerte despues de los ajustes finales.",
      uniqueCitationChunks,
    }
  }

  if (uniqueCitationChunks <= 0) {
    return {
      strength:
        normalizedInitial === "partial" || normalizedInitial === "weak" || normalizedInitial === "none"
          ? (normalizedInitial as FinalAnswerSupportStrength)
          : null,
      reason:
        normalizedInitial === "partial" || normalizedInitial === "weak" || normalizedInitial === "none"
          ? null
          : "La respuesta final no conserva citas verificables en el mensaje mostrado.",
      uniqueCitationChunks,
    }
  }

  if (rescueApplied) {
    if (
      coverage === "ready" &&
      uniqueCitationChunks >= 3 &&
      (mode === "checklist" || mode === "resolution" || mode === "comparison")
    ) {
      return {
        strength: "strong" as FinalAnswerSupportStrength,
        reason: "La respuesta final se apoyo en un rescate sintetico, pero mantiene cobertura documental completa y suficientes citas distintas para considerarla fuertemente respaldada.",
        uniqueCitationChunks,
      }
    }

    return {
      strength: "partial" as FinalAnswerSupportStrength,
      reason: "La respuesta final se entrega en modo de rescate: hay citas utiles, pero la cobertura sigue siendo parcial y requiere validacion humana.",
      uniqueCitationChunks,
    }
  }

  if (
    normalizedInitial === "partial" &&
    uniqueCitationChunks >= 3 &&
    coverage === "ready" &&
    (mode === "checklist" || mode === "resolution" || mode === "comparison")
  ) {
    return {
      strength: "strong" as FinalAnswerSupportStrength,
      reason: "La respuesta final conserva citas suficientes y cobertura documental completa para considerarla fuertemente respaldada.",
      uniqueCitationChunks,
    }
  }

  if (normalizedInitial === "partial") {
    return {
      strength: "partial" as FinalAnswerSupportStrength,
      reason: null,
      uniqueCitationChunks,
    }
  }

  if (normalizedInitial === "weak" && uniqueCitationChunks >= 2) {
    return {
      strength: "partial" as FinalAnswerSupportStrength,
      reason: "La respuesta final conserva citas suficientes para un soporte parcial, aunque no alcanza nivel fuerte.",
      uniqueCitationChunks,
    }
  }

  if ((normalizedInitial === "none" || !normalizedInitial) && uniqueCitationChunks >= 2) {
    return {
      strength: "partial" as FinalAnswerSupportStrength,
      reason: "La respuesta final conserva al menos dos citas utiles; se marca con soporte parcial en vez de ausencia total de respaldo.",
      uniqueCitationChunks,
    }
  }

  if ((normalizedInitial === "none" || !normalizedInitial) && uniqueCitationChunks === 1) {
    return {
      strength: "weak" as FinalAnswerSupportStrength,
      reason: "La respuesta final conserva una sola cita util; el soporte existe, pero sigue siendo debil.",
      uniqueCitationChunks,
    }
  }

  return {
    strength:
      normalizedInitial === "none" || normalizedInitial === "weak"
        ? (normalizedInitial as FinalAnswerSupportStrength)
        : null,
    reason: null,
    uniqueCitationChunks,
  }
}
