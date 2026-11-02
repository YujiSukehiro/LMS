# 07 — Implementation and Acceptance Plan

## 1. Delivery objective

Implement P0–P2 in a separate local fork while preserving the original application as a fallback. Build on the current Next.js/React/Firebase architecture. Treat local AI as a replaceable MVP adapter: prefer the existing MLX server through a generic OpenAI-compatible local HTTP provider, keep Ollama as an alternative, and retain manual chat-assisted work. Do not add a required hosted AI API, MLX SDK, Python sidecar, or live external-system integration.

This plan is sequential at the phase level. Later phases depend on the source, state, and evidence contracts established earlier. Within one phase, a lead engineer may use a small swarm for disjoint workstreams after defining shared contracts. The lead owns integration and phase acceptance. Do not leave placeholders or claim completion from static checks alone.

## 2. Work protection and Git strategy

The original repository currently has no commits, so a normal worktree is not available.

Required strategy:

1. Keep every path and command inside `/Users/connor/Coding/Contracting/Logicall/Telehealth LMS`.
2. Treat all existing original project files as read-only. The only permitted addition at the original project root is the new `upgrade-fork` directory.
3. Copy the project to `/Users/connor/Coding/Contracting/Logicall/Telehealth LMS/upgrade-fork` with `rsync -a`.
4. Exclude `upgrade-fork` itself, `.next`, `node_modules`, test output, logs, and `.DS_Store`; preserve source, documents, training material, and local configuration without printing secrets.
5. Initialize Git in the fork only.
6. Install dependencies and verify the unchanged copied baseline in the fork.
7. Create a baseline commit in the fork.
8. Create `feature/standard-meds-learning-upgrades` in the fork.
9. Commit after each completed phase with tests and a clear change summary.
10. Never run Git mutation commands in the original root repository.

The baseline commit is the local rollback point. It does not alter or version the original root repository. The recursive copy exclusion is mandatory because the fork is inside the source directory.

## 3. Phase summary

| Phase | Priority | Deliverable | Required gate |
|---|---|---|---|
| 0 | Protection | Verified fork, baseline commit, feature branch | Original untouched; copied baseline checks recorded |
| 1 | P0 | Honest runtime status and working local/manual path | Real chat/structured preflight; replay ineligible |
| 2 | P1 | Grounded multi-document curriculum and asset review | Golden grounding and publication gates pass |
| 3 | P1 | Stateful simulation and synthetic workflow actions | Required action/compliance/disposition tests pass |
| 4 | P1/P2 | Server-authoritative learning, certification, and analytics | Coverage, recertification, and integrity tests pass |
| 5 | P2 | Standard Meds content pack, resumability, QA, and release hardening | Full acceptance matrix and application checks pass |

P3 voice is not part of this implementation.

## 4. Phase 0 — Protected baseline

### Tasks

- Create the workspace-contained copy and inspect that source, PDFs, Upgrade Docs, package files, and local configuration are present.
- Do not display local secret values. Report only whether required configuration files exist.
- Run `npm ci` in the fork.
- Record `npm run typecheck`, `npm run lint`, `npm run test:unit`, and `npm run build`.
- Run `npm run verify:ollama`; preserve the known non-chat model error as a finding rather than hiding it.
- Run Firestore rules and Playwright tests when their local services/fixtures can be started safely; otherwise record the exact unrun reason.
- Initialize Git, create the baseline commit, then create the feature branch.

### Acceptance

- Fork builds independently after dependency installation.
- Original path has no Git mutations or file edits.
- Baseline commit contains no generated dependencies, build output, logs, or accidentally committed secret material.
- Known baseline failures are documented exactly.

## 5. Phase 1 — P0 local runtime and truthful evidence

### Implementation tasks

1. Add provider-neutral local runtime profiles and per-capability configuration.
2. Add one generic OpenAI-compatible local HTTP adapter for the existing MLX server, using native `fetch` and the existing `LLMGateway` contract.
3. Do not add an MLX SDK, Python sidecar, direct model loading, or MLX-specific application logic.
4. Add generic local capability preflight for chat, streaming, structured output, realistic heavy generation, judge evidence, timeout, and concurrency. Retain Ollama-specific diagnostics as an optional profile check.
5. Validate the existing MLX endpoint/model first. If it passes, use it without spending MVP effort repairing Ollama. If it fails, validate Ollama or keep manual chat available.
6. Confine provider conditionals to the gateway factory, adapter, profile/preflight, and runtime metadata.
7. Update `AiRuntimePill` and health UI to distinguish local, manual, replay, degraded, and blocked states.
8. Add `replay` provenance and exclude replay from assessment eligibility and readiness analytics.
9. Add safe runtime error messages and preserve drafts/sessions after failure.
10. Add provider/model/prompt/schema/source provenance to generated and evaluated artifacts using generic `local_ai` provenance.
11. Create the manual chat package schema and initial export/import path for curriculum generation; expand to permitted judge tasks in Phase 5.
12. Add baseline sensitive-data constraints for synthetic fixtures and logs.

