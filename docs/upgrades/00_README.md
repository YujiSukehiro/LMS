# LogiCall Pulse Upgrade Plan

**Document status:** Review and implementation plan only. No application upgrade has been performed by these documents.

**Review date:** 2026-11-01

**Product context:** Internal training for Standard Meds inbound and outbound calls. Local AI is an MVP implementation choice, not a permanent product dependency. Support the existing MLX models through a generic local HTTP adapter when compatible, retain Ollama as an alternative, and keep manual chat-assisted work available. A hosted AI API is not available and must not become a prerequisite.

## 1. Executive conclusion

LogiCall Pulse has a useful product foundation: a trainer can turn a playbook into briefings, knowledge drills, and text roleplay; learners receive feedback; trainers can edit and publish curriculum; and readiness data is available by agent and cohort. The provider abstraction, staged generation, structured-output validation, hidden scoring rubrics, server-side score arithmetic, and published curriculum versions are worth keeping.

The current application is not yet a reliable measure of readiness for real Standard Meds calls. Its main weakness is not the user interface. It is the gap between **reading and chatting about a playbook** and **performing the correct call workflow under constraints**.

The five highest-risk findings are:

1. **Curriculum can be incomplete while appearing valid.** Generation handles one PDF at a time, while several playbooks inherit universal rules from another playbook. Page-number validation does not prove that generated statements are supported by the cited text.
2. **A text conversation cannot certify call execution.** The current simulation does not observe pre-call checks, local calling-time validation, SMS choice, system updates, recording controls, escalation fields, notes, suppression, or confirmation screens.
3. **Certification is too easy to obtain and too hard to invalidate.** One passing generated scenario can certify a learner after unit completion. Required high-risk branches are not mandatory, and certification is not revoked when required content changes.
4. **Safety decisions depend too heavily on model output.** Auto-fail is a model-produced boolean evaluated after the conversation. Critical compliance rules need deterministic triggers and evidence gates.
5. **The configured local runtime is currently blocked.** Installed models do not prove chat capability. The configured fast model fails the structured-output health check, so live roleplay cannot be treated as operational.

The upgrade should therefore focus on four things, in order:

- establish a trainer-approved source of truth across related documents;
- make local generation and roleplay reliable and resumable;
- add deterministic call states and a synthetic workflow-action sandbox;
- make learning, certification, and analytics reflect retained skill and required coverage.

## 2. What the application is intended to do

The intended learning loop is sound:

1. A trainer uploads a playbook PDF.
2. The system extracts source material and generates a versioned curriculum.
3. The learner studies BriefingCards.
4. The learner completes five drill types with feedback and mistake recovery.
5. The learner performs textual roleplay against an AI actor and receives an AI-assisted scorecard.
6. The system records progress, certification, missed rules, and cohort readiness.
7. Trainers review and edit generated content before publication.

This is a good **knowledge-acquisition and rehearsal shell**. It needs a stronger **grounding, workflow, and evidence layer** before it can support operational readiness claims.

## 3. Existing strengths to preserve

- **Local-first provider design:** The existing gateway and Ollama adapter provide a useful boundary. Add MLX through one generic local HTTP adapter rather than coupling the app to MLX.
- **Structured AI boundaries:** Schema validation and staged generation are better than unbounded free-form generation.
- **Trainer-controlled publishing:** Editable drafts and immutable published versions provide a useful governance base.
- **Separation of actor and judge:** Hidden rubrics and server-side score arithmetic are appropriate foundations.
- **Immediate learner feedback:** Briefings, varied drills, scorecards, and mistake review can support learning when retrieval is improved.
- **Role-aware views:** Learner, trainer, supervisor, and admin workflows already reflect an internal training product.
- **Replay for demonstrations:** Canned replay is useful for UI development, provided it is never presented as live AI or readiness evidence.

## 4. Priority model

| Priority | Meaning | Required outcome |
|---|---|---|
| P0 | Blocks safe or truthful use | Repair local chat capability; label replay honestly; stop unsupported certification claims; protect sensitive synthetic data. |
| P1 | Required for valid Standard Meds training | Multi-document rule inheritance; grounded content approval; deterministic compliance; required scenarios; workflow actions; server-authoritative attempts. |
| P2 | Required for a durable internal tool | Resumable generation; manual chat exchange; trainer QA; spaced retrieval; recertification; useful analytics; golden acceptance tests. |
| P3 | Optional later expansion | Local voice/audio rehearsal and additional channels after text and workflow evidence are trustworthy. |

P0–P2 are in the next implementation scope. P3 voice is explicitly deferred.

## 5. Recommended target architecture

Keep the current Next.js, React, Firebase, and local-provider direction. Add these capabilities rather than replacing the application:

