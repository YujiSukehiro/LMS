import type { Metadata } from 'next';
import { requirePageUser } from '@/lib/firebase/auth-guard';
import { resolveGuideRole, visibleGuideRoles } from '@/lib/guides/access';
import { guideMediaBaseUrl } from '@/lib/guides/media';
import { loadGuideMediaManifest } from '@/lib/guides/media-manifest.server';
import { HowToView } from '@/components/guide/HowToView';

export const metadata: Metadata = { title: 'How To' };
export const dynamic = 'force-dynamic';

/**
 * How To: every signed-in user, own role's guide first plus the roles they manage, with a click-to-play video per
 * role and screenshots per section when media is published. Deep links: /how-to?role=trainer#publish-assign[&play=1].
 */
export default async function HowToPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const param = Array.isArray(sp.role) ? sp.role[0] : sp.role;
  const initialRole = resolveGuideRole(user.role, param);
  const manifest = await loadGuideMediaManifest();
  // key: a link to another tab (?role=…) remounts the view on that tab.
  return (
    <HowToView
      key={initialRole}
      uid={user.uid}
      roles={visibleGuideRoles(user.role)}
      initialRole={initialRole}
      manifest={manifest}
      mediaBase={guideMediaBaseUrl()}
    />
  );
}
