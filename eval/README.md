# RAG Evaluation Dataset

Use `eval/golden.jsonl` as your test set. Each line is one JSON object.

## Minimal schema

```json
{
  "workspaceId": "uuid-or-id",
  "question": "Pregunta de evaluacion"
}
```

## Recommended schema

```json
{
  "id": "chat-001",
  "workspaceId": "<workspace_uuid>",
  "question": "Que dice la RCA sobre ruido nocturno?",
  "mode": "extractive",
  "filters": {
    "docTypes": ["RCA"],
    "regions": ["Los Lagos"],
    "yearFrom": 2020,
    "yearTo": 2025
  },
  "expectNotFound": false,
  "mustInclude": ["ruido nocturno"],
  "mustNotInclude": ["informacion no verificable"],
  "expectedSnapshotIds": ["<snapshot_uuid>"],
  "expectedChunkIds": ["<chunk_uuid>"],
  "notes": "Caso regulatorio base"
}
```

## Run

```bash
npm run eval:rag -- --dataset eval/golden.jsonl --provider openai --answer-provider openai
```

PowerShell/Windows fallback (positional args):

```bash
npm run eval:rag -- eval/golden.jsonl <workspaceId> <provider>
```

Useful flags:

- `--workspace-id <id>`: force same workspace for all rows
- `--max 20`: run first 20 rows
- `--skip-generation`: retrieval-only benchmark
- `--gen-delay-ms 13000`: reduce Gemini 429s on free tier
- `--answer-provider openai`: use OpenAI for answer generation during eval
- `--verbose`: print per-case progress

The command writes:

- JSON report in `eval/results/*.json`
- Markdown summary in `eval/results/*.md`

## Review evaluation

Use `eval/review-golden.example.jsonl` as a template.

```bash
npm run eval:review -- --dataset eval/review-golden.example.jsonl --app-url http://localhost:9002
```

Recommended schema:

```json
{
  "id": "review-001",
  "workspaceId": "<workspace_uuid>",
  "route": "professional",
  "sourceId": "<source_uuid>",
  "focus": ["strategy", "evidence"],
  "mustInclude": ["evacua informe", "sentencia"],
  "mustNotInclude": ["sin respaldo"],
  "notes": "Revisar si prioriza estrategia defensiva real"
}
```

## Writing evaluation

Use `eval/writing-golden.example.jsonl` as a template.

```bash
npm run eval:writing -- --dataset eval/writing-golden.example.jsonl --app-url http://localhost:9002
```

Recommended schema:

```json
{
  "id": "writing-001",
  "workspaceId": "<workspace_uuid>",
  "task": "counterargue",
  "text": "Texto a refutar o mejorar",
  "context": "Contexto opcional",
  "mustInclude": ["SEA", "criterio", "informe"],
  "mustNotInclude": ["alucinacion"],
  "notes": "Evaluar alineacion con memoria del caso"
}
```

## Live chat evaluation

Use `eval/chat-live.sea-smoke.jsonl` as a starting point.

```bash
npm run eval:chat-live -- --dataset eval/chat-live.sea-smoke.jsonl --app-url http://localhost:9002
```

Recommended schema:

```json
{
  "id": "chat-001",
  "workspaceId": "<workspace_uuid>",
  "question": "Pregunta orientada al uso real del SEA",
  "mode": "checklist",
  "responseProfile": "balanced",
  "mustInclude": ["informe", "sentencia"],
  "mustNotInclude": ["sin respaldo"],
  "notes": "Evaluar utilidad real del chat sobre marco teorico y defensa"
}
```
