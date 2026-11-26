import type { Metadata } from 'next';
import { requirePageUser } from '@/lib/firebase/auth-guard';
import { rolesWith } from '@/lib/auth/rbac';
import { loadStaffPeople } from '@/lib/services/staff-directory';
import { parseStaffFilter } from '@/lib/services/staff-rules';
import { StaffDirectory } from '@/components/staff/StaffDirectory';
import { cohortLabel } from '@/components/layout/labels';

export const metadata: Metadata = { title: 'Staff' };
export const dynamic = 'force-dynamic';

export default async function StaffPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requirePageUser(rolesWith('staff.view'));
  const sp = await searchParams;
  const rawFilter = Array.isArray(sp.filter) ? sp.filter[0] : sp.filter;
  const now = Date.now();
  const people = await loadStaffPeople(viewer, { now });
  const scope =
    viewer.role === 'PARTNER_SUPERVISOR'
      ? `The agents in ${cohortLabel(viewer.partnerCohortId)}.`
      : viewer.role === 'SUPER_ADMIN'
        ? 'Everyone in Pulse.'
        : 'Everyone in a role below yours, in every Cohort.';

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="pulse-label">People you look after</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Staff</h1>
        <p className="mt-1 text-sm text-pulse-muted">
          {scope} Open a person to see their trainings and practice, reset today&apos;s practice count or reset their password.
        </p>
      </header>
      <StaffDirectory people={people} initialFilter={parseStaffFilter(rawFilter)} now={now} />
    </div>
  );
}
