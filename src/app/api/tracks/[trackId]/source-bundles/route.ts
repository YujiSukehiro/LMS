/** List preserved source revisions so trainers can select or audit a bundle without changing published versions. */
import { NextResponse } from 'next/server';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { SourceBundleSchema } from '@/lib/schemas/source-truth';
import { loadTrack } from '@/lib/ai/pipeline/track-store';
import { sourceBundlesCollection } from '@/lib/services/source-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ trackId: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req, INTERNAL_OPS_ROLES);
  if (!auth.ok) return auth.response;
  const { trackId } = await params;
  const track = await loadTrack(trackId);
  if (!track) return jsonError(404, 'NOT_FOUND', 'This Track does not exist.');
  const snapshot = await sourceBundlesCollection(trackId).get();
  const bundles = snapshot.docs
    .map((document) => SourceBundleSchema.parse(document.data()))
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
  return NextResponse.json(
    { activeSourceBundleId: track.activeSourceBundleId ?? null, bundles },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
