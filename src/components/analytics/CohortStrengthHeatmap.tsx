import Link from 'next/link';
import { CANONICAL_PILLARS } from '@/lib/schemas/constants';
import { cn } from '@/lib/utils';
import { BAND_CELL_CLASS, BAND_LABEL, bandFor, formatPct } from './strength';

export interface HeatmapCell {
  average: number | null;
  sampleCount: number;
}

export interface HeatmapRow {
  id: string;
  label: string;
  sublabel?: string;
  kind: 'cohort' | 'agent';
  href?: string;
  cells: Record<string, HeatmapCell>;
}

/** Cohort (or Agent) × CompetencyPillar strength heatmap. */
export function CohortStrengthHeatmap({ rows, caption }: { rows: HeatmapRow[]; caption: string }) {
  return (
    <div className="pulse-cq overflow-x-auto">
      <table className="w-full min-w-[760px] border-separate border-spacing-1 text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="pulse-label w-48 px-2 pb-1 text-left align-bottom">
              Cohort / Agent
            </th>
            {CANONICAL_PILLARS.map((pillar) => (
              <th
                key={pillar.key}
                scope="col"
                title={pillar.label}
                className="px-1 pb-1 text-center align-bottom text-[0.7rem] font-semibold leading-tight text-pulse-muted"
              >
                {pillar.shortLabel}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.kind}-${row.id}`}>
              <th
                scope="row"
                className={cn(
                  'max-w-48 truncate px-2 py-1 text-left font-medium',
                  row.kind === 'agent' ? 'pl-5 text-pulse-secondary' : 'text-pulse-primary',
                )}
              >
                {row.href ? (
                  <Link href={row.href} className="hover:text-pulse-indigo hover:underline">
                    {row.label}
                  </Link>
                ) : (
                  row.label
                )}
                {row.sublabel ? <span className="block text-[0.7rem] font-normal text-pulse-muted">{row.sublabel}</span> : null}
              </th>
              {CANONICAL_PILLARS.map((pillar) => {
                const cell = row.cells[pillar.key] ?? { average: null, sampleCount: 0 };
                const band = bandFor(cell.sampleCount > 0 ? cell.average : null);
                const title =
                  band === 'none'
                    ? `${row.label} — ${pillar.label}: no data yet`
                    : `${row.label} — ${pillar.label}: ${formatPct(cell.average)} (${BAND_LABEL[band]}) · ${cell.sampleCount} sample${cell.sampleCount === 1 ? '' : 's'}`;
                return (
                  <td
                    key={pillar.key}
                    title={title}
                    className={cn('pulse-metric h-10 rounded-pulse-sm text-center text-sm font-semibold', BAND_CELL_CLASS[band])}
                  >
                    <span aria-hidden>{band === 'none' ? '·' : Math.round(cell.average ?? 0)}</span>
                    <span className="sr-only">{title}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <HeatmapLegend />
    </div>
  );
}

function HeatmapLegend() {
  const items: Array<{ band: 'strong' | 'borderline' | 'weak' | 'none'; label: string }> = [
    { band: 'strong', label: '≥ 85% Strong' },
    { band: 'borderline', label: '70–84% Borderline' },
    { band: 'weak', label: '< 70% Needs coaching' },
    { band: 'none', label: 'No data' },
  ];
  return (
    <ul className="mt-3 flex flex-wrap gap-3 text-xs text-pulse-muted">
      {items.map((item) => (
        <li key={item.band} className="flex items-center gap-1.5">
          <span aria-hidden className={cn('inline-block size-3 rounded-sm', BAND_CELL_CLASS[item.band])} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
