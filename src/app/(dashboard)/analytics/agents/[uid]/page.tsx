import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { learnerSession } from '@/lib/services/learner-views';
import { ArrowLeft, Award, Flame, Gauge, Headset, MessageSquare, Zap } from 'lucide-react';
import { isInternalOps, requirePageUser } from '@/lib/firebase/auth-guard';
import { RADAR_PILLAR_KEYS } from '@/lib/schemas/constants';
import {
  loadEnrollmentsForUser,
  loadEvaluatedSimSessionsForUser,
  loadUser,
} from '@/components/analytics/server-data';
import { SkillRadarSvg } from '@/components/analytics/SkillRadarSvg';
import { LearningAnalyticsPanel } from '@/components/analytics/LearningAnalyticsPanel';
import { SimTranscriptDetails } from '@/components/analytics/SimTranscriptDetails';
import { ServiceError } from '@/lib/services/errors';
import { loadLearningEvidenceForUser, type LearningEvidenceView } from '@/lib/services/learning-evidence';
import { EmptyState, KpiStrip, SectionHeader } from '@/components/analytics/KpiStrip';
import { BAND_TEXT_CLASS, bandFor, formatPct } from '@/components/analytics/strength';
import { DivisionPill } from '@/components/layout/DivisionPill';
import { CohortBadge } from '@/components/layout/CohortBadge';
import { formatDate, pillarLabel } from '@/components/layout/labels';
import { cn } from '@/lib/utils';
import { canManageUser } from '@/lib/auth/rbac';
import { ResetPasswordDialog } from '@/app/(dashboard)/roster/_components/ResetPasswordDialog';
import { SIM_COPY } from '@/lib/policy/training-policy';

