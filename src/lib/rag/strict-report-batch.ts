import { z } from "genkit"

import { ai } from "@/ai/genkit"
import { resolveRagAnswerProvider } from "@/lib/env"
import { generateOpenAIJson } from "@/lib/llm/openai-json"
import type { ReportTemplate } from "@/lib/reports/template"
import type { EvidenceChunk } from "@/lib/rag/strict-answer"

const ReportParagraphSchema = z.object({
  text: z.string(),
  citations: z
    .array(
      z.object({
        chunkId: z.string(),
        quote: z.string(),
      })
    )
    .default([]),
  notFound: z.boolean().default(false),
})

const ReportOutputSchema = z.object({
  title: z.string().default("Informe (borrador)"),
  sections: z
    .array(
      z.object({
        key: z.string(),
        heading: z.string(),
        paragraphs: z.array(ReportParagraphSchema).default([]),
        notFound: z.boolean().default(false),
      })
    )
    .default([]),
})

const ReportOutputJsonSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          heading: { type: "string" },
          paragraphs: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                citations: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      chunkId: { type: "string" },
                      quote: { type: "string" },
                    },
                    required: ["chunkId", "quote"],
                    additionalProperties: false,
                  },
                },
                notFound: { type: "boolean" },
              },
              required: ["text", "citations", "notFound"],
              additionalProperties: false,
            },
          },
          notFound: { type: "boolean" },
        },
        required: ["key", "heading", "paragraphs", "notFound"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "sections"],
  additionalProperties: false,
} as const

function normalize(s: string) {
  return s
    .replace(/\s+/g, " ")
    .replace(/\u00A0/g, " ")
    .trim()
    .toLowerCase()
}

type ReportPrecedentHint = {
  reportId: string
  workspaceId: string
  workspaceTitle: string
  status: string
  createdAt: string | null
  templateId: string | null
  score: number
  why: string
  excerpt: string
}

