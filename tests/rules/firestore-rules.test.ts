/**
 * Firestore Security Rules tests for learning records and hidden curriculum answers.
 * Run against the Firestore emulator; Java is required by the emulator.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT_ID = 'demo-logicall-pulse-rules';

let testEnv: RulesTestEnvironment;

type Role = 'SUPER_ADMIN' | 'ADMIN' | 'TRAINER' | 'PARTNER_SUPERVISOR' | 'AGENT';

function claims(role: Role, partnerCohortId: string, active = true) {
  return { role, partnerCohortId, divisionIds: ['INBOUND'], active };
}

function db(uid: string, role: Role, partnerCohortId: string, active = true) {
  return testEnv.authenticatedContext(uid, claims(role, partnerCohortId, active)).firestore();
}

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
      host,
      port: Number(port),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const admin = ctx.firestore();

    await setDoc(doc(admin, 'tracks/t1'), { id: 't1', status: 'PUBLISHED', assignedCohortIds: ['ALL'] });
    await setDoc(doc(admin, 'tracks/t2'), { id: 't2', status: 'PUBLISHED', assignedCohortIds: ['DOZ'] });
    await setDoc(doc(admin, 'tracks/t3'), { id: 't3', status: 'DRAFT', assignedCohortIds: ['ALL'] });
    await setDoc(doc(admin, 'tracks/t1/versions/v1'), {
      versionId: 'v1',
      drills: [{ id: 'd1', correctOptionId: 'option-a', hiddenRationale: 'hidden' }],
    });
    await setDoc(doc(admin, 'tracks/t1/versions/v1/secrets/evalRubrics'), {
      scenarios: [{ autoFailTriggers: ['hidden'] }],
    });

    await setDoc(doc(admin, 'assessmentBlueprints/blueprint-t1'), { trackId: 't1', curriculumVersion: 'v1' });
    await setDoc(doc(admin, 'assessmentBlueprints/blueprint-t2'), { trackId: 't2', curriculumVersion: 'v1' });
    await setDoc(doc(admin, 'assessmentBlueprints/blueprint-t3'), { trackId: 't3', curriculumVersion: 'v1' });

    await setDoc(doc(admin, 'drillAttemptStarts/start-ths'), {
      learnerId: 'agent-ths', trackId: 't1', curriculumVersion: 'v1',
    });
    await setDoc(doc(admin, 'drillAttemptStarts/start-doz'), {
      learnerId: 'agent-doz', trackId: 't1', curriculumVersion: 'v1',
    });
    await setDoc(doc(admin, 'drillAttempts/attempt-ths'), {
      learnerId: 'agent-ths', partnerCohortId: 'THS', trackId: 't1', curriculumVersion: 'v1', submittedAt: '2026-01-01T00:00:00.000Z',
    });
    await setDoc(doc(admin, 'drillAttempts/attempt-doz'), {
      learnerId: 'agent-doz', partnerCohortId: 'DOZ', trackId: 't1', curriculumVersion: 'v1', submittedAt: '2026-01-02T00:00:00.000Z',
    });
    await setDoc(doc(admin, 'reviewSchedules/schedule-ths'), {
      learnerId: 'agent-ths', trackId: 't1', curriculumVersion: 'v1', dueAt: '2026-01-03T00:00:00.000Z',
    });
    await setDoc(doc(admin, 'reviewSchedules/schedule-doz'), {
      learnerId: 'agent-doz', trackId: 't1', curriculumVersion: 'v1', dueAt: '2026-01-04T00:00:00.000Z',
    });
    await setDoc(doc(admin, 'scenarioCoverage/coverage-ths'), {
      learnerId: 'agent-ths', partnerCohortId: 'THS', trackId: 't1', curriculumVersion: 'v1',
    });
    await setDoc(doc(admin, 'scenarioCoverage/coverage-doz'), {
      learnerId: 'agent-doz', partnerCohortId: 'DOZ', trackId: 't1', curriculumVersion: 'v1',
    });
    await setDoc(doc(admin, 'certifications/cert-ths'), {
      learnerId: 'agent-ths', partnerCohortId: 'THS', trackId: 't1', curriculumVersion: 'v1', status: 'certified',
    });
    await setDoc(doc(admin, 'certifications/cert-doz'), {
      learnerId: 'agent-doz', partnerCohortId: 'DOZ', trackId: 't1', curriculumVersion: 'v1', status: 'certified',
    });

    await setDoc(doc(admin, 'enrollments/enrollment-ths'), {
      userId: 'agent-ths', partnerCohortId: 'THS', trackId: 't1',
    });
    await setDoc(doc(admin, 'enrollments/enrollment-doz'), {
      userId: 'agent-doz', partnerCohortId: 'DOZ', trackId: 't1',
    });
    await setDoc(doc(admin, 'simSessions/s-ths'), { userId: 'agent-ths', partnerCohortId: 'THS' });
    await setDoc(doc(admin, 'simSessions/s-doz'), { userId: 'agent-doz', partnerCohortId: 'DOZ' });
    await setDoc(doc(admin, 'simSessions/s-ths/events/e-ths'), { sessionId: 's-ths', payload: { private: true } });
    await setDoc(doc(admin, 'simSessions/s-doz/events/e-doz'), { sessionId: 's-doz', payload: { private: true } });
    await setDoc(doc(admin, 'generationCheckpoints/checkpoint-synthetic'), { status: 'complete', synthetic: true });
    await setDoc(doc(admin, 'simSessions/s-ths/manualJudgeTasks/current'), { taskType: 'judge', synthetic: true });
    await setDoc(doc(admin, 'simSyntheticOutbox/outbox-ths'), { sessionId: 's-ths', displayText: 'Synthetic THS message' });
    await setDoc(doc(admin, 'simSyntheticOutbox/outbox-doz'), { sessionId: 's-doz', displayText: 'Synthetic DOZ message' });
  });
});

describe('TrackVersion answers and secrets', () => {
  it('allows only internal ops to read versions and secrets', async () => {
    const agent = db('agent-ths', 'AGENT', 'THS');
    const supervisor = db('sup-ths', 'PARTNER_SUPERVISOR', 'THS');
    const trainer = db('trainer-1', 'TRAINER', 'INTERNAL');

    await assertFails(getDoc(doc(agent, 'tracks/t1/versions/v1')));
    await assertFails(getDoc(doc(agent, 'tracks/t1/versions/v1/secrets/evalRubrics')));
    await assertFails(getDoc(doc(supervisor, 'tracks/t1/versions/v1')));
    await assertFails(getDoc(doc(supervisor, 'tracks/t1/versions/v1/secrets/evalRubrics')));
    await assertSucceeds(getDoc(doc(trainer, 'tracks/t1/versions/v1')));
    await assertSucceeds(getDoc(doc(trainer, 'tracks/t1/versions/v1/secrets/evalRubrics')));
  });
});

describe('learner learning-record privacy', () => {
  it('allows learners to read only their own attempts, schedules, coverage, and certifications', async () => {
    const agent = db('agent-ths', 'AGENT', 'THS');

    await assertSucceeds(getDoc(doc(agent, 'drillAttemptStarts/start-ths')));
    await assertSucceeds(getDoc(doc(agent, 'drillAttempts/attempt-ths')));
    await assertSucceeds(getDoc(doc(agent, 'reviewSchedules/schedule-ths')));
    await assertSucceeds(getDoc(doc(agent, 'scenarioCoverage/coverage-ths')));
    await assertSucceeds(getDoc(doc(agent, 'certifications/cert-ths')));

    await assertFails(getDoc(doc(agent, 'drillAttemptStarts/start-doz')));
    await assertFails(getDoc(doc(agent, 'drillAttempts/attempt-doz')));
    await assertFails(getDoc(doc(agent, 'reviewSchedules/schedule-doz')));
    await assertFails(getDoc(doc(agent, 'scenarioCoverage/coverage-doz')));
    await assertFails(getDoc(doc(agent, 'certifications/cert-doz')));
  });

  it('allows published-track blueprints but not draft or unassigned-track blueprints', async () => {
    const agent = db('agent-ths', 'AGENT', 'THS');

    await assertSucceeds(getDoc(doc(agent, 'assessmentBlueprints/blueprint-t1')));
    await assertFails(getDoc(doc(agent, 'assessmentBlueprints/blueprint-t2')));
    await assertFails(getDoc(doc(agent, 'assessmentBlueprints/blueprint-t3')));
  });

  it('enforces owner constraints on collection queries', async () => {
    const agent = db('agent-ths', 'AGENT', 'THS');

    await assertSucceeds(getDocs(query(
      collection(agent, 'drillAttempts'),
      where('learnerId', '==', 'agent-ths'),
      where('trackId', '==', 't1'),
      where('curriculumVersion', '==', 'v1'),
      orderBy('submittedAt', 'desc'),
    )));
    await assertSucceeds(getDocs(query(
      collection(agent, 'reviewSchedules'),
      where('learnerId', '==', 'agent-ths'),
      orderBy('dueAt'),
    )));
    await assertSucceeds(getDocs(query(
      collection(agent, 'scenarioCoverage'),
      where('learnerId', '==', 'agent-ths'),
      where('trackId', '==', 't1'),
      where('curriculumVersion', '==', 'v1'),
    )));
    await assertSucceeds(getDocs(query(
      collection(agent, 'certifications'),
      where('learnerId', '==', 'agent-ths'),
    )));

    await assertFails(getDocs(collection(agent, 'drillAttempts')));
    await assertFails(getDocs(query(collection(agent, 'drillAttempts'), where('learnerId', '==', 'agent-doz'))));
    await assertFails(getDocs(collection(agent, 'reviewSchedules')));
    await assertFails(getDocs(collection(agent, 'scenarioCoverage')));
    await assertFails(getDocs(collection(agent, 'certifications')));
  });
});

describe('trainer and partner-supervisor access', () => {
  it('allows trainers to read all learning records', async () => {
    const trainer = db('trainer-1', 'TRAINER', 'INTERNAL');

    await Promise.all([
      assertSucceeds(getDoc(doc(trainer, 'drillAttemptStarts/start-ths'))),
      assertSucceeds(getDoc(doc(trainer, 'drillAttempts/attempt-doz'))),
      assertSucceeds(getDoc(doc(trainer, 'reviewSchedules/schedule-ths'))),
      assertSucceeds(getDoc(doc(trainer, 'assessmentBlueprints/blueprint-t3'))),
      assertSucceeds(getDoc(doc(trainer, 'scenarioCoverage/coverage-doz'))),
      assertSucceeds(getDoc(doc(trainer, 'certifications/cert-doz'))),
      assertSucceeds(getDoc(doc(trainer, 'simSyntheticOutbox/outbox-doz'))),
      assertSucceeds(getDoc(doc(trainer, 'simSessions/s-doz/events/e-doz'))),
    ]);
  });

  it('limits partner supervisors to matching-cohort records', async () => {
    const supervisor = db('sup-ths', 'PARTNER_SUPERVISOR', 'THS');

    await assertSucceeds(getDoc(doc(supervisor, 'drillAttempts/attempt-ths')));
    await assertSucceeds(getDoc(doc(supervisor, 'scenarioCoverage/coverage-ths')));
    await assertSucceeds(getDoc(doc(supervisor, 'certifications/cert-ths')));
    await assertSucceeds(getDoc(doc(supervisor, 'assessmentBlueprints/blueprint-t1')));
    await assertSucceeds(getDoc(doc(supervisor, 'simSyntheticOutbox/outbox-ths')));
    await assertSucceeds(getDoc(doc(supervisor, 'simSessions/s-ths/events/e-ths')));

    await assertFails(getDoc(doc(supervisor, 'drillAttempts/attempt-doz')));
    await assertFails(getDoc(doc(supervisor, 'scenarioCoverage/coverage-doz')));
    await assertFails(getDoc(doc(supervisor, 'certifications/cert-doz')));
    await assertFails(getDoc(doc(supervisor, 'assessmentBlueprints/blueprint-t2')));
    await assertFails(getDoc(doc(supervisor, 'simSyntheticOutbox/outbox-doz')));
    await assertFails(getDoc(doc(supervisor, 'simSessions/s-doz/events/e-doz')));
  });

  it('denies partner-supervisor reads where schemas have no cohort boundary', async () => {
    const supervisor = db('sup-ths', 'PARTNER_SUPERVISOR', 'THS');

    await assertFails(getDoc(doc(supervisor, 'drillAttemptStarts/start-ths')));
    await assertFails(getDoc(doc(supervisor, 'reviewSchedules/schedule-ths')));
  });

  it('enforces cohort constraints on partner-supervisor queries', async () => {
    const supervisor = db('sup-ths', 'PARTNER_SUPERVISOR', 'THS');

    await assertSucceeds(getDocs(query(
      collection(supervisor, 'drillAttempts'),
      where('partnerCohortId', '==', 'THS'),
    )));
    await assertSucceeds(getDocs(query(
      collection(supervisor, 'certifications'),
      where('partnerCohortId', '==', 'THS'),
      where('status', '==', 'certified'),
    )));
    await assertFails(getDocs(query(
      collection(supervisor, 'drillAttempts'),
      where('partnerCohortId', '==', 'DOZ'),
    )));
    await assertFails(getDocs(collection(supervisor, 'drillAttempts')));
    await assertFails(getDocs(collection(supervisor, 'certifications')));
  });
});

describe('simulation event and outbox privacy', () => {
  it('allows learners to read only their own session subordinate data', async () => {
    const agent = db('agent-ths', 'AGENT', 'THS');

    await assertSucceeds(getDoc(doc(agent, 'simSyntheticOutbox/outbox-ths')));
    await assertSucceeds(getDoc(doc(agent, 'simSessions/s-ths/events/e-ths')));
    await assertSucceeds(getDocs(query(
      collection(agent, 'simSyntheticOutbox'),
      where('sessionId', '==', 's-ths'),
    )));
    await assertFails(getDoc(doc(agent, 'simSyntheticOutbox/outbox-doz')));
    await assertFails(getDoc(doc(agent, 'simSessions/s-doz/events/e-doz')));
    await assertFails(getDocs(query(
      collection(agent, 'simSyntheticOutbox'),
      where('sessionId', '==', 's-doz'),
    )));
  });
});

describe('existing enrollment and session privacy', () => {
  it('preserves learner owner-only access', async () => {
    const agent = db('agent-ths', 'AGENT', 'THS');

    await assertSucceeds(getDoc(doc(agent, 'enrollments/enrollment-ths')));
    await assertSucceeds(getDoc(doc(agent, 'simSessions/s-ths')));
    await assertFails(getDoc(doc(agent, 'enrollments/enrollment-doz')));
    await assertFails(getDoc(doc(agent, 'simSessions/s-doz')));
  });

  it('preserves partner-supervisor cohort isolation', async () => {
    const supervisor = db('sup-ths', 'PARTNER_SUPERVISOR', 'THS');

    await assertSucceeds(getDoc(doc(supervisor, 'enrollments/enrollment-ths')));
    await assertSucceeds(getDoc(doc(supervisor, 'simSessions/s-ths')));
    await assertFails(getDoc(doc(supervisor, 'enrollments/enrollment-doz')));
    await assertFails(getDoc(doc(supervisor, 'simSessions/s-doz')));
  });
});

describe('client write denial and active-user enforcement', () => {
  it('denies all client writes to learning and simulation-outbox collections', async () => {
    const agent = db('agent-ths', 'AGENT', 'THS');
    const paths = [
      'drillAttemptStarts/client-start',
      'drillAttempts/client-attempt',
      'reviewSchedules/client-schedule',
      'assessmentBlueprints/client-blueprint',
      'scenarioCoverage/client-coverage',
      'certifications/client-certification',
      'simSyntheticOutbox/client-outbox',
      'simSessions/s-ths/events/client-event',
      'tracks/t1/versions/client-version',
    ];

    for (const path of paths) {
      await assertFails(setDoc(doc(agent, path), { learnerId: 'agent-ths' }));
    }
  });

  it('denies inactive users even for their own records', async () => {
    const inactive = db('agent-ths', 'AGENT', 'THS', false);

    await assertFails(getDoc(doc(inactive, 'drillAttempts/attempt-ths')));
    await assertFails(getDoc(doc(inactive, 'reviewSchedules/schedule-ths')));
    await assertFails(getDoc(doc(inactive, 'simSyntheticOutbox/outbox-ths')));
  });
});

describe('server-only generation checkpoints and manual judge tasks', () => {
  const paths = [
    'generationCheckpoints/checkpoint-synthetic',
    'generationWorkingDrafts/track-synthetic',
    'simSessions/s-ths/manualJudgeTasks/current',
  ];

  it.each([
    ['learner', 'agent-ths', 'AGENT', 'THS'],
    ['partner supervisor', 'sup-ths', 'PARTNER_SUPERVISOR', 'THS'],
    ['trainer', 'trainer-1', 'TRAINER', 'INTERNAL'],
    ['admin', 'admin-1', 'ADMIN', 'INTERNAL'],
  ] as const)('denies %s document reads and writes', async (_label, uid, role, partnerCohortId) => {
    const client = db(uid, role, partnerCohortId);

    for (const path of paths) {
      await assertFails(getDoc(doc(client, path)));
      await assertFails(setDoc(doc(client, path), { synthetic: true, clientTampering: true }));
    }
  });

  it('denies collection listing to internal ops', async () => {
    const admin = db('admin-1', 'ADMIN', 'INTERNAL');

    await assertFails(getDocs(collection(admin, 'generationCheckpoints')));
    await assertFails(getDocs(collection(admin, 'simSessions/s-ths/manualJudgeTasks')));
  });

  it('denies inactive internal admins', async () => {
    const inactiveAdmin = db('old-admin', 'ADMIN', 'INTERNAL', false);

    for (const path of paths) {
      await assertFails(getDoc(doc(inactiveAdmin, path)));
      await assertFails(setDoc(doc(inactiveAdmin, path), { synthetic: true, clientTampering: true }));
    }
  });
});
