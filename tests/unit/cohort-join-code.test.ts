import { describe, expect, it } from 'vitest';
import { JOIN_CODE_ALPHABET, generateUniqueJoinCode } from '@/lib/services/cohort-join-code';

describe('Cohort join codes', () => {
  it('use the Cohort prefix plus two groups of four unambiguous random symbols', () => {
    const code = generateUniqueJoinCode('ths-spring', new Set());
    expect(code).toMatch(new RegExp(`^THSSPRIN-[${JOIN_CODE_ALPHABET}]{4}-[${JOIN_CODE_ALPHABET}]{4}$`));
    expect(code.split('-').slice(1).join('')).not.toMatch(/[01ILOU]/);
  });

  it('are not guessable: 2,000 codes are all distinct', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) seen.add(generateUniqueJoinCode('THS', seen));
    expect(seen.size).toBe(2000);
  });

  it('never return a code that is already taken', () => {
    const taken = new Set(['THS-AAAA-AAAA']);
    expect(taken.has(generateUniqueJoinCode('THS', taken))).toBe(false);
  });
});
