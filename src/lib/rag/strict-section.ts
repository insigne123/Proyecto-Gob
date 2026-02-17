import { z } from "genkit"

import { ai } from "@/ai/genkit"
import type { EvidenceChunk } from "@/lib/rag/strict-answer"

const SectionSchema = z.object({
  body: z.string(),
  citations: z
    .array(
      z.object({
        chunkId: z.string(),
        quote: z.string(),
      })
    )
    .default([]),
  notFound: z.boolean().default(false),
  suggestions: z.array(z.string()).default([]),
})

function normalize(s: string) {
  return s
    .replace(/\s+/g, " ")
    .replace(/\u00A0/g, " ")
    .trim()
    .toLowerCase()
}

export async function generateStrictSection(params: {
  heading: string
  instruction: string
  notes: Array<{ title: string | null; content: string }>
  evidence: EvidenceChunk[]
}) {
  const { heading, instruction, notes, evidence } = params

  const evidenceBlock = evidence
    .slice(0, 14)
    .map((c, idx) => {
      const locParts = [
        c.sourceUrl ? `url=${c.sourceUrl}` : null,
        c.snapshotId ? `snapshot=${c.snapshotId}` : null,
        typeof c.page === "number" ? `page=${c.page}` : null,
        c.section ? `section=${c.section}` : null,
      ].filter(Boolean)
      const loc = locParts.length ? ` (${locParts.join(", ")})` : ""
      const content = c.content.length > 1200 ? `${c.content.slice(0, 1200)}...` : c.content
      return `EVIDENCE ${idx + 1}: chunkId=${c.chunkId}${loc}\n${content}`
    })
    .join("\n\n---\n\n")

  const notesBlock = notes.length
    ? notes
        .slice(0, 18)
        .map((n, idx) => {
          const t = n.title ? `${n.title}: ` : ""
          const c = n.content.length > 400 ? `${n.content.slice(0, 400)}...` : n.content
          return `NOTE ${idx + 1}: ${t}${c}`
        })
        .join("\n")
    : "(sin notas)"

  const system =
    "Eres un asistente documental para el Tribunal Ambiental de Chile. Regla critica: NO inventes. Responde SOLO usando EVIDENCE. Las notas del usuario NO son evidencia. Si no hay evidencia suficiente, debes marcar notFound=true y escribir exactamente: 'No se encuentra en las fuentes disponibles.'"

  const prompt =
    `Seccion: ${heading}\n` +
    `Instruccion: ${instruction}\n\n` +
    `Notas (no son evidencia):\n${notesBlock}\n\n` +
    `Bloque EVIDENCE (unico material permitido como evidencia):\n\n${evidenceBlock}\n\n` +
    "Reglas:\n" +
    "- Modo extractivo: prioriza citas textuales cortas y sintesis minima.\n" +
    "- Cada afirmacion relevante debe estar respaldada por al menos una cita.\n" +
    "- En citations, incluye quotes copiadas literalmente desde el chunk citado.\n" +
    "- En citations, solo puedes usar chunkId presentes en EVIDENCE.\n" +
    "- Si no puedes citar, notFound=true.\n"

  const resp = await ai.generate({
    system,
    prompt,
    output: { schema: SectionSchema },
    config: {
      temperature: 0.1,
      topP: 0.9,
    },
  })

  const out = resp.output
  if (!out) {
    return {
      body: "No se encuentra en las fuentes disponibles.",
      citations: [],
      notFound: true,
      suggestions: ["Agrega una fuente (URL/PDF) que contenga informacion para esta seccion."],
      model: resp.model,
      usage: resp.usage,
    }
  }

  const allowed = new Map(evidence.map((c) => [c.chunkId, c]))
  const verifiedCitations = (out.citations ?? [])
    .map((c) => ({ chunkId: String(c.chunkId), quote: String(c.quote) }))
    .filter((c) => allowed.has(c.chunkId))
    .filter((c) => {
      const chunk = allowed.get(c.chunkId)!
      const hay = normalize(chunk.content)
      const needle = normalize(c.quote)
      return needle.length >= 12 && hay.includes(needle)
    })

  const notFound = Boolean(out.notFound) || verifiedCitations.length === 0
  const body = notFound
    ? "No se encuentra en las fuentes disponibles."
    : String(out.body || "").trim() || "No se encuentra en las fuentes disponibles."

  return {
    body,
    citations: verifiedCitations,
    notFound,
    suggestions: Array.isArray(out.suggestions) ? out.suggestions.map(String) : [],
    model: resp.model,
    usage: resp.usage,
  }
}
