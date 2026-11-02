# 07 — Master ASD-STE100 Prompt for Claude Projects / Claude Opus 5.5 Swarm

## Quick Setup for Claude Projects
1. Create a new **Claude Project** (select **Claude Opus 5.5**).
2. Upload the following **7 files** into **Project Knowledge** (or point Claude Code / MCP directly at `/Users/connor/Coding/Contracting/Logicall/Telehealth LMS`):
   * `docs/01_PRODUCT_AND_DOMAIN_SPEC.md`
   * `docs/02_SYSTEM_ARCHITECTURE_AND_COST_MODEL.md`
   * `docs/03_DATA_MODEL_AND_SECURITY_SPEC.md`
   * `docs/04_AI_GATEWAY_AND_PDF_PIPELINE_SPEC.md`
   * `docs/05_LEARNING_ENGINE_AND_UI_DESIGN_SPEC.md`
   * `docs/06_API_CONTRACTS_AUTH_AND_DEPLOYMENT.md`
   * `firestore.rules`
3. Paste the ASD-STE100 specification block below as the Project Instructions or initial execution prompt.

---

````markdown
# ASD-STE100 EXECUTION SPECIFICATION: BUILD "LOGICALL PULSE"

## 1. PURPOSE AND EXECUTION MODE

Build the complete **LogiCall Pulse** web application from the specification files.
Do NOT ask clarification questions when the specification files define the behavior.
Do NOT output `TODO` placeholders, stub functions, or partial files.
Write complete, production-ready TypeScript code for every file.

Execution mode rules:
1. If multi-agent swarm tools are available, act as `LEAD` and spawn `AGENT-1` through `AGENT-5` in parallel during `PHASE 1`.
2. If multi-agent swarm tools are NOT available, execute `PHASE 0`, `PHASE 1` (`AGENT-1` to `AGENT-5`), and `PHASE 2` (`AGENT-6`) sequentially without stopping.

---

## 2. APPROVED ASD-STE100 TECHNICAL DICTIONARY

Use ONLY the approved terms in Table 1 across code, UI text, comments, and tests.
Do NOT use any prohibited synonym.

### Table 1: Approved Nouns

| Approved Term | Definition | Prohibited Synonyms |
| :--- | :--- | :--- |
| `Playbook` | An uploaded source PDF document. | manual, policy file, handout |
| `Track` | A campaign training curriculum generated from one `Playbook`. | course, journey, pathway, program |
| `TrackVersion` | An immutable bundle of `Unit` items and `Simulation` items. | release, snapshot, edition |
| `Unit` | One sequential checkpoint inside a `TrackVersion`. | lesson, chapter, module, level |
| `BriefingCard` | One micro-learning card inside a `Unit`. | slide, flashcard, study card |
| `Drill` | One interactive test item inside a `Unit`. | quiz, question, exercise |
| `Simulation` | A multi-turn text roleplay exam at the end of a `Track`. | boss fight, dialogue test, chat exam |
| `Cohort` | An internal group or BPO partner group (`INTERNAL`, `THS`, `NGA`, `DOZ`, `ZIM`, `MRR`, `CALL_CORE`, `LATAM_DIRECT`). | tenant, vendor, squad, organization |
| `Division` | One operational line: `TELEHEALTH`, `INBOUND`, or `OUTBOUND`. | department, vertical, org unit |
| `CompetencyPillar` | One of 8 canonical skill categories used for strength calculation. | topic, tag, dimension |
| `LLMGateway` | The backend interface that routes AI calls to `OllamaProvider` or `GeminiProvider`. | AI chain, model client, wrapper |

---

## 3. AUTHORITATIVE SPECIFICATION FILES

Read all 7 specification files before you write code:

