'use client';

import { Headset, PhoneOff, UserRound } from 'lucide-react';
import type { PublicSimScenario } from '@/lib/schemas/curriculum';
import type { DivisionId } from '@/lib/schemas/domain';
import { cn } from '@/lib/utils';
import { DifficultyBadge } from './DifficultyBadge';
import { DIVISION_PILL_CLASS, SIM_CHANNEL_LABELS } from './labels';

export interface CallTicketHeaderProps {
  scenario: PublicSimScenario;
  campaignCode: string;
  divisionId: DivisionId;
  /** Agent turns already sent. The header shows the current turn: `Turn min(turnCount + 1, maxTurns) of maxTurns`. */
  turnCount: number;
  /** Shows the `End & Disposition Call` button when given. */
  onEndCall?: () => void;
  disabled?: boolean;
}

/** Context ticket bar on top of a Live Call Sim. */
export function CallTicketHeader({ scenario, campaignCode, divisionId, turnCount, onEndCall, disabled }: CallTicketHeaderProps) {
  const maxTurns = scenario.maxTurns;
  const currentTurn = Math.max(1, Math.min(turnCount + 1, maxTurns));
  const turnPct = Math.round((Math.min(turnCount, maxTurns) / maxTurns) * 100);

  return (
    <header className="pulse-card-elevated pulse-cq overflow-hidden">
      <div className="flex flex-col gap-3 p-4 @2xl:flex-row @2xl:items-center @2xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-pulse-md bg-pulse-indigo/15 text-pulse-indigo">
            <Headset aria-hidden className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {campaignCode ? (
                <span className="pulse-metric rounded-pulse-sm border border-pulse-border bg-pulse-bg px-1.5 py-0.5 text-xs font-semibold text-pulse-primary">
                  {campaignCode}
                </span>
              ) : null}
              <span className={cn('pulse-pill', DIVISION_PILL_CLASS[divisionId])}>{SIM_CHANNEL_LABELS[divisionId]}</span>
              <DifficultyBadge difficulty={scenario.difficulty} />
            </div>
            <h2 className="mt-1.5 truncate text-base font-bold text-pulse-primary @lg:text-lg">{scenario.title}</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-pulse-muted">
              <UserRound aria-hidden className="size-3.5" />
              {scenario.counterpartyRoleLabel}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            <p className="pulse-label">Turn</p>
            <p className="pulse-metric text-sm font-semibold text-pulse-primary" aria-live="polite">
              Turn {currentTurn} of {maxTurns}
            </p>
          </div>
          {onEndCall ? (
            <button type="button" className="pulse-btn pulse-btn-danger" onClick={onEndCall} disabled={disabled}>
              <PhoneOff aria-hidden className="size-4" />
              End &amp; Disposition Call
            </button>
          ) : null}
        </div>
      </div>
      <p className="border-t border-pulse-border-subtle bg-pulse-surface-1 px-4 py-2.5 text-xs leading-relaxed text-pulse-secondary">
        <span className="pulse-label mr-2">Ticket</span>
        {scenario.contextTicketSummary}
      </p>
      <div className="h-1 bg-pulse-surface-1" aria-hidden>
        <div className="h-full bg-pulse-indigo transition-[width] duration-500" style={{ width: `${turnPct}%` }} />
      </div>
    </header>
  );
}
