'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Headset, Mic, MicOff, SendHorizontal, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { voiceErrorMessage } from './voice-errors';

export interface TranscriptMessage {
  id: string;
  role: 'counterparty' | 'agent';
  content: string;
}

export interface TranscriptChatProps {
  messages: TranscriptMessage[];
  /** Text of the counterparty reply that is streaming now, or null. */
  streamingText: string | null;
  counterpartyLabel: string;
  onSend: (content: string) => void;
  /** Disables the composer (for example while a reply streams or after practice ends). */
  composerDisabled: boolean;
  /** Short note under the composer when it is disabled. */
  composerNote?: string;
  /** Text to put back into the composer (for example after a failed send). Change `restoreKey` to apply it again. */
  restoreDraft?: { text: string; restoreKey: number } | null;
  /** Shows a persistent inspection-only label for deterministic demo sessions. */
  demoReplay?: boolean;
  maxLength?: number;
  className?: string;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

/** Detach handlers before stopping so a late result can never write into an unmounted or disabled composer. */
function disposeRecognition(recognition: SpeechRecognitionLike | null) {
  if (!recognition) return;
  recognition.onresult = null;
  recognition.onerror = null;
  recognition.onend = null;
  try {
    if (recognition.abort) recognition.abort();
    else recognition.stop();
  } catch {
    // Already stopped.
  }
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

/** Verbal Practice transcript: counterparty bubbles on the left, agent on the right, composer at the bottom. */
export function TranscriptChat({
  messages,
  streamingText,
  counterpartyLabel,
  onSend,
  composerDisabled,
  composerNote,
  restoreDraft,
  demoReplay = false,
  maxLength = 2000,
  className,
}: TranscriptChatProps) {
  const [draft, setDraft] = useState('');
  const [speechSupported, setSpeechSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const appliedRestoreKey = useRef<number | null>(null);
  const hintId = useId();
  const composerId = useId();

  useEffect(() => {
    setSpeechSupported(getSpeechRecognitionCtor() !== null);
    return () => {
      disposeRecognition(recognitionRef.current);
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, streamingText]);

  useEffect(() => {
    if (!restoreDraft || appliedRestoreKey.current === restoreDraft.restoreKey) return;
    appliedRestoreKey.current = restoreDraft.restoreKey;
    setDraft(restoreDraft.text);
  }, [restoreDraft]);

  useEffect(() => {
    if (!composerDisabled) textareaRef.current?.focus({ preventScroll: true });
    if (composerDisabled && listening) {
      disposeRecognition(recognitionRef.current);
      recognitionRef.current = null;
      setListening(false);
    }
  }, [composerDisabled, listening]);

  const sendLockRef = useRef(false);
  useEffect(() => {
    sendLockRef.current = false;
  });

  const send = () => {
    if (sendLockRef.current) return;
    const content = draft.trim();
    if (!content || composerDisabled) return;
    if (listening) {
      // Drop any late dictation result so it cannot reappear in the cleared composer after sending.
      disposeRecognition(recognitionRef.current);
      recognitionRef.current = null;
      setListening(false);
    }
    sendLockRef.current = true;
    onSend(content.slice(0, maxLength));
    setDraft('');
  };

  const toggleVoice = () => {
    if (composerDisabled) return;
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    disposeRecognition(recognitionRef.current);
    setVoiceError(null);
    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (event) => {
      const chunks: string[] = [];
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const res = event.results[i];
        if (res?.[0]?.transcript) chunks.push(res[0].transcript.trim());
      }
      const spoken = chunks.join(' ').trim();
      if (spoken) {
        setDraft((prev) => `${prev ? `${prev.trimEnd()} ` : ''}${spoken}`.slice(0, maxLength));
      }
    };
    recognition.onerror = (event) => {
      setVoiceError(voiceErrorMessage(event?.error));
      setListening(false);
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      setListening(false);
    };
    recognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setVoiceError(voiceErrorMessage('unknown'));
      setListening(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  const isStreaming = streamingText !== null;

  return (
    <div className={cn('pulse-card flex min-h-0 flex-col', className)}>
      {demoReplay ? (
        <p role="status" className="border-b border-pulse-amber/30 bg-pulse-amber/10 px-4 py-2 text-sm text-pulse-secondary">
          <span className="font-semibold text-pulse-amber">Demo replay</span> — inspection only; no progress, readiness, or
          certification credit.
        </p>
      ) : null}
      <div
        ref={scrollRef}
        role="log"
        aria-label="Conversation transcript"
        aria-live="polite"
        aria-relevant="additions"
        className="flex min-h-[18rem] flex-1 flex-col gap-3 overflow-y-auto p-4"
      >
        {messages.map((message) => (
          <Bubble key={message.id} role={message.role} counterpartyLabel={counterpartyLabel}>
            {message.content}
          </Bubble>
        ))}
        {isStreaming ? (
          <div aria-hidden>
            <Bubble role="counterparty" counterpartyLabel={counterpartyLabel} streaming>
              {streamingText}
            </Bubble>
          </div>
        ) : null}
      </div>
      <p className="sr-only" role="status">
        {isStreaming ? `${counterpartyLabel} is replying.` : listening ? 'Listening for voice dictation.' : ''}
      </p>

      <form onSubmit={onSubmit} className="border-t border-pulse-border-subtle p-3">
        <label htmlFor={composerId} className="sr-only">
          Your verbal response as the agent
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id={composerId}
            name="reply"
            ref={textareaRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (voiceError) setVoiceError(null);
            }}
            onKeyDown={onKeyDown}
            disabled={composerDisabled}
            maxLength={maxLength}
            rows={2}
            aria-describedby={hintId}
            placeholder={composerDisabled ? '' : 'Speak or type your response as the agent…'}
            className="pulse-textarea min-h-[3.25rem] max-h-40 flex-1 resize-y"
          />
          {speechSupported ? (
            <button
              type="button"
              onClick={toggleVoice}
              disabled={composerDisabled}
              aria-pressed={listening}
              aria-label={listening ? 'Stop voice dictation' : 'Start voice dictation'}
              title={listening ? 'Stop dictation' : 'Dictate your reply'}
              className={cn(
                'pulse-btn h-[3.25rem] min-w-[3.25rem] px-3',
                listening && 'border-pulse-crimson text-pulse-crimson',
              )}
            >
              {listening ? <MicOff aria-hidden className="size-4" /> : <Mic aria-hidden className="size-4" />}
            </button>
          ) : null}
          <button
            type="submit"
            className="pulse-btn pulse-btn-primary h-[3.25rem] min-w-[3.25rem] px-4"
            disabled={composerDisabled || draft.trim().length === 0}
            aria-label="Send reply"
          >
            <SendHorizontal aria-hidden className="size-4" />
          </button>
        </div>
        {voiceError ? (
          <p role="alert" className="mt-1.5 text-xs text-pulse-amber">
            {voiceError}
          </p>
        ) : null}
        <p id={hintId} className="mt-1.5 flex justify-between gap-2 text-xs text-pulse-muted">
          <span>
            {composerNote ?? (
              <>
                <kbd className="pulse-kbd">Enter</kbd> send · <kbd className="pulse-kbd">Shift</kbd>+
                <kbd className="pulse-kbd">Enter</kbd> new line
              </>
            )}
          </span>
          <span className="pulse-metric">
            {draft.length}/{maxLength}
          </span>
        </p>
      </form>
    </div>
  );
}

function Bubble({
  role,
  counterpartyLabel,
  streaming = false,
  children,
}: {
  role: 'counterparty' | 'agent';
  counterpartyLabel: string;
  streaming?: boolean;
  children: ReactNode;
}) {
  const isAgent = role === 'agent';
  return (
    <div className={cn('flex max-w-[85%] gap-2', isAgent ? 'flex-row-reverse self-end' : 'self-start')}>
      <span
        aria-hidden
        className={cn(
          'mt-5 grid size-7 shrink-0 place-items-center rounded-full',
          isAgent ? 'bg-pulse-indigo/20 text-pulse-indigo' : 'bg-pulse-surface-2 text-pulse-muted',
        )}
      >
        {isAgent ? <Headset className="size-3.5" /> : <UserRound className="size-3.5" />}
      </span>
      <div className={cn('flex min-w-0 flex-col', isAgent ? 'items-end' : 'items-start')}>
        <span className="pulse-label mb-1">{isAgent ? 'You (Agent)' : counterpartyLabel}</span>
        <div
          className={cn(
            'whitespace-pre-wrap break-words rounded-pulse-lg px-3.5 py-2.5 text-sm leading-relaxed',
            isAgent
              ? 'rounded-tr-pulse-sm bg-pulse-indigo text-pulse-on-accent'
              : 'rounded-tl-pulse-sm border border-pulse-border bg-pulse-surface-2 text-pulse-primary',
            streaming && 'pulse-caret',
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