### Main code areas

- new `src/lib/ai/openai-compatible-provider.ts`
- `src/lib/ai/ollama-provider.ts` for the optional existing profile
- `src/lib/ai/gateway.ts`
- `src/lib/ai/replay-provider.ts`
- `src/lib/ai/types.ts`
- new `scripts/verify-local-ai.ts` plus `scripts/verify-ollama.ts` for specific diagnostics
- `src/app/api/system/ai-health/route.ts`
- `src/components/layout/AiRuntimePill.tsx`
- generation and simulation provenance schemas/routes
- new local-runtime and manual-exchange modules

### Tests and acceptance

- Installed-but-non-chat model produces a clear blocked state.
- A validated chat profile passes actual streaming and nested structured-output tests.
- No hidden hosted-provider fallback exists.
- Replay is labeled `Demo replay` everywhere relevant and cannot certify.
- Manual malformed imports write nothing; valid imports retain provenance.
- Runtime failures do not create fake turns, scores, or confirmations.
- Unit, integration, typecheck, lint, and build checks pass.

Commit only after these gates pass.

## 6. Phase 2 — P1 source of truth and curriculum quality

### Implementation tasks

1. Add source-bundle, document-revision, rule-pack, claim-evidence, operational-asset, and conflict schemas.
2. Extend upload/generation to select inherited documents and shared rule packs.
3. Preserve raw/normalized page text, extraction flags, content hashes, and approved transcriptions.
4. Add exact excerpt matching and claim support states.
5. Replace citation-frequency-only budgeting with critical-input requirements and omission reporting.
6. Create offer, link, disposition, and workflow registries with context/effective-date scope.
7. Add precedence and SME conflict resolution.
8. Build Studio source review, side-by-side evidence, conflict handling, and publication gates.
9. Version generated content by source, prompt, schema, and model profile.
10. Add Standard Meds golden grounding fixtures and repair demo citation drift in the fork’s demo data.

### Main code areas

- `src/lib/ai/pdf-extractor.ts`
- `src/lib/ai/pipeline/generate-track.ts`
- `src/lib/ai/pipeline/shared.ts`
- `src/lib/ai/pipeline/structured-output.ts`
- `src/lib/ai/prompts/`
- `src/lib/schemas/curriculum.ts`
- `src/components/studio/validation.ts`
- Studio upload, editor, publish, and new source-review components
- track upload/generate/publish/regenerate routes
- `demo-replay/demo.json`

### Tests and acceptance

- Later playbooks inherit shared critical rules.
- Wrong-page citation fails even when the page number exists.
- Image-caption-only evidence cannot approve detailed screen actions.
- Critical omitted source input fails closed.
- Context-specific offers cannot leak across recovery/support branches.
- Unresolved critical conflicts block affected publication only.
- Trainer approval is required for critical rules and operational assets.
- Golden SM-01 through SM-08 grounding cases pass.

Commit only after these gates pass.

## 7. Phase 3 — P1 call and workflow simulation

### Implementation tasks

1. Define scenario context, state machine, event log, action catalog, and assessment-eligibility schemas.
2. Move scenario state and transitions to server-authoritative services.
3. Add pre-call inspection, minimum evidence, wrap-up, and canonical disposition validation.
4. Build the integrated synthetic ReFlow/Dosable/portal panel and fake SMS/Slack outboxes.
5. Add recording and fake secure-payment workflows with redaction and designated fake tokens.
6. Implement deterministic compliance gates and stable rule/evidence references.
7. Constrain actor input/output so it cannot change operational state.
8. Constrain judge output to evidence-based coaching that cannot reverse hard gates.
9. Add Studio scenario QA, scripted test mode, and event-log playback.
10. Implement the required Standard Meds scenario matrix and golden pass/fail paths from document 06.

### Main code areas

- `src/lib/services/simulation-engine.ts`
- `src/lib/services/sim-end-filter.ts`
- `src/lib/services/scoring.ts`
- simulation start/message/evaluate routes
- `src/lib/ai/prompts/sim-actor.ts`
- `src/lib/ai/prompts/sim-judge.ts`
- `src/components/simulation/`
- `src/app/(dashboard)/learn/_components/SimulationRunner.tsx`
- `src/components/studio/editor/ScenarioEditor.tsx`
- new synthetic operations components/services and scenario fixtures

