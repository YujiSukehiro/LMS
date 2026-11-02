'use client';

import { Plus, Trash } from 'lucide-react';
import type { PublicSimScenario } from '@/lib/schemas/curriculum';
import type {
  ScenarioContext,
  ScenarioEvidenceRequirements,
} from '@/lib/schemas/simulation-state';
import type { SourceExcerptRef } from '@/lib/schemas/source-truth';
import {
  EditorSection,
  IconButton,
  NumberField,
  SelectField,
  StringListField,
  TextAreaField,
  TextField,
} from './fields';

const DIRECTION_OPTIONS = [
  { value: 'outbound', label: 'Outbound' },
  { value: 'inbound', label: 'Inbound' },
  { value: 'callback', label: 'Callback' },
];
const QUEUE_OPTIONS = [
  { value: 'recovery', label: 'Recovery' },
  { value: 'customer_support', label: 'Customer support' },
  { value: 'medical_chat', label: 'Medical chat' },
  { value: 'renewals', label: 'Renewals' },
];
const STAGE_OPTIONS = [
  { value: 'dosage', label: 'Dosage' },
  { value: 'checkout', label: 'Checkout' },
  { value: 'dosage_checkout', label: 'Dosage + checkout' },
  { value: 'score', label: 'Score' },
  { value: 'support_case', label: 'Support case' },
  { value: 'pending_info', label: 'Pending information' },
  { value: 'renewal_declined', label: 'Renewal declined' },
];
const CONTACT_OPTIONS = [
  { value: 'lead', label: 'Lead' },
  { value: 'existing_patient', label: 'Existing patient' },
  { value: 'third_party', label: 'Third party' },
  { value: 'voicemail', label: 'Voicemail' },
];
const PRICING_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'passive', label: 'Passive' },
  { value: 'not_applicable', label: 'Not applicable' },
];

function newContext(): ScenarioContext {
  return {
    direction: 'outbound',
    queue: 'recovery',
    product: '',
    stage: 'dosage',
    contactState: 'lead',
    pricingPosture: 'active',
    caseBranch: '',
    syntheticTimezone: 'UTC',
    syntheticNow: new Date().toISOString(),
    sourceRevision: '',
    curriculumVersion: '',
  };
}

function newEvidenceRequirements(): ScenarioEvidenceRequirements {
  return {
    minimumLearnerTurns: 2,
    requiredInspections: [],
    requiredWorkflowActions: [],
    requiredWrapUpEvidence: [],
    requiredGateIds: [],
    requiredCustomerConcerns: [],
    expectedDurationMinutes: null,
    gateSourceRefs: {},
    maximumCriticalFailures: 0,
    maximumMajorFailures: 0,
  };
}

