# 02 — Source of Truth and Curriculum Quality

## 1. Objective

Make every published fact, rule, price, link, disposition, and workflow traceable to an approved source. Prevent a complete-looking curriculum from omitting inherited rules or inventing details lost during PDF extraction.

This is a P1 requirement and a prerequisite for trustworthy simulation and certification.

## 2. Problems to solve

1. One-PDF generation omits universal rules inherited by later playbooks.
2. Existing citations validate page existence, not claim support.
3. Screenshot-heavy pages, tables, and URLs lose information during extraction.
4. Prompt condensation can remove critical content or favor frequently cited pages over compliance-critical pages.
5. Offers change over time and differ by call context.
6. A generated schema-valid item can still be wrong.
7. Trainers cannot efficiently resolve source conflicts or approve exact operational assets.

## 3. Source-bundle model

Replace the conceptual input “one track equals one PDF” with “one track equals one ordered source bundle.”

A source bundle must contain:

- a stable bundle ID and curriculum track ID;
- one or more source documents with content hashes;
- document role: `shared_foundation`, `product`, `support`, `medical_chat`, `renewals`, or `reference`;
- source version, effective date if known, and upload date;
- ordered inheritance and precedence;
- page-level extraction and extraction-quality warnings;
- structured operational assets;
- conflict records and SME decisions;
- approval status and approver identity;
- source exclusions, with a reason, for obsolete or superseded material.

Illustrative shape:

```ts
type SourceBundle = {
  id: string;
  trackId: string;
  documents: SourceDocumentRef[];
  sharedRulePackIds: string[];
  precedencePolicyId: string;
  conflictIds: string[];
  status: 'draft' | 'needs_sme' | 'approved' | 'published';
  approvedSourceRevision: string;
};
```

A document hash must change whenever source bytes change. Generated content must record the exact source revision used. Do not silently regenerate published content when a new source is uploaded.

## 4. Standard Meds inheritance map

Create an explicit shared foundation from the universal rules in NeuroCalmRx pages 14–15, with equivalent LiftRx pages 10–12 available for cross-checking. At minimum, it includes:

- self-identification and honest human/AI status;
- 09:00–21:00 in the lead’s local timezone;
- recording disclosure where required;
- immediate opt-out handling and permanent suppression;
- one product per recovery call;
- no invented discounts;
- no approval claim before physician review;
- no diagnosis or prohibited medical claim;
- no false urgency;
- no link-send as a voicemail action;
- maximum re-offer behavior.

Required bundle composition:

| Track | Required source bundle |
|---|---|
| NeuroCalmRx | NeuroCalmRx PDF + shared foundation derived from its own compliance section |
| LiftRx | LiftRx PDF + shared foundation; cross-check repeated rules |
| ED | ED PDF + shared foundation |
| ZoliraRx | ZoliraRx PDF + shared foundation |
| NAD+ | NAD+ PDF + shared foundation |
| Customer Support | Customer Support PDF + shared foundation + applicable product/support references |
| Medical Chat | Medical Chat PDF + shared foundation + relevant Customer Support escalation references |
| Renewals | Renewals PDF + shared foundation + relevant Customer Support billing references |

Do not duplicate shared rules as unrelated AI-generated text in every track. Publish track-specific projections from the same approved rule pack so corrections propagate deliberately.

## 5. Rule, claim, and asset separation

Use three different content classes.

### 5.1 Rules

Rules describe required or forbidden behavior. Each rule needs:

- stable rule ID;
- title and operational statement;
- severity: `critical`, `major`, or `coaching`;
- applicable tracks, channels, and stages;
- exact source excerpt and page;
- deterministic detection metadata where possible;
- required knowledge and scenario coverage;
- effective/source revision;
- trainer approval state.

Examples: no SMS on voicemail, no third-party medical disclosure, no `Recovered` before confirmation, and no clinical answer coaching.

### 5.2 Claims

