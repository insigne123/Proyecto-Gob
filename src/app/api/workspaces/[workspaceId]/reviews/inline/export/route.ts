import { NextResponse } from "next/server"
import { z } from "zod"
import { Document, Packer, Paragraph, TextRun } from "docx"

import { createClient } from "@/lib/supabase/server"

const ExportRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    mode: z.enum(["clean", "changes"]).optional(),
    originalParagraphs: z.array(z.string().trim().min(1).max(8000)).max(1200).optional(),
    paragraphs: z.array(z.string().trim().min(1).max(8000)).min(1).max(1200),
  })
  .strict()

function slugify(input: string) {
  return String(input || "informe-revisado")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 80)
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: member } = await supabase
    .from("gob_workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await request.json().catch(() => null)
  const parsed = ExportRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const title = parsed.data.title || "Informe revisado"
  const mode = parsed.data.mode || "clean"
  const originalParagraphs = parsed.data.originalParagraphs || []
  const revisedParagraphs = parsed.data.paragraphs

  if (mode === "changes" && originalParagraphs.length && originalParagraphs.length !== revisedParagraphs.length) {
    return NextResponse.json(
      { error: "Invalid payload: originalParagraphs and paragraphs must have the same length" },
      { status: 400 }
    )
  }

  const changedCount = revisedParagraphs.reduce((acc, paragraph, index) => {
    const before = String(originalParagraphs[index] || "").replace(/\s+/g, " ").trim()
    const after = String(paragraph || "").replace(/\s+/g, " ").trim()
    return before && before !== after ? acc + 1 : acc
  }, 0)

  const doc = new Document({
    sections: [
      {
        children:
          mode === "changes"
            ? revisedParagraphs.flatMap((paragraph, index) => {
                const before = String(originalParagraphs[index] || "").trim()
                const after = String(paragraph || "").trim()

                if (!before || before === after) {
                  return [
                    new Paragraph({
                      children: [new TextRun(after)],
                    }),
                  ]
                }

                return [
                  new Paragraph({
                    children: [
                      new TextRun({ text: `Parrafo ${index + 1} (cambio)`, bold: true }),
                    ],
                  }),
                  new Paragraph({
                    children: [
                      new TextRun({ text: "Antes: ", bold: true, color: "C0504D" }),
                      new TextRun({ text: before, strike: true, color: "C0504D" }),
                    ],
                  }),
                  new Paragraph({
                    children: [
                      new TextRun({ text: "Propuesta: ", bold: true, color: "2E7D32" }),
                      new TextRun({ text: after, underline: {}, color: "2E7D32" }),
                    ],
                  }),
                ]
              })
            : revisedParagraphs.map(
                (paragraph) =>
                  new Paragraph({
                    children: [new TextRun(paragraph)],
                  })
              ),
      },
    ],
  })

  const buffer = await Packer.toBuffer(doc)
  const filename = `${slugify(title) || "informe-revisado"}${mode === "changes" ? "-con-cambios" : ""}.docx`

  try {
    await supabase.from("gob_audit_logs").insert({
      user_id: user.id,
      action: "workspace.review.inline.export_docx",
      target_resource: "gob_sources",
      details: {
        workspace_id: workspaceId,
        filename,
        paragraphs: revisedParagraphs.length,
        mode,
        changed_count: changedCount,
      },
      timestamp: new Date().toISOString(),
    })
  } catch {
    // ignore audit failures
  }

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  })
}