1. `docs/01_PRODUCT_AND_DOMAIN_SPEC.md`
2. `docs/02_SYSTEM_ARCHITECTURE_AND_COST_MODEL.md`
3. `docs/03_DATA_MODEL_AND_SECURITY_SPEC.md`
4. `docs/04_AI_GATEWAY_AND_PDF_PIPELINE_SPEC.md`
5. `docs/05_LEARNING_ENGINE_AND_UI_DESIGN_SPEC.md`
6. `docs/06_API_CONTRACTS_AUTH_AND_DEPLOYMENT.md`
7. `firestore.rules`

---

## 4. MANDATORY ARCHITECTURAL INVARIANTS

1. Target workspace path `/Users/connor/Coding/Contracting/Logicall/Telehealth LMS`.
2. Use English-only text across all UI labels, AI prompts, schemas, and seed data.
3. Preserve `firestore.rules` without modification.
4. Set Iteration 1 defaults in `.env.local`:
   - `AI_PROVIDER=ollama`
   - `OLLAMA_BASE_URL=http://127.0.0.1:11434`
   - `OLLAMA_HEAVY_MODEL=clef:27b-mxfp8`
   - `OLLAMA_FAST_MODEL=clef-flash:9b-mxfp8`
   - `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true`
5. Support Iteration 2 cutover through environment variables ONLY (`AI_PROVIDER=gemini`, `GEMINI_HEAVY_MODEL=gemini-2.5-flash`, `GEMINI_FAST_MODEL=gemini-2.5-flash-lite`, `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=false`).
6. Store all `Unit`, `BriefingCard`, and `Drill` data for one `TrackVersion` inside ONE Firestore document (`tracks/{trackId}/versions/{versionId}`).
7. Do NOT create Firestore subcollections for individual cards, `Drill` items, or chat messages.
8. Store secret `Simulation` facts, triggers, and rubrics ONLY in `tracks/{trackId}/versions/{versionId}/secrets/evalRubrics`.
9. Never send `secrets/evalRubrics` to client browsers for `AGENT` or `PARTNER_SUPERVISOR` roles.
10. Route `/` directly to `/login` when unauthenticated, or to the role home dashboard when authenticated.
11. Apply the `"Slate & Signal"` CSS tokens (`--pulse-*`) from `docs/05_LEARNING_ENGINE_AND_UI_DESIGN_SPEC.md`.
12. Do NOT build public marketing pages, pricing pages, lead forms, or `localStorage` branding scripts.

---

## 5. SWARM FILE OWNERSHIP MATRIX

Assign each file path to ONE agent only. Do NOT allow two agents to edit the same file.

### Table 2: Exclusive Agent File Ownership

