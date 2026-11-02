/** Shared body for route `loading.tsx` files. */
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy="true" aria-label={label}>
      <div className="flex flex-col gap-2">
        <div className="h-3 w-28 rounded bg-pulse-surface-2" />
        <div className="h-7 w-72 rounded bg-pulse-surface-2" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="pulse-card h-24" />
        ))}
      </div>
      <div className="pulse-card h-72" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
