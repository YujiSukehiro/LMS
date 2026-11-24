import type { CanonicalPillarKey } from './curriculum';
import type { DivisionId, UserRole } from './domain';
import { rolesWith } from '@/lib/auth/rbac';

export const SESSION_COOKIE_NAME = '__session';
export const SESSION_COOKIE_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

/** Synthetic email domain used for LC-ID logins (LC-1042 -> lc-1042@roster.logicall.internal). */
export const LC_ID_EMAIL_DOMAIN = 'roster.logicall.internal';
export const LC_ID_PATTERN = /^LC-\d+$/i;

export const ALL_COHORTS_ID = 'ALL';

export interface SeedCohort {
  id: string;
  name: string;
  isInternal: boolean;
  defaultDivisionIds: DivisionId[];
}

/** The 8 seeded Cohort records. */
export const DEFAULT_COHORTS: readonly SeedCohort[] = [
  { id: 'INTERNAL', name: 'LogiCall Internal', isInternal: true, defaultDivisionIds: ['TELEHEALTH', 'INBOUND', 'OUTBOUND'] },
  { id: 'THS', name: 'THS (Nicaragua)', isInternal: false, defaultDivisionIds: ['TELEHEALTH', 'INBOUND'] },
  { id: 'NGA', name: 'NGA', isInternal: false, defaultDivisionIds: ['INBOUND'] },
  { id: 'DOZ', name: 'DOZ', isInternal: false, defaultDivisionIds: ['INBOUND'] },
  { id: 'ZIM', name: 'ZIM', isInternal: false, defaultDivisionIds: ['INBOUND'] },
  { id: 'MRR', name: 'MRR', isInternal: false, defaultDivisionIds: ['INBOUND'] },
  { id: 'CALL_CORE', name: 'Call Core', isInternal: false, defaultDivisionIds: ['OUTBOUND'] },
  { id: 'LATAM_DIRECT', name: 'LATAM Direct', isInternal: false, defaultDivisionIds: ['OUTBOUND'] },
] as const;

export const COHORT_IDS = DEFAULT_COHORTS.map((c) => c.id);

export const DIVISION_LABELS: Record<DivisionId, string> = {
  TELEHEALTH: 'Telehealth',
  INBOUND: 'Inbound Operations',
  OUTBOUND: 'Outbound Sales',
};

/** CSS custom property for each Division accent pill. */
export const DIVISION_COLOR_VARS: Record<DivisionId, string> = {
  TELEHEALTH: 'var(--div-telehealth)',
  INBOUND: 'var(--div-inbound)',
  OUTBOUND: 'var(--div-outbound)',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  TRAINER: 'Trainer',
  PARTNER_SUPERVISOR: 'Partner Supervisor',
  AGENT: 'Agent',
};

/** Roles with cross-Cohort visibility and Track authoring rights (derived from the RBAC matrix). */
export const INTERNAL_OPS_ROLES: readonly UserRole[] = rolesWith('tracks.author');
/** Roles that open the roster (derived from the RBAC matrix; per-action checks use `can`/`canManageUser`). */
export const ROSTER_ADMIN_ROLES: readonly UserRole[] = rolesWith('roster.view');
/** Roles that can open analytics (derived from the RBAC matrix). */
export const ANALYTICS_ROLES: readonly UserRole[] = rolesWith('analytics.view');

/** The 8 canonical CompetencyPillar keys and display labels (docs/04 §3.2). */
export const CANONICAL_PILLARS: ReadonlyArray<{ key: CanonicalPillarKey; label: string; shortLabel: string }> = [
  { key: 'verification_crm', label: 'Identity, Intake & CRM Verification', shortLabel: 'Verification & CRM' },
  { key: 'product_offer_terms', label: 'Product, Offer & Policy Accuracy', shortLabel: 'Offer & Policy' },
  { key: 'retention_objection', label: 'Save-Offer Ladder & Objection Handling', shortLabel: 'Save-Offer & Objections' },
  { key: 'escalation_triage', label: 'Escalation Triage & Required Info', shortLabel: 'Escalation Triage' },
  { key: 'compliance_boundaries', label: 'Regulatory, Payment & Clinical Boundaries', shortLabel: 'Compliance' },
  { key: 'empathy_communication', label: 'Empathy, De-escalation & Clarity', shortLabel: 'Empathy & Clarity' },
  { key: 'closing_next_steps', label: 'Resolution, Closing & Disposition Logging', shortLabel: 'Closing & Disposition' },
  { key: 'workflow_execution', label: 'Call-Flow & Sequence Adherence', shortLabel: 'Call-Flow' },
];

/** The 6 axes of the Agent Readiness Passport Skill Radar. */
export const RADAR_PILLAR_KEYS: readonly CanonicalPillarKey[] = [
  'verification_crm',
  'product_offer_terms',
  'retention_objection',
  'escalation_triage',
  'compliance_boundaries',
  'empathy_communication',
];

/** Strength color thresholds for heatmaps and gauges. */
export const STRENGTH_THRESHOLDS = { strong: 85, borderline: 70 } as const;

/** XP economy (shared by scoring service and learner UI). */
export const XP_RULES = {
  perFirstTryCorrectDrill: 15,
  perRecoveredDrill: 5,
  unitCompletionBonus: 50,
  simulationPass: 200,
} as const;

export const DEFAULT_SIM_PASS_THRESHOLD = 80;
export const SIM_DISPOSITION_PENALTY = 10;
export const SIM_AUTO_FAIL_SCORE_CAP = 59;
export const SIM_END_TOKEN = '<SIM_END>';

/** PDF upload guardrails. */
export const PDF_LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  maxPages: 80,
  minExtractedChars: 150,
  condensedBlueprintPageThreshold: 25,
} as const;

/** Minimum password length everywhere a password is set (invite, join, reset, change, import). Connor 2026-11-24. */
export const PASSWORD_MIN_LENGTH = 10;
