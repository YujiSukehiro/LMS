# 01 — Application and Learning Review

## 1. Purpose

This document explains what LogiCall Pulse does well, where its current design can teach the wrong behavior, and why good quiz or text-simulation scores do not yet establish readiness for Standard Meds calls.

The review is based on the current source, the demo replay, and all nine PDFs in `demo-recordings/Standard Meds training PDFs`. It is a product and learning review, not a legal or clinical review of the playbooks.

## 2. Current product assessment

### 2.1 The core idea is appropriate

The application combines four useful training functions:

- **Curriculum production:** PDF extraction, staged AI generation, Studio editing, validation, and publishing.
- **Knowledge learning:** BriefingCards and multiple-choice, fill-blank, true/false, matching, and sequencing drills.
- **Rehearsal:** Text-based simulations with a customer actor, hidden rubric, judge, scorecard, and disposition.
- **Management:** Roles, cohorts, progress, certification, missed rules, and readiness analytics.

The main implementation areas match that intent:

- `src/lib/ai/pipeline/` and `src/lib/ai/prompts/` for generation;
- `src/components/studio/` for trainer review and editing;
- `src/components/learn/` and `src/app/(dashboard)/learn/` for knowledge work;
- `src/lib/services/simulation-engine.ts` and `src/components/simulation/` for roleplay;
- `src/lib/services/scoring.ts` and `src/lib/services/analytics-rollup.ts` for outcomes;
- `src/lib/ai/ollama-provider.ts` and `src/lib/ai/replay-provider.ts` for local and canned execution.

This is a strong base for an internal tool. The upgrade should extend it, not restart it.

### 2.2 The central product misstep

The current design implicitly treats these as equivalent:

1. recognizing the right statement in a drill;
2. producing a plausible response in text;
3. performing the correct action in a live call workflow.

They are not equivalent. A learner can know that recording must pause for card data and still forget to press the control. A learner can write a good response to a cancellation request and still select the wrong offer, disclose too much to a third party, or mark `Recovered` before confirmation.

The target learning model must separately measure:

- **Knowledge:** Can the learner recall the rule or fact?
- **Dialogue:** Can the learner respond appropriately to this person in this situation?
- **Workflow:** Can the learner inspect, choose, execute, and document the correct actions?
- **Compliance:** Did the learner avoid every critical failure?
- **Retention and transfer:** Can the learner repeat the skill later and in a different scenario?

## 3. Source and curriculum risks

### 3.1 Single-document generation breaks inherited rules

The generation flow starts with one uploaded PDF. ED, nail fungus, NAD+, Medical Chat, and Renewals explicitly state that universal rules from an earlier Standard Meds playbook still apply. Those rules include self-identification, local calling windows, recording disclosure, opt-out, no invented offers, and no premature approval claims.

A track generated only from the later PDF can therefore omit required behavior without any schema error. This is the highest curriculum risk because the output can look complete and professional while being operationally incomplete.

**Required change:** A track must use a source bundle with inherited shared rules, not a single isolated document. See [02](02_SOURCE_OF_TRUTH_AND_CURRICULUM_QUALITY.md).

### 3.2 Valid page numbers are not evidence

Current validation can establish that a cited page exists. It does not establish that the cited page contains the claim, price, URL, rule, or sequence. The demo already illustrates citation drift: NeuroCalmRx product material is on PDF page 2, while demo product content cites page 3.

**Learning impact:** Learners and trainers receive false confidence from a plausible source badge. Incorrect statements become harder to detect because they appear sourced.

**Required change:** Store exact source excerpts, verify claim-to-excerpt support, show the excerpt in Studio, and require trainer approval for critical content.

### 3.3 Extraction is lossy in operationally important places

Several PDF pages are mostly screenshots. Their extracted text contains captions but not the detailed interface content. Long URLs and tables can split across lines. Condensing pages for prompt budgets can further remove details.

The missing details are not cosmetic. They include:

- correct personalized versus generic links;
- checkout hosts and plan identifiers;
- exact prices and discount calculations;
- screen labels and action sequences;
- canonical dispositions and their conditions.

**Required change:** Do not ask a model to reconstruct these from lossy prose. Use trainer-approved structured assets with source references and validation.

### 3.4 Dynamic and conflicting offers need governance

The product playbooks state that live offers are authoritative and may change. Customer Support also contains context-specific prices and discount ladders that must not be merged with recovery pricing.

A model must not decide which price “looks right.” The source bundle needs scope, precedence, effective dates, and an SME-owned conflict register. Unresolved critical conflicts must block publication of the affected item or scenario.

