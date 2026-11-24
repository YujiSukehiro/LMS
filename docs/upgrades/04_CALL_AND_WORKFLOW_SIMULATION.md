# 04 — Call and Workflow Simulation

## 1. Objective

Upgrade text roleplay into an evidence-producing rehearsal of the complete call: inspect before dialing, conduct the conversation, perform synthetic system actions, wrap up correctly, and receive deterministic compliance results plus local-AI coaching.

The first implementation remains text-based. It must not claim to measure audible speaking or listening skill.

## 2. Current limitation

The existing simulation engine can produce a plausible conversation and scorecard, but it does not observe most actions that determine whether a Standard Meds call was performed correctly. A textual claim such as “I updated the card” is not equivalent to a confirmed update. A model-produced auto-fail boolean is not a sufficient compliance control.

The target is not a full clone of Dosable or ReFlow. It is a small synthetic sandbox that exposes the decisions and evidence required by the playbooks.

## 3. Scenario taxonomy

Every scenario must declare these dimensions explicitly:

```ts
type ScenarioContext = {
  direction: 'outbound' | 'inbound' | 'callback';
  queue: 'recovery' | 'customer_support' | 'medical_chat' | 'renewals';
  product: string;
  stage: 'dosage' | 'checkout' | 'dosage_checkout' | 'score' | 'support_case' | 'pending_info' | 'renewal_declined';
  contactState: 'lead' | 'existing_patient' | 'third_party' | 'voicemail';
  pricingPosture: 'active' | 'passive' | 'not_applicable';
  caseBranch: string;
  syntheticTimezone: string;
  syntheticNow: string;
  sourceRevision: string;
  curriculumVersion: string;
};
```

Do not infer stage only from a title. Stage determines allowed dialogue goals, pricing behavior, links, available actions, and outcomes.

## 4. Deterministic scenario state

Use a server-owned state machine around the current actor. The local model produces customer dialogue; it does not own operational state.

### 4.1 Lifecycle

```text
draft
  -> pre_call
  -> ready_to_dial
  -> in_call
  -> wrap_up
  -> evaluated

Any active state -> aborted (with reason and preserved evidence)
```

Evaluation requires minimum evidence and completed wrap-up. A learner cannot obtain a full assessment after one agent turn.

### 4.2 State categories

The state should include, as applicable:

- synthetic person, order, queue, and timezone records;
- whether identity and order details were inspected;
- whether the chat was opened and its current branch understood;
- local-time eligibility and recording-disclosure requirement;
- contact reached: patient, third party, voicemail, or no answer;
- identity verification state;
- customer intent, objection, clinical-risk branch, and opt-out state;
- pricing exposure and selected plan;
- offer and re-offer counts;
- verbal SMS permission and SMS send state;
- portal, chat, payment, subscription, and order states;
- recording state;
- escalation state and payload;
- notes and suppression state;
- actual confirmation events;
- selected disposition;
- critical failures and rule evidence.

State transitions must be validated on the server. The browser requests an action; it does not directly set outcome state.

## 5. Evidence event log

Record an append-only event for every learner turn, actor turn, and workflow action:

```ts
type SimulationEvent = {
  id: string;
  sessionId: string;
  sequence: number;
  actor: 'learner' | 'customer' | 'system' | 'engine';
  type: 'utterance' | 'inspect' | 'dial' | 'verify_identity' | 'sms' | 'record' | 'order_update' | 'subscription_update' | 'escalate' | 'note' | 'suppress' | 'disposition' | 'evaluate';
  payload: Record<string, unknown>;
  stateHash: string;
  occurredAt: string;
  provenance: 'learner' | 'deterministic' | 'local_ai' | 'manual_chat' | 'replay';
};
```

Payloads must be redacted and schema-validated. Use event IDs in judge citations, trainer review, analytics, and golden tests. Do not store full sensitive form values; store only safe synthetic tokens and outcomes.

A session must include:

- scenario and curriculum versions;
- source bundle revision;
- model/runtime profile or manual/replay provenance;
- initial state and scenario seed;
- event log;
- deterministic gate results;
- judge result and evidence references;
- disposition validation;
- assessment eligibility.

## 6. Synthetic operations sandbox

Create an integrated panel beside the transcript. All records and actions are fake and labeled `SYNTHETIC TRAINING`.

### 6.1 ReFlow sandbox

Support only scenario-required functions:

- queue rows and drawer details;
- product, plan, amount, days overdue, and safe synthetic decline labels;
- stale/organic indicators discoverable through inspection;
- personalized link assets represented by opaque training IDs;
- notes, callback, suppression, and disposition controls;
- order-link availability and fallback synthetic customer identifier.

Do not connect to ReFlow or open live order links.

### 6.2 Dosable/portal sandbox

Support scenario-required states and controls:

