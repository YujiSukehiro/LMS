/**
 * POST /api/tracks/[trackId]/manual-curriculum/export
 * Export one trainer-authorized Unit Builder manual-chat package from approved persisted source pages.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { ManualCurriculumError, exportManualCurriculumUnit } from '@/lib/ai/pipeline/manual-curriculum';
import { SensitiveDataError } from '@/lib/security/synthetic-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ExportRequestSchema = z.object({ unitId: z.string().min(1).max(200) }).strict();

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
  const parsed = ExportRequestSchema.safeParse(json);
  if (!parsed.success) return jsonError(400, 'VALIDATION_FAILED', 'Select one Unit to export.');

  try {
    const result = await exportManualCurriculumUnit(trackId, parsed.data.unitId);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof ManualCurriculumError) return jsonError(error.status, error.code, error.message);
    if (error instanceof SensitiveDataError) {
      return jsonError(422, 'UNSAFE_CONTENT', 'The export contains content that is not permitted. Remove sensitive data from the source or draft and try again.');
    }
    return jsonError(500, 'MANUAL_EXPORT_FAILED', 'The manual curriculum package could not be exported. Check the draft and source pages, then try again.');
  }
}
