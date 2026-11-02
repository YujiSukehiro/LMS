import { Cpu } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AiRuntimeInfo {
  provider: 'ollama' | 'gemini';
  heavyModel: string;
  fastModel: string;
}

const PROVIDER_LABELS: Record<AiRuntimeInfo['provider'], string> = {
  ollama: 'Ollama',
  gemini: 'Gemini',
};

/** Shows the active LLMGateway provider and its heavy-tier model. */
export function AiRuntimePill({ runtime, className }: { runtime: AiRuntimeInfo; className?: string }) {
  const label = `${PROVIDER_LABELS[runtime.provider]} · ${runtime.heavyModel}`;
  return (
    <span
      className={cn('pulse-pill font-mono text-[0.7rem]', className)}
      title={`LLMGateway: ${PROVIDER_LABELS[runtime.provider]} — heavy tier ${runtime.heavyModel}, fast tier ${runtime.fastModel}`}
    >
      <Cpu aria-hidden className="size-3.5 text-pulse-emerald" />
      <span className="sr-only">AI runtime:</span>
      {label}
    </span>
  );
}