Claims are product or process statements used in BriefingCards and drills. Every claim needs one or more exact supporting excerpts. Claims must not be published as sourced when support is absent or ambiguous.

### 5.3 Operational assets

Operational assets are exact values that the model must use, not invent:

- offer and plan definitions;
- URLs and URL types;
- disposition catalogs and selection rules;
- action sequences and screen labels;
- escalation routes and allowed fields;
- approved scripts or phrases;
- synthetic record field definitions.

Operational assets require structured trainer review. Free-form generated output may propose an asset but cannot approve it.

## 6. Extraction and citation verification

### 6.1 Preserve page-level evidence

For each page, store:

- raw extracted text;
- normalized text used for search;
- content hash;
- character count;
- extraction-quality flags;
- optional trainer-entered transcription for screenshot/table content;
- approved excerpt spans.

Quality flags must include:

- `low_text_density` for image-heavy pages;
- `possible_table_fragmentation`;
- `possible_url_fragmentation`;
- `possible_reading_order_issue`;
- `manual_transcription_required` for critical missing content.

Do not treat an image caption as extraction of the screenshot’s interface details.

### 6.2 Verify claim-to-source support

A valid page number is only the first check. For each generated claim:

1. Require the model to return the exact source excerpt that supports it.
2. Verify that the excerpt occurs in the specified normalized source page or approved transcription.
3. Classify support as `supported`, `partially_supported`, `unsupported`, or `conflicted`.
4. Display source and generated statements side by side in Studio.
5. Require trainer approval for publication.
6. Block critical claims unless fully supported by an approved excerpt or structured asset.

Local-model support classification can assist review, but cannot replace exact excerpt matching and trainer approval.

### 6.3 Protect critical pages from budget condensation

Do not select pages only by citation frequency. Assign criticality before prompt budgeting:

- compliance sections;
- funnel-stage and pricing-posture definitions;
- link/action instructions;
- disposition definitions;
- privacy and payment-data rules;
- escalation and emergency workflows;
- product-specific medical boundaries.

Critical pages and structured assets must be included in full or as approved excerpts. The system must report omitted pages and excerpts per generation stage. Generation must fail closed when a required critical input was not available to the model.

## 7. Offer, link, and disposition registries

### 7.1 Offer registry

Each offer should include:

```ts
type OfferAsset = {
  id: string;
  trackId: string;
  context: 'recovery' | 'existing_patient_cancellation' | 'existing_patient_discount';
  product: string;
  stage: string;
  label: string;
  amountCents?: number;
  comparisonAmountCents?: number;
  recurringInterval?: string;
  duration: 'first_month' | 'next_order_only' | 'ongoing' | 'plan_term';
  calculation?: string;
  sequence: number;
  prerequisites: string[];
  sourceRefs: SourceRef[];
  effectiveFrom?: string;
  effectiveTo?: string;
  status: 'draft' | 'approved' | 'retired';
};
```

All arithmetic must be deterministic. For example, 25% off $99 produces $74.25, not an AI-estimated “about $75” in an action field. Display rounded coaching language separately from exact system values.

Offers from recovery and existing-patient contexts must never be merged. An unresolved or expired offer must not be selected in a scenario.

### 7.2 Link registry

Store link type, product, stage, host, personalization requirements, and permitted action context. Use symbolic asset IDs in scenario state rather than asking the model to produce URLs.

Required validations include:

- Dosage/Score stages cannot select a checkout link;
- NAD+ Score requires a personalized results asset;
- ZoliraRx Checkout requires the approved fungus checkout host;
- voicemail cannot invoke SMS;
- test URLs remain synthetic and are never opened or sent by the training application.

### 7.3 Disposition registry

Use the canonical statuses defined by the playbooks:

- `Recovered`;
- `Callback scheduled`;
- `Didn't reply`;
- `Not interested`;
- `Organic`;
- `Lost`.

Store track-specific eligibility and evidence rules. The learner selects a disposition; the engine validates it against observed state. The model does not invent new labels or decide that a promise equals confirmation.

