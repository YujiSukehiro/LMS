# 01 — Product & Domain Specification: LogiCall Pulse

| Field | Value |
| :--- | :--- |
| **Platform Name** | **LogiCall Pulse** (*Campaign Readiness & Simulation Platform*) |
| **Organization** | LogiCall Services Inc. (`@logicall.io`) |
| **Target Divisions** | **Telehealth**, **Inbound Operations (IO)**, **Outbound Sales Operations (OBS)** |
| **Target Scale & Budget** | ~150–250 active trainees across internal staff + external BPO cohorts; **< \$5/month** total run cost (well below the \$20/month ceiling) |
| **Language** | Strictly **English-only** across all UI, source documents, drills, and live simulations |
| **Iteration Strategy** | **Iteration 1:** Local macOS execution (`Ollama` + `Firebase Local Emulator`) → **Iteration 2:** Google Cloud / Firebase App Hosting + `Gemini 2.5 Flash / Flash-Lite` API |

---

## 1. Executive Purpose & Operational Context

LogiCall operates high-velocity contact center and clinical coordination campaigns across three primary divisions—**Telehealth**, **Inbound Operations**, and **Outbound Sales Operations**—staffed by internal employees, ~90 direct LATAM outbound contractors, and 5+ third-party BPO partners (`THS`, `NGA`, `DOZ`, `ZIM`, `MRR`, `Call Core`).

Historically, campaign training at LogiCall has suffered from four structural bottlenecks:
1. **Fragmented, Manual Onboarding:** Campaigns frequently launch within 24–48 hours. Policies sit inside static PDFs, script outlines, or spreadsheets, and training delivery varies wildly depending on whether an internal trainer or a BPO partner supervisor conducts it.
2. **High Multi-Campaign Cognitive Load:** Inbound CSRs handle 30–100 campaigns simultaneously (across Campaign-Specific Flow A lines, the shared Konnektive Flow B line, and Abandoned-Cart Flow C), leading to 41%+ avoidable escalations and 50% incomplete escalation submissions.
3. **Robotic Script Reading vs. Applied Judgment:** Static multiple-choice quizzes fail to verify whether an agent knows when to walk a `25% → 50% → 70%` retention ladder versus skipping immediately to `70%` on a medical complaint, handling a chargeback threat, or following strict Telehealth intake and PCI payment boundaries.
4. **Zero Visibility into Individual & Partner Strengths:** Leadership and QA lack an objective **Readiness & Competency Matrix** showing which individual agents and which BPO partner cohorts excel at specific campaign skills (e.g., *Retention & Objection Handling* vs. *Order/CRM Verification* vs. *Empathy & De-escalation*).

**LogiCall Pulse** solves all four problems with a radical **"Upload a PDF and Off to the Races"** workflow: non-technical trainers drop a campaign PDF into the platform, and AI automatically synthesizes a progressive, gamified **Learn → Drill → Live Textual Simulation** track that trains agents by doing and maps every trainee's exact strengths and blind spots.

---

## 2. Clean-Room & Brand Differentiation Mandate

LogiCall Pulse is an original, clean-room enterprise platform purpose-built for LogiCall's campaign operations:
* **No Public SaaS Marketing Bloat:** Root `/` routes directly to the internal **LogiCall Pulse Operations Sign-In** (or authenticated dashboard). There are no public pricing pages, consumer lead-capture forms, or marketing carousels.
* **Distinct Tactical Enterprise Identity ("Slate & Signal"):** Uses a high-contrast operational command-center palette (Deep Slate `#0B1120` / `#F8FAFC`, Signal Emerald `#10B981`, Cobalt Indigo `#4F46E5`, Amber `#F59E0B`) and tabular monospace metrics (`JetBrains Mono`), avoiding light-blue/cyan consumer edtech palettes, `localStorage` theme-Restyling scripts, or generic mascot tropes.
* **Contact-Center Native Vocabulary:**
  * **Playbook:** The uploaded source PDF document for a campaign or SOP.
  * **Campaign Track:** The generated gamified training path (organized into sequential **Checkpoints / Units**).
  * **Briefing Cards:** Bite-sized interactive learning cards grounded in specific Playbook pages.
  * **Mastery Drills:** Adaptive, multi-mechanic knowledge checks with automatic mistake-recovery loops.
  * **Live Call Sim:** Multi-turn textual roleplay conversation where the trainee handles a simulated caller, prospect, or Telehealth patient and is graded by a deterministic AI rubric.
  * **Readiness Matrix & Skill Radar:** Strength and gap analytics across Competency Pillars, Campaigns, Divisions, and BPO Partner Cohorts.

---

## 3. Division-Specific Training Profiles

When a trainer uploads a PDF, selecting the **Division** automatically tunes the AI curriculum generator's scenario framing and default competency pillars (with zero prompt writing required from the trainer):

