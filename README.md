# Cuaderno Ambiental

Aplicacion web tipo NotebookLM para el Tribunal Ambiental de Chile:

- Modulo A: asistente documental estricto (RAG con citas verificables) sobre fuentes HTML/PDF versionadas.
- Modulo B: monitor de Excel en Google Drive/OneDrive con diffs y reportes por correo.

## Requisitos

- Node.js 20+
- Supabase (Postgres + Storage) con `pgvector`
- Credenciales de modelo (Genkit + Google AI) y RAG gestionado (OpenAI File Search, opcional)

## Setup rapido

1) Crear el esquema en Supabase

- Ejecuta `supabase_schema.sql` en el SQL editor de tu proyecto Supabase.

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
OPENAI_API_KEY=
OPENAI_RAG_MODEL=gpt-4o-mini
OPENAI_ANSWER_MODEL=gpt-4o-mini
OPENAI_FILE_SEARCH_RANKER=auto

# Google AI solo si usas local/hybrid o answer provider google
# GOOGLE_API_KEY=

# OAuth Google Drive
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:9002/api/oauth/google/callback

# OAuth Microsoft (OneDrive)
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_REDIRECT_URI=http://localhost:9002/api/oauth/microsoft/callback

# SMTP
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# URL publica para links en correo
APP_PUBLIC_URL=http://localhost:9002
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

## Evaluar calidad del RAG

1) Crea tu dataset en `eval/golden.jsonl` (una consulta por linea JSON).

2) Ejecuta la evaluacion:

```
npm run eval:rag -- --dataset eval/golden.jsonl --provider openai --answer-provider openai
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

## Notas

- La UI esta pensada para evitar botones innecesarios: Fuentes / Chat / Studio.
- Las respuestas del chat se fuerzan a incluir citas; sin evidencia => "No se encuentra en las fuentes disponibles.".
- El retrieval puede correr en modo `local`, `openai` o `hybrid` (por `RAG_PROVIDER`).
- La generacion de respuestas puede correr con `RAG_ANSWER_PROVIDER=google|openai|auto`.
- En la UI del chat puedes elegir perfil de respuesta: `Rapida`, `Balanceada`, `Potente` o `Auto` (clasifica dificultad antes de responder).
- Para produccion, el worker debe desplegarse como proceso separado (p.ej. Cloud Run).
- Los informes se generan en background via worker (job `report_generate`) y se construyen en modo batch para reducir costo.
- El generador de informes usa precedentes de reportes `review/final` de otros expedientes donde el usuario creador tambien es miembro (solo como guia de estructura/estilo, no como evidencia factual).
- Accesos operacionales: `/alerts` (errores/cambios) y `/audit` (registro de acciones).
