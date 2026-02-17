# Checklist de despliegue (Cuaderno Ambiental)

## 1) Supabase (DB + RLS)

- Ejecuta `supabase_schema.sql` en el SQL editor.
- Ejecuta `supabase_verify.sql` y confirma que termina con `OK: schema verificado.`.

## 2) Supabase Storage

- Crea buckets:
  - `gob_sources` (snapshots y uploads)
  - `gob_excel` (snapshots/diffs del monitor)

## 3) Variables de entorno

- Web (Next.js):
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - Google AI key (una): `GOOGLE_API_KEY` o `GEMINI_API_KEY` o `GOOGLE_GENAI_API_KEY`
  - `APP_ENCRYPTION_KEYS` (o `APP_ENCRYPTION_KEY` legacy)

- Worker:
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL` (o `NEXT_PUBLIC_SUPABASE_URL`)
  - Google AI key (una): `GOOGLE_API_KEY` o `GEMINI_API_KEY` o `GOOGLE_GENAI_API_KEY`
  - `APP_ENCRYPTION_KEYS`

- Modulo B (Drive/OneDrive + correo) si aplica:
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
  - `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI`
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
  - `APP_PUBLIC_URL`

## 4) Worker (jobs)

- Despliega el worker como proceso separado.
- Verifica healthchecks:
  - Web: `GET /api/health`
  - Worker: `GET /api/health/worker`

## 5) Retencion basica

- Por defecto el worker ejecuta limpieza con:
  - `RETENTION_JOBS_DAYS=30`
  - `RETENTION_EXCEL_RUNS_DAYS=120`
  - `RETENTION_EMAIL_RUNS_DAYS=120`
  - `RETENTION_EVERY_MINUTES=360`

## 6) Verificacion funcional minima

- Crear expediente y agregar membresia (admin/analyst) funciona.
- Subir fuente (PDF) crea snapshot + chunks.
- Chat responde solo con citas o devuelve `No se encuentra en las fuentes disponibles.`.
- Generar informe en Studio crea job `report_generate` y se completa.
- Monitor Excel:
  - Sin cambios => run `no_change`.
  - Con cambios => run `changed` con diff guardado.
