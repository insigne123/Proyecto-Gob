# RAG Agent Implementation Plan

Last updated: 2026-04-01

This file is the living implementation guide for turning the app into a near-perfect legal RAG system.

Use this document as the default reference before and after every meaningful RAG, marco teorico, onboarding, retrieval, grounding, or evaluation change.

Primary supporting references:

- `docs/expert-agent-master-roadmap.md`
- `C:\Users\nicog\.gemini\antigravity\brain\93c8567e-2825-43cc-8c0a-d529767b22ae\rag-improvement-report.md.resolved`

## How To Use This File

- Read this file before starting a new RAG-related implementation session.
- Use the weighted tracker to estimate current master-plan completion.
- After each material change, update:
  - current percentages
  - status labels
  - immediate next queue
  - progress log
- Keep `docs/expert-agent-master-roadmap.md` as the baseline metrics and product-quality reference.
- Keep this file as the execution guide and implementation tracker.

## Percentage Rubric

Use the same meaning everywhere in this file:

- `0%` = not started
- `25%` = scaffolding exists, not production-useful
- `50%` = first working slice exists, but quality/coverage is still limited
- `75%` = production path exists and passes targeted evals, but still has known gaps
- `100%` = exit criteria met, measured, documented, and operationalized

## Current Snapshot

- Current functional quality of the shipped system: `~94-95%`
- Legacy roadmap closure from the original expert roadmap: `~92-93%`
- Expanded master-plan closure for the new "perfect and powerful RAG" target: `~89%`
- Main quality bottleneck: corpus coverage for `informe + sentencia`
- Main strategic bottleneck: no dedicated cross-encoder / bundle rerank / true agentic orchestration
- Main marco teorico bottleneck: structured memory is good, but still too compressed and too JSON-centric
- Main operational bottleneck: live eval reliability, strategic latency, and lack of distributed cache / real streaming

Important note:

The `~52%` does not contradict the current `~94-95%` quality estimate. The current app is already strong, but the expanded master plan now includes capabilities that are still mostly missing: GraphRAG, agentic orchestration, richer legal knowledge extraction, stronger eval gates, better persistence, and more aggressive corpus expansion.

## Weighted Master Tracker

Weighted completion formula:

`overall = sum(weight * current_percent) / 100`

| Workstream | Weight | Current | Status | Why it is not done yet |
| --- | ---: | ---: | --- | --- |
| Corpus coverage + ingest hardening | 15 | 76 | in progress | Sync, audits, anchor enrichment, OCR fallback, graph-aware ingest, and priority-cause backfill tooling now exist, but the corpus still needs more real backfilled `informe + sentencia` pairs |
| Retrieval + rerank + CRAG | 18 | 97 | in progress | Hybrid retrieval, HyDE, cross-encoder abstraction, graph-derived query hints, reusable retrieval jobs, executable retrieval loops, feedback-aware rerank signals, bundle-aware heuristics, and graph-backed snapshot references now exist; production cross-encoder rollout is still missing |
| Query understanding + routing | 8 | 86 | in progress | Heuristics now have an LLM upgrade path, richer routing signals, graph-aware expansion, reusable retrieval-job planning, stronger feedback-informed routing inputs, and reusable retrieval verification, but broader cross-surface planning is still missing |
| Facts + grounding + support calibration | 12 | 98 | in progress | Facts table, deterministic factual path, richer legal fact extraction, expanded factual answer kinds, and stronger grounding inputs now exist, but strategic support rules still need final tightening |
| Marco teorico + structured memory | 15 | 98 | in progress | Structured memory now captures priority rules, misuse risks, precedent rationales, persisted onboarding artifacts, graph-backed recommendation/report/writing signals, stronger cross-surface reuse, versioned onboarding artifacts, and artifact inspection support |
| GraphRAG legal knowledge layer | 10 | 82 | in progress | Legal graph schema, heuristic entity extraction, onboarding graph persistence, source-ingest graph population, graph refresh tooling, graph retrieval context, graph-backed onboarding boosts, review-time graph context, report/writing graph prompts, graph-aware fact extraction, and graph-backed snapshot references now exist |
| Agentic orchestration for strategic chat | 10 | 86 | in progress | A planner layer, reusable retrieval-job builder, executable retrieval loop, reusable verification logic, feedback-aware rerank, graph-backed evidence seeding, and budgeted corrective-query loop now exist for complex strategic chat |
| Evaluation + observability + HITL | 6 | 96 | in progress | Evals, traces, audit logs, onboarding HITL, onboarding-recommend eval, release-gate script, chat feedback enrichment, evidence-level HITL, and richer agent/graph metadata now exist, but release automation and full chat HITL productization remain incomplete |
| Latency + cache + UX hardening | 6 | 84 | in progress | Runtime cache, shared-cache fallback, invalidation hooks, and the fast factual path now exist, but strategic latency, real streaming, and broader cache coverage are still missing |

