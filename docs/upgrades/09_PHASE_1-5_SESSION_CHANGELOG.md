# Phases 1–5 — Complete Session Change Log

## Purpose and scope

This document explains the implementation work completed in Phases 1–5 of the LogiCall Pulse / Telehealth LMS upgrade: **what changed, where it changed, and why the change was necessary**.

It is a complete file-level and behavioral account of the five phase commits, not a line-by-line diff. Related files are grouped where they implement one coherent behavior. Later review-driven corrections are included in the phase whose behavior they hardened. Work performed after Phase 5 for the local preview and video walkthroughs is listed separately so it is not misattributed to the phase commits.

All paths are relative to `upgrade-fork/`. The implementation followed `docs/upgrades/07_IMPLEMENTATION_AND_ACCEPTANCE_PLAN.md` on branch `feature/standard-meds-learning-upgrades`.

## Commit inventory

| Phase | Commit | Subject | Commit-level change |
|---|---|---|---:|
| 1 | `5cabc827ca7569fe25c18ad93b79259418722968` | Validated local AI and truthful evidence | 45 files; 4,753 insertions; 49 deletions |
| 2 | `a78f2b282a69a810e3188ebb2949b4de36f51f4e` | Approved source evidence and grounded curriculum | 31 files; 5,056 insertions; 79 deletions |
| 3 | `84f635e16584528c0d6a2b7c4bbb07a13ca2b5f3` | Deterministic call and workflow simulation | 28 files; 4,098 insertions; 80 deletions |
| 4 | `bcde16f9f2207f4a2ad044732497e8fdc631fa68` | Authoritative learning, certification, and analytics | 48 files; 7,016 insertions; 349 deletions |
| 5 | `b125365c94d6a59937b13b039fe3b2298ceba27f` | Standard Meds content, reliability, and release hardening | 57 files; 8,248 insertions; 78 deletions |

The per-phase commits contain **29,171 insertions and 635 deletions across 209 file-change entries**. Those are commit-by-commit churn figures, not unique-file or final-net figures: later phases sometimes edited lines introduced earlier. The net difference from baseline `0614770df8511da4a78dbca85ef2a95fae7252bd` to the Phase 5 commit is **171 files, 29,082 insertions, and 546 deletions**.

## The architectural through-line

Before these phases, the application could demonstrate attractive learning and simulation flows, but several important signals were not authoritative enough to support training or readiness decisions:

- an installed model could look ready even when it could not perform the required chat or structured work;
- replayed output could look like a real assessed interaction;
- a page citation could exist without proving that the claim appeared on that page;
- a dialogue judge could imply operational success without verified workflow events;
- browser-reported completion or correctness could be mistaken for mastery;
- one successful scenario could be mistaken for coverage of an entire track; and
- generated content could become stale when its source, prompt, model, or runtime changed.

The five phases therefore built one connected evidence chain:

**validated runtime → exact approved source evidence → deterministic workflow events → server-owned learning evidence → versioned certification and analytics → reliable, reviewable content operations.**

The central design choice was to make the server—not the browser, actor model, judge model, or imported JSON—the authority for consequential state. AI remains useful for generating and role-playing content, but it cannot silently manufacture evidence, override a hard failure, or certify a learner.

---

# Phase 1 — Validated local AI and truthful evidence

**Commit:** `5cabc827ca7569fe25c18ad93b79259418722968`

## Problem being solved

Local AI needed to work with Connor’s existing, intermittently running MLX server without becoming a permanent application dependency. At the same time, runtime status, replay behavior, external manual work, and assessment evidence needed to be honest. “A model is installed” was not enough to claim that the application could chat, stream, generate nested structured content, or judge evidence.

## 1. Disposable MLX runtime and configuration

- **Added `mlx-runtime/README.md`, `start.sh`, `status.sh`, and `stop.sh`.** These provide an isolated way to start, inspect, and stop the existing local MLX server for testing. The runtime lives in its own root-level folder rather than inside app business logic, so it can be deleted when an API replaces local inference.
- **Updated `.gitignore`.** Runtime-generated MLX files are excluded while the README and three control scripts remain tracked. This keeps local process state and downloaded/runtime artifacts out of source control.
- **Updated `.env.example`.** Added the optional OpenAI-compatible endpoint, heavy/fast model names, a local runtime label, and the manual-chat provider setting. Port `8081` was documented to avoid the Firestore emulator’s usual `8080` port.
- **Updated `package.json`.** Added `verify:local-ai`, `verify:local-ai:mlx`, and `dev:mlx` commands. The development command can run the real capability preflight before starting the app rather than assuming the runtime is usable.
- **Added `scripts/with-mlx-env.sh`.** This supplies the local profile to verification/development commands without embedding MLX-specific behavior in application flows.
- **Added `scripts/verify-local-ai.ts`.** This runs actual capability checks against the configured runtime and reports a result instead of inferring readiness from configuration.
- **Updated `next.config.ts`.** Set `outputFileTracingRoot` to the current project directory so the nested upgrade fork builds and traces files against its own root rather than an enclosing workspace.

**Why:** Connor explicitly wanted local testing infrastructure that was easy to remove and would not launch as part of deployment. The generic HTTP boundary achieves that while preserving a repeatable local developer workflow.

## 2. Generic OpenAI-compatible local provider