- **Source bundle:** Ordered PDFs, shared rule packs, structured operational assets, precedence, effective dates, and SME conflict resolution.
- **Grounded curriculum:** Generated claims linked to exact source excerpts and reviewed by a trainer before publication.
- **Local AI workbench:** Model capability preflight, stage checkpoints, resume, provenance, and manual prompt-package export/import.
- **Simulation state machine:** Deterministic channel, funnel stage, customer state, consent, offer count, action availability, disposition, and critical failures.
- **Synthetic operations sandbox:** Fake ReFlow, Dosable, SMS, Slack, recording, notes, and confirmation states. No live integrations.
- **Evidence-based evaluation:** Server-recorded dialogue and actions; deterministic hard gates; AI coaching limited to supported judgments.
- **Mastery record:** Server-authoritative attempts, delayed retrieval, required scenario coverage, versioned certification, and current-versus-historical readiness.

## 6. Standard Meds scope

All nine supplied PDFs are in scope:

1. Training Hub Overview
2. Neuropathy — NeuroCalmRx
3. Anti-Aging Skin — LiftRx
4. Erectile Dysfunction — QuattroRx / TriShot
5. Nail Fungus — ZoliraRx
6. Longevity — NAD+ Therapy
7. Customer Support — All Products
8. Medical Chat — Pending Information
9. Renewals — Failed Payment

The product playbooks are not interchangeable templates. They differ in funnel stage, pricing posture, link destination, plan logic, medical boundary, privacy risk, and required system action. The upgrade must preserve those differences.

## 7. Baseline verification

The following checks were run against the current application before writing this plan:

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run test:unit` | Passed: 7 files, 48 tests |
| `npm run build` | Passed |
| `npm run verify:ollama` | Failed |
| Firestore rules tests | Not run |
| Playwright end-to-end tests | Not run |

The Ollama check found both configured models installed, but structured output failed with:

```text
Ollama /api/chat returned HTTP 400: {"error":"\"clef-flash:9b-mxfp8\" does not support chat"}
```

This is a confirmed P0 blocker for the current Ollama profile, not a reason to build complex local infrastructure. Validate the existing MLX server first through a generic local HTTP adapter. If MLX passes, no Ollama repair is required for the MVP. Any selected profile must pass capability-based preflight; manual chat remains the fallback.

The current Git repository is on `main` with **no commits**; project files are untracked. A normal Git worktree cannot provide the requested fallback. The implementation handoff therefore requires a full workspace-contained copy, Git initialization in that copy only, and a baseline commit before changes.

## 8. Document map

Read the documents in order. Implementation must not begin from this summary alone.

| Document | Purpose |
|---|---|
| [01 — Application and Learning Review](01_APPLICATION_AND_LEARNING_REVIEW.md) | Detailed product, learning, inbound, outbound, and analytics findings. |
| [02 — Source of Truth and Curriculum Quality](02_SOURCE_OF_TRUTH_AND_CURRICULUM_QUALITY.md) | Multi-document sources, citations, conflicts, operational assets, and approval gates. |
| [03 — Local AI Runtime and Reliability](03_LOCAL_AI_RUNTIME_AND_RELIABILITY.md) | Thin MLX/Ollama provider boundary, preflight, checkpoints, provenance, replay, and manual chat exchange. |
| [04 — Call and Workflow Simulation](04_CALL_AND_WORKFLOW_SIMULATION.md) | Deterministic scenarios, action evidence, synthetic systems, and compliance gates. |
| [05 — Learning, Certification, and Analytics](05_LEARNING_CERTIFICATION_AND_ANALYTICS.md) | Retrieval practice, attempt integrity, required coverage, recertification, and honest metrics. |
| [06 — Standard Meds Content Pack](06_STANDARD_MEDS_CONTENT_PACK.md) | Track structure, source pages, required scenario matrices, conflicts, and golden cases. |
| [07 — Implementation and Acceptance Plan](07_IMPLEMENTATION_AND_ACCEPTANCE_PLAN.md) | Phases, file and data impacts, migrations, tests, rollout, rollback, and definition of done. |
| [08 — ASD-STE100 Next-Chat Prompt](08_ASD_STE100_NEXT_CHAT_PROMPT.md) | Paste-ready instructions for implementation in a protected workspace-contained fork. |

## 9. Scope and non-goals

### In scope

- Internal-only training with synthetic people, orders, messages, and payment events.
- Text roleplay plus observable workflow actions.
- Replaceable local MLX/Ollama adapters and manual chat-assisted generation without a hosted API.
- Trainer review, source evidence, repeatable acceptance fixtures, and operational analytics.
- Backward-compatible migration where practical, with explicit legacy-data labels where not.

### Out of scope for the first implementation

- Live Dosable, ReFlow, Slack, SMS, dialer, payment, or patient-portal actions.
- Real patient or customer records, identity documents, health details, or card data.
- Medical advice, clinical validation of playbook claims, or legal approval of policies.
- A required cloud LLM, new hosted dependency, or external AI key.
- Production voice certification or automated audio scoring.
- Replacing the application framework or redesigning every screen.

## 10. Release position

Until P0 and P1 are complete, present the application as a **curriculum and text-rehearsal prototype**, not as proof that an agent is ready for live calls. Demo replay results and ungrounded generated content must not count toward readiness or certification.

The desired release claim after P0–P2 is narrower and defensible:

> The learner demonstrated required knowledge, completed mandatory synthetic call branches, performed the required workflow actions, and avoided defined critical failures in the approved curriculum version.

That claim still does not replace supervised live-call assessment.