Current weighted total: `~89%`

## Current Build Objectives

The next implementation pushes should optimize for closing these concrete gaps fastest:

1. Turn the current planner plus retrieval jobs into a fully verified tool loop with explicit success/failure criteria per step.
2. Finish modularizing the monolithic chat route by moving retrieval and corrective orchestration into reusable library modules.
3. Raise GraphRAG from contextual boost to first-class ranking signal across report, review, writing, and strategic chat.
4. Add release-grade evals for strategic chat, marco teorico, and graph-backed recommendation quality.
5. Close remaining operational gaps: distributed cache, real streaming, and more reliable live benchmark execution.

## Core Product Goals

The final system must reliably:

- answer factual questions from tribunal and workspace documents with exact citations
- answer strategic questions with strong grounding and calibrated confidence
- build a marco teorico that consistently prioritizes `informe + sentencia`
- use `reclamacion` mainly as context unless the user explicitly requests it
- fail safely when evidence is incomplete
- stay fast enough for real usage
- explain why each precedent, document, and citation matters

## Success Bar

### Factual Chat

- `mustIncludeAllMatchedRate >= 0.98`
- `citationValidityRate = 1.0`
- `supportStrength strong >= 0.95`
- `avgLatencyMs <= 5000`

### Strategic / Balanced Chat

- `mustIncludeAllMatchedRate >= 0.93`
- `citationValidityRate >= 0.98`
- `notFound accuracy >= 0.98`
- `supportStrength strong >= 0.75`
- `avgLatencyMs <= 12000`

### Marco Teorico

- runtime and persisted references dominated by `informe + sentencia`
- `reclamacion` remains secondary unless explicitly requested
- high recall of gold causes and documents in top-8 / top-10
- recommendations are actionable, document-backed, and reusable in writing/review

### Global

- system quality `>= 95%` under realistic evaluation
- no silent regressions in routing, grounding, or corpus coverage

## Current Architecture Map

Main files to consult often:

- Chat orchestration: `src/app/api/workspaces/[workspaceId]/chat/route.ts`
- Streaming route: `src/app/api/workspaces/[workspaceId]/chat/stream/route.ts`
- Router / execution plan: `src/lib/rag/router.ts`
- Query intent: `src/lib/rag/query-intent.ts`
- Local retrieval: `src/lib/rag/local-retrieval.ts`
- Managed retrieval: `src/lib/rag/openai-managed.ts`
- Rerank: `src/lib/rag/rerank.ts`
- Evidence quality / corrective retrieval: `src/lib/rag/evidence-quality.ts`
- Strict grounded answer generation: `src/lib/rag/strict-answer.ts`
- Deterministic factual path: `src/lib/rag/factual-answer.ts`
- Defense coverage rules: `src/lib/rag/defense-answer-policy.ts`
- Facts extraction and loading: `src/lib/tribunal/document-facts.ts`
- Runtime cache: `src/lib/runtime-cache.ts`
- Onboarding recommend: `src/app/api/workspaces/[workspaceId]/onboarding/recommend/route.ts`
- Onboarding complete: `src/app/api/workspaces/[workspaceId]/onboarding/complete/route.ts`
- Structured memory: `src/lib/onboarding/structured-memory.ts`
- Strategic memory block: `src/lib/onboarding/strategic-memory.ts`
- Defense pool and profiles: `src/lib/onboarding/defense-pool.ts`
- Tribunal corpus sync: `src/lib/onboarding/tribunal-corpus.ts`
- Source ingest: `src/worker/jobs/source-ingest.ts`
- Coverage audit: `scripts/audit-tribunal-corpus-coverage.ts`
- Chat eval: `scripts/eval-chat-live.ts`
- Retrieval eval: `scripts/eval-rag.ts`

