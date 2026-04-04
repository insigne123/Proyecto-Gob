# Cuaderno Ambiental

Aplicacion web tipo NotebookLM para el Tribunal Ambiental de Chile:

- Modulo A: asistente documental estricto (RAG con citas verificables) sobre fuentes HTML/PDF versionadas.
- Modulo B: monitor de Excel en Google Drive/OneDrive con diffs y reportes por correo.
- Modulo C: monitor Estado Diario 1TA+2TA (08:00 y 16:00 Chile), sync de causas/documentos clave y digest diario.

## Requisitos

- Node.js 20+
- Supabase (Postgres + Storage) con `pgvector`
- Credenciales de modelo (Genkit + Google AI) y RAG gestionado (OpenAI File Search, opcional)

## Setup rapido

1) Crear el esquema en Supabase

- Ejecuta `supabase_schema.sql` en el SQL editor de tu proyecto Supabase.
- Si ya tienes una instalacion previa y quieres aplicar solo Estado Diario: ejecuta `supabase/migrations/202602251600_estado_diario_automation.sql`.

2) Crear buckets en Supabase Storage

- `gob_sources` (snapshots y uploads de fuentes)
- `gob_excel` (snapshots/diffs del monitor)

3) Variables de entorno

En `.env` (ejemplos):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Cifrado tokens OAuth (base64, 32 bytes)
APP_ENCRYPTION_KEY=

# RAG gestionado (OpenAI File Search) + respuesta
RAG_PROVIDER=openai
RAG_ANSWER_PROVIDER=openai
# Defaults recomendados de costo: retrieval, respuesta y redaccion en 5-nano
OPENAI_API_KEY=
OPENAI_RAG_MODEL=gpt-5-nano
OPENAI_ANSWER_MODEL=gpt-5-nano
OPENAI_WRITING_MODEL=gpt-5-nano
# Opcionales para routing interno por perfil
# OPENAI_FAST_MODEL=gpt-4.1-nano
# OPENAI_BALANCED_MODEL=gpt-5-nano
# OPENAI_DEEP_MODEL=gpt-5-nano
# OPENAI_RESCUE_MODEL=gpt-4.1-nano
# OPENAI_REVIEW_INLINE_MODEL=gpt-5-nano
# OPENAI_REVIEW_PRO_MODEL=gpt-5-nano
# OPENAI_WRITING_PROOFREAD_MODEL=gpt-5-nano
# OPENAI_WRITING_COUNTERARGUE_MODEL=gpt-5-nano
LOCAL_EMBEDDING_PROVIDER=openai
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSIONS=768
# LOCAL_EMBEDDINGS_ENABLED=true
OPENAI_FILE_SEARCH_RANKER=auto
OPENAI_FILE_SEARCH_REWRITE_QUERY=true
# OPENAI_FILE_SEARCH_EMBEDDING_WEIGHT=0.65
# OPENAI_FILE_SEARCH_TEXT_WEIGHT=0.35
RAG_ENABLE_LLM_RERANK=true
RAG_ENABLE_FACT_VERIFIER=true
RAG_ENABLE_DEEP_RETRIEVAL=true
RAG_ENABLE_SCOPE_EXPANSION=true
RAG_MAX_RETRIEVAL_QUERIES=6
RAG_DECOMPOSITION_MAX_QUERIES=6
RAG_DEEPEN_MAX_EXTRA_QUERIES=4
RAG_MAX_CONTEXT_EVIDENCE=72
RAG_FAST_MAX_ANSWER_CHARS=1700
# RAG_RERANK_CANDIDATE_LIMIT=32
# RAG_FACT_VERIFIER_MAX_PARAGRAPHS=5
# RAG_FACT_VERIFIER_MAX_EVIDENCE=18
# RAG_FACT_VERIFIER_SUSPECT_RATIO=0.2
# RAG_FACT_VERIFIER_MIN_RATIO=0.16
# OPENAI_RERANK_MODEL=gpt-5-nano
# OPENAI_FACT_VERIFIER_MODEL=gpt-5-nano

ONBOARDING_RERANK_ENABLED=true
ONBOARDING_RERANK_MODEL=gpt-5-nano
ONBOARDING_RERANK_TOP_K=12
ONBOARDING_RERANK_MIN_HEURISTIC_KEEP=2
ONBOARDING_RERANK_HIDE_DISCARD_DEFAULT=true
ONBOARDING_REQUIRE_ANCHOR_MATCH=true
ONBOARDING_MIN_ANCHOR_HITS_CORE=2
ONBOARDING_MIN_ANCHOR_HITS_SUPPORT=1
ONBOARDING_MAX_DEFENSE_ANCHORS=16
ONBOARDING_REQUIRE_CRITICAL_ANCHOR_MATCH=true
ONBOARDING_MIN_CRITICAL_ANCHOR_HITS_CORE=1
ONBOARDING_MIN_CRITICAL_ANCHOR_HITS_SUPPORT=1
ONBOARDING_MAX_CRITICAL_DEFENSE_ANCHORS=6