- **Added `src/lib/ai/openai-compatible-provider.ts`.** This implements the existing `LLMGateway` contract with native `fetch`, supporting ordinary chat, structured generation, and server-sent-event streaming. It handles fragmented SSE chunks and `[DONE]`, shares the existing structured-output repair path, honors cancellation/timeouts, and limits local concurrency to one.
- The provider accepts only loopback endpoints for this local profile. It does not load a model directly, require Python in the Next.js process, or invoke an MLX SDK.
- **Updated `src/lib/ai/gateway.ts` and `src/lib/ai/types.ts`.** The provider factory and common contracts now recognize local OpenAI-compatible and manual-chat modes while preserving the existing provider abstraction. Provider-specific decisions remain at the adapter/configuration boundary.
- The optional Ollama route remained available; the project did not spend Phase 1 effort repairing its known non-chat model issue after MLX proved viable.

**Why:** the existing MLX server already exposes an OpenAI-compatible API. A generic adapter is smaller, easier to remove, and less deployment-invasive than embedding MLX itself. Concurrency one also matches the practical limits of a single local model server.

## 3. Real capability preflight and honest health states

- **Added `src/lib/ai/local-runtime.ts`.** Defines provider-neutral runtime profiles, task settings, and FIFO concurrency limiting independently of MLX naming.
- **Added `src/lib/ai/local-preflight.ts`.** Tests eight distinct capabilities: availability, chat, streaming, nested structured output, realistic heavy generation, judge evidence, cancellation/timeout behavior, and concurrency behavior.
- **Updated `src/app/api/system/ai-health/route.ts` and `src/components/layout/AiRuntimePill.tsx`.** The UI can distinguish local, manual, replay, degraded, and blocked states. A configured or installed model is no longer presented as equivalent to a validated runtime.

**Why:** different failures require different responses. A server that chats but cannot emit valid nested judge evidence is degraded for this application, not fully ready. Independent checks make that visible and prevent a false sense of readiness.

## 4. Provenance and assessment eligibility

- **Added `src/lib/ai/provenance.ts`.** Introduces records for provider, model, prompt, schema, runtime, source, and timestamps. Supported origins include `local_ai`, `replay`, `manual_chat`, `deterministic`, and `trainer_override`; older records remain readable.
- **Updated `src/lib/schemas/api.ts`, `curriculum.ts`, and `analytics.ts`.** Generation, simulation, and analytics payloads can carry and validate provenance rather than treating every result as equivalent.
- **Updated `src/lib/ai/replay-provider.ts`, `src/lib/services/simulation-engine.ts`, `src/lib/services/analytics-rollup.ts`, and the simulation start/message/evaluate routes.** Replay is explicitly marked and excluded from assessment-eligible progress, readiness analytics, and certification. A defense-in-depth `REPLAY_NOT_ELIGIBLE` guard remains even if an earlier check is missed.
- **Updated `src/app/(dashboard)/learn/_components/SimulationRunner.tsx`, `SimTranscriptDetails.tsx`, `TranscriptChat.tsx`, and `ScorecardView.tsx`.** Learners and reviewers can see when they are inspecting a demo replay rather than participating in assessed local AI.
- Actor/runtime failures no longer create fake dialogue turns, fabricated scores, or successful SSE completion. Existing drafts and sessions remain available for inspection or retry.

**Why:** demo material is useful for product review, but it is not evidence that a person performed a task or that a model evaluated them. Persisted provenance makes the distinction durable instead of relying on a temporary UI label.

## 5. Manual curriculum exchange

- **Added `src/lib/ai/manual-exchange.ts`.** Defines versioned, checksum-bound prompt/response packages for approved external chat-assisted work.
- **Added `src/lib/ai/pipeline/manual-curriculum.ts`.** Validates package/task/schema identity, exact expected structure, source limitations, and provenance before importing generated curriculum.
- **Added manual curriculum export/import routes under `src/app/api/tracks/[trackId]/manual-curriculum/`.** Trainers can export a bounded prompt package and import a response without connecting a hosted provider.
- Imports use approved excerpts only, identify the result as external manual work, reject sensitive data, run shared structured validation, and return validation reports/diffs. The final commit occurs atomically only after every check passes. Invalid or stale imports write nothing and leave unrelated units and scenarios unchanged.
- **Updated `src/lib/ai/pipeline/generate-track.ts`.** Generation records source/provenance information and participates in the same validation model rather than maintaining a separate weaker path.

**Why:** losing or disabling local AI should not make the authoring workflow unusable. Manual exchange preserves a fallback without disguising externally produced text as local AI evidence.

## 6. Synthetic-data and sensitive-information controls

- **Added `src/lib/security/synthetic-data.ts`.** Adds credential, card, identity, and private-key pattern detection, redaction, synthetic allowlisting, and safe error messages.

**Why:** local prompts, manual exports, notes, logs, and fixtures must not become a side channel for real customer information, credentials, or payment data.

## 7. Phase 1 verification and file/test accounting

The real MLX endpoint passed all eight capabilities at the Phase 1 gate. The phase also passed **117 unit tests, lint, TypeScript, and production build** checks.

Every Phase 1 file is accounted for below; files already explained above are included here to make the commit inventory complete:

