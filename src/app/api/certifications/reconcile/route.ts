import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/firebase/auth-guard';
import { ReconcileCertificationRequestSchema, type ReconcileCertificationResponseSchema } from '@/lib/schemas/api';
import type { z } from 'zod';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { reconcileLearnerCertification } from '@/lib/services/certification-commands';
import { errorResponse, parseJsonBody } from '@/lib/services/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req, INTERNAL_OPS_ROLES);
  if (!auth.ok) return auth.response;
  const body = await parseJsonBody(req, ReconcileCertificationRequestSchema);
  if (!body.ok) return body.response;
  try {
    const result = await reconcileLearnerCertification({
      actor: auth.user,
      ...body.data,
    });
    const response: z.infer<typeof ReconcileCertificationResponseSchema> = result;
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error, 'certifications/reconcile');
  }
}
