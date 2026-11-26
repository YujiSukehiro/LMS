'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Headset, Mic, MicOff, SendHorizontal, UserRound, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { voiceErrorMessage } from './voice-errors';
import { appendSpoken, composeWithInterim, isFatalVoiceError } from './voice-core';
import { useCallerVoice } from './caller-voice';

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
  /** `audio` is the recording of a spoken reply when `recordSpokenTurns` is on; null for typed replies. */
  onSend: (content: string, audio?: SpokenTurnAudio | null) => void;
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
  /** Record each spoken reply in the browser so the delivery coach can score tone and pace. */
  recordSpokenTurns?: boolean;
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

/** One spoken agent turn, recorded in the browser for the delivery coach. Never stored on the server. */
export interface SpokenTurnAudio {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

const RECORDER_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];

function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return RECORDER_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported?.(type));
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
  recordSpokenTurns = false,
}: TranscriptChatProps) {
  const [draft, setDraft] = useState('');
  const [interim, setInterim] = useState('');
  const [speechSupported, setSpeechSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  /** The learner wants the mic on. Dictation restarts by itself after pauses and after the caller's reply. */
  const wantListenRef = useRef(false);
  const [micOn, setMicOn] = useState(false);
  const setWantListen = (value: boolean) => {
    wantListenRef.current = value;
    setMicOn(value);
  };
  const appliedRestoreKey = useRef<number | null>(null);
  const hintId = useId();
  const composerId = useId();

  const caller = useCallerVoice(messages, !demoReplay);

  // Audio capture for the delivery coach (one recording per spoken turn, kept in memory only).
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const turnStartRef = useRef<number>(0);
  const pausedMsRef = useRef<number>(0);
  const pauseStartRef = useRef<number | null>(null);

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const ensureRecording = useCallback(async () => {
    if (!recordSpokenTurns || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
    const recorder = recorderRef.current;
    if (recorder) {
      if (recorder.state === 'paused') {
        recorder.resume();
        if (pauseStartRef.current !== null) pausedMsRef.current += Date.now() - pauseStartRef.current;
        pauseStartRef.current = null;
      }
      return;
    }
    try {
      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      }
      const mimeType = pickRecorderMimeType();
      const next = new MediaRecorder(streamRef.current, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 24_000 });
      chunksRef.current = [];
      next.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      next.start(1000);
      recorderRef.current = next;
      turnStartRef.current = Date.now();
      pausedMsRef.current = 0;
      pauseStartRef.current = null;
    } catch {
      // No recording (mic refused or unsupported): dictation still works, the delivery coach just skips this turn.
    }
  }, [recordSpokenTurns]);

  const pauseRecording = () => {
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') {
      recorder.pause();
      pauseStartRef.current = Date.now();
    }
  };

  /** Stop this turn's recording and hand back the audio, or null when nothing was recorded. */
  const finishRecording = (): Promise<SpokenTurnAudio | null> => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder || recorder.state === 'inactive') return Promise.resolve(null);
    if (pauseStartRef.current !== null) pausedMsRef.current += Date.now() - pauseStartRef.current;
    const durationMs = Math.max(0, Date.now() - turnStartRef.current - pausedMsRef.current);
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const mimeType = (recorder.mimeType || 'audio/webm').split(';')[0];
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];
        resolve(blob.size > 0 && durationMs >= 500 ? { blob, mimeType, durationMs } : null);
      };
      try {
        recorder.stop();
      } catch {
        resolve(null);
      }
    });
  };

  useEffect(() => {
    setSpeechSupported(getSpeechRecognitionCtor() !== null);
    return () => {
      wantListenRef.current = false;
      disposeRecognition(recognitionRef.current);
      recognitionRef.current = null;
      try {
        recorderRef.current?.stop();
      } catch {
        // Already stopped.
      }
      recorderRef.current = null;
      releaseStream();
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

  const stopRecognition = () => {
    disposeRecognition(recognitionRef.current);
    recognitionRef.current = null;
    setListening(false);
    setInterim('');
  };

  const startRecognition = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    disposeRecognition(recognitionRef.current);
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onresult = (event) => {
      const finals: string[] = [];
      let pending = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const res = event.results[i];
        const text = res?.[0]?.transcript ?? '';
        if (!text) continue;
        if (res.isFinal) finals.push(text.trim());
        else pending += text;
      }
      const spoken = finals.join(' ');
      if (spoken) setDraft((prev) => appendSpoken(prev, spoken, maxLength));
      setInterim(pending.trim());
    };
    recognition.onerror = (event) => {
      const message = voiceErrorMessage(event?.error);
      if (isFatalVoiceError(event?.error)) {
        setWantListen(false);
        setVoiceError(message);
      } else if (event?.error !== 'no-speech' && message) {
        setVoiceError(message);
      }
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      setInterim('');
      // Browsers end dictation after a pause. Keep listening until the learner turns the mic off.
      if (wantListenRef.current) {
        try {
          startRecognitionRef.current();
          return;
        } catch {
          setWantListen(false);
        }
      }
      setListening(false);
    };
    recognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setWantListen(false);
      setVoiceError(voiceErrorMessage('unknown'));
      setListening(false);
    }
  }, [maxLength]);
  const startRecognitionRef = useRef(startRecognition);
  startRecognitionRef.current = startRecognition;

  // Pause the mic while the caller replies or speaks, so the caller's voice is not dictated; resume after.
  const micBlocked = composerDisabled || caller.speaking;
  useEffect(() => {
    if (micBlocked) {
      if (recognitionRef.current) stopRecognition();
      pauseRecording();
      return;
    }
    textareaRef.current?.focus({ preventScroll: true });
    if (wantListenRef.current && !recognitionRef.current) {
      void ensureRecording();
      startRecognition();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micBlocked]);

  const sendLockRef = useRef(false);
  useEffect(() => {
    sendLockRef.current = false;
  });

  const send = () => {
    if (sendLockRef.current) return;
    const content = composeWithInterim(draft, interim, maxLength).trim();
    if (!content || composerDisabled) return;
    if (recognitionRef.current) {
      // Drop any late dictation result so it cannot reappear in the cleared composer after sending.
      // wantListenRef stays as it is: the mic comes back on by itself after the caller's reply.
      stopRecognition();
    }
    caller.stop();
    sendLockRef.current = true;
    const audio = finishRecording();
    setDraft('');
    setInterim('');
    void audio.then((clip) => onSend(content.slice(0, maxLength), clip));
  };

  const toggleVoice = () => {
    if (composerDisabled) return;
    if (micOn || listening) {
      setWantListen(false);
      recognitionRef.current?.stop();
      pauseRecording();
      setListening(false);
      setInterim('');
      return;
    }
    setVoiceError(null);
    setWantListen(true);
    caller.stop();
    void ensureRecording();
    startRecognition();
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
  const shownDraft = composeWithInterim(draft, interim, maxLength);

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
        {isStreaming ? `${counterpartyLabel} is replying.` : listening ? 'Listening.' : ''}
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
            value={shownDraft}
            onChange={(event) => {
              setInterim('');
              setDraft(event.target.value);
              if (voiceError) setVoiceError(null);
            }}
            onKeyDown={onKeyDown}
            disabled={composerDisabled}
            maxLength={maxLength}
            rows={2}
            aria-describedby={hintId}
            placeholder={
              composerDisabled ? '' : listening ? 'Listening… speak your reply, then press Enter to send.' : 'Speak or type your response as the agent…'
            }
            className={cn('pulse-textarea min-h-[3.25rem] max-h-40 flex-1 resize-y', interim && 'text-pulse-secondary')}
          />
          {caller.supported ? (
            <button
              type="button"
              onClick={() => caller.setMuted(!caller.muted)}
              aria-pressed={!caller.muted}
              aria-label={caller.muted ? `Turn on ${counterpartyLabel} voice` : `Mute ${counterpartyLabel} voice`}
              title={caller.muted ? 'Caller voice is off' : 'Caller voice is on'}
              className="pulse-btn h-[3.25rem] min-w-[3.25rem] px-3"
            >
              {caller.muted ? <VolumeX aria-hidden className="size-4" /> : <Volume2 aria-hidden className="size-4" />}
            </button>
          ) : null}
          {speechSupported !== null ? (
            <button
              type="button"
              onClick={toggleVoice}
              disabled={composerDisabled || !speechSupported}
              aria-pressed={micOn}
              aria-label={micOn ? 'Stop voice dictation' : 'Start voice dictation'}
              title={
                !speechSupported
                  ? 'Voice needs Chrome, Edge or Safari. You can still type.'
                  : micOn
                    ? 'Mic is on. Select to turn it off.'
                    : 'Turn on the mic and talk'
              }
              className={cn(
                'pulse-btn h-[3.25rem] min-w-[3.25rem] px-3',
                micOn && 'border-pulse-crimson text-pulse-crimson',
              )}
            >
              {micOn ? <MicOff aria-hidden className="size-4" /> : <Mic aria-hidden className="size-4" />}
            </button>
          ) : null}
          <button
            type="submit"
            className="pulse-btn pulse-btn-primary h-[3.25rem] min-w-[3.25rem] px-4"
            disabled={composerDisabled || shownDraft.trim().length === 0}
            aria-label="Send reply"
          >
            <SendHorizontal aria-hidden className="size-4" />
          </button>
        </div>
        {voiceError ? (
          <p role="alert" className="mt-1.5 text-xs text-pulse-amber">
            {voiceError}
          </p>
        ) : speechSupported === false ? (
          <p className="mt-1.5 text-xs text-pulse-muted">Voice needs Chrome, Edge or Safari. You can still type your replies.</p>
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
            {shownDraft.length}/{maxLength}
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