export function ScenarioContextEvidenceEditor({
  scenario,
  onChange,
}: {
  scenario: PublicSimScenario;
  onChange: (scenario: PublicSimScenario) => void;
}) {
  const context = scenario.context;
  const evidence = scenario.evidenceRequirements;
  const setContext = <K extends keyof ScenarioContext>(key: K, value: ScenarioContext[K]) => {
    if (context) onChange({ ...scenario, context: { ...context, [key]: value } });
  };
  const setEvidence = <K extends keyof ScenarioEvidenceRequirements>(
    key: K,
    value: ScenarioEvidenceRequirements[K],
  ) => {
    if (evidence) onChange({ ...scenario, evidenceRequirements: { ...evidence, [key]: value } });
  };

  return (
    <>
      <EditorSection
        title="Deterministic scenario context"
        badge={<span className="pulse-pill text-[0.68rem]">Public scenario data</span>}
      >
        <p className="text-xs text-pulse-muted">
          These synthetic dimensions drive lifecycle, contact, workflow, and gate behavior. Use a real ISO timestamp and the
          approved source/curriculum identifiers; QA does not infer missing context.
        </p>
        {context ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <SelectField
                label="Call direction"
                value={context.direction}
                options={DIRECTION_OPTIONS}
                onChange={(value) => setContext('direction', value as ScenarioContext['direction'])}
              />
              <SelectField
                label="Queue"
                value={context.queue}
                options={QUEUE_OPTIONS}
                onChange={(value) => setContext('queue', value as ScenarioContext['queue'])}
              />
              <SelectField
                label="Stage"
                value={context.stage}
                options={STAGE_OPTIONS}
                onChange={(value) => setContext('stage', value as ScenarioContext['stage'])}
              />
              <SelectField
                label="Contact state"
                value={context.contactState}
                options={CONTACT_OPTIONS}
                onChange={(value) => setContext('contactState', value as ScenarioContext['contactState'])}
              />
              <SelectField
                label="Pricing posture"
                value={context.pricingPosture}
                options={PRICING_OPTIONS}
                onChange={(value) => setContext('pricingPosture', value as ScenarioContext['pricingPosture'])}
              />
              <TextField label="Product" value={context.product} onChange={(value) => setContext('product', value)} />
            </div>
            <TextField
              label="Case branch"
              value={context.caseBranch}
              hint="Exact branch key used by deterministic gates, for example an approved support or clinical branch."
              onChange={(value) => setContext('caseBranch', value)}
              mono
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Synthetic timezone"
                value={context.syntheticTimezone}
                placeholder="America/Boise"
                hint="IANA timezone used only for synthetic local-time checks."
                onChange={(value) => setContext('syntheticTimezone', value)}
              />
              <TextField
                label="Synthetic current time"
                value={context.syntheticNow}
                placeholder="2026-01-15T17:00:00.000Z"
                hint="ISO 8601 date-time including a timezone offset."
                onChange={(value) => setContext('syntheticNow', value)}
                mono
              />
              <TextField
                label="Source revision"
                value={context.sourceRevision}
                hint="Identifier of the reviewed source revision; never fabricated by QA."
                onChange={(value) => setContext('sourceRevision', value)}
                mono
              />
              <TextField
                label="Curriculum version"
                value={context.curriculumVersion}
                onChange={(value) => setContext('curriculumVersion', value)}
                mono
              />
            </div>
          </>
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-pulse-md border border-pulse-amber/40 bg-pulse-amber/5 p-3">
            <p className="text-sm text-pulse-amber">This historical scenario has no deterministic context. New runs cannot start yet.</p>
            <button type="button" className="pulse-btn" onClick={() => onChange({ ...scenario, context: newContext() })}>
              <Plus aria-hidden className="size-4" />
              Add scenario context
            </button>
          </div>
        )}
      </EditorSection>

      <EditorSection
        title="Assessment evidence requirements"
        badge={<span className="pulse-pill text-[0.68rem]">Text + actions only</span>}
      >
        <p className="rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-2 p-3 text-xs text-pulse-secondary">
          Assessment is text/action-only: deterministic eligibility uses synthetic learner utterances and recorded simulation
          actions. It does not verify live outcomes, accept model claims as evidence, or make SME/source-approval decisions.
        </p>
        {evidence ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <NumberField
                label="Minimum learner turns"
                value={evidence.minimumLearnerTurns}
                min={0}
                max={12}
                onChange={(value) => setEvidence('minimumLearnerTurns', value)}
              />
              <NumberField
                label="Maximum critical failures"
                value={evidence.maximumCriticalFailures}
                min={0}
                onChange={(value) => setEvidence('maximumCriticalFailures', value)}
              />
              <NumberField
                label="Maximum major failures"
                value={evidence.maximumMajorFailures}
                min={0}
                onChange={(value) => setEvidence('maximumMajorFailures', value)}
              />
            </div>
            <div>
              <label className="flex w-fit items-center gap-2 text-xs font-semibold text-pulse-secondary">
                <input
                  type="checkbox"
                  className="size-4 accent-current"
                  checked={evidence.expectedDurationMinutes !== null}
                  onChange={(event) => setEvidence('expectedDurationMinutes', event.target.checked ? 8 : null)}
                />
                Set an expected duration
              </label>
              {evidence.expectedDurationMinutes !== null ? (
                <NumberField
                  label="Expected duration (minutes)"
                  value={evidence.expectedDurationMinutes}
                  min={1}
                  max={30}
                  className="mt-2 max-w-xs"
                  onChange={(value) => setEvidence('expectedDurationMinutes', value)}
                />
              ) : null}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <StringListField
                label="Required pre-call inspections"
                values={evidence.requiredInspections}
                addLabel="Add inspection ID"
                hint="Structured inspection IDs required before dialing."
                onChange={(value) => setEvidence('requiredInspections', value)}
              />
              <StringListField
                label="Required workflow actions"
                values={evidence.requiredWorkflowActions}
                addLabel="Add workflow action ID"
                hint="Recorded action IDs, not dialogue promises."
                onChange={(value) => setEvidence('requiredWorkflowActions', value)}
              />
              <StringListField
                label="Required wrap-up evidence"
                values={evidence.requiredWrapUpEvidence}
                addLabel="Add wrap-up evidence"
                hint="For example: note, suppression, escalation, or callback."
                onChange={(value) => setEvidence('requiredWrapUpEvidence', value)}
              />
              <StringListField
                label="Required gate IDs"
                values={evidence.requiredGateIds}
                addLabel="Add gate ID"
                hint="Required gates need observed evidence and reviewed source references."
                onChange={(value) => setEvidence('requiredGateIds', value)}
              />
            </div>
            <StringListField
              label="Required customer concerns"
              values={evidence.requiredCustomerConcerns}
              addLabel="Add customer concern"
              hint="Track-defined concern IDs or labels; these do not create source evidence."
              onChange={(value) => setEvidence('requiredCustomerConcerns', value)}
            />
            <GateSourceRefEditor evidence={evidence} onChange={(value) => setEvidence('gateSourceRefs', value)} />
          </>
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-pulse-md border border-pulse-amber/40 bg-pulse-amber/5 p-3">
            <p className="text-sm text-pulse-amber">This historical scenario has no evidence checklist. New runs cannot start yet.</p>
            <button
              type="button"
              className="pulse-btn"
              onClick={() => onChange({ ...scenario, evidenceRequirements: newEvidenceRequirements() })}
            >
              <Plus aria-hidden className="size-4" />
              Add evidence requirements
            </button>
          </div>
        )}
      </EditorSection>
    </>
  );
}

