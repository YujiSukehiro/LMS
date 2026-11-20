import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/firebase/auth-guard';
import { ROSTER_ADMIN_ROLES } from '@/lib/schemas/constants';
import { ensureDefaultCohortsSeeded } from '@/lib/services/cohort-bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req, ROSTER_ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const result = await ensureDefaultCohortsSeeded();
  return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
}
