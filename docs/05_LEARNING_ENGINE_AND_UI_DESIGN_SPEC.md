# 05 — Gamified Learning Engine & Tactical UI/UX Specification

---

## 1. Visual Identity & Clean-Room Design System ("Slate & Signal")

LogiCall Pulse is engineered to look and feel like a **modern operational readiness cockpit** built for high-performing Telehealth, Inbound, and Outbound contact-center teams—clean, tactile, distraction-free, and visually distinct from consumer courseware.

### 1.1 Core CSS Design Tokens (`src/app/globals.css`)

```css
:root {
  /* Dark-First Operational Palette (with crisp Light Mode toggle support) */
  --pulse-bg: #0b1120;
  --pulse-surface-1: #111827;
  --pulse-surface-2: #1e293b;
  --pulse-surface-elevated: #263349;
  --pulse-border: #334155;
  --pulse-border-subtle: #1e293b;

  /* Text Hierarchy */
  --pulse-text-primary: #f8fafc;
  --pulse-text-secondary: #cbd5e1;
  --pulse-text-muted: #94a3b8;

  /* Functional Signal Accents */
  --pulse-indigo: #6366f1;         /* Primary interactive action & active checkpoint */
  --pulse-indigo-hover: #4f46e5;
  --pulse-emerald: #10b981;        /* Verified mastery, correct drill, certified badge */
  --pulse-amber: #f59e0b;          /* Streak flame, retry queue, borderline score */
  --pulse-crimson: #ef4444;        /* Policy breach, missed drill, auto-fail alert */

  /* Division Accent Pills */
  --div-telehealth: #14b8a6;       /* Clinical Teal */
  --div-inbound: #8b5cf6;          /* Operations Violet */
  --div-outbound: #f97316;         /* Revenue Orange */

  /* Geometry & Motion */
  --pulse-radius-sm: 6px;
  --pulse-radius-md: 10px;
  --pulse-radius-lg: 14px;
  --pulse-font-sans: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
  --pulse-font-mono: 'JetBrains Mono', ui-monospace, monospace;
}
```

### 1.2 Modern Web Platform Standards
* **Dialogs & Popovers:** Use native HTML `<dialog>` (`showModal()`) with `@starting-style` transitions for the Publish Modal, Bulk Roster Import Modal, and Source PDF Citation Drawer, and the native HTML `popover` attribute for lightweight filter menus and tooltip hints.
* **Keyboard-First Speed for Call-Center Staff:** During Briefing Cards and Mastery Drills, trainees can navigate 100% by keyboard (`1`–`4` to pick options, `Enter` to submit / advance, `Space` to flip/expand citation) so agents fly through modules effortlessly.
* **Responsive Container Queries:** Use CSS `@container` queries on Drill Cards and Analytics Widgets so the split-pane **Trainer Track Studio** renders the exact same learner component inside a live preview column without viewport breakpoint glitches.

---

## 2. Screen-by-Screen UX Architecture

### 2.1 Sign-In & Onboarding Gate (`/login` & `/join/[code]`)
* **Clean Split Card:**
  * **Primary Button:** `Continue with Google (@logicall.io)` — 1-click OAuth for internal staff, trainers, supervisors, and admins.
  * **Divider:** `External Partner & Agent ID Access`
  * **Compact Form:** Single identifier field accepting **either** a LogiCall ID (`LC-1042`) **or** email address + Password, plus a link `"Have a Team Join Code? Claim Access →"` (`/join/[code]`).
* **Cohort Join Flow (`/join/[code]`):** When a BPO supervisor shares `pulse.logicall.io/join/THS-7842`, a new THS agent enters their Full Name, `LC` Number, and sets a password—automatically placing them into the `THS` cohort and enrolling them in all tracks assigned to `THS`.

---

### 2.2 Non-Technical Trainer Studio (`/studio/new` & `/studio/[trackId]`)

