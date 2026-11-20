# Connor Approval Gate Log

**Last updated:** 2026-11-17
**Policy configuration:** [training-policy.ts](../src/lib/policy/training-policy.ts)

This log tracks every product, policy, content, or infrastructure decision that requires Connor's explicit sign-off (`GATE-01`..`GATE-08`).
Everything **not** blocked by these gates has been implemented and verified across all 8 automated stages of `npm run verify:usable` (including Firebase Emulators, live Playwright Chrome click-through E2E, and local MLX `Qwen2.5-7B-Instruct-4bit` runtime). Each gate pauses **only** its narrow policy flip or irreversible destructive step until Connor approves.

---

## Summary Table

| Gate | Decision Needed | Current Safe Default in App | Paused Until Connor Approves | Flip / Action Location |
| :--- | :--- | :--- | :--- | :--- |
| **GATE-01** | Permanently delete legacy dialer/CRM files vs retain read-only compatibility | `simulationInteractionMode = 'verbal_only'` (all dialer UI & required actions stripped) | Deleting `scenario-state.ts`, `simulation-state.ts`, `SyntheticOperationsPanel.tsx`, and `/api/simulations/[sessionId]/action` | `TRAINING_POLICY.simulationInteractionMode` + file cleanup |
| **GATE-02** | Keep Call Dispositions removed in Verbal Practice vs add a 1-question Playbook Disposition check | `requireDispositionInVerbalPractice = false` (no disposition popup; grades directly) | Re-enabling a post-conversation Playbook Disposition knowledge check | `TRAINING_POLICY.requireDispositionInVerbalPractice` |
| **GATE-03** | Allow same-sitting certification vs require delayed spaced review before certification | `allowSameSittingRuleMastery = false` (spaced-review Retention Hub built; single-drill mastery fixed) | Allowing initial first-try Checkpoint drills to certify immediately in one sitting | `TRAINING_POLICY.allowSameSittingRuleMastery` |
| **GATE-04** | Allow hosted Gemini AI (`hosted_ai`) runs to grant official Track certification | **Approved 2026-11-20:** `allowHostedAiForCertification = true` | — | `TRAINING_POLICY.allowHostedAiForCertification` |
| **GATE-05** | Enforce `divisionIds` on learner Track visibility alongside Cohort assignment | `enforceLearnerDivisionVisibility = false` (cohort-only visibility) | Restricting Tracks to matching `user.divisionIds` | `TRAINING_POLICY.enforceLearnerDivisionVisibility` |
| **GATE-06** | Git commit snapshot & promote `upgrade-fork/` over the Oct 31 root prototype | No commits run; all active work remains in `upgrade-fork/` | Creating git commits / tags and replacing the parent workspace prototype | Git repo + root directory |
| **GATE-07** | Resolve Standard Meds SME policy conflicts (`SME-01`..`SME-10`) and publish packs | All 9 Standard Meds packs remain drafts; no SME decision fabricated | Recording SME resolutions and approving excerpts to publish the 9 packs | `src/lib/content/standard-meds/publication.ts` |
| **GATE-08** | Production Firebase Auth, Cloud Run timeouts, edge rate-limits & `firestore.rules` | `firestore.rules` untouched; local emulator settings only | Editing `firestore.rules`, disabling public signup, setting Cloud Run / App Check rules | `firestore.rules`, `apphosting.yaml`, Firebase Console |

---

## Detailed Gate Decisions

### GATE-01 — Legacy Dialer & CRM Code Removal
- **What is done now:** All learner-facing dialer/CRM simulation controls (`SyntheticOperationsPanel`, inspect local time, dial button, fake SMS, fake Slack, fake payment tokens, recording toggle, workflow checkboxes) and Studio dialer authoring panels (`ScenarioContextEvidenceEditor`, `ScenarioQASection`) are completely disabled and hidden in active `verbal_only` mode. Sessions start directly in conversation (`in_call`) and grade purely on verbal accuracy and spoken playbook rules.
- **What is paused:** Permanently deleting `src/components/simulation/SyntheticOperationsPanel.tsx`, `src/lib/services/scenario-state.ts`, `src/lib/schemas/simulation-state.ts`, `src/app/api/simulations/[sessionId]/action/route.ts`, and related Studio fixture panels so historical session records and unit tests remain backward-compatible until you confirm permanent deletion.
- **To approve:** Say *"Approve GATE-01 deletion"* to remove the dormant dialer modules completely, or *"Keep GATE-01 as-is"* to leave compatibility schemas intact.

