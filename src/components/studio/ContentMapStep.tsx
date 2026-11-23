'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, LoaderCircle, Minus, Plus, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchContentMap, saveUnitTarget, type ContentMap } from './api-client';

/**
 * Step 2 of Track creation: show how much the Playbook holds before the long AI build, and let
 * the trainer adjust the checkpoint count. The build then plans target ±1 checkpoints.
 */
export function ContentMapStep({ trackId, onBuild }: { trackId: string; onBuild: (unitTarget: number) => void }) {
  const [map, setMap] = useState<ContentMap | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchContentMap(trackId)
      .then((loaded) => {
        if (cancelled) return;
        setMap(loaded);
        setTarget(loaded.unitTarget ?? loaded.recommended.target);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'The content map did not load.');
      });
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  async function build() {
    if (!map || target === null) return;
    setSaving(true);
    setError(null);
    try {
      // Save null when the trainer kept the measured target, so later rebuilds re-measure.
      await saveUnitTarget(trackId, target === map.recommended.target ? null : target);
      onBuild(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The checkpoint target was not saved.');
      setSaving(false);
    }
  }

  if (!map) {
    return (
      <div className="pulse-card flex items-center gap-3 p-6 text-sm text-pulse-muted">
        {error ? (
          <>
            <AlertTriangle aria-hidden className="size-4 text-pulse-crimson" />
            <span className="flex-1">{error}</span>
            <button type="button" className="pulse-btn pulse-btn-primary" onClick={() => onBuild(0)}>
              Build anyway
            </button>
          </>
        ) : (
          <>
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            Reading the Playbook…
          </>
        )}
      </div>
    );
  }

  const maxRules = Math.max(1, ...map.pages.map((p) => p.ruleSignals));
  const imageOnly = map.pages.filter((p) => p.needsTranscription);
  const noRules = map.pages.filter((p) => p.ruleSignals === 0 && !p.needsTranscription);
  const current = target ?? map.recommended.target;
  const minutes = map.estimatedMinutesByTarget[String(current)];
  const outsideRecommended = current < map.recommended.min || current > map.recommended.max;

  return (
    <div className="flex flex-col gap-4">
      <section className="pulse-card flex flex-col gap-4 p-5" aria-labelledby="depth-heading">
        <div>
          <p className="pulse-label">Source depth</p>
          <h2 id="depth-heading" className="mt-1 text-lg font-semibold">
            <span className="pulse-metric">{map.ruleSignals}</span> rule statements on {map.pageCount} page{map.pageCount === 1 ? '' : 's'}
          </h2>
          <p className="text-sm text-pulse-muted">
            {map.words.toLocaleString()} words · {map.headings} sections · {map.operationalPages} pages hold rules
          </p>
        </div>

        <figure>
          <figcaption className="pulse-label mb-2">Rules per page</figcaption>
          <div className="flex h-24 items-end gap-1" role="img" aria-label={`Rules per page: ${map.pages.map((p) => `page ${p.pageNumber} ${p.ruleSignals}`).join(', ')}`}>
            {map.pages.map((page) => (
              <div key={page.pageNumber} className="flex h-full min-w-1 flex-1 flex-col justify-end" title={`Page ${page.pageNumber}: ${page.ruleSignals} rules, ${page.words} words`}>
                <div
                  className={cn('rounded-t-sm', page.needsTranscription ? 'bg-pulse-amber/60' : 'bg-pulse-indigo/40')}
                  style={{ height: `${Math.max(4, (page.ruleSignals / maxRules) * 100)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[0.7rem] text-pulse-muted">
            <span className="pulse-metric">p. 1</span>
            <span className="pulse-metric">p. {map.pageCount}</span>
          </div>
        </figure>

        {imageOnly.length > 0 ? (
          <p role="note" className="flex gap-2 rounded-pulse-md border border-pulse-amber/40 bg-pulse-amber/10 px-3 py-2 text-sm text-pulse-secondary">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-pulse-amber" />
            <span>
              Page{imageOnly.length === 1 ? '' : 's'} {imageOnly.map((p) => p.pageNumber).join(', ')} {imageOnly.length === 1 ? 'looks' : 'look'} like an image
              with little text. Transcribe {imageOnly.length === 1 ? 'it' : 'them'} in Source Review after the upload, or those steps will not be taught.
            </span>
          </p>
        ) : null}
        {noRules.length > 0 ? (
          <p className="text-xs text-pulse-muted">
            No rules found on page{noRules.length === 1 ? '' : 's'} {noRules.map((p) => p.pageNumber).join(', ')} (for example a cover or index). They add no checkpoints.
          </p>
        ) : null}
      </section>

      <section className="pulse-card flex flex-col gap-4 p-5" aria-labelledby="size-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="pulse-label">Checkpoints</p>
            <h2 id="size-heading" className="mt-1 text-lg font-semibold">
              Recommended: {map.recommended.target} checkpoints
            </h2>
            <p className="text-sm text-pulse-muted">
              Measured range {map.recommended.min}–{map.recommended.max}. Dense sections get their own checkpoint; light sections share one.
              Each checkpoint gets 2–8 Briefing Cards and 4–10 Drills, sized to the rules on its pages.
            </p>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-2" role="group" aria-label="Checkpoint target">
              <button
                type="button"
                className="pulse-btn size-9 p-0"
                aria-label="Fewer checkpoints"
                disabled={current <= map.limits.min || saving}
                onClick={() => setTarget(current - 1)}
              >
                <Minus aria-hidden className="size-4" />
              </button>
              <output aria-live="polite" className="pulse-metric w-10 text-center text-3xl font-bold text-pulse-indigo-text">
                {current}
              </output>
              <button
                type="button"
                className="pulse-btn size-9 p-0"
                aria-label="More checkpoints"
                disabled={current >= map.limits.max || saving}
                onClick={() => setTarget(current + 1)}
              >
                <Plus aria-hidden className="size-4" />
              </button>
            </div>
            <span className="text-xs text-pulse-muted">{minutes ? `about ${minutes} min for learners` : null}</span>
            {current !== map.recommended.target ? (
              <button type="button" className="flex items-center gap-1 text-xs font-semibold text-pulse-indigo-text hover:underline" onClick={() => setTarget(map.recommended.target)}>
                <RotateCcw aria-hidden className="size-3" />
                Use recommended
              </button>
            ) : null}
          </div>
        </div>
        {outsideRecommended ? (
          <p className="text-xs text-pulse-amber">
            {current < map.recommended.min
              ? 'Fewer checkpoints than measured: each one will cover more rules and run longer.'
              : 'More checkpoints than measured: some may be short or repeat rules.'}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-pulse-crimson">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <p className="text-xs text-pulse-muted">
            {map.fileName ? <span className="font-medium text-pulse-secondary">{map.fileName}</span> : 'Uploaded Playbook'} · {map.pageCount} page
            {map.pageCount === 1 ? '' : 's'}. The PDF is checked for contradictions first; you only stop if it finds any.
          </p>
          <button type="button" className="pulse-btn pulse-btn-primary px-5 py-2.5 text-base" onClick={build} disabled={saving}>
            {saving ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null}
            Approve source and build {current} checkpoints
            <ArrowRight aria-hidden className="size-4" />
          </button>
        </div>
      </section>
    </div>
  );
}
