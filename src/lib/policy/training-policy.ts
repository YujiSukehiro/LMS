export type SimulationInteractionMode = 'verbal_only' | 'legacy_dialer';

export interface TrainingPolicyConfig {
  /**
   * Active simulation mode across learner UI, API routes, and Studio editor.
   * - `verbal_only`: Pure spoken/typed conversation graded on verbal responses and playbook knowledge (dialer/CRM panel removed).
   * - `legacy_dialer`: Historical synthetic dialer & CRM actions panel (deprecated per Connor 2026-11-17).
   */
  simulationInteractionMode: SimulationInteractionMode;
  /** GATE-02: Whether learners pick a call-wrap disposition at the end of Verbal Practice. */
  requireDispositionInVerbalPractice: boolean;
  /** GATE-03: Whether correct initial Checkpoint drills satisfy rule mastery in one sitting without waiting 10m/1d. */
  allowSameSittingRuleMastery: boolean;
  /** GATE-04: Whether Gemini (`hosted_ai`) simulation evaluations may grant official Track certification. */
  allowHostedAiForCertification: boolean;
  /** GATE-05: Whether learner Track visibility also enforces `user.divisionIds` in addition to Cohort assignment. */
  enforceLearnerDivisionVisibility: boolean;
}

export const TRAINING_POLICY: TrainingPolicyConfig = {
  simulationInteractionMode: 'verbal_only',
  requireDispositionInVerbalPractice: false,
  allowSameSittingRuleMastery: false,
  allowHostedAiForCertification: false,
  enforceLearnerDivisionVisibility: false,
};

export interface ApprovalGateEntry {
  id: string;
  title: string;
  status: 'PENDING_CONNOR';
  currentDefault: string;
  pausedScope: string;
  codeLocation: string;
}

export const APPROVAL_GATES: readonly ApprovalGateEntry[] = [
  {
    id: 'GATE-01',
    title: 'Permanent deletion of dormant dialer/CRM simulation code',
    status: 'PENDING_CONNOR',
    currentDefault: "simulationInteractionMode = 'verbal_only' (UI & active APIs stripped; legacy schemas/helpers preserved read-only)",
    pausedScope: 'Deleting scenario-state.ts, simulation-state.ts, SyntheticOperationsPanel.tsx, and /api/simulations/[sessionId]/action',
    codeLocation: 'src/lib/policy/training-policy.ts, src/lib/services/verbal-practice.ts',
  },
  {
    id: 'GATE-02',
    title: 'Call Disposition check at the end of Verbal Practice',
    status: 'PENDING_CONNOR',
    currentDefault: 'requireDispositionInVerbalPractice = false (Verbal Practice grades directly with no disposition modal)',
    pausedScope: 'Re-enabling a 1-question Playbook Disposition knowledge check vs permanent removal of disposition concepts',
    codeLocation: 'src/lib/policy/training-policy.ts, src/app/(dashboard)/learn/_components/SimulationRunner.tsx',
  },
  {
    id: 'GATE-03',
    title: 'Single-sitting certification vs delayed spaced-review gate',
    status: 'PENDING_CONNOR',
    currentDefault: 'allowSameSittingRuleMastery = false (single-drill spaced_review fixed; Retention Hub built)',
    pausedScope: 'Letting first-sitting Checkpoint completion unlock Campaign Certified immediately while Retention tracks ongoing Keep-Sharp health',
    codeLocation: 'src/lib/policy/training-policy.ts, src/lib/services/certification.ts',
  },
  {
    id: 'GATE-04',
    title: 'Hosted Gemini AI certification eligibility',
    status: 'PENDING_CONNOR',
    currentDefault: 'allowHostedAiForCertification = false (only local_ai and manual_chat certify)',
    pausedScope: 'Adding hosted_ai to LIVE_SESSION_SOURCES and EVALUATION_SOURCES for cloud production certification',
    codeLocation: 'src/lib/policy/training-policy.ts, src/lib/services/certification.ts',
  },
  {
    id: 'GATE-05',
    title: 'Learner Track visibility by divisionIds',
    status: 'PENDING_CONNOR',
    currentDefault: 'enforceLearnerDivisionVisibility = false (visibility filtered by assignedCohortIds)',
    pausedScope: 'Filtering learner tracks by user.divisionIds alongside partnerCohortId',
    codeLocation: 'src/lib/policy/training-policy.ts, src/lib/services/track-loader.ts',
  },
  {
    id: 'GATE-06',
    title: 'Git checkpoint commit & workspace consolidation',
    status: 'PENDING_CONNOR',
    currentDefault: 'All changes kept uncommitted inside upgrade-fork/; root prototype untouched',
    pausedScope: 'Committing feature/standard-meds-learning-upgrades and promoting upgrade-fork/ to workspace root',
    codeLocation: 'upgrade-fork/ vs workspace root',
  },
  {
    id: 'GATE-07',
    title: 'Standard Meds SME content sign-offs & publish readiness',
    status: 'PENDING_CONNOR',
    currentDefault: 'STANDARD_MEDS_SME_DECISIONS remain open; 9 packs remain unpublished drafts',
    pausedScope: 'Resolving SME-01..SME-10 pricing/policy conflicts and signing off excerpts for live agent assignment',
    codeLocation: 'src/lib/content/standard-meds/publication.ts',
  },
  {
    id: 'GATE-08',
    title: 'Production Firebase Auth, rate-limiting & Firestore Rules changes',
    status: 'PENDING_CONNOR',
    currentDefault: 'firestore.rules untouched; local emulator settings only',
    pausedScope: 'Disabling public email/password signup, requiring email_verified, Cloud Run timeouts, edge rate limiting, and any firestore.rules updates',
    codeLocation: 'firestore.rules, apphosting.yaml',
  },
] as const;

/** True when Simulations are verbal conversations only (no dialer, CRM or disposition UI). */
export const VERBAL_ONLY = TRAINING_POLICY.simulationInteractionMode === 'verbal_only';

/**
 * Learner- and staff-facing names for the Simulation step. Use these instead of hard-coding
 * "Live Call Sim" so copy never mentions dialer-era features while `verbal_only` is active.
 */
export const SIM_COPY = VERBAL_ONLY
  ? { singular: 'Verbal Practice', plural: 'Verbal Practice scenarios', short: 'Practice', shortPlural: 'Practice' }
  : { singular: 'Live Call Sim', plural: 'Live Call Sims', short: 'Sim', shortPlural: 'Sims' };
