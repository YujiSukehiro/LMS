# 05 — Learning, Certification, and Analytics

## 1. Objective

Make progress represent retained knowledge and demonstrated skill, not only unit completion or one favorable AI judgment. Make every important metric traceable to server-recorded evidence in an approved curriculum version.

## 2. Separate the learning states

Do not use one progress flag for all of these concepts:

| State | Meaning |
|---|---|
| Content completion | Learner opened required briefings and completed assigned items |
| Knowledge mastery | Learner answered current, varied, server-scored knowledge items correctly |
| Retention | Learner recalled the rule after a delay without an immediately revealed answer |
| Scenario coverage | Learner attempted every required branch in the approved matrix |
| Skill demonstration | Learner passed required dialogue and workflow evidence gates |
| Compliance | Learner avoided critical failures in the assessed evidence |
| Certification | All versioned requirements are met and the evidence is eligible |
| Readiness for live work | A separate operational decision that may still require supervised live calls |

The UI must not turn content completion into a claim of live-call readiness.

## 3. Server-authoritative drill attempts

### 3.1 Current problem

`passedFirstTry` is supplied by the browser and trusted by the unit-completion route. This makes first-try results and downstream analytics unreliable. The server also lacks a complete authoritative record of each answer and recovery sequence.

### 3.2 Required attempt model

Create a server-owned attempt record:

```ts
type DrillAttempt = {
  id: string;
  learnerId: string;
  trackId: string;
  unitId: string;
  drillId: string;
  curriculumVersion: string;
  attemptNumber: number;
  attemptKind: 'initial' | 'immediate_retry' | 'varied_retrieval' | 'spaced_review';
  answer: unknown;
  correct: boolean;
  score: number;
  misconceptionRuleIds: string[];
  startedAt: string;
  submittedAt: string;
  durationMs: number;
  provenance: 'live' | 'imported_legacy';
};
```

The server must:

- load the current published drill and correct answer;
- validate the learner’s access and attempt state;
- calculate correctness and score;
- assign attempt number and first-try status;
- write the answer evidence and update progress idempotently;
- schedule the next retrieval step;
- return feedback appropriate to the attempt state.

The client submits an answer, not `passedFirstTry`, attempt number, score, or analytical classification.

### 3.3 Answer privacy and security

- Correct answers and hidden rationales must not be exposed before submission.
- Learners can read only their own attempts.
- Trainers see aggregated and individual evidence according to existing roles.
- Unit completion is idempotent and cannot be granted by replaying an old request against a new curriculum version.

## 4. Better mistake recovery

Replace immediate reveal-and-repeat as the sole recovery pattern.

### 4.1 Recovery sequence

After an incorrect answer:

1. Explain the misconception using the approved rule and source excerpt.
2. Ask the learner to restate or choose the corrective principle when appropriate.
3. Present a varied retrieval item that tests the same rule in a new wording or context.
4. Schedule a delayed review.
5. Require application in a relevant scenario when the rule is operational.

Do not show the correct option and then count an identical immediate repeat as first-try mastery. Immediate retries can support completion, but must be labeled separately in analytics.

### 4.2 Varied retrieval

Map drills to stable rule IDs. Variation should change surface details while preserving the underlying decision:

- different product or stage where the same shared rule applies;
- different customer wording;
- reordered options;
- action-selection instead of fact-recognition;
- negative and positive cases;
- scenario application without naming the rule in the prompt.

Generated variations require the same source and trainer approval as other curriculum content.

### 4.3 Spaced review

Use a simple configurable schedule rather than an opaque algorithm. Initial defaults:

- first varied retrieval later in the same learning session;
- first spaced review after 1 day;
- next review after 3 days;
- next review after 7 days;
- shorter interval after an error;
- longer interval after consistent correct independent attempts.

A review is independent only when the correct answer was not revealed immediately before that attempt. Store schedule, due date, and result. Trainers may adjust intervals by cohort without changing historical evidence.

## 5. Required scenario coverage

Create a versioned assessment blueprint for each track. It defines:

- required units and critical rules;
- required scenario IDs and branches;
- minimum evidence per scenario;
- required deterministic gates;
- allowed attempts and remediation guidance;
- passing dialogue/workflow thresholds;
- certification expiry and recertification policy.

A learner cannot certify by passing only the STANDARD or easiest generated scenario. All mandatory high-risk branches in document 06 must be represented.

Scenario requirements should include:

- at least one normal successful path per required stage;
- every critical privacy, clinical, payment, or opt-out branch assigned to the track;
- correct pre-call and wrap-up actions;
- at least one stale/organic or exception path where operationally relevant;
- a valid disposition backed by state evidence.

Retries are allowed for learning. Preserve earlier failures and show the passing attempt plus attempt history. Certification means the required skill was eventually demonstrated, not that the learner never made a mistake.

## 6. Certification state machine

Use explicit states:

```text
not_started
  -> in_progress
  -> ready_for_trainer_review (optional policy)
  -> certified

certified
  -> recertification_required
  -> expired
  -> revoked

recertification_required
  -> certified (only after new requirements are met)
```

### 6.1 Grant requirements

Certification requires all of the following in the same approved curriculum version:

- required content completion;
- required current knowledge mastery;
- all mandatory scenarios attempted and passed;
- all required workflow evidence observed;
- no unresolved critical failure in the passing evidence set;
- valid canonical disposition;
- eligible provenance: live local/manual assessed work, never replay;
- any configured trainer approval.

