/**
 * Content map for a Track before the AI build.
 * GET  -> measured source depth: rules per page, recommended checkpoint range, page warnings.
 * POST -> { unitTarget: number | null } saves the trainer's checkpoint target for the next build.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { sourcePageExtractionFlags } from '@/lib/ai/pdf-extractor';
import { DEPTH_LIMITS, estimateTrackMinutes, measureSourceDepth } from '@/lib/ai/pipeline/content-depth';
import { isGenerationRunning, loadSourcePages, loadTrack, trackRef } from '@/lib/ai/pipeline/track-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ trackId: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req, INTERNAL_OPS_ROLES);
  if (!auth.ok) return auth.response;
  const { trackId } = await params;
  const track = await loadTrack(trackId);
  if (!track) return jsonError(404, 'NOT_FOUND', 'This Track does not exist.');
  const pages = await loadSourcePages(trackId);
  if (pages.length === 0) return jsonError(409, 'NO_SOURCE_PAGES', 'This Track has no extracted Playbook pages yet.');

  const depth = measureSourceDepth(pages);
  const pageRows = depth.pages.map((page, index) => {
    const flags = sourcePageExtractionFlags(pages[index]);
    return {
      pageNumber: page.pageNumber,
      words: page.words,
      ruleSignals: page.ruleSignals,
      needsTranscription: flags.includes('manual_transcription_required'),
    };
  });
  return NextResponse.json(
    {
      trackId,
      title: track.title,
      fileName: track.sourcePdfFileName,
      pageCount: pages.length,
      words: depth.words,
      ruleSignals: depth.ruleSignals,
      headings: depth.headings,
      operationalPages: depth.operationalPages,
      recommended: depth.units,
      limits: { min: DEPTH_LIMITS.minUnits, max: DEPTH_LIMITS.maxUnits },
      unitTarget: track.unitTarget ?? null,
      estimatedMinutesByTarget: Object.fromEntries(
        Array.from({ length: DEPTH_LIMITS.maxUnits - DEPTH_LIMITS.minUnits + 1 }, (_, i) => {
          const units = DEPTH_LIMITS.minUnits + i;
          return [units, estimateTrackMinutes(units, depth.ruleSignals)];
        }),
      ),
      pages: pageRows,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

const BodySchema = z.object({
  unitTarget: z.number().int().min(DEPTH_LIMITS.minUnits).max(DEPTH_LIMITS.maxUnits).nullable(),
});

export async function POST(req: Request, { params }: { params: Promise<{ trackId: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req, INTERNAL_OPS_ROLES);
  if (!auth.ok) return auth.response;
  const { trackId } = await params;
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(400, 'INVALID_BODY', `Send { "unitTarget": a number from ${DEPTH_LIMITS.minUnits} to ${DEPTH_LIMITS.maxUnits}, or null }.`);
  }
  const track = await loadTrack(trackId);
  if (!track) return jsonError(404, 'NOT_FOUND', 'This Track does not exist.');
  if (isGenerationRunning(track)) return jsonError(409, 'GENERATION_RUNNING', 'A build is running for this Track. Wait for it to finish.');
  await trackRef(trackId).update({ unitTarget: parsed.data.unitTarget, updatedAt: Date.now() });
  return NextResponse.json({ trackId, unitTarget: parsed.data.unitTarget });
}
