# Review and fix status (2026-11-04)

The work is not committed. It sits uncommitted in this folder, mixed in with Connor's earlier uncommitted work.

## Environment findings
- Ollama: the only installed models, `clef:27b-mxfp8` and `clef-flash:9b-mxfp8`, cannot chat (their capabilities are decision and vision). With the current `.env.local` (`AI_PROVIDER=ollama`), every LLM feature fails. To fix this, pull a chat model (for example `ollama pull qwen2.5:7b-instruct`, then set `OLLAMA_HEAVY_MODEL` and `OLLAMA_FAST_MODEL`), or use MLX (`npm run dev:mlx`).
- MLX (Qwen2.5-7B-Instruct-4bit, port 8081): `npm run verify:local-ai:mlx` passes all 8 checks.
- Live Track build on MLX before the fixes, using the 13-page NeuroCalmRx PDF: the build failed at the Blueprint stage ("could not produce valid TrackBlueprint content after 3 attempts").
- `mlx-runtime/start.sh` now defaults to `MLX_MAX_TOKENS=8192`. Restart MLX to pick this up, because the old server used 2048.

## Fix status by area

| Area | Status |
|---|---|
| Provider layer | DONE |
| Publication gates and app bugs | DONE |
| Track generation pipeline | MOSTLY DONE. Not yet proven with a full live 7B build. See "Pipeline remaining" below. |
| Simulation | DONE (all 15 fixes; unit-tested, not yet checked in a browser). See the section below. |

Provider layer (DONE):
- Ollama now checks chat capability through `/api/show` and gives a clear "cannot chat" error.
- Ollama gets a signal, `num_predict` and a timeout. Gemini gets `abortSignal` and `maxOutputTokens`.
- JSON extraction handles trailing prose and think blocks.
- Truncation now raises `LLMOutputTruncatedError` instead of going through repair.
- Structured output defaults to `max_tokens` 8192.
- The ai-health check is a cheap cached check, with the full preflight at `?full=1`.
- The OpenAI-compatible default URL is now 8081, not 8080.
- The concurrency check is now real.
- Hints are provider-specific.
- An unknown `AI_PROVIDER` or `manual_chat` throws `AIUnavailableError`.
- New file: `src/lib/ai/availability.ts`.

Publication gates and app bugs (DONE):
- Rules covered by Sim rubrics now count toward rule coverage.
- Unselected rule packs are ignored.
- Every disposition option must be canonical.
- Fixed the open redirect in login `next`.
- Email or LC password accounts need an invite.
- Drill replay now shows feedback, and draft retry works.
- The theme cookie is restored from the user's saved preference.
- Fixed `/progress` enrollment loading and the "Not assigned" status.

Track generation pipeline (in progress when the session stopped), targets:
- Explicit `maxOutputTokens` per stage
- Smaller Unit and Blueprint calls
- Critical pages limited to the selected pages
- Lenient evidence: fuzzy-match excerpts and fill ids on the server
- A stage timeout that accounts for retries
- Model-facing schemas without `.max`
- Real failure reasons shown in the UI
- Content map shown on reload
- Draft kept on re-upload
- Regenerate-item evidence and transaction fixes
- Stepper "N of M"
- Replay unit selection

Simulation (DONE). Pipeline TODO it left: in `generate-track.ts`, pass `maxOutputTokens: SIM_BUILDER_MAX_OUTPUT_TOKENS`, add `scenarioDefaults: { divisionId: track.divisionId, product: blueprint.campaignCode || track.title, sourceRevision: source?.sourceRevision }` to `simCtx`, and call `finalizeScenarios(raw, simCtx, track.divisionId)`. In `regenerate-item.ts`, pass `SIM_SINGLE_SCENARIO_MAX_OUTPUT_TOKENS` and the division. Daily-limit rule: sessions count if `turnCount > 0` or EVALUATED (`sim-session-limits.ts`). Manual-judge packages exported before this change must be re-exported. Fixes made:
- No customer state taken from the actor's free text
- `dispositionCorrect` fix
- Judge criterion ids validated and the judge schema made lenient
- Judge `maxOutputTokens` and signal
- Transcript no longer duplicated in the judge prompt
- Gemini provenance label
- More robust SIM_END filter
- Actor output cleanup
- Actor history budget
- Start returns AI_UNAVAILABLE, existing sessions are reused, and the daily limit counts only real sessions
- Judge failure leads to "a Trainer will score it"
- Double-send guard
- Canonical dispositions in the builder
- Sim error-code mismatch

