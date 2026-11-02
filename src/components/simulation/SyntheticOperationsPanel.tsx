'use client';

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleCheck,
  ClipboardCheck,
  Clock,
  CreditCard,
  FileSearch,
  Headphones,
  Info,
  LoaderCircle,
  MessageSquareText,
  Pause,
  Phone,
  Play,
  Send,
  ShieldCheck,
  StickyNote,
  UserCheck,
  Workflow,
} from 'lucide-react';
import type { SimSessionDoc } from '@/lib/schemas/analytics';
import type { PublicSimScenario } from '@/lib/schemas/curriculum';
import { FAKE_PAYMENT_TOKENS } from '@/lib/schemas/simulation-constants';
import type {
  ScenarioState,
  SimulationAction,
  SimulationEvent,
  SyntheticOutboxRecord,
} from '@/lib/schemas/simulation-state';
import { cn } from '@/lib/utils';

export interface SyntheticOperationsPanelProps {
  scenario: PublicSimScenario;
  session: SimSessionDoc;
  outboxRecords: SyntheticOutboxRecord[];
  onAction: (action: SimulationAction) => Promise<SimSessionDoc | null>;
  disabled?: boolean;
}

const CONTACT_OPTIONS: Array<{ value: NonNullable<ScenarioState['contactReached']>; label: string }> = [
  { value: 'patient', label: 'Patient / customer' },
  { value: 'third_party', label: 'Third party' },
  { value: 'voicemail', label: 'Voicemail' },
  { value: 'no_answer', label: 'No answer' },
];

const CALLBACK_DELAYS = [
  { hours: 1, label: 'In 1 synthetic hour' },
  { hours: 24, label: 'In 1 synthetic day' },
  { hours: 72, label: 'In 3 synthetic days' },
] as const;

const ESCALATION_CORRECTIONS = [
  'Review the synthetic case branch.',
  'Correct the synthetic order state.',
  'Route the synthetic case to the support queue.',
] as const;

function humanize(value: string): string {
  return value.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function symbolicId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'synthetic';
}

function isSymbolicAssetId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value);
}

function unsafeOperationalText(value: string): boolean {
  return (
    /(?:\d[ -]*?){13,19}/.test(value) ||
    /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:\+?\d[ .-]?){10,15}/.test(value) ||
    /\b(?:password|passcode|cvv|cvc|ssn|social security)\s*(?:is|=|:)?\s*\S+/i.test(value) ||
    /\b(?:diagnos(?:is|ed)|medication|symptom|disease|condition|dose|dosage|health detail)\b/i.test(value) ||
    /(?:https?:\/\/|www\.)/i.test(value)
  );
}

function wrapUpEvidenceMet(evidence: string, state: ScenarioState): boolean {
  if (evidence === 'note') return state.noteReceiptIds.length > 0;
  if (evidence === 'suppression') return state.suppressionRecorded;
  if (evidence === 'escalation') return state.escalationReceiptIds.length > 0;
  if (evidence === 'callback') return state.callbackAt !== null;
  return false;
}

function eventIsBlocked(event: SimulationEvent): boolean {
  return event.payload.status === 'blocked';
}

