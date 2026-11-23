import Link from 'next/link';
import { ChartColumn, CircleAlert, CircleCheck, Layers, LoaderCircle, Pencil, Plus } from 'lucide-react';
import type { SessionUser } from '@/lib/schemas/domain';
import { loadAllTracks, loadRollup, rankMissedItems, relabelMissedItems } from '@/components/analytics/server-data';
import { rollupIdForGlobal } from '@/lib/schemas/analytics';
import { EmptyState, KpiStrip, SectionHeader } from '@/components/analytics/KpiStrip';
import { MissedRulesTable } from '@/components/analytics/MissedRulesTable';
import { TrackStatusPill } from '@/components/studio/TrackStatusPill';
import { trackDisplayStatus, trackStatusCounts } from '@/components/studio/track-display-status';
import { DivisionPill } from '../DivisionPill';
import { relativeTime } from '../labels';

export async function TrainerHome({ user }: { user: SessionUser }) {
  const [tracks, global] = await Promise.all([loadAllTracks(), loadRollup(rollupIdForGlobal())]);
  const counts = trackStatusCounts(tracks);
  const recent = tracks.slice(0, 6);
  const trackTitles = Object.fromEntries(tracks.map((t) => [t.id, t.title]));
  const missed = await relabelMissedItems(rankMissedItems([global], 6), tracks);
  const trackCodes = Object.fromEntries(tracks.map((t) => [t.id, t.campaignCode]));
  const now = Date.now();
  const firstName = user.displayName.split(/\s+/)[0] ?? user.displayName;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="pulse-label">Track Catalog</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Hello, {firstName}</h1>
          <p className="mt-1 text-sm text-pulse-muted">Upload a Playbook PDF and get an interactive Track in minutes.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/analytics" className="pulse-btn">
            <ChartColumn aria-hidden className="size-4" />
            Analytics
          </Link>
          <Link href="/studio/new" className="pulse-btn pulse-btn-primary">
            <Plus aria-hidden className="size-4" />
            New Campaign Track
          </Link>
        </div>
      </div>

      <KpiStrip
        // Five tiles when a build failed: keep them on one row on wide screens instead of orphaning one.
        className={counts.BUILD_FAILED > 0 ? 'md:grid-cols-3 xl:grid-cols-5' : undefined}
        items={[
          { label: 'All Tracks', value: String(tracks.length), icon: <Layers aria-hidden className="size-3.5" /> },
          { label: 'Drafts', value: String(counts.DRAFT), icon: <Pencil aria-hidden className="size-3.5" />, tone: counts.DRAFT > 0 ? 'amber' : 'default' },
          { label: 'Generating', value: String(counts.GENERATING), icon: <LoaderCircle aria-hidden className="size-3.5" />, tone: 'indigo' },
          ...(counts.BUILD_FAILED > 0
            ? [{ label: 'Build failed', value: String(counts.BUILD_FAILED), icon: <CircleAlert aria-hidden className="size-3.5" />, tone: 'crimson' as const }]
            : []),
          { label: 'Published', value: String(counts.PUBLISHED), icon: <CircleCheck aria-hidden className="size-3.5" />, tone: 'emerald' },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-5">
        <section className="pulse-card flex min-w-0 flex-col gap-4 p-4 md:p-5 xl:col-span-3">
          <SectionHeader
            title="Recently updated Tracks"
            actions={
              <Link href="/studio" className="text-sm font-semibold text-pulse-indigo-text hover:underline">
                Open Track Studio
              </Link>
            }
          />
          {recent.length === 0 ? (
            <EmptyState
              icon={<Layers aria-hidden className="size-6" />}
              title="No Tracks yet"
              body="Create the first Track from a Playbook PDF."
              action={
                <Link href="/studio/new" className="pulse-btn pulse-btn-primary">
                  <Plus aria-hidden className="size-4" />
                  New Campaign Track
                </Link>
              }
            />
          ) : (
            <ul className="flex flex-col divide-y divide-pulse-border-subtle">
              {recent.map((track) => (
                <li key={track.id}>
                  <Link
                    href={`/studio/${encodeURIComponent(track.id)}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-pulse-sm px-1 py-2.5 hover:bg-pulse-surface-2/50"
                  >
                    <DivisionPill divisionId={track.divisionId} short />
                    <span className="min-w-0 flex-1 truncate font-medium">{track.title}</span>
                    <TrackStatusPill status={trackDisplayStatus(track)} />
                    <span className="pulse-metric w-20 text-right text-xs text-pulse-muted">{relativeTime(track.updatedAt, now)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="pulse-card flex min-w-0 flex-col gap-4 p-4 md:p-5 xl:col-span-2">
          <SectionHeader title="Top missed items" description="All Cohorts, first-try misses." />
          <MissedRulesTable rows={missed} trackTitles={trackTitles} trackCodes={trackCodes} linkToStudio />
        </section>
      </div>
    </div>
  );
}
