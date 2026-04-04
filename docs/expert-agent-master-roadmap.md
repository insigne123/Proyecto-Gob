# Expert Agent Master Roadmap

This file is the source of truth for turning the app into an expert legal-document assistant.

It records:

- the target quality bar
- the current measured baseline
- everything still missing
- the exact phased implementation order
- phase exit criteria

It should be updated as the system evolves and used as the execution checklist for future work.

## Product Goal

Build an assistant that can reliably:

- answer factual questions from tribunal/workspace documents with exact citations
- answer strategic questions with strong grounding, not only correct wording
- build a marco teorico that prioritizes `informe + sentencia` and uses `reclamacion` only as context unless explicitly requested
- fail safely when evidence is incomplete
- remain fast enough for real use

## Success Metrics

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

- top persisted and runtime references dominated by `informe + sentencia`
- `reclamacion` used as context unless explicitly requested
- high recall of gold documents in top-8 / top-10
- strategic recommendations are actionable and document-backed

### Global

- overall system quality `>= 95%`

## Current Baseline

### Factual Chat

- Source: `eval/results/chat-live-factual-tribunal-expert-pass-v2.json`
- Status: very strong
- Measured:
  - `mustIncludeAllMatchedRate = 1.0`
  - `supportStrength strong = 4/4`
  - `avgLatencyMs = 11583`

### Strategic / Balanced Chat

- Stable reference: `eval/results/chat-live-real-workspace-expert-pass-v7.json`
- Status: good but not yet expert-perfect
- Measured:
  - `mustIncludeAllMatchedRate = 1.0`
  - `supportStrengths = 4 strong / 2 partial`
  - `avgLatencyMs = 41132`

### Tribunal RAG Core

- Source: `eval/results/rag-eval-tribunal-filtered-10of10-pass-v7.md`
- Measured:
  - `Not-found accuracy = 100%`
  - `Citation validity = 100%`
  - `Must-include all matched = 100%`
  - `Total avg latency ~= 40380 ms`

### Corpus Coverage Audit

- Source: `scripts/audit-tribunal-corpus-coverage.ts`
- Current sampled audit:
  - `200` causes audited
  - `38` with complete `informe + sentencia` pair
  - `135` missing `informe`
  - `161` missing `sentencia`
  - `162` missing core pair

## Current Completion Estimate

- Roadmap technical implementation: `~92-93%`
- Functional quality overall: `~94-95%`
- Factual chat: `~99%`
- Strategic chat: `~93-94%`
- Marco teorico: `~92-93%`

## What Is Already Implemented

- hybrid retrieval for chat
- deterministic factual answer path
- facts layer code and backfill script
- facts generation during ingest
- thread memory in runtime and persisted thread memory fields
- strategic memory from onboarding references and profiles
- defense-aware document prioritization for marco teorico
- stricter support calibration and support reporting
- runtime caches for facts, retrieval, strategic bundles, and grounded answers
- coverage audit script for tribunal corpus

## Main Remaining Gaps

1. Corpus coverage is still the biggest quality bottleneck.
2. Strategic answers still have too many `partial` responses.
3. Strategic retrieval still lacks a dedicated reranker / cross-encoder.
4. Coverage and quality monitoring are not yet fully operationalized.
5. HITL / feedback loops are still missing.

## Master Execution Order

Work should continue in this order unless a blocking dependency changes it.

1. corpus coverage expansion
2. facts layer operational hardening
3. strategic reranker / retrieval v2
4. stronger strategic grounding
5. marco teorico v2 polishing
6. cache and latency optimization
7. evaluation expansion
8. observability and HITL

## Phase Plan

### Phase 1 - Corpus Coverage Expansion

Goal: ensure the system actually has the right documents before trying to reason about them.

Tasks:

- expand tribunal sync to maximize `informe` and `sentencia` coverage
- build prioritization logic for missing core-pair causes
- create recurring coverage reports by cause and workspace
- add focused backfill for high-value causes used by onboarding/chat
- flag causes with only `reclamacion` as structurally weak

Deliverables:

- improved corpus sync/backfill workflow
- recurring coverage audit output
- backlog of missing-core-pair causes

Exit criteria:

- core-pair coverage improves materially over current audit
- high-value causes stop showing only `reclamacion`

Status: in progress.

### Phase 2 - Facts Layer Operational Hardening

Goal: make factual reasoning depend on structured evidence first.