ONBOARDING_ELIGIBLE_TRIBUNALS=1TA,2TA
ONBOARDING_ELIGIBLE_AUTHORITIES=SEA,SMA
ONBOARDING_PROFILE_REFRESH_ENABLED=true
ONBOARDING_PROFILE_LLM_ENABLED=false
# ONBOARDING_PROFILE_MODEL=gpt-5-nano
ONBOARDING_PROFILE_MAX_CAUSES_PER_RUN=240
ONBOARDING_PROFILE_MAX_DOCS_PER_RUN=900

# OCR opcional para PDFs escaneados
# OCR_SPACE_API_KEY=
# OCR_SPACE_LANGUAGE=spa
# OCR_SPACE_ENDPOINT=https://api.ocr.space/parse/image

# Conector opcional Corte Suprema
# SUPREMA_CONNECTOR_ENDPOINT=
# SUPREMA_CONNECTOR_TOKEN=

# Google AI solo si usas RAG_ANSWER_PROVIDER=google
# GOOGLE_API_KEY=

# OAuth Google Drive
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:9002/api/oauth/google/callback

# OAuth Microsoft (OneDrive)
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_REDIRECT_URI=http://localhost:9002/api/oauth/microsoft/callback

# Resend (recomendado)
RESEND_API_KEY=
RESEND_FROM="Cuaderno Ambiental <reportes@yago.cl>"

# SMTP (alternativo)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# URL publica para links en correo
APP_PUBLIC_URL=http://localhost:9002

# Healthchecks operacionales opcionales (si usas uptime monitor externo)
# Permite consultar /api/health y /api/health/worker por header
# `x-health-token: <token>` o `Authorization: Bearer <token>`
HEALTHCHECK_TOKEN=

# Estado Diario 1TA + 2TA (opcional, con defaults)
# Recipients extra para digest (ademas de recipients de watchlists activas)
# ESTADO_DIARIO_DIGEST_RECIPIENTS=equipo@dominio.cl,legal@dominio.cl
# Frecuencia de verificacion del scheduler interno (minutos)
# ESTADO_DIARIO_SCHEDULER_EVERY_MINUTES=30
# Dias maximos de catch-up si el worker estuvo caido
# ESTADO_DIARIO_CATCHUP_DAYS=5
# Limite de causas a sincronizar por corrida de estado diario
# ESTADO_DIARIO_CAUSE_SYNC_LIMIT=140
# Delay entre poll y sync corpus (segundos)
# ESTADO_DIARIO_CORPUS_SYNC_DELAY_SECONDS=90
# Reintentos maximos para jobs de estado diario
# ESTADO_DIARIO_JOB_MAX_ATTEMPTS=5
# Reintentos maximos para job tribunal_corpus_sync disparado por estado diario
# ESTADO_DIARIO_CORPUS_SYNC_JOB_MAX_ATTEMPTS=8
# Ajustes de sync corpus incremental
# TRIBUNAL_CORPUS_SYNC_MAX_NEW=260
# TRIBUNAL_CORPUS_SYNC_MAX_RETRIES=80
# Reintentos internos (transient errors fetch/network)
# TRIBUNAL_CORPUS_SYNC_INTERNAL_RETRIES=3
# TRIBUNAL_CORPUS_SYNC_RETRY_BASE_MS=5000
# TRIBUNAL_CORPUS_SYNC_RETRY_MAX_MS=45000

# Auto-recuperacion de jobs colgados en running
# WORKER_STALE_RUNNING_MINUTES=90
# WORKER_RECOVER_STALE_RUNNING_EVERY_MINUTES=15
# WORKER_RECOVER_STALE_MAX_JOBS=30

# Persistencia de binarios en Storage (recomendado: desactivado para ahorrar cuota)
# 2TA: por defecto NO guarda copia en Storage; conserva URL de origen
# TRIBUNAL_2TA_PERSIST_FILES=false

