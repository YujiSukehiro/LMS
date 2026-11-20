# UI/UX audit, theming, and content-depth sizing (2026-11-03)

Scope: the `upgrade-fork` app on `feature/standard-meds-learning-upgrades`, reviewed as Trainer, Partner Supervisor, and Agent at 1280 px and 390 px with the seeded demo data.

## Built in this pass

### 1. Track size comes from the source, not a fixed range
- New `src/lib/ai/pipeline/content-depth.ts` counts rule statements (list items, "must/never/only/if…" sentences, amounts, day limits), words, and headings on every page.
- **Units per Track**: was a fixed 3–6. Now a measured range inside 2–12 (one Unit per ~12 rules, balanced with word count and section count). The blueprint schema enforces the range and the prompt states it.
- **Cards and Drills per Unit**: were a fixed 3–5 cards and 5–7 Drills. Now sized per Unit from the rules on its pages (2–8 cards, 4–10 Drills, ~1.4 Drills per card). A page shared by two Units is split between them.
- Measured on the Standard Meds PDFs: Training Hub (2 pp) → 2 Units; ED QuattroRx (9 pp) → 6; NeuroCalmRx (13 pp) → 9; Customer Support (19 pp) and Medical Chat (22 pp) → 12.
- Manual curriculum export sizes the replacement Unit from its own pages. Demo replay keeps the old defaults, because its recorded output is fixed.
- Stage caches include `CONTENT_SIZING_VERSION`, so old checkpoints are not reused with new sizes.
- `TrackUnitSchema` now allows 2–8 cards, 4–10 Drills, and up to 15 estimated minutes.
- Tests: `tests/unit/content-depth.test.ts`.

### 2. Themes: Light (default), Dark, High contrast, System
- Tokens in `src/app/globals.css`. Light is the base `:root`. Dark keeps the original palette. High contrast uses black text, strong borders, AAA accents, and 3 px focus rings. System follows the device setting.
- Light accents are one step darker (emerald `#047857`, amber `#b45309`, crimson `#c81e1e`) so status text on white passes WCAG AA.
- New tokens replace hard-coded colors: `--pulse-indigo-text`, `--pulse-on-accent`, `--pulse-on-emerald`, shadow and backdrop tokens.
- The server reads the `pulse-theme` cookie and renders `<html data-theme>`, so the page does not flash. The picker is in the account menu (and as icons on the sign-in page). It also saves `users/{uid}.preferences.theme`, which the existing Firestore rules already allow.
- The user preference schema now accepts `light | dark | contrast | system`, with `light` as the default.
- `globals.css` has `@source "../"` so Tailwind scans this app even when the dev server starts from the parent folder.

### 3. Plain-language fixes
- The Agent Track page and Supervisor agent page showed the raw enum `historical_unverified`. Both now explain it in plain words.

## Findings not yet built (ranked)

1. **Completion status is spread over four vocabularies.** The Agent sees "3/3 complete" next to Mastery "–" and an unverified banner. The Supervisor matrix shows "In Progress (75%)", "Not Started", and "Historical — Unverified". Supervisors cannot see what is left. → Mockup `docs/mockups/completion-tracking.svg`.
2. **Track creation gives no preview before a long AI build.** Three inputs, then the model picks the Units. Source gaps (image-only pages) fail late. The form takes one PDF, but the backend supports bundles. → Mockup `docs/mockups/training-creation.svg`.
3. **The Certification Matrix has one column per Track.** It gets too wide after 4–5 Tracks and has no sort or "stalled" filter.
4. **Gap Detector rows repeat generic prompts.** "Complete the Playbook rule." shows twice, so a trainer cannot tell which Drill it is. Show the sentence template or Unit name.
5. **Status colors are misleading.** "80% first try" uses the amber warning pill on a completed checkpoint. A 50% sim pass rate is red with no target shown.
6. **Empty states are heavy.** A new agent's page shows "0 Tracks" in large mono text and an empty radar with "no data" on every axis. Use one empty-state card instead.
7. **Agents have no "My Tracks" navigation.** The sidebar has only Home, and `/learn` redirects to Home.
8. **Heatmap columns are mostly empty.** Hide pillars with no data for the current filter.
9. **The sidebar footer is covered** by the Next.js dev badge (dev only), and the sidebar background ends at the viewport in full-page captures.

## Mockups
- `docs/mockups/completion-tracking.svg` / `.png`: a Team Progress board for Supervisors. It has a five-step status ladder (Not started → Learning → Checkpoints done → Certified → Needs recert), segmented checkpoint bars sized to each Track's Unit count, a "Next step" column, stalled-agent reminders, and recertification scoped to the changed Playbook page.
- `docs/mockups/training-creation.svg` / `.png`: a four-step creation flow (Sources → Content map → Build → Review & assign). The Content map step shows the measured depth, a rules-per-page chart, the recommended checkpoint count and range, cards and Drills for each checkpoint, split and merge hints, and source-gap warnings before generation.

## Built after review (2026-11-03, second pass)
- **Team Progress** at `/progress` (sidebar for Supervisors, Trainers, Admins). It has the five-step status ladder with click-to-filter, a stalled filter (7+ days idle), per-checkpoint bars sized to each Track, a Next step column, an Export CSV, and an option to show offboarded agents. Statuses come only from the certification register and enrollment evidence. A legacy "CERTIFIED" enrollment never shows as Certified. Logic: `src/lib/services/team-progress.ts` (tests: `tests/unit/team-progress.test.ts`).
- **Track creation** is now Sources → Content map → Build → Review & assign. The Content map shows rule statements, a rules-per-page chart, image-only and no-rule pages, and the recommended checkpoint count with −/+ adjustment and a learner time estimate. The chosen target is saved as `tracks/{id}.unitTarget` (`/api/tracks/{id}/content-map`), and the build plans target ±1 checkpoints. If the trainer keeps the recommended count, it stays null so later rebuilds re-measure.
- Not built yet: reminders (no messaging channel exists), per-checkpoint split and merge before the build (the model still groups pages into checkpoints), and multi-PDF upload on the create form.

## Team Progress switched to the Pipeline layout (2026-11-03, Connor picked concept A)
- `/progress` now shows Track tabs ("X of N ready"), a "Ready for calls" meter, and four columns: Not started, Learning, Ready for sim, Certified. A "Needs recert" lane sits under Certified. Each agent is one card.
- Cards with a problem come first with a colored edge and one plain reason: "Not opened yet", "Stuck N days on Checkpoint X", "Sim 72%, pass line 80%", "Expires in N days", or the recert reason. Columns show 6 cards, then "+ N more on track".
- Mockups: `docs/mockups/completion-tracking-a-pipeline.svg` (chosen), `completion-tracking-b-people.svg` (not chosen).
