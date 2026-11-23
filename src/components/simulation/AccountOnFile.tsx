import { IdCard } from 'lucide-react';

/**
 * What the agent's screen shows for the caller, collapsed by default so the agent asks first and checks second
 * (QA L11: without it the agent could not really verify name, DOB and ZIP).
 */
export function AccountOnFile({ lines, className }: { lines: readonly string[] | undefined; className?: string }) {
  const shown = (lines ?? []).map((line) => line.trim()).filter(Boolean);
  if (shown.length === 0) return null;
  return (
    <details className={className}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-pulse-indigo-text hover:underline">
        <IdCard aria-hidden className="size-3.5" />
        Show account on file
      </summary>
      <ul className="mt-1.5 flex flex-col gap-0.5 rounded-pulse-sm bg-pulse-surface-2 px-3 py-2 text-xs">
        {shown.map((line) => (
          <li key={line} className="pulse-metric text-pulse-secondary">
            {line}
          </li>
        ))}
      </ul>
    </details>
  );
}
