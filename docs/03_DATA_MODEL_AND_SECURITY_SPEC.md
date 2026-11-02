# 03 — Data Model, Zod Schemas & Security Specification

---

## 1. Firestore Database Edition & Collection Topology

* **Database Engine:** Google Cloud Firestore **Standard Edition**, `(default)` database instance (selected specifically because Standard Edition includes Google's **Always-Free Tier**: 1 GiB storage, 50,000 reads/day, 20,000 writes/day).
* **Region Recommendation:** `nam5` (US multi-region) or `us-central1` colocated with Cloud Run / Firebase App Hosting and Cloud Storage.

### 1.1 Collection Hierarchy at a Glance

```text
/databases/(default)/documents
├── /users/{uid}                                     # User profile, LC-ID, role, cohort, aggregated Skill Radar
├── /cohorts/{cohortId}                              # Internal & BPO Partner metadata (THS, NGA, DOZ, ZIM, MRR...)
├── /rosterInvites/{inviteId}                        # Pre-provisioned LC-ID / Email invites & Cohort Join Codes
├── /tracks/{trackId}                                # Campaign Track header, division, assigned cohorts, status
│   ├── /sourcePages/{pageId}                        # Extracted PDF page batches (Trainer/Admin/Server only)
│   └── /versions/{versionId}                        # Immutable learner-safe bundle (Checkpoints, Cards, Drills)
│       └── /secrets/{secretId}                      # Hidden simulation persona facts & grading rubrics (NEVER sent to Agent client!)
├── /enrollments/{enrollmentId}                      # Deterministic ID: `${uid}_${trackId}` — Agent's track mastery state
├── /simSessions/{sessionId}                         # Multi-turn Live Call Sim transcript & Rubric Evaluation
└── /analyticsRollups/{rollupId}                     # Pre-aggregated strengths, pass rates & missed-rule counters
```

---

## 2. Canonical TypeScript & Zod Schemas (`src/lib/schemas/`)

### 2.1 Core Identity, Divisions & Cohorts (`src/lib/schemas/domain.ts`)

```typescript
import { z } from 'zod';

export const DivisionIdSchema = z.enum(['TELEHEALTH', 'INBOUND', 'OUTBOUND']);
export type DivisionId = z.infer<typeof DivisionIdSchema>;

export const UserRoleSchema = z.enum([
  'SUPER_ADMIN',
  'ADMIN',
  'TRAINER',
  'PARTNER_SUPERVISOR',
  'AGENT',
]);
export type UserRole = z.infer<typeof UserRoleSchema>;

/**
 * Seeded default cohorts matching LogiCall's operational teams:
 * 'INTERNAL' | 'THS' | 'NGA' | 'DOZ' | 'ZIM' | 'MRR' | 'CALL_CORE' | 'LATAM_DIRECT'
 * Additional partner cohorts can be added dynamically by SUPER_ADMIN / ADMIN.
 */
export const CohortDocSchema = z.object({
  id: z.string().min(2).max(32),
  name: z.string().min(2).max(80),            // e.g., "THS (Nicaragua)"
  isInternal: z.boolean(),                    // true for 'INTERNAL', false for 3rd-party BPOs
  defaultDivisionIds: z.array(DivisionIdSchema),
  activeAgentCount: z.number().int().nonnegative(),
  joinCode: z.string().nullable(),            // Optional rotating code e.g. "THS-7842"
  joinCodeEnabled: z.boolean(),
  createdAt: z.number(),                      // Unix epoch ms
  updatedAt: z.number(),
});

export const UserPreferencesSchema = z.object({
  soundEffects: z.boolean().default(true),
  compactMode: z.boolean().default(false),
  theme: z.enum(['dark', 'light', 'system']).default('dark'),
});

// Accepts Unix epoch ms (number) or Firestore Timestamp (when serverTimestamp() is used on client preference updates)
export const TimestampOrEpochMsSchema = z.union([
  z.number(),
  z.object({ seconds: z.number(), nanoseconds: z.number() }),
]);

export const PillarStatSchema = z.object({
  pillarKey: z.string(),                      // Normalized slug e.g. "retention_execution"
  pillarLabel: z.string(),                    // Display label e.g. "Save-Offer & Retention"
  attempts: z.number().int().nonnegative(),
  weightedScoreSum: z.number().nonnegative(), // Rolling average = weightedScoreSum / attempts
  averageScore: z.number().min(0).max(100),
});

export const UserDocSchema = z.object({
  uid: z.string(),
  email: z.string().email(),                  // Real email OR synthetic `lc-1042@roster.logicall.internal`
  authMethod: z.enum(['GOOGLE_SSO', 'EMAIL_PASSWORD', 'LC_ID_PASSWORD']),
  lcNumber: z.string().nullable(),            // e.g., "LC-1042" (indexed uppercase for lookup)
  displayName: z.string().min(1).max(100),
  role: UserRoleSchema,
  partnerCohortId: z.string(),                // e.g., "INTERNAL", "THS", "DOZ"
  divisionIds: z.array(DivisionIdSchema),
  active: z.boolean(),                        // false immediately blocks login while keeping history!
  deactivatedAt: z.number().nullable(),
  stats: z.object({
    totalXp: z.number().int().nonnegative(),
    currentStreakDays: z.number().int().nonnegative(),
    lastActiveDateUtc: z.string().nullable(), // "YYYY-MM-DD"
    tracksCertifiedCount: z.number().int().nonnegative(),
    simulationsPassedCount: z.number().int().nonnegative(),
    overallReadinessScore: z.number().min(0).max(100),
  }),
  // Keyed by normalized pillarKey for instant O(1) Skill Radar rendering
  skillScoresByPillar: z.record(z.string(), PillarStatSchema),
  preferences: UserPreferencesSchema,
  createdAt: TimestampOrEpochMsSchema,
  updatedAt: TimestampOrEpochMsSchema, // Must use Firestore serverTimestamp() if updated directly from client
});
```

---

### 2.2 Campaign Tracks, Briefing Cards, 5 Drill Mechanics & Live Call Sims (`src/lib/schemas/curriculum.ts`)

```typescript
import { z } from 'zod';
import { DivisionIdSchema } from './domain';

export const CompetencyPillarSchema = z.object({
  id: z.string(),                             // e.g., "pillar_verification"
  key: z.string(),                            // Normalized cross-track key e.g. "identity_crm_verification"
  label: z.string(),                          // e.g., "Identity & CRM Verification"
  description: z.string(),
});

// --- STAGE 1: BRIEFING CARDS (LEARN) ---
export const BriefingCardSchema = z.object({
  id: z.string(),
  headline: z.string().max(90),
  bodyMarkdown: z.string().max(600),          // Concise operational rule (2-4 sentences max)
  keyTakeaway: z.string().max(160),           // Highlighted callout banner
  doList: z.array(z.string().max(140)).max(4),
  dontList: z.array(z.string().max(140)).max(4),
  sourcePages: z.array(z.number().int().positive()),
});

// --- STAGE 2: 5 INTERACTIVE DRILL MECHANICS (TEST) ---
const BaseDrillFields = {
  id: z.string(),
  competencyPillarId: z.string(),
  prompt: z.string().max(300),
  explanation: z.string().max(350),           // Displayed immediately after answering
  sourcePages: z.array(z.number().int().positive()),
};

export const MultipleChoiceDrillSchema = z.object({
  ...BaseDrillFields,
  kind: z.literal('MULTIPLE_CHOICE'),
  options: z.array(z.object({ id: z.string(), text: z.string().max(180) })).length(4),
  correctOptionId: z.string(),
});

export const TrueFalseSpotDrillSchema = z.object({
  ...BaseDrillFields,
  kind: z.literal('TRUE_FALSE_SPOT'),
  statement: z.string().max(260),
  isCompliant: z.boolean(),                   // true = Follows Policy, false = Policy Violation
});

export const SequenceOrderDrillSchema = z.object({
  ...BaseDrillFields,
  kind: z.literal('SEQUENCE_ORDER'),
  // Stored in canonical correct order in DB; client shuffles deterministically on render
  orderedSteps: z.array(z.object({ id: z.string(), text: z.string().max(140) })).min(3).max(5),
});

export const MatchPairsDrillSchema = z.object({
  ...BaseDrillFields,
  kind: z.literal('MATCH_PAIRS'),
  pairs: z.array(
    z.object({
      id: z.string(),
      leftPrompt: z.string().max(100),        // e.g., "Caller reports doctor-advised reaction"
      rightMatch: z.string().max(100),        // e.g., "Skip 25%/50% and offer immediate 70% refund"
    })
  ).min(3).max(4),
});

export const FillBlankChoiceDrillSchema = z.object({
  ...BaseDrillFields,
  kind: z.literal('FILL_BLANK_CHOICE'),
  // Template contains exact placeholder token "{{BLANK}}"
  sentenceTemplate: z.string().max(260),
  wordBank: z.array(z.string().max(60)).length(4),
  correctWord: z.string().max(60),
});

export const DrillItemSchema = z.discriminatedUnion('kind', [
  MultipleChoiceDrillSchema,
  TrueFalseSpotDrillSchema,
  SequenceOrderDrillSchema,
  MatchPairsDrillSchema,
  FillBlankChoiceDrillSchema,
]);

export const TrackUnitSchema = z.object({
  id: z.string(),
  orderIndex: z.number().int().nonnegative(),
  title: z.string().max(80),
  summary: z.string().max(180),
  estimatedMinutes: z.number().int().min(2).max(10),
  briefingCards: z.array(BriefingCardSchema).min(2).max(6),
  drills: z.array(DrillItemSchema).min(4).max(8),
});

// --- STAGE 3: LIVE CALL SIM (PUBLIC LEARNER VIEW VS. SERVER-ONLY SECRETS) ---
export const PublicSimScenarioSchema = z.object({
  id: z.string(),
  title: z.string().max(80),                  // e.g., "Medical Side-Effect Refund Request"
  difficulty: z.enum(['STANDARD', 'EDGE_CASE', 'HIGH_PRESSURE']),
  counterpartyRoleLabel: z.string().max(60),  // e.g., "Inbound Buyer" | "Telehealth Patient" | "Outbound Lead"
  contextTicketSummary: z.string().max(280),  // Displayed in agent header (Queue, Campaign, Channel)
  openingMessage: z.string().max(350),        // First message from the simulated caller/patient
  dispositionOptions: z.array(z.string().max(80)).min(3).max(6),
  maxTurns: z.number().int().min(6).max(12).default(8),
  passScoreThreshold: z.number().int().min(60).max(95).default(80),
});

export const RubricCriterionSchema = z.object({
  id: z.string(),
  competencyPillarId: z.string(),
  criterionLabel: z.string().max(100),
  evaluationRule: z.string().max(300),        // Exact PDF-grounded rule for the Judge LLM
  weight: z.number().int().min(10).max(50),   // Weights across a scenario sum to 100
  sourcePages: z.array(z.number().int().positive()),
});

// Stored ONLY in /tracks/{trackId}/versions/{versionId}/secrets/evalRubrics
export const SecretSimScenarioConfigSchema = z.object({
  scenarioId: z.string(),
  personaName: z.string(),
  personaBackstoryAndMood: z.string().max(400),
  hiddenFactsToRevealOnlyWhenAsked: z.array(z.string().max(180)), // e.g., Zip code, Order #, symptom detail
  conditionalBehaviors: z.array(z.string().max(220)),             // How persona reacts to good/bad offers
  expectedDisposition: z.string(),
  autoFailTriggers: z.array(z.string().max(180)),                 // e.g., Pushing upsell after medical stop
  rubricCriteria: z.array(RubricCriterionSchema).min(3).max(6),
});

export const TrackDocSchema = z.object({
  id: z.string(),
  title: z.string().min(3).max(100),
  campaignCode: z.string().max(32),           // e.g., "MVP", "FLOW-B", "TH-INTAKE"
  divisionId: DivisionIdSchema,
  status: z.enum(['GENERATING', 'DRAFT', 'PUBLISHED', 'ARCHIVED']),
  generationProgress: z.object({
    step: z.enum(['UPLOADING', 'EXTRACTING_PDF', 'BLUEPRINTING', 'BUILDING_UNITS', 'BUILDING_SIMS', 'READY', 'FAILED']),
    percent: z.number().min(0).max(100),
    message: z.string(),
  }),
  sourcePdfStoragePath: z.string(),
  sourcePdfFileName: z.string(),
  sourcePageCount: z.number().int().positive(),
  currentDraftVersionId: z.string(),
  publishedVersionId: z.string().nullable(),
  assignedCohortIds: z.array(z.string()),     // ['ALL'] or ['INTERNAL', 'THS', 'DOZ']
  competencyPillars: z.array(CompetencyPillarSchema),
  unitCount: z.number().int().nonnegative(),
  simScenarioCount: z.number().int().nonnegative(),
  estimatedTotalMinutes: z.number().int().nonnegative(),
  createdByUid: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// Bundled immutable learner payload (~40-120 KB, 1 single Firestore read!)
export const TrackVersionDocSchema = z.object({
  versionId: z.string(),
  trackId: z.string(),
  versionNumber: z.number().int().positive(),
  competencyPillars: z.array(CompetencyPillarSchema),
  units: z.array(TrackUnitSchema),
  simScenarios: z.array(PublicSimScenarioSchema),
  publishedAt: z.number().nullable(),
  createdAt: z.number(),
});
```

---

### 2.3 Enrollments, Simulation Transcripts & Strength Rollups (`src/lib/schemas/analytics.ts`)

```typescript
import { z } from 'zod';
import { DivisionIdSchema } from './domain';

export const EnrollmentDocSchema = z.object({
  id: z.string(),                             // `${userId}_${trackId}`
  userId: z.string(),
  userDisplayName: z.string(),
  partnerCohortId: z.string(),
  divisionId: DivisionIdSchema,
  trackId: z.string(),
  trackTitle: z.string(),
  versionId: z.string(),
  status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'CERTIFIED']),
  completedUnitIds: z.array(z.string()),
  passedScenarioIds: z.array(z.string()),
  unitScores: z.record(z.string(), z.object({
    firstTryAccuracyPct: z.number().min(0).max(100),
    attemptsCount: z.number().int().positive(),
    completedAt: z.number(),
  })),
  bestSimScorePct: z.number().min(0).max(100).nullable(),
  xpEarned: z.number().int().nonnegative(),
  progressPct: z.number().min(0).max(100),
  certifiedAt: z.number().nullable(),
  lastActivityAt: z.number(),
});

export const SimMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['counterparty', 'agent']),
  content: z.string(),
  createdAt: z.number(),
});

export const SimEvaluationSchema = z.object({
  overallScorePct: z.number().min(0).max(100),
  passed: z.boolean(),
  autoFailedReason: z.string().nullable(),
  dispositionCorrect: z.boolean(),
  summaryFeedback: z.string(),
  strengthsHighlighted: z.array(z.string()),
  coachingImprovements: z.array(z.string()),
  criterionResults: z.array(z.object({
    criterionId: z.string(),
    competencyPillarId: z.string(),
    criterionLabel: z.string(),
    score: z.enum(['0', '50', '100']).transform(Number).or(z.number()),
    agentQuoteEvidence: z.string(),
    coachingNote: z.string(),
    betterResponseExample: z.string().nullable(),
  })),
  evaluatedAt: z.number(),
});

export const SimSessionDocSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userDisplayName: z.string(),
  partnerCohortId: z.string(),
  divisionId: DivisionIdSchema,
  trackId: z.string(),
  versionId: z.string(),
  scenarioId: z.string(),
  scenarioTitle: z.string(),
  status: z.enum(['ACTIVE', 'READY_FOR_EVAL', 'EVALUATED', 'ABANDONED']),
  turnCount: z.number().int().nonnegative(),
  messages: z.array(SimMessageSchema),
  selectedDisposition: z.string().nullable(),
  evaluation: SimEvaluationSchema.nullable(),
  startedAt: z.number(),
  updatedAt: z.number(),
});

/**
 * Rollup document keys:
 * - "GLOBAL"
 * - "DIVISION_TELEHEALTH" | "DIVISION_INBOUND" | "DIVISION_OUTBOUND"
 * - "COHORT_INTERNAL" | "COHORT_THS" | "COHORT_DOZ" | ...
 * - "TRACK_{trackId}"
 */
export const AnalyticsRollupDocSchema = z.object({
  id: z.string(),
  scopeType: z.enum(['GLOBAL', 'DIVISION', 'COHORT', 'TRACK']),
  divisionId: DivisionIdSchema.nullable(),
  partnerCohortId: z.string().nullable(),
  trackId: z.string().nullable(),
  totalCertifications: z.number().int().nonnegative(),
  totalUnitCompletions: z.number().int().nonnegative(),
  totalSimAttempts: z.number().int().nonnegative(),
  totalSimPasses: z.number().int().nonnegative(),
  pillarAggregates: z.record(z.string(), z.object({
    pillarLabel: z.string(),
    sampleCount: z.number().int().nonnegative(),
    scoreSum: z.number().nonnegative(),
  })),
  // Map of `${trackId}__${itemId}` -> miss count + prompt snippet (powers Playbook Gap Detector)
  missedItemCounts: z.record(z.string(), z.object({
    trackId: z.string(),
    itemId: z.string(),
    itemLabel: z.string(),
    missCount: z.number().int().nonnegative(),
  })),
  updatedAt: z.number(),
});
```

---

## 3. Composite Indexes (`firestore.indexes.json`)

Only 3 lightweight composite indexes are needed (all others are single-field queries or direct document ID lookups):

```json
{
  "indexes": [
    {
      "collectionGroup": "users",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "partnerCohortId", "order": "ASCENDING" },
        { "fieldPath": "active", "order": "ASCENDING" },
        { "fieldPath": "stats.overallReadinessScore", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "enrollments",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "partnerCohortId", "order": "ASCENDING" },
        { "fieldPath": "lastActivityAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "simSessions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "partnerCohortId", "order": "ASCENDING" },
        { "fieldPath": "startedAt", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

---

## 4. Security Boundaries & Offboarding Guarantees

1. **Server-Authoritative Progression & Grading:** Firestore Security Rules ([`firestore.rules`](file:///Users/connor/Coding/Contracting/Logicall/Telehealth%20LMS/firestore.rules)) reject all direct client writes to `tracks`, `enrollments`, `simSessions`, `cohorts`, `rosterInvites`, and `analyticsRollups`. Agents cannot spoof XP, pass statuses, or simulation scores via browser DevTools.
2. **Anti-Cheat Secret Separation:** Hidden simulation facts (`hiddenFactsToRevealOnlyWhenAsked`), `autoFailTriggers`, and `rubricCriteria` are stored exclusively under `/tracks/{trackId}/versions/{versionId}/secrets/evalRubrics`, readable **only** by `SUPER_ADMIN`, `ADMIN`, `TRAINER`, and the backend Admin SDK.
3. **Hard BPO Partner Isolation:** A `PARTNER_SUPERVISOR` (e.g., `partnerCohortId == "THS"`) is cryptographically restricted via Firebase Custom Claims (`request.auth.token.partnerCohortId`) at both the Next.js API layer and Firestore Security Rules layer so they can never list or read users, enrollments, transcripts, or rollups belonging to `DOZ`, `NGA`, `ZIM`, `MRR`, or `INTERNAL`.
4. **Instant Zero-Data-Loss Offboarding:** Setting a user's status to `Inactive` via `/api/roster/[uid]/status` executes three atomic steps:
   * Updates `users/{uid}.active = false` and `deactivatedAt = Date.now()` (preserving 100% of historical completions, scores, and audit transcripts).
   * Updates Firebase Custom Claims to `{ ...claims, active: false }`.
   * Calls `adminAuth.updateUser(uid, { disabled: true })` and `adminAuth.revokeRefreshTokens(uid)` + clears session cookies, cutting off access immediately.