Tasks:

- keep `gob_tribunal_document_facts` continuously updated from ingest
- extend facts extraction to more signals when useful
- validate fact completeness by document role
- expose fact coverage diagnostics for each cause

Deliverables:

- operational facts table
- refresh/backfill workflow
- diagnostics on missing fact dimensions

Exit criteria:

- facts are generated automatically for newly ingested tribunal documents
- factual chat relies on facts-first whenever possible

Status: mostly implemented; needs ongoing operational use.

### Phase 3 - Strategic Retrieval V2

Goal: improve retrieval quality for balanced and strategic questions.

Tasks:

- add dedicated reranker / cross-encoder for strategic retrieval
- rank by cause bundle, not only by isolated chunk
- prioritize bundles with `informe + sentencia`
- use role constraints more aggressively on strategic questions
- continue using facts and thread memory as retrieval hints

Deliverables:

- strategic reranker module
- bundle-level scoring
- improved top-K evidence mix

Exit criteria:

- strategic queries surface better multi-document evidence
- fewer correct-but-partial answers due to missing supporting chunks

Status: partially implemented with heuristic rerank; dedicated reranker still pending.

### Phase 4 - Strategic Grounding V2

Goal: convert more `partial` strategic answers into `strong` without increasing hallucination.

Tasks:

- harden strong-support rules by mode and evidence diversity
- require multi-document support when the question implies strategic recommendation
- distinguish clearly between `strong`, `partial`, `preliminar`, and `no respaldado`
- keep rescue answers useful but clearly calibrated

Deliverables:

- stricter support logic
- better confidence explanations
- fewer ambiguous strategic answers

Exit criteria:

- strategic eval reaches majority `strong`
- `partial` is used only when evidence is truly incomplete

Status: in progress.

### Phase 5 - Marco Teorico V2 Polishing

Goal: make persisted marco teorico as good as runtime behavior.

Tasks:

- improve cause scoring beyond document ranking alone
- reward causes with useful `informe + sentencia` combinations
- penalize causes that only contribute contextual `reclamacion`
- persist stronger rationale for why each cause/document matters
- keep strategic notes, risks, and suggested defense lines aligned with evidence

Deliverables:

- stronger persisted `structured_memory`
- cleaner `tribunal_references`
- more stable onboarding recommendations

Exit criteria:

- persisted marco teorico matches runtime priorities in practice

Status: in progress.

### Phase 6 - Cache And Latency Optimization

Goal: reduce latency while preserving quality.

Tasks:

- cache more retrieval layers safely
- cache grounded strategic answers for repeated queries
- avoid expensive retrieval branches when cached evidence is sufficient
- reduce repeated work in balanced mode
- keep factual path as close as possible to instant

Deliverables:

- lower latency for repeated questions
- lower retrieval duplication cost

Exit criteria:

- factual and balanced repeated queries are materially faster

Status: partially implemented.

### Phase 7 - Evaluation Expansion

Goal: measure quality with more confidence.

Tasks:

- expand real datasets for factual, strategic, marco teorico, and writing/review
- create stronger gold expectations for strategic answers
- keep a stable benchmark suite for release decisions

Deliverables:

- larger evaluation corpus
- clearer release gate metrics

Exit criteria:

- quality claims are supported by larger evaluation sets, not only smoke tests

Status: pending expansion.

### Phase 8 - Observability And HITL

Goal: create a sustainable improvement loop.

Tasks:

- expose dashboards for `partial` / `weak` answers
- add human review workflow for strategic misses
- collect document usefulness feedback
- collect precedent usefulness feedback

Deliverables:

- operator visibility into weak cases
- structured human feedback loop

Exit criteria:

- team can identify and fix recurring weak patterns quickly

Status: pending.

## Immediate Next Actions

These are the next concrete implementation targets.

1. Add dedicated strategic reranker / cross-encoder.
2. Expand corpus coverage for causes missing `informe` or `sentencia`.
3. Continue raising strategic `strong` support share.
4. Expand real evaluation datasets.

## Definition Of Done

The system can be considered complete for this roadmap when:

- factual questions are answered almost always via exact, grounded evidence
- strategic answers are mostly `strong`, not merely correct in wording
- marco teorico consistently prioritizes defense-useful material
- the corpus has enough coverage to support most high-value questions
- latency is good enough for real usage
- regressions are visible quickly through evals and monitoring
