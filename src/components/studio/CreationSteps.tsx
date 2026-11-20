import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const STEPS = ['Sources', 'Content map', 'Build', 'Review & assign'] as const;

/** Four-step header for creating a Track. `current` is the 0-based active step. */
export function CreationSteps({ current }: { current: 0 | 1 | 2 | 3 }) {
  return (
    <ol aria-label="Track creation steps" className="flex flex-wrap items-center gap-x-2 gap-y-2">
      {STEPS.map((label, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
            <span
              className={cn(
                'grid size-6 place-items-center rounded-full border-2 text-xs font-bold',
                done && 'border-pulse-emerald bg-pulse-emerald text-pulse-on-emerald',
                active && 'border-pulse-indigo bg-pulse-indigo text-pulse-on-accent',
                !done && !active && 'border-pulse-border text-pulse-muted',
              )}
            >
              {done ? <Check aria-hidden className="size-3.5" /> : index + 1}
            </span>
            <span className={cn('text-sm', active ? 'font-semibold text-pulse-indigo-text' : done ? 'font-medium' : 'text-pulse-muted')}>
              {label}
            </span>
            {index < STEPS.length - 1 ? (
              <span aria-hidden className={cn('mx-1 hidden h-0.5 w-8 rounded sm:block', done ? 'bg-pulse-emerald' : 'bg-pulse-border')} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