# Ingesta de snapshots URL -> cache en Storage
# - Global: forzar true/false para todos los snapshots que vienen por URL
# SOURCE_INGEST_PERSIST_URL_SNAPSHOTS=
# - Tribunal: por defecto false (si no defines variable global)
# SOURCE_INGEST_PERSIST_TRIBUNAL_URL_SNAPSHOTS=false
```

4) Instalar deps y correr

```
npm install
npm run dev
```

En otra terminal, correr el worker:

```
npm run worker:dev
```

5) Bootstrap del scheduler Estado Diario (una vez por entorno)

```
npm run estado-diario:bootstrap
```

Para disparar una corrida inmediata hoy:

```
npm run estado-diario:bootstrap -- --now
```

Para encolar una fecha especifica:

```
npm run estado-diario:bootstrap -- --date=2026-02-25
```

6) Monitorear uso de Storage (recomendado diario)

```
npm run monitor:storage
```

Opcional para alertar en CI/cron cuando pase umbral:

```
npm run monitor:storage -- --warn-mb=850 --limit-mb=1024 --fail-on-warn
```

7) Reparar caratulas placeholder en 2TA (cuando figuran como `R-xxx-xxxx`)

Dry run:

```
npm run tribunal:refresh-2ta-caratulas -- --limit=300
```

Aplicar cambios:

```
npm run tribunal:refresh-2ta-caratulas -- --apply --limit=300 --sleep-ms=120
```

8) Re-embeddings contextuales para mejorar recall semantico (opcional)

```
npm run rag:backfill-embeddings -- --workspace-id <workspace_uuid> --reembed-all --limit=200000 --fetch-batch=120 --embed-batch=32
```

Notas:

- Sin `--reembed-all`, el script solo procesa chunks con `embedding` nulo.
- Con `--reembed-all`, refresca embeddings existentes usando `metadata.context_summary` cuando esta disponible.
- Si tu cuota de embeddings (OpenAI) esta agotada, puedes ejecutar solo enriquecimiento de metadata (sin llamar a embeddings) con `--metadata-only`.
- Si aparece rate limit de embeddings, puedes continuar por tramos con `--offset`:

```
npm run rag:backfill-embeddings -- --workspace-id <workspace_uuid> --reembed-all --offset 120 --limit 500 --fetch-batch 120 --embed-batch 8
```

En PowerShell/Windows, si `npm` no pasa bien los flags, usa forma posicional:

```
npm run rag:backfill-embeddings -- <workspaceId> <offset> <limit> <fetchBatch> <embedBatch> <sleepMs>
```

9) Refrescar pool defensivo (causas elegibles por autoridad + perfiles)

```
npm run onboarding:refresh-defense-pool -- --max-causes 240 --max-docs 900 --refresh-profiles true
```

10) Enriquecer corpus por anclas criticas de una reclamacion (before/after)

```
npm run onboarding:enrich-corpus -- <workspaceId> --tribunal=2TA --rol=R-202-2026 --apply=true
```

Notas:

- Si no envias `--terms`, usa anclas criticas del ultimo run de onboarding del workspace.
- Si envias `--rol`, encola `tribunal_cause_sync` para intentar traer causa/documentos faltantes y luego `tribunal_corpus_sync`.
- Reporta cobertura de terminos antes y despues del enriquecimiento.

## Evaluar calidad del RAG

1) Crea tu dataset en `eval/golden.jsonl` (una consulta por linea JSON).

2) Ejecuta la evaluacion:

```
npm run eval:rag -- --dataset=eval/golden.jsonl --workspace-id=<workspaceId> --provider=openai --answer-provider=openai
```

En PowerShell/Windows, si `npm` reinterpreta opciones, usa formato posicional:

```
npm run eval:rag -- eval/golden.jsonl <workspaceId> <provider>
```

Opciones utiles:

- `--workspace-id <id>`: fuerza un workspace para todas las filas.
- `--max 20`: limita la corrida a N casos.
- `--skip-generation`: benchmark de retrieval sin generar respuesta.
- `--gen-delay-ms 13000`: evita 429 de cuota/rate-limit en free tier.
- `--answer-provider openai`: usa OpenAI para la generacion de respuestas del eval (evita cuota Gemini).
- `--verbose`: imprime detalle por caso.

Se generan reportes en `eval/results/`:

- `*.json` (detalle por caso)
- `*.md` (resumen ejecutivo)

## QA E2E de proyectos

Caso individual (upload + onboarding + marco teorico):

```
npm run e2e:proyectos -- --pdf "C:\\ruta\\archivo.pdf" --rol R-151-2026 --tribunal 1TA --caratula "..."
```

Batch de casos desde configuracion JSON:

```
npm run qa:proyectos -- qa/proyectos-cases.json
```

Sesion QA chat costo-controlado (4 preguntas en un thread + reporte de calidad/costo):

```
npm run qa:chat-session4 -- <workspaceId> --app-url http://localhost:9002 --response-profile fast
```

Opcional para bajar costo: `--max-questions 2` (ejecuta solo Q1-Q2).

Los reportes quedan en `reports/` (markdown + json + screenshot por caso).

## Notas

- La UI esta pensada para evitar botones innecesarios: Fuentes / Chat / Studio.
- Flujo de nuevos proyectos: al crear un proyecto se abre un onboarding tipo chat (`/projects/:id/onboarding`) para cargar la reclamacion, buscar causas similares del corpus tribunal y generar un marco teorico inicial.
- Onboarding con filtros estructurados: tipo de proyecto, region, rango de anios y temas para priorizar jurisprudencia.
- El chat aplica contrato de respuesta segun la pregunta (p.ej. max bullets / min citas), y si no hay evidencia suficiente declara falta de respaldo explicita.
- El retrieval puede correr en modo `local`, `openai` o `hybrid` (por `RAG_PROVIDER`).
- Recomendacion para maxima calidad en chat: `RAG_PROVIDER=hybrid` (OpenAI File Search + recuperacion local con embeddings OpenAI).
- El chat aplica retrieval `workspace-first` con expansion progresiva a workspaces miembro solo si falta evidencia (reduce ruido/costo).
- El retrieval local usa fusion dense+sparse + rerank (RRF + cobertura lexical + boost por rol/documento) y expansion de vecindad por snapshot para preguntas complejas.
- Para maxima calidad en chat, se agrega rerank LLM opcional (`RAG_ENABLE_LLM_RERANK`) y verificacion factual por parrafo antes de responder (`RAG_ENABLE_FACT_VERIFIER`).
- Control de costo/calidad: ajusta `RAG_MAX_RETRIEVAL_QUERIES`, `RAG_DEEPEN_MAX_EXTRA_QUERIES`, `RAG_MAX_CONTEXT_EVIDENCE`, `RAG_FAST_MAX_ANSWER_CHARS` y `RAG_RERANK_CANDIDATE_LIMIT`.
- La generacion de respuestas puede correr con `RAG_ANSWER_PROVIDER=google|openai|auto`.
- En la UI del chat puedes elegir perfil de respuesta: `Rapida`, `Balanceada`, `Potente` o `Auto` (clasifica dificultad antes de responder).
- Para produccion, el worker debe desplegarse como proceso separado (p.ej. Cloud Run).
- Los informes se generan en background via worker (job `report_generate`) y se construyen en modo batch para reducir costo.
- El generador de informes usa precedentes de reportes `review/final` de otros expedientes donde el usuario creador tambien es miembro (solo como guia de estructura/estilo, no como evidencia factual).
- El onboarding evita autocompararse con la misma reclamacion: excluye duplicados por hash y por similitud lexical alta antes de rankear causas sugeridas.
- El onboarding aplica rerank LLM conservador para utilidad defensiva (`core/support/discard`), gate de anclas del caso y gate de anclas criticas obligatorias para evitar falsos positivos, mas soft filter de descartables por defecto.
- El onboarding trabaja solo con causas SEA elegibles (pool defensivo) y usa perfiles resumidos por causa/documento para acelerar la evaluacion.
- El monitor Excel exige `Tribunal` + `Rol` en columnas clave y soporta preset diario general / causa prioritaria.
- Estado Diario 1TA+2TA: el worker programa y ejecuta `estado_diario_poll` a las 08:00 y 16:00 (America/Santiago), sincroniza causas (`tribunal_cause_sync`), refresca corpus (`tribunal_corpus_sync`) y envia digest diario (`estado_diario_email_digest`) al cierre. Incluye auto-retry para errores transitorios de corpus sync y auto-recuperacion de jobs colgados en `running` con auditoria.
- Filtro estricto de documentos clave en sync: solo `Escrito Inicial`, `Evacua informe` y `Sentencia`.
- El studio agrega asistencia de escritura para revision de redaccion/gramatica y refutacion de argumentos.
- La base documental incluye tabla de analitica jurisprudencial y una capa de continuidad a Corte Suprema (conector opcional + fallback buscador).
- Accesos operacionales: `/alerts` (errores/cambios) y `/audit` (registro de acciones).
- Healthchecks: `/api/health` y `/api/health/worker` exigen sesion autenticada; para monitores externos puedes definir `HEALTHCHECK_TOKEN` y enviar `x-health-token` o `Authorization: Bearer <token>`. Con token, la respuesta expone menos detalle operativo.
