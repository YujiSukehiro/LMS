import type { Metadata } from 'next';
import { requirePageUser } from '@/lib/firebase/auth-guard';
import { buildHowToPage } from '@/lib/guides/how-to-data';
import { loadGuideMediaManifest } from '@/lib/guides/media-manifest.server';
import { HowToView } from '@/components/guide/HowToView';

export const metadata: Metadata = { title: 'How To' };
export const dynamic = 'force-dynamic';

/**
 * How To: the reader's own guide and video open at the top, the roles below theirs folded underneath, roles above
 * never sent. Deep links: /how-to?role=trainer#publish-assign[&play=1].
 */
export default async function HowToPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const param = Array.isArray(sp.role) ? sp.role[0] : sp.role;
  const data = buildHowToPage(user.role, param, await loadGuideMediaManifest());
  // key: a link to another role (?role=…) remounts the view with that role open.
  return <HowToView key={data.focus} uid={user.uid} blocks={data.blocks} focus={data.focus} />;
}