## Major Observations From The Current Codebase

- The app already has a strong retrieval-and-grounding base.
- `metadata.context_summary` is already generated during ingest and used in embedding / text search; contextual retrieval exists, but only as a first-generation version.
- The factual path is already separated and strong.
- The marco teorico already persists structured memory and tribunal references, but mostly inside workspace metadata JSON.
- Onboarding HITL already exists and should be extended, not rebuilt.
- The chat route is too monolithic and should be progressively split into planner / retriever / reranker / answerer / telemetry layers.
- Strategic eval artifacts are currently unreliable because recent live runs show auth and fetch failures instead of quality results.

## Master Execution Order

Work should continue in this order unless a hard dependency changes:

1. trusted measurement + route hardening
2. corpus coverage expansion
3. retrieval v2 foundation
4. query understanding + routing v2
5. strategic rerank + true CRAG
6. facts layer v2 + strategic grounding
7. marco teorico v3 + memory normalization
8. GraphRAG legal layer
9. agentic orchestration
10. latency, eval, observability, and HITL hardening

## Detailed Phase Plan

### Phase 0 - Trusted Baseline And Refactor Guardrails

Goal: make quality measurements trustworthy and reduce orchestration risk before large upgrades.

Current state:

- Strong functionality exists, but the main chat route is too large.
- Recent live strategic evals are polluted by `Forbidden` and `fetch failed` errors.

Key tasks:

- Split `chat/route.ts` into composable modules without changing user behavior.
- Fix live eval auth/session issues in `scripts/eval-chat-live.ts`.
- Add per-stage latency capture for planning, retrieval, rerank, grounding, and answer generation.
- Create a stable benchmark manifest for factual, strategic, marco teorico, review, and writing.
- Add feature flags for all high-risk retrieval upgrades.

Deliverables:

- thinner chat endpoint
- trusted live eval outputs
- stage-by-stage latency reporting
- safer rollout path for retrieval upgrades

Exit criteria:

- live chat evals run cleanly on real workspace datasets
- the orchestration path is modular enough to swap rerank / CRAG / planner components safely

### Phase 1 - Corpus Coverage Expansion And Ingest Hardening

Goal: ensure the system actually has the right documents before trying to reason perfectly.

Current state:

- Sync, audit, and anchor enrichment flows exist.
- Sampled audit still shows weak `informe + sentencia` coverage.

Key tasks:

- Expand tribunal sync prioritization for causes missing `informe` or `sentencia`.
- Create recurring coverage reports by tribunal, cause, workspace, and onboarding usage.
- Build a backlog of high-value causes with missing core pairs.
- Auto-prioritize causes referenced by onboarding, chat, and structured memory.
- Flag `reclamacion-only` causes as structurally weak across chat and marco teorico.
- Add OCR fallback for scanned PDFs detected during ingest.
- Improve ingest retries and source quality alerts.

Primary files:

- `src/lib/onboarding/tribunal-corpus.ts`
- `src/worker/jobs/tribunal-corpus-sync.ts`
- `src/worker/jobs/source-ingest.ts`
- `scripts/audit-tribunal-corpus-coverage.ts`
- `scripts/enrich-onboarding-corpus-by-anchors.ts`

Deliverables:

- stronger sync and backfill workflow
- recurring coverage audit output
- high-value missing-core-pair backlog
- OCR / weak-source operational path

Exit criteria:

- core-pair coverage improves materially over the current audit
- high-value causes stop showing only `reclamacion`
- the system can explicitly detect and report structurally weak causes