function GateSourceRefEditor({
  evidence,
  onChange,
}: {
  evidence: ScenarioEvidenceRequirements;
  onChange: (refs: ScenarioEvidenceRequirements['gateSourceRefs']) => void;
}) {
  const gateIds = [...new Set([...evidence.requiredGateIds.filter(Boolean), ...Object.keys(evidence.gateSourceRefs)])];

  function setRefs(gateId: string, refs: SourceExcerptRef[]) {
    const next = { ...evidence.gateSourceRefs };
    if (refs.length === 0) delete next[gateId];
    else next[gateId] = refs;
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-3 border-t border-pulse-border-subtle pt-3">
      <div>
        <h4 className="text-xs font-semibold text-pulse-secondary">Gate source references</h4>
        <p className="mt-1 text-[0.7rem] text-pulse-muted">
          Add only reviewed excerpt metadata and verbatim source text. Empty references are removed; QA never supplies or approves them.
        </p>
      </div>
      {gateIds.length === 0 ? <p className="text-xs text-pulse-muted">Add a required gate ID to attach its source evidence.</p> : null}
      {gateIds.map((gateId) => {
        const refs = evidence.gateSourceRefs[gateId] ?? [];
        const required = evidence.requiredGateIds.includes(gateId);
        return (
          <fieldset key={gateId} className="flex flex-col gap-3 rounded-pulse-md border border-pulse-border-subtle p-3">
            <legend className="pulse-metric px-1 text-xs font-semibold text-pulse-primary">{gateId}</legend>
            {!required ? <p className="text-xs text-pulse-muted">This gate is not currently required; its references are retained.</p> : null}
            {required && refs.length === 0 ? (
              <p className="text-xs font-medium text-pulse-amber">
                Missing source reference: this required gate has no reviewed source excerpt.
              </p>
            ) : null}
            {refs.map((ref, index) => (
              <div key={index} className="flex flex-col gap-3 rounded-pulse-md bg-pulse-surface-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-pulse-secondary">Source excerpt {index + 1}</span>
                  <IconButton
                    label={`Remove ${gateId} source excerpt ${index + 1}`}
                    onClick={() => setRefs(gateId, refs.filter((_, refIndex) => refIndex !== index))}
                  >
                    <Trash aria-hidden className="size-3.5" />
                  </IconButton>
                </div>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem]">
                  <TextField
                    label="Document ID"
                    value={ref.documentId}
                    onChange={(value) => updateRef(refs, index, { documentId: value }, (next) => setRefs(gateId, next))}
                    mono
                  />
                  <TextField
                    label="Revision ID"
                    value={ref.revisionId}
                    onChange={(value) => updateRef(refs, index, { revisionId: value }, (next) => setRefs(gateId, next))}
                    mono
                  />
                  <NumberField
                    label="Page"
                    value={ref.pageNumber}
                    min={1}
                    onChange={(value) => updateRef(refs, index, { pageNumber: value }, (next) => setRefs(gateId, next))}
                  />
                </div>
                <TextAreaField
                  label="Exact source text"
                  value={ref.exactText}
                  max={12_000}
                  rows={3}
                  onChange={(value) => updateRef(refs, index, { exactText: value }, (next) => setRefs(gateId, next))}
                />
                <label className="flex w-fit items-start gap-2 text-xs text-pulse-secondary">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-current"
                    checked={ref.fromApprovedTranscription}
                    onChange={(event) =>
                      updateRef(
                        refs,
                        index,
                        { fromApprovedTranscription: event.target.checked },
                        (next) => setRefs(gateId, next),
                      )
                    }
                  />
                  This exact excerpt comes from an approved transcription
                </label>
              </div>
            ))}
            <button
              type="button"
              className="pulse-btn pulse-btn-ghost w-fit px-2 py-1 text-xs"
              onClick={() =>
                setRefs(gateId, [
                  ...refs,
                  { documentId: '', revisionId: '', pageNumber: 1, exactText: '', fromApprovedTranscription: false },
                ])
              }
            >
              <Plus aria-hidden className="size-3.5" />
              Add reviewed source excerpt
            </button>
          </fieldset>
        );
      })}
    </div>
  );
}

function updateRef(
  refs: SourceExcerptRef[],
  index: number,
  patch: Partial<SourceExcerptRef>,
  onChange: (refs: SourceExcerptRef[]) => void,
) {
  onChange(refs.map((ref, refIndex) => (refIndex === index ? { ...ref, ...patch } : ref)));
}
