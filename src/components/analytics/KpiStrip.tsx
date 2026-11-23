import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface KpiItem {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
  tone?: 'default' | 'emerald' | 'amber' | 'crimson' | 'indigo';
}

const TONE_CLASS: Record<NonNullable<KpiItem['tone']>, string> = {
  default: 'text-pulse-primary',
  emerald: 'text-pulse-emerald',
  amber: 'text-pulse-amber',
  crimson: 'text-pulse-crimson',
  indigo: 'text-pulse-indigo-text',
};

export function KpiStrip({ items, className }: { items: KpiItem[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-2 gap-2 md:grid-cols-4', className)}>
      {items.map((item) => (
        <div key={item.label} className="pulse-card flex min-w-0 flex-col gap-0.5 px-3.5 py-2.5">
          <dt className="pulse-label flex items-center gap-1.5">
            {item.icon}
            {item.label}
          </dt>
          <dd className={cn('pulse-metric text-xl font-semibold', TONE_CLASS[item.tone ?? 'default'])}>
            {item.value}
          </dd>
          {item.hint ? <dd className="truncate text-xs text-pulse-muted">{item.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-pulse-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-pulse-lg border border-dashed border-pulse-border px-6 py-10 text-center">
      {icon ? <div className="text-pulse-muted">{icon}</div> : null}
      <p className="text-sm font-semibold text-pulse-secondary">{title}</p>
      {body ? <p className="max-w-md text-sm text-pulse-muted">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ProgressBar({ value, tone = 'indigo', label }: { value: number; tone?: 'indigo' | 'emerald' | 'amber' | 'crimson'; label?: string }) {
  const toneClass =
    tone === 'emerald' ? 'bg-pulse-emerald' : tone === 'amber' ? 'bg-pulse-amber' : tone === 'crimson' ? 'bg-pulse-crimson' : 'bg-pulse-indigo';
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
      className="h-1.5 w-full overflow-hidden rounded-full bg-pulse-surface-2"
    >
      <div className={cn('h-full rounded-full transition-[width] duration-500', toneClass)} style={{ width: `${pct}%` }} />
    </div>
  );
}