- subscription status and tenant;
- Pending filters and nail-image/visit indicators;
- synthetic Doctor/Patient chat in read-only mode;
- patient-replied versus unanswered states;
- order details, pause, cancellation, and price update;
- `Next order only` state;
- synthetic Masquerade/portal guide;
- card-update workflow and explicit success/error confirmation;
- no permission to write as the patient in the medical chat.

Do not collect real credentials, ID images, medical answers, or payment data. ID and clinical-response actions are represented by synthetic completion events such as `patient_confirmed_id_submitted`, not uploaded documents.

### 6.3 SMS sandbox

- Show only approved symbolic link assets.
- Require the correct scenario state and verbal permission where applicable.
- Produce a fake message in a local outbox.
- Never send a network request.
- Block SMS after opt-out or voicemail.
- Record the exact asset ID and scenario stage.

### 6.4 Slack/escalation sandbox

- Provide local channel/thread choices required by the scenario.
- Validate required fields such as order ID, vertical, tracking state, or requested correction.
- Reject direct identifiers and health details using structured field separation plus sensitive-pattern checks.
- Never tag a real user or send to Slack.
- Store a safe synthetic escalation receipt for evidence.

### 6.5 Recording and secure-payment sandbox

- Provide pause/resume controls and visible recording state.
- Require paused recording before the simulated card-entry event and resumed recording afterward.
- Accept only designated fake payment tokens in the synthetic secure form; reject real-looking card numbers.
- Do not echo or log the token.
- Generate explicit `confirmation_shown` or `update_failed` events according to scenario state.
- Prevent card data in notes, chat, escalation, exports, or AI prompts.

## 7. Pre-call evidence

A scenario may require the learner to complete inspections before `ready_to_dial`.

Examples:

### Outbound recovery

- correct product and stage;
- lead’s synthetic local time within 09:00–21:00;
- recording-disclosure requirement;
- current plan/price exposure and selected link asset;
- previous opt-out or suppression state.

### Customer Support

- correct patient and order;
- identity-verification requirements;
- current subscription state and previous cancellation requests;
- relevant charge, tracking, or order details.

### Medical Chat

- correct tenant and Pending filter;
- order date and derived days remaining;
- Doctor/Patient chat inspected after the automated welcome;
- patient has not already replied;
- identity, clinical, or nail-photo branch correctly identified;
- priority consistent with day-6/day-5 urgency.

### Renewals

- correct product, amount, plan, days overdue, and notes;
- deliberate-cancellation exclusion checked;
- current state checked for stale/organic resolution;
- safe handling plan for decline reason and card data.

Unnecessary dialing of an already-resolved case should produce the scenario’s defined failure or coaching result, not be ignored.

## 8. During-call evidence

The engine must observe dialogue and action together.

Required examples:

- identity verification before protected account discussion;
- no product or clinical detail disclosed to a third party;
- no diagnosis, medical reassurance, or answer coaching;
- severe-reaction branch produces emergency guidance before cancellation workflow;
- opt-out ends the sales attempt and triggers suppression;
- offers occur in the approved sequence and within count limits;
- TriShot base recovery precedes any soft upgrade offer;
- NAD+ Score does not introduce price unless the customer asks;
- SMS uses the correct link after permission and not on voicemail;
- card workflow pauses recording and waits for actual confirmation;
- no promise of refund, approval, shipment date, or unapproved arrangement.

For structured actions, use deterministic event rules. For free-text meaning, use a versioned rule/intent classifier with scenario-specific tests and evidence. A local model may assist classification, but unknown or low-confidence critical classifications must be marked for review rather than silently passed.

## 9. Wrap-up and disposition evidence

The learner must complete required notes, callback, suppression, escalation, and disposition actions before evaluation.

Canonical dispositions:

- `Recovered`;
- `Callback scheduled`;
- `Didn't reply`;
- `Not interested`;
- `Organic`;
- `Lost`.

Eligibility is track-specific and state-derived:

- recovery link sent does not automatically mean `Recovered` unless the track defines that outcome precisely;
- Medical Chat `Recovered` requires the synthetic patient reply/upload completion during the call, not approval;
- Renewals `Recovered` requires the actual card-update confirmation;
- `Organic` requires evidence that the customer completed the target action before the call;
- `Callback scheduled` requires a specific synthetic date/time;
- `Didn't reply` covers no answer/voicemail as defined by the playbook;
- an expired Medical Chat window may require `Lost` and escalation, not a successful recovery.

The engine should explain a mismatched disposition and require correction before a passing wrap-up. Preserve the first incorrect choice as learning evidence.

## 10. Deterministic compliance gates

Each gate must define:

- stable rule ID and source ref;
- applicable context;
- trigger condition;
- required or forbidden event pattern;
- severity;
- evidence event IDs;
- result: `pass`, `fail`, `not_observed`, or `needs_review`;
- learner-safe feedback and trainer detail.

Critical examples:

