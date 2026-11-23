import Link from "next/link";
import { ScanSearch } from "lucide-react";
import type { MissedItemRow } from "./server-data";
import { EmptyState } from "./KpiStrip";

/** Playbook Gap Detector: most-missed Drills and rubric criteria, ranked by first-try miss count. */
export function MissedRulesTable({
  rows,
  trackTitles,
  trackCodes,
  linkToStudio,
}: {
  rows: MissedItemRow[];
  trackTitles: Record<string, string>;
  /** Short campaign codes ("MVP") for the Track column; falls back to the title. */
  trackCodes?: Record<string, string>;
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
  // Fixed layout (QA M7): Item takes the free space, Track is a short code, the count is right-aligned with a small
  // bar. Nothing overflows at 1280 px, and the bar drops on phones.
  return (
    <div className="pulse-cq">
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="border-b border-pulse-border-subtle text-left">
            <th scope="col" className="pulse-label w-7 py-2 pr-2">
              #
            </th>
            <th scope="col" className="pulse-label py-2 pr-3">
              Item
            </th>
            <th scope="col" className="pulse-label w-16 py-2 pr-3 @xl:w-28">
              Track
            </th>
            <th
              scope="col"
              className="pulse-label w-20 py-2 text-right leading-tight @xl:w-36"
            >
              First-try misses
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isDrill = !row.itemId.startsWith("sim-");
            const href = linkToStudio
              ? `/studio/${encodeURIComponent(row.trackId)}${isDrill ? `?drill=${encodeURIComponent(row.itemId)}` : ""}`
              : null;
            const trackTitle = trackTitles[row.trackId] ?? row.trackId;
            const trackShort = trackCodes?.[row.trackId] || trackTitle;
            return (
              <tr
                key={row.key}
                className="border-b border-pulse-border-subtle/60 align-top last:border-0"
              >
                <td className="pulse-metric py-2.5 pr-2 text-pulse-muted">
                  {index + 1}
                </td>
                <td className="py-2.5 pr-3 text-pulse-secondary">
                  {href ? (
                    <Link
                      href={href}
                      className="group inline hover:text-pulse-indigo-text"
                      title="Open this item in Track Studio"
                    >
                      <span className="line-clamp-2 group-hover:underline">
                        {row.itemLabel}
                      </span>
                    </Link>
                  ) : (
                    <span className="line-clamp-2">{row.itemLabel}</span>
                  )}
                </td>
                <td className="py-2.5 pr-3 text-pulse-muted">
                  <span
                    className="pulse-metric block truncate text-xs"
                    title={trackTitle}
                  >
                    {trackShort}
                  </span>
                </td>
                <td className="py-2.5">
                  <div className="flex items-center justify-end gap-2">
                    <div
                      className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-pulse-surface-2 @xl:block"
                      aria-hidden
                    >
                      <div
                        className="h-full rounded-full bg-pulse-crimson/80"
                        style={{ width: `${(row.missCount / max) * 100}%` }}
                      />
                    </div>
                    <span className="pulse-metric w-8 text-right font-semibold text-pulse-crimson">
                      {row.missCount}
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