## 8. Precedence and conflict resolution

### 8.1 Precedence policy

Use this order unless an SME records a different approved policy:

1. explicit SME decision for the named context and effective period;
2. approved structured operational asset for the exact context;
3. later effective source within the same document lineage;
4. track-specific rule over inherited shared rule;
5. shared foundation;
6. generated proposal, which is never authoritative without approval.

“Live page is source of truth” must be represented as an operational warning and refresh requirement, not permission for the model to guess a current price. The training system has no live-page integration in this phase.

### 8.2 Conflict register

Each conflict must contain:

- conflicting source refs and excerpts;
- affected products, contexts, stages, and assets;
- detected values or statements;
- severity;
- status: `open`, `sme_review`, `resolved`, `accepted_context_difference`;
- decision, decision owner, date, and effective period;
- downstream content invalidation status.

Do not “resolve” differences that are valid by context. For example, recovery prices and existing-patient renewal prices can coexist when their scopes are explicit.

Unresolved critical conflicts block affected content and scenarios, not unrelated tracks.

## 9. Studio review experience

Add a Source Review area to the existing Studio rather than creating a separate tool.

The trainer must be able to:

- inspect bundle documents, hashes, versions, and inheritance;
- filter items by unsupported, conflicted, low-extraction-quality, or critical status;
- compare generated text with exact page excerpts;
- edit or replace a claim and its evidence;
- approve structured offers, links, dispositions, and action sequences;
- assign a conflict for SME decision and record the result;
- preview which units and scenarios are invalidated by a source change;
- publish only when all required gates pass.

Show clear labels for `AI proposal`, `trainer edited`, `SME resolved`, and `approved`. Page badges in learner views must open meaningful evidence appropriate to the learner’s role.

## 10. Pipeline changes

Update the generation flow around `src/lib/ai/pipeline/generate-track.ts`, `src/lib/ai/pipeline/shared.ts`, prompt builders, curriculum schemas, and Studio validation to support this sequence:

1. create or select a source bundle;
2. extract and flag every source page;
3. propose shared rules and operational assets;
4. obtain trainer/SME approval for critical inputs;
5. generate outline, units, and scenarios with exact excerpt refs;
6. validate structure, evidence, coverage, and conflicts after every stage;
7. checkpoint outputs and provenance;
8. run trainer QA;
9. publish an immutable curriculum and source revision.

Regenerating one item must preserve its approved source bundle and cannot silently change unrelated approved items. Source changes create a new draft and mark affected published certifications for review according to document 05.

## 11. Golden grounding tests

Create fixtures from the Standard Meds PDFs that prove:

- ED inherits local calling-window, identity, recording, opt-out, and approval rules;
- NAD+ Score remains pricing-passive and uses a personalized results link;
- ZoliraRx Checkout selects the fungus host and not the generic host;
- Customer Support affordability offers calculate $99 × 0.75 = $74.25 and preserve duration;
- repeat cancellation requests take the no-offer branch;
- Renewals cannot be `Recovered` before confirmation;
- an image-caption-only page cannot approve detailed screen steps without transcription;
- a wrong-page citation fails evidence review even when the page number exists;
- an unresolved critical price conflict blocks only the affected offer/scenario;
- replay demo citation drift is detected by the evidence validator.

## 12. Acceptance criteria

- [ ] Every track has an explicit source bundle and shared-rule inheritance.
- [ ] Every published critical rule and claim has exact source evidence and trainer approval.
- [ ] Low-quality extraction is visible and cannot silently authorize critical details.
- [ ] Offers, links, dispositions, and workflows are structured approved assets.
- [ ] Context-specific prices cannot leak into the wrong scenario.
- [ ] Source precedence and SME decisions are recorded and auditable.
- [ ] Critical conflicts and unsupported evidence block affected publication.
- [ ] Prompt-budget reports show that all critical inputs were available.
- [ ] Published content records source, prompt, and model provenance.
- [ ] Golden grounding tests pass using the supplied Standard Meds documents.
