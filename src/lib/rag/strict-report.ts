import { z } from "genkit"

import { ai } from "@/ai/genkit"
import type { EvidenceChunk } from "@/lib/rag/strict-answer"

const ReportSchema = z.object({
  title: z.string(),
  sections: z.array(
    z.object({
      heading: z.string(),
      body: z.string(),
      citations: z
        .array(
          z.object({
            chunkId: z.string(),
            quote: z.string(),
          })
        )
        .default([]),
    })
  ),
})

function normalize(s: string) {
  return s.replace(/\s+/g, " ").trim().toLowerCase()
}

export async function generateStrictReport(params: {
  workspaceTitle: string
  notes: Array<{ title: string | null; content: string }>
  evidence: EvidenceChunk[]
}) {
  const { workspaceTitle, notes, evidence } = params

  const allowed = new Map(evidence.map((c) => [c.chunkId, c]))
  const evidenceBlock = evidence
    .slice(0, 18)
    .map((c, idx) => {
      const content = c.content.length > 1200 ? `${c.content.slice(0, 1200)}...` : c.content
      return `EVIDENCE ${idx + 1}: chunkId=${c.chunkId}\n${content}`
    })
    .join("\n\n---\n\n")

  const notesBlock = notes.length
    ? notes
        .slice(0, 30)
        .map((n, idx) => `NOTE ${idx + 1}: ${n.title ? `${n.title}: ` : ""}${n.content}`)
        .join("\n")
    : "(sin notas)"

  const system =
    "Eres un asistente documental para el Tribunal Ambiental de Chile. Regla critica: NO inventes. Debes redactar SOLO con evidencia entregada. Si una seccion no tiene evidencia suficiente, escribe literalmente: 'No se encuentra en las fuentes disponibles.' y deja citations vacio en esa seccion."

  const prompt =
    `Proyecto: ${workspaceTitle}\n\n` +
    `Notas del usuario (pueden orientar, pero NO son evidencia si no tienen respaldo):\n${notesBlock}\n\n` +
    `Bloque EVIDENCE (unico material permitido como evidencia):\n\n${evidenceBlock}\n\n` +
    "Crea un borrador de informe con estas secciones (en este orden):\n" +
    "1) Antecedentes y contexto\n" +
    "2) Hechos relevantes (extractivo)\n" +
    "3) Analisis (solo lo explicitamente sustentado)\n" +
    "4) Conclusiones (extremadamente estricto; sin inferencias)\n\n" +
    "Reglas:\n" +
    "- Cada seccion debe incluir citas textuales cortas en citations (quote) copiadas literalmente desde el chunk citado.\n" +
    "- Solo puedes usar chunkId presentes en EVIDENCE.\n" +
    "- No uses leyes/normas externas si no estan en EVIDENCE.\n"

  const resp = await ai.generate({
    system,
    prompt,
    output: { schema: ReportSchema },
    config: { temperature: 0.15, topP: 0.9 },
  })

  const out = resp.output
  if (!out) {
    return {
      title: "Informe (borrador)",
      sections: [
        {
          heading: "Antecedentes y contexto",
          body: "No se encuentra en las fuentes disponibles.",
          citations: [],
        },
      ],
      citations: [],
      notFound: true,
      model: resp.model,
      usage: resp.usage,
    }
  }

  const verifiedSections = out.sections.map((s: any) => {
    const citations = (s.citations ?? [])
      .map((c: any) => ({ chunkId: String(c.chunkId), quote: String(c.quote) }))
      .filter((c: any) => allowed.has(c.chunkId))
      .filter((c: any) => {
        const chunk = allowed.get(c.chunkId)!
        const hay = normalize(chunk.content)
        const needle = normalize(c.quote)
        return needle.length >= 12 && hay.includes(needle)
      })

    const body = String(s.body ?? "").trim()
    const safeBody = citations.length ? body : "No se encuentra en las fuentes disponibles."
    return {
      heading: String(s.heading ?? "Seccion").trim(),
      body: safeBody,
      citations,
    }
  })

  const flat = verifiedSections.flatMap((s) => s.citations)
  const notFound = flat.length === 0

  return {
    title: String(out.title || "Informe (borrador)"),
    sections: verifiedSections,
    citations: flat,
    notFound,
    model: resp.model,
    usage: resp.usage,
  }
}