| Gate | Passing evidence |
|---|---|
| Local calling window | Synthetic local time validated before dial |
| Opt-out | No further offer/SMS; suppression recorded |
| Identity privacy | Patient verified before protected details |
| Voicemail SMS | No SMS event in voicemail branch |
| Correct link | Approved asset ID matches product/stage/plan |
| Offer limit | Event count never exceeds approved maximum |
| Clinical boundary | No prohibited advice; approved routing behavior observed |
| Payment data | Recording paused; fake token only; no sensitive note/log |
| Renewal confirmation | Confirmation event precedes recovery claim/disposition |
| Medical Chat answer boundary | No agent answer, coached answer, or agent-received ID |
| Refund boundary | Escalation without promise or refusal |
| Repeat cancellation | No offer; immediate cancellation and required escalation/no-recontact behavior |

A critical fail prevents a passing assessment regardless of the model’s numeric score. `not_observed` on required evidence prevents certification; it is not a pass.

## 11. AI actor and judge roles

### Actor

- Stay within the scenario’s synthetic persona and branch.
- Respond to learner behavior without changing operational facts.
- Avoid introducing new medical or personal facts outside the approved scenario.
- Support scripted fallback turns for golden tests and model outages.
- Never emit system confirmations as customer dialogue.

### Judge

- Score only approved rubric dimensions.
- Reference event IDs for strengths and errors.
- Treat deterministic gate results as authoritative.
- Return `insufficient_evidence` when dialogue/action coverage is inadequate.
- Separate learner-facing coaching from hidden rubric and trainer analysis.
- Never turn replay output into eligible assessment evidence.

## 12. Minimum evidence and difficulty

Define per scenario:

- minimum learner turns appropriate to the branch;
- required pre-call inspections;
- required customer concerns or objections;
- required workflow actions;
- required wrap-up evidence;
- maximum allowed critical/major failures;
- expected duration as coaching metadata, not fake audio timing.

Difficulty should change persona, objection combinations, stale data, interruptions in workflow, and competing priorities—not remove safety requirements. Required critical branches must appear at STANDARD or higher difficulty and cannot be skipped by passing only an easy scenario.

## 13. Trainer scenario QA

Studio must provide:

- visual context and state summary;
- required evidence checklist;
- gate and disposition editor bound to approved rules;
- synthetic fixture editor with sensitive-data restrictions;
- scripted deterministic test mode;
- local-model preview clearly separated from assessment fixtures;
- event-log playback and judge-evidence review;
- validation for unreachable states, impossible pass conditions, and missing source refs.

Publishing requires at least one scripted golden pass and one golden critical-fail path for every required scenario.

## 14. Voice and audio boundary

P0–P2 remains text plus actions. Do not add fake timers or “tone scores” that imply audio analysis.

A later P3 voice phase may consider local microphone capture, local speech-to-text/text-to-speech, interruption and pace metrics, and human-reviewed audio samples. It must use a separately approved privacy design and must not block the current upgrade.

## 15. Acceptance criteria

- [ ] Every scenario declares direction, queue, product, stage, branch, and pricing posture.
- [ ] The server owns scenario state, transitions, action evidence, and assessment eligibility.
- [ ] Pre-call, during-call, and wrap-up evidence are required where applicable.
- [ ] ReFlow, Dosable/portal, SMS, Slack, recording, and payment actions are entirely synthetic.
- [ ] No live external action, real patient record, credential, ID document, health answer, or card data is accepted.
- [ ] Critical rules produce evidence-based deterministic gate results.
- [ ] The AI judge cannot override critical gates or invent operational confirmation.
- [ ] Dispositions are canonical and validated against observed state.
- [ ] Minimal-evidence sessions cannot pass or certify.
- [ ] Every required scenario has scripted pass and critical-fail acceptance paths.
- [ ] The UI states that text/action simulation does not assess audible call skills.

### 14.1 Voice update (2026-11-24, Connor approved option 2)

- Live dictation: the mic stays on until the learner turns it off, words appear while they talk, and it pauses while the
  caller replies or speaks, then resumes. Browser Web Speech API (free). Firefox has none; the mic shows as unavailable.
- Caller voice: each caller reply is read aloud with the browser's built-in speech voice (free), with a mute toggle.
- Delivery coaching: each spoken reply is recorded in the browser (Opus, 24 kbps). After the scorecard, the clips are
  sent once to `POST /api/simulations/[sessionId]/delivery`, which makes one Gemini call (`GEMINI_AUDIO_MODEL`, else
  `GEMINI_FAST_MODEL`) to score warmth, pace, conciseness, confidence and professionalism (1-5; overall 0-100 computed
  in code). It is coaching only: never part of the Rubric score, pass result or certification. Audio is not stored; only
  the scores and notes are saved on the session (`deliveryAssessment`). One assessment per session.
- Cost check: `npx tsx --env-file=.env.local scripts/measure-delivery-cost.ts <clips...>` makes one paid call and logs
  `[gemini-usage]` token counts.