If delayed retention is not yet complete, show it as a separate outstanding retention goal rather than silently treating it as complete. A company may require it for certification through policy configuration.

### 6.2 Revocation and recertification

When a new curriculum version is published:

1. Diff rules, assets, drills, and scenario requirements against the certified version.
2. Mark affected certifications `recertification_required` when critical or required content changes.
3. Preserve historical certification records with their original version and evidence.
4. Assign only affected units/scenarios where a reliable mapping exists.
5. Require broader reassessment when the mapping is uncertain or the assessment model changes materially.
6. Do not leave a current `certified` badge unchanged merely because historical records were reconciled.

Trainers can revoke certification for invalid evidence or operational policy. Record actor, reason, and timestamp.

## 7. Honest analytics

### 7.1 Replace the single blended average

Display separate metrics by current curriculum version:

- **Content completion:** completed required items / assigned items.
- **Initial knowledge:** correct first independent attempts / first independent attempts.
- **Current mastery:** rules currently meeting the mastery policy / required rules.
- **Delayed retention:** correct due spaced reviews / completed due spaced reviews, with due count visible.
- **Scenario coverage:** required scenarios passed / required scenarios.
- **Workflow accuracy:** required action sets completed without error / assessed action sets.
- **Compliance:** critical failures by rule and attempt; no averaging away a critical event.
- **Dialogue coaching:** local-judge dimensions with evidence and provenance.
- **Recency:** last eligible assessed attempt and curriculum version.
- **Evidence confidence:** insufficient, emerging, or adequate based on coverage, independence, recency, and consistency.

Do not show a high readiness percentage when required evidence is missing. Show `Not demonstrated` or `Insufficient evidence`.

### 7.2 Current versus historical data

Default dashboards to the current published version. Provide a separate historical trend view. Do not average old and new source versions into an unexplained readiness number.

Filters should include:

- cohort, agent, track, curriculum version;
- direction, queue, product, and stage;
- attempt kind and date range;
- runtime provenance;
- critical rule and workflow action;
- included/excluded legacy evidence.

### 7.3 Provenance eligibility

- Replay evidence is always excluded from certification and operational readiness.
- Manual imports are labeled and count only after required validation.
- Legacy records without sufficient evidence are `historical_unverified` and cannot satisfy new gates.
- Trainer overrides are visible and audited; they do not rewrite the original event history.

## 8. Learner experience

The learner should see:

- what is complete versus what is mastered;
- rules needing review and why;
- upcoming spaced reviews;
- required scenario matrix with passed, remaining, and needs-remediation states;
- action-level feedback, not only a numeric score;
- source-based remediation;
- current certification version, expiry, and recertification requirements;
- clear distinction between simulated evidence and live-call authorization.

Feedback after a critical failure should be direct and specific. Example: `You marked Recovered before the card-update confirmation appeared. Review Renewals page 12 and repeat the confirmation scenario.`

## 9. Trainer and supervisor QA

Add views to:

- inspect first attempts, retries, and delayed retention separately;
- open transcript and action evidence behind any score;
- compare local judge comments with deterministic gates;
- flag a suspect judge result or generated item;
- preview the effect of a curriculum change on certifications;
- assign targeted remediation instead of repeating the whole track;
- export a safe summary without sensitive raw data;
- identify content that many learners fail, which may indicate a bad question or source conflict rather than a cohort weakness.

High failure rates must be reviewable as possible curriculum defects. Do not automatically blame the learner.

## 10. Implementation changes

Expected areas include:

- `src/app/api/progress/complete-unit/route.ts`: remove browser-authoritative first-try semantics and require valid attempt evidence;
- new drill-answer and review-schedule routes;
- `src/components/learn/DrillRunner.tsx`: submit answers and render server results/recovery states;
- `src/lib/schemas/analytics.ts` and domain schemas: versioned attempt, mastery, coverage, and certification records;
- `src/lib/services/analytics-rollup.ts`: component metrics, provenance filters, and current-version defaults;
- simulation evaluation routes: required evidence and certification reconciliation;
- analytics and learner views: explicit coverage, retention, and recertification states;
- Firestore rules and indexes: learner privacy, trainer access, and new queries.

Use server timestamps and idempotency keys. Do not trust client-provided durations without sane bounds and start/submit records.

## 11. Tests

Required tests include:

- browser cannot set first-try status, attempt number, score, or mastery;
- repeated or concurrent answer submission is idempotent;
- immediate reveal-and-repeat is not counted as independent retention;
- spaced review scheduling changes correctly after pass/fail;
- one easy scenario cannot satisfy the required matrix;
- missing required evidence yields `not_observed`, not a pass;
- replay cannot certify;
- critical changes trigger recertification and preserve history;
- unrelated editorial changes do not force unnecessary recertification;
- legacy unverified records do not satisfy new requirements;
- analytics exclude or label historical and replay evidence as designed;
- learners cannot read other learners’ attempts or hidden answers.

## 12. Acceptance criteria

- [ ] Drill correctness, attempts, and first-try status are server-authoritative.
- [ ] Immediate recovery, varied retrieval, and spaced review are distinct evidence types.
- [ ] Certification requires the full versioned scenario matrix and workflow evidence.
- [ ] Critical failures cannot be averaged away.
- [ ] Source or requirement changes can trigger targeted recertification.
- [ ] Current mastery, historical performance, retention, coverage, and confidence are separately visible.
- [ ] Replay and unverified legacy data cannot produce current certification.
- [ ] Every metric can be traced to eligible evidence.
- [ ] The UI avoids unsupported claims of readiness for live calls.
