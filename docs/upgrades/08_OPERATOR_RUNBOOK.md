# 08 — Phase 5 Operator Runbook

## 1. Status, scope, and safety

This runbook describes the current operator workflows in `upgrade-fork`. It is not a release-attestation record. It does **not** assert that local capability preflight has passed, that Standard Meds content has been approved, or that any Standard Meds Track has been published.

Use this runbook only with local development services, the Firebase Emulator Suite, synthetic learners and orders, and synthetic operational actions. Keep the original application directory available as a fallback.

### Non-negotiable constraints

- Do not use real patient, customer, learner, order, identity, clinical, or payment-card data in sources, fixtures, prompts, manual packages, notes, logs, screenshots, or exports.
- Do not place credentials, API keys, tokens, environment-file contents, or sensitive local configuration in this runbook, chat prompts, generated content, tickets, or commits.
- Keep local model endpoints on loopback. The generic OpenAI-compatible adapter accepts only `http://localhost`, `http://127.0.0.1`, or `http://[::1]`, and rejects embedded credentials, query strings, and fragments.
- Do not enable a hosted-AI fallback or silently substitute replay, another model, or another provider when the selected local runtime fails.
- SMS, Slack, ReFlow, Dosable, portal, dialer, payment, subscription, and confirmation behavior is synthetic only. Never connect these training actions to live systems.
- Use only designated fake payment tokens and `.invalid` synthetic links. Redaction is a second control, not permission to enter real sensitive data.
- Manual judge packages contain hidden rubric and scenario material. Restrict them to authorized internal operations users; never expose them to learners.
- Do not edit Firestore records, checkpoints, approval fields, or provenance directly to bypass a failed gate.

## 2. Local application and AI setup

### 2.1 Prerequisites

Run commands from the `upgrade-fork` root unless a section says otherwise.

- Node.js 22 or newer, matching `package.json`.
- Project dependencies already installed with the repository's normal npm workflow.
- Existing local Firebase configuration preserved without printing it.
- The existing disposable `mlx-runtime` directory if the MLX server will be used.
- A Java runtime for Firestore emulator/rules tests and a Playwright Chromium browser for browser tests; see section 8.

The Next.js application uses the existing `LLMGateway` boundary and a generic OpenAI-compatible HTTP adapter implemented with native `fetch`. It does not import an MLX SDK, load a model, start Python, or require the OpenAI SDK. The separate `mlx-runtime` process is disposable local infrastructure, not application code or a deployment dependency.

### 2.2 Start the existing generic OpenAI-compatible MLX endpoint

In one foreground terminal:

```sh
./mlx-runtime/start.sh
```

The checked-in launcher selects the existing local model profile, binds to `127.0.0.1:8081`, and sets prompt/decode concurrency to 1. Its model cache remains under `mlx-runtime/hf-cache`. A first start on a machine without the cached model can require a model download; that is runtime setup, not an application fallback.

The application does not start or stop this server. To check only whether the server responds:

```sh
./mlx-runtime/status.sh
```

A successful status check is not capability evidence. Stop the server with Ctrl+C in its foreground terminal or:

```sh
./mlx-runtime/stop.sh
```

The `scripts/with-mlx-env.sh` wrapper selects the generic loopback profile for a child command without reading or changing `.env.local`. Explicit caller-supplied profile values take precedence. Do not print the resulting environment.

### 2.3 Run real capability preflight

```sh
npm run verify:local-ai:mlx
```

This performs real chat-completions requests; model discovery or installation alone is insufficient. It reports these capabilities independently:

1. availability;
2. basic chat;
3. streaming chat, including clean `[DONE]` termination;
4. nested structured output through the shared Zod validation/repair path;
5. realistic heavy curriculum generation and its context/output budget result;
6. judge output with valid golden-transcript evidence IDs;
7. cancellation and queue cleanup;
8. serial concurrency.

Interpret the overall result as follows:

