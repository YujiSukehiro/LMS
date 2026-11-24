import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { SessionUser } from '@/lib/schemas/domain';
import { requirePageUser } from '@/lib/firebase/auth-guard';
import { AgentHome } from '@/components/layout/home/AgentHome';
import { SupervisorHome } from '@/components/layout/home/SupervisorHome';
import { TrainerHome } from '@/components/layout/home/TrainerHome';
import { AdminHome } from '@/components/layout/home/AdminHome';
import { GuideBanner } from '@/components/guide/GuideBanner';
import { GUIDE_BANNER_COOKIE, shouldShowGuideBanner } from '@/components/guide/guide-banner-cookie';
import { GUIDES } from '@/lib/guides';
import { guideRoleFor } from '@/lib/guides/access';

export const metadata: Metadata = { title: 'Home' };
export const dynamic = 'force-dynamic';

export default async function DashboardHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const seen = (await cookies()).get(GUIDE_BANNER_COOKIE)?.value;
  const banner = shouldShowGuideBanner(seen ? decodeURIComponent(seen) : undefined, user.uid) ? (
    <GuideBanner uid={user.uid} roleLabel={GUIDES[guideRoleFor(user.role)].label} />
  ) : null;
  return (
    <>
      {banner}
      <RoleHome user={user} showOffboarded={sp.offboarded === '1'} />
    </>
  );
}

function RoleHome({ user, showOffboarded }: { user: SessionUser; showOffboarded: boolean }) {
  switch (user.role) {
    case 'AGENT':
      return <AgentHome user={user} />;
    case 'PARTNER_SUPERVISOR':
      return <SupervisorHome user={user} showOffboarded={showOffboarded} />;
    case 'TRAINER':
      return <TrainerHome user={user} />;
    case 'ADMIN':
    case 'SUPER_ADMIN':
      return <AdminHome user={user} />;
  }
}
