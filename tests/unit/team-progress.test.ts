import { describe, expect, it } from 'vitest';
import type { EnrollmentDoc } from '@/lib/schemas/analytics';
import type { CertificationDoc } from '@/lib/schemas/learning';
import { deriveProgressCell, stageRank, summarizeLadder } from '@/lib/services/team-progress';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const DAY = 86_400_000;
const track = {
  units: [
    { id: 'u1', title: 'Verify' },
    { id: 'u2', title: 'Save offer' },
    { id: 'u3', title: 'Escalate' },
  ],
  scenarios: [{ id: 's1', title: 'Price Objection', passScoreThreshold: 80 }],
};

function enrollment(over: Partial<EnrollmentDoc> = {}): EnrollmentDoc {
  return {
    id: 'a_t', userId: 'a', userDisplayName: 'A', partnerCohortId: 'THS', divisionId: 'INBOUND', trackId: 't', trackTitle: 'T',
    versionId: 'v1', status: 'IN_PROGRESS', completedUnitIds: [], passedScenarioIds: [], unitScores: {}, bestSimScorePct: null,
    xpEarned: 0, progressPct: 0, certifiedAt: null, lastActivityAt: NOW, ...over,
  };
}

function cert(over: Partial<CertificationDoc> = {}): CertificationDoc {
  return {
    schemaVersion: 1, id: 'c', learnerId: 'a', partnerCohortId: 'THS', trackId: 't', curriculumVersion: 't:v1', blueprintId: 'b',
    sourceRevision: 'r', status: 'certified', certifiedAt: '2026-10-01T00:00:00.000Z', expiresAt: '2027-02-03T00:00:00.000Z',
    recertificationRequiredAt: null, revokedAt: null, revokedByUid: null, revocationReason: null, evidenceAttemptIds: [],
    evidenceSessionIds: [], history: [], createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...over,
  };
}

const base = { track, assigned: true, agentActive: true, certification: null, now: NOW };