| Status | Meaning | Operator action |
|---|---|---|
| `ready` | Every required capability passed | Local actions may be used, subject to content approval and assessment gates. Save the command, time, and result as test evidence. |
| `degraded` | Availability and basic chat passed, but another capability failed or was not tested | Keep affected generation, streaming, or judge actions disabled. Use the applicable manual path. |
| `blocked` | Availability or basic chat failed | Do not use the selected local profile. Check the loopback server and selected chat model, then rerun preflight. |
| `not_configured` | The local profile or model roles are missing | Select the local profile through the existing wrapper/configuration and rerun. |

The command exits nonzero unless the overall result is `ready`. Its report contains timings and sizes rather than generated prompts or content. Treat any printed server detail as potentially sensitive operational log data; do not copy it into public tickets.

To start Next.js with the same profile:

```sh
npm run dev:mlx
```

`dev:mlx` runs preflight again and starts Next.js only when every required capability passes. Rerun preflight after changing the endpoint, model, prompt schema, or runtime profile. Keep concurrency at 1 unless a future implementation and measured profile explicitly support more.

For authenticated internal operations users, `GET /api/system/ai-health` exposes the same capability-specific local health distinction. Do not replace the command-line release check with a visual “connected” indicator.

### 2.4 Manual-chat fallback when local AI is unavailable

Manual chat is a separate operating mode, not a hidden live provider. To run the application without a live model gateway, set the local provider selection to `manual_chat` for the Next.js process using the existing local configuration mechanism. Do not change unrelated local values.

In this mode:

- automatic local generation, actor responses, and judge calls are unavailable by design;
- use the curriculum and trainer-only judge export/import routes in section 7;
- the application does not control or verify the external chat system;
- record an honest external provider and model label on every import;
- never relabel manual output as MLX, Ollama, hosted AI, or replay output.

If neither local generation nor a safe manual workflow can complete a task, stop that task and preserve its valid drafts/checkpoints. Do not use replay as a substitute. Replay is for demonstrations/tests and is ineligible for readiness or certification evidence.

### 2.5 Optional Ollama diagnostic and known blocker

Ollama is optional when the MLX profile passes. Its legacy diagnostic is:

```sh
npm run verify:ollama
```

The documented baseline failure found the configured models installed but returned HTTP 400 because the configured fast model, `clef-flash:9b-mxfp8`, does not support chat. Therefore:

- do not infer chat capability from model installation;
- do not use `npm run dev:local` as evidence of a working Ollama profile;
- do not silently substitute another hardcoded model;
- leave this as inactive-profile debt when MLX passes, or explicitly validate a replacement chat-capable Ollama profile before use;
- use manual chat while no local profile is ready.

The legacy Ollama script performs installation checks and a small structured-output request. It is not equivalent to the full generic capability preflight.

## 3. Standard Meds source registration and synthetic draft seed

### 3.1 Register the nine local source PDFs as metadata

The source catalog expects the nine supplied PDFs under:

```text
demo-recordings/Standard Meds training PDFs
```

From the repository root, run:

```sh
npm exec -- tsx scripts/register-standard-meds-sources.ts
```

This command:

- reads the local PDF bytes and extracts page metadata locally;
- verifies the expected inventory and page counts;
- records document/page SHA-256 hashes, character counts, and extraction-quality flags;
- writes `src/lib/content/standard-meds/source-manifest.json`;
- deliberately omits raw and normalized page text from that manifest;
- leaves every source registration in `draft`/`supplied-pdf-unapproved` state.

Registration does not upload PDFs, initialize Firebase, approve sources, or publish content. It does modify the checked-in manifest, so run it only when intentionally registering or refreshing the source inventory, and review the resulting diff without disclosing source text.

Use only the approved training PDFs. Do not substitute live customer/patient exports or operational records. “Synthetic-only” applies to learners, scenarios, orders, and actions; it does not change the provenance of the supplied playbook documents.

### 3.2 Validate the metadata-only draft plan without writes

```sh
npm exec -- tsx scripts/seed-standard-meds-drafts.ts --dry-run
```

The dry run schema-validates the complete plan and prints per-track counts, open SME IDs, import issues, and publication blockers. It does not initialize Firebase or write anything.