- Runtime/configuration: `.env.example`, `.gitignore`, `next.config.ts`, `package.json`, `mlx-runtime/README.md`, `mlx-runtime/start.sh`, `mlx-runtime/status.sh`, `mlx-runtime/stop.sh`, `scripts/with-mlx-env.sh`, `scripts/verify-local-ai.ts`.
- AI boundary and provenance: `src/lib/ai/gateway.ts`, `local-preflight.ts`, `local-runtime.ts`, `manual-exchange.ts`, `openai-compatible-provider.ts`, `provenance.ts`, `replay-provider.ts`, `types.ts`, `pipeline/generate-track.ts`, `pipeline/manual-curriculum.ts`.
- Simulation/application routes: `src/app/api/simulations/start/route.ts`, `src/app/api/simulations/[sessionId]/message/route.ts`, `src/app/api/simulations/[sessionId]/evaluate/route.ts`, `src/app/api/system/ai-health/route.ts`, and both manual-curriculum routes.
- UI: `src/app/(dashboard)/learn/_components/SimulationRunner.tsx`, `src/components/analytics/SimTranscriptDetails.tsx`, `src/components/layout/AiRuntimePill.tsx`, `src/components/simulation/ScorecardView.tsx`, `src/components/simulation/TranscriptChat.tsx`.
- Schemas/services/security: `src/lib/schemas/analytics.ts`, `api.ts`, `curriculum.ts`; `src/lib/services/analytics-rollup.ts`, `simulation-engine.ts`; `src/lib/security/synthetic-data.ts`.
- Tests: `tests/unit/local-preflight.test.ts`, `openai-compatible-provider.test.ts`, `provenance.test.ts`, `manual-exchange.test.ts`, `manual-curriculum-route.test.ts`, `replay-simulation-provenance.test.ts`, `replay-simulation-routes.test.ts`, and `synthetic-data.test.ts`.

---

# Phase 2 — Approved source evidence and grounded curriculum

**Commit:** `a78f2b282a69a810e3188ebb2949b4de36f51f4e`

## Problem being solved

A generated claim with a plausible page number was not necessarily supported by that page. Shared rules could also disappear when later units were generated with a limited prompt budget. Phase 2 replaced citation plausibility with exact, reviewable evidence and made trainer/SME approval part of publication.

## 1. Source-of-truth data model

- **Added `src/lib/schemas/source-truth.ts`.** Defines source bundles, document revisions, page evidence, extraction flags, transcriptions, exact excerpts, claim support/approval states, shared rule packs, operational assets, conflicts, SME decisions, and publication reports.
- Operational registries cover offers, links, dispositions, and workflow assets with context/effective-date scope, preventing a recovery offer or instruction from leaking into an unrelated support branch.
- **Updated `src/lib/schemas/curriculum.ts` and `api.ts`.** Cards, all five drill types, rubric criteria, source requests, and review responses can carry exact evidence and revision information.

**Why:** evidence needs stable identity and version history. A free-text citation cannot reliably support approval, recertification, or conflict handling.

## 2. Multi-document ingestion and revision preservation

- **Updated `src/lib/ai/pdf-extractor.ts`, `src/app/api/tracks/upload/route.ts`, and `src/lib/services/source-store.ts`.** Uploads now support multi-document bundles, ordered append/replacement, raw and normalized page text, content/page/bundle hashes, and extraction flags.
- Existing `sourcePages` compatibility is retained for older records, while new revisions are preserved rather than destructively replacing history.
- **Added `src/app/api/tracks/[trackId]/source-bundles/route.ts`.** Provides bundle-level access for the new ingestion and review model.

**Why:** a curriculum claim must point to the exact document revision used to generate it. Hashes make stale review and silent source substitution detectable.

## 3. Exact evidence verification and fail-closed review

- **Added `src/lib/services/source-evidence.ts`.** Performs normalized exact-text matching and verifies document, revision, page, transcription, support, and approval requirements.
- Wrong-page or mismatched text fails even when the cited page exists. Caption-only image text cannot approve detailed interface instructions. Detailed image-derived steps require an approved transcription.
- Model-provided `supported` or `approved` labels are treated as proposals, not authority; the server verifies them.
- **Added source-review routes:** `source-review/route.ts` for review state and `source-review/[action]/route.ts` for bounded actions such as exact-excerpt verification, transcription, asset/rule/pack/bundle approval, SME assignment/resolution, and revision checks.
- Changing a transcription advances its revision and invalidates prior approval instead of leaving an approval attached to different words.

**Why:** approval must attach to exact content, not to a model’s confidence or an unchanged database identifier.

## 4. Critical-input budgeting and inherited rules

- **Added `src/lib/ai/pipeline/source-budget.ts`.** Replaces citation-frequency-only selection with required-input inclusion and omission reporting.
- Protected compliance, pricing, link, privacy, payment, and medical inputs must be included or explicitly reported missing. Shared rules and asset excerpts can be inherited across later playbooks and units.
- Budgets fail closed when required evidence cannot fit or is unavailable.

**Why:** a prompt-sized subset is acceptable only if it still contains every critical instruction needed for safe generation. Frequently repeated text is not necessarily the most important text.

## 5. Grounded generation and regeneration

- **Updated `src/lib/ai/pipeline/generate-track.ts` and `regenerate-item.ts`.** Generation persists source bundle/revision, required rules, exact claim evidence, and provenance. Server-side checks run before checkpoints and final commits.
- **Updated `src/lib/ai/prompts/blueprint.ts`, `unit-builder.ts`, and `sim-builder.ts`.** Prompts request evidence for briefing cards, every drill type, and rubric criteria rather than treating evidence as a final annotation.
- **Added `src/lib/ai/prompts/evidence.ts`.** Centralizes evidence instructions so generators receive a consistent contract.

**Why:** generating the claim and its support together makes review possible at the item level and prevents unsupported content from being published merely because the overall document came from an uploaded PDF.

## 6. Studio review and publication gates

