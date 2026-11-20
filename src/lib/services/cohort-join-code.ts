import { randomInt } from 'node:crypto';

/** Generate a human-readable, high-entropy Cohort join code not in `existingCodes`. */
export function generateUniqueJoinCode(cohortId: string, existingCodes: ReadonlySet<string>): string {
  const prefix = cohortId.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8) || 'COHORT';
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const suffix = String(randomInt(1000, 10000));
    const candidate = `${prefix}-${suffix}`;
    if (!existingCodes.has(candidate)) return candidate;
  }
  const fallbackSuffix = String(randomInt(100000, 1000000));
  return `${prefix}-${fallbackSuffix}`;
}
