/** QA Phase 5 polish: small pure helpers. */
import { describe, expect, it } from 'vitest';
import { dailyLimitMessage, nextUtcMidnight } from '@/app/(dashboard)/learn/_lib/daily-limit';
import { matchColumnLabels } from '@/components/learn/match-labels';
import { bandFor } from '@/components/analytics/strength';

describe('daily limit reset time (L17)', () => {
  it('gives the next UTC midnight in the agent time zone', () => {
    const now = new Date('2026-11-23T15:00:00Z');
    expect(nextUtcMidnight(now).toISOString()).toBe('2026-11-24T00:00:00.000Z');
    // Nicaragua is UTC-6: midnight UTC is 6:00 PM the same day.
    expect(dailyLimitMessage('You started the maximum of 5 Verbal Practice scenarios today. The limit resets at midnight UTC.', now, 'en-US', 'America/Managua')).toBe(
      'You started the maximum of 5 Verbal Practice scenarios today. It resets at 6:00 PM today (your time).',
    );
    // Lagos is UTC+1: 1:00 AM the next day.
    expect(dailyLimitMessage('Limit reached. The limit resets at midnight UTC.', now, 'en-US', 'Africa/Lagos')).toBe(
      'Limit reached. It resets at 1:00 AM tomorrow (your time).',
    );
  });
});

describe('match pairs column labels (L9)', () => {
  it('reads both columns from the prompt', () => {
    expect(matchColumnLabels('Match each Atlas note field to the correct content.')).toEqual({ left: 'Atlas note field', right: 'Correct content' });
    expect(matchColumnLabels('Match each situation to the correct escalation route.')).toEqual({ left: 'Situation', right: 'Correct escalation route' });
    expect(matchColumnLabels('Pair them up')).toEqual({ left: 'Item', right: 'Goes with' });
  });
});

describe('strength bands (L4)', () => {
  it('bands the rounded value, so 69.6 (shown as 70%) is borderline, not red', () => {
    expect(bandFor(69.6)).toBe('borderline');
    expect(bandFor(69.4)).toBe('weak');
  });
});