## 4. Outbound training failure modes

### 4.1 Funnel-stage confusion

The supplied playbooks use different stages:

- NeuroCalmRx, LiftRx, and ZoliraRx: Dosage and Checkout;
- QuattroRx / TriShot: combined Dosage + Checkout;
- NAD+: Score and Checkout.

A generic “abandoned checkout” actor or rubric can teach the wrong opener, pricing posture, and link. NAD+ Score is pricing-passive because the lead has not seen prices. Checkout is pricing-active. Dosage must return the learner to plan selection; Checkout must preserve the selected plan.

**Current risk:** A text-only scenario can reward a persuasive answer even when it is correct for the wrong stage.

### 4.2 Link behavior is not measured

The playbooks make the link a transaction. Required behavior includes:

- obtain verbal permission where required;
- send the correct dosage, package, results, or checkout link;
- use a personalized NAD+ results link rather than sample mode;
- use the ZoliraRx checkout host rather than the generic host;
- do not send a link as a voicemail action;
- stop after the agreed link action instead of continuing to sell.

A textual statement such as “I’ve sent the link” is not evidence that the correct link was selected or sent.

### 4.3 Offer pressure is not stateful

Universal recovery rules limit re-offers. TriShot upgrades require the base sale first and one soft upgrade offer. NAD+ uses installments before stepping down a plan. ZoliraRx holds the selected package and uses defined step-down behavior.

A model-only judge can miss a third re-offer or an unsafe upgrade sequence. These are countable state transitions and should be deterministic.

### 4.4 Product boundaries can be flattened

Examples that require distinct scenarios and gates:

- ED: interactions, nitrates, heart or blood-pressure questions route to physician review; discretion matters.
- Nail fungus: no interaction or liver/kidney reassurance; no unrealistic timeline; correct checkout host.
- NAD+: score is not a diagnosis; no injection coaching or dosing; third-party privacy; pricing-passive Score behavior.
- NeuroCalmRx and LiftRx: no approval before physician review, no medical claims, no false urgency, and product-specific plan anchoring.

A shared generic rubric is insufficient. Shared rules should be inherited, while product-specific gates remain explicit.

## 5. Inbound and retention training failure modes

### 5.1 Customer Support is a decision tree, not a single conversation

Cancellation handling depends on the reason and prior history:

- side effect, physician advice, repeat cancellation request, or unrecognized purchase: cancel without an offer;
- severe current reaction: emergency instruction before other workflow;
- affordability: defined offer sequence and duration;
- too much product: one-month pause path;
- cancellation after refusal: complete cancellation on the same call;
- refunds: escalate without promising or refusing;
- prior cancellation followed by charges or contact: urgent escalation and no further unrelated calls.

A friendly AI score can hide the wrong branch. The simulation needs reason state, offer count, action evidence, and canonical outcomes.

### 5.2 Privacy-safe escalation must be practiced

Slack escalation requires the order ID and vertical or case facts, without full name, phone, email, or health details. Current text roleplay cannot observe the actual escalation payload. A learner could write a good verbal response and still mishandle the escalation.

### 5.3 Medical Chat requires pre-call inspection

A Pending row is not automatically a call. The agent must check whether the doctor asked anything and whether the patient already replied. Nail fungus adds a separate missing-photo branch in which no doctor message exists.

Other required behaviors include:

- verify the patient before account or medical discussion;
- prioritize the 7-day authorization window with a day-5 work target;
- distinguish identity, clinical-information, and nail-photo cases;
- never take, suggest, or coach the patient’s answer;
- use only the approved portal and support routes;
- keep clinical detail out of voicemail and third-party discussion;
- use `Organic` when the patient already responded and `Recovered` only when the required reply is completed during the call.

Without pre-call state and portal actions, the most important parts of this playbook are untested.

### 5.4 Renewals requires action and confirmation discipline

The learner must distinguish a stale or already-fixed case, avoid selling, offer self-service when appropriate, and never disclose or interpret the bank’s internal decline reason. Card workflows require recording pause/resume and no card data in notes.

`Recovered` requires actual confirmation. A learner saying “all set” before confirmation is a critical workflow failure. A reported adverse reaction must stop restart attempts and route appropriately.

## 6. Simulation and scoring assessment

### 6.1 Strengths

- Actor and judge responsibilities are separated.
- Rubrics can remain hidden from the learner.
- Score arithmetic is performed on the server.
- Transcripts and scorecards provide reviewable learning artifacts.

### 6.2 Weaknesses

