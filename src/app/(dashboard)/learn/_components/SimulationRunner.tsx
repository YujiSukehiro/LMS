'use client';

import { AccountOnFile } from '@/components/simulation/AccountOnFile';
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
  RotateCcw,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import { CallTicketHeader } from '@/components/simulation/CallTicketHeader';
import { DifficultyBadge } from '@/components/simulation/DifficultyBadge';
import { DispositionPicker } from '@/components/simulation/DispositionPicker';
import { ScorecardView } from '@/components/simulation/ScorecardView';
import { TranscriptChat, type TranscriptMessage } from '@/components/simulation/TranscriptChat';
import { DIVISION_PILL_CLASS, VERBAL_CHANNEL_LABELS, verbalStartLabel } from '@/components/simulation/labels';
import { createIdempotencyKey } from '@/components/learn/drill-shared';
import { TRAINING_POLICY } from '@/lib/policy/training-policy';
import { SimJudgeReviewSchema, type SimJudgeReview, type SimSessionDoc } from '@/lib/schemas/analytics';
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
import { CanonicalDispositionSchema } from '@/lib/schemas/source-truth';
import { readSseStream } from '@/lib/sse-client';
import { cn } from '@/lib/utils';
import { describeApiError, describeNetworkError, readApiFailure } from '../_lib/api-errors';
import { dailyLimitMessage } from '../_lib/daily-limit';
import { z } from 'zod';

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
  /** Agent turns already taken in a saved run of this scenario; Start resumes it. null = no saved run. */
  resumeTurnCount?: number | null;
}

type Phase = 'intro' | 'starting' | 'live' | 'grading' | 'scored' | 'awaiting_trainer';

/** 202 from evaluate: the AI coach could not score the call; a Trainer will (manual judge). */
const EvaluatePendingResponseSchema = z.object({
  pending: z.literal(true),
  judgeReview: SimJudgeReviewSchema,
  message: z.string(),
});

/** `done` also carries the cleaned, persisted caller reply (the streamed tokens are only a preview). */
const SimDoneWithReplySchema = SimDoneEventSchema.extend({ reply: z.string().optional() });
const SimStreamErrorSchema = SseErrorEventSchema.extend({ code: z.string().optional() });

const AI_UNAVAILABLE_CODE = 'AI_UNAVAILABLE';
const NOT_IN_CALL_CODES = new Set(['SIM_NOT_IN_CALL', 'SIM_NOT_ACTIVE', 'SIM_TURN_LIMIT']);