The final reports from these two areas are in the thread. Run `git diff --stat` to see the touched files.

## Final check at stop
`npm run typecheck`, `npm run lint` and `npm run test:unit` (53 files, 583 tests) all pass.

## Pipeline remaining
Done:
- Per-stage `maxOutputTokens`
- Split Unit stage: one cards call, then drill batches of 3 on local providers
- Smaller limits for local providers (cards 2-5, drills 4-6)
- Source budget fixes
- PAGE-label evidence, with fuzzy matching on the server and a fallback that marks items for trainer review
- Stage timeout that scales with attempts (`GENERATION_STAGE_TIMEOUT_MS` / `GENERATION_ATTEMPT_TIMEOUT_MS`)
- Lenient model-facing schemas
- Real failure reasons shown to the user
- Regenerate-item transaction
- Replay unit selection
- Target clamp

Live result: on MLX 7B the Blueprint stage now passes (29-51 s). An earlier run failed at the Unit stage. The new split Unit stage has not run live yet. Scratch scripts were in the session scratchpad, which is temporary.

NOT STARTED:
- Content map on reload and on revised upload, plus clearing `unitTarget` (studio/new page, NewTrackForm, upload route).
- `upload/route.ts`: keep the old draft until commit, keep all pages on append, copy only the selected rule packs.
- GenerationStepper: show a "Built Checkpoint N of M" chip as done instead of active.
- Wire the Sim builder into `generate-track.ts`: pass `SIM_BUILDER_MAX_OUTPUT_TOKENS`, and pass `scenarioDefaults` and the division to `finalizeScenarios`. Do the same in `regenerate-item.ts` with `SIM_SINGLE_SCENARIO_MAX_OUTPUT_TOKENS`.
- `sim-builder.ts`: the 30,000-character source budget is too big for a 16k local context. Use `localSourceCharBudget`.
- Tests for the fuzzy matcher, the timeouts, the split Unit stage and the regenerate transaction.

## Open decisions for Connor
1. Certification policy: Sim attempts scored by Gemini (`hosted_ai`) can never certify, because `certification.ts` allows only local or verified sources. The code comments say this is deliberate. Confirm that this is wanted for production.
2. Choose the local AI path: pull an Ollama chat model, or standardize on MLX.

## Next steps
1. `npm run typecheck && npm run lint && npm run test:unit`
2. Restart MLX: `sh mlx-runtime/stop.sh`, then `sh mlx-runtime/start.sh`
3. Emulators (with Java on PATH), then `seed:local`, then `npm run dev:mlx`. Then rerun the live Track build and a Sim, as trainer@logicall.io and then LC-1042.
4. Finish any PARTIAL items from the pipeline and Sim reports.
5. Report only, not fixed: re-approving a transcription after a build changes `revisionHash`, which leaves the draft unpublishable. Fix: hash normalized text, and add a "rebind draft" action that re-verifies the excerpts.

## Overnight loop, 2026-11-05 (06:00 UTC onward)

### Done
- **Sim builder wiring:** generation now passes the Sim builder scenarioDefaults, the division and its max-token constants.
- **MLX restarted with 8192 max tokens.**
- **Studio:**
  - The Content map now shows on reload and after a revised upload, and a revised upload clears `unitTarget`.
  - A re-upload keeps the old draft until the new build commits.
  - Appending a document keeps the pages of every document.
  - Only the selected rule packs are copied.
  - The stepper's Checkpoint chips are correct.
- **Generation:**
  - Drills and cards are salvaged one by one: coerced, dropped if invalid, then topped up. Thin Units are blocked only at publish (`UNIT_CONTENT_INCOMPLETE` gate).
  - The Blueprint repairs small slips (unknown pillar key, bad page) instead of failing.
  - On local providers, Sims are written one scenario per call within the local source budget. Bad Sims and rubric evidence are salvaged or grounded, otherwise flagged for review.
  - Retry reuses the cached Checkpoints.
