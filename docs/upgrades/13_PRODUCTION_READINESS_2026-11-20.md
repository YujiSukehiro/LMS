# Production Readiness Report — 2026-11-20

Scope: `upgrade-fork/` (branch `feature/standard-meds-learning-upgrades`, HEAD `ffb2b59`). All changes below are
**uncommitted** in the working tree. Nothing was pushed or deployed. `firestore.rules` was not modified.

## Verification (all green)

| Gate | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | clean, 0 warnings |
| `npm run test:unit` | 79 files, 842 tests pass (6 new) |
| `npm run build` (clean `.next`) | compiles, no TS/ESLint/prerender warnings |
| `npm run test:rules` (emulator) | 16/16 pass |
| Playwright usable-product E2E (prod server, mock judge) | 7/7 pass, zero console errors / 4xx / 5xx |
| Real MLX preflight (Qwen2.5-7B) | ready in 3 of 4 runs; `structured_output` flaked once on the 7B model and passed on rerun (no AI code changed) |
| Live Verbal Practice on MLX through the UI | 3 turns + grading, zero console/network errors |
| Route sweep: 4 roles, 22 route views, at 390/768/1024/1440 | zero console errors or warnings, zero failed requests, zero horizontal overflow |

`npm run verify:usable` runs every gate above in one command.

## Bugs and gaps found and fixed