| Division | Primary Trainees | Typical PDF Playbooks Uploaded | Default AI Competency Pillars Extracted | Simulated Counterparty in *Live Call Sim* |
| :--- | :--- | :--- | :--- | :--- |
| **Telehealth** | Telehealth intake specialists, clinical coordinators, `THS` Nicaragua cohort | Patient intake SOPs, clinical triage protocols, appointment scheduling guides, privacy/escalation rules | 1. Intake & Screening Accuracy<br>2. Clinical Red-Flag Escalation<br>3. Privacy & Boundary Compliance<br>4. Patient Empathy & Clarity | Patient seeking consultation, asking medication/scheduling questions, or presenting an urgent symptom requiring escalation |
| **Inbound (`IO`)** | Internal CSRs, `THS`, `NGA`, `DOZ`, `ZIM`, `MRR` partner CSRs, Email CS | Campaign refund/reship playbooks (`MVP`, `4MAPs`, `Gontel`, `Mr. Comercio`), Flow B multi-campaign guides, CRM & escalation SOPs | 1. Identity & CRM Order Verification<br>2. Save-Offer & Retention Execution<br>3. Escalation Triage & Required Fields<br>4. De-escalation & Disposition Accuracy | Frustrated buyer demanding a refund, reporting broken bottles/medical side effects, or threatening a bank chargeback |
| **Outbound (`OBS`)** | ~90 LATAM sales contractors, `Call Core`, Nicaragua Flow C recovery agents | Outbound campaign pitch books, offer/upsell matrices, continuity disclosure rules, rebuttal & PCI guides | 1. Discovery & Pitch Framing<br>2. Offer, Pricing & Continuity Clarity<br>3. Objection & Rebuttal Execution<br>4. Order Close & Payment Compliance | Warm lead, abandoned-cart shopper, or skeptical prospect raising price, trust, or spouse/timing objections |

> **Important Scope Boundary (Zero Real Customer/Patient Data):** LogiCall Pulse is strictly a training and simulation environment built from instructional PDFs uploaded by trainers. Trainees never enter real patient PHI, live customer PII, or live payment cards into the platform, and AI personas exclusively use synthetic names, synthetic order numbers, and synthetic scenarios derived from the training rules.

---

## 4. User Roles, Personas & BPO Cohort Isolation

LogiCall operates across internal leadership/trainers (`@logicall.io`) and external BPO partner teams where Partner A (`THS`) must **never** see Partner B's (`DOZ`, `NGA`, `ZIM`, `MRR`) roster or scores.

| Role | Typical LogiCall Users | Authentication Method | Core Capabilities & Data Visibility |
| :--- | :--- | :--- | :--- |
| **`SUPER_ADMIN`** | IT / Platform Owner, CEO, CFO | Google Workspace SSO (`@logicall.io`) | Full system control: manage divisions, partner cohorts, user roles, AI model/provider settings, and global analytics. |
| **`ADMIN`** | VP Inbound, VP Outbound, Telehealth Lead, Scheduling/Provisioning Admin | Google Workspace SSO (`@logicall.io`) | Manage all users/rosters (including bulk CSV/`LC`-ID import & instant 1-click deactivation), assign tracks to cohorts, view cross-partner Readiness & Strength benchmarks. |
| **`TRAINER`** | QA Specialists, Primary Trainers, Outbound SMEs, Supervisors | Google Workspace SSO (`@logicall.io`) | Upload PDFs, generate/preview/edit Campaign Tracks, publish tracks & delta updates, review agent simulation transcripts and missed-question heatmaps across divisions. |
| **`PARTNER_SUPERVISOR`** | BPO Operations Managers & Team Leads (`THS`, `NGA`, `DOZ`, `ZIM`, `MRR`, `Call Core`) | Invite Link / Email or `LC`-ID + Password (or Google OAuth) | **Strictly Partner-Isolated:** View completion progress, simulation scores, and strength/weakness radars **only** for agents belonging to their own `partnerCohortId`. Cannot create/edit tracks or view other partners. |
| **`AGENT`** | Internal CSRs, LATAM Outbound Agents, BPO CSRs, Telehealth Agents | Google SSO (`@logicall.io`) OR `LC`-ID / Email + Password / Cohort Join Code | Complete assigned Campaign Tracks (Briefing Cards → Mastery Drills → Live Call Sim), earn XP/streaks/certifications, retry weak skills, and view own personal Skill Radar. |

---

## 5. End-to-End User Journeys

