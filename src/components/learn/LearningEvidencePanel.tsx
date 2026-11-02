import type { ReactNode } from 'react';
import {
  AlertTriangle,
  Award,
  BookOpen,
  CalendarClock,
  Check,
  ClipboardCheck,
  FileSearch,
  ListChecks,
  ShieldAlert,
} from 'lucide-react';
import type {
  CertificationDoc,
  CertificationStatus,
  LearningAnalytics,
  ScenarioAttemptEvidence,
  ScenarioCoverageDoc,
} from '@/lib/schemas/learning';
import { cn } from '@/lib/utils';

export interface LearningEvidencePanelProps {
  analytics: LearningAnalytics;
  certification: CertificationDoc | null;
  /** Full current-version scenario records. Without these, only aggregate coverage is available. */
  scenarioCoverage?: ScenarioCoverageDoc[];
  /** Optional display names keyed by scenario ID. */
  scenarioLabels?: Record<string, string>;
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

const SCENARIO_LABELS: Record<ScenarioCoverageDoc['status'], string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  passed: 'Passed',
  remediation_required: 'Needs remediation',
};

const PROVENANCE_LABELS: Record<ScenarioAttemptEvidence['provenance'], string> = {
  local_ai: 'Local AI assessment',
  manual_chat: 'Manual assessed chat',
  imported_legacy: 'Imported legacy evidence',
};

function formatDate(value: string | null): string {
  if (!value) return 'Not demonstrated';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Insufficient evidence' : date.toISOString().slice(0, 10);
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Not demonstrated';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Insufficient evidence';
  return `${date.toISOString().slice(0, 10)} · ${date.toISOString().slice(11, 16)} UTC`;
}

function certificationTone(status: CertificationStatus): string {
  if (status === 'certified') return 'pulse-pill-emerald';
  if (status === 'expired' || status === 'revoked') return 'pulse-pill-crimson';
  if (status === 'in_progress' || status === 'ready_for_trainer_review' || status === 'recertification_required') {
    return 'pulse-pill-amber';
  }
  return '';
}

function scenarioTone(status: ScenarioCoverageDoc['status']): string {
  if (status === 'passed') return 'pulse-pill-emerald';
  if (status === 'remediation_required') return 'pulse-pill-crimson';
  if (status === 'in_progress') return 'pulse-pill-amber';
  return '';
}

function latestAttempt(record: ScenarioCoverageDoc): ScenarioAttemptEvidence | null {
  return record.attemptHistory.reduce<ScenarioAttemptEvidence | null>((latest, attempt) => {
    if (!latest || Date.parse(attempt.evaluatedAt) > Date.parse(latest.evaluatedAt)) return attempt;
    return latest;
  }, null);
}

interface MetricProps {
  label: string;
  description: string;
  numerator: number;
  denominator: number;
  ratio: number | null;
  countLabel: string;
  icon: ReactNode;
  meta?: string;
}

function EvidenceMetric({ label, description, numerator, denominator, ratio, countLabel, icon, meta }: MetricProps) {
  const demonstrated = denominator > 0 && ratio !== null;
  const percent = demonstrated ? Math.round(ratio * 100) : null;
  return (
    <div className="pulse-card flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-pulse-primary">
            <span className="text-pulse-muted" aria-hidden>{icon}</span>
            {label}
          </h3>
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
      <p className="pulse-metric text-xs text-pulse-secondary">
        {numerator} / {denominator} <span className="font-sans text-pulse-muted">{countLabel}</span>
        {meta ? <span className="font-sans text-pulse-muted"> · {meta}</span> : null}
      </p>
    </div>
  );
}

function CertificationBadge({ status }: { status: CertificationStatus }) {
  return <span className={cn('pulse-pill', certificationTone(status))}>{CERTIFICATION_LABELS[status]}</span>;
}

