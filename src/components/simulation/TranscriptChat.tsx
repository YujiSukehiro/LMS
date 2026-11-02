'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Headset, SendHorizontal, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  /** Disables the composer (for example while a reply streams or after the call ends). */
  composerDisabled: boolean;
  /** Short note under the composer when it is disabled. */
  composerNote?: string;
  /** Text to put back into the composer (for example after a failed send). Change `restoreKey` to apply it again. */
  restoreDraft?: { text: string; restoreKey: number } | null;
  maxLength?: number;
  className?: string;
}

/** Live Call Sim transcript: counterparty bubbles on the left, agent on the right, composer at the bottom. */
export function TranscriptChat({
  messages,
  streamingText,
  counterpartyLabel,
  onSend,
  composerDisabled,
  composerNote,
  restoreDraft,
  maxLength = 2000,
  className,
}: TranscriptChatProps) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const appliedRestoreKey = useRef<number | null>(null);

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
  }, [composerDisabled]);

  const send = () => {
    const content = draft.trim();
    if (!content || composerDisabled) return;
    onSend(content.slice(0, maxLength));
    setDraft('');
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
      <div
        ref={scrollRef}
        role="log"
        aria-label="Call transcript"
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
        {isStreaming ? `${counterpartyLabel} is replying.` : ''}
      </p>

      <form onSubmit={onSubmit} className="border-t border-pulse-border-subtle p-3">
        <label htmlFor="sim-composer" className="sr-only">
          Your reply as the agent
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="sim-composer"
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={composerDisabled}
            maxLength={maxLength}
            rows={2}
            placeholder={composerDisabled ? '' : 'Type your reply as the agent…'}
            className="pulse-textarea min-h-[3.25rem] flex-1 resize-none"
          />
          <button
            type="submit"
            className="pulse-btn pulse-btn-primary h-[3.25rem] px-4"
            disabled={composerDisabled || draft.trim().length === 0}
            aria-label="Send reply"
          >
            <SendHorizontal aria-hidden className="size-4" />
          </button>
        </div>
        <p className="mt-1.5 flex justify-between gap-2 text-xs text-pulse-muted">
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
              ? 'rounded-tr-pulse-sm bg-pulse-indigo text-white'
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
