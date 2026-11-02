'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash } from 'lucide-react';
import { cn } from '@/lib/utils';

export function newItemId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${random}`;
}

function CharCount({ value, max }: { value: string; max?: number }) {
  if (!max) return null;
  const over = value.length > max;
  return (
    <span className={cn('pulse-metric text-[0.68rem]', over ? 'font-semibold text-pulse-crimson' : 'text-pulse-muted')}>
      {value.length}/{max}
    </span>
  );
}

export function FieldShell({
  label,
  htmlFor,
  hint,
  aside,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-xs font-semibold text-pulse-secondary">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {hint ? <p className="text-[0.7rem] text-pulse-muted">{hint}</p> : null}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  max,
  hint,
  placeholder,
  className,
  mono,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max?: number;
  hint?: string;
  placeholder?: string;
  className?: string;
  mono?: boolean;
}) {
  const id = useId();
  return (
    <FieldShell label={label} htmlFor={id} hint={hint} aside={<CharCount value={value} max={max} />} className={className}>
      <input
        id={id}
        className={cn('pulse-input', mono && 'pulse-metric', max && value.length > max && 'border-pulse-crimson')}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  max,
  hint,
  rows = 3,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max?: number;
  hint?: string;
  rows?: number;
  className?: string;
}) {
  const id = useId();
  return (
    <FieldShell label={label} htmlFor={id} hint={hint} aside={<CharCount value={value} max={max} />} className={className}>
      <textarea
        id={id}
        rows={rows}
        className={cn('pulse-textarea', max && value.length > max && 'border-pulse-crimson')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </FieldShell>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  hint,
  className,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  hint?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <FieldShell label={label} htmlFor={id} hint={hint} className={className}>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        className="pulse-input pulse-metric"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={1}
        onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Math.round(Number(e.target.value)))}
      />
    </FieldShell>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  hint,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  hint?: string;
  className?: string;
}) {
  const id = useId();
  const known = options.some((o) => o.value === value);
  return (
    <FieldShell label={label} htmlFor={id} hint={hint} className={className}>
      <select id={id} className="pulse-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {!known ? <option value={value}>{value ? `${value} (not in list)` : 'Select…'}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

/** Comma-separated Playbook page numbers, e.g. "4, 5". */
export function SourcePagesField({
  value,
  onChange,
  label = 'Source pages',
  className,
}: {
  value: number[];
  onChange: (value: number[]) => void;
  label?: string;
  className?: string;
}) {
  const id = useId();
  const [text, setText] = useState(value.join(', '));
  const joined = value.join(', ');
  useEffect(() => {
    setText((prev) => (parsePages(prev).join(', ') === joined ? prev : joined));
  }, [joined]);
  return (
    <FieldShell label={label} htmlFor={id} hint="Playbook page numbers, separated by commas." className={className}>
      <input
        id={id}
        className="pulse-input pulse-metric"
        value={text}
        inputMode="numeric"
        placeholder="4, 5"
        onChange={(e) => {
          setText(e.target.value);
          onChange(parsePages(e.target.value));
        }}
      />
    </FieldShell>
  );
}

function parsePages(text: string): number[] {
  const pages = text
    .split(/[,\s]+/)
    .map((part) => Number(part))
    .filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(pages)];
}

/** Editable list of short plain-English lines with add / remove / reorder. */
export function StringListField({
  label,
  values,
  onChange,
  maxItems,
  minItems = 0,
  maxLength,
  addLabel = 'Add line',
  hint,
  tone,
  reorderable = false,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  maxItems?: number;
  minItems?: number;
  maxLength?: number;
  addLabel?: string;
  hint?: string;
  tone?: 'emerald' | 'crimson';
  reorderable?: boolean;
}) {
  const canAdd = maxItems === undefined || values.length < maxItems;
  const canRemove = values.length > minItems;
  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= values.length) return;
    const next = [...values];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={cn(
            'text-xs font-semibold',
            tone === 'emerald' ? 'text-pulse-emerald' : tone === 'crimson' ? 'text-pulse-crimson' : 'text-pulse-secondary',
          )}
        >
          {label}
        </span>
        {maxItems !== undefined ? (
          <span className="pulse-metric text-[0.68rem] text-pulse-muted">
            {values.length}/{maxItems}
          </span>
        ) : null}
      </div>
      {values.length === 0 ? <p className="text-xs text-pulse-muted">No lines yet.</p> : null}
      <ul className="flex flex-col gap-1.5">
        {values.map((value, index) => (
          <li key={index} className="flex items-start gap-1.5">
            <div className="flex-1">
              <input
                aria-label={`${label} line ${index + 1}`}
                className={cn('pulse-input', maxLength && value.length > maxLength && 'border-pulse-crimson')}
                value={value}
                onChange={(e) => {
                  const next = [...values];
                  next[index] = e.target.value;
                  onChange(next);
                }}
              />
              {maxLength && value.length > maxLength ? (
                <p className="mt-0.5 text-[0.68rem] text-pulse-crimson">
                  {value.length}/{maxLength} characters — make it shorter.
                </p>
              ) : null}
            </div>
            {reorderable ? (
              <MoveButtons
                onUp={() => move(index, -1)}
                onDown={() => move(index, 1)}
                upDisabled={index === 0}
                downDisabled={index === values.length - 1}
                label={`line ${index + 1}`}
              />
            ) : null}
            <IconButton
              label={`Remove ${label} line ${index + 1}`}
              onClick={() => onChange(values.filter((_, i) => i !== index))}
              disabled={!canRemove}
            >
              <Trash aria-hidden className="size-3.5" />
            </IconButton>
          </li>
        ))}
      </ul>
      {hint ? <p className="text-[0.7rem] text-pulse-muted">{hint}</p> : null}
      {canAdd ? (
        <button type="button" className="pulse-btn pulse-btn-ghost w-fit px-2 py-1 text-xs" onClick={() => onChange([...values, ''])}>
          <Plus aria-hidden className="size-3.5" />
          {addLabel}
        </button>
      ) : null}
    </div>
  );
}

export function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-9 shrink-0 items-center justify-center rounded-pulse-md border border-pulse-border text-pulse-muted hover:bg-pulse-surface-2 hover:text-pulse-primary disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function MoveButtons({
  onUp,
  onDown,
  upDisabled,
  downDisabled,
  label,
}: {
  onUp: () => void;
  onDown: () => void;
  upDisabled: boolean;
  downDisabled: boolean;
  label: string;
}) {
  return (
    <div className="flex shrink-0 gap-1">
      <IconButton label={`Move ${label} up`} onClick={onUp} disabled={upDisabled}>
        <ChevronUp aria-hidden className="size-4" />
      </IconButton>
      <IconButton label={`Move ${label} down`} onClick={onDown} disabled={downDisabled}>
        <ChevronDown aria-hidden className="size-4" />
      </IconButton>
    </div>
  );
}

export function EditorSection({
  title,
  badge,
  actions,
  children,
  id,
}: {
  title: string;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="pulse-card flex scroll-mt-20 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          {badge}
        </div>
        {actions ? <div className="flex flex-wrap items-start gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