function certificationRequirements(analytics: LearningAnalytics, certification: CertificationDoc | null): string[] {
  const requirements: string[] = [];
  const completion = analytics.contentCompletion;
  const mastery = analytics.currentMastery;
  const retention = analytics.delayedRetention;
  const scenarios = analytics.scenarioCoverage;
  const workflow = analytics.workflowAccuracy;

  if (completion.total > 0 && completion.completed < completion.total) {
    requirements.push('Complete all assigned content in the current curriculum version.');
  }
  if (mastery.total > 0 && mastery.mastered < mastery.total) {
    requirements.push('Demonstrate current mastery for every required rule through varied, independent evidence.');
  }
  if (retention.due > retention.completed || retention.correct < retention.completed) {
    requirements.push('Complete due spaced reviews and address any remaining retention gaps.');
  }
  if (scenarios.total > 0 && scenarios.passed < scenarios.total) {
    requirements.push('Pass every required scenario and branch; an easier scenario cannot substitute for missing coverage.');
  }
  if (workflow.total > 0 && workflow.clean < workflow.total) {
    requirements.push('Demonstrate every required workflow action set without error, including a valid disposition.');
  }
  if (analytics.compliance.criticalFailureCount > 0) {
    requirements.push('Address critical failures with new assessed evidence; earlier attempts remain in the evidence history.');
  }
  if (certification?.status === 'recertification_required') {
    requirements.push(`Complete the reassessment assigned for curriculum version ${certification.curriculumVersion}.`);
  } else if (certification?.status === 'expired') {
    requirements.push('Complete a new current-version assessment; the expired certification cannot establish current competence.');
  } else if (certification?.status === 'revoked') {
    requirements.push('Trainer review and new eligible evidence are required before certification can be reconsidered.');
  }
  return requirements;
}