| Agent ID | Responsibility | Owned Paths |
| :--- | :--- | :--- |
| `LEAD` | Project config, CSS tokens, and frozen Zod/AI contracts | `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `firebase.json`, `firestore.indexes.json`, `storage.rules`, `apphosting.yaml`, `.env.example`, `.env.local`, `src/app/globals.css`, `src/app/layout.tsx`, `src/lib/schemas/**`, `src/lib/ai/types.ts` |
| `AGENT-1` | Auth, Firebase SDKs, RBAC, and Roster | `src/lib/firebase/**`, `src/middleware.ts`, `src/app/api/auth/**`, `src/app/api/roster/**`, `src/app/(auth)/**`, `src/app/(dashboard)/roster/**`, `scripts/seed-demo.ts` |
| `AGENT-2` | `LLMGateway`, PDF parser, and `Track` build pipeline | `src/lib/ai/gateway.ts`, `src/lib/ai/ollama-provider.ts`, `src/lib/ai/gemini-provider.ts`, `src/lib/ai/pdf-extractor.ts`, `src/lib/ai/prompts/blueprint.ts`, `src/lib/ai/prompts/unit-builder.ts`, `src/lib/ai/prompts/sim-builder.ts`, `src/app/api/tracks/**`, `src/app/api/system/ai-health/route.ts`, `scripts/verify-ollama.ts` |
| `AGENT-3` | `Simulation` engine, scoring math, and Firestore rollups | `src/lib/services/**`, `src/lib/ai/prompts/sim-actor.ts`, `src/lib/ai/prompts/sim-judge.ts`, `src/app/api/progress/**`, `src/app/api/simulations/**` |
| `AGENT-4` | App shell, `Track` Studio UI, and Analytics UI | `src/components/layout/**`, `src/components/studio/**`, `src/components/analytics/**`, `src/app/(dashboard)/layout.tsx`, `src/app/(dashboard)/page.tsx`, `src/app/(dashboard)/studio/**`, `src/app/(dashboard)/analytics/**` |
| `AGENT-5` | Learner `CheckpointMap`, `Drill` runner, and `Simulation` UI | `src/components/learn/**`, `src/components/simulation/**`, `src/app/(dashboard)/learn/**` |
| `AGENT-6` | Unit tests, Emulator RBAC tests, and build verification | `vitest.config.ts`, `playwright.config.ts`, `tests/**` |

---

## 6. PHASED EXECUTION PROCEDURES

### PHASE 0: FOUNDATION LOCK (`LEAD` — COMPLETE BEFORE `PHASE 1`)

1. Create `package.json` with the dependencies listed in Table 3.
2. Add npm scripts: `dev`, `build`, `start`, `typecheck`, `lint`, `test:unit`, `emulators`, `seed:local`, and `verify:ollama`.
3. Run `npm install`.
4. Create `tsconfig.json` with `"strict": true` and path alias `"@/*": ["./src/*"]`.
5. Create `firebase.json`, `firestore.indexes.json`, `storage.rules`, `apphosting.yaml`, `.env.example`, and `.env.local` per `docs/03` and `docs/06`.
6. Create `src/app/globals.css` and `src/app/layout.tsx` with the `--pulse-*` CSS tokens from `docs/05`.
7. Create and freeze `src/lib/schemas/domain.ts`, `src/lib/schemas/curriculum.ts`, and `src/lib/schemas/analytics.ts` per `docs/03`.
8. Create and freeze `src/lib/ai/types.ts` per `docs/04`.
9. Run `npm run typecheck`. Fix every TypeScript error before starting `PHASE 1`.

#### Table 3: Required NPM Packages

| Package Group | Packages |
| :--- | :--- |
| Runtime | `next@^15`, `react@^19`, `react-dom@^19`, `firebase@^11`, `firebase-admin@^13`, `@google/genai`, `zod`, `zod-to-json-schema`, `unpdf`, `lucide-react`, `clsx`, `tailwind-merge` |
| Development | `typescript@^5`, `@types/node`, `@types/react`, `@types/react-dom`, `tailwindcss@^4`, `@tailwindcss/postcss`, `vitest`, `@playwright/test`, `tsx`, `eslint`, `eslint-config-next` |

---

### PHASE 1: PARALLEL WORKSTREAMS (`AGENT-1` THROUGH `AGENT-5`)

#### `AGENT-1`: AUTHENTICATION, FIREBASE & ROSTER
1. Create `src/lib/firebase/client.ts`. Connect to local Auth, Firestore, and Storage emulators when `NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true'`.
2. Create `src/lib/firebase/admin.ts` as a singleton `firebase-admin` initializer that honors emulator host environment variables.
3. Create `src/lib/firebase/auth-guard.ts`:
   - Read HTTP-only cookie `__session`.
   - Verify the session cookie with `adminAuth.verifySessionCookie`.
   - Reject requests where `claims.active !== true` with HTTP `403`.
   - Enforce allowed `UserRole` lists and `partnerCohortId` boundaries.
4. Map any login identifier that matches `/^LC-\d+$/i` to `<lowercase-id>@roster.logicall.internal`.
5. Implement `POST /api/auth/session`, `DELETE /api/auth/session`, and `POST /api/auth/claim-invite` per `docs/06`.
6. Implement `POST /api/roster/import` for bulk user creation and `PATCH /api/roster/[uid]/status` for instant deactivation.
7. Ensure deactivation sets `active: false`, disables Firebase Auth sign-in, revokes refresh tokens, and preserves all historical data.
8. Build `/login`, `/join/[code]`, and `/roster` pages with native HTML `<dialog>` modals.
9. Create `scripts/seed-demo.ts` to seed all 8 `Cohort` records, demo users across all 5 roles, and 1 complete published `Track`.

#### `AGENT-2`: AI GATEWAY & PDF PIPELINE
1. Create `src/lib/ai/ollama-provider.ts`:
   - Send requests to `${OLLAMA_BASE_URL}/api/chat`.
   - Convert Zod schemas to JSON Schema via `zodToJsonSchema`.
   - Pass `format: jsonSchema` for `generateStructured`.
   - Retry up to 2 times with Zod validation error feedback if local model JSON validation fails.
   - Parse NDJSON chunks and yield tokens for `streamChat`.
2. Create `src/lib/ai/gemini-provider.ts` using `@google/genai` with `responseMimeType: 'application/json'`, `responseJsonSchema`, and `generateContentStream`.
3. Create `src/lib/ai/gateway.ts` to select `OllamaProvider` or `GeminiProvider` from `process.env.AI_PROVIDER`.
4. Implement `GET /api/system/ai-health` and `scripts/verify-ollama.ts`.
5. Create `src/lib/ai/pdf-extractor.ts` with `unpdf`:
   - Reject files larger than `20 MB` or longer than `80` pages.
   - Reject PDFs with fewer than `150` extracted characters as unreadable image scans.
   - Format each page header as `=== SOURCE PAGE N ===`.
6. Create prompts in `blueprint.ts`, `unit-builder.ts`, and `sim-builder.ts` per `docs/04`:
   - Ground every rule strictly in the provided `SOURCE PAGE` text.
   - Map every `CompetencyPillar` to one of the 8 canonical skill keys in `docs/04`.
   - Require at least 4 distinct `Drill` kinds in every `Unit`.
7. Implement `POST /api/tracks/upload`, `GET /api/tracks/[trackId]/generate` (SSE progress stream), `PATCH /api/tracks/[trackId]`, `POST /api/tracks/[trackId]/regenerate-item`, and `POST /api/tracks/[trackId]/publish`.
8. In `POST /api/tracks/[trackId]/publish`, write secret rubrics ONLY to `tracks/{trackId}/versions/{versionId}/secrets/evalRubrics`.

#### `AGENT-3`: SIMULATION ENGINE, SCORING & ROLLUPS
1. Create `src/lib/services/scoring.ts`:
   - Calculate `Unit` XP, daily streaks, and `firstTryAccuracyPct`.
   - Calculate weighted `Simulation` scores (`S_raw = sum(w_i * s_i) / 100`).
   - Subtract `10` points when `selectedDisposition !== expectedDisposition` (minimum `0`).
   - Force `passed = false` and cap score at `59` when an `autoFailTrigger` occurs.
2. Create `src/lib/services/analytics-rollup.ts`:
   - Update `users/{uid}`, `enrollments/{uid}_{trackId}`, and `analyticsRollups/{rollupId}` (`GLOBAL`, `DIVISION_*`, `COHORT_*`, `TRACK_*`) inside one atomic Firestore batch/transaction.
3. Create `src/lib/ai/prompts/sim-actor.ts` and `src/lib/ai/prompts/sim-judge.ts` per `docs/04`.
4. Strip `<SIM_END>` from streamed Actor replies and flag `simEnded: true` in the SSE `done` event.
5. Implement `POST /api/progress/complete-unit`.
6. Implement `POST /api/simulations/start`, `POST /api/simulations/[sessionId]/message` (SSE token stream on `fast` tier), and `POST /api/simulations/[sessionId]/evaluate` (`heavy` tier Judge).

#### `AGENT-4`: SHELL, TRACK STUDIO & ANALYTICS UI
1. Build the role-aware dashboard shell (`src/components/layout/**`, `src/app/(dashboard)/layout.tsx`). Display the user `Cohort`, role badge, and active AI runtime indicator.
2. Build the role-routed dashboard home (`src/app/(dashboard)/page.tsx`) for `AGENT`, `PARTNER_SUPERVISOR`, `TRAINER`, and `ADMIN`.
3. Build `/studio/new` with only 3 required inputs (`Division` selector, `Track` title, and drag-and-drop `Playbook` PDF upload) plus the live SSE build progress stepper.
4. Build `/studio/[trackId]` with Play/Edit mode toggle, plain-English inline form editing, 1-click item regeneration, and `<dialog>` `Cohort` publish assignment.
5. Build `/analytics` and `/analytics/agents/[uid]` per `docs/05`:
   - `Cohort × CompetencyPillar` Strength Heatmap.
   - `Agent × Track` Certification Matrix with 1-click CSV export.
   - `Playbook Gap Detector` table ranking most-missed items.
   - Agent Readiness Passport with an SVG 6-axis Skill Radar and expandable `Simulation` transcripts.

#### `AGENT-5`: GAMIFIED LEARNING & SIMULATION UI
1. Build `/learn/[trackId]` (`CheckpointMap`) showing sequential `Unit` unlock state, accuracy badges, and the capstone `Simulation` node.
2. Build `/learn/[trackId]/unit/[unitId]`:
   - Render `BriefingDeck` with keyboard navigation, `DO` / `DON'T` lists, key takeaway banner, and source page badge.
   - Render `DrillRunner` supporting all 5 `Drill` kinds: `MULTIPLE_CHOICE`, `TRUE_FALSE_SPOT`, `SEQUENCE_ORDER`, `MATCH_PAIRS`, and `FILL_BLANK_CHOICE`.
   - Show an immediate grounded explanation drawer after each answer.
   - Re-queue every missed `Drill` at the end of the `Unit` until the user clears 100% of missed items, while submitting true `firstTryAccuracyPct` to `/api/progress/complete-unit`.
3. Build `/learn/[trackId]/sim/[scenarioId]`:
   - Render `CallTicketHeader` with campaign context and turn counter.
   - Stream counterparty messages in real time inside `TranscriptChat`.
   - Open `<dialog>` `DispositionPicker` when `simEnded` triggers or when the user clicks `End & Disposition Call`.
   - Render `ScorecardView` with circular score gauge, Pass/Retry status, per-criterion quotes, and `"Better Response Example"` coaching cards.

---

### PHASE 2: VERIFICATION GATE (`AGENT-6` AND `LEAD`)

1. Create `vitest.config.ts` and unit tests under `tests/unit/`:
   - Test all Zod schemas in `domain.ts`, `curriculum.ts`, and `analytics.ts`.
   - Test `scoring.ts` formulas, disposition penalties, and auto-fail score caps.
   - Test `OllamaProvider` JSON schema request formatting and 2-retry self-repair using mocked `fetch`.
   - Test `pdf-extractor.ts` page boundary formatting and scan rejection.
2. Create `tests/integration/firestore-rules.test.ts` to verify:
   - Inactive users (`active: false`) cannot read any document.
   - `AGENT` users cannot read `secrets/evalRubrics` or write `enrollments`.
   - `PARTNER_SUPERVISOR` for `THS` cannot read `DOZ` users, enrollments, or rollups.
3. Run the verification commands in order:
   - `npm run typecheck`
   - `npm run lint`
   - `npm run test:unit`
   - `npm run build`
4. Fix all errors until every command in Step 3 exits with code `0`.
5. Output a concise completion report listing created routes, test results, and the exact command to launch local Iteration 1 (`npm run emulators`, `npm run seed:local`, `npm run dev`).
````
