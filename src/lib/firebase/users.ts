/**
 * Server-only helpers that build and synchronize `users/{uid}` documents and custom claims.
 */
import { randomInt } from 'node:crypto';
import { adminAuth } from './admin';
import {
  UserDocSchema,
  type DivisionId,
  type PulseCustomClaims,
  type UserDoc,
  type UserRole,
} from '@/lib/schemas/domain';

export type AuthMethod = UserDoc['authMethod'];

export function emptyUserStats(): UserDoc['stats'] {
  return {
    totalXp: 0,
    currentStreakDays: 0,
    lastActiveDateUtc: null,
    tracksCertifiedCount: 0,
    simulationsPassedCount: 0,
    overallReadinessScore: 0,
  };
}

export function defaultPreferences(): UserDoc['preferences'] {
  return { soundEffects: true, compactMode: false, theme: 'dark' };
}

export function buildNewUserDoc(input: {
  uid: string;
  email: string;
  authMethod: AuthMethod;
  lcNumber: string | null;
  displayName: string;
  role: UserRole;
  partnerCohortId: string;
  divisionIds: DivisionId[];
  nowMs?: number;
}): UserDoc {
  const now = input.nowMs ?? Date.now();
  return UserDocSchema.parse({
    uid: input.uid,
    email: input.email,
    authMethod: input.authMethod,
    lcNumber: input.lcNumber ? input.lcNumber.toUpperCase() : null,
    displayName: input.displayName.trim().slice(0, 100) || input.email,
    role: input.role,
    partnerCohortId: input.partnerCohortId,
    divisionIds: input.divisionIds,
    active: true,
    deactivatedAt: null,
    stats: emptyUserStats(),
    skillScoresByPillar: {},
    preferences: defaultPreferences(),
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Parse a stored user document. Missing optional blocks (stats, preferences, scores) are filled
 * with defaults so a partly written document never breaks sign-in.
 */
export function parseStoredUserDoc(uid: string, data: Record<string, unknown>): UserDoc {
  const stats = typeof data.stats === 'object' && data.stats !== null ? data.stats : {};
  const preferences = typeof data.preferences === 'object' && data.preferences !== null ? data.preferences : {};
  return UserDocSchema.parse({
    ...data,
    uid,
    lcNumber: data.lcNumber ?? null,
    deactivatedAt: data.deactivatedAt ?? null,
    stats: { ...emptyUserStats(), ...stats },
    skillScoresByPillar: data.skillScoresByPillar ?? {},
    preferences: { ...defaultPreferences(), ...preferences },
  });
}

export function claimsForUser(user: Pick<UserDoc, 'role' | 'partnerCohortId' | 'divisionIds'>, active: boolean): PulseCustomClaims {
  return {
    role: user.role,
    partnerCohortId: user.partnerCohortId,
    divisionIds: [...user.divisionIds],
    active,
  };
}

/** true when the claims on a decoded token already equal the expected claims. */
export function claimsMatch(token: Record<string, unknown>, expected: PulseCustomClaims): boolean {
  const divisions = token.divisionIds;
  return (
    token.role === expected.role &&
    token.partnerCohortId === expected.partnerCohortId &&
    token.active === expected.active &&
    Array.isArray(divisions) &&
    divisions.length === expected.divisionIds.length &&
    expected.divisionIds.every((id, index) => divisions[index] === id)
  );
}

/** Write the Pulse claims while keeping any unrelated custom claims on the account. */
export async function writeCustomClaims(uid: string, claims: PulseCustomClaims): Promise<void> {
  const record = await adminAuth.getUser(uid);
  await adminAuth.setCustomUserClaims(uid, { ...(record.customClaims ?? {}), ...claims });
}

const PASSWORD_ALPHABETS = {
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  lower: 'abcdefghijkmnopqrstuvwxyz',
  digit: '23456789',
  symbol: '!@#$%*?-_',
} as const;

/** Strong random temporary password (16 characters, every character class present). */
export function generateTemporaryPassword(length = 16): string {
  const all = Object.values(PASSWORD_ALPHABETS).join('');
  const chars = Object.values(PASSWORD_ALPHABETS).map((set) => set[randomInt(set.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** Comma-separated environment list -> lowercase trimmed values. */
export function envList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}
