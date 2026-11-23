'use client';

import { useEffect, useState } from 'react';
import { Cpu } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AiHealthResponse } from '@/lib/schemas/api';
import type { UserRole } from '@/lib/schemas/domain';
import { shouldCheckAiHealth } from './ai-runtime';

export interface AiRuntimeInfo {
  provider: 'ollama' | 'gemini' | 'openai_compatible' | 'manual_chat' | 'replay';
  heavyModel: string;
  fastModel: string;
  runtimeLabel?: string;
}

const PROVIDER_LABELS: Record<AiRuntimeInfo['provider'], string> = {
  ollama: 'Ollama',
  gemini: 'Gemini',
  openai_compatible: 'Local AI',
  manual_chat: 'Manual chat',
  replay: 'Demo replay',
};

/** Shows the honest runtime mode and, for internal ops, its latest capability status. */
export function AiRuntimePill({ runtime, role, className }: { runtime: AiRuntimeInfo; role?: UserRole; className?: string }) {
  const [health, setHealth] = useState<AiHealthResponse | null>(null);
  const checkHealth = shouldCheckAiHealth(runtime.provider, role);

  useEffect(() => {
    if (!checkHealth) return;
    const controller = new AbortController();
    void fetch('/api/system/ai-health', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => response.ok ? AiHealthResponseSchemaSafe(await response.json()) : null)
      .then((report) => { if (report) setHealth(report); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [checkHealth]);

  const baseLabel = runtime.runtimeLabel ?? PROVIDER_LABELS[runtime.provider];
  // Plain words (QA L2). A slow health check while a build keeps the model busy reads as "busy", not "degraded";
  // the provider and model id stay in the tooltip.
  const label =
    runtime.provider === 'replay' || runtime.provider === 'manual_chat'
      ? baseLabel
      : health?.status === 'blocked' || health?.status === 'not_configured'
        ? 'AI unavailable'
        : health?.status === 'degraded'
          ? 'AI busy'
          : health?.status === 'ready'
            ? 'AI ready'
            : 'AI';
  const capabilityTitle = health?.capabilities?.map((capability) =>
    `${capability.capability}: ${capability.status}${capability.nextStep ? ` — ${capability.nextStep}` : ''}`,
  ).join('\n');

  return (
    <span
      className={cn('pulse-pill text-[0.7rem]', className)}
      title={[`${baseLabel}: heavy tier ${runtime.heavyModel}, fast tier ${runtime.fastModel}`, capabilityTitle || health?.error]
        .filter(Boolean)
        .join('\n')}
      data-runtime-status={health?.status ?? (runtime.provider === 'replay' ? 'demo' : runtime.provider === 'manual_chat' ? 'manual' : 'unknown')}
    >
      <Cpu
        aria-hidden
        className={cn(
          'size-3.5',
          health?.status === 'blocked'
            ? 'text-pulse-crimson'
            : health?.status === 'degraded' || health?.status === 'not_configured' || runtime.provider === 'replay'
              ? 'text-pulse-amber'
              : 'text-pulse-emerald',
        )}
      />
      <span className="sr-only">AI runtime:</span>
      {label}
    </span>
  );
}

function AiHealthResponseSchemaSafe(value: unknown): AiHealthResponse | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<AiHealthResponse>;
  return typeof candidate.ok === 'boolean' && typeof candidate.provider === 'string' && Array.isArray(candidate.models)
    ? candidate as AiHealthResponse
    : null;
}
