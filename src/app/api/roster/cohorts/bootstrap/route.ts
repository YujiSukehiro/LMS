import { NextResponse } from 'next/server';
import { rolesWith } from '@/lib/auth/rbac';
import { requireAuth } from '@/lib/firebase/auth-guard';
import { ensureDefaultCohortsSeeded } from '@/lib/services/cohort-bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req, rolesWith('cohorts.create'));
  if (!auth.ok) return auth.response;

  const result = await ensureDefaultCohortsSeeded();
  return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
}
