import { randomInt } from 'node:crypto';

/**
 * Join-code alphabet: digits and capitals without look-alikes (no 0/O, 1/I/L, U), so codes read aloud or copied
 * from a slide stay unambiguous. 30 symbols.
 */
export const JOIN_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Two groups of four random symbols: about 6.6e11 codes per prefix (was 9,000 with a 4-digit suffix). */
export const JOIN_CODE_RANDOM_LENGTH = 8;

function randomGroup(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
  return out;
}

/** Generate a human-readable, high-entropy Cohort join code (e.g. `THS-7K4M-Q9XR`) not in `existingCodes`. */
export function generateUniqueJoinCode(cohortId: string, existingCodes: ReadonlySet<string>): string {
  const prefix = cohortId.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8) || 'COHORT';
  const half = JOIN_CODE_RANDOM_LENGTH / 2;
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const candidate = `${prefix}-${randomGroup(half)}-${randomGroup(half)}`;
    if (!existingCodes.has(candidate)) return candidate;
  }
  // 64 collisions in a space this large means something is wrong with the random source; fail loudly.
  throw new Error('Could not generate a unique Cohort join code.');
}