- **Added `src/components/studio/SourceReview.tsx` and `source-review-api.ts`.** Trainers can inspect source pages/transcriptions alongside generated claims, verify exact excerpts, and handle rules, assets, conflicts, and approvals.
- **Updated `TrackStudio.tsx`, `api-client.ts`, and `PublishDialog.tsx`.** Studio exposes the source-review workflow and structured HTTP `409` gate issues instead of reducing publication failures to an unexplained error.
- **Updated `src/app/api/tracks/[trackId]/publish/route.ts`.** Publication checks exact support and required approvals. Missing legacy bundle evidence fails closed rather than being grandfathered into the new standard silently.

**Why:** the trainer needs an actionable review surface, and the server must enforce the same rules even if someone bypasses the UI.

## 7. Demo grounding and Phase 2 tests

- **Updated `scripts/seed-demo.ts`.** Demo source hashes and exact approved evidence are computed from the actual fixture content. Incorrect citations/URLs were repaired. A deliberately blocked unresolved-price fixture demonstrates the conflict gate without inventing an SME decision.

Tests added:

- `generation-evidence.test.ts` — generated evidence structure and server verification;
- `source-budget.test.ts` — critical-input inclusion and omission failures;
- `source-store.test.ts` and `source-store-review.test.ts` — revisions, exact review, approvals, and conflicts;
- `source-upload.test.ts` — multi-document ingestion and page identity;
- `publication-gates.test.ts` — fail-closed publication behavior; and
- `grounding-golden.test.ts` — Standard Meds grounding examples and wrong-evidence cases.

The remaining Phase 2 files—`src/app/api/tracks/[trackId]/source-bundles/route.ts`, both source-review routes, upload/publish routes, Studio components/API helpers, prompts, schemas, extractor, pipelines, and source services—are all described in the sections above.

---

# Phase 3 — Deterministic call and workflow simulation

**Commit:** `84f635e16584528c0d6a2b7c4bbb07a13ca2b5f3`

## Problem being solved

A convincing conversation did not prove that the learner inspected local time, gave a disclosure, selected the correct link, recorded consent, completed the required workflow, or chose a valid disposition. Phase 3 moved those facts into a deterministic server state machine while retaining AI for dialogue and coaching.

## 1. Simulation state, actions, and evidence contracts

- **Added `src/lib/schemas/simulation-state.ts` and `simulation-constants.ts`.** Define scenario context/evidence requirements, lifecycle state, a strict action catalog, append-only events, state hashes, gate results, canonical dispositions, eligibility, synthetic outboxes, and scripted QA fixtures.
- **Updated `src/lib/schemas/api.ts`, `curriculum.ts`, and `analytics.ts`.** Scenario definitions, routes, and analytics can carry the new state/evidence model.

**Why:** stable action and event contracts make operational results reproducible, inspectable, and testable rather than dependent on wording in a model response.

## 2. Server-authoritative scenario transitions

- **Added `src/lib/services/scenario-state.ts`.** Owns inspections, dialing, identity/recording/contact state, offers/SMS/workflow actions, patient completion, escalation, notes, callback, wrap-up, fake payments, gates, minimum evidence, and disposition validation.
- `Recovered` requires actual supporting events; it is not just a selectable label. A blocked dial or wrap-up leaves the session in a correctable state instead of destroying it.
- **Added `src/app/api/simulations/[sessionId]/action/route.ts`.** Validates and executes actions against the authoritative session.
- **Updated simulation start/message/evaluate routes and `simulation-engine.ts`.** AI actor and judge outputs remain separated from operational truth. Neither the browser nor a model can directly set confirmation, offer count, disposition outcome, or reverse a deterministic critical failure.
- **Updated `src/lib/services/source-evidence.ts` and track publication.** Scenario context and gate evidence participate in source approval/publication requirements.

**Why:** safety and workflow conclusions must be derived from events the server actually accepted. The judge can explain a failure, but cannot talk the system out of it.

## 3. Standard Meds scenario matrix

- **Added `src/lib/content/standard-meds-scenarios.ts`.** Defines required scenario contexts, actions, gates, expected links/dispositions, and golden pass/critical-fail fixtures.

**Why:** a shared matrix makes required behavior testable across tracks and prevents one easy or unrepresentative conversation from standing in for the full workflow curriculum.

## 4. Synthetic operations UI

- **Added `src/components/simulation/SyntheticOperationsPanel.tsx`.** Provides synthetic inspections, dialing, identity and recording disclosure, symbolic links/SMS/offers, workflow/completion, designated fake payment tokens, notes, outboxes, gate feedback, and event playback.
- There are no live SMS, Slack, ReFlow, Dosable, portal, dialer, or payment integrations. The panel explicitly states that text-only simulation does not assess audible call skills.
- **Updated `src/app/(dashboard)/learn/_components/SimulationRunner.tsx`.** Refreshes session state, displays operations, requires valid `READY_FOR_EVAL` wrap-up, retries without duplicate wrap-up events, and preserves learner drafts after model failure.

**Why:** learners need to practice the operational sequence, not merely describe it. Keeping every integration synthetic permits realistic failure testing without real-world side effects.

## 5. Actor/judge boundaries and Studio QA