describe('team progress status ladder', () => {
  it('is Not started with no enrollment, and Not assigned when the Cohort lacks the Track', () => {
    expect(deriveProgressCell({ ...base, enrollment: undefined }).stage).toBe('not_started');
    expect(deriveProgressCell({ ...base, enrollment: undefined, assigned: false }).stage).toBe('not_assigned');
  });

  it('is Not assigned for an un-assigned Track even with an old in-progress enrollment', () => {
    const learning = deriveProgressCell({ ...base, assigned: false, enrollment: enrollment({ completedUnitIds: ['u1'] }) });
    expect(learning.stage).toBe('not_assigned');
    expect(learning.nextStep).toBeNull();
    const done = deriveProgressCell({ ...base, assigned: false, enrollment: enrollment({ completedUnitIds: ['u1', 'u2', 'u3'] }) });
    expect(done.stage).toBe('not_assigned');
  });

  it('shows Learning with per-checkpoint bars and the next checkpoint', () => {
    const cell = deriveProgressCell({ ...base, enrollment: enrollment({ completedUnitIds: ['u1'] }) });
    expect(cell.stage).toBe('learning');
    expect(cell.unitsDone).toEqual([true, false, false]);
    expect(cell.nextStep).toBe('Checkpoint 2: Save offer');
    expect(cell.stalledDays).toBeNull();
  });

  it('flags agents with no activity for 7+ days as stalled and ranks them first', () => {
    const stalled = deriveProgressCell({ ...base, enrollment: enrollment({ completedUnitIds: ['u1'], lastActivityAt: NOW - 9 * DAY }) });
    const active = deriveProgressCell({ ...base, enrollment: enrollment({ completedUnitIds: ['u1'] }) });
    expect(stalled.stalledDays).toBe(9);
    expect(stageRank(stalled)).toBeLessThan(stageRank(active));
  });

  it('is Checkpoints done when every unit is complete but the sim is not passed', () => {
    const cell = deriveProgressCell({ ...base, enrollment: enrollment({ completedUnitIds: ['u1', 'u2', 'u3'], bestSimScorePct: 72 }) });
    expect(cell.stage).toBe('checkpoints_done');
    expect(cell.detail).toBe('Sim 72% (needs 80%)');
    expect(cell.nextStep).toBe('Retry sim: Price Objection');
  });

  it('never treats a legacy enrollment CERTIFIED flag as certified', () => {
    const cell = deriveProgressCell({ ...base, enrollment: enrollment({ status: 'CERTIFIED', completedUnitIds: ['u1', 'u2', 'u3'], passedScenarioIds: ['s1'] }) });
    expect(cell.stage).toBe('checkpoints_done');
    expect(cell.detail).toContain('earlier certificate not verified');
  });

  it('uses the certification register for Certified and Needs recert', () => {
    const done = enrollment({ completedUnitIds: ['u1', 'u2', 'u3'], passedScenarioIds: ['s1'], bestSimScorePct: 92 });
    const certified = deriveProgressCell({ ...base, enrollment: done, certification: cert() });
    expect(certified.stage).toBe('certified');
    expect(certified.detail).toBe('92% sim · valid to Feb 3');
    expect(deriveProgressCell({ ...base, enrollment: done, certification: cert({ expiresAt: '2026-11-01T00:00:00.000Z' }) }).stage).toBe('needs_recert');
    expect(deriveProgressCell({ ...base, enrollment: done, certification: cert({ status: 'recertification_required' }) }).stage).toBe('needs_recert');
  });

  it('archives offboarded agents and leaves them out of the ladder counts', () => {
    const archived = deriveProgressCell({ ...base, enrollment: enrollment(), agentActive: false });
    expect(archived.stage).toBe('archived');
    const summary = summarizeLadder([archived, deriveProgressCell({ ...base, enrollment: undefined })]);
    expect(summary.not_started.count).toBe(1);
    expect(Object.values(summary).reduce((sum, s) => sum + s.count, 0)).toBe(1);
  });

  it('does not flag a Track assigned under 3 days ago that the agent has not opened yet (QA L7)', () => {
    expect(deriveProgressCell({ ...base, enrollment: undefined, assignedAt: NOW - 1 * DAY }).flag).toEqual({ tone: 'info', text: 'Not opened yet' });
    expect(deriveProgressCell({ ...base, enrollment: undefined, assignedAt: NOW - 5 * DAY }).flag).toEqual({ tone: 'warning', text: 'Not opened in 5 days' });
  });

  it('puts one plain problem flag on each card that needs attention', () => {
    expect(deriveProgressCell({ ...base, enrollment: undefined }).flag).toEqual({ tone: 'warning', text: 'Not opened yet' });
    const stuck = deriveProgressCell({ ...base, enrollment: enrollment({ completedUnitIds: ['u1'], lastActivityAt: NOW - 8 * DAY }) });
    expect(stuck.flag).toEqual({ tone: 'danger', text: 'Stuck 8 days on Checkpoint 2' });
    const failing = deriveProgressCell({ ...base, enrollment: enrollment({ completedUnitIds: ['u1', 'u2', 'u3'], bestSimScorePct: 72 }) });
    expect(failing.flag).toEqual({ tone: 'warning', text: 'Sim 72%, pass line 80%' });
    expect(failing.simPassLine).toBe(80);
    const done = enrollment({ completedUnitIds: ['u1', 'u2', 'u3'], passedScenarioIds: ['s1'], bestSimScorePct: 85 });
    const expiring = deriveProgressCell({ ...base, enrollment: done, certification: cert({ expiresAt: new Date(NOW + 6 * DAY).toISOString() }) });
    expect(expiring.flag).toEqual({ tone: 'warning', text: 'Expires in 6 days' });
    expect(deriveProgressCell({ ...base, enrollment: done, certification: cert() }).flag).toBeNull();
    expect(deriveProgressCell({ ...base, enrollment: enrollment({ completedUnitIds: ['u1'] }) }).flag).toBeNull();
  });

  it('averages first-try accuracy and points at the next checkpoint', () => {
    const cell = deriveProgressCell({
      ...base,
      enrollment: enrollment({
        completedUnitIds: ['u1', 'u2'],
        unitScores: { u1: { firstTryAccuracyPct: 80, attemptsCount: 1, completedAt: NOW }, u2: { firstTryAccuracyPct: 60, attemptsCount: 2, completedAt: NOW } },
      }),
    });
    expect(cell.firstTryPct).toBe(70);
    expect(cell.nextUnitIndex).toBe(2);
  });
});
