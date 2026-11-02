/**
 * Firestore Security Rules tests. Run against the local emulator with:
 *   npm run test:rules
 * (firebase emulators:exec --only firestore "vitest run tests/integration")
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, getDocs, query, where } from 'firebase/firestore';
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
    await setDoc(doc(admin, 'users/agent-ths'), { uid: 'agent-ths', partnerCohortId: 'THS', role: 'AGENT', active: true });
    await setDoc(doc(admin, 'users/agent-doz'), { uid: 'agent-doz', partnerCohortId: 'DOZ', role: 'AGENT', active: true });
    await setDoc(doc(admin, 'users/inactive-ths'), { uid: 'inactive-ths', partnerCohortId: 'THS', role: 'AGENT', active: false });
    await setDoc(doc(admin, 'cohorts/THS'), { id: 'THS', name: 'THS (Nicaragua)' });
    await setDoc(doc(admin, 'tracks/t1'), { id: 't1', status: 'PUBLISHED', assignedCohortIds: ['ALL'] });
    await setDoc(doc(admin, 'tracks/t1/versions/v1'), { versionId: 'v1', units: [] });
    await setDoc(doc(admin, 'tracks/t1/versions/v1/secrets/evalRubrics'), { scenarios: [{ autoFailTriggers: ['x'] }] });
    await setDoc(doc(admin, 'enrollments/agent-ths_t1'), { userId: 'agent-ths', trackId: 't1', partnerCohortId: 'THS' });
    await setDoc(doc(admin, 'enrollments/agent-doz_t1'), { userId: 'agent-doz', trackId: 't1', partnerCohortId: 'DOZ' });
    await setDoc(doc(admin, 'simSessions/s-doz'), { userId: 'agent-doz', partnerCohortId: 'DOZ' });
    await setDoc(doc(admin, 'analyticsRollups/COHORT_THS'), { scopeType: 'COHORT', partnerCohortId: 'THS' });
    await setDoc(doc(admin, 'analyticsRollups/COHORT_DOZ'), { scopeType: 'COHORT', partnerCohortId: 'DOZ' });
    await setDoc(doc(admin, 'analyticsRollups/GLOBAL'), { scopeType: 'GLOBAL', partnerCohortId: null });
  });
});

describe('inactive users (active: false)', () => {
  it('cannot read any document, including their own profile', async () => {
    const inactive = db('inactive-ths', 'AGENT', 'THS', false);
    await assertFails(getDoc(doc(inactive, 'users/inactive-ths')));
    await assertFails(getDoc(doc(inactive, 'cohorts/THS')));
    await assertFails(getDoc(doc(inactive, 'tracks/t1')));
    await assertFails(getDoc(doc(inactive, 'tracks/t1/versions/v1')));
    await assertFails(getDoc(doc(inactive, 'enrollments/agent-ths_t1')));
    await assertFails(getDoc(doc(inactive, 'analyticsRollups/COHORT_THS')));
  });

  it('cannot read even with an internal ops role', async () => {
    const inactiveAdmin = db('old-admin', 'ADMIN', 'INTERNAL', false);
    await assertFails(getDoc(doc(inactiveAdmin, 'users/agent-ths')));
    await assertFails(getDoc(doc(inactiveAdmin, 'tracks/t1/versions/v1/secrets/evalRubrics')));
  });

  it('unauthenticated callers cannot read anything', async () => {
    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'tracks/t1')));
    await assertFails(getDoc(doc(anon, 'users/agent-ths')));
  });
});

describe('AGENT role', () => {
  it('can read its own profile, the published Track, and its TrackVersion', async () => {
    const agent = db('agent-ths', 'AGENT', 'THS');
    await assertSucceeds(getDoc(doc(agent, 'users/agent-ths')));
    await assertSucceeds(getDoc(doc(agent, 'tracks/t1')));
    await assertSucceeds(getDoc(doc(agent, 'tracks/t1/versions/v1')));
    await assertSucceeds(getDoc(doc(agent, 'enrollments/agent-ths_t1')));
  });

  it('cannot read secrets/evalRubrics', async () => {
    const agent = db('agent-ths', 'AGENT', 'THS');
    await assertFails(getDoc(doc(agent, 'tracks/t1/versions/v1/secrets/evalRubrics')));
  });

  it('cannot write enrollments (create, update or spoof another user)', async () => {
    const agent = db('agent-ths', 'AGENT', 'THS');
    await assertFails(setDoc(doc(agent, 'enrollments/agent-ths_t1'), { userId: 'agent-ths', status: 'CERTIFIED' }, { merge: true }));
    await assertFails(setDoc(doc(agent, 'enrollments/agent-ths_t2'), { userId: 'agent-ths', trackId: 't2', partnerCohortId: 'THS' }));
    await assertFails(setDoc(doc(agent, 'enrollments/agent-doz_t1'), { userId: 'agent-doz', status: 'NOT_STARTED' }));
  });

  it('cannot read other agents or list users', async () => {
    const agent = db('agent-ths', 'AGENT', 'THS');
    await assertFails(getDoc(doc(agent, 'users/agent-doz')));
    await assertFails(getDocs(collection(agent, 'users')));
  });

  it('trainers can read secrets/evalRubrics', async () => {
    const trainer = db('trainer-1', 'TRAINER', 'INTERNAL');
    await assertSucceeds(getDoc(doc(trainer, 'tracks/t1/versions/v1/secrets/evalRubrics')));
  });
});

describe('PARTNER_SUPERVISOR for THS', () => {
  it('can read THS users, enrollments, and the THS rollup', async () => {
    const sup = db('sup-ths', 'PARTNER_SUPERVISOR', 'THS');
    await assertSucceeds(getDoc(doc(sup, 'users/agent-ths')));
    await assertSucceeds(getDoc(doc(sup, 'enrollments/agent-ths_t1')));
    await assertSucceeds(getDoc(doc(sup, 'analyticsRollups/COHORT_THS')));
    await assertSucceeds(getDocs(query(collection(sup, 'users'), where('partnerCohortId', '==', 'THS'))));
  });

  it('cannot read DOZ users, enrollments, Simulation sessions, or rollups', async () => {
    const sup = db('sup-ths', 'PARTNER_SUPERVISOR', 'THS');
    await assertFails(getDoc(doc(sup, 'users/agent-doz')));
    await assertFails(getDoc(doc(sup, 'enrollments/agent-doz_t1')));
    await assertFails(getDoc(doc(sup, 'simSessions/s-doz')));
    await assertFails(getDoc(doc(sup, 'analyticsRollups/COHORT_DOZ')));
    await assertFails(getDocs(query(collection(sup, 'users'), where('partnerCohortId', '==', 'DOZ'))));
    await assertFails(getDocs(collection(sup, 'users')));
  });

  it('cannot read the GLOBAL rollup or secrets/evalRubrics', async () => {
    const sup = db('sup-ths', 'PARTNER_SUPERVISOR', 'THS');
    await assertFails(getDoc(doc(sup, 'analyticsRollups/GLOBAL')));
    await assertFails(getDoc(doc(sup, 'tracks/t1/versions/v1/secrets/evalRubrics')));
  });
});