### Phase 2 - Retrieval V2 Foundation: Contextual Retrieval And Legal Chunking

Goal: improve the quality of evidence units before ranking and answering.

Current state:

- `context_summary` already exists in chunks and embeddings.
- Semantic chunking heuristics already exist.
- Retrieval metadata is better than before, but still shallow for legal reasoning.

Key tasks:

- Upgrade `context_summary` into a richer `context_prefix` / legal context representation.
- Preserve document structure better: `vistos`, `considerandos`, `resuelvo`, annexes, procedural headings.
- Add windowed neighborhood links so retrieval can expand to adjacent legal context more precisely.
- Persist richer metadata per chunk: role token, legal section path, cited norms, authorities, parties, result hints.
- Re-embed the corpus with the richer contextual representation.
- Unify lexical and vector retrieval around the same contextualized text model.

Primary files:

- `src/worker/jobs/source-ingest.ts`
- `scripts/backfill-chunk-embeddings.ts`
- `src/lib/rag/local-retrieval.ts`
- `supabase_schema.sql`

Deliverables:

- chunk schema v3
- richer chunk metadata
- re-embedding workflow
- higher recall and cleaner chunk boundaries

Exit criteria:

- top-k recall improves on tribunal evals
- chunk labels and context are clearly more useful in traces and final citations

### Phase 3 - Query Understanding And Routing V2

Goal: make the system understand what kind of question is being asked before retrieval starts.

Current state:

- Heuristic intent inference exists and is already useful.
- Routing already distinguishes factual, direct, standard, corrective, and deep.

Key tasks:

- Replace heuristic-only intent inference with LLM classification plus heuristic fallback.
- Detect: question type, preferred doc roles, complexity, need for multi-cause reasoning, need for graph lookup, need for facts-first path.
- Separate routing policies for chat, marco teorico, review, and writing.
- Persist structured retrieval plan metadata in traces and assistant reports.
- Add adversarial eval cases for tricky strategic questions.

Primary files:

- `src/lib/rag/query-intent.ts`
- `src/lib/rag/router.ts`
- `src/app/api/workspaces/[workspaceId]/chat/route.ts`
- `scripts/eval-chat-live.ts`

Deliverables:

- LLM intent classifier
- richer execution plan object
- better task-aware routing

Exit criteria:

- the system chooses better document families and retrieval depth for non-canonical questions
- routing decisions are inspectable and measurable

### Phase 4 - Strategic Retrieval V2: Cross-Encoder, Bundle Rerank, True CRAG

Goal: convert a good retrieval stack into an expert strategic retrieval stack.

Current state:

- Hybrid retrieval, HyDE, heuristic rerank, and partial corrective retrieval already exist.
- LLM rerank is still expensive and not specialized.

Key tasks:

- Add a dedicated cross-encoder reranker behind a feature flag.
- Retrieve broader candidate sets, then prune with heuristic, rerank with cross-encoder, and optionally use LLM rerank only for `deep` mode.
- Rank by cause bundle, not only by isolated chunk.
- Reward evidence bundles with `informe + sentencia`.
- Turn `reformulatedQueries` from `evidence-quality.ts` into a real iterative CRAG loop.
- Allow up to 2-3 retrieval iterations with latency budgets.
- Merge local and managed retrieval at bundle level instead of only chunk level.

Primary files:

- `src/lib/rag/rerank.ts`
- `src/lib/rag/local-retrieval.ts`
- `src/lib/rag/evidence-quality.ts`
- `src/lib/rag/openai-managed.ts`
- new module: `src/lib/rag/cross-encoder.ts`

Deliverables:

- dedicated cross-encoder integration
- bundle-level ranking
- real iterative CRAG
- lower partial-answer rate in strategic chat

Exit criteria:

- strategic queries surface stronger multi-document evidence
- rerank latency drops versus LLM-only rerank
- corrective retrieval materially improves weak first-pass retrieval

### Phase 5 - Facts Layer V2 And Strategic Grounding V2

Goal: make factual structure and support calibration drive final answers more consistently.

Current state:

- Facts extraction and deterministic factual answers are already strong.
- Grounding and support strength are already better than average.

