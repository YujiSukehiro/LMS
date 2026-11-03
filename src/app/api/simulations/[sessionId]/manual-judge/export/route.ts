/**
 * POST /api/simulations/[sessionId]/manual-judge/export
 * Persist and return one trainer-only package for the shared Simulation Judge.
 */
import { NextResponse } from 'next/server';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { SensitiveDataError } from '@/lib/security/synthetic-data';
import { ServiceError } from '@/lib/services/errors';
import { exportManualJudgeExchange } from '@/lib/services/manual-judge-exchange';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth(req, INTERNAL_OPS_ROLES);
  if (!auth.ok) return auth.response;
  const { sessionId } = await params;

  try {
    const result = await exportManualJudgeExchange({ user: auth.user, sessionId });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof ServiceError) return jsonError(error.status, error.code, error.message);
    if (error instanceof SensitiveDataError) {
      return jsonError(422, 'UNSAFE_CONTENT', 'The judge package contains content that is not permitted. Remove sensitive data and try again.');
    }
    return jsonError(500, 'MANUAL_EXPORT_FAILED', 'The manual judge package could not be exported. Check the Simulation and try again.');
  }
}