- **Live result:** the first full Track was built on Qwen2.5-7B MLX: Track `ZrPUNYIsrRF9w5ZMHFMc`, 9 Checkpoints and Sims, with 18 items flagged for trainer review.
- **Studio polish:**
  - Review notes and evidence flags are shown in the UI.
  - New "Add a Drill" action.
  - Thin Units appear as a gate issue.
  - Transcription hashes are normalized, and there is a new "Rebind draft to current approved revision" action.
  - New tests for the fuzzy matcher.
- **Seed:**
  - Demo Sims are runnable: canonical dispositions, context and evidence checklist, assessment blueprint, and a publish-gate self-check.
  - Learning evidence is now seeded with the app's own services, so home and Track pages agree.
  - Failed builds show as "Build failed", with Retry.
- **Sim:**
  - The judge accepts an array at the root (partly fixed; still being worked on).
  - Agents no longer get a 403 from the ai-health check.
  - A "Resume call" label appears after a reload.
  - The favicon was added.
  - An unhandled rejection in the availability cache was fixed.
- **Live checks passed:**
  - Agent Checkpoint, with all 5 drill types.
  - Seeded Sims scored 90% and 83%.
  - Reload resumes the call.
  - A double Enter sends once.
  - All 8 staff pages return 200, with no console errors.

### Decisions for Connor (new)
- **Mastery timing:** `varied_retrieval` needs a different Drill on the same rule at least 10 minutes later. A learner who does a Track in one sitting can never reach mastery, so can never certify. Pick one: variant Drills, spaced-review credit, or a different policy.
- **Seeded provenance:** seeded sessions are labelled `local_ai`/`live` (provider `seed-demo`) so they can certify. Confirm that is OK for demo data.
- **Thin-draft API change:** a thin draft now returns 409 `PUBLICATION_GATES_FAILED` (with a gate report) instead of `UNIT_CONTENT_INCOMPLETE`.
- **Draft limits:** draft Units now accept 1-8 cards and 1-10 Drills. `tests/unit/schemas.curriculum.test.ts`, which has Connor's uncommitted edits, was updated to match.
- **Rebind rule:** "Rebind draft" requires approved evidence to still match exactly. Unapproved AI evidence only produces warnings, and the publish gates still block it.

## 2026-11-05: Live trainer review, publish and learner run of the first 7B-built Track
Track `ZrPUNYIsrRF9w5ZMHFMc` (NeuroCalmRx, built by Qwen2.5-7B on MLX) was driven through the real UI with headless Playwright. The Trainer did Source Review, item fixes, scripted Sim QA, and Publish & Assign to All Active Cohorts (published as v1). The agent LC-1042 then completed all 9 Checkpoints and the Live Call Sim.

### Trainer blockers fixed (each was a dead end in the UI)
- **Sim rubric evidence could not be approved anywhere.** `approve_excerpt` looked only at cards and Drills, so the server gate always failed with `CLAIM_UNSUPPORTED` for every generated Sim. It now also finds rubric evidence in the draft secrets (`source-review/route.ts`). Source Review lists "Sim rubric" claims, and the client gate receives the secrets, which removes the false `SCENARIO_SECRET_REQUIRED` (`SourceReview.tsx`, `TrackStudio.tsx`).
- **Approvals were not shown until a reload.** Each approval now updates the Studio's local draft and secrets, and the gate count drops right away (`onEvidenceApproved`).
- **Save Draft could overwrite approvals (security).** PATCH took evidence approval fields from the browser, so a stale tab could wipe approvals and a crafted request could self-approve. Unchanged evidence now keeps its persisted approval, and client-side approvals are dropped (`src/lib/services/evidence-approvals.ts`, `api/tracks/[trackId]/route.ts`).
- **Unsupported evidence that was only typographically off.** New Source Review button "Find exact source passage" (local `rematch_evidence` command, `src/lib/services/evidence-rematch.ts`). It swaps in the exact page span, which stays unapproved until the trainer approves it. On this Track it fixed 11 of the 16 unsupported claims.
- **There was no way to remove a duplicate or unfixable Drill or card.** Edit mode now has "Remove" on every card and Drill. It is disabled at the publishable minimum (`InlineUnitEditor.tsx`).
- **Scripted QA drafts could never pass for a generated Sim.** "Add golden pass draft" made one utterance, and there is no step editor. The drafts are now built from the scenario's own requirements: inspections, dial, disclosure, learner turns, workflow, callback/note, then wrap-up. The critical-fail draft dials before the local-time check (`editor/qa-fixture-drafts.ts`). Both drafts matched expectations live.

