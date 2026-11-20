'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { SIM_COPY, TRAINING_POLICY } from '@/lib/policy/training-policy';
import { AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, Clock, Download, ShieldCheck, Users, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STAGE_LABELS, stageRank, type ProgressCell } from '@/lib/services/team-progress';
import { csvEscape } from './csv-escape';

export interface BoardTrack {
  id: string;
  title: string;
  campaignCode: string;
  versionLabel: string;
  unitCount: number;
  simCount: number;
}

export interface BoardAgent {
  uid: string;
  displayName: string;
  lcNumber: string | null;
  cohortLabel: string;
  active: boolean;
  activityLabel: string;
  cells: Record<string, ProgressCell>;
}

type ColumnId = 'not_started' | 'learning' | 'checkpoints_done' | 'certified';

const COLUMNS: Array<{ id: ColumnId; label: string; icon: LucideIcon; tone: string; tile: string; avatar: string }> = [
  { id: 'not_started', label: 'Not started', icon: CircleDashed, tone: 'text-pulse-secondary', tile: 'bg-pulse-surface-2', avatar: 'bg-pulse-indigo/10 text-pulse-indigo-text' },
  { id: 'learning', label: 'Learning', icon: Clock, tone: 'text-pulse-amber', tile: 'bg-pulse-amber/10', avatar: 'bg-pulse-indigo/10 text-pulse-indigo-text' },
  { id: 'checkpoints_done', label: `Ready for ${SIM_COPY.short.toLowerCase()}`, icon: CheckCircle2, tone: 'text-pulse-indigo-text', tile: 'bg-pulse-indigo/10', avatar: 'bg-pulse-indigo/10 text-pulse-indigo-text' },
  { id: 'certified', label: 'Certified', icon: ShieldCheck, tone: 'text-pulse-emerald', tile: 'bg-pulse-emerald/10', avatar: 'bg-pulse-emerald/15 text-pulse-emerald' },
];

/** Cards shown per column before "+ N more". Flagged cards always show. */
const COLUMN_PREVIEW = 6;

