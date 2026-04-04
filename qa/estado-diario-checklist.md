# QA manual: estado diario 1TA

## Pre-requisitos

- Migracion aplicada: `supabase/migrations/202602251600_estado_diario_automation.sql`.
- Worker activo (`npm run worker:dev`).

## Bootstrap y scheduling

1. Ejecutar `npm run estado-diario:bootstrap`.
2. Verificar en `gob_jobs` jobs `estado_diario_poll` para slots `08:00` y `16:00` (payload `date` + `slot`).
3. Confirmar que no se duplican jobs al volver a correr bootstrap.

## Poll de estado diario

1. Ejecutar `npm run estado-diario:bootstrap -- --now`.
2. Confirmar en `gob_estado_diario_runs` nuevo run `status=ok`.
3. Confirmar en `gob_estado_diario_entries` filas del run.
4. Confirmar en `gob_estado_diario_changes` cambios por rol cuando corresponda.

## Sync de causas/documentos

1. Verificar que se encolan `tribunal_cause_sync` cuando hay cambios.
2. Confirmar upsert de causa en `gob_tribunal_causes` (`last_scraped_at`, `estado`).
3. Confirmar que en `gob_tribunal_documents` solo entren documentos clave:
   - `Escrito Inicial`
   - `Evacua informe`
   - `Sentencia`
4. Confirmar que no entren resoluciones no clave (ej. `Acoge a tramite`).
5. Confirmar deduplicacion por `cause_id + cod_asiento`.

## Sync de corpus

1. Verificar job `tribunal_corpus_sync` despues de cambios.
2. Confirmar creacion/actualizacion de fuentes en workspace corpus (`source_origin=tribunal-corpus`).
3. Confirmar encolado de `source_ingest` para snapshots nuevos/error-retry.

## Digest diario

1. Forzar/esperar corrida despues de las 16:00 Chile.
2. Verificar job `estado_diario_email_digest`.
3. Confirmar `gob_estado_diario_email_runs` con `status=sent`.
4. Validar que el correo muestre:
   - cambios de providencias por rol,
   - cambios de estado y documentos clave detectados.