### Generation-quality fixes (7B habits found in this Track)
- Evidence matcher (`prompts/evidence.ts`):
  - `'...'` now matches `"..."`. The 7B swaps quotes rather than escaping them in JSON; this caused 11 of the 16 unsupported claims.
  - A word hyphenated across a PDF line break now matches ("3-\nmonth").
  - Fragments are also split at flow arrows.
- Drill checks (`prompts/unit-builder.ts`), which drive repair or drop:
  - a raw `{{BLANK}}` outside a FILL_BLANK template (seen in a MATCH_PAIRS cell);
  - a TRUE_FALSE statement written as a question;
  - a word-bank distractor that contains the answer (word-boundary aware, so "5 minutes" vs "15 minutes" is fine);
  - word-bank entries longer than 4 words.
- Repeated Drills across drill batches are dropped (`dropRepeatedDrills`). Ids use a running counter, so they never collide. This Track had 4 near-duplicate pairs (u3-d1/u3-d6, u7-d1/u7-d5, u8-d1/u8-d4, and u5-d3/u8-d3 across Units).

### Content-quality observations (not code bugs; the trainer must review)
- Paraphrased "evidence" that is not in the PDF (for example "Only leads who complete the quiz are contactable"). Regenerating fails three times, so the trainer has to remove the item.
- Some explanations contradict the answer key: u1-d3 says "the correct order is 1, 3, 2, 4" but stores 1-2-3-4. u4-d2 claims "40% savings", which is not in the source.
- MATCH_PAIRS cells are clamped to 100 characters with "…", which makes pairs hard to tell apart (u2-d5).
- Only 1 of 2 planned Sims was written. This shows as a review note, not a gate.

### Learner result (LC-1042, live on MLX)
- All 9 Checkpoints were completed in the UI.
- Live Call Sim s2, start to scorecard:
  - local-time inspection, then dial, contact, disclosure, 3 turns, callback, note;
  - wrap-up "Callback scheduled": **90%, PASSED & CERTIFIED**;
  - judge round-trip about 9 s.
- Judge oddity: it gave 50/100 on "never promise a discount" even though the agent explicitly declined to offer one.
- Fixed by sim-live: "Safe Wrap-Up Controls" was collapsed, which hid the callback and note controls for a "Callback scheduled" Sim. It now opens by default.

### Still open
- The Studio's own add-fixture drafts still have no step editor. Trainers can add, run and remove fixtures, but cannot edit their steps.
- The Sim unlocks only after every Checkpoint is complete, so "one Checkpoint then the Sim" is not possible by design.

### Overnight, later (sweeps)
- UI sweep of 8 roles × pages, 375px mobile, light/dark/contrast, keyboard: no console or HTTP errors.
  - Fixed: dark-theme contrast (new contrast test), an in-app 404 page, horizontal overflow on Trainer home, the KPI grid, and Sim wrap-up controls that started collapsed.
  - The dev server stopped rebuilding CSS. Restart it with `.next` cleared to see the globals.css fixes.
- Security sweep of 30 API routes and the page loaders: no authorization or isolation holes found (69 live probes, cross-cohort tests, secrets scan).
  - Fixed: join codes could be guessed with no limit. There is now a 10-per-15-minute in-process limiter. Production also needs an edge rate limit or longer codes.
- Decisions for Connor (security):
  - (1) The super-admin bootstrap and roster invites trust an unverified email. Recommend requiring `email_verified` or Google SSO, and disabling public email/password sign-up.
  - (2) Track visibility is cohort-based only. `divisionIds` are not enforced for learners. Confirm this is intended.
- First 7B-built Track published, and LC-1042 certified on it (Sim 90%). Details are in publish-live's entry above.
- Generated Tracks need QA fixtures to publish. Studio now drafts them from the scenario requirements, but a trainer must run and save them.