Key tasks:

- Expand `gob_tribunal_document_facts` beyond claimants / fojas / dates / snippets.
- Extract holdings, ratio-like lines, cited norms, authorities, outcome labels, accepted arguments, rejected arguments, remedy signals, and stage signals.
- Add fact completeness diagnostics by document role.
- Force stronger multi-document support rules for strategic recommendations.
- Distinguish more clearly between `strong`, `partial`, `preliminar`, and `no respaldado`.
- Keep rescue answers useful but explicitly calibrated.

Primary files:

- `src/lib/tribunal/document-facts.ts`
- `src/worker/jobs/source-ingest.ts`
- `src/lib/rag/strict-answer.ts`
- `src/lib/rag/final-support.ts`
- `src/lib/rag/defense-answer-policy.ts`

Deliverables:

- richer legal facts schema
- better strategic support calibration
- stronger facts-first answering

Exit criteria:

- strategic `partial` answers decrease without hallucination increasing
- factual and strategic answers share a more explicit support contract

### Phase 6 - Marco Teorico V3 And Structured Memory V2

Goal: make persisted marco teorico as powerful as the best runtime behavior.

Current state:

- Structured memory already exists and is useful.
- Tribunal references are already persisted and reused.
- The persistence model is still too compressed and too dependent on workspace metadata and notes.

Key tasks:

- Enrich structured memory with holdings, defense lines, precedent-use rationale, misuse risks, cited norms, authority patterns, and when-to-use guidance.
- Version marco teorico artifacts instead of treating them as one JSON blob.
- Persist stronger rationale for why each cause and document matters.
- Keep a refresh path when new tribunal causes enter the corpus.
- Normalize persistence so analytics and auditing do not depend only on workspace metadata JSON.
- Ensure writing and review use the same curated legal memory objects as chat.

Primary files:

- `src/app/api/workspaces/[workspaceId]/onboarding/recommend/route.ts`
- `src/app/api/workspaces/[workspaceId]/onboarding/complete/route.ts`
- `src/lib/onboarding/structured-memory.ts`
- `src/lib/onboarding/strategic-memory.ts`
- `src/app/api/workspaces/[workspaceId]/writing-assistant/route.ts`
- `src/app/api/workspaces/[workspaceId]/reviews/professional/route.ts`

Deliverables:

- structured memory v2
- stronger precedent rationale
- refreshable marco teorico artifact
- better cross-surface reuse

Exit criteria:

- persisted marco teorico matches runtime priorities in practice
- chat, review, and writing consume the same expert memory layer

### Phase 7 - GraphRAG Legal Knowledge Layer

Goal: let the system reason over relationships, not only over chunks.

Current state:

- Cause profiles and document profiles exist.
- There is no real entity graph, cause-similarity table, or graph retrieval.

Key tasks:

- Create tables for entities, relations, and cause similarity in Postgres.
- Extract norms, authorities, materias, partes, argument types, outcomes, and remedies during ingest/backfill.
- Build similarity edges between causes using shared factors and legal signals.
- Add graph lookup as a retrieval tool for marco teorico and comparative chat.
- Start with Postgres-based GraphRAG; do not introduce Neo4j unless PostgreSQL proves insufficient.

Expected schema additions:

- `gob_entities`
- `gob_entity_relations`
- `gob_cause_similarity`

Deliverables:

- minimal legal knowledge graph
- graph extraction workflow
- graph-powered comparative retrieval

Exit criteria:

- the system can answer relationship-heavy questions better than chunk-only retrieval
- marco teorico can justify precedent choice with graph-level evidence

### Phase 8 - Agentic Strategic Orchestrator

Goal: handle complex legal questions with planning, verification, and controlled iteration.

Current state:

- The system already has routing, HyDE, corrective retrieval, facts, and grounding.
- It does not yet have a true planner / tool loop.

Key tasks:

- Build `agent-orchestrator.ts` for strategic and comparative questions only.
- Expose tools such as `search_local`, `search_managed`, `search_facts`, `search_graph`, `evaluate_evidence`, `reformulate_query`, and `generate_answer`.
- Add budgets for tool count, latency, and retries.
- Keep the factual path deterministic and independent.
- Keep clear fallbacks when the agent cannot improve evidence quality.

