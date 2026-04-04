import { NextResponse } from "next/server"

type StreamStage = {
  label: string
  detail: string
}

function buildStages(payload: any): StreamStage[] {
  const hasAttachedSource = Boolean(payload?.sourceId)
  return [
    {
      label: "Interpretando consulta",
      detail: "Estoy clasificando la solicitud y definiendo el mejor modo de respuesta.",
    },
    {
      label: "Planificando la busqueda",
      detail: hasAttachedSource
        ? "Priorizo el documento adjunto y lo conecto con el resto de la evidencia disponible."
        : "Preparo variantes de retrieval para recuperar evidencia util sin meter ruido.",
    },
    {
      label: "Recuperando evidencia",
      detail: "Cruzo fuentes del proyecto, reordeno resultados y filtro fragmentos poco utiles.",
    },
    {
      label: "Verificando respaldo",
      detail: "Reviso citas y consistencia antes de cerrar la respuesta final.",
    },
    {
      label: "Redactando respuesta",
      detail: "Estoy consolidando una respuesta clara, practica y trazable.",
    },
  ]
}

function sendSse(controller: ReadableStreamDefaultController<Uint8Array>, event: string, payload: unknown) {
  const encoder = new TextEncoder()
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`))
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const rawBody = await request.text()
  const parsedBody = (() => {
    try {
      return JSON.parse(rawBody)
    } catch {
      return null
    }
  })()

  const targetUrl = new URL(`/api/workspaces/${workspaceId}/chat`, request.url)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const stages = buildStages(parsedBody)
      let stageIdx = 0

      sendSse(controller, "stage", { ...stages[stageIdx], index: stageIdx })

      const intervalId = setInterval(() => {
        stageIdx = Math.min(stageIdx + 1, stages.length - 1)
        sendSse(controller, "stage", { ...stages[stageIdx], index: stageIdx })
      }, 1400)

      try {
        const response = await fetch(targetUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            cookie: request.headers.get("cookie") || "",
            authorization: request.headers.get("authorization") || "",
          },
          body: rawBody,
          cache: "no-store",
        })

        const json = await response.json().catch(() => null)
        clearInterval(intervalId)

        if (!response.ok) {
          sendSse(controller, "error", {
            status: response.status,
            error: json?.error || "No se pudo completar la respuesta",
          })
          controller.close()
          return
        }

        sendSse(controller, "final", json)
        controller.close()
      } catch (err: any) {
        clearInterval(intervalId)
        sendSse(controller, "error", {
          status: 500,
          error: err?.message || "Error inesperado en stream de chat",
        })
        controller.close()
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
