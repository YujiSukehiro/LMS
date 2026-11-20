'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { CircleAlert, CircleCheck, LoaderCircle, Lock, Play, Plus, Trash } from 'lucide-react';
import {
  ApiErrorBodySchema,
  ScenarioQARequestSchema,
  ScenarioQAResponseSchema,
  type ScenarioQAResult,
} from '@/lib/schemas/api';
import type { PublicSimScenario, SecretSimScenarioConfig } from '@/lib/schemas/curriculum';
import type { ScenarioQAFixture, ScriptedSimulationStep, SimulationAction } from '@/lib/schemas/simulation-state';
import { CanonicalDispositionSchema } from '@/lib/schemas/source-truth';
import {
  STANDARD_MEDS_SCENARIO_IDS,
  standardMedsQAFixtures,
  type StandardMedsScenarioId,
} from '@/lib/content/standard-meds-scenarios';
import { cn } from '@/lib/utils';
import { draftExpectedGateResults, draftQAFixtureSteps } from './qa-fixture-drafts';
import { EditorSection, IconButton, newItemId } from './fields';

const KIND_LABELS: Record<ScenarioQAFixture['kind'], string> = {
  golden_pass: 'Golden pass',
  golden_critical_fail: 'Golden critical fail',
};

export function ScenarioQASection({
  scenario,
  secret,
  onChange,
}: {
  scenario: PublicSimScenario;
  secret: SecretSimScenarioConfig;
  onChange: (secret: SecretSimScenarioConfig) => void;
}) {
  const pathname = usePathname();
  const trackId = trackIdFromPathname(pathname);
  const fixtures = secret.qaFixtures ?? [];
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ScenarioQAResult[]>([]);
  const missingSourceGateIds = (scenario.evidenceRequirements?.requiredGateIds ?? []).filter(
    (gateId) => gateId && (scenario.evidenceRequirements?.gateSourceRefs[gateId]?.length ?? 0) === 0,
  );
  const standardScenario = (STANDARD_MEDS_SCENARIO_IDS as readonly string[]).includes(scenario.id);

  function setFixtures(next: ScenarioQAFixture[]) {
    onChange({ ...secret, qaFixtures: next });
    setResults([]);
    setError(null);
  }

  function addDraftFixture(kind: ScenarioQAFixture['kind']) {
    const expectedDisposition = existingCanonicalDisposition(scenario, secret);
    if (!expectedDisposition) {
      setError('Choose an existing canonical expected disposition before adding a draft fixture.');
      return;
    }
    const expectedGateResults = draftExpectedGateResults(kind, scenario);
    const number = fixtures.filter((fixture) => fixture.kind === kind).length + 1;
    const fixture: ScenarioQAFixture = {
      id: newItemId(kind === 'golden_pass' ? 'qa-pass' : 'qa-fail'),
      title: `Draft ${KIND_LABELS[kind].toLowerCase()} ${number}`,
      kind,
      steps: draftQAFixtureSteps(kind, scenario, expectedDisposition),
      expectedDisposition,
      expectedGateResults,
    };
    setFixtures([...fixtures, fixture]);
  }

  function loadStandardTemplates() {
    if (!standardScenario) return;
    const templates = standardMedsQAFixtures(scenario.id as StandardMedsScenarioId);
    const existingIds = new Set(fixtures.map((fixture) => fixture.id));
    const additions = templates.filter((fixture) => !existingIds.has(fixture.id));
    if (additions.length === 0) {
      setError('The standard QA templates are already in the fixture list.');
      return;
    }
    setFixtures([...fixtures, ...additions]);
  }

  async function runFixtures() {
    const request = ScenarioQARequestSchema.safeParse({ scenario, fixtures });
    if (!request.success) {
      const first = request.error.issues[0];
      setError(`Check ${first?.path.join('.') || 'the QA request'}: ${first?.message ?? 'invalid value'}.`);
      return;
    }
    if (!trackId) {
      setError('The Track ID could not be determined from this Studio URL.');
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const response = await fetch(`/api/tracks/${encodeURIComponent(trackId)}/scenario-qa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.data),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const apiError = ApiErrorBodySchema.safeParse(body);
        throw new Error(apiError.success ? apiError.data.message ?? apiError.data.error : `Scripted QA failed (HTTP ${response.status}).`);
      }
      const parsed = ScenarioQAResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error('The server sent an unexpected scripted QA response.');
      setResults(parsed.data.results);
    } catch (runError) {
      setResults([]);
      setError(runError instanceof Error ? runError.message : 'Scripted QA did not run.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <EditorSection
      title="Scripted scenario QA"
      badge={
        <span className="pulse-pill pulse-pill-amber text-[0.68rem]">
          <Lock aria-hidden className="size-3" />
          Trainers only
        </span>
      }
      actions={
        <button
          type="button"
          className="pulse-btn"
          disabled={running || fixtures.length === 0 || !scenario.context || !scenario.evidenceRequirements || !trackId}
          onClick={() => void runFixtures()}
        >
          {running ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Play aria-hidden className="size-4" />}
          {running ? 'Running scripted QA…' : 'Run scripted QA'}
        </button>
      }
    >
      <p className="text-xs text-pulse-muted">
        Fixtures stay in the trainer-only secret config and never enter public scenario fields or actor prompts. Runs use the
        production reducer in memory: no Firestore writes, learner progress, live links, messages, or payments.
      </p>
      <p className="rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-2 p-3 text-xs text-pulse-secondary">
        Step summaries intentionally hide utterance, note, correction, abort-reason, and payment-token text. All inputs and
        outputs are synthetic QA data.
      </p>

      {missingSourceGateIds.length > 0 ? (
        <div role="alert" className="rounded-pulse-md border border-pulse-amber/40 bg-pulse-amber/5 p-3 text-xs text-pulse-amber">
          <p className="font-semibold">Missing gate source references</p>
          <p className="mt-1">
            {missingSourceGateIds.join(', ')}. Add reviewed exact excerpts above; scripted QA does not invent or approve source evidence.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2" aria-label="Add QA fixtures">
        <button type="button" className="pulse-btn pulse-btn-ghost px-2 py-1 text-xs" onClick={() => addDraftFixture('golden_pass')}>
          <Plus aria-hidden className="size-3.5" />
          Add golden pass draft
        </button>
        <button
          type="button"
          className="pulse-btn pulse-btn-ghost px-2 py-1 text-xs"
          onClick={() => addDraftFixture('golden_critical_fail')}
        >
          <Plus aria-hidden className="size-3.5" />
          Add critical-fail draft
        </button>
        {standardScenario ? (
          <button type="button" className="pulse-btn pulse-btn-ghost px-2 py-1 text-xs" onClick={loadStandardTemplates}>
            <Plus aria-hidden className="size-3.5" />
            Load standard QA templates
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-pulse-md border border-pulse-crimson/40 bg-pulse-crimson/5 p-3 text-sm text-pulse-crimson">
          {error}
        </p>
      ) : null}

      {fixtures.length === 0 ? (
        <p className="text-sm text-pulse-muted">No QA fixtures yet. Add a synthetic draft or load the matching standard templates.</p>
      ) : (
        <ol className="flex flex-col gap-3" aria-label="Scripted QA fixtures">
          {fixtures.map((fixture, index) => (
            <li key={fixture.id} className="rounded-pulse-md border border-pulse-border-subtle p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold text-pulse-primary">{fixture.title}</h4>
                    <span
                      className={cn(
                        'pulse-pill text-[0.68rem]',
                        fixture.kind === 'golden_pass' ? 'pulse-pill-emerald' : 'pulse-pill-amber',
                      )}
                    >
                      {KIND_LABELS[fixture.kind]}
                    </span>
                  </div>
                  <p className="pulse-metric mt-1 break-all text-[0.7rem] text-pulse-muted">{fixture.id}</p>
                </div>
                <IconButton
                  label={`Remove QA fixture ${index + 1}: ${fixture.title}`}
                  onClick={() => setFixtures(fixtures.filter((candidate) => candidate.id !== fixture.id))}
                >
                  <Trash aria-hidden className="size-3.5" />
                </IconButton>
              </div>
              <p className="mt-2 text-xs text-pulse-secondary">
                Expected disposition: <span className="font-medium">{fixture.expectedDisposition}</span>
              </p>
              <p className="mt-1 text-xs text-pulse-secondary">
                Expected gates:{' '}
                {fixture.expectedGateResults.map((expected) => `${expected.ruleId} = ${expected.status}`).join('; ')}
              </p>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-semibold text-pulse-secondary">
                  {fixture.steps.length} safe synthetic step{fixture.steps.length === 1 ? '' : 's'}
                </summary>
                <ol className="mt-2 flex flex-col gap-2">
                  {fixture.steps.map((step, stepIndex) => (
                    <li key={stepIndex} className="rounded-pulse-md bg-pulse-surface-2 p-2 text-xs text-pulse-secondary">
                      <span className="pulse-metric mr-2 text-pulse-muted">Step {stepIndex + 1}</span>
                      <StepSummary step={step} />
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          ))}
        </ol>
      )}

      {results.length > 0 ? (
        <div className="flex flex-col gap-3 border-t border-pulse-border-subtle pt-3">
          <div role="status" className="text-xs text-pulse-muted">
            Last in-memory run: {results.filter((result) => result.passed).length}/{results.length} fixtures matched expectations.
            Rerun after editing the scenario or fixtures.
          </div>
          {results.map((result) => <QAResultCard key={result.fixtureId} result={result} />)}
        </div>
      ) : null}
    </EditorSection>
  );
}

function StepSummary({ step }: { step: ScriptedSimulationStep }) {
  return (
    <span className="inline-flex flex-col gap-1">
      {step.learnerUtterance ? <span>Synthetic learner utterance ({step.learnerUtterance.length} characters; text hidden)</span> : null}
      {step.action ? <span>{actionSummary(step.action)}</span> : null}
      {step.expectedEventType ? <span className="text-pulse-muted">Expected event: {step.expectedEventType}</span> : null}
    </span>
  );
}

function actionSummary(action: SimulationAction): string {
  switch (action.type) {
    case 'inspect': return `Inspect synthetic record: ${action.inspectionId}`;
    case 'dial': return 'Dial synthetic contact';
    case 'verify_identity': return 'Record synthetic identity verification';
    case 'set_contact': return `Set structured contact state: ${action.contact}`;
    case 'record_disclosure': return 'Record synthetic recording disclosure';
    case 'set_opt_out': return 'Record synthetic customer opt-out';
    case 'set_price_context':
      return `Set synthetic price context (asked: ${action.customerAskedPrice}; base committed: ${action.baseRecoveryCommitted}; plan: ${action.selectedPlanId ?? 'none'})`;
    case 'offer': return `Offer synthetic asset: ${action.assetId}`;
    case 'grant_sms_permission': return 'Record synthetic SMS permission';
    case 'send_sms': return `Send fake SMS for synthetic asset: ${action.assetId}`;
    case 'recording': return `Set synthetic recording state: ${action.state}`;
    case 'secure_payment': return 'Attempt secure payment with designated fake token (token hidden)';
    case 'workflow': return `Run synthetic workflow action: ${action.actionId}`;
    case 'patient_completion': return `Record synthetic patient completion: ${action.completionId} (organic: ${action.organic})`;
    case 'escalate': return 'Escalate through synthetic channel (structured correction details hidden)';
    case 'note': return 'Record synthetic note (text hidden)';
    case 'suppress': return 'Record synthetic suppression';
    case 'callback': return `Schedule synthetic callback: ${action.callbackAt}`;
    case 'wrap_up': return `Wrap up with canonical disposition: ${action.disposition}`;
    case 'abort': return 'Abort synthetic run (reason hidden)';
    default: return 'Structured synthetic simulation action';
  }
}

function QAResultCard({ result }: { result: ScenarioQAResult }) {
  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-pulse-md border p-3',
        result.passed ? 'border-pulse-emerald/40 bg-pulse-emerald/5' : 'border-pulse-crimson/40 bg-pulse-crimson/5',
      )}
      aria-label={`QA result for ${result.title}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold">{result.title}</h4>
          <p className="mt-1 text-xs text-pulse-muted">{KIND_LABELS[result.kind]} · {result.fixtureId}</p>
        </div>
        <span
          role="status"
          className={cn(
            'inline-flex items-center gap-1 text-xs font-semibold',
            result.passed ? 'text-pulse-emerald' : 'text-pulse-crimson',
          )}
        >
          {result.passed ? <CircleCheck aria-hidden className="size-4" /> : <CircleAlert aria-hidden className="size-4" />}
          {result.passed ? 'Matched expectations' : 'Did not match expectations'}
        </span>
      </div>

      <dl className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <ResultDatum label="Lifecycle" value={result.outcome.lifecycle} />
        <ResultDatum label="Disposition" value={result.outcome.selectedDisposition ?? 'none'} />
        <ResultDatum label="Disposition valid" value={nullableBoolean(result.outcome.dispositionCorrect)} />
        <ResultDatum label="Wrap-up complete" value={String(result.outcome.wrapUpComplete)} />
      </dl>

      {result.errors.length > 0 ? (
        <section className="rounded-pulse-md border border-pulse-crimson/40 bg-pulse-surface-1 p-3 text-xs">
          <h5 className="font-semibold text-pulse-crimson">Unreachable scripted steps</h5>
          <p className="mt-1 text-pulse-secondary">The production reducer rejected one or more steps. Review these errors before treating the fixture as viable.</p>
          <ul className="mt-2 list-disc pl-5 text-pulse-crimson">
            {result.errors.map((message, index) => <li key={index}>{message}</li>)}
          </ul>
        </section>
      ) : null}

      {result.kind === 'golden_pass' && !result.eligibility.eligible ? (
        <p className="rounded-pulse-md border border-pulse-amber/40 bg-pulse-amber/5 p-3 text-xs text-pulse-amber">
          This golden pass is not reachable as an eligible assessment under the current script and requirements. Reconcile the
          observed eligibility reasons; do not infer new SME decisions or source evidence.
        </p>
      ) : null}

      {result.expectationFailures.length > 0 ? (
        <section className="text-xs">
          <h5 className="font-semibold text-pulse-crimson">Expectation mismatches</h5>
          <ul className="mt-1 list-disc pl-5 text-pulse-secondary">
            {result.expectationFailures.map((message, index) => <li key={index}>{message}</li>)}
          </ul>
        </section>
      ) : null}

      <section className="rounded-pulse-md bg-pulse-surface-1 p-3 text-xs">
        <h5 className="font-semibold text-pulse-secondary">
          Assessment eligibility: <span className={result.eligibility.eligible ? 'text-pulse-emerald' : 'text-pulse-crimson'}>{result.eligibility.eligible ? 'eligible' : 'not eligible'}</span>
        </h5>
        <dl className="mt-2 grid gap-2 sm:grid-cols-3">
          <ResultDatum label="Minimum evidence met" value={String(result.eligibility.minimumEvidenceMet)} />
          <ResultDatum label="Disposition valid" value={String(result.eligibility.dispositionValid)} />
          <ResultDatum label="Deterministic critical failure" value={String(result.eligibility.deterministicCriticalFailure)} />
        </dl>
        {result.eligibility.reasons.length > 0 ? (
          <ul className="mt-2 list-disc pl-5 text-pulse-secondary">
            {result.eligibility.reasons.map((reason, index) => <li key={index}>{reason}</li>)}
          </ul>
        ) : <p className="mt-2 text-pulse-muted">No eligibility blockers were reported.</p>}
      </section>

      <details open={!result.passed}>
        <summary className="cursor-pointer text-xs font-semibold text-pulse-secondary">Gate details ({result.gates.length})</summary>
        {result.gates.length === 0 ? <p className="mt-2 text-xs text-pulse-muted">No gates applied to this run.</p> : (
          <ul className="mt-2 flex flex-col gap-2">
            {result.gates.map((gate) => (
              <li key={gate.ruleId} className="rounded-pulse-md bg-pulse-surface-1 p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="pulse-metric font-semibold text-pulse-primary">{gate.ruleId}</span>
                  <span className="pulse-pill text-[0.68rem]">{gate.status}</span>
                  <span className="text-pulse-muted">{gate.severity}</span>
                </div>
                {gate.sourceRefCount === 0 ? <p className="mt-2 font-medium text-pulse-amber">No gateSourceRefs are attached to this gate.</p> : null}
                <p className="mt-2 text-pulse-secondary">{gate.trainerDetail}</p>
                <p className="mt-1 text-pulse-muted">Learner feedback: {gate.learnerFeedback}</p>
                <p className="pulse-metric mt-1 break-all text-pulse-muted">
                  Evidence events: {gate.evidenceEventIds.join(', ') || 'none'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </details>

      <details>
        <summary className="cursor-pointer text-xs font-semibold text-pulse-secondary">Sanitized event details ({result.events.length})</summary>
        {result.events.length === 0 ? <p className="mt-2 text-xs text-pulse-muted">No events were recorded.</p> : (
          <ol className="mt-2 flex flex-col gap-2">
            {result.events.map((event) => (
              <li key={event.id} className="rounded-pulse-md bg-pulse-surface-1 p-3 text-xs">
                <p className="text-pulse-secondary">
                  <span className="pulse-metric font-semibold">#{event.sequence} {event.type}</span> · {event.actor} · {event.provenance}
                </p>
                <p className="pulse-metric mt-1 break-all text-[0.68rem] text-pulse-muted">{event.id}</p>
                <EventPayload payload={event.payload} />
              </li>
            ))}
          </ol>
        )}
      </details>
    </article>
  );
}

function ResultDatum({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-pulse-muted">{label}</dt>
      <dd className="mt-0.5 font-medium text-pulse-secondary">{value}</dd>
    </div>
  );
}

function EventPayload({ payload }: { payload: ScenarioQAResult['events'][number]['payload'] }) {
  const entries = Object.entries(payload);
  if (entries.length === 0) return <p className="mt-2 text-pulse-muted">No returnable structured metadata; free text remains hidden.</p>;
  return (
    <dl className="mt-2 grid gap-1 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="min-w-0">
          <dt className="inline text-pulse-muted">{key}: </dt>
          <dd className="inline break-words text-pulse-secondary">{Array.isArray(value) ? value.join(', ') : String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function existingCanonicalDisposition(
  scenario: PublicSimScenario,
  secret: SecretSimScenarioConfig,
): ScenarioQAFixture['expectedDisposition'] | null {
  const configured = CanonicalDispositionSchema.safeParse(secret.expectedDisposition);
  if (configured.success) return configured.data;
  for (const option of scenario.dispositionOptions) {
    const parsed = CanonicalDispositionSchema.safeParse(option);
    if (parsed.success) return parsed.data;
  }
  return null;
}

function nullableBoolean(value: boolean | null): string {
  return value === null ? 'not evaluated' : String(value);
}

function trackIdFromPathname(pathname: string): string | null {
  const match = /^\/studio\/([^/]+)/.exec(pathname);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
