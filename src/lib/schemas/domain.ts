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
  name: z.string().min(2).max(80), // e.g., "THS (Nicaragua)"
  isInternal: z.boolean(), // true for 'INTERNAL', false for 3rd-party BPOs
  defaultDivisionIds: z.array(DivisionIdSchema),
  activeAgentCount: z.number().int().nonnegative(),
  joinCode: z.string().nullable(), // Optional rotating code e.g. "THS-7842"
  joinCodeEnabled: z.boolean(),
  createdAt: z.number(), // Unix epoch ms
  updatedAt: z.number(),
});
export type CohortDoc = z.infer<typeof CohortDocSchema>;

export const UserPreferencesSchema = z.object({
  soundEffects: z.boolean().default(true),
  compactMode: z.boolean().default(false),
  // Keep in sync with THEME_IDS in src/lib/theme/themes.ts. Light is the default.
  theme: z.enum(['light', 'dark', 'contrast', 'system']).default('light'),
});
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

// Accepts Unix epoch ms (number) or Firestore Timestamp (when serverTimestamp() is used on client preference updates)
export const TimestampOrEpochMsSchema = z.union([
  z.number(),
  z.object({ seconds: z.number(), nanoseconds: z.number() }),
]);

export const PillarStatSchema = z.object({
  pillarKey: z.string(), // Normalized slug e.g. "retention_objection"
  pillarLabel: z.string(), // Display label e.g. "Save-Offer Ladder & Objection Handling"
  attempts: z.number().int().nonnegative(),
  weightedScoreSum: z.number().nonnegative(), // Rolling average = weightedScoreSum / attempts
  averageScore: z.number().min(0).max(100),
});
export type PillarStat = z.infer<typeof PillarStatSchema>;

export const UserStatsSchema = z.object({
  totalXp: z.number().int().nonnegative(),
  currentStreakDays: z.number().int().nonnegative(),
  lastActiveDateUtc: z.string().nullable(), // "YYYY-MM-DD"
  tracksCertifiedCount: z.number().int().nonnegative(),
  simulationsPassedCount: z.number().int().nonnegative(),
  overallReadinessScore: z.number().min(0).max(100),
});
export type UserStats = z.infer<typeof UserStatsSchema>;

export const UserDocSchema = z.object({
  uid: z.string(),
  email: z.string().email(), // Real email OR synthetic `lc-1042@roster.logicall.internal`
  authMethod: z.enum(['GOOGLE_SSO', 'EMAIL_PASSWORD', 'LC_ID_PASSWORD']),
  lcNumber: z.string().nullable(), // e.g., "LC-1042" (indexed uppercase for lookup)
  displayName: z.string().min(1).max(100),
  role: UserRoleSchema,
  partnerCohortId: z.string(), // e.g., "INTERNAL", "THS", "DOZ"
  divisionIds: z.array(DivisionIdSchema),
  active: z.boolean(), // false immediately blocks login while keeping history
  deactivatedAt: z.number().nullable(),
  stats: UserStatsSchema,
  // Keyed by normalized pillarKey for instant O(1) Skill Radar rendering
  skillScoresByPillar: z.record(z.string(), PillarStatSchema),
  preferences: UserPreferencesSchema,
  createdAt: TimestampOrEpochMsSchema,
  updatedAt: TimestampOrEpochMsSchema, // Must use Firestore serverTimestamp() if updated directly from client
});
export type UserDoc = z.infer<typeof UserDocSchema>;

/** Pre-provisioned LC-ID / email invite (collection `rosterInvites`). */
export const RosterInviteDocSchema = z.object({
  id: z.string(),
  email: z.string().email().nullable(),
  lcNumber: z.string().nullable(),
  displayName: z.string().min(1).max(100),
  role: UserRoleSchema,
  partnerCohortId: z.string(),
  divisionIds: z.array(DivisionIdSchema),
  status: z.enum(['PENDING', 'CLAIMED', 'REVOKED']),
  createdByUid: z.string(),
  claimedByUid: z.string().nullable(),
  expiresAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type RosterInviteDoc = z.infer<typeof RosterInviteDocSchema>;

/**
 * Trusted Firebase Custom Claims carried on every ID token / session cookie.
 * Must stay in sync with `users/{uid}` (see firestore.rules).
 */
export const PulseCustomClaimsSchema = z.object({
  role: UserRoleSchema,
  partnerCohortId: z.string().min(1).max(100),
  divisionIds: z.array(DivisionIdSchema),
  active: z.boolean(),
});
export type PulseCustomClaims = z.infer<typeof PulseCustomClaimsSchema>;

/** The verified user identity that server code receives from the auth guard. */
export const SessionUserSchema = z.object({
  uid: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: UserRoleSchema,
  partnerCohortId: z.string(),
  divisionIds: z.array(DivisionIdSchema),
  active: z.literal(true),
});
export type SessionUser = z.infer<typeof SessionUserSchema>;
