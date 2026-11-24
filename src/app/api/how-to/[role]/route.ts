/**
 * GET /api/how-to/<agent|supervisor|trainer|admin> — one guide's content for the How To page, loaded when a reader
 * expands a lower role's section. Readers get their own role and the roles below it; anything above is 403.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/firebase/auth-guard';
import { buildRoleContent, canReadGuide } from '@/lib/guides/how-to-data';
import { loadGuideMediaManifest } from '@/lib/guides/media-manifest.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ role: string }> }): Promise<Response> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const guideRole = (await params).role.toUpperCase();
  if (!canReadGuide(auth.user.role, guideRole)) {
    return NextResponse.json({ code: 'FORBIDDEN', message: 'This guide is for a role above yours.' }, { status: 403 });
  }
  const content = buildRoleContent(guideRole, auth.user.role, await loadGuideMediaManifest());
  return NextResponse.json(content, { headers: { 'Cache-Control': 'private, no-store' } });
}
