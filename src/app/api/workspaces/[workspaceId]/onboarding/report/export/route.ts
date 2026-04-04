import { NextResponse } from "next/server"
import { z } from "zod"
import { Document, Packer, Paragraph, TextRun } from "docx"
import { PDFDocument, StandardFonts, rgb } from "pdf-lib"

import { createClient } from "@/lib/supabase/server"

const ExportSchema = z
  .object({
    title: z.string().trim().max(220).optional().nullable(),
    content: z.string().trim().min(20).max(200000),
    format: z.enum(["pdf", "docx"]),
  })
  .strict()

function sanitizeFileName(value: string) {
  return String(value || "informe-marco-teorico")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
}

function chunkParagraphs(content: string) {
  return String(content || "")
    .split(/\n{2,}/)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean)
}

function wrapLine(text: string, maxChars: number) {
  const words = String(text || "").split(" ")
  const out: string[] = []
  let line = ""
  for (const word of words) {
    if (!word) continue
    const next = line ? `${line} ${word}` : word
    if (next.length <= maxChars) {
      line = next
      continue
    }
    if (line) out.push(line)
    line = word
  }
  if (line) out.push(line)
  return out
}

async function buildPdfBuffer(title: string, content: string) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const width = 612
  const height = 792
  const marginX = 52
  const marginY = 56
  const bodySize = 11
  const lineHeight = 15

  let page = pdf.addPage([width, height])
  let y = height - marginY

  const newPage = () => {
    page = pdf.addPage([width, height])
    y = height - marginY
  }

  page.drawText(title, {
    x: marginX,
    y,
    size: 16,
    font: fontBold,
    color: rgb(0.06, 0.08, 0.12),
  })
  y -= 28

  const paragraphs = chunkParagraphs(content)
  for (const p of paragraphs) {
    const lines = wrapLine(p, 92)
    for (const line of lines) {
      if (y <= marginY) newPage()
      page.drawText(line, {
        x: marginX,
        y,
        size: bodySize,
        font,
        color: rgb(0.1, 0.12, 0.16),
      })
      y -= lineHeight
    }
    y -= 8
  }

  return Buffer.from(await pdf.save())
}

async function buildDocxBuffer(title: string, content: string) {
  const paragraphs = chunkParagraphs(content)
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            spacing: { after: 260 },
            children: [new TextRun({ text: title, bold: true, size: 34 })],
          }),
          ...paragraphs.map(
            (text) =>
              new Paragraph({
                spacing: { after: 180 },
                children: [new TextRun({ text, size: 22 })],
              })
          ),
        ],
      },
    ],
  })
  return Buffer.from(await Packer.toBuffer(doc))
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
  const parsed = ExportSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 })
  }

  const title = parsed.data.title ? String(parsed.data.title) : "Informe automatico de marco teorico"
  const safeName = sanitizeFileName(title)

  if (parsed.data.format === "pdf") {
    const buffer = await buildPdfBuffer(title, parsed.data.content)
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename=\"${safeName}.pdf\"`,
      },
    })
  }

  const buffer = await buildDocxBuffer(title, parsed.data.content)
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename=\"${safeName}.docx\"`,
    },
  })
}