The plan contains SM-00 orientation plus SM-01 through SM-08 call-training drafts. SM-00 is orientation, not a standalone call-certification Track. The plan is expected to remain `publicationEligible: false` and `approvalStatus: "draft"`; those values are safety requirements, not failures to repair by editing flags.

### 3.3 Write only to a loopback Firestore emulator

Start the established local emulators in a separate foreground terminal:

```sh
npm run emulators
```

After confirming that the target is the local synthetic emulator, run:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm exec -- tsx scripts/seed-standard-meds-drafts.ts --confirm-synthetic-local
```

Both the explicit confirmation flag and a loopback `FIRESTORE_EMULATOR_HOST` are required. There is no production override. Firebase Admin initialization is delayed until both gates pass.

The write path:

- writes drafts, secret rubrics for the eight call Tracks, source bundles with a machine-readable `unresolvedSmeDecisionIds` register, and page-evidence metadata;
- does not upload source PDFs, approve content, assign cohorts, resolve SME decisions, or publish versions;
- skips unchanged deterministic documents on rerun;
- preflights protected targets and refuses to replace published Tracks/versions, approved/published bundles, extracted text, transcriptions, approved excerpts, trainer-approved ClaimEvidence in draft curriculum/secrets, or existing conflict/unresolved-SME registry entries;
- validates each transaction chunk before writing it.

A successful seed message means that synthetic draft documents were written. It does not mean the content is evidence-complete, approved, publishable, clinically validated, or ready for learners.

## 4. Expected Standard Meds blockers

Do not “fix” these blockers by manufacturing excerpts, approvals, conflict decisions, or assets.

| Import issue / publication blocker | Current meaning | Required resolution |
|---|---|---|
| `SOURCE_PAGE_TEXT_NOT_EMBEDDED` | Page evidence contains hashes, counts, and flags, but `rawText` and `normalizedText` are empty. | Populate exact page content through the established extraction/source-upload flow. Metadata alone cannot support exact-excerpt approval. |
| `RULE_PACK_EXACT_EXCERPTS_REQUIRED` | Required rule IDs and page references exist, but no shared rule pack is written. | Supply rules with exact supported excerpts and the correct source revision, then obtain trainer approval. |
| `ASSET_EXACT_EXCERPTS_REQUIRED` | Synthetic link definitions are not approved operational assets and lack required exact `sourceRefs`. | Define/review link, offer, disposition, and workflow assets with exact evidence, context, scope, and effective dates. |
| `CONFLICT_EXACT_EXCERPTS_REQUIRED` | No conflict values or resolutions are inferred and no excerpt-backed conflict records are written; open IDs are persisted separately on the bundle. | Supply at least two exact source excerpts per conflict and record an explicit authorized SME decision/effective scope. |
| `EXACT_EXCERPT_APPROVAL_REQUIRED` | Briefing, drill, and rubric items have document-06 page references, not approved exact evidence. | Verify and approve every required claim-to-excerpt relationship. |
| `OPERATIONAL_ASSET_APPROVAL_REQUIRED` | Operational values remain synthetic drafts. | Review exact values and approve the structured assets. |
| `SOURCE_TRANSCRIPTION_REQUIRED` | Flagged image-heavy or low-text pages cannot authorize detailed interface behavior. | Provide trainer-approved transcription or approved structured action evidence. |
| `SME_DECISION_REQUIRED` | SME-01 through SME-10 remain open across the pack and are persisted in each affected bundle's `unresolvedSmeDecisionIds`. | Record explicit owner decisions and clear only the resolved register entries through the controlled data path; leave affected content blocked when no decision exists. |
| `TRAINER_SIGNOFF_REQUIRED` | Neither the exact source revision nor the complete curriculum version is trainer-approved. | Review and approve the exact revisions after all other evidence requirements are satisfied. |

In particular, the seed writes no rule packs, operational assets, or excerpt-backed conflict records. The Source Review screen can approve persisted records, but it is not a general creation UI for those missing record types or a resolution UI for the pack-level SME register. The seeded pack therefore cannot be made publishable merely by clicking its current approval buttons. Supply the missing validated records and explicit decisions through the established implementation/data path; do not use ad hoc database edits.

Bundle approval recomputes page hashes and rejects a nonempty SME register or any open/`sme_review` conflict, regardless of severity. Empty metadata-only page text does not gain a matching original-content hash by being marked approved.

## 5. Source refresh, review, generation, and publication

### 5.1 Choose the correct refresh operation

**Manifest-only inventory refresh:** rerun section 3.1 when the nine local PDFs change. This updates metadata only. Do not expect it to populate source-review text or resolve publication blockers.

**Usable source revision for a Track:** use **Upload Revised Playbook** in Track Studio, or the established multi-document upload/append flow. Before uploading:

1. stop or wait for active generation;
2. record the current Track, draft, and source revision identifiers;
3. preserve trainer notes and any required synthetic evidence;
4. confirm the PDF contains no prohibited real data.

For an existing Track, revised upload creates and activates a new content-hashed source bundle, stores the PDF through the configured storage path, extracts full page evidence, and replaces the current draft and its draft secrets. Unsaved/current draft edits are lost. Existing published versions and learner records remain intact, and learners continue on the published version until a later successful publish. Historical source bundles are retained for review.

The metadata-only seed has separate overwrite protections. Do not use it as a migration mechanism for populated/approved source evidence.

### 5.2 Review the exact source revision

In **Track Studio → Source Review**:

1. Confirm the draft source revision, bundle revision, document order, inherited rule-pack IDs, roles, and precedence policy. Reload after any concurrent source change; review commands use an expected revision check.
2. Inspect extraction flags. Enter and approve complete trainer transcriptions where required. Changing transcription text advances the source revision, resets bundle approval, and invalidates excerpts approved against the previous transcription wording.
3. Verify each generated claim against exact source text. Matching permits Unicode/whitespace normalization only; wording and punctuation remain significant. A valid page number is not sufficient.
4. Supply and approve required shared rule packs. Required rules need supported approved evidence and curriculum coverage.
5. Supply and approve operational assets. Open conflicts affecting an asset block approval; workflow assets requiring interface details cannot rely on inadequate extraction.
6. Register conflicts with exact source excerpts. Assign them for SME review and record only explicit SME resolutions or accepted context differences, including effective scope. Every open/`sme_review` conflict blocks publication regardless of severity; a persisted `unresolvedSmeDecisionIds` entry also blocks publication.
7. Approve the exact source bundle revision only after complete page evidence, required transcription, hash/revision checks, an empty pack-level SME register, and resolution of every open conflict pass.
8. Generate or regenerate the draft against that exact approved revision. Generation also requires the inherited shared rule packs to be approved. Re-review any stale claims after source changes.
9. Use the bulk QA queue for unsupported evidence, critical conflicts, high eligible learner failure, and deterministic/model disagreement. An empty QA queue is not itself a publication or readiness verdict.

### 5.3 Publish only after server gates pass

Publication described here is a conditional procedure, not authorization to publish the current Standard Meds seed.

1. Save the complete draft and confirm generation is `READY`.
2. Confirm the draft references the exact approved source revision and every scenario has its secret rubric.
3. Confirm every scenario has a scripted golden pass and applicable scripted critical-fail fixture, and that the fixtures pass deterministic server QA.
4. Resolve every issue shown by **Source Review → Publish gate results**.
5. Open **Publish & Assign**, select only intended synthetic/local cohorts, and publish.

The server transactionally repeats source, evidence, approval, inherited-rule, asset, conflict, scenario-context, secret-rubric, disposition, and scenario-QA gates. A missing source revision fails closed as `legacy_unknown`. Successful publication freezes a new immutable TrackVersion and its secrets; it does not rewrite earlier published versions. Changed assessment requirements can trigger recertification while preserving historical evidence.

If publication returns `PUBLICATION_GATES_FAILED`, return to Source Review and resolve the named issues. Do not retry with edited client fields.

## 6. Generation checkpoints, resume, concurrency, and budgets

### 6.1 What is persisted

Automatic Track generation uses Firestore `generationCheckpoints` records with schema version 1. The current run identity is `track-<trackId>` and stages are:

- `blueprint`;
- `unit:<outline-id>` for each Unit;
- `simulations`.

A checkpoint contains the stage identity, canonical-input SHA-256 hash, validated output, provenance, timestamps, and usage/duration. The current Track also stores per-stage `generationBudgets` reports.

A valid exact-input checkpoint is reused without another stage task/model call. A cache hit reports zero new attempts/model calls and zero new invocation duration; retained token usage describes the original generation.

### 6.2 Retry and resume behavior

- The local generation limiter permits one in-flight stage task.
- Each automatic stage has a 180,000 ms timeout. Timeout, cancellation, invalid output, invalid usage, or invalid provenance writes no new checkpoint.
- A failed attempt does not overwrite a previously stored checkpoint. Retry after correcting the runtime/source problem.
- On retry, valid blueprint and completed Unit checkpoints are reused; generation resumes at the first missing/rejected stage rather than uploading the PDF again.
- After a blueprint is available, a server-only `generationWorkingDrafts` record is initialized and then saved after each completed Unit. A later failure can leave a partial working draft, but it does not overwrite the last complete Studio draft. Partial work is not `READY` and must not be published.
- The last complete Studio draft remains available until a successful final commit replaces it. That final commit writes the complete TrackVersion and secrets, then removes the working-draft record.
- An existing published TrackVersion remains separate from the in-progress build.
- Closing the browser/EventSource connection does not cancel the server build. Reconnecting follows the current build. The current generation route does not expose a general operator cancel button.

### 6.3 Stale or corrupt checkpoints

The executor rejects rather than returns checkpoints with:

| Rejection | Meaning |
|---|---|
| `stale_schema` | Checkpoint schema version is not supported. |
| `corrupt` | Checkpoint structure, output schema, or deterministic JSON representation is invalid. |
| `wrong_identity` | Run, Track, or stage identity does not match. |
| `wrong_input` | The exact canonical input hash no longer matches. |

The executor regenerates the affected stage and replaces the rejected checkpoint only after valid output and provenance are available. If that attempt fails, the old stored checkpoint remains untouched. Do not manually repair checkpoint JSON or mark it valid. Retry from the validated parent stages; use a new Track for a clean run if checkpoint identity/history cannot be trusted.

Checkpoint reuse is based on run/Track/stage identity and the current stage input hash. The hashed cache identity includes provider, model, prompt template/version, output schema/version, normalized endpoint and effective structured-generation settings, runtime label/profile, and the staged-generation contract version. Unit and simulation inputs also include the Track title, campaign code, and division used by their prompts. Changing any of those values invalidates prior checkpoints through `wrong_input` and causes validated regeneration; old output is not relabeled as output from the new runtime. Do not delete arbitrary checkpoint documents to force a model comparison.

### 6.4 Budget meaning and limits

The automatic integration configures a 2,000,000-character input-plus-output report budget and a 180,000 ms duration report per stage.

- Character and duration `exceeded` statuses are **reported**, not independent hard failures.
- The separate stage timeout enforces duration cancellation.
- Token budgets are not configured by the current automatic integration. When the provider does not supply usage, token status remains `unknown`; the system does not estimate tokens.
- Inspect repeated repair, excessive size, timeout, and `exceeded` reports before declaring a stage operationally healthy. Split/repair source or generation work through the controlled implementation flow rather than silently truncating critical evidence.

## 7. Manual curriculum and judge exchange

### 7.1 Common envelope and validation rules

Exports use format `logicall.manual-chat`, format/package schema version 1, a task ID/type, the exact output JSON schema, approved source excerpts, validation rules, prompt provenance metadata, and a SHA-256 checksum.

Return one JSON object with this shape, copying values from the trusted export:

```json
{
  "format": "logicall.manual-chat",
  "formatVersion": 1,
  "packageChecksum": "<package.checksum>",
  "taskId": "<package.taskId>",
  "taskType": "<package.taskType>",
  "outputSchemaVersion": "<package.outputSchemaVersion>",
  "output": {}
}
```

Replace `{}` with output matching `package.outputJsonSchema`. Do not add instructions, prompts, executable/active content, credentials, real sensitive data, or client-supplied provenance fields. Supply the external provider/model labels separately at import.

Imports validate the trusted package checksum, task identity, schema version and exact shared schema, content safety, task-specific evidence, and external labels before the single commit hook. Validation failure performs no curriculum/evaluation write. Any stale task or changed context requires a fresh export and a fresh external response.

### 7.2 Manual curriculum: one existing draft Unit

Prerequisites:

- an authenticated internal operations user;
- no active generation on the Track;
- an existing draft containing the selected Unit;
- persisted source-page batches for every page cited by that Unit;
- valid draft CompetencyPillar references.

Export with:

```text
POST /api/tracks/{trackId}/manual-curriculum/export
{ "unitId": "<unit-id>" }
```

The response contains `unitId` and `package`. Export includes the current Unit context and only its cited persisted pages, not unrelated pages or hidden scenario rubrics. The trainer-authorized export marks those exact excerpts approved for this task only; it does not approve the whole source bundle or curriculum.

Run the package in the separate chat, then import with:

```text
POST /api/tracks/{trackId}/manual-curriculum/import
{
  "unitId": "<unit-id>",
  "input": "<complete JSON envelope as a string>",
  "externalProvider": "<honest-provider-label>",
  "externalModel": "<honest-model-label>"
}
```

The service reconstructs the trusted package from current persisted data and rejects stale Unit/source context. A valid import atomically replaces only that Unit and writes a `manualCurriculumImports` provenance/diff/validation record. Unrelated Units, Simulations, and the TrackVersion's existing provenance remain unchanged. The response includes the diff and validation report.

Manual curriculum import checks source-page membership, not final publication approval. Complete exact-evidence Source Review afterward. It does not create an automatic generation checkpoint; automatic resume continues to use the checkpoint behavior in section 6.

### 7.3 Manual judge: trainer-only, one completed synthetic session

Prerequisites include:

- an authorized internal operations user;
- a synthetic session in `READY_FOR_EVAL`, at wrap-up, with required workflow evidence and a confirmed server-recorded disposition;
- no existing evaluation;
- every rubric criterion supported by approved exact evidence that still matches persisted source pages.

Export with an empty JSON body:

```text
POST /api/simulations/{sessionId}/manual-judge/export
{}
```

The server redacts session content, includes deterministic gate/eligibility/disposition results and approved evidence, and persists the trusted task under the simulation session. Keep the returned hidden rubric material trainer-only.

In **Track Studio → Source Review → Manual judge exchange**, enter the synthetic session ID and export the package. The UI downloads the response verbatim without rendering or logging its hidden content. After obtaining the external result, select its `.json` or `.txt` file, enter honest external provider/model labels, and import through the same panel. Changing the session ID requires a new export. The equivalent API calls are below.

Export with an empty JSON body:

```text
POST /api/simulations/{sessionId}/manual-judge/import
{
  "taskId": "<taskId from export>",
  "input": "<complete JSON envelope as a string>",
  "externalProvider": "<honest-provider-label>",
  "externalModel": "<honest-model-label>"
}
```

The judge output must return every rubric criterion exactly once. Quotes must be verbatim agent transcript evidence, and event IDs must exist in the exported event catalogue. Deterministic failures, eligibility, and dispositions remain authoritative. Server code computes totals, penalties, caps, and pass/fail; imported scores cannot reverse hard gates.

A changed session or evidence invalidates the export. Draft/replay evaluations can be saved for demonstration but do not certify. Eligible published-version evaluations retain `manual_chat` provenance and update the persisted learner, not the trainer performing import.

## 8. Verification and release evidence

Run the applicable checks locally with synthetic fixtures and record exact commands, dates, pass/fail counts, failures, and unrun reasons. Repository test files are not evidence that a test was executed.

### 8.1 Static, unit, and build checks

```sh
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