Primary files:

- new module: `src/lib/rag/agent-orchestrator.ts`
- `src/app/api/workspaces/[workspaceId]/chat/route.ts`
- `src/lib/rag/router.ts`

Deliverables:

- strategic planning layer
- controlled multi-step retrieval
- safer handling of multi-cause and marco-heavy questions

Exit criteria:

- complex questions improve materially without destabilizing simple questions
- latency remains within agreed budgets for `deep` mode

### Phase 9 - Evaluation, Observability, HITL, Latency, And UX Hardening

Goal: make the improvement loop sustainable and measurable.

Current state:

- Eval scripts, traces, audit logs, and onboarding HITL exist.
- Runtime cache exists, but it is process-local.
- Streaming is not true token streaming.

Key tasks:

- Expand factual, strategic, marco teorico, review, and writing datasets.
- Add CI or pre-release eval gates.
- Add dashboards for `partial`, `weak`, `insufficient`, and `not found` cases.
- Extend HITL from onboarding into chat answers, precedents, and evidence usefulness.
- Replace process-local cache with distributed cache plus invalidation on ingest or profile refresh.
- Add cache layers for retrieval, rerank, strategic bundles, and grounded answers.
- Implement real streaming instead of stage-simulation SSE.
- Track per-stage latency budgets and regressions.

Primary files:

- `scripts/eval-chat-live.ts`
- `scripts/eval-rag.ts`
- `scripts/report-strategic-chat-gaps.ts`
- `src/lib/runtime-cache.ts`
- `src/app/api/workspaces/[workspaceId]/chat/stream/route.ts`
- `src/app/api/workspaces/[workspaceId]/onboarding/hitl/route.ts`

Deliverables:

- stable release-gate eval suite
- stronger ops visibility
- feedback loop for evidence and precedent utility
- lower strategic latency
- true streaming UX

Exit criteria:

- regressions are caught before release
- operators can identify recurrent weak cases quickly
- repeated queries are materially faster

## Immediate Next Queue

This is the default queue to consult first.

1. Fix live chat eval reliability and auth so the strategic benchmark becomes trustworthy again.
2. Add recurring corpus coverage report with a prioritized backlog of missing `informe + sentencia` causes.
3. Integrate a cross-encoder rerank abstraction behind feature flags.
4. Upgrade `query-intent.ts` to LLM classification with heuristic fallback.
5. Turn `evidence-quality.ts` reformulations into real iterative CRAG.
6. Expand `document-facts.ts` to richer legal facts and support diagnostics.
7. Design structured memory v2 persistence beyond workspace metadata JSON.
8. Add GraphRAG schema in Supabase migrations.
9. Add chat-grade HITL for evidence usefulness and precedent utility.
10. Replace runtime-only cache with an invalidation-aware shared cache.

## Release Gates For Every Major RAG Change

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- targeted `eval:rag`
- targeted `eval:chat-live`
- if marco teorico or onboarding changed: targeted onboarding and writing smoke checks

## Things We Should Explicitly Avoid

- Expanding model complexity before fixing corpus coverage and retrieval quality
- Using `reclamacion` as a strategic primary source when `informe` or `sentencia` should lead
- Shipping GraphRAG or agentic flows without evaluation and guardrails
- Trusting quality snapshots produced by broken auth or broken live eval runs
- Treating workspace metadata JSON as the final persistence model for expert legal memory

## Definition Of Done For The Full Program

The program is complete when:

- factual questions are answered almost always via exact grounded evidence
- strategic answers are mostly `strong`, not merely plausible
- marco teorico consistently prioritizes defense-useful material and remains refreshable
- coverage is strong enough to support most high-value questions
- graph and memory layers improve precedent selection measurably
- the agent can plan only when needed and stays bounded
- latency is acceptable for real use
- regressions are visible quickly through evals, telemetry, and feedback

## Progress Log