### Tests and acceptance

- Browser cannot directly set confirmation, offer count, or disposition outcome.
- Required pre-call inspections and minimum evidence are enforced.
- SMS, Slack, payment, notes, and subscription actions never call live systems.
- Correct-link, local-time, opt-out, privacy, clinical, payment, and confirmation gates pass golden tests.
- `Recovered` cannot be selected successfully without required evidence.
- AI actor/judge outages preserve the session and cannot fabricate success.
- Every required scenario has a scripted pass and applicable critical-fail case.
- UI states the limits of text-only assessment.

Commit only after these gates pass.

## 8. Phase 4 — P1/P2 learning, certification, and analytics

### Implementation tasks

1. Add server-authoritative drill answer/attempt APIs and records.
2. Remove trust in browser-provided `passedFirstTry` and similar analytical fields.
3. Implement immediate recovery, varied retrieval, and spaced-review schedules.
4. Map knowledge items and scenarios to stable required rule IDs.
5. Add versioned assessment blueprints and required scenario coverage.
6. Implement certification grant, revocation, expiry, and recertification reconciliation.
7. Split analytics into completion, initial knowledge, mastery, retention, coverage, workflow, compliance, recency, and evidence confidence.
8. Default to current-version, eligible evidence; label historical and exclude replay.
9. Add learner remediation and trainer evidence/QA views.
10. Migrate legacy progress to `historical_unverified` where it lacks required evidence.

### Main code areas

- `src/app/api/progress/complete-unit/route.ts`
- new attempt/review/certification routes and services
- `src/components/learn/DrillRunner.tsx`
- drill feedback/recovery components
- `src/lib/schemas/domain.ts`
- `src/lib/schemas/analytics.ts`
- `src/lib/services/analytics-rollup.ts`
- learner track/progress views
- `src/components/analytics/`
- Firestore rules and indexes

### Tests and acceptance

- Client cannot forge first-try status, score, coverage, or certification.
- Answer submission and unit completion are idempotent.
- Immediate retries are not counted as independent retention.
- One easy scenario cannot certify a track.
- Missing required evidence remains `not_observed` and blocks certification.
- Critical source changes trigger recertification while preserving history.
- Replay and unverified legacy evidence do not count.
- Metrics can be opened and traced to source events.

Commit only after these gates pass.

## 9. Phase 5 — P2 content, reliability, and release hardening

### Implementation tasks

1. Complete source bundles and structured content for all nine PDFs.
2. Obtain/record SME decisions for document 06 conflicts; leave affected items blocked if Connor has not supplied decisions.
3. Add stage checkpoints, resume, caching, timeout, budget reporting, and local concurrency control across all generation stages.
4. Complete manual chat export/import for permitted generation and trainer-only judge tasks.
5. Add golden curriculum, actor, judge, workflow, and certification regression suites.
6. Add trainer bulk QA filters for unsupported evidence, conflicts, high learner failure, and model disagreement.
7. Verify accessibility and responsive behavior of new Studio, learning, and simulation panels.
8. Verify Firestore rules, authorization, redaction, and no-secret/no-real-data controls.
9. Update operator documentation with local profile setup, manual exchange, content refresh, and rollback.
10. Run the complete release gate and record exact results and remaining limitations.

### Acceptance

- No required content remains a stub or untracked TODO.
- No unresolved SME decision is silently guessed.
- A failed multi-stage generation resumes from the last valid checkpoint.
- Manual and active local-provider paths produce equivalent validation and provenance behavior.
- Full Standard Meds golden matrix passes.
- All applicable automated checks and end-to-end workflows pass.
- Release notes state that supervised live-call assessment may still be required.

Create the final implementation commit after these gates pass.

## 10. Data model and migration requirements

Use the existing Firestore conventions and security model. Exact collection names may follow current code, but the following record classes are required:

- source bundles, source documents/revisions, and page evidence;
- shared rule packs and stable rules;
- claims and source-support results;
- offer/link/disposition/workflow assets;
- source conflicts and SME decisions;
- curriculum versions and assessment blueprints;
- local runtime profiles and generation runs/checkpoints;
- manual prompt packages and import provenance;
- synthetic scenario definitions and scenario sessions;
- append-only simulation events and gate results;
- drill attempts and spaced-review schedules;
- scenario coverage and certification history;
- analytics projections with source/curriculum/provenance versions.

Migration principles:

- Additive schemas first; use explicit schema versions.
- Never overwrite published historical evidence.
- Backfill source/curriculum version as `legacy_unknown` when absent.
- Mark old progress/certification `historical_unverified` unless it can satisfy new evidence requirements.
- Keep old UI readable during migration or provide a controlled one-time migration.
- Add composite indexes only for verified queries.
- Emulator tests must verify learner/trainer/supervisor/admin access and denial paths.
- Seed data must be entirely synthetic and visibly labeled.

