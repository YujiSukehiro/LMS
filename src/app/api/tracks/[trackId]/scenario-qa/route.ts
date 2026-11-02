/**
 * POST /api/tracks/[trackId]/scenario-qa
 * Internal-ops-only, in-memory deterministic fixture execution. Never reads or writes learner progress or Firestore.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isInternalOps, jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import {
  ScenarioQAEventResultSchema,
  ScenarioQARequestSchema,
  ScenarioQAResponseSchema,
} from '@/lib/schemas/api';
import type { ScenarioQAFixture, SimulationEvent } from '@/lib/schemas/simulation-state';
import { runScenarioQAFixture } from '@/lib/services/scenario-state';
import { errorResponse, parseJsonBody } from '@/lib/services/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ trackId: string }> };
type QARun = ReturnType<typeof runScenarioQAFixture>;
type EventPayload = z.infer<typeof ScenarioQAEventResultSchema>['payload'];

const TrackIdSchema = z.string().min(1).max(200);

/** Free text, payment tokens, hashes, runtime provenance and external identifiers are deliberately excluded. */
const RETURNABLE_EVENT_PAYLOAD_KEYS = [
  'synthetic',
  'status',
  'reason',
  'inspectionId',
  'localTimeEligible',
  'missingInspectionIds',
  'contactReached',
  'verified',
  'disclosure',
  'intent',
  'customerAskedPrice',
  'selectedPlanId',
  'baseRecoveryCommitted',
  'assetId',
  'offerCount',
  'verbalPermission',
  'stage',
  'recording',
  'outcome',
  'designatedFakeToken',
  'actionId',
  'amountCents',
  'duration',
  'completionId',
  'organic',
  'receiptId',
  'suppressed',
  'callbackAt',
  'disposition',
  'valid',
  'missingEvidence',
  'reasons',
] as const;

function sanitizedEventPayload(event: SimulationEvent): EventPayload {
  const payload: EventPayload = {};
  for (const key of RETURNABLE_EVENT_PAYLOAD_KEYS) {
    const value = event.payload[key];
    if (value === null || typeof value === 'string' || typeof value === 'boolean') payload[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) payload[key] = value;
    else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) payload[key] = [...value];
  }
  return payload;
}

function expectationFailures(fixture: ScenarioQAFixture, run: QARun): string[] {
  const failures: string[] = [];
  for (const expected of fixture.expectedGateResults) {
    const actual = run.gates.find((gate) => gate.ruleId === expected.ruleId)?.status ?? 'not returned';
    if (actual !== expected.status) failures.push(`Expected gate ${expected.ruleId} to be ${expected.status}; observed ${actual}.`);
  }
  if (fixture.kind === 'golden_pass') {
    if (!run.eligibility.eligible) failures.push('Expected the golden pass to be assessment-eligible; observed eligibility blockers.');
    if (run.state.selectedDisposition !== fixture.expectedDisposition) {
      failures.push(`Expected disposition ${fixture.expectedDisposition}; observed ${run.state.selectedDisposition ?? 'none'}.`);
    }
  } else if (run.eligibility.eligible) {
    failures.push('Expected the golden critical fail to be assessment-ineligible; observed an eligible result.');
  }
  return failures;
}

export async function POST(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  if (!isInternalOps(auth.user)) return jsonError(403, 'FORBIDDEN', 'Only internal trainers and operations staff can run scripted QA.');

  const rawTrackId = (await params).trackId;
  const trackId = TrackIdSchema.safeParse(rawTrackId);
  if (!trackId.success) return jsonError(400, 'VALIDATION_FAILED', 'The Track ID is not valid.');

  const body = await parseJsonBody(req, ScenarioQARequestSchema);
  if (!body.ok) return body.response;
  const fixtures = body.data.fixtureId
    ? body.data.fixtures.filter((fixture) => fixture.id === body.data.fixtureId)
    : body.data.fixtures;
  if (fixtures.length === 0) return jsonError(404, 'QA_FIXTURE_NOT_FOUND', 'The requested QA fixture was not included in the request.');

  try {
    const results = fixtures.map((fixture) => {
      const run = runScenarioQAFixture(body.data.scenario, fixture);
      return {
        fixtureId: fixture.id,
        title: fixture.title,
        kind: fixture.kind,
        passed: run.passed,
        outcome: {
          lifecycle: run.state.lifecycle,
          selectedDisposition: run.state.selectedDisposition,
          dispositionCorrect: run.state.dispositionCorrect,
          wrapUpComplete: run.state.wrapUpComplete,
        },
        events: run.events.map((event) => ({
          id: event.id,
          sequence: event.sequence,
          type: event.type,
          actor: event.actor,
          provenance: event.provenance,
          payload: sanitizedEventPayload(event),
        })),
        gates: run.gates.map(({ sourceRefs, ...gate }) => ({ ...gate, sourceRefCount: sourceRefs.length })),
        eligibility: run.eligibility,
        errors: run.errors,
        expectationFailures: expectationFailures(fixture, run),
      };
    });
    const response = ScenarioQAResponseSchema.parse({
      trackId: trackId.data,
      scenarioId: body.data.scenario.id,
      results,
    });
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error, 'scenario-qa');
  }
}