- 2026-04-01: merged the original roadmap, external RAG analysis report, and current codebase findings into one living implementation guide.
- 2026-04-01: established a new weighted master-plan baseline at `~52%` for the expanded perfect-RAG target.
- 2026-04-01: set the default execution order to coverage -> retrieval v2 -> grounding/memory -> graph -> agentic -> ops hardening.
- 2026-04-01: added async LLM-assisted query intent classification with heuristic fallback and richer routing fields.
- 2026-04-01: integrated cross-encoder rerank abstraction with provider support and deterministic mock path for testable rollout.
- 2026-04-01: upgraded chat corrective retrieval to allow iterative CRAG-style reformulation loops instead of a single pass.
- 2026-04-01: enriched structured onboarding memory with document-priority rules, misuse risks, and precedent rationales.
- 2026-04-01: added initial GraphRAG foundation via legal graph schema migration and heuristic legal entity extraction helpers.
- 2026-04-01: persisted onboarding and marco teorico artifacts in dedicated storage outside workspace metadata JSON.
- 2026-04-01: wired chat and writing assistant to consume persisted onboarding artifacts when available.
- 2026-04-01: added onboarding-driven graph persistence and graph-derived context/query expansion inside chat.
- 2026-04-01: added a first strategic agent-planner layer to shape retrieval tools and subqueries for complex questions.
- 2026-04-01: integrated legal graph persistence into `source-ingest` so tribunal sources can populate graph entities during ingest.
- 2026-04-01: added operational graph refresh tooling and targeted cause-similarity refresh from persisted entities.
- 2026-04-01: upgraded strategic corrective retrieval so missing roles, graph-related causes, and planner hints shape follow-up queries.
- 2026-04-01: injected graph-backed overlap signals into onboarding recommendations to reward shared norms, authorities, materias, and related causes.
- 2026-04-01: added budget and step tracking to the strategic corrective loop so agentic deepening is bounded and observable.
- 2026-04-01: extended professional review with persisted marco artifacts, graph-derived context, and graph-informed retrieval queries.
- 2026-04-01: extended onboarding report generation and writing assistance with graph-derived legal context and persisted marco signals.
- 2026-04-01: introduced a reusable agentic retrieval-job builder and connected it to the strategic chat retrieval flow.
- 2026-04-01: raised the default agentic tool budget so initial retrieval and corrective loops share a bounded but usable orchestration budget.
- 2026-04-01: added an executable retrieval-job runner so the strategic planner now drives a reusable tool loop instead of only suggesting queries.
- 2026-04-01: expanded chat feedback and retrieval traces to store evidence-level HITL signals.
- 2026-04-01: added release-gate automation via `scripts/eval-release-gate.ts` and `npm run eval:release-gate`.
- 2026-04-01: upgraded tribunal document facts with cited norms, authorities, outcomes, and holdings for stronger factual and strategic grounding.
- 2026-04-01: added feedback-aware rerank signals sourced from prior retrieval traces and user evidence votes.
- 2026-04-01: introduced shared-cache fallback plus invalidation hooks for retrieval and factual caches.
- 2026-04-01: expanded deterministic factual answers to cover norms, authorities, outcomes, and holdings.
- 2026-04-01: added verification reports to the agentic retrieval loop so retrieval can stop when coverage is already sufficient.
- 2026-04-01: strengthened heuristic bundle ranking so richer `informe + sentencia` cause bundles outrank isolated chunks more consistently.
- 2026-04-01: added versioned onboarding artifacts in dedicated storage instead of keeping only the latest marco state.
- 2026-04-01: added `eval:onboarding-recommend` and wired onboarding-quality thresholds into the release-gate flow.
- 2026-04-01: extracted retrieval sufficiency verification into a reusable module used by the strategic chat tool loop.
- 2026-04-01: added graph-backed snapshot references so GraphRAG can inject direct evidence, not just extra queries.
- 2026-04-01: added artifact inspection support via onboarding artifact versions and a dedicated artifacts API route.
- 2026-04-01: added priority-cause corpus sync tooling to backfill hot causes surfaced by onboarding and chat activity.
