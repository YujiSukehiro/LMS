import Link from 'next/link';
import { TRAINING_POLICY } from '@/lib/policy/training-policy';
import type { TrackDoc } from '@/lib/schemas/curriculum';
import { DivisionPill } from '@/components/layout/DivisionPill';
import { relativeTime } from '@/components/layout/labels';
import { TrackStatusPill } from './TrackStatusPill';
import { trackBuildFailed, trackDisplayStatus } from './track-display-status';

function versionLabel(track: TrackDoc): string {
  if (track.publishedVersionId) return track.publishedVersionId;
  return 'Draft';
}

export function TrackCatalogTable({ tracks }: { tracks: TrackDoc[] }) {
  const now = Date.now();
  return (
    <div className="pulse-card relative overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="border-b border-pulse-border-subtle text-left">
            <th scope="col" className="pulse-label px-4 py-3">Track</th>
            <th scope="col" className="pulse-label px-3 py-3">Division</th>
            <th scope="col" className="pulse-label px-3 py-3">Status</th>
            <th scope="col" className="pulse-label px-3 py-3">Published version</th>
            <th scope="col" className="pulse-label px-3 py-3 text-right">Checkpoints</th>
            <th scope="col" className="pulse-label px-3 py-3 text-right">
              {TRAINING_POLICY.simulationInteractionMode === 'verbal_only' ? 'Verbal Practice' : 'Live Call Sims'}
            </th>
            <th scope="col" className="pulse-label px-4 py-3 text-right">Updated</th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((track) => (
            <tr key={track.id} className="border-b border-pulse-border-subtle/60 last:border-0 hover:bg-pulse-surface-2/40">
              <th scope="row" className="px-4 py-3 text-left font-medium">
                <Link href={`/studio/${encodeURIComponent(track.id)}`} className="hover:text-pulse-indigo hover:underline">
                  {track.title}
                </Link>
                <span className="block text-xs font-normal text-pulse-muted">
                  {[track.campaignCode, track.sourcePdfFileName].filter(Boolean).join(' · ')}
                </span>
              </th>
              <td className="px-3 py-3">
                <DivisionPill divisionId={track.divisionId} short />
              </td>
              <td className="px-3 py-3">
                <div className="flex flex-col items-start gap-1">
                  <TrackStatusPill status={trackDisplayStatus(track)} />
                  {trackBuildFailed(track) ? (
                    <Link
                      href={`/studio/${encodeURIComponent(track.id)}`}
                      className="text-[0.7rem] font-semibold text-pulse-crimson hover:underline"
                      title={track.generationProgress.message}
                    >
                      {track.status === 'GENERATING' ? 'Open to retry' : 'Revision build failed · Open to retry'}
                    </Link>
                  ) : track.status === 'GENERATING' ? (
                    <span className="pulse-metric text-[0.7rem] text-pulse-muted">{Math.round(track.generationProgress.percent)}%</span>
                  ) : null}
                </div>
              </td>
              <td className="pulse-metric px-3 py-3 text-pulse-secondary">{versionLabel(track)}</td>
              <td className="pulse-metric px-3 py-3 text-right">{track.unitCount}</td>
              <td className="pulse-metric px-3 py-3 text-right">{track.simScenarioCount}</td>
              <td className="pulse-metric px-4 py-3 text-right text-xs text-pulse-muted" title={new Date(track.updatedAt).toISOString()}>
                {relativeTime(track.updatedAt, now)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