The unit suite includes focused coverage for local protocol behavior, preflight, generation checkpoint/resume/budget behavior, manual exchange, source evidence/publication gates, Standard Meds content/import protections, simulation, and certification. Review actual output rather than inferring coverage or success from test names.

### 8.2 Firestore rules/integration checks

```sh
java -version
npm run test:rules
```

`test:rules` invokes the Firebase CLI Firestore emulator, so a working Java runtime and the Firebase emulator dependencies must be available. It uses the repository's demo rules-test project. Do not point it at live/internal data. Record emulator/JDK installation or startup failures as unrun checks, not passes.

### 8.3 Playwright browser checks

Install the Chromium test browser if it is not already present:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.playwright-browsers" npx playwright install chromium
```

Then run:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.playwright-browsers" npm run test:e2e
```

The workspace-local `.playwright-browsers` directory is Git-ignored and can be removed after validation.

Without `PLAYWRIGHT_BASE_URL`, Playwright starts/reuses the local Next.js development server at its configured local URL. Use synthetic local services only. The current checked-in `tests/e2e/smoke.spec.ts` covers unauthenticated login and cohort-join rendering only; passing it is not the full Phase 5 trainer/learner/Standard Meds acceptance matrix.

### 8.4 Local runtime and manual-path checks

```sh
npm run verify:local-ai:mlx
```

