/**
 * POST -> the AI sizing review for the Track's uploaded source (recommended Checkpoints and learner minutes, with a
 * reason). Runs the planning model once per source; later calls return the stored review. null when unavailable.
 */
import { NextResponse } from 'next/server';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { loadSourcePages, loadTrack } from '@/lib/ai/pipeline/track-store';
import { getSizingReview } from '@/lib/services/sizing-review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: Promise<{ trackId: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req, INTERNAL_OPS_ROLES);
  if (!auth.ok) return auth.response;
  const { trackId } = await params;
  const track = await loadTrack(trackId);
  if (!track) return jsonError(404, 'NOT_FOUND', 'This Track does not exist.');
  const pages = await loadSourcePages(trackId);
  if (pages.length === 0) return jsonError(409, 'NO_SOURCE_PAGES', 'This Track has no extracted Playbook pages yet.');
  const review = await getSizingReview(trackId, track.sizingReview, pages);
  return NextResponse.json({ trackId, review }, { headers: { 'Cache-Control': 'no-store' } });
}
