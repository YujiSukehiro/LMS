/**
 * GET /api/system/ai-health — capability-specific runtime health for internal ops.
 *
 * Default: the cached cheap check (provider health + one basic chat), shared between concurrent callers and
 * cached ~60s on success / ~15s on failure, so TopBar mounts do not queue model calls ahead of real work.
 * `?full=1`: the full capability preflight (~10 model calls), never cached; it is cancelled if the client leaves.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/firebase/auth-guard';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import type { AiHealthResponse } from '@/lib/schemas/api';
import { getActiveAiRuntime } from '@/lib/ai/gateway';
import { getCachedAiHealth, runAiHealthCheck } from '@/lib/ai/availability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req, INTERNAL_OPS_ROLES);
  if (!auth.ok) return auth.response;

  const full = new URL(req.url).searchParams.get('full') === '1';
  try {
    const body = full
      ? await runAiHealthCheck({ full: true, signal: req.signal })
      : await getCachedAiHealth({ signal: req.signal });
    return NextResponse.json(body, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    let provider = 'unknown';
    let runtimeLabel: string | undefined;
    try {
      const info = getActiveAiRuntime();
      provider = info.provider;
      runtimeLabel = info.runtimeLabel;
    } catch {
      // An invalid AI_PROVIDER is reported through the error message below.
    }
    const body: AiHealthResponse = {
      ok: false,
      provider,
      models: [],
      status: 'blocked',
      runtimeLabel,
      error: req.signal.aborted
        ? 'The AI health check was cancelled.'
        : error instanceof Error ? error.message : 'The AI health check failed. Check the selected local runtime and retry.',
    };
    return NextResponse.json(body, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  }
}