- **Updated `src/lib/ai/prompts/sim-actor.ts` and `sim-judge.ts`.** Actor output is constrained to dialogue; judging is framed as evidence-based coaching within deterministic outcomes.
- **Added `ScenarioContextEvidenceEditor.tsx` and `ScenarioQASection.tsx`.** Trainers can define context/evidence requirements and run scripted scenario QA from Studio.
- **Updated `ScenarioEditor.tsx` and `src/components/studio/validation.ts`.** The new fields are editable and validated as part of scenario authoring.
- **Added `src/app/api/tracks/[trackId]/scenario-qa/route.ts`.** QA runs are authorized, bounded, read-only, and sanitized.

**Why:** Studio needs to validate not just whether a scenario looks plausible, but whether its required actions and gates can actually produce the intended pass/fail paths.

## 6. Phase 3 test and file coverage

- **Added `tests/unit/scenario-state.test.ts`** for state transitions, evidence, dispositions, and gates.
- **Added `simulation-action-route.test.ts`** for route authority and invalid action handling.
- **Added `standard-meds-scenario-matrix.test.ts`** for required scenario and golden-path coverage.
- **Updated `replay-simulation-routes.test.ts`** to preserve replay ineligibility within the stateful flow.

All 28 Phase 3 files are covered above: four modified simulation/start/message/evaluate routes plus the new action route; publish and scenario-QA routes; the learner runner and new operations panel; three Studio editor/validation files; actor/judge prompts; the Standard Meds matrix; three schemas plus the two new simulation schemas; analytics/simulation/source services; and the four tests.

---

# Phase 4 — Authoritative learning, certification, and analytics

**Commit:** `bcde16f9f2207f4a2ad044732497e8fdc631fa68`

## Problem being solved

Completion, first-try correctness, mastery, retention, scenario coverage, and readiness are different claims. Phase 4 stopped accepting browser assertions for those claims and introduced versioned evidence, required assessment coverage, recertification, and analytics that preserve those distinctions.

## 1. Server-owned drill attempts and grading

- **Added `src/app/api/progress/drill-start/route.ts` and `drill-answer/route.ts`.** Attempt start, timing, idempotency, answer submission, and grading are server-owned.
- **Added `src/lib/services/drill-grader.ts`.** Computes correctness and feedback from canonical content rather than trusting a browser-provided result.
- Learner responses are sanitized DTOs: hidden answers/rationales are not exposed prematurely, and idempotent replays do not become a way to reveal protected feedback.
- **Updated `src/app/api/progress/complete-unit/route.ts`.** Unit completion requires the server-derived drill state and is idempotent; client-supplied correctness, first-try status, score, coverage, or certification is not authoritative.

**Why:** anything the browser asserts can be forged or accidentally corrupted. Consequential learning evidence must be recomputed or verified on the server.

## 2. Drill learner experience and recovery

- **Refactored `src/components/learn/DrillRunner.tsx` and `drill-shared.tsx`.** Uses stable start/retry IDs, duplicate-submit protection, preserved answers after network failure, and server-derived feedback/recovery/results.
- **Updated all five drill components:** `FillBlankChoiceDrill.tsx`, `MatchPairsDrill.tsx`, `MultipleChoiceDrill.tsx`, `SequenceOrderDrill.tsx`, and `TrueFalseSpotDrill.tsx`.
- Match options and sequence display aliases were rotated so correct answers cannot be inferred from aligned arrays or predictable generated IDs.
- **Updated `UnitRunner.tsx`, the unit page, and `src/components/studio/PlayPreview.tsx`.** Learner and Studio preview paths use the same server-grading contract rather than a preview-only alternate notion of correctness.
- **Added `src/lib/services/retrieval-schedule.ts`.** Schedules immediate recovery, varied retrieval, and spaced reviews. Repeating the same item immediately is not treated as independent retention; mastery requires correct varied retrieval.

**Why:** recovery should help a learner continue without weakening the evidence standard. Randomized presentation prevents answer-position leakage, and varied retrieval distinguishes recall from short-term repetition.

## 3. Versioned learning evidence and assessment blueprints

- **Added `src/lib/schemas/learning.ts`, `src/lib/services/learning-evidence.ts`, and certification schemas/services.** Evidence is tied to exact curriculum versions, knowledge items, required rules, scenario coverage, provenance, and observations.
- Publication now freezes an assessment blueprint. Certification requires the blueprint’s actual unit/scenario coverage—not merely “all units plus any scenario.”
- Eligible provenance, drill mastery, required workflow/disposition evidence, customer-concern evidence, and enrollment are checked.
- Required customer concerns persist in blueprints and must occur in learner dialogue; they cannot silently disappear from later assessment calculations.
- Legacy or unverified evidence is labeled rather than silently upgraded.

**Why:** certification must answer “did this learner satisfy this version’s required evidence?” rather than “does this learner have some successful activity?”

## 4. Certification lifecycle and recertification

- **Added `src/lib/services/certification.ts` and `certification-commands.ts`.** Implement grant, expiry, revocation, reconciliation, historical snapshots, and recertification; their contracts use the versioned learning schemas described above.
- **Added `src/app/api/certifications/revoke/route.ts` and `reconcile/route.ts`.** Internal commands record actor, reason, and timestamps.
- Same-ID drill or scenario content changes trigger recertification. Missing mappings conservatively broaden reassessment instead of assuming nothing changed.
- Cross-version enrollment reconciliation clears old completion as current-version completion while preserving history.
- A revoked certification cannot automatically reappear merely because the underlying evidence is unchanged.

**Why:** content identity alone is insufficient when its meaning changes. Likewise, an administrative revocation is a real decision, not a temporary cache state.

## 5. Honest analytics and learner/trainer views

