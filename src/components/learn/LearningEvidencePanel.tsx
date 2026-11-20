import { Award, ChevronDown, Circle, CircleCheck, Info } from 'lucide-react';
import type {
  CertificationDoc,
  CertificationStatus,
  LearningAnalytics,
  ScenarioCoverageDoc,
} from '@/lib/schemas/learning';
import { SIM_COPY, VERBAL_ONLY } from '@/lib/policy/training-policy';
import { cn } from '@/lib/utils';

export interface LearningEvidencePanelProps {
  analytics: LearningAnalytics;
  certification: CertificationDoc | null;
  /** Full current-version scenario records. Without these, only aggregate coverage is available. */
  scenarioCoverage?: ScenarioCoverageDoc[];
  /** Optional display names keyed by scenario ID. */
  scenarioLabels?: Record<string, string>;
  /** Optional human labels (for example the Checkpoint title) keyed by rule ID. Raw IDs are never shown to learners. */
  ruleLabels?: Record<string, string>;
}

export const CERTIFICATION_LABELS: Record<CertificationStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  ready_for_trainer_review: 'Awaiting Trainer review',
  certified: 'Certified',
  recertification_required: 'Recertify',
  expired: 'Expired',
  revoked: 'Revoked',
};

const SCENARIO_LABELS: Record<ScenarioCoverageDoc['status'], string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  passed: 'Passed',
  remediation_required: 'Retry needed',
};

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
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

export interface CertificationStep {
  label: string;
  done: boolean;
  detail?: string;
}

/**
 * The learner's path to certification as a short checklist. Copy is action-oriented and never
 * mentions dialer-era workflow or disposition steps while Verbal Practice is the active mode.
 */
export function certificationSteps(analytics: LearningAnalytics, certification: CertificationDoc | null): CertificationStep[] {
  const completion = analytics.contentCompletion;
  const mastery = analytics.currentMastery;
  const retention = analytics.delayedRetention;
  const scenarios = analytics.scenarioCoverage;
  const workflow = analytics.workflowAccuracy;
  const steps: CertificationStep[] = [];

  if (completion.total > 0) {
    steps.push({
      label: 'Finish every Checkpoint',
      done: completion.completed >= completion.total,
      detail: `${completion.completed} of ${completion.total}`,
    });
  }
  if (mastery.total > 0) {
    steps.push({
      label: 'Recall each Playbook rule again on a later day',
      done: mastery.mastered >= mastery.total,
      detail: `${mastery.mastered} of ${mastery.total} rules`,
    });
  }
  if (retention.due > 0) {
    steps.push({
      label: 'Clear the reviews that are due',
      done: retention.completed >= retention.due && retention.correct >= retention.completed,
      detail: `${Math.max(0, retention.due - retention.completed)} due`,
    });
  }
  if (scenarios.total > 0) {
    steps.push({
      label: `Pass every ${SIM_COPY.singular} scenario`,
      done: scenarios.passed >= scenarios.total,
      detail: `${scenarios.passed} of ${scenarios.total}`,
    });
  }
  if (!VERBAL_ONLY && workflow.total > 0) {
    steps.push({
      label: 'Complete every required call action without error',
      done: workflow.clean >= workflow.total,
      detail: `${workflow.clean} of ${workflow.total}`,
    });
  }
  if (analytics.compliance.criticalFailureCount > 0) {
    steps.push({
      label: 'Pass again after a critical miss',
      done: false,
      detail: `${analytics.compliance.criticalFailureCount} recorded`,
    });
  }
  if (certification?.status === 'recertification_required') {
    steps.push({ label: `Retake the assessment for version ${certification.curriculumVersion}`, done: false });
  } else if (certification?.status === 'expired') {
    steps.push({ label: 'Retake the assessment on the current version', done: false });
  } else if (certification?.status === 'revoked') {
    steps.push({ label: 'A Trainer must review your new attempts', done: false });
  }
  return steps;
}