export const metadata: Metadata = { title: 'Agent Learning Evidence' };
export const dynamic = 'force-dynamic';

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export default async function AgentPassportPage({ params }: { params: Promise<{ uid: string }> }) {
  const viewer = await requirePageUser();
  const { uid } = await params;
  const agent = await loadUser(uid);
  if (!agent) notFound();

  // Access: internal ops; PARTNER_SUPERVISOR only for their own Cohort; AGENT only for self.
  const allowed =
    isInternalOps(viewer) ||
    (viewer.role === 'PARTNER_SUPERVISOR' && agent.partnerCohortId === viewer.partnerCohortId) ||
    (viewer.role === 'AGENT' && viewer.uid === agent.uid);
  if (!allowed) notFound();

  const [enrollments, sessions] = await Promise.all([
    loadEnrollmentsForUser(agent.uid),
    loadEvaluatedSimSessionsForUser(agent.uid, 25),
  ]);
  // Partner supervisors and the agent see transcripts and scorecards without trainer-only gate detail.
  const learnerSessions = isInternalOps(viewer) ? sessions : sessions.filter((s) => s.versionId !== 'draft').map(learnerSession);
  const learningEvidence = (await Promise.all(enrollments.map(async (enrollment): Promise<LearningEvidenceView | null> => {
    try {
      return await loadLearningEvidenceForUser({ user: viewer, learnerId: agent.uid, trackId: enrollment.trackId });
    } catch (error) {
      if (error instanceof ServiceError && error.code === 'ASSESSMENT_BLUEPRINT_MISSING') return null;
      // A Track no longer assigned to this learner (Cohort or Division changed): history stays in the tables below.
      if (error instanceof ServiceError && error.code === 'TRACK_NOT_FOUND') return null;
      throw error;
    }
  }))).filter((view): view is LearningEvidenceView => view !== null);
  const certified = enrollments
    .filter((e) => e.status === 'CERTIFIED' && e.certificationEvidenceLabel === 'current_verified')
    .sort((a, b) => (b.certifiedAt ?? 0) - (a.certifiedAt ?? 0));
  const legacyCertifiedCount = enrollments.filter((e) => e.status === 'CERTIFIED' && e.certificationEvidenceLabel !== 'current_verified').length;
  const trackTitles = new Map(enrollments.map((e) => [e.trackId, e.trackTitle]));

  const radarValues = RADAR_PILLAR_KEYS.map((key) => {
    const stat = agent.skillScoresByPillar[key];
    return { key, value: stat && stat.attempts > 0 ? stat.averageScore : null };
  });
  const otherPillars = Object.values(agent.skillScoresByPillar).filter(
    (stat) => !RADAR_PILLAR_KEYS.includes(stat.pillarKey as (typeof RADAR_PILLAR_KEYS)[number]) && stat.attempts > 0,
  );

  const comparison = enrollments
    .map((e) => {
      const unitAccuracies = Object.values(e.unitScores).map((s) => s.firstTryAccuracyPct);
      return {
        trackId: e.trackId,
        title: e.trackTitle,
        divisionId: e.divisionId,
        drillAccuracy: mean(unitAccuracies),
        simScore: e.bestSimScorePct,
        status: e.status,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));

  const backHref = viewer.role === 'AGENT' ? '/' : '/analytics';

  return (
    <div className="flex flex-col gap-5">
      <Link href={backHref} className="inline-flex w-fit items-center gap-1.5 text-sm text-pulse-muted hover:text-pulse-primary">
        <ArrowLeft aria-hidden className="size-4" />
        {viewer.role === 'AGENT' ? 'My Tracks' : 'Analytics'}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="pulse-label">Agent Learning Evidence</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{agent.displayName}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {agent.lcNumber ? <span className="pulse-pill pulse-metric">{agent.lcNumber}</span> : null}
            <CohortBadge cohortId={agent.partnerCohortId} />
            {agent.divisionIds.map((d) => (
              <DivisionPill key={d} divisionId={d} short />
            ))}
            {agent.active ? null : <span className="pulse-pill pulse-pill-crimson">Inactive</span>}
          </div>
        </div>
        {canManageUser(viewer, agent, 'users.resetPassword') ? (
          <div className="flex items-center gap-2 text-sm text-pulse-secondary">
            Reset password
            <ResetPasswordDialog uid={agent.uid} displayName={agent.displayName} loginIdentifier={agent.lcNumber ?? agent.email} />
          </div>
        ) : null}
      </header>

      <KpiStrip
        items={[
          { label: 'Current evidence', value: `${learningEvidence.length} Track${learningEvidence.length === 1 ? '' : 's'}`, icon: <Gauge aria-hidden className="size-3.5" />, tone: 'indigo' },
          { label: 'Total XP', value: agent.stats.totalXp.toLocaleString('en-US'), icon: <Zap aria-hidden className="size-3.5" />, tone: 'indigo' },
          {
            label: 'Streak',
            value: `${agent.stats.currentStreakDays} day${agent.stats.currentStreakDays === 1 ? '' : 's'}`,
            icon: <Flame aria-hidden className="size-3.5 text-pulse-amber" />,
            tone: agent.stats.currentStreakDays > 0 ? 'amber' : 'default',
          },
          {
            label: 'Sims Passed',
            value: String(agent.stats.simulationsPassedCount),
            icon: <Headset aria-hidden className="size-3.5" />,
          },
        ]}
      />

      {legacyCertifiedCount > 0 ? (
        <p role="note" className="rounded-pulse-md border border-pulse-amber/40 bg-pulse-amber/10 px-4 py-3 text-sm text-pulse-secondary">
          {legacyCertifiedCount} older certification{legacyCertifiedCount === 1 ? ' is' : 's are'} marked
          <strong> historical, unverified</strong> and {legacyCertifiedCount === 1 ? 'does' : 'do'} not count as a current certification.
        </p>
      ) : null}
      {learningEvidence.map((view) => (
        <LearningAnalyticsPanel
          key={view.analytics.trackId}
          analytics={view.analytics}
          title={`${trackTitles.get(view.analytics.trackId) ?? view.analytics.trackId} · current evidence`}
        />
      ))}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <section className="pulse-card flex flex-col gap-3 p-4 md:p-5">
          <SectionHeader title="Skill Radar" description={`Average score per skill across Drills and ${SIM_COPY.plural}.`} />
          <div className="flex justify-center">
            <SkillRadarSvg values={radarValues} agentName={agent.displayName} />
          </div>
          {otherPillars.length > 0 ? (
            <ul className="flex flex-wrap gap-2 text-xs">
              {otherPillars.map((stat) => (
                <li key={stat.pillarKey} className="pulse-pill">
                  {pillarLabel(stat.pillarKey)}
                  <span className={cn('pulse-metric font-semibold', BAND_TEXT_CLASS[bandFor(stat.averageScore)])}>
                    {formatPct(stat.averageScore)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <div className="flex flex-col gap-5">
          <section className="pulse-card flex flex-col gap-3 p-4 md:p-5">
            <SectionHeader title="Campaign Certifications" />
            {certified.length === 0 ? (
              <p className="text-sm text-pulse-muted">No certified Tracks yet.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {certified.map((e) => (
                  <li
                    key={e.trackId}
                    className="flex items-center gap-2 rounded-pulse-md border border-pulse-emerald/40 bg-pulse-emerald/10 px-3 py-2"
                  >
                    <Award aria-hidden className="size-5 text-pulse-emerald" />
                    <span>
                      <span className="block text-sm font-semibold">{e.trackTitle}</span>
                      <span className="pulse-metric block text-[0.7rem] text-pulse-muted">
                        {e.certifiedAt ? `Certified ${formatDate(e.certifiedAt)}` : 'Certified'}
                        {e.bestSimScorePct !== null ? ` · ${Math.round(e.bestSimScorePct)}%` : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="pulse-card flex flex-col gap-3 p-4 md:p-5">
            <SectionHeader
              title={`First-try Drill accuracy vs. ${SIM_COPY.singular} score`}
              description="A large gap shows knowledge that the agent does not yet apply on a call."
            />
            {comparison.length === 0 ? (
              <p className="text-sm text-pulse-muted">No Track activity yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {comparison.map((row) => (
                  <li key={row.trackId} className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <DivisionPill divisionId={row.divisionId} short />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.title}</span>
                    </div>
                    <ComparisonBar label="Drills (first try)" value={row.drillAccuracy} />
                    <ComparisonBar label={`${SIM_COPY.singular} (best)`} value={row.simScore} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <SectionHeader title={`${SIM_COPY.singular} transcripts`} description="Select a session to read the transcript and the scorecard." />
        {learnerSessions.length === 0 ? (
          <EmptyState icon={<MessageSquare aria-hidden className="size-6" />} title={`No graded ${SIM_COPY.plural} yet`} />
        ) : (
          <div className="flex flex-col gap-2">
            {learnerSessions.map((session) => (
              <SimTranscriptDetails
                key={session.id}
                session={session}
                trackTitle={trackTitles.get(session.trackId) ?? session.trackId}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ComparisonBar({ label, value }: { label: string; value: number | null }) {
  const band = bandFor(value);
  const fill =
    band === 'strong' ? 'bg-pulse-emerald' : band === 'borderline' ? 'bg-pulse-amber' : band === 'weak' ? 'bg-pulse-crimson' : 'bg-transparent';
  return (
    <div className="grid grid-cols-[9.5rem_minmax(0,1fr)_3rem] items-center gap-2 text-xs">
      <span className="text-pulse-muted">{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-pulse-surface-2">
        <div className={cn('h-full rounded-full', fill)} style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
      </div>
      <span className={cn('pulse-metric text-right font-semibold', BAND_TEXT_CLASS[band])}>{formatPct(value)}</span>
    </div>
  );
}
