import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { DocumentReference } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { DrillAnswerRequestSchema, type DrillAnswerResponse } from '@/lib/schemas/api';
import type { DrillItem } from '@/lib/schemas/curriculum';
import {
  DrillAttemptDocSchema,
  DrillAttemptStartDocSchema,
  ReviewScheduleDocSchema,
  type DrillAttemptDoc,
  type ReviewScheduleDoc,
} from '@/lib/schemas/learning';
import { correctAnswerForDrill, drillRuleIds, gradeDrillAnswer } from '@/lib/services/drill-grader';
import { ServiceError } from '@/lib/services/errors';
import { buildRuleIdsByDrillId } from '@/lib/services/learning-evidence';
import { classifyDrillAttempt, nextReviewSchedule } from '@/lib/services/retrieval-schedule';
import { reviewScheduleDocId } from '@/lib/services/review-schedule-id';
import { errorResponse, parseJsonBody } from '@/lib/services/route-helpers';
import { loadLearnerTrackContext } from '@/lib/services/track-loader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function responseFor(
  drill: DrillItem,
  attempt: DrillAttemptDoc,
  schedule: ReviewScheduleDoc | null,
  preview: boolean,
  revealFeedback = true,
): DrillAnswerResponse {
  return {
    attempt: preview ? null : attempt,
    correct: attempt.correct,
    score: attempt.score,
    firstIndependent: attempt.firstIndependent,
    attemptKind: attempt.attemptKind,
    correctAnswer: revealFeedback ? correctAnswerForDrill(drill) : null,
    explanation: revealFeedback ? drill.explanation : null,
    sourcePages: revealFeedback ? drill.sourcePages : [],
    schedule: preview ? null : schedule,
  };
}

function parseStoredAttempt(ref: DocumentReference, data: unknown): DrillAttemptDoc {
  const parsed = DrillAttemptDocSchema.safeParse({ ...data as object, id: ref.id });
  if (!parsed.success) throw new ServiceError(500, 'ATTEMPT_DATA_INVALID', 'A saved Drill attempt is not valid. Contact a Trainer.');
  return parsed.data;
}