interface CardData {
  agent: BoardAgent;
  cell: ProgressCell;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** Readiness pipeline: one Track at a time, one card per agent, cards move right as agents progress. */
export function TeamProgressBoard({ tracks, agents }: { tracks: BoardTrack[]; agents: BoardAgent[] }) {
  const [trackId, setTrackId] = useState(tracks[0]?.id ?? '');
  const [expanded, setExpanded] = useState<Partial<Record<ColumnId, boolean>>>({});
  const track = tracks.find((t) => t.id === trackId) ?? tracks[0];

  const readyByTrack = useMemo(
    () =>
      Object.fromEntries(
        tracks.map((t) => {
          const cells = agents.map((a) => a.cells[t.id]).filter((c): c is ProgressCell => Boolean(c));
          const counted = cells.filter((c) => c.stage !== 'archived' && c.stage !== 'not_assigned');
          return [t.id, { ready: counted.filter((c) => c.stage === 'certified').length, total: counted.length }];
        }),
      ),
    [agents, tracks],
  );

  const { columns, recert, offboarded } = useMemo(() => {
    const byColumn: Record<ColumnId, CardData[]> = { not_started: [], learning: [], checkpoints_done: [], certified: [] };
    const recertCards: CardData[] = [];
    let archived = 0;
    if (track) {
      for (const agent of agents) {
        const cell = agent.cells[track.id];
        if (!cell || cell.stage === 'not_assigned') continue;
        if (cell.stage === 'archived') {
          archived += 1;
          continue;
        }
        if (cell.stage === 'needs_recert') recertCards.push({ agent, cell });
        else byColumn[cell.stage].push({ agent, cell });
      }
    }
    // Problems first, then least progress, then name.
    const order = (a: CardData, b: CardData) =>
      Number(Boolean(b.cell.flag)) - Number(Boolean(a.cell.flag)) ||
      (b.cell.stalledDays ?? 0) - (a.cell.stalledDays ?? 0) ||
      stageRank(a.cell) - stageRank(b.cell) ||
      a.cell.unitsDoneCount - b.cell.unitsDoneCount ||
      a.agent.displayName.localeCompare(b.agent.displayName);
    for (const list of Object.values(byColumn)) list.sort(order);
    recertCards.sort(order);
    return { columns: byColumn, recert: recertCards, offboarded: archived };
  }, [agents, track]);

  function exportCsv() {
    if (!track) return;
    const header = ['Agent', 'LC Number', 'Cohort', 'Status', 'Checkpoints done', 'Best sim %', 'Detail', 'Problem', 'Next step'];
    const lines = [header.map(csvEscape).join(',')];
    for (const agent of agents) {
      const cell = agent.cells[track.id];
      if (!cell) continue;
      lines.push(
        [
          agent.displayName,
          agent.lcNumber ?? '',
          agent.cohortLabel,
          STAGE_LABELS[cell.stage],
          `${cell.unitsDoneCount}/${cell.unitsDone.length}`,
          cell.bestSimPct === null ? '' : String(Math.round(cell.bestSimPct)),
          cell.detail,
          cell.flag?.text ?? '',
          cell.nextStep ?? '',
        ]
          .map(csvEscape)
          .join(','),
      );
    }
    const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `pulse-team-progress-${track.campaignCode || track.id}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  if (!track || agents.length === 0) {
    return (
      <div className="pulse-card flex flex-col items-center gap-2 px-6 py-12 text-center">
        <Users aria-hidden className="size-6 text-pulse-muted" />
        <p className="text-sm font-semibold text-pulse-secondary">
          {!track ? 'No published Tracks match these filters.' : 'No agents match these filters.'}
        </p>
      </div>
    );
  }

  const { ready, total } = readyByTrack[track.id] ?? { ready: 0, total: 0 };
  const readyPct = total > 0 ? Math.round((ready / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Track tabs + readiness meter */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div role="tablist" aria-label="Track" className="flex flex-wrap gap-2">
          {tracks.map((t) => {
            const selected = t.id === track.id;
            const counts = readyByTrack[t.id];
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setTrackId(t.id)}
                className={cn(
                  'rounded-full border px-4 py-1.5 text-sm transition-colors',
                  selected
                    ? 'border-pulse-indigo bg-pulse-indigo font-semibold text-pulse-on-accent'
                    : 'border-pulse-border bg-pulse-surface-1 text-pulse-secondary hover:border-pulse-indigo/60',
                )}
              >
                {t.title} · {counts?.ready ?? 0} of {counts?.total ?? 0} ready
              </button>
            );
          })}
        </div>
        <div className="flex min-w-60 flex-col gap-1">
          <span className="pulse-label">Ready for calls</span>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-pulse-elevated" role="img" aria-label={`${readyPct}% certified`}>
            <div className="h-full rounded-full bg-pulse-emerald" style={{ width: `${readyPct}%` }} />
          </div>
          <span className="text-xs text-pulse-muted">
            <strong className="pulse-metric text-pulse-emerald">{readyPct}%</strong> certified · {ready} of {total} agents
          </span>
        </div>
      </div>

      <p className="text-sm text-pulse-muted">
        {track.unitCount} checkpoint{track.unitCount === 1 ? '' : 's'} + {track.simCount}{' '}
        {TRAINING_POLICY.simulationInteractionMode === 'verbal_only'
          ? `Verbal Practice${track.simCount === 1 ? '' : ' scenarios'}`
          : `Live Call Sim${track.simCount === 1 ? '' : 's'}`}.
      </p>

      {/* Columns */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((column) => {
          const cards = columns[column.id];
          const Icon = column.icon;
          const flagged = cards.filter((c) => c.cell.flag).length;
          const limit = expanded[column.id] ? cards.length : Math.max(COLUMN_PREVIEW, flagged);
          const shown = cards.slice(0, limit);
          const hidden = cards.length - shown.length;
          return (
            <section key={column.id} aria-label={`${column.label}: ${cards.length}`} className={cn('flex flex-col gap-2 rounded-pulse-lg p-2.5 md:min-h-48', column.tile)}>
              <h2 className={cn('flex items-center gap-2 px-1.5 pt-1 text-sm font-bold', column.tone)}>
                <Icon aria-hidden className="size-4 shrink-0" />
                <span className="text-pulse-primary">{column.label}</span>
                <span className="pulse-metric ml-auto text-xs font-medium text-pulse-muted">{cards.length}</span>
              </h2>
              {shown.map(({ agent, cell }) => (
                <AgentCard key={agent.uid} agent={agent} cell={cell} column={column.id} avatarClass={column.avatar} track={track} />
              ))}
              {hidden > 0 ? (
                <button
                  type="button"
                  className="flex items-center justify-center gap-1 rounded-pulse-md bg-pulse-surface-1 px-3 py-2 text-xs font-semibold text-pulse-secondary hover:text-pulse-primary"
                  onClick={() => setExpanded((prev) => ({ ...prev, [column.id]: true }))}
                >
                  + {hidden} more on track
                  <ChevronDown aria-hidden className="size-3.5" />
                </button>
              ) : null}
              {cards.length === 0 && !(column.id === 'certified' && recert.length > 0) ? (
                <p className="px-1.5 py-3 text-xs text-pulse-muted">Nobody here.</p>
              ) : null}
              {column.id === 'certified' && recert.length > 0 ? (
                <div className="mt-auto flex flex-col gap-2 rounded-pulse-md border border-dashed border-pulse-crimson/50 bg-pulse-surface-1 p-2.5">
                  <p className="flex items-center gap-1.5 text-sm font-bold text-pulse-crimson">
                    <AlertTriangle aria-hidden className="size-4 shrink-0" />
                    Needs recert · {recert.length}
                  </p>
                  {recert.map(({ agent, cell }) => (
                    <div key={agent.uid} className="text-xs">
                      <Link href={`/analytics/agents/${encodeURIComponent(agent.uid)}`} className="font-semibold text-pulse-primary hover:underline">
                        {agent.displayName}
                      </Link>
                      <p className="text-pulse-muted">{cell.detail}</p>
                      {cell.nextStep ? <p className="text-pulse-secondary">{cell.nextStep}</p> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-pulse-muted">
        <span>
          Only server-verified evidence moves a card. Demo replay and unverified history never count.
          {offboarded > 0 ? ` ${offboarded} offboarded agent${offboarded === 1 ? ' is' : 's are'} hidden.` : ''}
        </span>
        <button type="button" className="pulse-btn py-1 text-xs" onClick={exportCsv}>
          <Download aria-hidden className="size-3.5" />
          Export CSV
        </button>
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  cell,
  column,
  avatarClass,
  track,
}: {
  agent: BoardAgent;
  cell: ProgressCell;
  column: ColumnId;
  avatarClass: string;
  track: BoardTrack;
}) {
  const flagTone = cell.flag?.tone === 'danger' ? 'text-pulse-crimson' : 'text-pulse-amber';
  let subline: string;
  switch (column) {
    case 'not_started':
      subline = agent.activityLabel === 'no activity yet' ? 'Assigned, no activity yet' : agent.activityLabel;
      break;
    case 'learning':
      subline = cell.nextUnitIndex !== null ? `Checkpoint ${cell.nextUnitIndex + 1} of ${cell.unitsDone.length} next` : 'Finishing checkpoints';
      break;
    case 'checkpoints_done':
      subline = cell.simPassed ? `${SIM_COPY.short} passed${cell.bestSimPct !== null ? ` ${Math.round(cell.bestSimPct)}%` : ''}` : `All ${cell.unitsDone.length} checkpoints done`;
      break;
    case 'certified':
      subline = cell.detail;
      break;
  }
  const threshold = cell.simPassLine;
  return (
    <article
      className={cn(
        'flex flex-col gap-2 rounded-pulse-md border bg-pulse-surface-1 p-3 shadow-sm',
        cell.flag?.tone === 'danger' ? 'border-pulse-crimson/50' : cell.flag ? 'border-pulse-amber/50' : 'border-transparent',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span aria-hidden className={cn('grid size-8 shrink-0 place-items-center rounded-full text-[0.7rem] font-bold', avatarClass)}>
          {initials(agent.displayName)}
        </span>
        <div className="min-w-0">
          <Link href={`/analytics/agents/${encodeURIComponent(agent.uid)}`} className="block truncate text-sm font-semibold hover:underline">
            {agent.displayName}
          </Link>
          <p className="truncate text-xs text-pulse-muted">{subline}</p>
        </div>
      </div>

      {column === 'learning' ? (
        <div className="flex gap-1" role="img" aria-label={`${cell.unitsDoneCount} of ${cell.unitsDone.length} checkpoints done`}>
          {cell.unitsDone.map((done, index) => (
            <span key={index} className={cn('h-1.5 flex-1 rounded-full', done ? 'bg-pulse-amber' : 'bg-pulse-elevated')} />
          ))}
        </div>
      ) : null}

      {column === 'checkpoints_done' && !cell.simPassed && cell.bestSimPct !== null ? (
        <div className="flex flex-col gap-1">
          <span className="text-[0.7rem] text-pulse-muted">Best sim</span>
          <div className="relative h-2 rounded-full bg-pulse-elevated" role="img" aria-label={`Best sim ${Math.round(cell.bestSimPct)}%, pass line ${threshold}%`}>
            <div className="h-full rounded-full bg-pulse-amber" style={{ width: `${cell.bestSimPct}%` }} />
            <span aria-hidden className="absolute -top-1 h-4 w-0.5 bg-pulse-primary" style={{ left: `${threshold}%` }} />
          </div>
        </div>
      ) : null}

      {cell.flag ? (
        <p className={cn('text-xs font-semibold', flagTone)}>{cell.flag.text}</p>
      ) : column === 'learning' ? (
        <p className="text-xs text-pulse-muted">
          {agent.activityLabel}
          {cell.firstTryPct !== null ? ` · ${cell.firstTryPct}% first try` : ''}
        </p>
      ) : null}

      {column === 'checkpoints_done' && cell.nextStep ? (
        <p className="w-fit rounded-full bg-pulse-indigo/10 px-2.5 py-0.5 text-xs font-semibold text-pulse-indigo-text">{cell.nextStep}</p>
      ) : null}
      <span className="sr-only">Track: {track.title}</span>
    </article>
  );
}
