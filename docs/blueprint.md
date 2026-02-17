# Cuaderno Ambiental - Blueprint

Objetivo: plataforma web tipo NotebookLM para el Tribunal Ambiental de Chile, con dos modulos.

## Modulo A (NotebookLM estricto)

- Fuentes por expediente: URLs HTML/PDF publicas y PDFs subidos.
- Versionado: cada fuente genera snapshots con hash + fecha.
- Indexacion: modo configurable `local` (pgvector), `openai` (File Search) o `hybrid`.
- Chat: RAG estricto; respuestas solo con evidencia; citas obligatorias.

Regla de precision:

- Si no hay evidencia suficiente en las fuentes: responder exactamente "No se encuentra en las fuentes disponibles.".

## Modulo B (Monitor Excel)

- Conexiones OAuth:
  - Google Drive (drive.readonly)
  - Microsoft Graph / OneDrive (Files.Read)
- Watchlists por expediente:
  - Archivo + hoja
  - Clave de fila (una o mas columnas)
  - Columnas monitoreadas
  - Frecuencia de revision
  - Frecuencia de correo (diario o inmediato)
- Historial:
  - Runs con resumen y paths a snapshot/diff en Storage
  - Envios de correo (sent/error/skipped)

## Arquitectura (Opcion 1)

- Next.js:
  - UI (App Router)
  - API Route Handlers
- Supabase:
  - Postgres (RLS + pgvector)
  - Storage (buckets: gob_sources, gob_excel)
- OpenAI (opcional/recomendado para RAG gestionado):
  - Vector Stores + File Search
- Worker Node/TS:
  - Consume jobs desde Postgres via RPC gob_claim_jobs
  - Ingesta fuentes, indexacion local/OpenAI, diffs Excel, emails

## Jobs

- source_ingest
  - Descarga snapshot o lee upload
  - Extrae texto (PDF por pagina; HTML por secciones)
  - Chunking + embeddings locales (si aplica) + indexacion OpenAI (si aplica)
  - Inserta gob_chunks

- excel_check
  - Lee metadata (eTag/modifiedTime)
  - Si cambia: descarga, parse XLSX, diff contra snapshot previo
  - Inserta gob_excel_runs
  - Encola email_digest segun schedule

- email_digest
  - Consolida cambios desde last_emailed_at
  - Envia correo (SMTP)
  - Inserta gob_email_runs

- report_generate
  - Recupera evidencia por seccion (embeddings + texto)
  - Genera el informe en modo batch (1 llamada) con citas verificables
  - Actualiza gob_reports por progreso/resultado

## Endpoints principales

- POST/GET `/api/workspaces`
- POST/GET `/api/workspaces/:id/sources`
- POST/GET `/api/workspaces/:id/chat`
- GET `/api/chunks/:id`
- POST/GET `/api/workspaces/:id/notes`
- GET `/api/workspaces/:id/reports`
- POST `/api/workspaces/:id/reports/generate`
- GET `/api/oauth/connections`
- GET `/api/oauth/google/start` + callback
- GET `/api/oauth/microsoft/start` + callback
- POST/GET `/api/workspaces/:id/watchlists`
- GET `/api/workspaces/:id/search` (busqueda literal en fuentes)
- GET `/api/snapshots/:id/open` (abre snapshot privado con URL firmada)
- GET `/api/workspaces/:id` (PATCH/DELETE admin)

## UI

- `/workspaces` lista de expedientes
- `/workspaces/:id` vista cuaderno 3 paneles (Fuentes / Chat / Studio)
