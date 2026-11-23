import type { ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Award,
  BookOpen,
  Brain,
  CalendarClock,
  Check,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileSearch,
  MessageSquareText,
  ShieldCheck,
} from 'lucide-react';
import type { CertificationStatus, LearningAnalytics } from '@/lib/schemas/learning';
import { cn } from '@/lib/utils';

export interface LearningAnalyticsPanelProps {
  analytics: LearningAnalytics;
  title?: string;
  /** Transcript, attempt, gate, and provenance details supplied by the integrating view. */
  evidenceDrillDown?: ReactNode;
}

const CERTIFICATION_LABELS: Record<CertificationStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  ready_for_trainer_review: 'Trainer review required',
  certified: 'Certified',
  recertification_required: 'Recertification required',
  expired: 'Expired',
  revoked: 'Revoked',
};

function certificationTone(status: CertificationStatus): string {
  if (status === 'certified') return 'pulse-pill-emerald';
  if (status === 'expired' || status === 'revoked') return 'pulse-pill-crimson';
  if (status === 'in_progress' || status === 'ready_for_trainer_review' || status === 'recertification_required') {
    return 'pulse-pill-amber';
  }
  return '';
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Not demonstrated';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Insufficient evidence';
  return `${date.toISOString().slice(0, 10)} · ${date.toISOString().slice(11, 16)} UTC`;
}

interface MetricProps {
  label: string;
  description: string;
  numerator: number;
  denominator: number;
  ratio: number | null;
  countLabel: string;
  icon: ReactNode;
  meta?: ReactNode;
}

