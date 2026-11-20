/**
 * Demo-seed builders for versioned learning evidence (drill attempts, review schedules, Sim sessions
 * with deterministic evidence, scenario coverage, certification). Every record is produced by the
 * same pure service functions the app uses at runtime, so the home page, enrollment, Track page,
 * Team Progress and analytics agree. Records are labelled as seeded (`seed-` ids, model "synthetic-seed").
 */
import { createHash } from 'node:crypto';
import { createProvenance, type ProvenanceRecord } from '../src/lib/ai/provenance';
import { SimEvaluationSchema, type EnrollmentDoc, type SimEvaluation, type SimSessionDoc } from '../src/lib/schemas/analytics';
import type { DrillItem, PublicSimScenario, TrackVersionDoc } from '../src/lib/schemas/curriculum';
import {
  DrillAttemptDocSchema,
  type AssessmentBlueprintDoc,
  type CertificationDoc,
  type DrillAnswer,
  type DrillAttemptDoc,
  type ReviewScheduleDoc,
  type ScenarioCoverageDoc,
} from '../src/lib/schemas/learning';
import type { SimulationAction, SimulationEvent, ScenarioState } from '../src/lib/schemas/simulation-state';
import { evaluateCertificationEligibility, grantCertification, type CertificationEligibility } from '../src/lib/services/certification';
import { correctAnswerForDrill, gradeDrillAnswer } from '../src/lib/services/drill-grader';
import { classifyDrillAttempt, nextReviewSchedule } from '../src/lib/services/retrieval-schedule';
import { reviewScheduleDocId } from '../src/lib/services/review-schedule-id';
import {
  appendDialogueEvent,
  appendEvaluationEvent,
  applyDeterministicAssessment,
  applySimulationAction,
  assessmentEligibility,
  createInitialScenarioState,
  evaluateDeterministicGates,
  validateDisposition,
} from '../src/lib/services/scenario-state';
import { buildScenarioCoverageDoc } from '../src/lib/services/scenario-coverage';

/** Seeded records claim no real model run: the label makes them easy to spot and filter. */
export function seedProvenance(task: 'session' | 'judge', recordedAt: number): ProvenanceRecord {
  return createProvenance({
    source: 'local_ai',
    provider: 'seed-demo',
    model: 'synthetic-seed',
    prompt: task === 'judge' ? { templateId: 'simulation.judge', templateVersion: 'seed-demo' } : null,
    runtime: { label: 'Seeded demo data', protocol: 'synthetic' },
    recordedAt: new Date(recordedAt).toISOString(),
  });
}

function sha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

/** The answer a learner submits: the app's own answer key, or a deliberate miss derived from it. */
export function seedDrillAnswer(drill: DrillItem, correct: boolean): DrillAnswer {
  const key = correctAnswerForDrill(drill);
  if (correct) return key;
  switch (key.kind) {
    case 'MULTIPLE_CHOICE':
      return { kind: key.kind, optionId: (drill.kind === 'MULTIPLE_CHOICE' ? drill.options : []).find((o) => o.id !== key.optionId)!.id };
    case 'TRUE_FALSE_SPOT':
      return { kind: key.kind, isCompliant: !key.isCompliant };
    case 'SEQUENCE_ORDER':
      return { kind: key.kind, orderedStepIds: [...key.orderedStepIds].reverse() };
    case 'MATCH_PAIRS': {
      const left = Object.keys(key.matches);
      return { kind: key.kind, matches: Object.fromEntries(left.map((id, i) => [id, key.matches[left[(i + 1) % left.length]]])) };
    }
    case 'FILL_BLANK_CHOICE':
      return { kind: key.kind, word: (drill.kind === 'FILL_BLANK_CHOICE' ? drill.wordBank : []).find((w) => w !== key.word)! };
  }
}

/** Minutes between Drill submissions inside one seeded Checkpoint sitting. */
export const SEED_DRILL_SPACING_MINUTES = 6;

/**
 * Replay a Checkpoint sitting through the app's attempt classifier and review scheduler:
 * each Drill once in order, then each missed Drill again at the end (as the DrillRunner does).
 */
