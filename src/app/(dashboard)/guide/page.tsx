import type { Metadata } from 'next';
import { requirePageUser } from '@/lib/firebase/auth-guard';
import { resolveGuideRole, visibleGuideRoles } from '@/lib/guides/access';
import { GuideView } from '@/components/guide/GuideView';

export const metadata: Metadata = { title: 'Guide' };
export const dynamic = 'force-dynamic';

/** "How to use LogiCall Pulse": every signed-in user, own role's guide first, plus the roles they manage. */
export default async function GuidePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const param = Array.isArray(sp.role) ? sp.role[0] : sp.role;
  const initialRole = resolveGuideRole(user.role, param);
  // key: a link to another tab (?role=…) remounts the view on that tab.
  return <GuideView key={initialRole} uid={user.uid} roles={visibleGuideRoles(user.role)} initialRole={initialRole} />;
}