- **Added `src/lib/services/learning-analytics.ts` and updated `analytics-rollup.ts`.** Separates completion, initial knowledge, mastery, retention, scenario coverage, workflow, compliance, recency, and evidence confidence.
- Defaults to current-version eligible evidence; replay and historical/unverified records do not become readiness evidence.
- Learner evidence derives expiry from `expiresAt`; legacy badges require `current_verified`. “Track mastery” wording was corrected to “Track completion” where that is what the metric measures.
- **Added `LearningEvidencePanel.tsx` and `LearningAnalyticsPanel.tsx`; expanded `CertificationMatrix.tsx`.** Learners and trainers can inspect evidence and certification states rather than seeing one ambiguous score.
- **Updated `src/app/(dashboard)/analytics/page.tsx`, `src/app/(dashboard)/analytics/agents/[uid]/page.tsx`, `src/app/(dashboard)/learn/[trackId]/page.tsx`, `src/app/(dashboard)/learn/[trackId]/unit/[unitId]/page.tsx`, `TrackHeader.tsx`, and `src/app/(dashboard)/roster/page.tsx`.** Surfaces use the new status/evidence distinctions.

**Why:** an analytics dashboard is unsafe if completion, replay, or historical activity is visually indistinguishable from current mastery or readiness.

## 6. Persistence security and Phase 4 tests

- **Updated `firestore.rules` and `firestore.indexes.json`.** Added access controls and verified-query indexes for the new learning and certification records.
- **Updated `tests/integration/firestore-rules.test.ts` and added `tests/rules/firestore-rules.test.ts`.** Cover role/privacy boundaries and denial behavior.

Unit tests and helpers added:

- `certification.test.ts`;
- `learning-analytics.test.ts`;
- `retrieval-schedule.test.ts`;
- `drill-grader.test.ts`;
- `drill-start-route.test.ts`;
- `drill-answer-route.test.ts`;
- `complete-unit-route.test.ts`;
- `tests/unit/helpers/fake-progress-db.ts`; and
- `tests/unit/helpers/learning-service-fixtures.ts`.

All Phase 4 UI pages/components, progress/certification/publish routes, schemas, services, Firestore files, and tests are named above.

---

# Phase 5 — Standard Meds content, reliability, and release hardening

**Commit:** `b125365c94d6a59937b13b039fe3b2298ceba27f`

## Problem being solved

The first four phases established trustworthy mechanisms. Phase 5 supplied the actual Standard Meds draft curriculum, made long generation runs recoverable, extended manual review to judging, added trainer QA, and hardened release controls. It also documented the checks that did **not** pass or could not be run rather than converting implementation into an unsupported production-readiness claim.

## 1. Complete Standard Meds source catalog and draft content pack

- **Added `src/lib/content/standard-meds/`** with the following modules:
  - `source-catalog.ts`, `source-manifest-schema.ts`, `source-manifest.json`, `sources.ts`, and `register-sources.ts` define and validate the source inventory;
  - `orientation.ts` defines SM-00 Training Hub orientation;
  - `recovery-content.ts`, `service-content.ts`, and `shared-compliance.ts` define call-specific and shared instructional content;
  - `curriculum-builders.ts`, `rules.ts`, `packs.ts`, and `track-spec.ts` assemble tracks, units, rules, and scenario structure;
  - `publication.ts` records draft/publication metadata and blockers;
  - `types.ts` defines the pack contracts; and
  - `index.ts` exposes the pack entry point.
- **Added `scripts/register-standard-meds-sources.ts`.** Registers all nine supplied PDFs with actual file/page SHA-256 hashes, page counts, and extraction flags—**120 pages total**.
- The manifest intentionally excludes raw page text. This keeps the checked-in catalog from becoming an unnecessary duplicate of the source documents.
- The pack contains **SM-00 orientation plus eight three-unit call tracks**. The eight call packs contain **60 scenarios**, not an inflated or assumed count.
- Every pack remains draft/unpublished. Exact-excerpt, transcription, asset, trainer-signoff, and SME blockers remain visible instead of being auto-approved.

**Why:** the application needed a complete, structured, source-bound draft—not stubs or silently guessed decisions—while preserving the requirement that humans approve content before publication.

The registered source set is:

1. Standard Meds — 00 Training Hub Overview;
2. 01 Neuropathy — NeuroCalmRx;
3. 02 Anti-Aging Skin — LiftRx;
4. 03 Erectile Dysfunction — QuattroRx TriShot;
5. 04 Nail Fungus — ZoliraRx;
6. 05 Longevity — NAD+ Therapy;
7. 06 Customer Support — All Products;
8. 07 Medical Chat — Pending Information; and
9. 08 Renewals — Failed Payment.

## 2. Safe, deterministic draft import

- **Added `src/lib/services/standard-meds-draft-import.ts` and `scripts/seed-standard-meds-drafts.ts`.** Builds **318 schema-validated Firestore documents**, binds them to source revisions, and makes reruns deterministic no-ops when nothing changed.
- Dry-run works without Firebase credentials or initialization. Writes require both `--confirm-synthetic-local` and a loopback `FIRESTORE_EMULATOR_HOST`; there is no production override.
- Overwrite protection preserves published versions, bundle/page approvals, extracted text, transcriptions, approved excerpts, approved curriculum/rubric evidence, conflicts, and SME registers.
- Changed seed imports cannot clear conflict or unresolved-SME identifiers as a side effect.

**Why:** local seed operations should be repeatable and safe, and refreshing draft content must never erase human review or touch production by accident.

## 3. Resumable generation and exact cache identity

