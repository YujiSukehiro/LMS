'use client';

import Link from 'next/link';
import { Award, Download, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { csvEscape } from '@/components/progress/csv-escape';

export type CertificationCellStatus =
  | 'CERTIFIED'
  | 'IN_PROGRESS'
  | 'READY_FOR_TRAINER_REVIEW'
  | 'RECERTIFICATION_REQUIRED'
  | 'EXPIRED'
  | 'REVOKED'
  | 'HISTORICAL_UNVERIFIED'
  | 'NOT_STARTED'
  | 'NOT_ASSIGNED';

export interface CertificationCell {
  status: CertificationCellStatus;
  /** Optional display percentage; not a measure of live-call readiness. */
  pct: number | null;
}

export interface CertificationMatrixTrack {
  id: string;
  title: string;
  campaignCode: string;
}

export interface CertificationMatrixAgent {
  uid: string;
  displayName: string;
  lcNumber: string | null;
  cohortLabel: string;
  cells: Record<string, CertificationCell>;
}

function cellText(cell: CertificationCell): string {
  switch (cell.status) {
    case 'CERTIFIED':
      return cell.pct === null ? 'Certified' : `Certified (${Math.round(cell.pct)}%)`;
    case 'IN_PROGRESS':
      return `In Progress (${Math.round(cell.pct ?? 0)}%)`;
    case 'READY_FOR_TRAINER_REVIEW':
      return 'Trainer Review Required';
    case 'RECERTIFICATION_REQUIRED':
      return 'Recertification Required';
    case 'EXPIRED':
      return 'Expired';
    case 'REVOKED':
      return 'Revoked';
    case 'HISTORICAL_UNVERIFIED':
      return 'Historical — Unverified';
    case 'NOT_STARTED':
      return 'Not Started';
    case 'NOT_ASSIGNED':
      return 'Not Assigned';
  }
}

/** Agent × published Track certification grid with 1-click CSV export. */
export function CertificationMatrix({
  agents,
  tracks,
  fileLabel,
}: {
  agents: CertificationMatrixAgent[];
  tracks: CertificationMatrixTrack[];
  fileLabel: string;
}) {
  function exportCsv() {
    const header = ['Agent', 'LC Number', 'Cohort', ...tracks.map((t) => (t.campaignCode ? `${t.title} (${t.campaignCode})` : t.title))];
    const lines = [header.map(csvEscape).join(',')];
    for (const agent of agents) {
      const row = [
        agent.displayName,
        agent.lcNumber ?? '',
        agent.cohortLabel,
        ...tracks.map((t) => cellText(agent.cells[t.id] ?? { status: 'NOT_STARTED', pct: null })),
      ];
      lines.push(row.map(csvEscape).join(','));
    }
    const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `pulse-certification-matrix-${fileLabel}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  const certifiedTotal = agents.reduce(
    (sum, a) => sum + Object.values(a.cells).filter((c) => c.status === 'CERTIFIED').length,
    0,
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-pulse-muted">
          <span className="pulse-metric text-pulse-secondary">{agents.length}</span> agents ·{' '}
          <span className="pulse-metric text-pulse-secondary">{tracks.length}</span> published Tracks ·{' '}
          <span className="pulse-metric text-pulse-emerald">{certifiedTotal}</span> certifications
        </p>
        <button
          type="button"
          className="pulse-btn"
          onClick={exportCsv}
          disabled={agents.length === 0 || tracks.length === 0}
        >
          <Download aria-hidden className="size-4" />
          Export CSV
        </button>
      </div>
      {agents.length === 0 || tracks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-pulse-lg border border-dashed border-pulse-border px-6 py-10 text-center">
          <Users aria-hidden className="size-6 text-pulse-muted" />
          <p className="text-sm font-semibold text-pulse-secondary">
            {tracks.length === 0 ? 'No published Tracks match these filters' : 'No agents match these filters'}
          </p>
        </div>
      ) : (
        <div className="pulse-cq max-h-[520px] relative overflow-auto rounded-pulse-md border border-pulse-border-subtle">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="sticky top-0 z-10 bg-pulse-surface-1">
              <tr className="border-b border-pulse-border-subtle">
                <th scope="col" className="pulse-label sticky left-0 bg-pulse-surface-1 px-3 py-2 text-left">
                  Agent
                </th>
                {tracks.map((track) => (
                  <th key={track.id} scope="col" className="px-3 py-2 text-left text-xs font-semibold text-pulse-secondary">
                    <span className="line-clamp-2 min-w-32">{track.title}</span>
                    {track.campaignCode ? (
                      <span className="pulse-metric text-[0.68rem] font-normal text-pulse-muted">{track.campaignCode}</span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.uid} className="border-b border-pulse-border-subtle/60 last:border-0">
                  <th scope="row" className="sticky left-0 bg-pulse-surface-1 px-3 py-2 text-left font-medium">
                    <Link href={`/analytics/agents/${encodeURIComponent(agent.uid)}`} className="hover:text-pulse-indigo hover:underline">
                      {agent.displayName}
                    </Link>
                    <span className="block text-[0.7rem] font-normal text-pulse-muted">
                      {[agent.lcNumber, agent.cohortLabel].filter(Boolean).join(' · ')}
                    </span>
                  </th>
                  {tracks.map((track) => {
                    const cell = agent.cells[track.id] ?? { status: 'NOT_STARTED', pct: null };
                    return (
                      <td key={track.id} className="px-3 py-2">
                        <StatusChip cell={cell} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusChip({ cell }: { cell: CertificationCell }) {
  const text = cellText(cell);
  if (cell.status === 'CERTIFIED') {
    return (
      <span className="pulse-pill pulse-pill-emerald pulse-metric">
        <Award aria-hidden className="size-3.5" />
        {text}
      </span>
    );
  }
  if (
    cell.status === 'IN_PROGRESS' ||
    cell.status === 'READY_FOR_TRAINER_REVIEW' ||
    cell.status === 'RECERTIFICATION_REQUIRED'
  ) {
    return <span className="pulse-pill pulse-pill-amber pulse-metric">{text}</span>;
  }
  if (cell.status === 'EXPIRED' || cell.status === 'REVOKED') {
    return <span className="pulse-pill pulse-pill-crimson">{text}</span>;
  }
  return <span className={cn('text-xs text-pulse-muted', cell.status === 'NOT_ASSIGNED' && 'opacity-60')}>{text}</span>;
}
