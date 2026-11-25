import type { Metadata } from 'next';
import Link from 'next/link';
import { Award, Brain, GraduationCap, Layers, ListTodo } from 'lucide-react';
import { requirePageUser } from '@/lib/firebase/auth-guard';
import { STAFF_ROLES } from '@/lib/auth/rbac';
import { EmptyState, KpiStrip, SectionHeader } from '@/components/analytics/KpiStrip';
import { AssignedTrackCard } from '@/components/learn/AssignedTrackCard';
import { loadMyTrainings } from '@/components/learn/my-trainings-data';

export const metadata: Metadata = { title: 'My Trainings' };
export const dynamic = 'force-dynamic';

/** Every role's own assigned trainings: Every Cohort, the user's Cohorts, or assigned to them by name. */
export default async function MyTrainingsPage() {
  const user = await requirePageUser();
  const { tracks, enrollmentByTrack, openCount, certifiedCount } = await loadMyTrainings(user);
  const staff = STAFF_ROLES.includes(user.role);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="pulse-label">Your own training</p>
          <h1 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">My Trainings</h1>
          <p className="mt-0.5 text-sm text-pulse-muted">
            Trainings assigned to you through Every Cohort, your Cohort, or by name. Your progress and certifications are
            recorded like any learner&apos;s.
          </p>
        </div>
        <Link href="/learn/review" className="pulse-btn text-sm">
          <Brain aria-hidden className="size-4" />
          Keep-Sharp Review
        </Link>
      </div>

      <KpiStrip
        items={[
          { label: 'Assigned to you', value: String(tracks.length), icon: <Layers aria-hidden className="size-3.5" /> },
          {
            label: 'To finish',
            value: String(openCount),
            icon: <ListTodo aria-hidden className="size-3.5" />,
            tone: openCount > 0 ? 'amber' : 'default',
          },
          {
            label: 'Certified',
            value: `${certifiedCount} / ${tracks.length}`,
            icon: <Award aria-hidden className="size-3.5" />,
            tone: certifiedCount > 0 ? 'emerald' : 'default',
          },
        ]}
      />

      <section className="flex flex-col gap-3">
        <SectionHeader title="Assigned to you" description="Started trainings come first, then new ones, then certified ones." />
        {tracks.length === 0 ? (
          <EmptyState
            icon={<GraduationCap aria-hidden className="size-6" />}
            title="Nothing is assigned to you yet"
            body={
              staff
                ? 'Trainings published to Every Cohort, to your internal Cohort, or to you by name show here. Track Studio test-play does not count toward your own completion.'
                : 'When a trainer assigns a training to your Cohort or to you, it shows here.'
            }
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {tracks.map((track) => (
              <li key={track.id}>
                <AssignedTrackCard track={track} enrollment={enrollmentByTrack.get(track.id) ?? null} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
