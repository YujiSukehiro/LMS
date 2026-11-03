'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { ApiErrorBodySchema } from '@/lib/schemas/api';
import type { TrainerQaCategory, TrainerQaItem, TrainerQaQueue } from '@/lib/services/trainer-qa';
import { cn } from '@/lib/utils';

type CategoryFilter = 'all' | TrainerQaCategory;

const CATEGORY_LABELS: Record<TrainerQaCategory, string> = {
  unsupported_evidence: 'Evidence review',
  critical_conflict: 'Critical SME conflicts',
  high_learner_failure: 'High learner failure',
  model_disagreement: 'Model disagreement',
};

const CATEGORY_ORDER: TrainerQaCategory[] = [
  'unsupported_evidence',
  'critical_conflict',
  'high_learner_failure',
  'model_disagreement',
];

function isQueue(value: unknown, trackId: string): value is TrainerQaQueue {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TrainerQaQueue>;
  return candidate.trackId === trackId &&
    typeof candidate.draftVersionId === 'string' &&
    (typeof candidate.learningVersionId === 'string' || candidate.learningVersionId === null) &&
    typeof candidate.generatedAt === 'number' &&
    typeof candidate.policy?.minimumSampleSize === 'number' &&
    typeof candidate.policy.highFailureRate === 'number' &&
    typeof candidate.counts?.total === 'number' &&
    Array.isArray(candidate.items) &&
    candidate.items.every((item) =>
      item && typeof item.id === 'string' && CATEGORY_ORDER.includes(item.category) &&
      typeof item.title === 'string' && typeof item.summary === 'string' && Array.isArray(item.details));
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function TrainerQaPanel({ trackId }: { trackId: string }) {
  const [queue, setQueue] = useState<TrainerQaQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/studio/tracks/${encodeURIComponent(trackId)}/qa`, { cache: 'no-store' });
      const body: unknown = await response.json();
      if (!response.ok) {
        const apiError = ApiErrorBodySchema.safeParse(body);
        throw new Error(apiError.success
          ? apiError.data.message ?? 'The trainer QA queue did not load.'
          : `The trainer QA queue did not load (HTTP ${response.status}).`);
      }
      if (!isQueue(body, trackId)) throw new Error('The server sent an unexpected trainer QA response.');
      if (sequence === requestSequence.current) setQueue(body);
    } catch (cause) {
      if (sequence === requestSequence.current) {
        setError(cause instanceof Error ? cause.message : 'The trainer QA queue did not load.');
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [trackId]);

  useEffect(() => {
    setQueue(null);
    setCategory('all');
    setQuery('');
    void load();
    return () => { requestSequence.current += 1; };
  }, [load]);

  const filteredItems = useMemo(() => {
    if (!queue) return [];
    const needle = query.trim().toLocaleLowerCase();
    return queue.items.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (!needle) return true;
      return [item.title, item.summary, item.target.id, item.target.label, item.target.contextId ?? '']
        .some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [category, query, queue]);

  return (
    <section className="pulse-card flex min-w-0 flex-col gap-5 p-4 sm:p-5" aria-labelledby="trainer-qa-title" data-testid="trainer-qa-panel">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-pulse-indigo">
            <ShieldCheck aria-hidden className="size-4" /> Trainer-only · server-derived
          </p>
          <h2 id="trainer-qa-title" className="mt-1 text-xl font-bold">Bulk QA work queue</h2>
          <p className="mt-1 max-w-3xl text-sm text-pulse-secondary">
            Review exact evidence, unresolved critical conflicts, eligible learner failures, and conflicts between deterministic verdicts and persisted judge output.
          </p>
        </div>
        <button type="button" className="pulse-btn w-fit shrink-0" onClick={() => void load()} disabled={loading}>
          <RefreshCw aria-hidden className={cn('size-4', loading && 'animate-spin')} /> Refresh
        </button>
      </header>

      {queue ? (
        <p className="text-xs text-pulse-muted">
          Draft <span className="pulse-metric">{queue.draftVersionId}</span>
          {queue.learningVersionId ? <> · learning evidence <span className="pulse-metric">{queue.learningVersionId}</span></> : ' · no published learning version'}
          {' '}· checked {new Date(queue.generatedAt).toLocaleString()}
        </p>
      ) : null}

      {error ? (
        <div role="alert" className="flex flex-col gap-3 rounded-pulse-md border border-pulse-crimson/40 bg-pulse-crimson/10 p-3 text-sm text-pulse-crimson sm:flex-row sm:items-center sm:justify-between">
          <p>{error}</p>
          <button type="button" className="pulse-btn w-fit" onClick={() => void load()} disabled={loading}>Retry</button>
        </div>
      ) : null}

      {loading && !queue ? (
        <p role="status" className="flex items-center gap-2 rounded-pulse-md bg-pulse-surface-1 p-4 text-sm text-pulse-muted">
          <LoaderCircle aria-hidden className="size-4 animate-spin" /> Loading persisted trainer QA evidence…
        </p>
      ) : null}

      {queue ? (
        <>
          <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="QA work item counts">
            {CATEGORY_ORDER.map((itemCategory) => (
              <div key={itemCategory} className="min-w-0 rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-1 p-3">
                <dt className="text-xs text-pulse-muted">{CATEGORY_LABELS[itemCategory]}</dt>
                <dd className="mt-1 text-2xl font-bold pulse-metric">{queue.counts.byCategory[itemCategory]}</dd>
              </div>
            ))}
          </dl>

          <div className="grid gap-3 rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-1 p-3 md:grid-cols-[minmax(14rem,1fr)_minmax(14rem,1fr)]">
            <div>
              <label className="pulse-label" htmlFor="trainer-qa-category">Filter by QA category</label>
              <select
                id="trainer-qa-category"
                className="pulse-input mt-1.5 w-full"
                value={category}
                onChange={(event) => setCategory(event.target.value as CategoryFilter)}
              >
                <option value="all">All QA work ({queue.counts.total})</option>
                {CATEGORY_ORDER.map((itemCategory) => (
                  <option key={itemCategory} value={itemCategory}>
                    {CATEGORY_LABELS[itemCategory]} ({queue.counts.byCategory[itemCategory]})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="pulse-label" htmlFor="trainer-qa-search">Search item, content ID, or context</label>
              <input
                id="trainer-qa-search"
                type="search"
                className="pulse-input mt-1.5 w-full"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="For example, drill-1 or a scenario title"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1 text-xs text-pulse-muted sm:flex-row sm:items-center sm:justify-between">
            <p role="status" aria-live="polite">Showing {filteredItems.length} of {queue.counts.total} work items.</p>
            <p>High failure: at least {queue.policy.minimumSampleSize} eligible attempts and {percent(queue.policy.highFailureRate)} failure.</p>
          </div>

          {loading ? (
            <p role="status" className="flex items-center gap-2 text-xs text-pulse-muted">
              <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> Refreshing persisted evidence…
            </p>
          ) : null}

          {queue.items.length === 0 ? (
            <div className="rounded-pulse-md border border-pulse-emerald/30 bg-pulse-emerald/5 p-5 text-sm">
              <p className="font-semibold text-pulse-emerald">No bulk QA work items found.</p>
              <p className="mt-1 text-pulse-secondary">The current persisted evidence did not meet any queue category. This is not a certification or readiness verdict.</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="rounded-pulse-md bg-pulse-surface-1 p-5 text-sm">
              <p className="font-semibold">No work items match these filters.</p>
              <p className="mt-1 text-pulse-muted">Choose another category or clear the search text.</p>
            </div>
          ) : (
            <ul className="grid min-w-0 gap-3 2xl:grid-cols-2" aria-label="Filtered QA work items">
              {filteredItems.map((item) => <QaWorkItem key={item.id} item={item} />)}
            </ul>
          )}

          <p className="rounded-pulse-md bg-pulse-surface-1 p-3 text-xs text-pulse-muted">
            Failure rates describe eligible persisted attempts, not unique learners or readiness. Replay, draft, historical-version, and unverified legacy evidence are excluded. Scenario failure requires the complete current assessment verdict; no client-supplied failure or disagreement flags are accepted.
          </p>
        </>
      ) : null}
    </section>
  );
}

function QaWorkItem({ item }: { item: TrainerQaItem }) {
  return (
    <li className="min-w-0 rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-1 p-4">
      <article aria-labelledby={`qa-item-${item.id}`} className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <span className={cn(
              'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              item.category === 'critical_conflict' || item.category === 'model_disagreement'
                ? 'bg-pulse-crimson/15 text-pulse-crimson'
                : item.category === 'high_learner_failure'
                  ? 'bg-pulse-amber/15 text-pulse-amber'
                  : 'bg-pulse-indigo/15 text-pulse-indigo',
            )}>
              {CATEGORY_LABELS[item.category]}
            </span>
            <h3 id={`qa-item-${item.id}`} className="mt-2 break-words text-sm font-semibold">{item.title}</h3>
          </div>
          {item.evidence?.critical ? (
            <span className="flex w-fit items-center gap-1 text-xs font-semibold text-pulse-crimson">
              <AlertTriangle aria-hidden className="size-3.5" /> Critical
            </span>
          ) : null}
        </div>

        <p className="text-sm text-pulse-secondary">{item.summary}</p>
        <p className="break-words text-xs text-pulse-muted">
          {item.target.kind.replaceAll('_', ' ')} <span className="pulse-metric">{item.target.id}</span>
          {item.target.contextId ? <> · context <span className="pulse-metric">{item.target.contextId}</span></> : null}
        </p>

        {item.metric ? (
          <dl className="grid grid-cols-3 gap-2 rounded-pulse-md bg-pulse-surface-2 p-3 text-xs">
            <div><dt className="text-pulse-muted">Failure rate</dt><dd className="mt-1 font-semibold pulse-metric">{percent(item.metric.failureRate)}</dd></div>
            <div><dt className="text-pulse-muted">Failed</dt><dd className="mt-1 font-semibold pulse-metric">{item.metric.failures}</dd></div>
            <div><dt className="text-pulse-muted">Sample</dt><dd className="mt-1 font-semibold pulse-metric">{item.metric.sampleSize}</dd></div>
          </dl>
        ) : null}

        {item.details.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-xs text-pulse-secondary">
            {item.details.map((detail, index) => <li key={`${item.id}-detail-${index}`}>{detail}</li>)}
          </ul>
        ) : null}
      </article>
    </li>
  );
}
