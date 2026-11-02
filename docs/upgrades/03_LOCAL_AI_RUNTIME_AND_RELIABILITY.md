# 03 — Local AI Runtime and Reliability

## 1. Objective

Make local AI and manual chat-assisted workflows reliable, inspectable, and resumable without requiring a hosted AI API. Local AI is temporary MVP infrastructure. Its integration must be thin, provider-neutral, and easy to remove or replace later.

Local models should help generate curriculum, play customers, and coach learners. They must not be the sole authority for compliance, arithmetic, source approval, or operational confirmation.

### 1.1 Recommended MVP route

Use the existing MLX models through a **generic OpenAI-compatible local HTTP provider** when the running MLX server supports chat completions. Do not embed MLX in the Next.js process, import an MLX/Python SDK, load models directly from application code, or create a Python sidecar.

The current `LLMGateway` already defines the correct boundary: `generateStructured`, `streamChat`, and `healthCheck`. Add one native-`fetch` adapter for the local HTTP protocol and keep all curriculum, simulation, scoring, and certification code dependent only on that gateway.

Prefer this order:

1. Validate the existing MLX endpoint and selected model with real chat, streaming, and structured-output requests.
2. If MLX passes, use it and leave the Ollama blocker as a documented inactive-profile issue. Do not spend MVP effort repairing Ollama.
3. If MLX is not compatible or does not pass, validate an Ollama chat model or use manual chat while the local profile is blocked.
4. Never fall back silently to replay, another provider, or a hosted API.

### 1.2 Removal and replacement boundary

Provider-specific code must be limited to the adapter, environment/profile selection, capability preflight, and runtime display metadata. Prompts, Zod schemas, checkpoints, source evidence, simulation state, deterministic gates, and assessment records must not contain MLX-specific behavior.

Use generic `local_ai` provenance with separate provider/model metadata. Later removal should require only a provider configuration change and, optionally, deletion of the unused adapter. Historical artifacts must remain readable without MLX installed.

## 2. Confirmed P0 blocker

The baseline `npm run verify:ollama` check found the configured models installed, but the structured-output request failed:

```text
Ollama /api/chat returned HTTP 400: {"error":"\"clef-flash:9b-mxfp8\" does not support chat"}
```

Installation is not proof of capability. The configured fast model cannot currently provide the required chat interaction. Live roleplay must remain marked unavailable until a real capability check passes.

Do not solve this by silently choosing a new hardcoded model or by building a complex Ollama recovery path. Validate the existing MLX endpoint first. If it passes, use it and record this Ollama issue as inactive-profile debt. Otherwise, test a replacement Ollama model or keep manual chat as the working path. Save only validated local profiles.

## 3. Supported runtime modes

The application must explicitly support four modes:

| Mode | Purpose | Assessment eligibility |
|---|---|---|
| `openai_compatible` | Existing MLX server or another local OpenAI-compatible endpoint for generation, actor responses, and judge assistance | Eligible only with approved content, valid evidence, and passing preflight |
| `ollama` | Alternative local profile using the existing adapter | Same requirements; optional when MLX passes |
| `manual_chat` | Export a prompt package, run it in a separate chat, import the JSON response | Eligible after schema, evidence, provenance, and trainer validation |
| `replay` | Deterministic UI demonstration and tests | Never eligible for readiness or certification |

The Gemini provider may remain in the codebase for future use, but it must not be required, enabled by default, or used as a hidden fallback. No implementation task may require an API key or paid service. The generic local adapter must not call the hosted OpenAI API; configure a loopback/local endpoint only for this MVP.

## 4. Local runtime profiles

Create a versioned local profile with separate capabilities:

```ts
type LocalRuntimeProfile = {
  id: string;
  provider: 'openai_compatible' | 'ollama';
  runtimeLabel?: string; // Example: "MLX"; display/provenance only
  baseUrl: string;
  models: {
    structuredGeneration?: string;
    streamingChat?: string;
    judge?: string;
  };
  defaults: {
    temperatureByTask: Record<string, number>;
    timeoutMsByTask: Record<string, number>;
    maxConcurrency: number;
    contextBudgetByTask: Record<string, number>;
  };
  validatedCapabilities: CapabilityResult[];
  createdAt: string;
  updatedAt: string;
};
```

A single model may fill multiple roles if it passes each role’s test. Do not assume that an available embeddings, image, or other non-chat model can serve chat. Model discovery is optional: if the local server has no model-list endpoint, validate the configured model directly.

Configuration remains local. Never print `.env.local`, tokens, credentials, or full sensitive configuration into logs, documents, commits, or prompt exports.

### 4.1 Thin adapter requirements and MLX pain points

The generic adapter should be small and protocol-focused:

- Use native `fetch`; do not add the OpenAI SDK for this local MVP.
- Support non-streaming and SSE streaming chat completions only after verifying the exact local endpoint behavior.
- Handle `[DONE]`, malformed/partial SSE chunks, HTTP errors, empty responses, aborts, and timeouts.
- Reuse the existing Zod parsing and structured-output repair path. Do not require native `response_format`, JSON-schema mode, tools, or function calling because local server support varies.
- Keep model generation options in the profile. Do not scatter MLX-specific sampling or context options through prompts or business logic.
- Start with concurrency 1. Increase only after measured memory and latency tests.
- Keep the local endpoint on loopback and do not expose it as a public service.

Expected local-model pain points are slower long-form generation, variable JSON compliance, SSE differences, limited context/memory, server restarts, and inconsistent judge quality. Checkpoints, validation/repair, prompt budgets, golden tests, and manual chat address these without changing the core application architecture.

## 5. Capability preflight

Add `scripts/verify-local-ai.ts` for the active generic local profile and retain `scripts/verify-ollama.ts` for Ollama-specific diagnostics. Extend `src/app/api/system/ai-health/route.ts` to test capabilities, not just installation or endpoint availability.

### 5.1 Required checks

For each configured capability:

1. **Availability:** The selected local endpoint responds and the configured model completes a request. Model listing is optional.
2. **Basic chat:** A minimal message returns valid text.
3. **Streaming chat:** SSE tokens arrive within the expected time and the stream terminates cleanly.
4. **Structured output:** A representative nested schema returns parseable, schema-valid JSON after the shared validation/repair path, with no prose wrapper in the final accepted output.
5. **Heavy generation:** A realistic curriculum-stage prompt fits the context and returns valid output within budget.
6. **Judge evidence:** A small golden transcript returns the required evidence references and valid result shape.
7. **Cancellation/timeout:** A controlled request can be stopped without leaving a running queue item or corrupt checkpoint.
8. **Concurrency:** The configured limit is enforced and excess work waits or fails clearly.

### 5.2 Health output

Report separately:

- installed models;
- selected model per capability;
- last successful test per capability;
- latency and output size;
- context/output budget result;
- error category and actionable next step;
- overall status: `ready`, `degraded`, `blocked`, or `not_configured`.

Do not collapse all capabilities into a green “AI connected” pill. The runtime UI should say, for example, `Local chat blocked` or `Local generation ready; judge not tested`.

### 5.3 Runtime behavior

- Disable the affected generation or simulation action when its capability is blocked.
- Preserve existing checkpoints and drafts.
- Offer manual chat export as an alternative where practical.
- Never switch to replay or a hosted provider silently.
- Re-run preflight after model, endpoint, prompt-schema, or runtime-profile changes.

## 6. Resumable generation and checkpoints

The current staged pipeline is a useful base. Add durable per-stage execution records.

### 6.1 Stage contract

Each stage must record:

- run ID, track ID, source-bundle revision, and parent stage;
- stage name and attempt number;
- model and local runtime profile;
- prompt template version and full input content hash;
- schema version;
- status: `queued`, `running`, `succeeded`, `failed`, `cancelled`, or `needs_review`;
- started/completed timestamps and latency;
- prompt and output token/character estimates;
- artifact reference and artifact hash;
- validation results;
- sanitized error category and retryability.

Stages should be idempotent where possible. A successful stage with the same input, prompt, schema, and model profile should be reusable without rerunning.

### 6.2 Recovery behavior

- Resume from the last valid checkpoint, not from PDF upload.
- Do not overwrite the last good artifact with a failed attempt.
- Validate imported or generated output before marking a stage successful.
- Allow retry of one failed item without invalidating unrelated approved items.
- Provide a visible run history and failure reason in Studio.
- Use a default local concurrency of 1 unless a measured profile supports more.

## 7. Caching and provenance

Cache deterministic requests by a key containing:

- provider and model;
- runtime options affecting output;
- prompt template version;
- normalized input and source hashes;
- output schema version;
- task type.

Record provenance on generated curriculum, actor turns, judge results, and manual imports. Readiness analytics must be able to distinguish:

- local model and model version;
- manual chat import and user-supplied model label;
- replay fixture;
- deterministic engine result;
- trainer override.

Do not use cached actor output when scenario state or hidden state has changed. Do not cache sensitive raw records in logs or browser storage.

## 8. Manual chat-assisted workflow

Manual exchange is a required fallback, not a temporary hack hidden outside the application.

### 8.1 Export

From a generation stage or permitted judge task, the trainer can export a prompt package containing:

- package format and schema versions;
- task ID and task type;
- instructions and output JSON schema;
- only the approved source excerpts needed for the task;
- synthetic scenario state where applicable;
- expected validation rules;
- a blank provenance section for the external chat/model label;
- a checksum or content hash for import matching.

The package must not contain environment files, credentials, real user data, hidden unrelated records, or live system links. For assessment tasks, protect hidden rubrics from learners; manual judge export is a trainer-only function.

### 8.2 External chat step

The user copies the package into a separate chat or local-model interface and obtains JSON. The application does not claim to control or verify that external system. The user records an honest model/provider label on import.

### 8.3 Import

