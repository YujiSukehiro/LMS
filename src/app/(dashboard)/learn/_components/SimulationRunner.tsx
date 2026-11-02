'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ClipboardCheck,
  Eye,
  Headset,
  LoaderCircle,
  MessageSquareText,
  PhoneCall,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import { CallTicketHeader } from '@/components/simulation/CallTicketHeader';
import { DifficultyBadge } from '@/components/simulation/DifficultyBadge';
import { DispositionPicker } from '@/components/simulation/DispositionPicker';
import { ScorecardView } from '@/components/simulation/ScorecardView';
import { TranscriptChat, type TranscriptMessage } from '@/components/simulation/TranscriptChat';
import { DIVISION_PILL_CLASS, SIM_CHANNEL_LABELS } from '@/components/simulation/labels';
import {
  EvaluateSimResponseSchema,
  SimDoneEventSchema,
  SimTokenEventSchema,
  SseErrorEventSchema,
  StartSimResponseSchema,
  type EvaluateSimResponse,
} from '@/lib/schemas/api';
import type { PublicSimScenario } from '@/lib/schemas/curriculum';
import type { DivisionId } from '@/lib/schemas/domain';
import { readSseStream } from '@/lib/sse-client';
import { cn } from '@/lib/utils';
import { describeApiError, describeNetworkError, readApiFailure } from '../_lib/api-errors';

export interface SimulationRunnerProps {
  trackId: string;
  trackTitle: string;
  versionId: string;
  isPreview: boolean;
  /** Public scenario fields only — never the secret rubric config. */
  scenario: PublicSimScenario;
  campaignCode: string;
  divisionId: DivisionId;
  /** CompetencyPillar id -> label for the scorecard. */
  pillarLabels: Record<string, string>;
  mapHref: string;
}

type Phase = 'intro' | 'starting' | 'live' | 'grading' | 'scored';

