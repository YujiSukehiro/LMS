/**
 * GET /api/system/ai-health — internal ops: active LLMGateway provider and model readiness.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/firebase/auth-guard';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import type { AiHealthResponse } from '@/lib/schemas/api';
import { getActiveAiRuntime, getLLMGateway } from '@/lib/ai/gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req, INTERNAL_OPS_ROLES);
  if (!auth.ok) return auth.response;

  let body: AiHealthResponse;
  try {
    body = await getLLMGateway().healthCheck();
  } catch (error) {
    body = {
      ok: false,
      provider: getActiveAiRuntime().provider,
      models: [],
      error: error instanceof Error ? error.message : 'The AI health check failed.',
    };
  }
  return NextResponse.json(body, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
