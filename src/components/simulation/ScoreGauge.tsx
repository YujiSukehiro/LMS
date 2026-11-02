import { clampPct, cn } from '@/lib/utils';

export type ScoreTone = 'emerald' | 'amber' | 'crimson';

export interface ScoreGaugeProps {
  /** 0–100 */
  scorePct: number;
  tone: ScoreTone;
  /** Short status under the number, e.g. `PASSED`. */
  statusLabel?: string;
  /** Pass threshold marker on the ring (0–100). */
  thresholdPct?: number;
  size?: number;
  className?: string;
}

const TONE_VAR: Record<ScoreTone, string> = {
  emerald: 'var(--pulse-emerald)',
  amber: 'var(--pulse-amber)',
  crimson: 'var(--pulse-crimson)',
};

/** Circular SVG score gauge with an optional pass-threshold tick. */
export function ScoreGauge({ scorePct, tone, statusLabel, thresholdPct, size = 168, className }: ScoreGaugeProps) {
  const score = clampPct(scorePct);
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (score / 100) * circumference;
  const center = size / 2;
  const color = TONE_VAR[tone];

  let tick: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (thresholdPct !== undefined) {
    const angle = (clampPct(thresholdPct) / 100) * 2 * Math.PI - Math.PI / 2;
    const inner = radius - stroke / 2 - 3;
    const outer = radius + stroke / 2 + 3;
    tick = {
      x1: center + inner * Math.cos(angle),
      y1: center + inner * Math.sin(angle),
      x2: center + outer * Math.cos(angle),
      y2: center + outer * Math.sin(angle),
    };
  }

  return (
    <div
      role="img"
      aria-label={`Score ${score}%${statusLabel ? `, ${statusLabel}` : ''}`}
      className={cn('relative inline-grid place-items-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--pulse-surface-2)" strokeWidth={stroke} />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          transform={`rotate(-90 ${center} ${center})`}
          style={{ transition: 'stroke-dasharray 900ms cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
        {tick ? (
          <line {...tick} stroke="var(--pulse-text-muted)" strokeWidth={2} strokeLinecap="round" />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="pulse-metric text-4xl font-bold" style={{ color }}>
          {score}%
        </span>
        {statusLabel ? (
          <span className="mt-1 max-w-[75%] text-[0.65rem] font-bold uppercase leading-tight tracking-wider" style={{ color }}>
            {statusLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}