### 5.1 Non-Technical Trainer Flow ("Upload PDF & Off to the Races" — Under 2 Minutes)
1. **Create Track (1 Screen, 3 Inputs):** Trainer clicks **`+ New Campaign Track`**, chooses **Division** (`Telehealth`, `Inbound`, or `Outbound`), types the **Campaign Name** (e.g., `MVP Retention & Escalations`), and drags-and-drops the **PDF Playbook**.
2. **Automated AI Synthesis (Live Progress Stream):** No node graphs, prompt boxes, or low-code builders. The trainer watches a clean real-time progress stepper as the AI extracts PDF pages, identifies 4 Competency Pillars, builds 3–6 sequential **Checkpoints**, generates **Briefing Cards** and **Mastery Drills** (across 5 interactive formats), and crafts 2–3 **Live Call Sim** personas with grading rubrics.
3. **Plain-English Review & Test-Play:** Trainer lands on a clean split-pane **Track Studio** view where they can click through the generated cards/drills just like an agent, click any text inline to tweak a number or phrase in plain English, or click **`Regenerate Item`** on any individual card/question.
4. **1-Click Publish & Assign:** Trainer selects which Cohorts (`All Inbound`, `THS`, `DOZ`, etc.) should take the track and clicks **`Publish Track`**, generating a shareable direct link alongside automatic dashboard assignment.
5. **PDF Update / Re-Certification Flow:** If a campaign policy changes later, the trainer uploads the revised PDF onto the existing track; the system generates a new `TrackVersion` so newly assigned or re-certified agents train on the latest policy while historical records remain intact.

### 5.2 Trainee ("Agent") Duolingo-Style Mastery Loop
1. **Assigned Tracks & Visual Checkpoint Map:** Agent logs in and sees their assigned Campaign Tracks with clear completion badges and due tags. Opening a track displays a tactile vertical **Checkpoint Path**:
   * **Checkpoint 1..N:** Each Checkpoint pairs **Briefing Cards (Learn)** + **Mastery Drills (Test)** (~3–5 minutes per checkpoint).
   * **Final Boss Checkpoint:** Unlocks once Checkpoints 1..N reach mastery—launches the **Live Call Sim (Textual Conversation)**.
2. **Stage 1 — Briefing Cards (Learn):** Swipe/keyboard-navigable cards presenting one concept at a time: crisp headline, bulleted operational rule, highlighted `DO` vs. `DON'T` comparison, key metric callout (e.g., `25% → 50% → 70%` vs. `Medical = 70% Immediate`), and a clickable `"Source: Page 4"` reference badge.
3. **Stage 2 — Mastery Drills (Test + Mistake Recovery):**
   * Mixes 5 interactive drill types: **Scenario Multiple Choice**, **Policy True/False**, **Call-Flow Step Ordering**, **Concept/CRM Matching Pairs**, and **Tap-to-Fill Script Completion**.
   * Immediate visual feedback after every answer explaining *why* it is right or wrong (citing the PDF rule).
   * **Mandatory Mistake-Recovery Queue:** Any missed drill item is automatically re-queued at the end of the checkpoint; the agent cannot complete the checkpoint until every missed concept has been answered correctly.
4. **Stage 3 — Live Call Sim (Textual Conversation Verification):**
   * Agent sees a realistic **Caller / Patient Context Ticket** (e.g., *Queue: Flow A — MVP | Incoming Chat/Call Transcript*) and the AI counterparty sends the opening message (e.g., *"I ordered three bottles last week and my cardiologist just told me I can't take this—I want all my money back right now!"*).
   * Agent types natural conversational responses in real time. The AI counterparty dynamically reacts based on whether the agent verifies identity, follows the right policy branch, shows empathy, or makes an unauthorized promise.
   * When the conversation concludes (6–10 turns), the agent selects the **Call Disposition** they would log, and the **AI Rubric Judge** displays an instant **Simulation Scorecard** (0–100%, Pass threshold default `80%`) with per-pillar scores, exact quotes from the agent's transcript, and concrete coaching tips.

### 5.3 Leadership, QA & Partner Supervisor Analytics ("Strengths & Blind Spots")
1. **Executive & Division Readiness Overview:** Completion rates, average simulation pass rates, certification velocity, and overdue trainees filtered by Division (`Telehealth`, `Inbound`, `Outbound`), Campaign Track, and BPO Partner Cohort.
2. **Strengths & Competency Heatmap:** Cross-tabulates **Agents / Partner Cohorts × Competency Pillars** (e.g., revealing at a glance that `DOZ` scores `94%` on *Empathy & Tone* but `68%` on *Save-Offer Retention Ladders*, whereas `THS` scores `91%` across both—giving leadership objective data for campaign queue assignments).
3. **Playbook Gap Detector ("Most Missed Rules"):** Lists the exact drill questions and simulation rubric criteria with the highest failure rates, alerting trainers whether agents need coaching or whether the underlying Campaign PDF itself is ambiguous.
4. **Individual Agent Readiness Passport:** Shows an agent's certified campaigns, radar chart of strengths across pillars, XP/streak consistency, and full auditable transcripts of their completed Live Call Sims.