export async function generateStrictReportBatch(params: {
  workspaceTitle: string
  template: ReportTemplate
  notes: Array<{ title: string | null; content: string }>
  evidence: EvidenceChunk[]
  sectionHints?: Record<string, string[]>
  precedents?: ReportPrecedentHint[]
}) {
  const { workspaceTitle, template, notes, evidence, sectionHints, precedents = [] } = params
  const maxEvidenceForPrompt = Math.min(64, Math.max(26, template.sections.length * 4))

  const evidenceBlock = evidence
    .slice(0, maxEvidenceForPrompt)
    .map((c, idx) => {
      const locParts = [
        c.sourceUrl ? `url=${c.sourceUrl}` : null,
        c.snapshotId ? `snapshot=${c.snapshotId}` : null,
        typeof c.page === "number" ? `page=${c.page}` : null,
        c.section ? `section=${c.section}` : null,
      ].filter(Boolean)
      const loc = locParts.length ? ` (${locParts.join(", ")})` : ""
      const content = c.content.length > 1300 ? `${c.content.slice(0, 1300)}...` : c.content
      return `EVIDENCE ${idx + 1}: chunkId=${c.chunkId}${loc}\n${content}`
    })
    .join("\n\n---\n\n")

  const notesBlock = notes.length
    ? notes
        .slice(0, 20)
        .map((n, idx) => {
          const t = n.title ? `${n.title}: ` : ""
          const c = n.content.length > 500 ? `${n.content.slice(0, 500)}...` : n.content
          return `NOTE ${idx + 1}: ${t}${c}`
        })
        .join("\n")
    : "(sin notas)"

  const precedentsBlock = precedents.length
    ? precedents
        .slice(0, 5)
        .map((p, idx) => {
          let createdLabel = "s/f"
          if (p.createdAt) {
            const ts = Date.parse(String(p.createdAt))
            if (Number.isFinite(ts)) {
              createdLabel = new Date(ts).toLocaleDateString("es-CL")
            }
          }
          const excerpt = p.excerpt.length > 1100 ? `${p.excerpt.slice(0, 1100)}...` : p.excerpt
          return [
            `PRECEDENT ${idx + 1}: reportId=${p.reportId}`,
            `workspace=${p.workspaceTitle}`,
            `template=${p.templateId || "n/a"}`,
            `status=${p.status}`,
            `created=${createdLabel}`,
            `score=${p.score.toFixed(3)}`,
            `why=${p.why}`,
            `excerpt=${excerpt}`,
          ].join("\n")
        })
        .join("\n\n---\n\n")
    : "(sin precedentes relacionados)"

  const templateBlock = template.sections
    .map((s, idx) => {
      const hints = sectionHints?.[s.key] || []
      const hintLine = hints.length ? `preferredChunkIds=[${hints.join(",")}]` : "preferredChunkIds=[]"
      return [
        `SECTION ${idx + 1}: key=${s.key}`,
        `heading=${s.heading}`,
        `instruction=${s.instruction}`,
        hintLine,
      ].join("\n")
    })
    .join("\n\n")

  const system =
    "Eres un asistente documental para el Tribunal Ambiental de Chile. Regla critica: NO inventes. Debes redactar SOLO con evidencia del bloque EVIDENCE para hechos del expediente actual. Las notas del usuario NO son evidencia. Los precedentes son solo guias de estructura y estilo institucional. Todas las afirmaciones relevantes deben estar respaldadas por citas textuales cortas. Si una seccion no tiene evidencia suficiente, escribe exactamente: 'No se encuentra en las fuentes disponibles.' y marca notFound=true."

  const prompt =
    `Expediente: ${workspaceTitle}\n\n` +
    `Notas (no son evidencia):\n${notesBlock}\n\n` +
    `Precedentes relacionados (solo para estructura/tono; no para hechos del caso actual):\n\n${precedentsBlock}\n\n` +
    `Plantilla de informe (secciones obligatorias, en orden):\n\n${templateBlock}\n\n` +
    `Bloque EVIDENCE (unico material permitido como evidencia):\n\n${evidenceBlock}\n\n` +
    "Reglas de salida JSON:\n" +
    "- Debes devolver SOLO un objeto JSON valido, sin texto extra.\n" +
    "- Debes devolver sections con EXACTAMENTE las mismas keys y headings del template, en el mismo orden.\n" +
    "- Debes redactar cada seccion como paragraphs (1 a 6 parrafos).\n" +
    "- Cada parrafo debe incluir al menos 1 cita verificable en citations.\n" +
    "- En citations, usa chunkId presentes en EVIDENCE y quote copiada literalmente desde el chunk.\n" +
    "- Puedes tomar la estructura argumental de PRECEDENT, pero no puedes trasladar hechos, cifras ni conclusiones de PRECEDENT al expediente actual sin cita del EVIDENCE actual.\n" +
    "- No uses leyes/normas externas si no aparecen en EVIDENCE.\n"

  const answerProvider = resolveRagAnswerProvider()
  let out: any = null
  let model: string | null = null
  let usage: any = null

  if (answerProvider === "openai") {
    const openai = await generateOpenAIJson({
      system,
      prompt,
      schemaName: "strict_report_batch",
      schema: ReportOutputJsonSchema,
    })
    out = openai.output
    model = openai.model
    usage = openai.usage
  } else {
    const resp = await ai.generate({
      system,
      prompt,
      output: { schema: ReportOutputSchema, format: "json", constrained: true },
      config: { temperature: 0.1, topP: 0.9 },
    })

    out = resp.output
    model = resp.model ?? null
    usage = resp.usage
  }

  if (!out) {
    return {
      title: template.title,
      sections: template.sections.map((s) => ({
        key: s.key,
        heading: s.heading,
        body: "No se encuentra en las fuentes disponibles.",
        citations: [],
        notFound: true,
      })),
      citations: [],
      notFound: true,
      model,
      usage,
    }
  }

  const allowed = new Map(evidence.map((c) => [c.chunkId, c]))
  const sectionsByKey = new Map(((out as any).sections ?? []).map((s: any) => [String(s.key), s]))

  const verifiedSections = template.sections.map((tpl) => {
    const raw: any = sectionsByKey.get(tpl.key)
    const rawNotFound = Boolean(raw?.notFound)
    const rawParagraphs = Array.isArray(raw?.paragraphs) ? raw.paragraphs : []

    const verifiedParagraphs = rawParagraphs
      .slice(0, 8)
      .map((p: any) => {
        const rawText = String(p?.text ?? "").trim()
        const pNotFound = Boolean(p?.notFound)
        const rawCitations = Array.isArray(p?.citations) ? p.citations : []

        const citations = rawCitations
          .map((c: any) => ({ chunkId: String(c.chunkId), quote: String(c.quote) }))
          .filter((c: any) => allowed.has(c.chunkId))
          .filter((c: any) => {
            const chunk = allowed.get(c.chunkId)!
            const hay = normalize(chunk.content)
            const needle = normalize(c.quote)
            return needle.length >= 12 && hay.includes(needle)
          })

        const ok = citations.length > 0 && !pNotFound
        return {
          text: ok ? rawText || "No se encuentra en las fuentes disponibles." : "No se encuentra en las fuentes disponibles.",
          citations,
          notFound: !ok,
        }
      })

    const supported = verifiedParagraphs.filter((p: any) => !p.notFound)
    const notFound = rawNotFound || supported.length === 0
    const body = notFound
      ? "No se encuentra en las fuentes disponibles."
      : supported.map((p: any) => p.text).join("\n\n")

    const citations = supported.flatMap((p: any, paragraph: number) =>
      (p.citations ?? []).map((c: any) => ({ ...c, paragraph, section: tpl.key }))
    )

    return {
      key: tpl.key,
      heading: tpl.heading,
      body,
      paragraphs: supported,
      citations,
      notFound,
    }
  })

  const flat = verifiedSections.flatMap((s) => s.citations)
  const notFound = flat.length === 0

  return {
    title: String(out.title || template.title),
    sections: verifiedSections,
    citations: flat,
    notFound,
    model,
    usage,
  }
}