let localMessageSeq = 0;
function nextLocalId(prefix: string): string {
  localMessageSeq += 1;
  return `${prefix}-local-${localMessageSeq}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Client flow for one Live Call Sim: start -> stream the conversation -> disposition -> AI coach scorecard. */
export function SimulationRunner({
  trackId,
  trackTitle,
  versionId,
  isPreview,
  scenario,
  campaignCode,
  divisionId,
  pillarLabels,
  mapHref,
}: SimulationRunnerProps) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [turnCount, setTurnCount] = useState(0);
  const [simEnded, setSimEnded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [restoreDraft, setRestoreDraft] = useState<{ text: string; restoreKey: number } | null>(null);
  const [selectedDisposition, setSelectedDisposition] = useState<string | null>(null);
  const [result, setResult] = useState<EvaluateSimResponse | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(async () => {
    abortRef.current?.abort();
    setPhase('starting');
    setError(null);
    setEvalError(null);
    setResult(null);
    setSelectedDisposition(null);
    setSimEnded(false);
    setPickerOpen(false);
    setStreamingText(null);
    setRestoreDraft(null);
    try {
      const response = await fetch('/api/simulations/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId, versionId, scenarioId: scenario.id }),
      });
      if (!response.ok) {
        setError(await describeApiError(response, 'simulation'));
        setPhase('intro');
        return;
      }
      const parsed = StartSimResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        setError('The Simulation started, but the server reply was not readable. Try again.');
        setPhase('intro');
        return;
      }
      const { session } = parsed.data;
      setSessionId(session.id);
      setMessages(session.messages.map((m) => ({ id: m.id, role: m.role, content: m.content })));
      setTurnCount(session.turnCount);
      setPhase('live');
    } catch (caught) {
      setError(describeNetworkError(caught));
      setPhase('intro');
    }
  }, [trackId, versionId, scenario.id]);

  const endCall = useCallback(() => {
    setEvalError(null);
    setPickerOpen(true);
  }, []);

  const send = useCallback(
    async (content: string) => {
      if (!sessionId || streamingText !== null || simEnded) return;
      const agentMessage: TranscriptMessage = { id: nextLocalId('agent'), role: 'agent', content };
      setMessages((prev) => [...prev, agentMessage]);
      setStreamingText('');
      setError(null);
      const controller = new AbortController();
      abortRef.current = controller;
      const rollback = () => {
        setMessages((prev) => prev.filter((m) => m.id !== agentMessage.id));
        setRestoreDraft({ text: content, restoreKey: Date.now() });
        setStreamingText(null);
      };

      try {
        const response = await fetch(`/api/simulations/${encodeURIComponent(sessionId)}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const failure = await readApiFailure(response, 'simulation');
          rollback();
          if (failure.code === 'SIM_NOT_ACTIVE' || failure.code === 'SIM_TURN_LIMIT') {
            setSimEnded(true);
            setEvalError(null);
            setPickerOpen(true);
          }
          setError(failure.message);
          return;
        }

        let text = '';
        let done: { simEnded: boolean; turnCount: number } | null = null;
        let streamError: string | null = null;
        for await (const frame of readSseStream(response, controller.signal)) {
          if (frame.event === 'token') {
            const token = SimTokenEventSchema.safeParse(frame.data);
            if (token.success) {
              text += token.data.token;
              setStreamingText(text);
            }
          } else if (frame.event === 'done') {
            const parsed = SimDoneEventSchema.safeParse(frame.data);
            if (parsed.success) done = parsed.data;
          } else if (frame.event === 'error') {
            const parsed = SseErrorEventSchema.safeParse(frame.data);
            streamError = parsed.success ? parsed.data.message : 'The caller could not reply.';
          }
        }
        if (controller.signal.aborted) return;

        if (streamError || !done) {
          // The server saves the agent message only together with a complete reply, so undo it here.
          rollback();
          setError(streamError ?? 'The reply stopped before it finished. Send your message again.');
          return;
        }
        setStreamingText(null);
        const reply = text.trim();
        if (reply) {
          setMessages((prev) => [...prev, { id: nextLocalId('counterparty'), role: 'counterparty', content: reply }]);
        }
        setTurnCount(done.turnCount);
        if (done.simEnded || done.turnCount >= scenario.maxTurns) {
          setSimEnded(true);
          setEvalError(null);
          setPickerOpen(true);
        }
      } catch (caught) {
        if (isAbortError(caught)) return;
        rollback();
        setError(describeNetworkError(caught));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [sessionId, streamingText, simEnded, scenario.maxTurns],
  );

  const evaluate = useCallback(
    async (disposition: string) => {
      if (!sessionId) return;
      setSelectedDisposition(disposition);
      setPickerOpen(false);
      setEvalError(null);
      setPhase('grading');
      try {
        const response = await fetch(`/api/simulations/${encodeURIComponent(sessionId)}/evaluate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selectedDisposition: disposition }),
        });
        if (!response.ok) {
          setEvalError(await describeApiError(response, 'evaluation'));
          setPhase('live');
          setPickerOpen(true);
          return;
        }
        const parsed = EvaluateSimResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          setEvalError('Your call was graded, but the scorecard was not readable. Try again.');
          setPhase('live');
          setPickerOpen(true);
          return;
        }
        setResult(parsed.data);
        setSimEnded(true);
        setPhase('scored');
      } catch (caught) {
        setEvalError(describeNetworkError(caught));
        setPhase('live');
        setPickerOpen(true);
      }
    },
    [sessionId],
  );

  const closePicker = useCallback(() => setPickerOpen(false), []);

  const isStreaming = streamingText !== null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={mapHref} className="inline-flex items-center gap-1.5 text-sm text-pulse-muted hover:text-pulse-primary">
          <ArrowLeft aria-hidden className="size-4" />
          {trackTitle}
        </Link>
        {isPreview ? (
          <span className="pulse-pill pulse-pill-amber">
            <Eye aria-hidden className="size-3.5" /> Draft test-play — not recorded on any enrollment
          </span>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="flex items-start gap-2 rounded-pulse-md border border-pulse-crimson/40 bg-pulse-crimson/10 px-4 py-3 text-sm text-pulse-crimson">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {phase === 'intro' || phase === 'starting' ? (
        <IntroCard
          scenario={scenario}
          campaignCode={campaignCode}
          divisionId={divisionId}
          starting={phase === 'starting'}
          onStart={() => void start()}
        />
      ) : null}

      {phase === 'live' || phase === 'grading' ? (
        <>
          <CallTicketHeader
            scenario={scenario}
            campaignCode={campaignCode}
            divisionId={divisionId}
            turnCount={turnCount}
            onEndCall={endCall}
            disabled={isStreaming || phase === 'grading' || turnCount === 0}
          />
          {phase === 'grading' ? (
            <div role="status" className="pulse-card-elevated flex items-center gap-4 p-5">
              <LoaderCircle aria-hidden className="size-7 shrink-0 animate-spin text-pulse-indigo" />
              <div>
                <p className="font-semibold">Grading your call…</p>
                <p className="text-sm text-pulse-muted">
                  The AI coach is checking every turn against the Playbook rubric. This can take up to a minute.
                </p>
              </div>
            </div>
          ) : null}
          <TranscriptChat
            messages={messages}
            streamingText={streamingText}
            counterpartyLabel={scenario.counterpartyRoleLabel}
            onSend={(content) => void send(content)}
            composerDisabled={isStreaming || simEnded || phase !== 'live'}
            composerNote={
              simEnded
                ? 'The call has ended. Log your disposition to get your scorecard.'
                : isStreaming
                  ? `${scenario.counterpartyRoleLabel} is replying…`
                  : undefined
            }
            restoreDraft={restoreDraft}
            className={cn('h-[min(62vh,40rem)]', phase === 'grading' && 'opacity-60')}
          />
          {simEnded && phase === 'live' && !pickerOpen ? (
            <div className="flex justify-end">
              <button type="button" className="pulse-btn pulse-btn-primary" onClick={endCall}>
                <ClipboardCheck aria-hidden className="size-4" />
                Log Disposition
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {phase === 'scored' && result ? (
        <ScorecardView
          evaluation={result.evaluation}
          certified={result.certified}
          passThreshold={scenario.passScoreThreshold}
          selectedDisposition={selectedDisposition}
          pillarLabels={pillarLabels}
          onRetry={() => void start()}
          backHref={mapHref}
        />
      ) : null}

      <DispositionPicker
        open={pickerOpen}
        options={scenario.dispositionOptions}
        onSubmit={(disposition) => void evaluate(disposition)}
        onClose={closePicker}
        error={evalError}
        dismissible={!simEnded}
      />
    </div>
  );
}

function IntroCard({
  scenario,
  campaignCode,
  divisionId,
  starting,
  onStart,
}: {
  scenario: PublicSimScenario;
  campaignCode: string;
  divisionId: DivisionId;
  starting: boolean;
  onStart: () => void;
}) {
  return (
    <section aria-labelledby="sim-intro-heading" className="pulse-card-elevated pulse-cq overflow-hidden">
      <div className="flex flex-col gap-5 p-6">
        <div className="flex flex-wrap items-center gap-2">
          {campaignCode ? (
            <span className="pulse-metric rounded-pulse-sm border border-pulse-border bg-pulse-bg px-1.5 py-0.5 text-xs font-semibold">
              {campaignCode}
            </span>
          ) : null}
          <span className={cn('pulse-pill', DIVISION_PILL_CLASS[divisionId])}>{SIM_CHANNEL_LABELS[divisionId]}</span>
          <DifficultyBadge difficulty={scenario.difficulty} />
        </div>
        <div className="flex items-start gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-pulse-indigo text-white">
            <Headset aria-hidden className="size-7" />
          </span>
          <div className="min-w-0">
            <p className="pulse-label">Live Call Sim</p>
            <h1 id="sim-intro-heading" className="mt-0.5 text-2xl font-bold tracking-tight">
              {scenario.title}
            </h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-pulse-muted">
              <UserRound aria-hidden className="size-4" /> {scenario.counterpartyRoleLabel}
            </p>
          </div>
        </div>

        <div className="rounded-pulse-md border border-pulse-border bg-pulse-bg p-4">
          <p className="pulse-label mb-1">Context Ticket</p>
          <p className="text-sm leading-relaxed text-pulse-secondary">{scenario.contextTicketSummary}</p>
        </div>

        <dl className="grid grid-cols-2 gap-3 @lg:grid-cols-3">
          <div className="rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-1 p-3">
            <dt className="pulse-label">Max Turns</dt>
            <dd className="pulse-metric mt-1 text-lg font-bold">{scenario.maxTurns}</dd>
          </div>
          <div className="rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-1 p-3">
            <dt className="pulse-label">Pass Score</dt>
            <dd className="pulse-metric mt-1 text-lg font-bold">{scenario.passScoreThreshold}%</dd>
          </div>
          <div className="col-span-2 rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-1 p-3 @lg:col-span-1">
            <dt className="pulse-label">Dispositions</dt>
            <dd className="pulse-metric mt-1 text-lg font-bold">{scenario.dispositionOptions.length}</dd>
          </div>
        </dl>

        <ul className="space-y-1.5 text-sm text-pulse-secondary">
          <li className="flex gap-2">
            <MessageSquareText aria-hidden className="mt-0.5 size-4 shrink-0 text-pulse-indigo" />
            Reply in your own words, the way you would on a real call. No answer options.
          </li>
          <li className="flex gap-2">
            <ClipboardCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-pulse-indigo" />
            When the call ends, log the Primary Disposition. The AI coach then grades you against the Playbook.
          </li>
        </ul>

        <button
          type="button"
          className="pulse-btn pulse-btn-primary self-start px-6 py-3 text-base"
          onClick={onStart}
          disabled={starting}
        >
          {starting ? (
            <>
              <LoaderCircle aria-hidden className="size-4 animate-spin" /> Connecting the call…
            </>
          ) : (
            <>
              <PhoneCall aria-hidden className="size-4" /> Start Live Call Sim
            </>
          )}
        </button>
      </div>
    </section>
  );
}