1. **Certification dead end for one-sitting learners.** Mastery only counted `varied_retrieval` attempts unless
   `allowSameSittingRuleMastery` was on. Learners who finish both Checkpoints in one sitting never get a varied attempt
   (the second Checkpoint's variation Drills land inside the 10-minute window and count as `initial`), and the Retention
   Hub only re-serves the same Drill, which is classified `spaced_review`. Result: no reachable path to mastery or
   certification. Fix: a due `spaced_review` (a day or more later) now counts toward mastery by default, which is the
   behaviour `CONNOR_APPROVAL_LOG.md` GATE-03 already describes. Same-sitting `initial` answers still never count.
   `masteryPolicy.allowSpacedReviewAsMastery: false` restores the strict rule. (`certification.ts`, tests updated.)
2. **Stalled AI caller hung the learner forever.** The Actor stream had no deadline beyond the client leaving; a hung
   model kept "caller is replying…" open until the platform timeout. Added a stream watchdog (45 s idle, 100 s total)
   that returns the existing plain-English `AI_UNAVAILABLE` error with the "Send again" retry. (`stream-watchdog.ts`,
   `simulations/[sessionId]/message`.)
3. **Microphone/dictation cleanup.** Late speech results could write into a cleared or unmounted composer, and a
   blocked mic failed silently. Recognition handlers are now detached and aborted on send, unmount and disable;
   blocked mic, missing mic, network and no-speech errors show a short message. No TTS exists, so no double-speaking
   risk. (`TranscriptChat.tsx`, `voice-errors.ts`.)
4. **Cloud-AI scorecards silently did not count.** With GATE-04 off, a Gemini-scored pass showed "PASSED" but never
   moved certification. The scorecard now says it is coaching only and does not count yet.
5. **Mobile horizontal overflow (447 px) on Analytics.** Screen-reader-only labels inside scrollable tables escaped
   their scroll container. All scroll containers are now positioned.
6. **Broken fonts after `verify:usable`.** The script mocked Google Fonts for every run, leaving placeholder `.woff2`
   files in `.next` that later `next start` runs served ("OTS parsing error"). Mocking is now `--offline` only.
7. **Verbal-mode copy leaks.** "Live Call Sim", "Sim attempts/pass rate", "Ready for sim", "Build Live Call Sims",
   disposition/workflow wording and `CompetencyPillar` jargon appeared in verbal mode. All Simulation naming now
   comes from `SIM_COPY` in `training-policy.ts`; the learner evidence panel hides workflow/disposition steps in
   `verbal_only`.
8. **Raw rule IDs shown to learners** (`rule-nc-identity`) are replaced by the Checkpoint name.
9. **Focus ring on script-focused headings** (Retention drill prompt) removed; keyboard focus rings unchanged.
10. **Match-pairs hint** said "keys 1–4" for 3 pairs; now uses the real count.
11. **`_gemini_review/`** (3.7 MB of source dumps) was untracked and not ignored by App Hosting; added to
    `.gitignore` and `firebase.json` `apphosting.ignore`.

Audited with no change needed: every Firestore query has a matching composite index (only one query needs one:
`simSessions` partnerCohortId + startedAt); every `/api/*` route enforces auth and role (`claim-invite` and
`auth/session` are public by design); session cookies are `SameSite=Lax`; `TRAINING_POLICY` branches are consistent.

## Screens condensed

| Screen | Before | After |
| --- | --- | --- |
| Track map (`/learn/[id]`) | 2,500 px tall; a 500-line evidence wall with rule IDs sat above the first "Start Checkpoint" button (≈1,500 px down) | Checkpoints first and above the fold; a 320 px side panel with a "Path to certification" checklist, collapsed details, one-line disclaimer |
| Track header | Elevated hero + three stat boxes | One compact row with inline Mastery / XP / Playbook |
| Verbal Practice intro | Large icon hero, two stat boxes, two helper bullets | Title row with turns and pass mark inline, brief, one helper line |
| Verbal Practice live | Transcript fixed at 64vh; composer clipped at 1280×800 | Transcript sized to the viewport; header, transcript and composer fit at 1280×800 and 1440×900 |
| Scorecard | 168 px gauge, criteria in original order, actions at the very bottom | 116 px gauge, Retry/Back in the header (retry is primary only on a fail), "What to fix" lowest-score first, met criteria collapsed |
| Pending scorecard | Repeated the same message twice | One line |
| Retention Hub | Hero card, four pills per drill, padded drill card | One-line header, one meta line per drill, tighter card |
| Agent home | Large hero + elevated retention banner | Compact header and one-row retention bar |
| KPI strips (all homes, Analytics) | 3.5 rem padding, 2xl numbers | Dense tiles, xl numbers |
| Roster | Three stacked action buttons per row (≈118 px rows), stacked filter selects | Inline icon actions with labels for screen readers (≈70 px rows), inline filters, tighter Cohort cards |
| Analytics / Admin / Team Progress | Jargon headings, long helper paragraphs | "Skill strength by Cohort", "Certification by agent", "Most-missed Drills", one-line descriptions |

Screenshots: `test-results/sweep2/` (every route × 4 viewports) and `test-results/e2e-shots/` (E2E journey).

## Known limitation (not a code bug)

- The local 7B MLX judge often returns rubric JSON that fails schema checks (for example an empty quote on a 100
  score). The app handles it as designed: the practice is saved and goes to the Trainer scoring queue. A larger local
  model or Gemini avoids it.

## Decisions for Connor before rollout

1. **GATE-04: approved 2026-11-20.** `allowHostedAiForCertification = true`. Gemini (`hosted_ai`) evidence is now kept
   as `hosted_ai` end to end (it was being relabelled `imported_legacy`, which blocked certification even with the
   flag on). Flipping the flag back to `false` blocks hosted runs with the explicit reason
   `hosted_ai_certification_disabled` and shows learners a "coaching only" note.
2. **Gemini key.** The `GEMINI_API_KEY` secret block in `apphosting.yaml` is commented out, so every AI feature in
   production returns "The AI caller is not available right now". Run
   `npx firebase-tools apphosting:secrets:set GEMINI_API_KEY` and uncomment the block.
3. **GATE-03 confirmation.** Default now matches your approval log (a delayed spaced review masters a rule). Say if
   you want the strict varied-only rule instead.
4. **Where App Hosting builds from.** The workspace root also has a `firebase.json` pointing at the same backend
   (`logicall-pulse`, `rootDir: "/"`) with the Oct-31 prototype and 1 GiB memory. Deploy only from `upgrade-fork/`
   (or the GitHub-connected branch). `origin/main` is at `ffb2b59`; today's fixes are not committed or pushed, so
   they do not deploy until you commit them (GATE-06).
5. **GATE-08 hardening:** rate-limit `/join/[code]` and `claim-invite` (public, join-code guessable), disable public
   email/password sign-up, and confirm the Cloud Run request timeout covers the 300 s evaluate route.
6. GATE-01, 02, 05 and 07 are unchanged; current defaults are safe.
