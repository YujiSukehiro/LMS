export default function LearnLoading() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto flex w-full max-w-3xl animate-pulse flex-col gap-5">
      <div className="h-3 w-full rounded-full bg-pulse-surface-2" />
      <div className="pulse-card-elevated h-40" />
      <div className="flex flex-col gap-4">
        {[0, 1, 2].map((key) => (
          <div key={key} className="flex items-start gap-4">
            <div className="size-14 shrink-0 rounded-full bg-pulse-surface-2" />
            <div className="pulse-card h-24 flex-1" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
