import Link from 'next/link';
import { ArrowRight, ScanSearch } from 'lucide-react';
import type { MissedItemRow } from './server-data';
import { EmptyState } from './KpiStrip';

/** Playbook Gap Detector: most-missed Drills and rubric criteria, ranked by first-try miss count. */
export function MissedRulesTable({
  rows,
  trackTitles,
  linkToStudio,
}: {
  rows: MissedItemRow[];
  trackTitles: Record<string, string>;
  linkToStudio: boolean;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ScanSearch aria-hidden className="size-6" />}
        title="No missed items recorded yet"
        body="When learners miss a Drill on the first try, it shows here so trainers can make the Playbook rule clearer."
      />
    );
  }
  const max = Math.max(...rows.map((r) => r.missCount), 1);
  return (
    <div className="pulse-cq overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-pulse-border-subtle text-left">
            <th scope="col" className="pulse-label w-10 py-2 pr-2">
              #
            </th>
            <th scope="col" className="pulse-label py-2 pr-3">
              Item
            </th>
            <th scope="col" className="pulse-label py-2 pr-3">
              Track
            </th>
            <th scope="col" className="pulse-label w-44 py-2 pr-3 text-right">
              First-try misses
            </th>
            {linkToStudio ? <th scope="col" className="sr-only">Open in Track Studio</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.key} className="border-b border-pulse-border-subtle/60 last:border-0">
              <td className="pulse-metric py-2.5 pr-2 text-pulse-muted">{index + 1}</td>
              <td className="py-2.5 pr-3 text-pulse-secondary">
                <span className="line-clamp-2">{row.itemLabel}</span>
              </td>
              <td className="py-2.5 pr-3 text-pulse-muted">
                <span className="line-clamp-1">{trackTitles[row.trackId] ?? row.trackId}</span>
              </td>
              <td className="py-2.5 pr-3">
                <div className="flex items-center justify-end gap-2">
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-pulse-surface-2" aria-hidden>
                    <div className="h-full rounded-full bg-pulse-crimson/80" style={{ width: `${(row.missCount / max) * 100}%` }} />
                  </div>
                  <span className="pulse-metric w-10 text-right font-semibold text-pulse-crimson">{row.missCount}</span>
                </div>
              </td>
              {linkToStudio ? (
                <td className="py-2.5 text-right">
                  <Link
                    href={`/studio/${encodeURIComponent(row.trackId)}`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#a5b4fc] hover:underline"
                  >
                    Studio <ArrowRight aria-hidden className="size-3.5" />
                  </Link>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