/** Grade and record one answer atomically. Correctness and analytical fields never come from the browser. */
export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const body = await parseJsonBody(req, DrillAnswerRequestSchema);
  if (!body.ok) return body.response;

  try {
    const { user } = auth;
    const input = body.data;
    const { version, isDraft } = await loadLearnerTrackContext(user, input.trackId, input.versionId);
    const unit = version.units.find((candidate) => candidate.id === input.unitId);
    const drill = unit?.drills.find((candidate) => candidate.id === input.drillId);
    if (!unit || !drill) return jsonError(404, 'DRILL_NOT_FOUND', 'This Drill does not exist in the Unit.');
    if (input.answer.kind !== drill.kind) {
      return jsonError(400, 'ANSWER_KIND_MISMATCH', 'The answer does not match this Drill type. Reload and try again.');
    }

    const requestHash = `sha256:${digest(JSON.stringify({ learnerId: user.uid, ...input }))}`;
    const attemptRef = adminDb.collection('drillAttempts').doc(`attempt_${digest(`${user.uid}:${input.idempotencyKey}`)}`);
    const startRef = adminDb.collection('drillAttemptStarts').doc(input.startId);
    const scheduleRef = adminDb.collection('reviewSchedules').doc(reviewScheduleDocId(user.uid, version.versionId, input.drillId));
    const attemptsQuery = adminDb.collection('drillAttempts')
      .where('learnerId', '==', user.uid)
      .where('trackId', '==', input.trackId)
      .where('curriculumVersion', '==', version.versionId);

    const response = await adminDb.runTransaction(async (tx) => {
      const [attemptSnap, startSnap, scheduleSnap] = await tx.getAll(attemptRef, startRef, scheduleRef);
      const previousAttemptsSnap = await tx.get(attemptsQuery);

      if (attemptSnap.exists) {
        const existing = parseStoredAttempt(attemptRef, attemptSnap.data());
        if (existing.requestHash !== requestHash || existing.learnerId !== user.uid) {
          throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT', 'This submission key was already used for a different answer.');
        }
        const storedSchedule = scheduleSnap.exists
          ? ReviewScheduleDocSchema.parse({ ...scheduleSnap.data(), id: scheduleSnap.id })
          : null;
        // A matched replay is the same learner resubmitting the identical answer (for example a retry after a
        // dropped response), so it gets the same feedback the first response carried.
        return responseFor(
          drill,
          existing,
          storedSchedule?.lastAttemptId === existing.id ? storedSchedule : null,
          isDraft,
        );
      }

      if (!startSnap.exists) throw new ServiceError(404, 'START_NOT_FOUND', 'Start the Drill again before submitting this answer.');
      const start = DrillAttemptStartDocSchema.parse({ ...startSnap.data(), id: startSnap.id });
      if (
        start.learnerId !== user.uid || start.trackId !== input.trackId || start.unitId !== input.unitId ||
        start.drillId !== input.drillId || start.curriculumVersion !== version.versionId
      ) {
        throw new ServiceError(403, 'START_MISMATCH', 'This Drill start does not belong to the submitted answer.');
      }
      if (start.consumedAt !== null) {
        throw new ServiceError(409, 'START_ALREADY_CONSUMED', 'This Drill start was already submitted. Start the Drill again.');
      }

      const submittedAt = new Date().toISOString();
      const previousAttempts = previousAttemptsSnap.docs.map((doc) => parseStoredAttempt(doc.ref, doc.data()));
      const sameDrillAttempts = previousAttempts.filter((attempt) => attempt.drillId === input.drillId);
      const attemptNumber = Math.max(0, ...sameDrillAttempts.map((attempt) => attempt.attemptNumber)) + 1;
      const previousSchedule = scheduleSnap.exists
        ? ReviewScheduleDocSchema.parse({ ...scheduleSnap.data(), id: scheduleSnap.id })
        : null;
      if (previousSchedule && (
        previousSchedule.learnerId !== user.uid || previousSchedule.drillId !== input.drillId ||
        previousSchedule.curriculumVersion !== version.versionId
      )) {
        throw new ServiceError(409, 'REVIEW_SCHEDULE_MISMATCH', 'The review schedule does not match this Drill.');
      }
      const attemptKind = classifyDrillAttempt({
        now: submittedAt,
        drillId: input.drillId,
        ruleIds: drillRuleIds(drill),
        ruleIdsByDrillId: buildRuleIdsByDrillId(version),
        previousAttempts,
        schedule: previousSchedule,
      });
      const correct = gradeDrillAnswer(drill, input.answer);
      const attempt = DrillAttemptDocSchema.parse({
        schemaVersion: 1,
        id: attemptRef.id,
        learnerId: user.uid,
        partnerCohortId: user.partnerCohortId,
        trackId: input.trackId,
        unitId: input.unitId,
        drillId: input.drillId,
        curriculumVersion: version.versionId,
        attemptNumber,
        attemptKind,
        answer: input.answer,
        correct,
        score: correct ? 100 : 0,
        firstIndependent: attemptNumber === 1 && attemptKind === 'initial',
        misconceptionRuleIds: correct ? [] : drillRuleIds(drill),
        startId: start.id,
        requestHash,
        startedAt: start.startedAt,
        submittedAt,
        durationMs: Math.min(1_800_000, Math.max(0, Date.parse(submittedAt) - Date.parse(start.startedAt))),
        provenance: 'live',
      });
      const schedule = nextReviewSchedule({
        previous: previousSchedule,
        attempt,
        ruleIds: drillRuleIds(drill),
      });
      schedule.id = scheduleRef.id;

      // Draft previews store no attempt, so the start stays reusable; consuming it would make a retry with the
      // same idempotency key fail with START_ALREADY_CONSUMED instead of replaying.
      if (!isDraft) {
        tx.set(attemptRef, attempt);
        tx.set(scheduleRef, ReviewScheduleDocSchema.parse(schedule));
        tx.update(startRef, { consumedAt: submittedAt });
      }
      return responseFor(drill, attempt, schedule, isDraft);
    });

    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error, 'progress/drill-answer');
  }
}
