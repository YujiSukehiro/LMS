/**
 * POST /api/simulations/[sessionId]/manual-judge/import
 * Validate one external Judge result against its server-persisted package, then record evaluation.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ManualExchangeValidationError } from '@/lib/ai/manual-exchange';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { ServiceError } from '@/lib/services/errors';
import { importManualJudgeExchange } from '@/lib/services/manual-judge-exchange';
import { parseJsonBody } from '@/lib/services/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ImportRequestSchema = z
  .object({
    taskId: z.string().min(1).max(1500),
    input: z.string().min(1).max(2_000_000),
    externalProvider: z.string().min(1).max(120),
    externalModel: z.string().min(1).max(120),
  })
  .strict();

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth(req, INTERNAL_OPS_ROLES);
  if (!auth.ok) return auth.response;
  const { sessionId } = await params;
  const body = await parseJsonBody(req, ImportRequestSchema);
  if (!body.ok) return body.response;

  try {
    const result = await importManualJudgeExchange({ user: auth.user, sessionId, ...body.data });
    return NextResponse.json(
      {
        sessionId,
        taskId: body.data.taskId,
        evaluation: result.commitResult.evaluation,
        certified: result.commitResult.certified,
        demoReplay: result.commitResult.demoReplay,
        provenance: result.provenance,
        diff: result.diff,
        validationReport: result.validationReport,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof ManualExchangeValidationError) {
      return NextResponse.json(
        {
          error: 'MANUAL_IMPORT_INVALID',
          message: error.message,
          validationReport: error.validationReport,
          diff: error.diff,
        },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (error instanceof ServiceError) return jsonError(error.status, error.code, error.message);
    return jsonError(500, 'MANUAL_IMPORT_FAILED', 'The manual judge import failed. Export a new package and try again.');
  }
}