- The channel is text only, so it cannot measure actual speaking or listening behavior.
- Critical auto-fail is a single model-produced boolean after the call.
- A user can request evaluation after minimal dialogue evidence.
- Dispositions can be generated per scenario rather than constrained to canonical operational outcomes.
- One passing scenario can lead to certification after units are complete.
- There is no mandatory matrix of high-risk branches.
- Reconciliation does not remove certification when required content changes.
- Model, prompt, source, and judge provenance are not sufficient for reliable audit and replay.

### 6.3 Required evaluation division

Use deterministic rules for facts that can be known from state:

- required identity check completed;
- call inside permitted synthetic local time;
- opt-out honored and suppression applied;
- no SMS on voicemail;
- correct link asset selected;
- offer count within limit;
- card data never entered outside the synthetic secure form;
- recording paused and resumed at required boundaries;
- correct disposition based on observed confirmation;
- no forbidden clinical advice patterns in high-risk golden cases.

Use the local judge for coaching dimensions that benefit from interpretation:

- empathy and tone in text;
- discovery quality;
- clarity and concision;
- response relevance;
- adaptation to the customer’s stated concern.

The judge must cite transcript or action evidence for every criticism and must not override a deterministic critical failure.

## 7. Learning design assessment

### 7.1 Mistake recovery currently rewards short-term recall

The current recovery pattern reveals the correct answer and repeats the same item. This helps a learner complete the unit but can measure immediate copying rather than retained knowledge.

Replace completion-only recovery with:

1. specific feedback and source review;
2. a varied question on the same rule rather than the identical prompt;
3. a delayed retrieval attempt later in the unit;
4. spaced review after a longer interval;
5. transfer into a scenario where the rule must be applied without a visible cue.

### 7.2 Drill attempt integrity is weak

`passedFirstTry` is supplied by the browser and trusted by the completion route. This allows incorrect first-try and readiness reporting, whether through accident or manipulation.

The server must own attempt numbering, answer records, correctness, timing, and first-try status. The client may submit an answer, not declare its analytical meaning.

### 7.3 Content coverage is not mastery coverage

Completing every generated unit does not prove coverage of every critical rule. Each critical rule needs mapped evidence across:

- an approved knowledge item;
- at least one varied retrieval item;
- at least one applicable simulation or workflow scenario;
- where relevant, a delayed reassessment.

## 8. Analytics assessment

The current readiness rollup accumulates samples over time. A historical average can hide current decay, and a single average can combine different kinds of evidence.

Analytics should distinguish:

- current approved curriculum version;
- knowledge mastery and delayed retention;
- dialogue performance;
- workflow task success;
- critical compliance failures;
- required scenario coverage;
- attempt count and recency;
- live local-model versus manual-import versus demo-replay provenance;
- confidence based on amount and consistency of evidence.

Do not display a single “ready” percentage without these components. Do not count replay or unreviewed generated evidence toward certification.

## 9. Privacy and internal-tool boundaries

“Internal only” reduces exposure but does not make sensitive training data safe by default. The upgraded application must:

- ship only synthetic scenario fixtures;
- mark all synthetic records clearly;
- block or reject card-number-like and identity-document-like input outside designated fake secure-form fields;
- never request real credentials, patient data, identity images, or medical answers;
- use fake Slack and SMS inboxes with no network sending;
- prevent real URLs from being treated as actions to execute during simulation;
- redact sensitive patterns from logs, exports, analytics, and judge prompts;
- make demo replay visibly different from assessed local/manual runs.

## 10. Voice limitation

Text roleplay cannot assess:

- listening and interruption behavior;
- pace, pronunciation, and audible clarity;
- hesitation and timing;
- tone as expressed in audio;
- real-time speaking while operating another system.

Do not claim otherwise. The first upgrade should make text and workflow assessment trustworthy. A later P3 phase may add fully local audio capture, speech-to-text, and text-to-speech, with human review of audio-specific judgments. Voice is not a prerequisite for the P0–P2 improvements.

## 11. Review acceptance criteria

The application review is successfully addressed when:

- [ ] Every high-risk finding above maps to a requirement in documents 02–07.
- [ ] Outbound scenarios preserve product, stage, pricing posture, link, and offer differences.
- [ ] Customer Support, Medical Chat, and Renewals include workflow evidence rather than dialogue alone.
- [ ] Deterministic compliance is separated from model-assisted coaching.
- [ ] Knowledge completion, current mastery, scenario coverage, and certification are separate concepts.
- [ ] Demo replay cannot silently produce operational readiness evidence.
- [ ] The product makes no audio-readiness claim while simulations remain text-only.
- [ ] All training records and external-system simulations remain synthetic.
