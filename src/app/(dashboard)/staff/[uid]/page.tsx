import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Award, ChartColumn, Clock, Headset, Zap } from 'lucide-react';
import { requirePageUser } from '@/lib/firebase/auth-guard';
import { can, rolesWith } from '@/lib/auth/rbac';
import { loadStaffPeople } from '@/lib/services/staff-directory';
import { loadEvaluatedSimSessionsForUser, loadUser } from '@/components/analytics/server-data';
import { EmptyState, KpiStrip, SectionHeader } from '@/components/analytics/KpiStrip';
import { PracticeLimitCard } from '@/components/analytics/PracticeLimitCard';
import { RevokeCertificationButton } from '@/components/analytics/RevokeCertificationButton';
import { ProgressStatusChip } from '@/components/progress/ProgressStatusChip';
import { ResetPasswordDialog } from '@/app/(dashboard)/roster/_components/ResetPasswordDialog';
import { visibleEmail } from '@/lib/services/staff-rules';
import { relativeTime } from '@/components/layout/labels';
import { SIM_COPY } from '@/lib/policy/training-policy';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Staff member' };
export const dynamic = 'force-dynamic';

const RECENT_PRACTICE = 8;

export default async function StaffPersonPage({ params }: { params: Promise<{ uid: string }> }) {
  const viewer = await requirePageUser(rolesWith('staff.view'));
  const { uid } = await params;
  const now = Date.now();
  // Same scope as the Staff list: someone outside it is "not found", never a leak.
  const [person] = await loadStaffPeople(viewer, { onlyUid: uid, now });
  if (!person) notFound();
  const [summary, sessions] = await Promise.all([loadUser(uid), loadEvaluatedSimSessionsForUser(uid, RECENT_PRACTICE)]);
  const trackTitles = new Map(person.trainings.map((t) => [t.trackId, t.title]));
  const recent = sessions.filter((s) => s.versionId !== 'draft');
  const certifiedCount = person.trainings.filter((t) => t.cell.stage === 'certified').length;
  const email = visibleEmail(person.email);
  const canRevoke = can(viewer.role, 'certifications.manage');

  return (
    <div className="flex flex-col gap-5">
      <Link href="/staff" className="inline-flex w-fit items-center gap-1.5 text-sm text-pulse-muted hover:text-pulse-primary">
        <ArrowLeft aria-hidden className="size-4" />
        Staff
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="pulse-label">{person.roleLabel}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{person.displayName}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-pulse-muted">
            <span>{person.cohortLabel}</span>
            {person.lcNumber ? <span className="pulse-metric">· {person.lcNumber}</span> : null}
            {email ? <span>· {email}</span> : null}
            {!person.active ? <span className="pulse-pill pulse-pill-crimson">Deactivated</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {person.canResetPassword ? (
            <span className="flex items-center gap-2 text-sm text-pulse-secondary">
              Reset password
              <ResetPasswordDialog uid={person.uid} displayName={person.displayName} loginIdentifier={person.lcNumber ?? person.email ?? person.uid} />
            </span>
          ) : null}
          <Link href={`/analytics/agents/${encodeURIComponent(person.uid)}`} className="pulse-btn">
            <ChartColumn aria-hidden className="size-4" />
            Detailed analytics
          </Link>
        </div>
      </header>

      <PracticeLimitCard
        uid={person.uid}
        displayName={person.displayName}
        counted={person.practiceCounted}
        limit={person.practiceLimit}
        canReset={person.canResetPractice}
        resetToday={person.practiceResetToday}
      />

      <KpiStrip
        items={[
          {
            label: 'Trainings certified',
            value: `${certifiedCount} of ${person.trainings.length}`,
            icon: <Award aria-hidden className="size-3.5" />,
            tone: person.trainings.length > 0 && certifiedCount === person.trainings.length ? 'emerald' : 'default',
          },
          {
            label: 'Last active',
            value: person.lastActivityAt ? relativeTime(person.lastActivityAt, now) : 'Not yet',
            icon: <Clock aria-hidden className="size-3.5" />,
            tone: person.flags.stuck ? 'amber' : 'default',
          },
          { label: 'Total XP', value: (summary?.stats.totalXp ?? 0).toLocaleString('en-US'), icon: <Zap aria-hidden className="size-3.5" />, tone: 'indigo' },
          {
            label: `${SIM_COPY.short} passed`,
            value: String(summary?.stats.simulationsPassedCount ?? 0),
            icon: <Headset aria-hidden className="size-3.5" />,
          },
        ]}
      />

      <section className="pulse-card flex flex-col gap-3 p-4 md:p-5">
        <SectionHeader title="Trainings" description="Every training on their My Trainings list." />
        {person.trainings.length === 0 ? (
          <EmptyState title="No trainings assigned" body="Assign trainings from Track Studio or the Roster Cohort Trainings dialog." />
        ) : (
          <ul className="flex flex-col divide-y divide-pulse-border">
            {person.trainings.map((t) => (
              <li key={t.trackId} className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:gap-4">
                <div className="min-w-0 md:w-72 md:shrink-0">
                  <p className="font-semibold">{t.title}</p>
                  {t.cell.nextStep ? <p className="text-xs text-pulse-muted">Next: {t.cell.nextStep}</p> : null}
                  {t.cell.flag ? (
                    <p className={cn('text-xs', t.cell.flag.tone === 'danger' ? 'text-pulse-crimson' : t.cell.flag.tone === 'warning' ? 'text-pulse-amber' : 'text-pulse-muted')}>
                      {t.cell.flag.text}
                    </p>
                  ) : null}
                </div>
                <div className="md:w-44">
                  <ProgressStatusChip cell={t.cell} />
                </div>
                <dl className="grid flex-1 grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-pulse-muted">Checkpoints</dt>
                    <dd className="pulse-metric font-semibold">{t.cell.unitsDoneCount} of {t.cell.unitsDone.length}</dd>
                  </div>
                  <div>
                    <dt className="text-pulse-muted">First-try</dt>
                    <dd className="pulse-metric font-semibold">{t.cell.firstTryPct !== null ? `${t.cell.firstTryPct}%` : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-pulse-muted">Best {SIM_COPY.short.toLowerCase()}</dt>
                    <dd className="pulse-metric font-semibold">{t.cell.bestSimPct !== null ? `${Math.round(t.cell.bestSimPct)}%` : '—'}</dd>
                  </div>
                </dl>
                {canRevoke && t.cell.stage === 'certified' ? (
                  <RevokeCertificationButton learnerId={person.uid} trackId={t.trackId} trackTitle={t.title} learnerName={person.displayName} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="pulse-card flex flex-col gap-3 p-4 md:p-5">
        <SectionHeader title={`Recent ${SIM_COPY.singular}`} description={`Their last ${RECENT_PRACTICE} graded calls.`} />
        {recent.length === 0 ? (
          <p className="text-sm text-pulse-muted">No graded practice calls yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-pulse-muted">
                  <th className="py-1.5 pr-3 font-medium">When</th>
                  <th className="py-1.5 pr-3 font-medium">Training</th>
                  <th className="py-1.5 pr-3 font-medium">Practice</th>
                  <th className="py-1.5 pr-3 font-medium">Replies</th>
                  <th className="py-1.5 font-medium">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-pulse-border">
                {recent.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2 pr-3 text-pulse-muted">{relativeTime(s.startedAt, now)}</td>
                    <td className="py-2 pr-3">{trackTitles.get(s.trackId) ?? s.trackId}</td>
                    <td className="py-2 pr-3">{s.scenarioTitle ?? s.scenarioId}</td>
                    <td className="pulse-metric py-2 pr-3">{s.turnCount}</td>
                    <td className={cn('pulse-metric py-2 font-semibold', s.evaluation?.passed ? 'text-pulse-emerald' : 'text-pulse-amber')}>
                      {s.evaluation ? `${Math.round(s.evaluation.overallScorePct)}% ${s.evaluation.passed ? 'passed' : 'not passed'}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-pulse-muted">Transcripts and skill charts are in Detailed analytics.</p>
      </section>
    </div>
  );
}