/** Server-driven synthetic operations. The browser requests actions; only the server changes scenario outcomes. */
export function SyntheticOperationsPanel({
  scenario,
  session,
  outboxRecords,
  onAction,
  disabled = false,
}: SyntheticOperationsPanelProps) {
  const state = session.scenarioState;
  const context = state?.context ?? scenario.context;
  const requirements = scenario.evidenceRequirements;
  const events = useMemo(() => session.simulationEvents ?? [], [session.simulationEvents]);
  const gates = session.gateResults ?? [];
  const suggestedSmsAsset = context ? `${symbolicId(context.product)}-${context.stage}-link` : 'synthetic-link';
  const initialCallback = context
    ? new Date(new Date(context.syntheticNow).getTime() + 24 * 60 * 60 * 1000).toISOString()
    : '';

  const [pending, setPending] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [smsAssetId, setSmsAssetId] = useState(suggestedSmsAsset);
  const [offerAssetId, setOfferAssetId] = useState('base-offer');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [customerAskedPrice, setCustomerAskedPrice] = useState(false);
  const [baseRecoveryCommitted, setBaseRecoveryCommitted] = useState(false);
  const [note, setNote] = useState('');
  const [callbackAt, setCallbackAt] = useState(initialCallback);
  const [completionId, setCompletionId] = useState(
    context?.caseBranch.includes('nail_photo')
      ? 'patient_photo_uploaded'
      : context?.caseBranch.includes('clinical')
        ? 'patient_clinical_completed'
        : 'patient_id_submitted',
  );
  const [escalationCorrection, setEscalationCorrection] = useState<string>(ESCALATION_CORRECTIONS[0]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(events.at(-1)?.id ?? null);
  const noteId = useId();
  const smsId = useId();
  const offerId = useId();
  const planId = useId();

  useEffect(() => {
    if (!selectedEventId || !events.some((event) => event.id === selectedEventId)) {
      setSelectedEventId(events.at(-1)?.id ?? null);
    }
  }, [events, selectedEventId]);

  const controlsDisabled = disabled || pending !== null || !state;
  const inCall = state?.lifecycle === 'in_call';
  const preCall = state?.lifecycle === 'pre_call' || state?.lifecycle === 'ready_to_dial';
  const requiredGateIds = requirements?.requiredGateIds ?? [];
  const showPricing = context?.pricingPosture !== 'not_applicable' || requiredGateIds.includes('upgrade_sequence');
  const showOffers = showPricing || requiredGateIds.some((id) => ['offer_limit', 'upgrade_sequence'].includes(id));
  const showPatientCompletion = context?.queue === 'medical_chat';
  const showOrganicCompletion = scenario.dispositionOptions.includes('Organic');
  const selectedEventIndex = Math.max(0, events.findIndex((event) => event.id === selectedEventId));
  const selectedEvent = events[selectedEventIndex] ?? events.at(-1) ?? null;
  const blockedEvents = events.filter(eventIsBlocked).length;

  const run = async (key: string, action: SimulationAction, afterSuccess?: (updated: SimSessionDoc) => void) => {
    if (controlsDisabled) return;
    setLocalError(null);
    setPending(key);
    try {
      const updated = await onAction(action);
      if (updated) afterSuccess?.(updated);
    } finally {
      setPending(null);
    }
  };

  const submitNote = () => {
    const text = note.trim();
    if (!text) return;
    if (unsafeOperationalText(text)) {
      setLocalError('Use operational synthetic notes only. Remove URLs, direct identifiers, credentials, payment data, and health answers.');
      return;
    }
    void run('note', { type: 'note', text }, () => setNote(''));
  };

  const submitSms = () => {
    const assetId = smsAssetId.trim();
    if (!isSymbolicAssetId(assetId)) {
      setLocalError('Use a symbolic asset ID only: letters, numbers, dots, underscores, and hyphens. URLs are not accepted.');
      return;
    }
    void run('send-sms', { type: 'send_sms', assetId });
  };

  const submitOffer = () => {
    const assetId = offerAssetId.trim();
    if (!isSymbolicAssetId(assetId)) {
      setLocalError('The offer must be a symbolic asset ID, not a URL or external identifier.');
      return;
    }
    void run('offer', { type: 'offer', assetId });
  };

  const submitPriceContext = () => {
    const plan = selectedPlanId.trim();
    if (plan && !isSymbolicAssetId(plan)) {
      setLocalError('Use a symbolic plan ID only. Do not enter a real plan, customer, or external record ID.');
      return;
    }
    void run('price-context', {
      type: 'set_price_context',
      customerAskedPrice,
      selectedPlanId: plan || null,
      baseRecoveryCommitted,
    });
  };

  if (!state || !context) {
    return (
      <aside className="pulse-card p-5" aria-label="Synthetic training operations">
        <p className="pulse-label text-pulse-amber">Synthetic training</p>
        <h2 className="mt-1 text-lg font-bold">Operations unavailable</h2>
        <p className="mt-2 text-sm text-pulse-secondary">This historical session has no server-owned scenario state. Start a new scenario run to use synthetic operations.</p>
      </aside>
    );
  }

  return (
    <aside
      aria-labelledby="synthetic-operations-heading"
      className="pulse-card flex min-h-0 flex-col overflow-hidden xl:h-[min(62vh,40rem)]"
    >
      <header className="border-b border-pulse-border-subtle bg-pulse-surface-1 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="pulse-label flex items-center gap-1.5 text-pulse-indigo">
              <ShieldCheck aria-hidden className="size-4" /> Synthetic training
            </p>
            <h2 id="synthetic-operations-heading" className="mt-1 text-lg font-bold">Operations Panel</h2>
          </div>
          <span className="pulse-pill pulse-pill-indigo pulse-metric">{humanize(state.lifecycle)}</span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-pulse-muted">All outcomes are reduced by the training server. No live patient, order, message, payment, or external system is touched.</p>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div role="note" aria-label="Audible call skills notice" className="flex gap-2.5 rounded-pulse-md border border-pulse-amber/40 bg-pulse-amber/10 p-3 text-sm text-pulse-secondary">
          <Headphones aria-hidden className="mt-0.5 size-5 shrink-0 text-pulse-amber" />
          <p><strong className="text-pulse-primary">Text/action simulation only.</strong> This does not assess audible speaking, listening, or other audible call skills.</p>
        </div>

        {localError ? (
          <p role="alert" className="flex gap-2 rounded-pulse-md border border-pulse-crimson/40 bg-pulse-crimson/10 p-3 text-xs text-pulse-crimson">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" /> {localError}
          </p>
        ) : null}
        <p className="sr-only" role="status">{pending ? `Saving synthetic action: ${pending}` : ''}</p>

        <PanelSection title="Case Context" icon={<FileSearch aria-hidden className="size-4" />}>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <ContextItem label="Direction" value={humanize(context.direction)} />
            <ContextItem label="Queue" value={humanize(context.queue)} />
            <ContextItem label="Product" value={context.product} />
            <ContextItem label="Stage" value={humanize(context.stage)} />
            <ContextItem label="Contact" value={humanize(context.contactState)} />
            <ContextItem label="Pricing" value={humanize(context.pricingPosture)} />
            <div className="col-span-2 rounded-pulse-sm bg-pulse-surface-1 px-2.5 py-2">
              <dt className="pulse-label">Branch</dt>
              <dd className="pulse-metric mt-1 break-words text-xs text-pulse-primary">{context.caseBranch}</dd>
            </div>
          </dl>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-pulse-muted"><Clock aria-hidden className="size-3.5" /> Scenario time {new Date(context.syntheticNow).toLocaleString()} · {context.syntheticTimezone}</p>
        </PanelSection>

        <PanelSection title="Required Evidence" icon={<ClipboardCheck aria-hidden className="size-4" />}>
          <ul className="space-y-1.5">
            <ChecklistItem done={session.turnCount >= (requirements?.minimumLearnerTurns ?? 0)} label={`Learner turns · ${session.turnCount}/${requirements?.minimumLearnerTurns ?? 0}`} />
            {(requirements?.requiredInspections ?? []).map((id) => (
              <ChecklistItem key={`inspection-${id}`} done={state.inspectionIds.includes(id)} label={`Inspect ${humanize(id)}`} />
            ))}
            {(requirements?.requiredWorkflowActions ?? []).map((id) => (
              <ChecklistItem key={`workflow-${id}`} done={state.workflowActionIds.includes(id)} label={`Workflow ${humanize(id)}`} />
            ))}
            {(requirements?.requiredWrapUpEvidence ?? []).map((id) => (
              <ChecklistItem key={`wrap-${id}`} done={wrapUpEvidenceMet(id, state)} label={`Wrap-up ${humanize(id)}`} />
            ))}
            {(requirements?.requiredCustomerConcerns ?? []).map((concern) => (
              <li key={concern} className="flex items-start gap-2 rounded-pulse-sm bg-pulse-surface-1 px-2.5 py-2 text-xs text-pulse-secondary">
                <MessageSquareText aria-hidden className="mt-0.5 size-3.5 shrink-0 text-pulse-indigo" /> Discuss in transcript: {humanize(concern)}
              </li>
            ))}
          </ul>
        </PanelSection>

        <PanelSection title="Inspections & Dial" icon={<Phone aria-hidden className="size-4" />}>
          <div className="flex flex-wrap gap-2">
            {(requirements?.requiredInspections ?? []).map((id) => (
              <ActionButton
                key={id}
                actionKey={`inspect-${id}`}
                pending={pending}
                disabled={controlsDisabled || !preCall || state.inspectionIds.includes(id)}
                onClick={() => void run(`inspect-${id}`, { type: 'inspect', inspectionId: id })}
              >
                {state.inspectionIds.includes(id) ? <Check aria-hidden className="size-3.5" /> : null}
                {humanize(id)}
              </ActionButton>
            ))}
            <ActionButton actionKey="dial" pending={pending} disabled={controlsDisabled || !preCall} onClick={() => void run('dial', { type: 'dial' })} className="pulse-btn-primary">
              <Phone aria-hidden className="size-3.5" /> Dial synthetic contact
            </ActionButton>
          </div>
          {state.lifecycle === 'ready_to_dial' ? <p className="mt-2 text-xs text-pulse-emerald">Required inspections complete. Dial when ready.</p> : null}
        </PanelSection>

        <PanelSection title="Contact, Identity & Recording" icon={<UserCheck aria-hidden className="size-4" />}>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <label className="text-xs">
              <span className="pulse-label">Contact reached</span>
              <select
                className="pulse-select mt-1 w-full"
                value={state.contactReached ?? ''}
                disabled={controlsDisabled || !inCall}
                onChange={(event) => {
                  const contact = event.target.value as NonNullable<ScenarioState['contactReached']>;
                  void run(`contact-${contact}`, { type: 'set_contact', contact });
                }}
              >
                <option value="" disabled>Select outcome</option>
                {CONTACT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <div className="rounded-pulse-sm bg-pulse-surface-1 px-2.5 py-2 text-xs">
              <span className="pulse-label">Recording</span>
              <p className="pulse-metric mt-1 font-semibold text-pulse-primary">{humanize(state.recording)}</p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <ActionButton actionKey="identity" pending={pending} disabled={controlsDisabled || !inCall || state.identityVerified} onClick={() => void run('identity', { type: 'verify_identity' })}>
              <UserCheck aria-hidden className="size-3.5" /> {state.identityVerified ? 'Identity verified' : 'Verify identity'}
            </ActionButton>
            <ActionButton actionKey="disclosure" pending={pending} disabled={controlsDisabled || !inCall || state.recordingDisclosed} onClick={() => void run('disclosure', { type: 'record_disclosure' })}>
              <ShieldCheck aria-hidden className="size-3.5" /> {state.recordingDisclosed ? 'Disclosure recorded' : state.recordingDisclosureRequired ? 'Record required disclosure' : 'Record disclosure'}
            </ActionButton>
            <ActionButton actionKey="recording" pending={pending} disabled={controlsDisabled || !inCall} onClick={() => void run('recording', { type: 'recording', state: state.recording === 'paused' ? 'active' : 'paused' })}>
              {state.recording === 'paused' ? <Play aria-hidden className="size-3.5" /> : <Pause aria-hidden className="size-3.5" />}
              {state.recording === 'paused' ? 'Resume recording' : 'Pause recording'}
            </ActionButton>
          </div>
        </PanelSection>

        <details className="group rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-2" open={requiredGateIds.some((id) => ['correct_link', 'voicemail_sms', 'payment_data'].includes(id))}>
          <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-pulse-primary">Links, Offers{context.queue === 'renewals' ? ' & Payment' : ''}</summary>
          <div className="border-t border-pulse-border-subtle p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="pulse-label">Fake SMS</p>
              <span className={cn('text-[11px] font-medium', state.smsPermissionGranted ? 'text-pulse-emerald' : 'text-pulse-muted')}>{state.smsPermissionGranted ? 'Permission recorded' : 'Permission required'}</span>
            </div>
            <label htmlFor={smsId} className="mt-2 block text-xs text-pulse-secondary">Symbolic asset ID only — never a URL</label>
            <div className="mt-1 flex gap-2">
              <input id={smsId} className="pulse-input pulse-metric min-w-0 flex-1 text-xs" value={smsAssetId} onChange={(event) => setSmsAssetId(event.target.value)} maxLength={100} disabled={controlsDisabled || !inCall} autoComplete="off" spellCheck={false} />
              <button type="button" className="pulse-btn pulse-btn-ghost px-2 text-xs" disabled={controlsDisabled || !inCall} onClick={() => setSmsAssetId(suggestedSmsAsset)}>Suggest</button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <ActionButton actionKey="sms-permission" pending={pending} disabled={controlsDisabled || !inCall || state.smsPermissionGranted} onClick={() => void run('sms-permission', { type: 'grant_sms_permission' })}>Grant SMS permission</ActionButton>
              <ActionButton actionKey="send-sms" pending={pending} disabled={controlsDisabled || !inCall || !smsAssetId.trim()} onClick={submitSms}><Send aria-hidden className="size-3.5" /> Send fake SMS</ActionButton>
            </div>

            {showPricing ? (
              <div className="mt-4 border-t border-pulse-border-subtle pt-3">
                <p className="pulse-label">Observed Pricing Context</p>
                <label className="mt-2 flex items-center gap-2 text-xs text-pulse-secondary"><input type="checkbox" className="size-4 accent-[var(--pulse-indigo)]" checked={customerAskedPrice} onChange={(event) => setCustomerAskedPrice(event.target.checked)} disabled={controlsDisabled || !inCall} /> Customer asked about price</label>
                <label className="mt-2 flex items-center gap-2 text-xs text-pulse-secondary"><input type="checkbox" className="size-4 accent-[var(--pulse-indigo)]" checked={baseRecoveryCommitted} onChange={(event) => setBaseRecoveryCommitted(event.target.checked)} disabled={controlsDisabled || !inCall} /> Base recovery commitment observed</label>
                <label htmlFor={planId} className="mt-2 block text-xs text-pulse-secondary">Symbolic plan ID (optional)</label>
                <input id={planId} className="pulse-input pulse-metric mt-1 w-full text-xs" value={selectedPlanId} onChange={(event) => setSelectedPlanId(event.target.value)} maxLength={100} disabled={controlsDisabled || !inCall} autoComplete="off" spellCheck={false} />
                <ActionButton actionKey="price-context" pending={pending} disabled={controlsDisabled || !inCall} onClick={submitPriceContext} className="mt-2">Record price context</ActionButton>
              </div>
            ) : null}

            {showOffers ? (
              <div className="mt-4 border-t border-pulse-border-subtle pt-3">
                <label htmlFor={offerId} className="pulse-label">Symbolic Offer Asset</label>
                <input id={offerId} className="pulse-input pulse-metric mt-1 w-full text-xs" value={offerAssetId} onChange={(event) => setOfferAssetId(event.target.value)} maxLength={100} disabled={controlsDisabled || !inCall} autoComplete="off" spellCheck={false} />
                <ActionButton actionKey="offer" pending={pending} disabled={controlsDisabled || !inCall || !offerAssetId.trim()} onClick={submitOffer} className="mt-2">Record synthetic offer</ActionButton>
              </div>
            ) : null}

            {context.queue === 'renewals' ? (
              <div className="mt-4 rounded-pulse-md border border-pulse-border bg-pulse-surface-1 p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-pulse-primary"><CreditCard aria-hidden className="size-4" /> Designated fake payment tokens</p>
                <p className="mt-1 text-[11px] text-pulse-muted">Pause recording first. Card numbers and every other payment value are rejected.</p>
                <p className="pulse-metric mt-2 text-xs">Payment: {humanize(state.paymentState)}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <ActionButton actionKey="payment-success" pending={pending} disabled={controlsDisabled || !inCall} onClick={() => void run('payment-success', { type: 'secure_payment', fakeToken: FAKE_PAYMENT_TOKENS.success })}>{FAKE_PAYMENT_TOKENS.success}</ActionButton>
                  <ActionButton actionKey="payment-failure" pending={pending} disabled={controlsDisabled || !inCall} onClick={() => void run('payment-failure', { type: 'secure_payment', fakeToken: FAKE_PAYMENT_TOKENS.failure })}>{FAKE_PAYMENT_TOKENS.failure}</ActionButton>
                </div>
              </div>
            ) : null}
          </div>
        </details>

        <PanelSection title="Workflow & Completion" icon={<Workflow aria-hidden className="size-4" />}>
          {(requirements?.requiredWorkflowActions.length ?? 0) > 0 ? (
            <div className="flex flex-wrap gap-2">
              {requirements!.requiredWorkflowActions.map((actionId) => (
                <ActionButton key={actionId} actionKey={`workflow-${actionId}`} pending={pending} disabled={controlsDisabled || !inCall || state.workflowActionIds.includes(actionId)} onClick={() => void run(`workflow-${actionId}`, { type: 'workflow', actionId })}>
                  {state.workflowActionIds.includes(actionId) ? <Check aria-hidden className="size-3.5" /> : null}{humanize(actionId)}
                </ActionButton>
              ))}
            </div>
          ) : <p className="text-xs text-pulse-muted">No track-defined workflow action is required for this branch.</p>}

          {showPatientCompletion ? (
            <div className="mt-3 border-t border-pulse-border-subtle pt-3">
              <label className="pulse-label" htmlFor="patient-completion">Observed patient completion</label>
              <div className="mt-1 flex flex-wrap gap-2">
                <select id="patient-completion" className="pulse-select min-w-0 flex-1 text-xs" value={completionId} onChange={(event) => setCompletionId(event.target.value)} disabled={controlsDisabled || !inCall}>
                  <option value="patient_id_submitted">Patient ID submitted</option>
                  <option value="patient_photo_uploaded">Patient photo uploaded</option>
                  <option value="patient_clinical_completed">Patient clinical step completed</option>
                </select>
                <ActionButton actionKey="patient-completion" pending={pending} disabled={controlsDisabled || !inCall} onClick={() => void run('patient-completion', { type: 'patient_completion', completionId, organic: false })}>Record</ActionButton>
              </div>
            </div>
          ) : null}

          {showOrganicCompletion ? (
            <ActionButton actionKey="organic-completion" pending={pending} disabled={controlsDisabled || !(preCall || inCall) || state.organicCompletionIds.includes('organic_before_call')} onClick={() => void run('organic-completion', { type: 'patient_completion', completionId: 'organic_before_call', organic: true })} className="mt-2">
              <CircleCheck aria-hidden className="size-3.5" /> Record organic pre-call completion
            </ActionButton>
          ) : null}
        </PanelSection>

        <details className="group rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-2" open={(requirements?.requiredWrapUpEvidence.length ?? 0) > 0}>
          <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-pulse-primary">Safe Wrap-Up Controls</summary>
          <div className="space-y-3 border-t border-pulse-border-subtle p-3">
            <div>
              <label htmlFor={noteId} className="pulse-label flex items-center gap-1.5"><StickyNote aria-hidden className="size-3.5" /> Synthetic operational note</label>
              <textarea id={noteId} className="pulse-textarea mt-1 min-h-20 w-full text-xs" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} disabled={controlsDisabled || !(preCall || inCall)} placeholder="Example: Synthetic training evidence recorded." />
              <p className="mt-1 text-[11px] text-pulse-muted">No URLs, real identifiers, credentials, card data, or health answers.</p>
              <ActionButton actionKey="note" pending={pending} disabled={controlsDisabled || !(preCall || inCall) || !note.trim()} onClick={submitNote} className="mt-2">Save fake note</ActionButton>
            </div>

            <div className="border-t border-pulse-border-subtle pt-3">
              <label className="pulse-label" htmlFor="synthetic-callback">Synthetic callback</label>
              <div className="mt-1 flex flex-wrap gap-2">
                <select id="synthetic-callback" className="pulse-select min-w-0 flex-1 text-xs" value={callbackAt} onChange={(event) => setCallbackAt(event.target.value)} disabled={controlsDisabled || !(preCall || inCall)}>
                  {CALLBACK_DELAYS.map(({ hours, label }) => {
                    const value = new Date(new Date(context.syntheticNow).getTime() + hours * 60 * 60 * 1000).toISOString();
                    return <option key={hours} value={value}>{label}</option>;
                  })}
                </select>
                <ActionButton actionKey="callback" pending={pending} disabled={controlsDisabled || !(preCall || inCall) || !callbackAt} onClick={() => void run('callback', { type: 'callback', callbackAt })}>Schedule</ActionButton>
              </div>
              {state.callbackAt ? <p className="pulse-metric mt-1 text-[11px] text-pulse-emerald">Recorded: {new Date(state.callbackAt).toLocaleString()}</p> : null}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-pulse-border-subtle pt-3">
              <ActionButton actionKey="opt-out" pending={pending} disabled={controlsDisabled || !inCall || state.optOut} onClick={() => void run('opt-out', { type: 'set_opt_out' })}>Record customer opt-out</ActionButton>
              <ActionButton actionKey="suppress" pending={pending} disabled={controlsDisabled || !(preCall || inCall) || state.suppressionRecorded} onClick={() => void run('suppress', { type: 'suppress' })}>Record suppression</ActionButton>
            </div>

            <div className="border-t border-pulse-border-subtle pt-3">
              <p className="pulse-label">Fake Slack escalation</p>
              <p className="pulse-metric mt-1 break-all text-[11px] text-pulse-muted">Channel fake-support · Order SYN-TRAINING · Vertical {context.queue}</p>
              <label className="sr-only" htmlFor="escalation-correction">Requested synthetic correction</label>
              <select id="escalation-correction" className="pulse-select mt-2 w-full text-xs" value={escalationCorrection} onChange={(event) => setEscalationCorrection(event.target.value)} disabled={controlsDisabled || !(preCall || inCall)}>
                {ESCALATION_CORRECTIONS.map((correction) => <option key={correction} value={correction}>{correction}</option>)}
              </select>
              <ActionButton actionKey="escalate" pending={pending} disabled={controlsDisabled || !(preCall || inCall)} onClick={() => void run('escalate', { type: 'escalate', channel: 'fake-support', orderId: 'SYN-TRAINING', vertical: context.queue, requestedCorrection: escalationCorrection })} className="mt-2">Send fake escalation</ActionButton>
            </div>
          </div>
        </details>

        <PanelSection title={`Local Synthetic Outbox · ${outboxRecords.length}`} icon={<Send aria-hidden className="size-4" />}>
          {outboxRecords.length === 0 ? <p className="text-xs text-pulse-muted">No fake SMS or Slack records yet. Nothing can leave this local training outbox.</p> : (
            <ul className="space-y-2">
              {outboxRecords.map((record) => (
                <li key={record.id} className="rounded-pulse-sm border border-pulse-border-subtle bg-pulse-surface-1 p-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="font-semibold text-pulse-primary">{record.kind === 'fake_sms' ? 'FAKE SMS' : 'FAKE SLACK'} · {record.destination}</span>
                    <span className="pulse-pill pulse-pill-emerald">Synthetic</span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-pulse-secondary">{record.displayText}</p>
                  <p className="pulse-metric mt-1.5 break-all text-[10px] text-pulse-muted">Event {record.eventId}{record.assetId ? ` · Asset ${record.assetId}` : ''}</p>
                </li>
              ))}
            </ul>
          )}
        </PanelSection>

        <details className="rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-2" open={gates.some((gate) => gate.status === 'fail') || blockedEvents > 0}>
          <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-pulse-primary">Gate & Wrap-Up Feedback</summary>
          <div className="space-y-2 border-t border-pulse-border-subtle p-3">
            {session.dispositionValidation && !session.dispositionValidation.valid ? (
              <div role="alert" className="rounded-pulse-sm border border-pulse-crimson/40 bg-pulse-crimson/10 p-2.5 text-xs text-pulse-crimson">
                <p className="font-semibold">Disposition needs correction</p>
                <ul className="mt-1 list-disc space-y-1 pl-4">{session.dispositionValidation.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              </div>
            ) : null}
            {session.assessmentEligibility && !session.assessmentEligibility.eligible ? (
              <div className="rounded-pulse-sm border border-pulse-amber/40 bg-pulse-amber/10 p-2.5 text-xs text-pulse-secondary">
                <p className="font-semibold text-pulse-primary">Assessment evidence still needed</p>
                <ul className="mt-1 list-disc space-y-1 pl-4">{session.assessmentEligibility.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              </div>
            ) : null}
            {gates.length === 0 ? <p className="text-xs text-pulse-muted">No gate results have been emitted yet.</p> : gates.map((gate) => (
              <article key={gate.ruleId} className="rounded-pulse-sm border border-pulse-border-subtle bg-pulse-surface-1 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <p className="pulse-metric text-xs font-semibold text-pulse-primary">{gate.ruleId}</p>
                  <GateStatus status={gate.status} severity={gate.severity} />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-pulse-secondary">{gate.learnerFeedback}</p>
                {gate.evidenceEventIds.length > 0 ? <p className="pulse-metric mt-1 break-all text-[10px] text-pulse-muted">Evidence: {gate.evidenceEventIds.join(', ')}</p> : null}
              </article>
            ))}
          </div>
        </details>

        <details className="rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-2" open={blockedEvents > 0}>
          <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-pulse-primary">Event Playback · {events.length}</summary>
          <div className="border-t border-pulse-border-subtle p-3">
            {selectedEvent ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <button type="button" className="pulse-btn pulse-btn-ghost size-8 min-h-0 p-0" aria-label="Previous simulation event" disabled={selectedEventIndex <= 0} onClick={() => setSelectedEventId(events[selectedEventIndex - 1]?.id ?? null)}><ChevronLeft aria-hidden className="size-4" /></button>
                  <p className="pulse-metric text-xs text-pulse-muted">Event {selectedEvent.sequence} of {events.length}</p>
                  <button type="button" className="pulse-btn pulse-btn-ghost size-8 min-h-0 p-0" aria-label="Next simulation event" disabled={selectedEventIndex >= events.length - 1} onClick={() => setSelectedEventId(events[selectedEventIndex + 1]?.id ?? null)}><ChevronRight aria-hidden className="size-4" /></button>
                </div>
                <article className={cn('mt-2 rounded-pulse-sm border bg-pulse-surface-1 p-2.5', eventIsBlocked(selectedEvent) ? 'border-pulse-crimson/40' : 'border-pulse-border-subtle')} aria-live="polite">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={cn('pulse-pill', eventIsBlocked(selectedEvent) ? 'pulse-pill-crimson' : 'pulse-pill-indigo')}>{humanize(selectedEvent.type)}</span>
                    <span className="text-[11px] text-pulse-muted">{selectedEvent.actor} · {selectedEvent.provenance}</span>
                  </div>
                  <p className="pulse-metric mt-2 break-all text-[10px] text-pulse-muted">ID {selectedEvent.id}</p>
                  <p className="mt-1 text-[11px] text-pulse-muted">{new Date(selectedEvent.occurredAt).toLocaleString()}</p>
                  {eventIsBlocked(selectedEvent) ? <p role="alert" className="mt-2 flex gap-1.5 text-xs font-semibold text-pulse-crimson"><AlertTriangle aria-hidden className="size-4 shrink-0" /> Action blocked{typeof selectedEvent.payload.reason === 'string' ? `: ${humanize(selectedEvent.payload.reason)}` : ''}</p> : null}
                  {Array.isArray(selectedEvent.payload.missingEvidence) ? <p className="mt-1 text-xs text-pulse-crimson">Missing: {selectedEvent.payload.missingEvidence.map(String).join(', ')}</p> : null}
                  <pre className="pulse-metric mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-all rounded-pulse-sm bg-pulse-bg p-2 text-[10px] leading-relaxed text-pulse-secondary">{JSON.stringify(selectedEvent.payload, null, 2)}</pre>
                </article>
                <button type="button" className="pulse-btn pulse-btn-ghost mt-2 w-full px-2 py-1.5 text-xs" disabled={selectedEventIndex === events.length - 1} onClick={() => setSelectedEventId(events.at(-1)?.id ?? null)}>Jump to latest</button>
              </>
            ) : <p className="text-xs text-pulse-muted">Events will appear after the session starts.</p>}
          </div>
        </details>

        <p className="flex gap-1.5 px-1 text-[11px] leading-relaxed text-pulse-muted"><Info aria-hidden className="mt-0.5 size-3.5 shrink-0" /> Next server event sequence: {session.nextEventSequence ?? 'not supplied'}. Blocked actions remain in playback so you can correct the evidence and try again.</p>
      </div>
    </aside>
  );
}

function PanelSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-2 p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-pulse-primary">{icon}{title}</h3>
      {children}
    </section>
  );
}

function ContextItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-pulse-sm bg-pulse-surface-1 px-2.5 py-2">
      <dt className="pulse-label">{label}</dt>
      <dd className="mt-1 break-words font-medium text-pulse-primary">{value}</dd>
    </div>
  );
}

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 rounded-pulse-sm bg-pulse-surface-1 px-2.5 py-2 text-xs text-pulse-secondary">
      {done ? <CircleCheck aria-hidden className="size-4 shrink-0 text-pulse-emerald" /> : <Circle aria-hidden className="size-4 shrink-0 text-pulse-muted" />}
      <span className={done ? 'text-pulse-primary' : ''}>{label}</span>
      <span className="sr-only">{done ? 'Complete' : 'Not complete'}</span>
    </li>
  );
}

function ActionButton({
  actionKey,
  pending,
  disabled,
  onClick,
  className,
  children,
}: {
  actionKey: string;
  pending: string | null;
  disabled: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button type="button" className={cn('pulse-btn px-2.5 py-1.5 text-xs', className)} disabled={disabled} onClick={onClick}>
      {pending === actionKey ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : null}
      {children}
    </button>
  );
}

function GateStatus({ status, severity }: { status: 'pass' | 'fail' | 'not_observed' | 'needs_review'; severity: 'critical' | 'major' | 'coaching' }) {
  return (
    <span className={cn('pulse-pill', status === 'pass' ? 'pulse-pill-emerald' : status === 'fail' ? 'pulse-pill-crimson' : 'pulse-pill-amber')} title={`${severity} gate`}>
      {humanize(status)} · {severity}
    </span>
  );
}