### GATE-02 — Call Dispositions in Verbal Practice
- **What is done now:** `TRAINING_POLICY.requireDispositionInVerbalPractice` is `false`. Agents click **"Finish & Grade Practice"** directly after speaking/chatting with the AI counterparty—no disposition picker modal appears, and the scorecard focuses purely on verbal criteria and coaching.
- **What is paused:** Whether you ever want an optional 1-question **"Which Playbook disposition applies to this scenario?"** knowledge check at the end of Verbal Practice.
- **To approve:** Say *"Keep GATE-02 off"* (permanent removal of disposition picking) or *"Flip GATE-02 on"* to set `requireDispositionInVerbalPractice = true`.

### GATE-03 — Same-Sitting Certification vs Delayed Retention Gate
- **What is done now:** Fixed the single-drill mastery trap in `certification.ts` so `spaced_review` attempts satisfy rule mastery (alongside `varied_retrieval`), synchronized `reviewSchedules` document IDs across seeding and live submissions, and shipped the full **Knowledge Retention Hub** (`/learn/review`) + **Agent Home Retention Card** + `POST /api/progress/complete-review` certification reconciliation.
- **What is paused:** Whether completing all Checkpoints + passing Verbal Practice in one sitting should immediately award **Campaign Certified** (making Retention Hub an ongoing *"Keep-Sharp / Retention Health"* tracker), vs keeping `allowSameSittingRuleMastery = false` so learners must also clear a delayed retrieval review before initial certification.
- **To approve:** Say *"Approve GATE-03 single-sitting certification"* (flips `allowSameSittingRuleMastery = true`) or *"Keep GATE-03 delayed mastery"*.

### GATE-04 — Hosted Cloud AI (`hosted_ai` / Gemini) Certification
- **What is done now:** `certification.ts` rejects `hosted_ai` provenance by default, preserving Phase 1–5's local-only certification boundary.
- **What is paused:** Allowing `hosted_ai` (Gemini) to grant official certifications once deployed to Firebase App Hosting / Cloud Run without a local MLX server.
- **To approve:** Say *"Approve GATE-04 hosted AI certification"* (flips `allowHostedAiForCertification = true`).

### GATE-05 — Learner Track Visibility (`divisionIds` Enforcement)
- **What is done now:** Learners see all `PUBLISHED` tracks assigned to `'ALL'` or their `partnerCohortId`.
- **What is paused:** Filtering learner track visibility by `user.divisionIds` in addition to `partnerCohortId`.
- **To approve:** Say *"Approve GATE-05 division filtering"* or *"Keep GATE-05 cohort-only"*.

### GATE-06 — Git Commit & Workspace Consolidation
- **What is done now:** All changes stay cleanly inside `upgrade-fork/` with zero git commits, resets, or modifications to the Oct 31 root prototype.
- **What is paused:** Creating git commit(s) on `feature/standard-meds-learning-upgrades` and promoting `upgrade-fork/` to become the single primary repo at workspace root.
- **To approve:** Say *"Approve GATE-06 commit & consolidate"* (or commit only first).

### GATE-07 — Standard Meds SME Content Sign-Offs & Pack Publication
- **What is done now:** All 9 Standard Meds packs remain registered drafts with explicit `STANDARD_MEDS_SME_DECISIONS` (`SME-01` through `SME-10`) intact—no conflict was guessed or auto-approved.
- **What is paused:** Recording SME policy resolutions for `SME-01`..`SME-10`, converting the 9 Standard Meds draft packs to verbal-only scenarios with approved excerpts, and publishing them to cohorts.
- **To approve:** Walk through `SME-01`..`SME-10` in [publication.ts](../src/lib/content/standard-meds/publication.ts) and designate which packs to publish.

### GATE-08 — Production Security, Auth & `firestore.rules`
- **What is done now:** `firestore.rules` is completely unmodified; `npm run test:rules` is wired into `npm run verify:usable`.
- **What is paused:** Requiring `email_verified` / Google SSO for internal ops, disabling public email/password sign-up in Firebase Auth, adding edge/App Check rate-limiting on `/join/[code]`, setting Cloud Run request timeouts (`apphosting.yaml`), and any production `firestore.rules` changes.
- **To approve:** Confirm production deployment checklist items when ready to deploy to Firebase.