#### A. The 3-Input "Upload PDF & Go" Screen (`/studio/new`)
Designed so a non-technical QA specialist or Ops manager creates a full interactive training in **under 30 seconds of effort**:
1. **Division Selector Pills:** `Telehealth` | `Inbound Operations` | `Outbound Sales`
2. **Campaign / Playbook Title:** e.g., `MVP Retention & Save-Offer Playbook` (optional short code `MVP`)
3. **Drag-and-Drop PDF Zone:** Accepts `.pdf` up to 20 MB.
4. **Single CTA Button:** **`Generate Interactive Track →`**
   * Immediately transitions into the **Live Build Stepper** (powered by SSE): shows animated checkmarks as pages are extracted, Competency Pillars are detected, Checkpoints `1..N` light up one by one, and Live Call Sim personas are finalized.

#### B. Plain-English Preview & Publish Studio (`/studio/[trackId]`)
* **Left Column (Outline Tree):** Lists Checkpoints `1..N` and Live Call Sim scenarios `1..M`.
* **Center Column (Interactive Live Player / Inline Editor Toggle):**
  * **Play Mode:** Trainer clicks through the exact Briefing Cards, Mastery Drills, and Live Call Sim just like an agent.
  * **Edit Mode:** Plain-English form fields (no JSON, no markdown syntax required, no prompt boxes). Every Card, Drill, and Scenario also has a 1-click **`↻ Regenerate This Item`** button with an optional plain-English hint (e.g., *"Focus this question more on the 70% medical refund rule"*).
* **Top Right Action (`Publish & Assign`):** Opens `<dialog>` with checkboxes for target Cohorts (`All Active Cohorts`, `Internal`, `THS`, `NGA`, `DOZ`, `ZIM`, `MRR`, `Call Core`, `LATAM Direct`) and publishes an immutable `TrackVersion`.

---

### 2.3 Agent Duolingo-Style Learning Experience (`/learn/[trackId]`)

#### A. Vertical Checkpoint Path (`/learn/[trackId]`)
* Displays Track Header (Division pill, Campaign Code, Mastery %, XP earned, Source PDF Page Count).
* **Vertical Node Progression Path:**
  * **Completed Checkpoint:** Solid Emerald node (`✓`) with accuracy score (`95%`) + `"Practice Again"` option.
  * **Current Unlocked Checkpoint:** Pulsing Indigo node (`Start Checkpoint → 4 mins`).
  * **Locked Future Checkpoints:** Muted Slate nodes (unlock sequentially to prevent skipping straight to the exam).
  * **Capstone Node — Live Call Sim:** Tactical headset/chat badge at the bottom of the path; unlocks as soon as all Checkpoints are completed. Requires passing at least 1 simulation (`≥ 80%`) to earn the **Campaign Certified** badge.

#### B. Checkpoint Runner: Briefing Cards → Mastery Drills → Mistake Recovery (`/learn/[trackId]/unit/[unitId]`)
* **Top Segmented Progress Bar:** Smoothly fills across Briefing Cards + Drill items; displays current **Combo Streak** (`🔥 5 in a row`).
* **Phase 1 — Briefing Deck:**
  * Renders concise micro-cards one at a time: Headline, 2–4 sentence explanation, highlighted **Key Rule Callout**, side-by-side Emerald **`DO`** vs. Crimson **`DON'T`** bullets, and a `Source: Playbook p. 4` pill.
* **Phase 2 — 5 Interactive Drill Mechanics:**
  1. **`MULTIPLE_CHOICE`:** Scenario card + 4 keyboard-numbered option tiles (`[1]`–`[4]`).
  2. **`TRUE_FALSE_SPOT`:** Agent quote or action snippet + two bold verdict buttons (`✓ Policy Compliant` vs. `✕ Policy Violation`).
  3. **`SEQUENCE_ORDER`:** Up/down reorderable or tap-to-slot step tiles (e.g., ordering the 4 steps of CRM verification and escalation).
  4. **`MATCH_PAIRS`:** Two columns of 3–4 tiles; click a trigger on the left and its matching action/CRM/disposition on the right; matched pairs lock in Emerald.
  5. **`FILL_BLANK_CHOICE`:** Policy sentence with a highlighted blank slot + 4 word-bank chips below; tapping a chip snaps it into the sentence.