let localMessageSeq = 0;
function nextLocalId(prefix: string): string {
  localMessageSeq += 1;
  return `${prefix}-local-${localMessageSeq}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Client flow for Verbal Practice: start -> spoken/typed dialogue -> AI coach scorecard. */
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
  resumeTurnCount = null,
}: SimulationRunnerProps) {
  const requireDisposition = TRAINING_POLICY.requireDispositionInVerbalPractice;
  const [phase, setPhase] = useState<Phase>('intro');
  const [resumeHint, setResumeHint] = useState<number | null>(resumeTurnCount);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<SimSessionDoc | null>(null);
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
  const [demoReplay, setDemoReplay] = useState(false);
  const [pendingReview, setPendingReview] = useState<{ judgeReview: SimJudgeReview; message: string } | null>(null);
  const [retryAction, setRetryAction] = useState<{ label: string; run: () => void } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sendInFlightRef = useRef(false);
  const startInFlightRef = useRef(false);
  const evaluateInFlightRef = useRef(false);
  const sessionRef = useRef<SimSessionDoc | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    const onPageHide = (event: PageTransitionEvent) => {
      if (event.persisted) return;
      const current = sessionRef.current;
      if (!current || current.status !== 'ACTIVE' || current.turnCount > 0) return;
      try {
        void fetch(`/api/simulations/${encodeURIComponent(current.id)}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: { type: 'abort', reason: 'Learner left the page before the practice started.' } }),
          keepalive: true,
        }).catch(() => undefined);
      } catch {
        // Best effort only.
      }
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  const applySession = useCallback((next: SimSessionDoc) => {
    setSession(next);
    setSessionId(next.id);
    setMessages(next.messages.map((message) => ({ id: message.id, role: message.role, content: message.content })));
    setTurnCount(next.turnCount);
    setSelectedDisposition(next.selectedDisposition);
    setDemoReplay(next.provenance?.source === 'replay');
  }, []);

  const start = useCallback(async () => {
    if (startInFlightRef.current) return;
    startInFlightRef.current = true;
    abortRef.current?.abort();
    setPhase('starting');
    setError(null);
    setRetryAction(null);
    setPendingReview(null);
    setEvalError(null);
    setResult(null);
    setSession(null);
    setSessionId(null);
    setDemoReplay(false);
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
        const failure = await readApiFailure(response, 'simulation');
        setError(failure.code === 'SIM_DAILY_LIMIT' ? dailyLimitMessage(failure.message) : failure.message);
        if (failure.code === AI_UNAVAILABLE_CODE) setRetryAction({ label: 'Try again', run: () => void startRef.current() });
        setPhase('intro');
        return;
      }
      const parsed = StartSimResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        setError('The Verbal Practice started, but the server reply was not readable. Try again.');
        setPhase('intro');
        return;
      }
      const started = parsed.data.session;
      applySession(started);
      setResumeHint(null);
      if (started.status === 'READY_FOR_EVAL') {
        setSimEnded(true);
        if (requireDisposition) setPickerOpen(true);
      } else if (started.turnCount >= scenario.maxTurns) {
        setSimEnded(true);
      }
      setPhase('live');
    } catch (caught) {
      setError(describeNetworkError(caught));
      setPhase('intro');
    } finally {
      startInFlightRef.current = false;
    }
  }, [applySession, trackId, versionId, scenario.id, scenario.maxTurns, requireDisposition]);
  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  }, [start]);

  const runEvaluation = useCallback(
    async (disposition?: string) => {
      if (!sessionId) return;
      if (requireDisposition) {
        const canonicalDisposition = CanonicalDispositionSchema.safeParse(disposition);
        if (!canonicalDisposition.success) {
          setEvalError('Choose one of the Playbook dispositions.');
          return;
        }
        setSelectedDisposition(canonicalDisposition.data);
      }
      setEvalError(null);
      setError(null);
      setPickerOpen(false);
      setPhase('grading');
      try {
        const response = await fetch(`/api/simulations/${encodeURIComponent(sessionId)}/evaluate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(disposition ? { selectedDisposition: disposition } : {}),
        });
        if (!response.ok) {
          const message = await describeApiError(response, 'evaluation');
          setEvalError(message);
          setError(message);
          setPhase('live');
          if (requireDisposition) setPickerOpen(true);
          return;
        }
        const body: unknown = await response.json();
        if (response.status === 202) {
          const pending = EvaluatePendingResponseSchema.safeParse(body);
          setPendingReview({
            judgeReview: pending.success
              ? pending.data.judgeReview
              : { status: 'awaiting_manual_judge', reason: 'ai_unavailable', requestedAt: Date.now() },
            message: pending.success ? pending.data.message : 'Your practice was saved. A Trainer will score it.',
          });
          setSimEnded(true);
          setPhase('awaiting_trainer');
          return;
        }
        const parsed = EvaluateSimResponseSchema.safeParse(body);
        if (!parsed.success) {
          const message = 'Your practice was graded, but the scorecard was not readable. Try again.';
          setEvalError(message);
          setError(message);
          setPhase('live');
          if (requireDisposition) setPickerOpen(true);
          return;
        }
        setResult(parsed.data);
        setDemoReplay(parsed.data.demoReplay === true || parsed.data.evaluation.provenance?.source === 'replay');
        setSimEnded(true);
        setPhase('scored');
      } catch (caught) {
        const message = describeNetworkError(caught);
        setEvalError(message);
        setError(message);
        setPhase('live');
        if (requireDisposition) setPickerOpen(true);
      }
    },
    [requireDisposition, sessionId],
  );

  const evaluate = useCallback(
    async (disposition?: string) => {
      if (evaluateInFlightRef.current || !sessionId) return;
      evaluateInFlightRef.current = true;
      try {
        await runEvaluation(disposition);
      } finally {
        evaluateInFlightRef.current = false;
      }
    },
    [runEvaluation, sessionId],
  );

  const endCall = useCallback(() => {
    setEvalError(null);
    if (requireDisposition) {
      setPickerOpen(true);
    } else {
      void evaluate();
    }
  }, [evaluate, requireDisposition]);

  const unconfirmedSendRef = useRef<{ content: string; key: string } | null>(null);

  const send = useCallback(
    async (content: string) => {
      if (sendInFlightRef.current) return;
      if (!sessionId || streamingText !== null || simEnded || phase !== 'live') return;
      sendInFlightRef.current = true;
      setRetryAction(null);
      const idempotencyKey = unconfirmedSendRef.current?.content === content ? unconfirmedSendRef.current.key : createIdempotencyKey();
      unconfirmedSendRef.current = { content, key: idempotencyKey };
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
          body: JSON.stringify({ content, idempotencyKey }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const failure = await readApiFailure(response, 'simulation');
          rollback();
          if (failure.code && NOT_IN_CALL_CODES.has(failure.code) && failure.code === 'SIM_TURN_LIMIT') {
            setSimEnded(true);
            setEvalError(null);
            if (requireDisposition) setPickerOpen(true);
          }
          if (failure.code === AI_UNAVAILABLE_CODE) {
            setRetryAction({ label: 'Send again', run: () => void sendRef.current(content) });
          }
          setError(failure.message);
          return;
        }

        let text = '';
        let done: { simEnded: boolean; turnCount: number; reply?: string } | null = null;
        let streamError: string | null = null;
        let streamErrorCode: string | null = null;
        for await (const frame of readSseStream(response, controller.signal)) {
          if (frame.event === 'token') {
            const token = SimTokenEventSchema.safeParse(frame.data);
            if (token.success) {
              text += token.data.token;
              setStreamingText(text);
            }
          } else if (frame.event === 'done') {
            const parsed = SimDoneWithReplySchema.safeParse(frame.data);
            if (parsed.success) done = parsed.data;
          } else if (frame.event === 'error') {
            const parsed = SimStreamErrorSchema.safeParse(frame.data);
            streamError = parsed.success ? parsed.data.message : 'The caller could not reply.';
            streamErrorCode = parsed.success ? (parsed.data.code ?? null) : null;
          }
        }
        if (controller.signal.aborted) return;

        if (streamError || !done) {
          rollback();
          setError(streamError ?? 'The reply stopped before it finished. Send your message again.');
          if (streamErrorCode === AI_UNAVAILABLE_CODE) {
            setRetryAction({ label: 'Send again', run: () => void sendRef.current(content) });
          }
          return;
        }
        unconfirmedSendRef.current = null;
        setStreamingText(null);
        const reply = (done.reply ?? text).trim();
        if (reply) {
          setMessages((prev) => [...prev, { id: nextLocalId('counterparty'), role: 'counterparty', content: reply }]);
        }
        setTurnCount(done.turnCount);
        if (done.simEnded || done.turnCount >= scenario.maxTurns) {
          setSimEnded(true);
          setEvalError(null);
          if (requireDisposition) setPickerOpen(true);
        }
      } catch (caught) {
        if (isAbortError(caught)) return;
        rollback();
        setError(describeNetworkError(caught));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        sendInFlightRef.current = false;
      }
    },
    [sessionId, streamingText, simEnded, phase, scenario.maxTurns, requireDisposition],
  );
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const closePicker = useCallback(() => setPickerOpen(false), []);
  const isStreaming = streamingText !== null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={mapHref} className="inline-flex items-center gap-1.5 text-xs text-pulse-muted hover:text-pulse-primary">
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
          <span className="min-w-0 flex-1">{error}</span>
          {retryAction ? (
            <button
              type="button"
              className="pulse-btn shrink-0 px-2.5 py-1 text-xs"
              onClick={() => {
                const action = retryAction;
                setRetryAction(null);
                setError(null);
                action.run();
              }}
            >
              <RotateCcw aria-hidden className="size-3.5" /> {retryAction.label}
            </button>
          ) : null}
        </p>
      ) : null}

      {phase === 'intro' || phase === 'starting' ? (
        <IntroCard
          scenario={scenario}
          campaignCode={campaignCode}
          divisionId={divisionId}
          starting={phase === 'starting'}
          onStart={() => void start()}
          resumeTurnCount={resumeHint}
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
            disabled={isStreaming || phase === 'grading'}
          />
          {phase === 'grading' ? (
            <div role="status" className="pulse-card-elevated flex items-center gap-4 p-5">
              <LoaderCircle aria-hidden className="size-7 shrink-0 animate-spin text-pulse-indigo" />
              <div>
                <p className="font-semibold">Grading your verbal responses…</p>
                <p className="text-sm text-pulse-muted">
                  {demoReplay
                    ? 'Demo replay is loading the fixture scorecard for inspection. No assessment credit will be recorded.'
                    : 'The AI coach is checking every turn against the Playbook rubric. This can take up to a minute.'}
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
                ? 'The conversation has wrapped up. Select Finish & Grade Practice to view your coaching scorecard.'
                : isStreaming
                  ? `${scenario.counterpartyRoleLabel} is replying…`
                  : undefined
            }
            restoreDraft={restoreDraft}
            demoReplay={demoReplay}
            className={cn('h-[max(22rem,calc(100dvh-21rem))]', phase === 'grading' && 'opacity-60')}
          />
          {simEnded && phase === 'live' && !pickerOpen ? (
            <div className="flex justify-end">
              <button type="button" className="pulse-btn pulse-btn-primary" onClick={endCall}>
                <ClipboardCheck aria-hidden className="size-4" />
                {requireDisposition ? 'Log Disposition' : 'Finish & Grade Practice'}
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {phase === 'awaiting_trainer' && pendingReview ? (
        <section aria-label="Scorecard pending" role="status" className="pulse-card flex flex-col gap-3 p-4">
          <div className="flex items-start gap-3">
            <ClipboardCheck aria-hidden className="mt-0.5 size-6 shrink-0 text-pulse-indigo" />
            <div>
              <p className="text-base font-semibold">Practice saved — scorecard pending</p>
              <p className="mt-1 text-sm text-pulse-secondary">{pendingReview.message}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Link href={mapHref} className="pulse-btn">
              <ArrowLeft aria-hidden className="size-4" /> Back to Track Map
            </Link>
            <button
              type="button"
              className="pulse-btn"
              onClick={() => {
                setPendingReview(null);
                setPhase('live');
                void evaluate(selectedDisposition ?? undefined);
              }}
            >
              <RotateCcw aria-hidden className="size-4" /> Try AI scoring again
            </button>
            <button type="button" className="pulse-btn pulse-btn-primary" onClick={() => void start()}>
              <PhoneCall aria-hidden className="size-4" /> Start a new practice
            </button>
          </div>
        </section>
      ) : null}

      {phase === 'scored' && result ? (
        <ScorecardView
          evaluation={result.evaluation}
          certified={result.certified}
          passThreshold={scenario.passScoreThreshold}
          selectedDisposition={selectedDisposition}
          demoReplay={demoReplay}
          pillarLabels={pillarLabels}
          onRetry={() => void start()}
          backHref={mapHref}
        />
      ) : null}

      {requireDisposition ? (
        <DispositionPicker
          open={pickerOpen}
          options={scenario.dispositionOptions}
          onSubmit={(disposition) => void evaluate(disposition)}
          onClose={closePicker}
          submitting={phase === 'grading'}
          error={evalError}
          dismissible={phase !== 'grading'}
        />
      ) : null}
    </div>
  );
}

function IntroCard({
  scenario,
  campaignCode,
  divisionId,
  starting,
  onStart,
  resumeTurnCount,
}: {
  scenario: PublicSimScenario;
  campaignCode: string;
  divisionId: DivisionId;
  starting: boolean;
  onStart: () => void;
  resumeTurnCount: number | null;
}) {
  return (
    <section aria-labelledby="sim-intro-heading" className="pulse-card pulse-cq overflow-hidden">
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-pulse-indigo text-pulse-on-accent">
            <Headset aria-hidden className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {campaignCode ? <span className="pulse-metric text-xs font-semibold text-pulse-secondary">{campaignCode}</span> : null}
              <span className={cn('pulse-pill', DIVISION_PILL_CLASS[divisionId])}>{VERBAL_CHANNEL_LABELS[divisionId]}</span>
              <DifficultyBadge difficulty={scenario.difficulty} />
            </div>
            <h1 id="sim-intro-heading" className="mt-1 text-xl font-bold tracking-tight">
              {scenario.title}
            </h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-pulse-muted">
              <span className="inline-flex items-center gap-1.5">
                <UserRound aria-hidden className="size-3.5" /> {scenario.counterpartyRoleLabel}
              </span>
              <span>
                Up to <span className="pulse-metric text-pulse-secondary">{scenario.maxTurns}</span> turns
              </span>
              <span>
                Pass at <span className="pulse-metric text-pulse-secondary">{scenario.passScoreThreshold}%</span>
              </span>
            </p>
          </div>
        </div>

        <div className="rounded-pulse-md border border-pulse-border-subtle bg-pulse-bg px-3.5 py-3">
          <p className="pulse-label mb-1">Scenario brief</p>
          <p className="text-sm leading-relaxed text-pulse-secondary">{scenario.contextTicketSummary}</p>
          <AccountOnFile lines={scenario.accountOnFile} className="mt-2" />
        </div>

        <p className="flex items-start gap-2 text-sm text-pulse-secondary">
          <MessageSquareText aria-hidden className="mt-0.5 size-4 shrink-0 text-pulse-indigo" />
          <span>
            Answer in your own words, typed or dictated with the mic. You are scored on what you say and the Playbook rules you
            follow.
          </span>
        </p>

        <button
          type="button"
          className="pulse-btn pulse-btn-primary self-start px-5 py-2.5"
          onClick={onStart}
          disabled={starting}
        >
          {starting ? (
            <>
              <LoaderCircle aria-hidden className="size-4 animate-spin" /> Starting conversation…
            </>
          ) : (
            <>
              <PhoneCall aria-hidden className="size-4" /> {verbalStartLabel(resumeTurnCount)}
            </>
          )}
        </button>
      </div>
    </section>
  );
}