Run the optional Ollama diagnostic only for that profile. For release evidence, also exercise the authenticated manual curriculum and trainer-only judge routes against synthetic emulator data, including malformed input, stale packages, and confirmation that invalid imports write nothing. Do not claim real MLX preflight success without a recorded real run.

A complete Phase 5 gate still requires the applicable Standard Meds golden curriculum/scenario/certification cases, accessibility/responsive review, authorization/redaction checks, and the resumability workflow described in document 07. Static checks and the current smoke test alone are insufficient.

## 9. Rollback

### 9.1 Preserve evidence and stop writes first

1. Stop new generation, manual imports, source approvals, publication, and certification writes.
2. Stop local application/model/emulator processes through their normal foreground or script controls.
3. Preserve required synthetic run reports and historical evidence in an approved local location without exporting secrets or real sensitive data.
4. Do not delete the fork or original directory as part of rollback.

Code rollback does not undo Firestore/Storage writes. Keep upgraded synthetic data separate from the baseline emulator/namespace. Do not run a code/data rollback against production-like data.

### 9.2 Return to the original application

Use the untouched original project at:

```text
/Users/connor/Coding/Contracting/Logicall/Telehealth LMS
```

This is the original directory that contains the separate `upgrade-fork` child; operate on the original project's own files, not the fork. Do not run Git mutation commands in the original repository and do not copy upgraded drafts, checkpoints, local configuration, or generated data back into it.

### 9.3 Return the fork to the protected baseline

The full pre-upgrade fork baseline is:

```text
0614770df8511da4a78dbca85ef2a95fae7252bd
```

After preserving required work and confirming the operation is intended, inspect that baseline from the fork with:

```sh
git switch --detach 0614770df8511da4a78dbca85ef2a95fae7252bd
```

This provides the baseline code without rewriting the original repository. Do not use `git reset --hard`, `git clean`, or force operations as a routine rollback: they can destroy local evidence and configuration. For a permanent branch history change or selective phase revert, use a separately reviewed Git operation after preserving required evidence.

Baseline code does not make upgraded Firestore records compatible automatically. Use a separate clean synthetic emulator/namespace for baseline validation rather than attempting an unreviewed destructive data downgrade.

## 10. Training and readiness limitation

The simulations are text-only plus synthetic workflow events. They do not observe actual speaking, listening, pronunciation, audio quality, hold behavior, or a learner's performance on a real call.

Even when approved content, required synthetic scenario coverage, deterministic gates, and certification checks pass, the defensible claim is limited to knowledge and actions demonstrated in the specified approved synthetic curriculum version. Simulated completion or certification is not live-call authorization. Require supervised live-call assessment until the company separately approves a broader operational readiness policy.