/** Learner-facing, versioned evidence summary. It intentionally makes no live-work readiness claim. */
export function LearningEvidencePanel({
  analytics,
  certification,
  scenarioCoverage,
  scenarioLabels = {},
}: LearningEvidencePanelProps) {
  const spacedReviews = [...analytics.upcomingReviews]
    .filter((review) => review.nextAttemptKind === 'spaced_review')
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  const scenarioRemaining = Math.max(0, analytics.scenarioCoverage.total - analytics.scenarioCoverage.passed);
  const unitemizedScenarios = Math.max(0, analytics.scenarioCoverage.total - (scenarioCoverage?.length ?? 0));
  const requirements = certificationRequirements(analytics, certification);
  const status = certification?.status ?? analytics.certificationStatus;
  const version = certification?.curriculumVersion ?? analytics.curriculumVersion;
  const complianceEntries = Object.entries(analytics.compliance.byRule).sort((a, b) => b[1] - a[1]);

  return (
    <section aria-labelledby="learning-evidence-title" className="pulse-cq flex w-full min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="pulse-label">Learning evidence</p>
          <h2 id="learning-evidence-title" className="mt-1 text-xl font-semibold tracking-tight text-pulse-primary">
            Progress, mastery, and certification
          </h2>
          <p className="mt-1 text-sm text-pulse-muted">
            Track <span className="pulse-metric text-pulse-secondary">{analytics.trackId}</span> · current version{' '}
            <span className="pulse-metric text-pulse-secondary">{analytics.curriculumVersion}</span>
          </p>
        </div>
        <CertificationBadge status={status} />
      </header>

      <div role="note" className="flex gap-3 rounded-pulse-lg border border-pulse-amber/40 bg-pulse-amber/10 p-4">
        <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-pulse-amber" />
        <div>
          <h3 className="text-sm font-semibold text-pulse-primary">Simulated evidence is not live-call authorization</h3>
          <p className="mt-1 text-sm leading-relaxed text-pulse-secondary">
            Completion, mastery, scenario results, and certification describe training evidence only. Live-call authorization is a
            separate operational decision and may require supervised live calls.
          </p>
        </div>
      </div>

      <div className="grid gap-3 @lg:grid-cols-2">
        <EvidenceMetric
          label="Content complete"
          description="Assigned briefings and items completed. This is separate from knowledge mastery."
          numerator={analytics.contentCompletion.completed}
          denominator={analytics.contentCompletion.total}
          ratio={analytics.contentCompletion.ratio}
          countLabel="items completed"
          icon={<BookOpen className="size-4" />}
        />
        <EvidenceMetric
          label="Current mastery"
          description="Required rules currently meeting the mastery policy through varied, server-scored evidence."
          numerator={analytics.currentMastery.mastered}
          denominator={analytics.currentMastery.total}
          ratio={analytics.currentMastery.ratio}
          countLabel="rules mastered"
          icon={<Check className="size-4" />}
        />
      </div>

      <div className="grid gap-4 @xl:grid-cols-2">
        <section aria-labelledby="outstanding-rules-title" className="pulse-card p-4">
          <div className="flex items-center gap-2">
            <ListChecks aria-hidden className="size-4 text-pulse-amber" />
            <h3 id="outstanding-rules-title" className="text-sm font-semibold">Rules needing review</h3>
          </div>
          {analytics.outstandingRuleIds.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-2">
              {analytics.outstandingRuleIds.map((ruleId) => {
                const failures = analytics.compliance.byRule[ruleId] ?? 0;
                return (
                  <li key={ruleId} className="rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-2/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <code className="break-all text-xs font-semibold text-pulse-primary">{ruleId}</code>
                      {failures > 0 ? (
                        <span className="pulse-pill pulse-pill-crimson pulse-metric">{failures} critical {failures === 1 ? 'failure' : 'failures'}</span>
                      ) : null}
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-pulse-muted">
                      {failures > 0
                        ? 'Review the approved source, then repeat the relevant confirmation scenario with new assessed evidence.'
                        : 'Review the approved source and complete varied retrieval plus the relevant scenario application.'}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-pulse-muted">No outstanding rule IDs are listed in this evidence summary.</p>
          )}
        </section>

        <section aria-labelledby="spaced-reviews-title" className="pulse-card p-4">
          <div className="flex items-center gap-2">
            <CalendarClock aria-hidden className="size-4 text-pulse-indigo" />
            <h3 id="spaced-reviews-title" className="text-sm font-semibold">Upcoming spaced reviews</h3>
          </div>
          <p className="mt-1 text-xs text-pulse-muted">
            {analytics.delayedRetention.due} due · {analytics.delayedRetention.completed} completed ·{' '}
            {analytics.delayedRetention.correct} correct
          </p>
          {spacedReviews.length > 0 ? (
            <ol className="mt-3 flex flex-col gap-2">
              {spacedReviews.map((review) => (
                <li key={review.id} className="flex flex-col gap-2 rounded-pulse-md border border-pulse-border-subtle p-3 @sm:flex-row @sm:items-center @sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-pulse-primary">{review.drillId}</p>
                    <p className="mt-0.5 break-words text-xs text-pulse-muted">
                      {review.ruleIds.length > 0 ? review.ruleIds.join(' · ') : 'Rule IDs: Insufficient evidence'}
                    </p>
                  </div>
                  <div className="shrink-0 @sm:text-right">
                    <p className="pulse-metric text-xs font-semibold text-pulse-secondary">{formatDate(review.dueAt)}</p>
                    <p className="mt-0.5 text-[0.68rem] text-pulse-muted">Review stage {review.intervalIndex + 1}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-pulse-muted">No spaced reviews are currently scheduled.</p>
          )}
        </section>
      </div>

      <section aria-labelledby="scenario-coverage-title" className="pulse-card overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-pulse-border-subtle p-4">
          <div>
            <h3 id="scenario-coverage-title" className="flex items-center gap-2 text-sm font-semibold">
              <ClipboardCheck aria-hidden className="size-4 text-pulse-indigo" />
              Required scenario coverage
            </h3>
            <p className="mt-1 text-xs text-pulse-muted">Every required branch must be passed in the current version.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="pulse-pill pulse-pill-emerald pulse-metric">{analytics.scenarioCoverage.passed} passed</span>
            <span className={cn('pulse-pill pulse-metric', scenarioRemaining > 0 && 'pulse-pill-amber')}>
              {scenarioRemaining} remaining
            </span>
          </div>
        </div>
        {!scenarioCoverage || scenarioCoverage.length === 0 ? (
          <div className="p-4">
            <p className="text-sm font-semibold text-pulse-secondary">Scenario detail: Insufficient evidence</p>
            <p className="mt-1 text-sm leading-relaxed text-pulse-muted">
              Only aggregate coverage is available. Individual passed, remaining, and remediation states cannot be shown without the
              current-version scenario records.
            </p>
          </div>
        ) : (
          <ul className="grid gap-3 p-4 @lg:grid-cols-2">
            {scenarioCoverage.map((scenario) => {
              const latest = latestAttempt(scenario);
              return (
                <li key={scenario.id} className="flex min-w-0 flex-col gap-3 rounded-pulse-md border border-pulse-border-subtle p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="break-words text-sm font-semibold text-pulse-primary">
                        {scenarioLabels[scenario.scenarioId] ?? scenario.scenarioId}
                      </h4>
                      <p className="mt-0.5 break-all text-[0.68rem] text-pulse-muted">{scenario.scenarioId}</p>
                    </div>
                    <span className={cn('pulse-pill shrink-0', scenarioTone(scenario.status))}>{SCENARIO_LABELS[scenario.status]}</span>
                  </div>
                  <div>
                    <p className="pulse-label">Required gates</p>
                    {scenario.requiredGateIds.length > 0 ? (
                      <ul className="mt-1 flex flex-wrap gap-1.5">
                        {scenario.requiredGateIds.map((gateId) => (
                          <li key={gateId} className="rounded-pulse-sm bg-pulse-surface-2 px-2 py-1 text-[0.68rem] text-pulse-secondary">{gateId}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs text-pulse-muted">Insufficient evidence</p>
                    )}
                  </div>
                  <div className="rounded-pulse-md bg-pulse-surface-2/60 p-3 text-xs leading-relaxed">
                    <p className="pulse-label">Latest assessed feedback</p>
                    {latest ? (
                      <div className="mt-1.5 flex flex-col gap-1.5">
                        <p className="text-pulse-secondary">
                          Workflow:{' '}
                          <span className={latest.workflowComplete ? 'text-pulse-emerald' : 'font-semibold text-pulse-amber'}>
                            {latest.workflowComplete ? 'Complete' : 'Incomplete — required actions remain'}
                          </span>
                        </p>
                        <p className="text-pulse-secondary">
                          Disposition:{' '}
                          <span className={latest.dispositionValid ? 'text-pulse-emerald' : 'font-semibold text-pulse-amber'}>
                            {latest.dispositionValid ? 'Valid' : 'Not valid — repeat the wrap-up evidence gate'}
                          </span>
                        </p>
                        <p className="text-pulse-muted">
                          {PROVENANCE_LABELS[latest.provenance]} · {formatDateTime(latest.evaluatedAt)}
                        </p>
                        {latest.criticalFailureRuleIds.length > 0 ? (
                          <p className="text-pulse-crimson">Critical rules: {latest.criticalFailureRuleIds.join(' · ')}</p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-1 text-pulse-muted">Not demonstrated — no assessed attempt is recorded.</p>
                    )}
                  </div>
                  <p className="text-[0.68rem] text-pulse-muted">
                    {scenario.attemptHistory.length} assessed {scenario.attemptHistory.length === 1 ? 'attempt' : 'attempts'} ·{' '}
                    {scenario.passingSessionIds.length} passing {scenario.passingSessionIds.length === 1 ? 'session' : 'sessions'} · last session{' '}
                    {scenario.lastSessionId ? <code className="break-all">{scenario.lastSessionId}</code> : 'Not demonstrated'}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {unitemizedScenarios > 0 ? (
          <p className="border-t border-pulse-border-subtle bg-pulse-amber/5 px-4 py-3 text-sm text-pulse-secondary">
            <span className="font-semibold">Insufficient evidence:</span> {unitemizedScenarios} required{' '}
            {unitemizedScenarios === 1 ? 'scenario is' : 'scenarios are'} not represented in the supplied records. Their states remain
            unverified.
          </p>
        ) : null}
      </section>

      <div className="grid gap-4 @xl:grid-cols-2">
        <section aria-labelledby="compliance-feedback-title" className="pulse-card p-4">
          <h3 id="compliance-feedback-title" className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle aria-hidden className="size-4 text-pulse-amber" />
            Workflow and compliance feedback
          </h3>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-pulse-md bg-pulse-surface-2/60 p-3">
              <dt className="pulse-label">Workflow accuracy</dt>
              <dd className="pulse-metric mt-1 text-lg font-semibold text-pulse-primary">
                {analytics.workflowAccuracy.total > 0 && analytics.workflowAccuracy.ratio !== null
                  ? `${Math.round(analytics.workflowAccuracy.ratio * 100)}%`
                  : <span className="text-xs font-medium text-pulse-muted">Not demonstrated</span>}
              </dd>
              <dd className="mt-1 text-xs text-pulse-muted">{analytics.workflowAccuracy.clean} clean / {analytics.workflowAccuracy.total} assessed action sets</dd>
            </div>
            <div className="rounded-pulse-md bg-pulse-surface-2/60 p-3">
              <dt className="pulse-label">Critical failures</dt>
              <dd className={cn('pulse-metric mt-1 text-lg font-semibold', analytics.compliance.criticalFailureCount > 0 ? 'text-pulse-crimson' : 'text-pulse-primary')}>
                {analytics.compliance.criticalFailureCount}
              </dd>
              <dd className="mt-1 text-xs text-pulse-muted">Recorded in the current evidence set; never averaged away.</dd>
            </div>
          </dl>
          {complianceEntries.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1.5">
              {complianceEntries.map(([ruleId, count]) => (
                <li key={ruleId} className="flex items-center justify-between gap-3 text-xs">
                  <code className="break-all text-pulse-secondary">{ruleId}</code>
                  <span className="pulse-metric shrink-0 font-semibold text-pulse-crimson">{count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs leading-relaxed text-pulse-muted">
              {analytics.compliance.criticalFailureCount === 0
                ? 'No rule-level critical failures are recorded. Other required evidence gates may still be outstanding.'
                : 'Insufficient evidence — the rule-level breakdown is unavailable.'}
            </p>
          )}
        </section>

        <section aria-labelledby="certification-status-title" className="pulse-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 id="certification-status-title" className="flex items-center gap-2 text-sm font-semibold">
                <Award aria-hidden className="size-4 text-pulse-indigo" />
                Certification
              </h3>
              <p className="mt-1 text-xs text-pulse-muted">Versioned training evidence, not operational authorization.</p>
            </div>
            <CertificationBadge status={status} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="pulse-label">Curriculum version</dt>
              <dd className="pulse-metric mt-1 break-words text-pulse-secondary">{version}</dd>
            </div>
            <div>
              <dt className="pulse-label">Certified at</dt>
              <dd className="pulse-metric mt-1 text-pulse-secondary">{formatDate(certification?.certifiedAt ?? null)}</dd>
            </div>
            <div>
              <dt className="pulse-label">Expires</dt>
              <dd className="pulse-metric mt-1 text-pulse-secondary">{formatDate(certification?.expiresAt ?? null)}</dd>
            </div>
            <div>
              <dt className="pulse-label">Recertification due</dt>
              <dd className="pulse-metric mt-1 text-pulse-secondary">{formatDate(certification?.recertificationRequiredAt ?? null)}</dd>
            </div>
          </dl>
          {certification?.revocationReason ? (
            <p className="mt-3 rounded-pulse-md border border-pulse-crimson/30 bg-pulse-crimson/10 p-3 text-xs leading-relaxed text-pulse-secondary">
              <span className="font-semibold text-pulse-crimson">Revocation reason:</span> {certification.revocationReason}
            </p>
          ) : null}
          <div className="mt-4">
            <h4 className="pulse-label">Current and recertification requirements</h4>
            {requirements.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-2">
                {requirements.map((requirement) => (
                  <li key={requirement} className="flex gap-2 text-xs leading-relaxed text-pulse-secondary">
                    <FileSearch aria-hidden className="mt-0.5 size-3.5 shrink-0 text-pulse-amber" />
                    {requirement}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-pulse-muted">
                No outstanding requirements are visible in this summary. The full blueprint and any trainer approval still govern
                certification; future source or policy changes may require recertification.
              </p>
            )}
            {!certification ? (
              <p className="mt-2 text-xs text-pulse-muted">Certification record and evidence dates: Not demonstrated.</p>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  );
}