export function seedCheckpointAttempts(args: {
  learnerId: string;
  partnerCohortId: string;
  version: TrackVersionDoc;
  unitId: string;
  firstTry: readonly boolean[];
  startedAt: number;
  ruleIdsByDrillId: Readonly<Record<string, readonly string[]>>;
  previousAttempts: DrillAttemptDoc[];
  schedules: Map<string, ReviewScheduleDoc>;
}): DrillAttemptDoc[] {
  const unit = args.version.units.find((candidate) => candidate.id === args.unitId);
  if (!unit) throw new Error(`Unknown Unit ${args.unitId}`);
  const order: Array<{ drill: DrillItem; correct: boolean }> = [
    ...unit.drills.map((drill, index) => ({ drill, correct: args.firstTry[index] })),
    ...unit.drills.filter((_, index) => !args.firstTry[index]).map((drill) => ({ drill, correct: true })),
  ];
  const created: DrillAttemptDoc[] = [];
  order.forEach(({ drill, correct }, index) => {
    const submittedMs = args.startedAt + (index + 1) * SEED_DRILL_SPACING_MINUTES * 60_000;
    const submittedAt = new Date(submittedMs).toISOString();
    const startedAt = new Date(submittedMs - 45_000).toISOString();
    const ruleIds = args.ruleIdsByDrillId[drill.id] ?? [];
    const scheduleKey = `${args.learnerId}_${drill.id}`;
    const all = [...args.previousAttempts, ...created];
    const attemptKind = classifyDrillAttempt({
      now: submittedAt,
      drillId: drill.id,
      ruleIds,
      ruleIdsByDrillId: args.ruleIdsByDrillId,
      previousAttempts: all,
      schedule: args.schedules.get(scheduleKey) ?? null,
    });
    const attemptNumber = all.filter((attempt) => attempt.drillId === drill.id).length + 1;
    const id = `seed-attempt-${args.learnerId}-${drill.id}-${attemptNumber}`;
    const answer = seedDrillAnswer(drill, correct);
    if (gradeDrillAnswer(drill, answer) !== correct) throw new Error(`Seeded answer for ${drill.id} does not grade as ${correct}.`);
    const attempt = DrillAttemptDocSchema.parse({
      schemaVersion: 1,
      id,
      learnerId: args.learnerId,
      partnerCohortId: args.partnerCohortId,
      trackId: args.version.trackId,
      unitId: unit.id,
      drillId: drill.id,
      curriculumVersion: args.version.versionId,
      attemptNumber,
      attemptKind,
      answer,
      correct,
      score: correct ? 100 : 0,
      firstIndependent: attemptNumber === 1,
      misconceptionRuleIds: correct ? [] : [...ruleIds],
      startId: `seed-start-${id}`,
      requestHash: sha256({ id, answer }),
      startedAt,
      submittedAt,
      durationMs: 45_000,
      provenance: 'live',
    });
    created.push(attempt);
    const nextSchedule = nextReviewSchedule({ previous: args.schedules.get(scheduleKey) ?? null, attempt, ruleIds });
    args.schedules.set(scheduleKey, {
      ...nextSchedule,
      id: reviewScheduleDocId(args.learnerId, args.version.versionId, drill.id),
    });
  });
  return created;
}

export interface SeedSimScript {
  /** Index of the transcript message before which the learner presses Verify identity. */
  verifyBeforeMessageIndex: number;
  /** Panel actions taken after the dialogue and before wrap-up. */
  postCallActions: SimulationAction[];
}

/**
 * Re-run a seeded call through the Simulation engine: opening, inspections, dial, the transcript,
 * panel actions, wrap-up, deterministic gates and the deterministic assessment, then the evaluate event.
 */
