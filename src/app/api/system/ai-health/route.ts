/** GET /api/system/ai-health — capability-specific runtime health for internal ops. */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/firebase/auth-guard';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import type { AiHealthResponse } from '@/lib/schemas/api';
import { activeProviderName, getActiveAiRuntime, getLLMGateway } from '@/lib/ai/gateway';
import { createLocalRuntimeProfile, openAICompatibleProfileFromEnv } from '@/lib/ai/local-runtime';
import { runLocalCapabilityPreflight } from '@/lib/ai/local-preflight';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req, INTERNAL_OPS_ROLES);
  if (!auth.ok) return auth.response;

  const provider = activeProviderName();
  const runtimeInfo = getActiveAiRuntime();
  if (provider === 'manual_chat') {
    return NextResponse.json({
      ok: true,
      provider,
      models: [],
      status: 'manual',
      runtimeLabel: 'Manual chat',
      capabilities: [],
    } satisfies AiHealthResponse);
  }

  try {
    if (provider === 'openai_compatible' || provider === 'ollama') {
      const gateway = getLLMGateway();
      const profile = provider === 'openai_compatible'
        ? openAICompatibleProfileFromEnv()
        : createLocalRuntimeProfile({
            provider: 'ollama',
            runtimeLabel: 'Ollama',
            baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
            models: { structuredGeneration: runtimeInfo.heavyModel, streamingChat: runtimeInfo.fastModel, judge: runtimeInfo.heavyModel },
          });
      const report = await runLocalCapabilityPreflight(profile, gateway);
      const body: AiHealthResponse = {
        ok: report.status === 'ready',
        provider: report.provider,
        models: [...new Set(Object.values(report.selectedModels).filter((model): model is string => Boolean(model)))],
        status: report.status,
        runtimeLabel: report.runtimeLabel,
        capabilities: report.capabilities,
        error: report.capabilities.find((capability) => capability.status === 'failed')?.error,
      };
      return NextResponse.json(body, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    }

    const health = await getLLMGateway().healthCheck();
    const body: AiHealthResponse = {
      ...health,
      status: provider === 'replay' ? 'demo' : health.ok ? 'ready' : 'blocked',
      runtimeLabel: provider === 'replay' ? 'Demo replay' : 'Gemini',
    };
    return NextResponse.json(body, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const body: AiHealthResponse = {
      ok: false,
      provider: runtimeInfo.provider,
      models: [],
      status: 'blocked',
      runtimeLabel: runtimeInfo.runtimeLabel,
      error: error instanceof Error ? error.message : 'The AI health check failed. Check the selected local runtime and retry.',
    };
    return NextResponse.json(body, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  }
}