## 11. Test strategy

### Static and unit

Run after every phase:

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

Add focused tests for schemas, source evidence, arithmetic, state transitions, attempts, gates, analytics, and migrations.

### Integration

- Generic OpenAI-compatible local preflight with mocked SSE/HTTP behavior and the real MLX endpoint where available; Ollama diagnostics only for that optional profile.
- Manual import validation and atomic writes.
- Generation checkpoint/resume and concurrency.
- Simulation action/event/gate integration.
- Drill answer idempotency and certification reconciliation.
- Firestore emulator rules for every new record type and role.

### End-to-end

At minimum:

1. trainer creates a multi-document Standard Meds bundle;
2. trainer resolves evidence and publishes approved content;
3. learner completes knowledge and varied retrieval;
4. learner performs a passing outbound workflow;
5. learner receives a critical fail for an unsafe branch;
6. learner completes support, Medical Chat, and Renewals action scenarios;
7. required coverage produces certification; missing coverage does not;
8. source revision triggers targeted recertification;
9. replay demonstrates UI but grants no readiness credit;
10. generation fails and resumes without losing prior checkpoints.

Run Playwright against local services with synthetic fixtures. Do not depend on external network services.

## 12. Security and privacy release gates

- No real patient/customer data or live external credentials in source, fixtures, logs, exports, or prompts.
- No real card data accepted; only designated fake payment tokens.
- No live SMS, Slack, Dosable, ReFlow, portal, dialer, or payment requests.
- Sensitive-pattern redaction tested in notes, escalation, AI prompts, analytics, and logs.
- Hidden rubrics and correct answers are not exposed to learners prematurely.
- Role-based access is enforced on the server, not only hidden in the UI.
- Local config is preserved but never printed or copied into new documents.
- Replay and manual provenance cannot be forged as live local assessed evidence through client fields.

## 13. Rollout

1. Keep the original directory unchanged as the fallback.
2. Use a separate Firebase project/emulator and separate local storage for upgrade validation; do not migrate production-like data by default.
3. Start with one trainer and synthetic Standard Meds tracks.
4. Review generated grounding and scenario gates before any learner pilot.
5. Pilot with a small internal cohort after all P0/P1 gates pass.
6. Compare trainer judgments with event/gate/judge results and tune only with versioned fixtures.
7. Roll out P2 analytics after legacy/replay labeling is understood.
8. Require supervised live-call assessment until the company separately approves a broader readiness policy.

## 14. Rollback

### Code rollback

- Return to the original untouched directory, or
- in the fork, return to the baseline commit for a full pre-upgrade copy, or
- revert a specific phase commit after preserving required evidence.

Do not reset or rewrite the original repository. Do not delete the fork until Connor confirms the result.

### Data rollback

- Do not run the upgrade against the existing live/internal Firebase data during initial implementation.
- If later deployed, back up data and use additive migrations with legacy fields preserved.
- Disable new publication/certification writes before rollback.
- Keep historical new evidence in a separate namespace or export it safely before reverting application code.
- Never restore real sensitive training content into source control or prompt logs.

## 15. Overall definition of done

The upgrade is complete only when:

- [ ] Work occurred exclusively in the workspace-contained fork after its creation.
- [ ] A baseline commit and phase commits exist in the fork.
- [ ] At least one local provider—preferably the existing MLX endpoint through the generic adapter—passes capability preflight, and manual chat works without a hosted API.
- [ ] The original Ollama non-chat issue is detected when that profile is tested, but repairing Ollama is not required when MLX passes.
- [ ] Provider-specific code is confined to the adapter/gateway/profile boundary, and historical records remain usable after that adapter is removed.
- [ ] All Standard Meds tracks use grounded multi-document source bundles.
- [ ] Critical claims and operational assets are trainer-approved.
- [ ] Required inbound/outbound scenarios produce dialogue and workflow evidence.
- [ ] Deterministic safety gates and canonical dispositions are enforced.
- [ ] Server-authoritative learning and required coverage control certification.
- [ ] Recertification, provenance, retention, and honest analytics are implemented.
- [ ] Replay cannot grant readiness or certification.
- [ ] All external-system behavior and records are synthetic.
- [ ] Static, unit, integration, rules, and end-to-end checks have exact recorded results.
- [ ] Remaining limitations and any unrun checks are disclosed.
- [ ] No P3 voice feature is used to disguise remaining text-simulation limits.

A plan, partial UI, schemas without behavior, or passing typecheck alone does not satisfy this definition.