export function seedSimSessionEvidence(args: {
  sessionId: string;
  scenario: PublicSimScenario;
  transcript: ReadonlyArray<readonly ['agent' | 'counterparty', string]>;
  script: SeedSimScript;
  disposition: NonNullable<ScenarioState['selectedDisposition']>;
  judged: Omit<SimEvaluation, 'provenance' | 'gateResults' | 'assessmentEligibility' | 'dispositionValidation' | 'evidenceEventIds'>;
  startedAt: number;
}): Pick<SimSessionDoc, 'scenarioState' | 'simulationEvents' | 'gateResults' | 'nextEventSequence' | 'evaluation' | 'selectedDisposition' | 'provenance'> {
  let state = createInitialScenarioState(args.scenario);
  let events: SimulationEvent[] = [];
  let tick = 0;
  const at = () => new Date(args.startedAt + (tick += 1) * 20_000);
  const say = (actor: 'learner' | 'customer', content: string) => {
    const applied = appendDialogueEvent({
      sessionId: args.sessionId, state, events, actor, content,
      provenance: actor === 'learner' ? 'learner' : events.length === 0 ? 'deterministic' : 'local_ai',
      now: at(), eventId: `${args.sessionId}-e${events.length + 1}`,
    });
    state = applied.state;
    events = [...events, applied.event];
  };
  const act = (action: SimulationAction) => {
    const applied = applySimulationAction({ sessionId: args.sessionId, scenario: args.scenario, state, events, action, now: at(), eventId: `${args.sessionId}-e${events.length + 1}` });
    state = applied.state;
    events = [...events, applied.event];
  };

  const [opening, ...rest] = args.transcript;
  say('customer', opening[1]);
  for (const inspectionId of args.scenario.evidenceRequirements?.requiredInspections ?? []) act({ type: 'inspect', inspectionId });
  act({ type: 'dial' });
  rest.forEach(([role, content], offset) => {
    if (offset + 1 === args.script.verifyBeforeMessageIndex) act({ type: 'verify_identity' });
    say(role === 'agent' ? 'learner' : 'customer', content);
  });
  args.script.postCallActions.forEach(act);
  act({ type: 'wrap_up', disposition: args.disposition });

  const gates = evaluateDeterministicGates(args.scenario, state, events);
  const eligibility = assessmentEligibility(args.scenario, state, events, gates);
  const evaluation = applyDeterministicAssessment({
    evaluation: SimEvaluationSchema.parse({ ...args.judged, provenance: seedProvenance('judge', args.judged.evaluatedAt) }),
    gates,
    eligibility,
    disposition: validateDisposition(state, args.disposition),
  });
  const evaluated = appendEvaluationEvent({
    sessionId: args.sessionId, state, events, evaluation, now: new Date(args.judged.evaluatedAt), eventId: `${args.sessionId}-e${events.length + 1}`,
  });
  const simulationEvents = [...events, evaluated.event];
  return {
    scenarioState: evaluated.state,
    simulationEvents,
    gateResults: gates,
    nextEventSequence: evaluated.event.sequence + 1,
    evaluation,
    selectedDisposition: state.selectedDisposition ?? args.disposition,
    provenance: seedProvenance('session', args.startedAt),
  };
}

/**
 * Coverage rows (appended in evaluation order, as the evaluate route does) and the certification the
 * app would grant for this evidence. Enrollment status must be derived from `certification`.
 */
export function seedCoverageAndCertification(args: {
  learnerId: string;
  partnerCohortId: string;
  blueprint: AssessmentBlueprintDoc;
  version: TrackVersionDoc;
  enrollment: EnrollmentDoc;
  drillAttempts: readonly DrillAttemptDoc[];
  sessions: readonly SimSessionDoc[];
  ruleIdsByDrillId: Readonly<Record<string, readonly string[]>>;
}): { coverage: ScenarioCoverageDoc[]; certification: CertificationDoc | null; eligibility: CertificationEligibility } {
  const sessionsById = new Map(args.sessions.map((session) => [session.id, session]));
  const coverage = new Map<string, ScenarioCoverageDoc>();
  let certification: CertificationDoc | null = null;
  const ordered = [...args.sessions].sort((a, b) => (a.evaluation?.evaluatedAt ?? a.updatedAt) - (b.evaluation?.evaluatedAt ?? b.updatedAt));
  let eligibility: CertificationEligibility | null = null;
  for (const session of ordered) {
    const evaluatedAt = session.evaluation?.evaluatedAt ?? session.updatedAt;
    coverage.set(session.scenarioId, buildScenarioCoverageDoc({
      learnerId: args.learnerId,
      partnerCohortId: args.partnerCohortId,
      trackId: args.version.trackId,
      versionId: args.version.versionId,
      blueprint: args.blueprint,
      existing: coverage.get(session.scenarioId) ?? null,
      session,
      sessionsById,
      now: evaluatedAt,
    }));
    eligibility = evaluateCertificationEligibility({
      learnerId: args.learnerId,
      blueprint: args.blueprint,
      enrollment: args.enrollment,
      drillAttempts: args.drillAttempts.filter((attempt) => Date.parse(attempt.submittedAt) <= evaluatedAt),
      scenarioCoverage: [...coverage.values()],
      simSessions: args.sessions,
      ruleIdsByDrillId: args.ruleIdsByDrillId,
    });
    if (!certification && eligibility.eligible) {
      certification = grantCertification({
        learnerId: args.learnerId,
        partnerCohortId: args.partnerCohortId,
        blueprint: args.blueprint,
        eligibility,
        actorUid: args.learnerId,
        now: new Date(evaluatedAt),
        reason: 'All current-version assessment requirements passed.',
      }).certification;
    }
  }
  eligibility ??= evaluateCertificationEligibility({
    learnerId: args.learnerId,
    blueprint: args.blueprint,
    enrollment: args.enrollment,
    drillAttempts: args.drillAttempts,
    scenarioCoverage: [],
    simSessions: [],
    ruleIdsByDrillId: args.ruleIdsByDrillId,
  });
  return { coverage: [...coverage.values()], certification, eligibility };
}
