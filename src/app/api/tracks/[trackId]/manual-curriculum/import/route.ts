/**
 * POST /api/tracks/[trackId]/manual-curriculum/import
 * Validate and atomically import one external Unit Builder result with manual_chat provenance.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { ManualExchangeValidationError } from '@/lib/ai/manual-exchange';
import { ManualCurriculumError, importManualCurriculumUnit } from '@/lib/ai/pipeline/manual-curriculum';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ImportRequestSchema = z
  .object({
    unitId: z.string().min(1).max(200),
    input: z.string().min(1).max(2_000_000),
    externalProvider: z.string().min(1).max(120),
    externalModel: z.string().min(1).max(120),
  })
  .strict();

export async function POST(req: Request, { params }: { params: Promise<{ trackId: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req, INTERNAL_OPS_ROLES);
  if (!auth.ok) return auth.response;
  const { trackId } = await params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return jsonError(400, 'VALIDATION_FAILED', 'The request body must be JSON.');
  }
  const parsed = ImportRequestSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return jsonError(400, 'VALIDATION_FAILED', `Check "${first?.path.join('.') || 'body'}": ${first?.message ?? 'invalid value'}.`);
  }

  try {
    const result = await importManualCurriculumUnit({ trackId, ...parsed.data, trainerUid: auth.user.uid });
    return NextResponse.json(
      {
        unitId: parsed.data.unitId,
        unit: result.commitResult.unit,
        provenance: result.provenance,
        provenancePath: result.commitResult.provenancePath,
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
    if (error instanceof ManualCurriculumError) return jsonError(error.status, error.code, error.message);
    return jsonError(500, 'MANUAL_IMPORT_FAILED', 'The manual curriculum import failed. Export a new package and try again.');
  }
}