* **Instant Grounded Feedback Drawer:** Bottom bar slides up in Emerald (`Correct! +15 XP`) or Amber/Crimson (`Review Rule`) with the 1–2 sentence explanation from the PDF before clicking `Continue`.
* **Phase 3 — Mandatory Mistake-Recovery Queue:**
  * Any drill missed on the first attempt is pushed to a `reviewQueue` at the end of the Checkpoint with a banner `"Round 2: Clear Your Missed Concepts (2 left)"`.
  * **Important Scoring Distinction:** First-try accuracy (`firstTryAccuracyPct`) is recorded honestly for the **Strengths & Blind-Spots Analytics** (so leadership sees true initial comprehension!), while the agent still has to master 100% of missed items to finish the Checkpoint!

#### C. Capstone: *Live Call Sim* Textual Conversation (`/learn/[trackId]/sim/[scenarioId]`)
* **Top Context Ticket Bar:** Displays Campaign (`MVP`), Channel (`Inbound Call/Chat Sim`), Scenario Difficulty badge, and Turn Counter (`Turn 3 of 8`) + button **`End & Disposition Call`**.
* **Live Chat Transcript Stage:**
  * Simulated Caller / Patient / Prospect messages stream token-by-token on the left.
  * Agent types their response in a clean composer at the bottom (`Enter` to send, `Shift+Enter` for newline). No pre-written multiple-choice crutches—tests real recall and communication!
* **Wrap-Up Disposition Step:** When `<SIM_END>` triggers or the agent clicks `End & Disposition Call`, a compact modal prompts: *"Select the Primary Disposition you would log for this interaction"* (from `dispositionOptions`), then submits for AI Rubric Evaluation.
* **Instant AI Coach Scorecard:**
  * Circular score gauge (`88% — PASSED & CERTIFIED` in Emerald, or `64% — RETRY RECOMMENDED` in Amber).
  * **Criterion-by-Criterion Breakdown:** Shows each PDF rubric rule (`0 / 50 / 100`), quotes the agent's exact words, and—for any `0` or `50` score—displays a concrete **"Stronger Response Example"** the agent can learn from before retrying!

---

### 2.4 Strengths, Readiness & Cohort Analytics (`/analytics`)

Built specifically so non-technical leaders and supervisors immediately see **where everyone's strengths and blind spots are**:

1. **Filter Bar:** Filter by **Division** (`All`, `Telehealth`, `Inbound`, `Outbound`), **Partner Cohort** (`INTERNAL`, `THS`, `NGA`, `DOZ`, `ZIM`, `MRR`, `CALL_CORE`, `LATAM_DIRECT` — auto-locked for `PARTNER_SUPERVISOR`), and **Campaign Track**.
2. **Widget 1 — Cohort × Competency Strength Heatmap:**
   * Rows = Partner Cohorts (or Individual Agents when drilled into a cohort); Columns = Canonical Competency Pillars (*Verification & CRM*, *Offer & Policy Accuracy*, *Save-Offer & Objections*, *Escalation Triage*, *Compliance*, *Empathy & Clarity*).
   * Color-coded cells (`≥85%` Emerald, `70–84%` Amber, `<70%` Crimson) let leadership instantly spot e.g. *"Team X is elite at Empathy (`93%`) but needs targeted coaching on Escalation Triage (`64%`)."*
3. **Widget 2 — Campaign Certification Matrix:**
   * Grid of **Agents × Active Campaigns** showing `Certified (Score %)`, `In Progress (Pct %)`, or `Not Started`—giving Inbound/Outbound/Telehealth supervisors an instant roster of who is verified to take live calls on which campaign! (Includes 1-click **Export CSV** for workforce scheduling).
4. **Widget 3 — Playbook Gap Detector ("Top Missed Concepts"):**
   * Ranks specific rules/questions with the highest first-try miss rate across trainees, linking directly back to the Track Studio item so trainers can clarify ambiguous training documents.
5. **Individual Agent Readiness Passport (`/analytics/agents/[uid]`):**
   * Displays an SVG **6-Axis Skill Radar Chart** of the agent's strengths, certified campaign badges, first-try drill accuracy vs. live simulation score comparison, and expandable **Full Simulation Transcripts + AI Rubric Evaluations** for QA coaching.