## 2026-11-05 (round 2): Quality of 7B-generated content
These fixes target what the first 7B Track showed. Each has unit tests.
- **Paraphrased evidence:**
  - The repair turn now lists the top 3 real sentences from the cited and allowed pages. The model is told to copy one verbatim or rewrite the item around one (`evidenceProblems` and `rankSupportingSentences` in `prompts/evidence.ts`).
  - Server-side, an excerpt that still does not match is replaced by the best sentence on its cited page, but only when it clears `STRICT_GROUNDING` (at least 4 shared content words, and at least 60% of the claim's words). The result stays an unapproved draft.
- **Explanations that contradict the key** (`explanationProblems` and `inventedNumbers` in `prompts/unit-builder.ts`, called from `checkDrill`, so they go to repair):
  - SEQUENCE: an explanation that lists a non-1..n order ("1, 3, 2, 4"), or names the steps out of order.
  - MCQ: an explanation that quotes a wrong option and not the correct one.
  - A price, percent or number above 10 in the explanation that is not on the cited pages or in the evidence. The system prompt also forbids invented numbers.
- **Duplicates across Checkpoints:**
  - Drill batches got the prompts of earlier Checkpoints' Drills as "do not repeat". This was removed after R2d, where the model copied them verbatim into every Checkpoint; see below.
  - `ctx.avoidDrills` sends a repeat or near-duplicate to repair, and `dropRepeatedDrills` drops whatever is left. Near-duplicate means the same kind with content-word Jaccard at least 0.7.
- **MATCH_PAIRS:** the prompt asks for sides of at most 80 characters, a longer side is sent to repair, and finalize drops the Drill rather than cutting text with "…".
- **Regenerate ignored hints:**
  - The hint is now the first line ("TRAINER REQUIREMENT (must follow…)") and is repeated at the end.
  - Only the old prompt is shown, not the full old Drill.
  - `ctx.replacing` rejects an unchanged copy, and `avoidDrills` rejects duplicates of the rest of the Track (`regenerate-item.ts`).
- **Excerpt picker:** Source Review has "Choose a sentence from the source page" for unsupported claims (local `pick_excerpt` command, `pickedExcerptEvidence`). The server re-verifies the sentence verbatim, and it stays unapproved until the trainer approves it.
- **QA fixture step editor:** not done (not small). Trainers can still add, run and remove the draft fixtures.
- **Build-safety follow-up after the first R2 build failed:**
  - Cross-Checkpoint repeats no longer go to repair. Only repeats inside a Checkpoint do.
  - Repeats of earlier Checkpoints are dropped afterwards and restored only as far as the Checkpoint's minimum, with a review note (`restoreRepeatsToMinimum`).
  - The first R2 attempt failed at Checkpoint 7 after 27 min: every batch was rejected as repeats.
  - MCQ near-duplicate detection now includes the correct option, so generic stems do not collide.
  - 7B kind aliases ("true/false", "fill in the blank", "matching", …) are mapped, and an unambiguous missing kind is inferred from the fields.
- **Reviewer findings fixed:**
  - `GenerationStepper` treats `NO_ACTIVE_SOURCE_BUNDLE` as "nothing to approve" and starts the build.
  - "Add a Drill" splices in only the new Drill (`appendDrill`).
  - Approve, rematch and pick are disabled while the draft has unsaved edits.
  - Approving two excerpts on one page now writes both (`approvedExcerptsByPage`).
  - PATCH carries the persisted Sim `context.sourceRevision` forward (`carryScenarioSourceRevision`).
- **Hosted notes:**
  - Only local providers are serialized now (`limiterFor`).
  - Hosted provenance is labelled `<provider>-hosted`; local profile ids are unchanged, so existing checkpoints stay valid.
  - `LLMContentBlockedError` is skippable for Drill batches and Sims.
  - The salvage log includes `rawOutputPreview`, the first 600 characters of the raw output.
- **Found by the R2 builds and fixed:**
  - Blueprint Units repeated by title are merged (`mergeRepeatedUnits`). R2b had 3× "Dosage Abandon" and 3× "Checkout Abandon".
  - The blueprint now fails only if no Unit uses a chosen pillar key; R2c had failed on a single Unit.
  - Invented-number check:
    - a wrong value the Drill itself shows (a distractor or a non-compliant statement) may be explained;
    - an invented correct answer is still caught (R2b u3-d4 said "$199 complies").
  - An MCQ explanation that quotes the Playbook verbatim is not treated as endorsing a distractor.

### Measurement: build #4 (before) vs R2b (after the round-2 fixes, before the blueprint merge)
Same metrics script for both (`scratchpad/e2e/metrics/metrics.ts`, which uses the production checks):

| Metric | Build #4 | R2b |
|---|---|---|
| Units / cards / Drills | 9 / 32 / 43 | 10 / 29 / 37 |
| Evidence claims | 83 | 73 |
| Unsupported evidence | 16 | **2** |
| Items flagged for review (build message) | 18 | 13 |
| Shape problems (`{{BLANK}}` leaks, "…" pairs, question statements, phrase word banks) | 5 | **0** |
| Explanation contradicts key | 1 | **0** |
| Invented numbers | 1 ("40%"; the page says "forty-percent", so it is a false positive) | 1 (a real wrong key) |
| Near-duplicate Drill pairs | 5 | 9 (7 of them across repeated blueprint Units; fixed since) |
| Build time | about 34 min with one Retry (Sims failed) | about 31 min with one Retry (cards JSON failed) |

### R2d (blueprint merge, rubric-claim fill)
- **Result:** 7 Checkpoints, 30 cards, 35 Drills, 2 Sims.
  - 0 unsupported evidence and 0 items flagged.
  - Build message: "6 items need trainer review". These are only the repeat notes.
  - 0 explanation errors.
  - Time: 14 min for the Units plus one Sims Retry (Sim 2 output was not readable JSON), about 20 min in total.
- **Regression found:**
  - 31 near-duplicate pairs: the same two Drills ("Your prescription is approved and ready to ship…" and "The 3-month plan costs {{BLANK}} per month") were copied into every Checkpoint.
  - Root cause: listing earlier Checkpoints' Drill prompts in the prompt. Qwen2.5-7B copies listed text verbatim, and the "…" of the clamped prompts even reappeared as "truncated" pair sides.
  - Fix: only the current Checkpoint's prompts are listed. Cross-Checkpoint repeats are dropped afterwards, or kept and flagged when needed for the minimum.
- **Two more fixes from R2d:**
  - The invented-number check now also runs on the lenient path ("$129.00" slipped through).
  - A missing rubric-evidence `claim` is filled from the criterion's evaluation rule (`fillRubricEvidenceClaims`); Sim 1 had failed three times on this.
- **Salvage with a broken wrapper:** when `{"briefingCards": [...]}` itself does not parse, every card or Drill object that does parse is recovered (`parseableItemObjects`). R2e had failed on its first try at Checkpoint 2 because of this.

### Final measurement: R2e (all round-2 fixes) vs build #4

| Metric | Build #4 | R2e |
|---|---|---|
| Checkpoints / cards / Drills / Sims | 9 / 32 / 43 / 1 | 7 / 27 / 36 / **2** |
| Unsupported evidence | 16 of 83 | **1 of 65** |
| Items flagged (build message) | 18 | **3** |
| Near-duplicate Drill pairs | 5 | **0** |
| Explanation contradicts key | 1 | **0** |
| Invented numbers | 1 | **0** |
| Shape problems | 5 | **0** |
| Build time (wall, including one Retry) | about 34 min | **about 19 min** |

Each build needed one Retry, caused by 7B JSON flakiness: #4 failed at Sims, R2e at Checkpoint 2 cards (fixed since).

Remaining notes on R2e:
- One Checkpoint has 1 card (minimum 3), and one has 4 Drills (minimum 5). The trainer uses Add a Drill, or the gate blocks the Checkpoint.
- The QA step editor is still not built.
- Test tracks LnRq1HjpQRJjJBqonCQT (failed R2a), IIHVc2RV0eeSBP44OCaj (R2b), nrhyIy4EEYk1xjzJKEeo (failed R2c), wIVqMDs2ydJ8fF6MOBnh (R2d) and Ka3H0U4klnXELEBm6Z8H (R2e) are left in the emulator.

## 2026-11-05 (round 3): A build with no manual Retry
- **One fresh attempt per stage** (`withFreshAttempt` in `generate-track.ts`):
  - When a stage still fails after its repair loop and salvage, it makes one clean call at temperature 0.1 before failing. The clean call carries no repair history.
  - It applies only to output errors (`LLMStructuredOutputError`, `LLMOutputTruncatedError`) and covers the Blueprint, cards, drill batches, top-ups and Sims (all through `generateOrSalvage`).
  - It is bounded to one extra attempt, and the stage timeout now allows twice the repair loop.
- **Cards top-up:** when the cards call comes back below the plan minimum, one extra call asks for exactly the missing count and lists the cards already written (`cardsTopUpPlan`, `buildUnitCardsUserPrompt({ existingHeadlines })`).
  - The Drill top-up already asks for the kinds the Checkpoint lacks, listing only that Checkpoint's Drills.
  - The review note now applies only if a top-up still falls short.
- **Number words:** "forty-percent", "ninety-nine dollars" and "two hundred" count as 40, 99 and 200 in the invented-number check (`spelledNumbers`).
- **R2f result (fresh build, no manual Retry):**
  - Time: 09:44 → 10:01, about 17 min, READY with "1 item needs trainer review".
  - The fresh attempt fired twice (u2 and u6 drill batches).
  - 7 Checkpoints / 22 cards / 31 Drills / 2 Sims.
  - Zero unsupported evidence, near-duplicates, explanation errors, invented numbers and shape problems.
  - One Checkpoint (u2) has 3 of 4 Drills: its batch 2 was truncated at the 1,760-token limit twice, and the top-up kept 1 of 2.
- **Follow-up fixes:**
  - A fresh attempt after an `LLMOutputTruncatedError` raises `maxOutputTokens` by 1.5×.
  - The Drill top-up asks for one more than missing (within a batch), so a single dropped Drill no longer leaves the Checkpoint short.
- **R2g result (all round-3 fixes, fresh build, no manual Retry):**
  - Time: 10:03 → 10:24, about 21 min. The fresh attempt fired 3 times and rescued each stage.
  - 7 Checkpoints / 25 cards / 35 Drills / 2 Sims.
  - **Every Checkpoint is at its publish minimum.**
  - 0 unsupported evidence, 0 near-duplicates, 0 explanation errors, 0 invented numbers, 0 shape problems, and no review notes.
  - The build message still says "1 item needs trainer review"; the cause was not checked (likely Sim-level).
  - Track id `oKPKJ8UpxGuMIMRaDRxN`.

| Metric | R2e | R2f | R2g |
|---|---|---|---|
| Manual Retry needed | yes (cards JSON) | **no** | **no** |
| Checkpoints below publish minimum | 1 (cards 1/2) | 1 (Drills 3/4) | **0** |
| Unsupported evidence | 1 | 0 | 0 |
| Near-duplicates / explanation errors / invented numbers / shape problems | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| Wall time | about 19 min | about 17 min | about 21 min |

## Final state, 2026-11-05 ~10:45 UTC
- `npm run typecheck`, `npm run lint` and `npm run test:unit` (74 files, 820 tests) pass. `npm run build` (production) passes.
- The dev server was restarted with `.next` cleared, so the CSS fixes are now live. Smoke tests passed after the restart:
  - every staff page returns 200 with 0 errors
  - an agent Checkpoint completes
  - a Live Call Sim scores 100%, PASSED & CERTIFIED
- Latest 7B build (R2g, track `oKPKJ8UpxGuMIMRaDRxN`) needed no manual Retry, and every Checkpoint meets the publish minimums.
  - 0 unsupported evidence, duplicates, explanation errors or broken shapes. It took about 21 minutes.
  - Its build message still says "1 item needs trainer review", but the metrics show none. This has not been traced yet.
- `firestore.rules` is unchanged. `test:rules` was not run tonight, because the emulators were already using port 8080.
- Nothing is committed.

## Open decisions for Connor (all in one place)
1. Should Gemini-scored (`hosted_ai`) Sims be able to certify? Today they cannot.
2. Mastery policy: varied retrieval needs a different Drill on the same rule at least 10 minutes later, so a learner cannot certify in one sitting.
3. Should a "Suggest QA fixtures" button stay? Studio now drafts them from the scenario requirements, and a trainer still runs and saves them.
4. Standard local runtime: MLX, or an Ollama chat model (the installed `clef*` models cannot chat).
5. Production infra, which has not been changed:
   - Cloud Run request timeout of about 3600 s, with always-on CPU or `minInstances: 1`, for long Track builds. Or move builds to a background job.
   - Set `GEMINI_THINKING_BUDGET`.
   - An edge or App Check rate limit, or longer join codes. The current limiter works per instance only.
   - Turn off public email/password sign-up in Firebase.
6. Seeded demo provenance is labelled `local_ai` so seeded users can certify. Is that OK?
7. Track visibility for learners is based on cohort only. `divisionIds` is not enforced.
8. Daily Sim limit rule: a Sim counts once it has `turnCount > 0` or is EVALUATED. It is also checked at the first message.

---

## 2026-11-17 — Pure Verbal Practice, Knowledge Retention Hub & Usable-Product Loop
- **Approval Gate Log (`GATE-01`..`GATE-08`):** Documented all product/policy/infra/verification decisions in [`docs/CONNOR_APPROVAL_LOG.md`](../CONNOR_APPROVAL_LOG.md) and [`src/lib/policy/training-policy.ts`](../../src/lib/policy/training-policy.ts) so unblocked engineering work completed without mid-build interruptions (`GATE-09` closed after running live 8-stage `npm run verify:usable`).
- **Dialer Mechanics Stripped -> Pure Verbal Practice:**
  - Removed `SyntheticOperationsPanel` and dialer/CRM/inspection/SMS/Slack/recording workflows from learner [`SimulationRunner.tsx`](../../src/app/(dashboard)/learn/_components/SimulationRunner.tsx), [`CallTicketHeader.tsx`](../../src/components/simulation/CallTicketHeader.tsx), [`TranscriptChat.tsx`](../../src/components/simulation/TranscriptChat.tsx) (added progressive Web Speech API `Voice dictation` toggle), and Studio [`ScenarioEditor.tsx`](../../src/components/studio/editor/ScenarioEditor.tsx) / [`TrackStudio.tsx`](../../src/components/studio/TrackStudio.tsx).
  - Kept runtime simulation APIs (`start`, `message`, `evaluate`) working seamlessly in `verbal_only` mode via [`verbal-practice.ts`](../../src/lib/services/verbal-practice.ts) and [`verbal-defaults.ts`](../../src/lib/services/verbal-defaults.ts) with direct **Finish & Grade Practice** grading.
- **First-Class Knowledge Retention Hub:**
  - Unified `reviewSchedules` doc IDs between [`drill-answer/route.ts`](../../src/app/api/progress/drill-answer/route.ts) and [`seed-learning-evidence.ts`](../../scripts/seed-learning-evidence.ts) via [`review-schedule-id.ts`](../../src/lib/services/review-schedule-id.ts) (`review_<sha256>`), plus schedule deduplication in [`learning-evidence.ts`](../../src/lib/services/learning-evidence.ts).
  - Built [`retention-queue-core.ts`](../../src/lib/services/retention-queue-core.ts), [`retention-queue.ts`](../../src/lib/services/retention-queue.ts), [`complete-review/route.ts`](../../src/app/api/progress/complete-review/route.ts), [`RetentionRunner.tsx`](../../src/app/(dashboard)/learn/_components/RetentionRunner.tsx), `/learn/review`, `Retention` nav item, and the Agent Home **Knowledge Retention** card.
- **Local AI Config, Fresh Playable Track & Verification Loop:**
  - Updated `.env.local` to `AI_PROVIDER=openai_compatible` (`127.0.0.1:8081`, `mlx-community/Qwen2.5-7B-Instruct-4bit`), `playwright.config.ts` to `channel: 'chrome'`, and `scripts/seed-demo.ts` with `demo-verbal-neurocalm` (`NeuroCalmRx Verbal Mastery`).
  - Added [`tests/unit/verbal-practice.test.ts`](../../tests/unit/verbal-practice.test.ts), [`tests/unit/retention-queue.test.ts`](../../tests/unit/retention-queue.test.ts), [`tests/unit/verbal-and-retention-routes.test.ts`](../../tests/unit/verbal-and-retention-routes.test.ts), [`tests/e2e/usable-product.spec.ts`](../../tests/e2e/usable-product.spec.ts), and executed [`scripts/verify-usable-product.mjs`](../../scripts/verify-usable-product.mjs) end-to-end (`npm run verify:usable`).