- **Added `src/lib/ai/pipeline/generation-reliability.ts` and integrated it into `generate-track.ts`.** Adds schema-versioned checkpoints, exact-input hashes, resume/cache behavior, concurrency one, 180-second stage timeouts, output/provenance validation, actual-or-unknown token reporting, and character/duration budgets.
- Failed stages do not write a checkpoint as though they succeeded. A rerun resumes from the last valid checkpoint rather than discarding the run.
- Server-only working drafts preserve the last complete Studio draft when a later generation attempt fails. Final complete draft and secret/rubric data commit atomically.
- Cache identity includes provider, heavy/fast model, prompt, schema, runtime label/profile, normalized endpoint, and effective structured settings. Track title, campaign, and division are included in downstream unit/simulation input hashes.

**Why:** a long local generation run is likely to encounter timeouts or invalid output occasionally. Resumability reduces lost work, while exact cache identity prevents stale content or false provenance after a prompt, context, model, or runtime change.

- **Updated `src/lib/ai/gateway.ts` and `ollama-provider.ts`.** Expose non-secret effective runtime settings for hashing and normalize the Ollama endpoint; Ollama context/keep-alive constants are shared rather than hidden duplicates.

## 4. Trainer-only manual judge exchange

- **Added `src/lib/services/manual-judge-exchange.ts`.** Creates trusted persisted judge tasks with redacted session content, exact approved rubric evidence, verbatim learner quotes/event IDs, and honest external-work labels.
- **Added manual-judge export/import routes under `src/app/api/simulations/[sessionId]/manual-judge/`.** Export and import are trainer-only and use the same validation philosophy as curriculum exchange.
- Imported judgments receive server-computed scoring within deterministic gate outcomes. Malformed or stale imports write nothing.
- Review hardening recomputes document, revision, page, exact-text, transcription, and conflict requirements and requires reviewer UID/timestamp. Session `updatedAt` is checked transactionally so two reviewers cannot score stale versions concurrently.
- **Added `src/components/studio/ManualJudgeExchange.tsx` and `manual-judge-ui-helpers.ts`; updated `TrackStudio.tsx`.** Trainers can perform the export/import workflow from Studio without exposing hidden rubrics to learners.

**Why:** judging must remain possible without local AI, but external text cannot be allowed to invent evidence, use an outdated rubric, override a hard failure, or race another review.

## 5. Trainer QA across current evidence

- **Added `src/lib/services/trainer-qa.ts`, `src/app/api/studio/tracks/[trackId]/qa/route.ts`, and `src/components/studio/TrainerQaPanel.tsx`.** Surfaces unsupported evidence, critical conflicts, high eligible-learner failure, and deterministic/model disagreement.
- QA uses current-version eligible evidence, excludes replay/legacy evidence, and applies a minimum of five attempts with at least 40% failure for the high-failure signal.

**Why:** trainers need to find systemic content and assessment problems without manually opening every artifact. Eligibility and minimum-sample rules reduce misleading alarms.

## 6. SME/conflict and evaluation integrity hardening

- **Updated `src/lib/schemas/source-truth.ts`, `curriculum.ts`, `source-evidence.ts`, upload, and source-review routes.** Persists `unresolvedSmeDecisionIds` and blocks bundle approval/publication for every open or `sme_review` conflict regardless of severity label.
- Revised uploads preserve the conflict/SME register. A changed import cannot silently make a decision disappear.
- Evaluation-staleness controls prevent an old session or rubric from being judged as though it were current.
- Release regressions prove two central invariants: replay cannot be laundered into certification, and a deterministic critical failure overrides even a perfect model/manual judge score.

**Why:** severity labels and friendly judge output are not permission to bypass unresolved source truth or observed safety failures.

## 7. Security exclusions and operator documentation

- **Updated `firestore.rules`.** Generation checkpoints, working drafts, and manual-judge tasks are default-denied to client access; server workflows remain authoritative.
- **Updated `.gitignore`.** Excludes `.playwright-browsers/` so local browser binaries are not committed.
- **Added `docs/upgrades/08_OPERATOR_RUNBOOK.md`.** Documents local setup, preflight, manual exchange, source review, checkpoints/recovery, security, validation, limitations, and rollback.

**Why:** internal operational records should not become learner-readable merely because they are stored in Firestore, and the system needs a repeatable operating/rollback procedure outside the code.

## 8. Phase 5 test accounting

New or updated tests cover every major Phase 5 behavior:

- `tests/unit/standard-meds-content-pack.test.ts` — nine sources, 120 pages, structured packs, 60 scenarios, and draft blockers;
- `standard-meds-draft-import.test.ts` — 318 documents, deterministic reruns, dry-run, and preservation rules;
- `generation-reliability.test.ts` and `generation-runtime.test.ts` — checkpoints, resume, cache identity, runtime settings, timeouts, and validation;
- `generation-evidence.test.ts` and `grounding-golden.test.ts` — retained grounding behavior under reliability changes;
- `manual-judge-exchange.test.ts` and `manual-judge-ui-helpers.test.ts` — task trust, redaction, scoring, stale imports, concurrency, and UI helpers;
- `trainer-qa.test.ts` — QA filters, eligibility, thresholds, and disagreement;
- `evaluation-staleness.test.ts` — stale session/rubric protection;
- `release-regressions.test.ts` — replay/certification and deterministic-gate invariants;
- `publication-gates.test.ts`, `source-store-review.test.ts`, and `source-upload.test.ts` — unresolved SME/conflict persistence and publication blocks; and
- `tests/integration/firestore-rules.test.ts` plus `tests/rules/firestore-rules.test.ts` — new default-deny rules.

