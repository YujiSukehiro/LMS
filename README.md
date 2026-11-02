# LogiCall Pulse — Campaign Readiness & Simulation LMS

**LogiCall Pulse** is an AI-powered campaign training and conversational simulation platform purpose-built for **LogiCall Services Inc.** across **Telehealth**, **Inbound Operations**, and **Outbound Sales Operations** (spanning internal `@logicall.io` staff and external BPO partner cohorts: `THS`, `NGA`, `DOZ`, `ZIM`, `MRR`, `Call Core`, and `LATAM Direct`).

Non-technical trainers simply upload a campaign PDF Playbook and publish—AI automatically generates progressive **Briefing Cards (Learn)**, **5-Mechanic Mastery Drills (Test + Mistake Recovery)**, and **Live Call Simulations (Textual Roleplay + Rubric Grading)** while mapping every agent's and partner cohort's exact strengths and blind spots.

---

## Key Architectural Highlights

* **Zero-Config PDF-to-Training Flow:** 3 inputs (`Division`, `Campaign Title`, `PDF Upload`) → live SSE-streamed curriculum generation → plain-English inline preview/edit → 1-click Cohort assignment.
* **Local LLM First → Cloud API Second:**
  * **Iteration 1 (Local macOS — \$0.00):** Runs 100% locally against **Ollama** (`clef:27b-mxfp8` for curriculum synthesis & rubric grading + `clef-flash:9b-mxfp8` for streaming roleplay chat) and the **Firebase Local Emulator Suite**.
  * **Iteration 2 (Google Cloud Production — ~\$4/month at 150 users):** Single env toggle (`AI_PROVIDER=gemini`) switches to **Google Gemini 2.5 Flash & Flash-Lite** hosted on scale-to-zero **Firebase App Hosting (Cloud Run `minInstances: 0`)**, **Cloud Firestore Standard Edition (Free Tier)**, **Firebase Auth**, and **Cloud Storage**.
* **Google Workspace + Zero-License BPO Auth:** 1-click Google OAuth for `@logicall.io` staff + synthetic `LC`-ID (`LC-1042`) / Cohort Join Code login for external BPO contractors who do not have corporate mailboxes, with strict cryptographic BPO partner isolation and instant zero-data-loss offboarding.

---

## Architectural & Technical Documentation Suite

| Document | Purpose |
| :--- | :--- |
| [`docs/01_PRODUCT_AND_DOMAIN_SPEC.md`](docs/01_PRODUCT_AND_DOMAIN_SPEC.md) | Operational goals across Telehealth, Inbound, and Outbound; clean-room brand differentiation (`Slate & Signal`); user roles; BPO cohort isolation; end-to-end trainer, agent, and leadership journeys. |
| [`docs/02_SYSTEM_ARCHITECTURE_AND_COST_MODEL.md`](docs/02_SYSTEM_ARCHITECTURE_AND_COST_MODEL.md) | Iteration 1 vs. Iteration 2 system topology, tech stack rationale, line-by-line **~\$4.02/month** cost model for 150 active users, Firestore document-bundling rules, and complete repository file tree. |
| [`docs/03_DATA_MODEL_AND_SECURITY_SPEC.md`](docs/03_DATA_MODEL_AND_SECURITY_SPEC.md) | Firestore collection hierarchy, canonical TypeScript + Zod schemas (`Users`, `Cohorts`, `Tracks`, 5 `Drill` mechanics, `Public` vs. `Secret` simulation rubrics, `Enrollments`, `AnalyticsRollups`), composite indexes, and RBAC offboarding guarantees. |
| [`docs/04_AI_GATEWAY_AND_PDF_PIPELINE_SPEC.md`](docs/04_AI_GATEWAY_AND_PDF_PIPELINE_SPEC.md) | Provider-agnostic `LLMGateway` interface, `OllamaProvider` (`clef:27b-mxfp8` / `clef-flash:9b-mxfp8` with JSON schema self-repair) & `GeminiProvider`, `unpdf` extraction, 4-stage SSE curriculum pipeline, and dual-agent Roleplay Actor + Rubric Judge math. |
| [`docs/05_LEARNING_ENGINE_AND_UI_DESIGN_SPEC.md`](docs/05_LEARNING_ENGINE_AND_UI_DESIGN_SPEC.md) | `"Slate & Signal"` CSS design tokens, modern web standards (`<dialog>`, Popover, keyboard-first navigation), Trainer Studio UX, Duolingo-style Checkpoint Map & Mistake-Recovery loop, Live Call Sim UI, and Strengths/Readiness Heatmaps. |
| [`docs/06_API_CONTRACTS_AUTH_AND_DEPLOYMENT.md`](docs/06_API_CONTRACTS_AUTH_AND_DEPLOYMENT.md) | Complete REST + SSE endpoint specifications, `@logicall.io` Google SSO + `LC`-ID auth handshake, `.env.example`, `firebase.json`, `apphosting.yaml`, and Iteration 1 → Iteration 2 cutover runbook. |
| [`firestore.rules`](firestore.rules) | Production-hardened Cloud Firestore Security Rules enforcing `active == true`, role permissions, anti-cheat secret rubric protection, and BPO partner cohort isolation. |
| [`docs/07_ASD_STE100_CLAUDE_OPUS_SWARM_PROMPT.md`](docs/07_ASD_STE100_CLAUDE_OPUS_SWARM_PROMPT.md) | **ASD-STE100 (Simplified Technical English)** Master Swarm Prompt engineered for **Claude Opus 5.5** (`PHASE 0` shared contract lock → `PHASE 1` 5-agent parallel build with zero file overlap → `PHASE 2` automated verification gate). |