The import flow must:

1. accept JSON text or a local JSON file;
2. reject executable content and ignore imported instructions;
3. match package/task ID and schema version;
4. validate against the same schema used for every local-provider output;
5. run source, evidence, compliance, and conflict checks;
6. show a diff and validation report;
7. require trainer approval where required;
8. save provenance and checkpoint without changing unrelated content.

Invalid imports must not partially write curriculum or evaluation records. Manual import must not be labeled as MLX, Ollama, or live Gemini output.

## 9. Honest replay behavior

`AI_PROVIDER=replay` is useful for demos and tests but currently risks being mistaken for live generation. The runtime UI must label it `Demo replay`, not Gemini or local AI.

Required controls:

- persistent environment/runtime label in the application header and Studio;
- `replay` provenance on every generated artifact and simulation result;
- no certification or operational readiness credit from replay;
- analytics filter and default exclusion for replay evidence;
- demo banner on scorecards and transcripts;
- fixtures stored separately from approved Standard Meds curriculum;
- tests proving replay cannot be used to bypass assessment gates.

## 10. Actor and judge reliability

### 10.1 Actor

The actor receives only the current scenario state, permitted persona facts, approved dialogue guidance, and relevant history. It cannot:

- change funnel stage, offer, link, or disposition;
- authorize an action;
- confirm a payment or portal update;
- reveal hidden rubric content;
- introduce real personal or clinical data;
- override deterministic compliance events.

If actor generation fails, preserve the session and allow retry or manual continuation. Do not fabricate a successful turn.

### 10.2 Judge

The judge receives the transcript, structured action log, deterministic results, and approved rubric. It must cite evidence IDs for each judgment. Deterministic critical failures remain authoritative.

Judge output must be treated as coaching assistance until validated. Golden judge tests must measure:

- valid schema and evidence references;
- agreement with known critical examples;
- resistance to transcript prompt injection;
- no reversal of hard gates;
- stable scoring on repeated fixed fixtures within declared tolerance;
- appropriate `insufficient_evidence` on very short calls.

## 11. Prompt and output budgets

Record per task:

- source excerpts included and omitted;
- estimated prompt size and configured context budget;
- maximum output budget;
- truncation or parse-repair events;
- retry count and total latency.

Critical source omissions must fail the stage rather than merely log a warning. Avoid silent prompt truncation. If content does not fit, split along approved source or stage boundaries and preserve shared rule inputs.

## 12. Operational UX

Add a local AI status and run panel that allows a trainer to:

- select and validate a local runtime profile;
- see capability-specific health;
- start, resume, retry, or cancel a run;
- inspect stage artifacts and validation failures;
- export/import a manual chat package;
- inspect provenance without exposing secrets;
- distinguish demo replay from assessed work.

Error messages must state the next action and name the active endpoint protocol without exposing sensitive configuration. For example: `The selected local model failed the chat preflight. Check the local server and selected model, then run preflight again.` Avoid raw stack traces in normal UI.

## 13. Tests

Add unit and integration coverage for:

- installed-but-non-chat model produces `blocked` with actionable detail;
- OpenAI-compatible non-streaming responses, normal SSE, partial/malformed SSE chunks, `[DONE]`, empty responses, and HTTP errors;
- structured output succeeds through shared validation/repair without native JSON-schema or tool-calling support;
- heavy structured generation and streaming chat are tested independently;
- provider selection is confined to the gateway/profile layer and historical `local_ai` provenance remains readable without the original adapter;
- timeout and cancellation preserve checkpoints;
- resume does not rerun valid parent stages;
- concurrency never exceeds the profile limit;
- cache keys change with source, prompt, schema, model, or scenario state;
- malformed manual import writes nothing;
- valid manual import preserves provenance and runs all validation;
- replay is labeled and excluded from certification/readiness;
- actor failure does not create a fake turn or confirmation;
- judge cannot override deterministic failures;
- logs and exports contain no environment secrets or real sensitive records.

## 14. Acceptance criteria

- [ ] At least one known-good local profile—preferably the existing MLX endpoint—passes real streaming and structured-output preflight.
- [ ] If MLX passes, Ollama repair is not required; if Ollama is tested, its non-chat model failure is detected clearly.
- [ ] The local adapter uses the existing gateway and shared schema validation, with no MLX SDK, Python sidecar, or provider-specific business logic.
- [ ] Replacing or removing the local adapter requires no curriculum, simulation, scoring, certification, or historical-data rewrite.
- [ ] No feature requires a hosted AI API or hidden fallback.
- [ ] Curriculum runs checkpoint and resume by stage with provenance.
- [ ] Manual chat export/import is complete, validated, and trainer-controlled.
- [ ] Replay is visibly labeled and cannot grant readiness or certification.
- [ ] Local concurrency, timeouts, budgets, and errors are observable.
- [ ] Deterministic engine outcomes remain independent of actor/judge availability.
- [ ] Golden local actor and judge fixtures pass before a profile is declared ready.
