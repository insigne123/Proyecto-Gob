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