/** Compact learner progress + certification summary for one Track. Detail stays collapsed by default. */
export function LearningEvidencePanel({
  analytics,
  certification,
  scenarioCoverage = [],
  scenarioLabels = {},
  ruleLabels = {},
}: LearningEvidencePanelProps) {
  const status = certification?.status ?? analytics.certificationStatus;
  const steps = certificationSteps(analytics, certification);
  const doneCount = steps.filter((step) => step.done).length;
  const outstandingAreas = [
    ...new Set(analytics.outstandingRuleIds.map((ruleId) => ruleLabels[ruleId]).filter((label): label is string => Boolean(label))),
  ];
  const unlabeledOutstanding = analytics.outstandingRuleIds.filter((ruleId) => !ruleLabels[ruleId]).length;
  const certifiedAt = formatDate(certification?.certifiedAt);
  const expiresAt = formatDate(certification?.expiresAt);
  const recertifyAt = formatDate(certification?.recertificationRequiredAt);

  return (
    <section aria-labelledby="learning-evidence-title" className="pulse-card flex min-w-0 flex-col gap-3 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="learning-evidence-title" className="flex items-center gap-2 text-sm font-semibold text-pulse-primary">
          <Award aria-hidden className="size-4 text-pulse-indigo" />
          Path to certification
          {steps.length > 0 ? (
            <span className="pulse-metric text-xs font-medium text-pulse-muted">
              {doneCount}/{steps.length}
            </span>
          ) : null}
        </h2>
        <span className={cn('pulse-pill', certificationTone(status))}>{CERTIFICATION_LABELS[status]}</span>
      </header>

      {steps.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {steps.map((step) => (
            <li key={step.label} className="flex min-w-0 items-start gap-2 text-sm">
              {step.done ? (
                <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-pulse-emerald" />
              ) : (
                <Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-pulse-muted" />
              )}
              <span className={cn('min-w-0', step.done ? 'text-pulse-muted line-through decoration-pulse-muted/50' : 'text-pulse-secondary')}>
                {step.label}
                {step.detail ? <span className="pulse-metric ml-1.5 text-xs text-pulse-muted">{step.detail}</span> : null}
                <span className="sr-only">{step.done ? ' (done)' : ' (to do)'}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {certifiedAt ? (
        <p className="text-xs text-pulse-muted">
          Certified <span className="pulse-metric text-pulse-secondary">{certifiedAt}</span>
          {expiresAt ? (
            <>
              {' '}· expires <span className="pulse-metric text-pulse-secondary">{expiresAt}</span>
            </>
          ) : null}
          {recertifyAt ? (
            <>
              {' '}· recertify by <span className="pulse-metric text-pulse-secondary">{recertifyAt}</span>
            </>
          ) : null}
        </p>
      ) : null}
      {certification?.revocationReason ? (
        <p className="rounded-pulse-md border border-pulse-crimson/30 bg-pulse-crimson/10 px-3 py-2 text-xs text-pulse-secondary">
          <span className="font-semibold text-pulse-crimson">Revoked:</span> {certification.revocationReason}
        </p>
      ) : null}

      {outstandingAreas.length > 0 || unlabeledOutstanding > 0 || scenarioCoverage.length > 0 ? (
        <details className="group border-t border-pulse-border-subtle pt-2">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-pulse-secondary hover:text-pulse-primary">
            <ChevronDown aria-hidden className="size-3.5 transition-transform group-open:rotate-180" />
            Details
          </summary>
          <div className="mt-2 flex flex-col gap-3 text-xs">
            {outstandingAreas.length > 0 || unlabeledOutstanding > 0 ? (
              <div>
                <p className="pulse-label">Rules still to recall later</p>
                <p className="mt-1 text-pulse-secondary">
                  {outstandingAreas.join(' · ')}
                  {unlabeledOutstanding > 0
                    ? `${outstandingAreas.length > 0 ? ' · ' : ''}${unlabeledOutstanding} more ${unlabeledOutstanding === 1 ? 'rule' : 'rules'}`
                    : ''}
                </p>
                <p className="mt-0.5 text-pulse-muted">These clear when you answer them correctly in Retention on a later visit.</p>
              </div>
            ) : null}
            {scenarioCoverage.length > 0 ? (
              <div>
                <p className="pulse-label">{SIM_COPY.singular}</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {scenarioCoverage.map((scenario) => (
                    <li key={scenario.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-pulse-secondary">
                        {scenarioLabels[scenario.scenarioId] ?? 'Scenario'}
                      </span>
                      <span className={cn('pulse-pill shrink-0', scenarioTone(scenario.status))}>{SCENARIO_LABELS[scenario.status]}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}

      <p className="flex items-start gap-1.5 text-[0.7rem] leading-snug text-pulse-muted">
        <Info aria-hidden className="mt-px size-3 shrink-0" />
        Training certification is not sign-off for live calls. Your supervisor decides that separately.
      </p>
    </section>
  );
}