function AnalyticsMetric({ label, description, numerator, denominator, ratio, countLabel, icon, meta }: MetricProps) {
  const demonstrated = denominator > 0 && ratio !== null;
  const percent = demonstrated ? Math.round(ratio * 100) : null;
  return (
    <div className="pulse-card flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-pulse-muted" aria-hidden>{icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-pulse-primary">{label}</h3>
          <p className="mt-1 text-xs leading-relaxed text-pulse-muted">{description}</p>
        </div>
        <span className={cn('pulse-metric shrink-0 text-xl font-semibold', percent === 100 ? 'text-pulse-emerald' : 'text-pulse-primary')}>
          {percent === null ? <span className="text-xs font-medium text-pulse-muted">Not demonstrated</span> : `${percent}%`}
        </span>
      </div>
      {percent !== null ? (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-pulse-surface-2"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div
            className={cn('h-full rounded-full', percent === 100 ? 'bg-pulse-emerald' : 'bg-pulse-indigo')}
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <p className="pulse-metric text-pulse-secondary">
          {numerator} / {denominator} <span className="font-sans text-pulse-muted">{countLabel}</span>
        </p>
        {meta}
      </div>
    </div>
  );
}

function EvidenceIdList({ label, ids }: { label: string; ids: string[] }) {
  return (
    <div className="min-w-0">
      <h4 className="pulse-label">{label} <span className="pulse-metric">({ids.length})</span></h4>
      {ids.length > 0 ? (
        <ul className="mt-2 flex max-h-52 flex-col gap-1.5 overflow-y-auto pr-1">
          {ids.map((id) => (
            <li key={id} className="rounded-pulse-sm bg-pulse-surface-2/70 px-2.5 py-2">
              <code className="break-all text-xs text-pulse-secondary">{id}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-pulse-muted">Not demonstrated</p>
      )}
    </div>
  );
}

/** Separate, traceable current-version metrics for trainers and supervisors. */
export function LearningAnalyticsPanel({
  analytics,
  title = 'Learning evidence analytics',
  evidenceDrillDown,
}: LearningAnalyticsPanelProps) {
  const complianceEntries = Object.entries(analytics.compliance.byRule).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return (
    <section aria-labelledby="learning-analytics-title" className="pulse-cq flex w-full min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="pulse-label">Trainer analytics</p>
          <h2 id="learning-analytics-title" className="mt-1 text-xl font-semibold tracking-tight text-pulse-primary">{title}</h2>
          <p className="mt-1 text-sm text-pulse-muted">
            Track <span className="pulse-metric text-pulse-secondary">{analytics.trackId}</span> · all metrics below are for current
            curriculum version <span className="pulse-metric text-pulse-secondary">{analytics.curriculumVersion}</span>
          </p>
        </div>
        <span className={cn('pulse-pill', certificationTone(analytics.certificationStatus))}>
          <Award aria-hidden className="size-3.5" />
          {CERTIFICATION_LABELS[analytics.certificationStatus]}
        </span>
      </header>

      <div role="note" className="flex gap-3 rounded-pulse-lg border border-pulse-indigo/30 bg-pulse-indigo/10 p-4">
        <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-pulse-indigo" />
        <p className="text-sm leading-relaxed text-pulse-secondary">
          These are separate simulated-learning measures, not a blended readiness score. Certification alone does not verify or grant
          live-call authorization; operational approval may require supervised live calls.
        </p>
      </div>

      <div className="grid gap-3 @lg:grid-cols-2 @3xl:grid-cols-3">
        <AnalyticsMetric
          label="Content completion"
          description="Required items completed out of assigned current-version items."
          numerator={analytics.contentCompletion.completed}
          denominator={analytics.contentCompletion.total}
          ratio={analytics.contentCompletion.ratio}
          countLabel="items completed"
          icon={<BookOpen className="size-4" />}
        />
        <AnalyticsMetric
          label="Initial knowledge"
          description="Correct first independent attempts, kept separate from retries and recovery."
          numerator={analytics.initialKnowledge.correct}
          denominator={analytics.initialKnowledge.total}
          ratio={analytics.initialKnowledge.ratio}
          countLabel="first independent attempts correct"
          icon={<Brain className="size-4" />}
        />
        <AnalyticsMetric
          label="Rules retained"
          description="Required Playbook rules recalled correctly on a later day (Keep-sharp). Does not affect certification."
          numerator={analytics.currentMastery.mastered}
          denominator={analytics.currentMastery.total}
          ratio={analytics.currentMastery.ratio}
          countLabel="rules retained"
          icon={<Check className="size-4" />}
        />
        <AnalyticsMetric
          label="Delayed retention"
          description="Correct due spaced reviews out of completed due reviews, without immediate answer reveal."
          numerator={analytics.delayedRetention.correct}
          denominator={analytics.delayedRetention.completed}
          ratio={analytics.delayedRetention.ratio}
          countLabel="completed due reviews correct"
          icon={<CalendarClock className="size-4" />}
          meta={<span className="pulse-pill pulse-pill-amber pulse-metric">{analytics.delayedRetention.due} due</span>}
        />
        <AnalyticsMetric
          label="Scenario coverage"
          description="Required scenarios passed, including all mandatory current-version branches."
          numerator={analytics.scenarioCoverage.passed}
          denominator={analytics.scenarioCoverage.total}
          ratio={analytics.scenarioCoverage.ratio}
          countLabel="required scenarios passed"
          icon={<ClipboardCheck className="size-4" />}
        />
        <AnalyticsMetric
          label="Workflow accuracy"
          description="Required action sets completed without error, including deterministic wrap-up gates."
          numerator={analytics.workflowAccuracy.clean}
          denominator={analytics.workflowAccuracy.total}
          ratio={analytics.workflowAccuracy.ratio}
          countLabel="assessed action sets clean"
          icon={<Activity className="size-4" />}
        />
      </div>

      <div className="grid gap-4 @xl:grid-cols-2">
        <section aria-labelledby="compliance-by-rule-title" className="pulse-card overflow-hidden">
          <div className="flex items-start justify-between gap-3 border-b border-pulse-border-subtle p-4">
            <div>
              <h3 id="compliance-by-rule-title" className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle aria-hidden className="size-4 text-pulse-amber" />
                Compliance by rule
              </h3>
              <p className="mt-1 text-xs text-pulse-muted">Critical events remain visible and are never averaged into another metric.</p>
            </div>
            <span className={cn('pulse-pill pulse-metric', analytics.compliance.criticalFailureCount > 0 ? 'pulse-pill-crimson' : '')}>
              {analytics.compliance.criticalFailureCount} total
            </span>
          </div>
          {complianceEntries.length > 0 ? (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-80 text-sm">
                <caption className="sr-only">Critical failures by rule in the current evidence set</caption>
                <thead className="bg-pulse-surface-2/40">
                  <tr className="border-b border-pulse-border-subtle">
                    <th scope="col" className="pulse-label px-4 py-2 text-left">Rule ID</th>
                    <th scope="col" className="pulse-label px-4 py-2 text-right">Critical failures</th>
                  </tr>
                </thead>
                <tbody>
                  {complianceEntries.map(([ruleId, count]) => (
                    <tr key={ruleId} className="border-b border-pulse-border-subtle/60 last:border-0">
                      <th scope="row" className="px-4 py-2.5 text-left font-normal">
                        <code className="break-all text-xs text-pulse-secondary">{ruleId}</code>
                      </th>
                      <td className="pulse-metric px-4 py-2.5 text-right font-semibold text-pulse-crimson">{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-4 text-sm leading-relaxed text-pulse-muted">
              {analytics.compliance.criticalFailureCount === 0
                ? 'No rule-level critical failures are recorded in this evidence set. Missing coverage must still be resolved separately.'
                : 'Insufficient evidence — critical failures are present, but their rule-level breakdown is unavailable.'}
            </p>
          )}
          <p className="border-t border-pulse-border-subtle bg-pulse-surface-2/30 px-4 py-3 text-xs leading-relaxed text-pulse-muted">
            Review high failure rates as possible curriculum defects or source conflicts, not automatically as learner weaknesses.
          </p>
        </section>

        <section aria-labelledby="coaching-quality-title" className="pulse-card p-4">
          <h3 id="coaching-quality-title" className="flex items-center gap-2 text-sm font-semibold">
            <MessageSquareText aria-hidden className="size-4 text-pulse-indigo" />
            Dialogue coaching and evidence quality
          </h3>
          <dl className="mt-3 grid gap-3 @sm:grid-cols-3">
            <div className="rounded-pulse-md bg-pulse-surface-2/60 p-3">
              <dt className="pulse-label">Dialogue coaching</dt>
              <dd className="pulse-metric mt-1 text-lg font-semibold text-pulse-primary">
                {analytics.dialogueCoaching.averageScore === null
                  ? <span className="text-xs font-medium text-pulse-muted">Not demonstrated</span>
                  : `${Math.round(analytics.dialogueCoaching.averageScore)} / 100`}
              </dd>
              <dd className="mt-1 text-xs text-pulse-muted">{analytics.dialogueCoaching.evaluatedAttempts} evaluated attempts · local-judge signal</dd>
            </div>
            <div className="rounded-pulse-md bg-pulse-surface-2/60 p-3">
              <dt className="pulse-label">Recency</dt>
              <dd className="pulse-metric mt-1 text-xs font-semibold text-pulse-secondary">
                {formatDateTime(analytics.recency.lastEligibleAttemptAt)}
              </dd>
              <dd className="mt-1 break-words text-xs text-pulse-muted">
                Evidence version: {analytics.recency.curriculumVersion ?? 'Insufficient evidence'}
              </dd>
            </div>
            <div className="rounded-pulse-md bg-pulse-surface-2/60 p-3">
              <dt className="pulse-label">Evidence confidence</dt>
              <dd className="mt-1">
                <span className={cn(
                  'pulse-pill',
                  analytics.evidenceConfidence === 'adequate' && 'pulse-pill-emerald',
                  analytics.evidenceConfidence === 'emerging' && 'pulse-pill-amber',
                )}>
                  {analytics.evidenceConfidence === 'insufficient' ? 'Insufficient evidence' : analytics.evidenceConfidence === 'emerging' ? 'Emerging' : 'Adequate'}
                </span>
              </dd>
              <dd className="mt-2 text-xs leading-relaxed text-pulse-muted">Based on coverage, independence, recency, and consistency.</dd>
            </div>
          </dl>
          <div className="mt-3 rounded-pulse-md border border-pulse-border-subtle p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-pulse-secondary">
              <FileSearch aria-hidden className="size-3.5" />
              Provenance: <span className="text-pulse-muted">Insufficient evidence in aggregate</span>
            </p>
            <p className="mt-1 text-xs leading-relaxed text-pulse-muted">
              This summary does not include per-attempt provenance. Inspect the evidence drill-down to verify eligible live or validated
              imported work. Replay and unverified legacy records cannot satisfy current certification gates.
            </p>
          </div>
        </section>
      </div>

      <section aria-labelledby="traceable-evidence-title" className="pulse-card overflow-hidden">
        <div className="border-b border-pulse-border-subtle p-4">
          <h3 id="traceable-evidence-title" className="flex items-center gap-2 text-sm font-semibold">
            <Clock3 aria-hidden className="size-4 text-pulse-indigo" />
            Traceable evidence
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-pulse-muted">
            Attempt and session identifiers connect every aggregate to its source records. Empty references are not treated as passing
            evidence.
          </p>
        </div>
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-pulse-secondary hover:bg-pulse-surface-2/40 [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden className="size-4 text-pulse-muted transition-transform group-open:rotate-90" />
            Inspect attempt and session IDs
            <span className="pulse-pill pulse-metric ml-auto">
              {analytics.evidenceRefs.attemptIds.length + analytics.evidenceRefs.sessionIds.length} references
            </span>
          </summary>
          <div className="grid gap-5 border-t border-pulse-border-subtle p-4 @lg:grid-cols-2">
            <EvidenceIdList label="Attempt IDs" ids={analytics.evidenceRefs.attemptIds} />
            <EvidenceIdList label="Session IDs" ids={analytics.evidenceRefs.sessionIds} />
          </div>
        </details>
        {evidenceDrillDown ? (
          <div className="border-t border-pulse-border-subtle p-4">
            <h4 className="pulse-label mb-3">Evidence drill-down</h4>
            {evidenceDrillDown}
          </div>
        ) : null}
      </section>
    </section>
  );
}