All Phase 5 source-pack modules, scripts, routes, Studio components, AI/runtime files, schemas/services, documentation, rules, and tests are accounted for above.

---

# Final Phase 5 verification and remaining limitations

## Checks that passed

- TypeScript passed.
- ESLint passed.
- Production build passed.
- Patch/whitespace checks passed.
- Unit suite: **41 files, 436 tests**.
- Focused integrity suite: **5 files, 56 tests**.
- Credential-free Standard Meds dry run: **318 documents**, with no Firebase initialization and no writes.

## AI, browser, and emulator results

- An earlier real MLX preflight passed all eight capabilities.
- The final MLX preflight was **degraded**: seven capabilities passed, but judge evidence failed JSON validation after three attempts. This means judge structured-output behavior was inconsistent, not that the entire local runtime was unavailable.
- Playwright sign-in passed. Cohort join timed out on the initial run and retry.
- Firestore emulator/rules suites were not run in that final environment because Java was unavailable.
- No emulator-backed Standard Meds seed write or authenticated manual-route acceptance run was completed.
- Full Studio accessibility/responsive validation and the complete trainer/learner acceptance matrix remained unvalidated.

## Content and readiness boundaries

- All nine Standard Meds packs remained **draft and not publication-eligible**. Their presence in code is not trainer or SME approval.
- The unresolved judge preflight, unrun rules suite, and incomplete browser acceptance prevent an honest production-readiness claim.
- Text-only simulation assesses typed dialogue and synthetic operational behavior. It does **not** assess tone, pacing, pronunciation, listening, or other audible live-call skills and is not live-call authorization by itself.
- No live external-system integrations were introduced.

These limitations are part of the implementation result, not footnotes to hide: the phase delivered the mechanisms and draft content, while leaving the exact remaining acceptance work visible.

---

# Post-Phase 5 addendum — Local preview and walkthrough fixes

These changes were made after the five phase commits and were uncommitted when this report was written. They are deliberately excluded from the phase-commit statistics.

## 1. Preview-server argument compatibility

- **Updated `package.json`** so `npm run dev` invokes `scripts/dev-server.mjs`.
- **Added `scripts/dev-server.mjs`.** Translates Vite-style `--host` / `--host=...` arguments to Next.js `--hostname`, forwards other arguments, propagates exit status, and forwards termination signals.

**Why:** the local preview runner supplies `--host`; Next.js expects `--hostname`. Without the adapter, the preview command could fail before the app opened.

## 2. Source-approval deadlock in generation

- **Updated `src/components/studio/GenerationStepper.tsx`.** Loads Source Review before opening generation SSE. If the uploaded bundle is not approved/published, it shows an explicit “Approve source bundle revision” step and starts generation only after approval succeeds.
- The stepper now handles asynchronous cleanup/cancellation and closes an optional EventSource safely.

**Why:** Phase 2 correctly required source approval, but the initial upload flow did not expose that approval before generation. The server gate and UI sequence had deadlocked a real trainer workflow.

## 3. Evidence for older prepared replay content

- **Updated `src/lib/ai/replay-provider.ts`.** Added `addReplayEvidence()` for older prepared card/drill/rubric outputs that lacked the newer evidence fields. It binds their citations to exact text from the uploaded source prompt and marks the evidence as unsupported/draft until the real server verifies and a trainer approves it.

**Why:** the walkthrough uses older prepared demo output. This compatibility shim lets it pass schema and exact-source verification without auto-approving evidence or changing replay’s assessment ineligibility.

## 4. Walkthrough recording workflow

- **Updated `scripts/record-demo.ts`.** Adds demo-only preparation of scenario context/evidence and golden QA fixtures for legacy generated drafts, visibly approves source bundle and claim evidence, waits for actual publication, and records local-time inspection, disclosure, recovery, note, and wrap-up actions.
- Records three role-based walkthroughs: trainer authoring/publication, agent training/simulation, and supervisor evidence review.
- Uses a published synthetic track with ID `J8rwFKIvx2IkWIaowgV6` for the recorded flow.
- The real MLX simulation in the walkthrough was assessment-eligible, scored **60%**, and **did not pass**. It was not edited into a fake success.

**Why:** the videos needed to demonstrate the new evidence and operations workflow end to end, including a real non-passing result, rather than replaying the older dialogue-only product behavior.

The three walkthrough videos were completed and visually reviewed under `demo-recordings/` (`trainer.mp4`, `agent.mp4`, and `supervisor.mp4`). Post-phase TypeScript and lint passed; the full unit suite and production build were **not** rerun after these particular edits, so the Phase 5 totals above are not being represented as post-addendum verification.

---

# What these phases did not do

For clarity, the work did **not**:

- embed an MLX SDK, Python sidecar, or direct model loader in the app;
- make MLX a deployment requirement;
- add a hidden hosted-provider fallback;
- connect live SMS, Slack, ReFlow, Dosable, portal, dialer, or payment systems;
- accept real card data instead of designated fake tokens;
- auto-approve Standard Meds source evidence or invent SME decisions;
- allow replay or manual imports to masquerade as assessed local-AI evidence;
- make a model judge superior to deterministic safety gates; or
- certify that the complete system is production-ready while acceptance checks remain incomplete.

The result is a substantially stronger local-first training system: authoring, simulation, learning, and certification now share explicit evidence contracts, and the important failure modes are visible rather than disguised as success.
