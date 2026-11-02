'use client';

import { useEffect, useState } from 'react';
import { Cpu } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AiHealthResponse } from '@/lib/schemas/api';

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
export function AiRuntimePill({ runtime, className }: { runtime: AiRuntimeInfo; className?: string }) {
  const [health, setHealth] = useState<AiHealthResponse | null>(null);

  useEffect(() => {
    if (runtime.provider === 'manual_chat' || runtime.provider === 'replay') return;
    const controller = new AbortController();
    void fetch('/api/system/ai-health', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => response.ok ? AiHealthResponseSchemaSafe(await response.json()) : null)
      .then((report) => { if (report) setHealth(report); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [runtime.provider]);

  const baseLabel = PROVIDER_LABELS[runtime.provider];
  const label = health?.status === 'blocked'
    ? 'Local chat blocked'
    : health?.status === 'degraded'
      ? `${baseLabel} degraded`
      : health?.status === 'not_configured'
        ? 'Local AI not configured'
        : health?.status === 'ready'
          ? `${baseLabel} ready · ${runtime.heavyModel}`
          : runtime.provider === 'replay' || runtime.provider === 'manual_chat'
            ? baseLabel
            : `${baseLabel} · ${runtime.heavyModel}`;
  const capabilityTitle = health?.capabilities?.map((capability) =>
    `${capability.capability}: ${capability.status}${capability.nextStep ? ` — ${capability.nextStep}` : ''}`,
  ).join('\n');

  return (
    <span
      className={cn('pulse-pill font-mono text-[0.7rem]', className)}
      title={capabilityTitle || health?.error || `${baseLabel}: heavy tier ${runtime.heavyModel}, fast tier ${runtime.fastModel}`}
      data-runtime-status={health?.status ?? (runtime.provider === 'replay' ? 'demo' : runtime.provider === 'manual_chat' ? 'manual' : 'unknown')}
    >
      <Cpu aria-hidden className={cn('size-3.5', health?.status === 'blocked' ? 'text-pulse-crimson' : runtime.provider === 'replay' ? 'text-pulse-amber' : 'text-pulse-emerald')} />
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
