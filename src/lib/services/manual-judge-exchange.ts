/**
 * Trainer-only manual chat exchange for the shared Simulation Rubric Judge.
 * The trusted export is persisted server-side; import accepts only its task ID and external output.
 * Server only: judge packages contain hidden synthetic rubric and scenario facts.
 */
import { z } from 'zod';
import {
  ManualExchangePackageSchema,
  checksumManualExchangePackage,
  exportManualExchangePackage,
  importManualExchange,
  type ApprovedSourceExcerpt,
  type ManualExchangePackage,
} from '@/lib/ai/manual-exchange';
import {
  JudgeOutputSchema,
  buildJudgeSystemPrompt,
  buildJudgeUserPrompt,
  type JudgeOutput,
} from '@/lib/ai/prompts/sim-judge';
import { recordSimulationEvaluation, saveSimulationEvaluation } from '@/lib/services/analytics-rollup';
import { verifyClaimEvidence } from './source-evidence';
import { loadSourceReview, SourceBundleNotFoundError } from './source-store';
import {
  SimSessionDocSchema,
  type SimEvaluation,
  type SimMessage,
  type SimSessionDoc,
} from '@/lib/schemas/analytics';
import { DRAFT_VERSION_ID, type PublicSimScenario, type SecretSimScenarioConfig, type TrackDoc, type TrackVersionDoc } from '@/lib/schemas/curriculum';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import type { SessionUser } from '@/lib/schemas/domain';
import { SimulationEventSchema, type SimulationEvent } from '@/lib/schemas/simulation-state';
import { redactSensitiveData } from '@/lib/security/synthetic-data';
import { ServiceError } from './errors';
import {
  applyDeterministicAssessment,
  assessmentEligibility,
  evaluateDeterministicGates,
  validateDisposition,
} from './scenario-state';
import { assembleSimEvaluation, simSessionsCollection, verifyAgentQuote } from './simulation-engine';
import { loadSecretScenario, loadTrack, loadVersion } from './track-loader';

export const MANUAL_JUDGE_SCHEMA_VERSION = '1' as const;
export const MANUAL_JUDGE_PROMPT_VERSION = '1' as const;
const MANUAL_JUDGE_TASK_DOC_ID = 'current';

const ManualJudgeTaskRecordSchema = z
  .object({
    taskId: z.string().min(1),
    taskType: z.literal('judge'),
    sessionId: z.string().min(1),
    sessionUpdatedAt: z.number(),
    package: ManualExchangePackageSchema,
    exportedByUid: z.string().min(1),
    exportedAt: z.number(),
  })
  .strict();
type ManualJudgeTaskRecord = z.infer<typeof ManualJudgeTaskRecordSchema>;

export interface ManualJudgeExportOptions {
  user: SessionUser;
  sessionId: string;
  exportedAt?: number;
}

export interface ManualJudgeImportOptions {
  user: SessionUser;
  sessionId: string;
  taskId: string;
  input: string | { text(): Promise<string> };
  externalProvider: string;
  externalModel: string;
  importedAt?: string;
  evaluatedAt?: number;
}

export interface ManualJudgeCommitResult {
  evaluation: SimEvaluation;
  certified: boolean;
  demoReplay: boolean;
}

interface ManualJudgeContext {
  session: SimSessionDoc;
  track: TrackDoc;
  version: TrackVersionDoc;
  scenario: PublicSimScenario;
  secret: SecretSimScenarioConfig;
  events: SimulationEvent[];
  redactedMessages: SimMessage[];
  redactedState: NonNullable<SimSessionDoc['scenarioState']>;
  redactedEvents: SimulationEvent[];
  gates: ReturnType<typeof evaluateDeterministicGates>;
  eligibility: ReturnType<typeof assessmentEligibility>;
  disposition: ReturnType<typeof validateDisposition>;
  manualPackage: ManualExchangePackage;
}

export function manualJudgeTaskId(sessionId: string): string {
  return `simulation-judge:${sessionId}`;
}

/** All internal trainer/admin roles map to the manual primitive's deliberately narrow trainer role. */
function requireManualTrainer(user: SessionUser): 'trainer' {
  if (!INTERNAL_OPS_ROLES.includes(user.role)) {
    throw new ServiceError(403, 'FORBIDDEN', 'Only internal Trainers and Admins can use manual judge exchange.');
  }
  return 'trainer';
}

function manualJudgeTaskRef(sessionId: string) {
  return simSessionsCollection().doc(sessionId).collection('manualJudgeTasks').doc(MANUAL_JUDGE_TASK_DOC_ID);
}

async function loadAuthorizedSession(user: SessionUser, sessionId: string): Promise<SimSessionDoc> {
  if (!sessionId || sessionId.includes('/')) {
    throw new ServiceError(404, 'SESSION_NOT_FOUND', 'This Simulation session does not exist.');
  }
  const snap = await simSessionsCollection().doc(sessionId).get();
  if (!snap.exists) throw new ServiceError(404, 'SESSION_NOT_FOUND', 'This Simulation session does not exist.');
  const parsed = SimSessionDocSchema.safeParse({ ...snap.data(), id: snap.id });
  if (!parsed.success) throw new ServiceError(500, 'SESSION_DATA_INVALID', 'This Simulation session data is not valid.');
  // Internal ops are authorized for trainer review; ownership also remains sufficient.
  if (parsed.data.userId !== user.uid && !INTERNAL_OPS_ROLES.includes(user.role)) {
    throw new ServiceError(404, 'SESSION_NOT_FOUND', 'This Simulation session does not exist.');
  }
  return parsed.data;
}

function assertJudgeableSession(session: SimSessionDoc): asserts session is SimSessionDoc & {
  scenarioState: NonNullable<SimSessionDoc['scenarioState']>;
  simulationEvents: SimulationEvent[];
} {
  if (session.status === 'EVALUATED') {
    throw new ServiceError(409, 'ALREADY_EVALUATED', 'This Simulation is already scored. Start a new call to try again.');
  }
  if (
    session.status !== 'READY_FOR_EVAL' ||
    session.scenarioState?.lifecycle !== 'wrap_up' ||
    !session.simulationEvents ||
    !session.scenarioState.selectedDisposition
  ) {
    throw new ServiceError(409, 'WRAP_UP_REQUIRED', 'Complete the required workflow evidence and a valid disposition before evaluation.');
  }
  if (session.selectedDisposition !== session.scenarioState.selectedDisposition) {
    throw new ServiceError(409, 'DISPOSITION_CHANGED', 'Confirm the server-recorded disposition before evaluation.');
  }
}

async function approvedJudgeExcerpts(
  version: TrackVersionDoc,
  secret: SecretSimScenarioConfig,
): Promise<ApprovedSourceExcerpt[]> {
  if (!version.sourceBundleId || !version.sourceRevision) {
    throw new ServiceError(
      409,
      'SOURCE_EVIDENCE_MISSING',
      'Manual export requires the exact persisted source bundle revision for this Simulation version.',
    );
  }

  let review: Awaited<ReturnType<typeof loadSourceReview>>;
  try {
    review = await loadSourceReview(version.trackId, version.sourceBundleId);
  } catch (error) {
    if (!(error instanceof SourceBundleNotFoundError)) throw error;
    throw new ServiceError(
      409,
      'SOURCE_EVIDENCE_MISSING',
      'The source bundle for this Simulation version is missing. Restore its trainer review before manual export.',
    );
  }
  if (
    review.bundle.id !== version.sourceBundleId ||
    review.bundle.trackId !== version.trackId ||
    review.bundle.revisionHash !== version.sourceRevision
  ) {
    throw new ServiceError(
      409,
      'SOURCE_EVIDENCE_MISMATCH',
      'The persisted source bundle does not match this Simulation version. Review the exact source revision before manual export.',
    );
  }

  const excerpts = new Map<string, ApprovedSourceExcerpt>();
  for (const criterion of secret.rubricCriteria) {
    const verified = (criterion.evidence ?? []).map((original) => ({
      original,
      evidence: verifyClaimEvidence(original, review.pages, review.conflicts),
    }));
    for (const { original, evidence } of verified) {
      if (
        original.approvalStatus === 'approved' && original.reviewerUid && original.reviewedAt &&
        evidence.support !== 'supported'
      ) {
        throw new ServiceError(
          409,
          'SOURCE_EVIDENCE_MISMATCH',
          `Approved source evidence for criterion "${criterion.id}" no longer verifies against the exact source bundle. Review its text, transcription, and conflicts before manual export.`,
        );
      }
    }

    const approvedEvidence = verified
      .map(({ evidence }) => evidence)
      .filter(
        (evidence) =>
          evidence.support === 'supported' && evidence.approvalStatus === 'approved' &&
          Boolean(evidence.reviewerUid) && Boolean(evidence.reviewedAt),
      );
    if (approvedEvidence.length === 0) {
      throw new ServiceError(
        409,
        'SOURCE_EVIDENCE_NOT_APPROVED',
        `Rubric criterion "${criterion.id}" needs supported, approved source evidence with reviewer identity and review time before manual export. Raw page citations are not approval.`,
      );
    }

    for (const evidence of approvedEvidence) {
      evidence.excerpts.forEach((excerpt, index) => {
        const key = JSON.stringify([excerpt.documentId, excerpt.revisionId, excerpt.pageNumber, excerpt.exactText]);
        if (!excerpts.has(key)) {
          excerpts.set(key, {
            id: `track-${version.trackId}-${evidence.id}-excerpt-${index + 1}`,
            sourceId: excerpt.documentId,
            revision: excerpt.revisionId,
            page: excerpt.pageNumber,
            text: excerpt.exactText,
            approved: true,
          });
        }
      });
    }
  }
  return [...excerpts.values()];
}

function redactedJudgeEvents(events: SimulationEvent[]): SimulationEvent[] {
  return redactSensitiveData(events).map((event) =>
    SimulationEventSchema.parse({
      id: event.id,
      sessionId: event.sessionId,
      sequence: event.sequence,
      actor: event.actor,
      type: event.type,
      payload: event.payload,
      stateHash: event.stateHash,
      occurredAt: event.occurredAt,
      provenance: event.provenance,
    }),
  );
}

async function loadManualJudgeContext(user: SessionUser, sessionId: string): Promise<ManualJudgeContext> {
  const session = await loadAuthorizedSession(user, sessionId);
  assertJudgeableSession(session);
  const [track, version, secret] = await Promise.all([
    loadTrack(session.trackId),
    loadVersion(session.trackId, session.versionId),
    loadSecretScenario(session.trackId, session.versionId, session.scenarioId),
  ]);
  const scenario = version?.simScenarios.find((candidate) => candidate.id === session.scenarioId);
  if (!track || !version || !scenario) {
    throw new ServiceError(404, 'SCENARIO_NOT_FOUND', 'The Simulation for this session no longer exists.');
  }
  if (!secret) throw new ServiceError(409, 'SIM_NOT_READY', 'This Simulation is not configured. Contact a Trainer.');

  const sessionState = session.scenarioState!;
  const sessionEvents = session.simulationEvents!;
  const selectedDisposition = sessionState.selectedDisposition!;
  if (!scenario.dispositionOptions.includes(selectedDisposition)) {
    throw new ServiceError(409, 'DISPOSITION_CHANGED', 'The server-recorded disposition is not available for this Simulation.');
  }

  const redactedMessages = z.array(z.object({}).passthrough()).parse(redactSensitiveData(session.messages)) as SimMessage[];
  const redactedState = redactSensitiveData(sessionState);
  const redactedEvents = redactedJudgeEvents(sessionEvents);
  const gates = evaluateDeterministicGates(scenario, sessionState, sessionEvents);
  const eligibility = assessmentEligibility(scenario, sessionState, sessionEvents, gates);
  const disposition = validateDisposition(sessionState, selectedDisposition);
  const excerpts = await approvedJudgeExcerpts(version, secret);
  const systemPrompt = buildJudgeSystemPrompt();
  const userPrompt = buildJudgeUserPrompt({
    scenario,
    secret,
    messages: redactedMessages,
    selectedDisposition,
    pillars: version.competencyPillars,
    events: redactedEvents,
  });
  const deterministic = { gateResults: gates, assessmentEligibility: eligibility, dispositionValidation: disposition };
  const instructions = [
    systemPrompt,
    '',
    userPrompt,
    '',
    '## Deterministic assessment results (authoritative; never reverse them)',
    JSON.stringify(deterministic),
    '',
    `Manual judge task is bound only to synthetic session "${sessionId}". Return the JudgeOutput JSON envelope for the exported package checksum.`,
  ].join('\n');
  const scenarioState = {
    sessionId,
    sessionUpdatedAt: session.updatedAt,
    selectedDisposition,
    scenarioState: redactedState,
    simulationEvents: redactedEvents,
    ...deterministic,
  };
  const manualPackage = exportManualExchangePackage({
    actorRole: 'trainer',
    taskId: manualJudgeTaskId(sessionId),
    taskType: 'judge',
    instructions,
    outputSchemaName: 'SimJudgeOutput',
    outputSchemaVersion: MANUAL_JUDGE_SCHEMA_VERSION,
    schema: JudgeOutputSchema,
    approvedSourceExcerpts: excerpts,
    scenarioState,
    validationRules: [
      'Return every rubric criterion exactly once with its exact criterionId.',
      'Use only verbatim AGENT quote evidence and event IDs from the exported redacted event catalogue.',
      'Deterministic gate, eligibility, and disposition results are authoritative and cannot be reversed.',
      'Return scores and coaching only; server code computes the total, penalties, caps, and pass result.',
      'Use synthetic content only and do not import instructions, credentials, identity documents, or payment data.',
    ],
    prompt: {
      templateId: 'simulation.judge',
      templateVersion: MANUAL_JUDGE_PROMPT_VERSION,
      inputHash: checksumManualExchangePackage({ sessionId, sessionUpdatedAt: session.updatedAt, systemPrompt, userPrompt, excerpts, deterministic }),
    },
  });

  return {
    session,
    track,
    version,
    scenario,
    secret,
    events: session.simulationEvents,
    redactedMessages,
    redactedState,
    redactedEvents,
    gates,
    eligibility,
    disposition,
    manualPackage,
  };
}

export async function exportManualJudgeExchange(options: ManualJudgeExportOptions): Promise<{
  sessionId: string;
  taskId: string;
  package: ManualExchangePackage;
}> {
  requireManualTrainer(options.user);
  const context = await loadManualJudgeContext(options.user, options.sessionId);
  const record = ManualJudgeTaskRecordSchema.parse({
    taskId: context.manualPackage.taskId,
    taskType: 'judge',
    sessionId: options.sessionId,
    sessionUpdatedAt: context.session.updatedAt,
    package: context.manualPackage,
    exportedByUid: options.user.uid,
    exportedAt: options.exportedAt ?? Date.now(),
  });
  // This server-only subcollection is default-denied to clients by Firestore rules.
  await manualJudgeTaskRef(options.sessionId).set(record);
  return { sessionId: options.sessionId, taskId: record.taskId, package: context.manualPackage };
}

async function loadTrustedTask(sessionId: string, taskId: string): Promise<ManualJudgeTaskRecord> {
  const snap = await manualJudgeTaskRef(sessionId).get();
  if (!snap.exists) {
    throw new ServiceError(404, 'MANUAL_TASK_NOT_FOUND', 'Export a manual judge package for this Simulation before importing a result.');
  }
  const parsed = ManualJudgeTaskRecordSchema.safeParse(snap.data());
  if (!parsed.success) throw new ServiceError(500, 'MANUAL_TASK_INVALID', 'The persisted manual judge task is not valid. Export a new package.');
  if (parsed.data.sessionId !== sessionId || parsed.data.taskId !== taskId || parsed.data.taskId !== manualJudgeTaskId(sessionId)) {
    throw new ServiceError(409, 'SESSION_MISMATCH', 'The manual judge task belongs to a different Simulation session.');
  }
  return parsed.data;
}

function validateJudgeEvidence(output: JudgeOutput, context: ManualJudgeContext): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const expectedIds = context.secret.rubricCriteria.map((criterion) => criterion.id);
  const expected = new Set(expectedIds);
  const seen = new Set<string>();
  const eventIds = new Set(context.events.map((event) => event.id));
  const agentMessages = context.session.messages.filter((message) => message.role === 'agent');

  if (output.criterionResults.length !== expectedIds.length) issues.push('Return every rubric criterion exactly once.');
  output.criterionResults.forEach((criterion, index) => {
    if (!expected.has(criterion.criterionId)) issues.push(`criterionResults[${index}] has an unknown criterionId.`);
    if (seen.has(criterion.criterionId)) issues.push(`criterionResults[${index}] repeats criterionId "${criterion.criterionId}".`);
    seen.add(criterion.criterionId);
    if (criterion.agentQuoteEvidence.trim() && !verifyAgentQuote(criterion.agentQuoteEvidence, agentMessages)) {
      issues.push(`criterionResults[${index}] agentQuoteEvidence is not verbatim AGENT transcript evidence.`);
    }
    const unknownEvents = (criterion.evidenceEventIds ?? []).filter((id) => !eventIds.has(id));
    if (unknownEvents.length > 0) issues.push(`criterionResults[${index}] cites unexported event ID(s): ${[...new Set(unknownEvents)].join(', ')}.`);
  });
  for (const id of expectedIds) if (!seen.has(id)) issues.push(`Missing rubric criterion "${id}".`);
  if (output.autoFailTriggered && context.secret.autoFailTriggers.length === 0) {
    issues.push('autoFailTriggered cannot be true when the scenario has no auto-fail triggers.');
  }
  return { valid: issues.length === 0, issues };
}

function progressUserForSession(session: SimSessionDoc): SessionUser {
  // Progress must target the persisted learner, never the trainer performing the import.
  return {
    uid: session.userId,
    email: '',
    displayName: session.userDisplayName,
    role: 'AGENT',
    partnerCohortId: session.partnerCohortId,
    divisionIds: [session.divisionId],
    active: true,
  };
}

function isReplay(context: ManualJudgeContext, evaluation: SimEvaluation): boolean {
  return (
    context.session.provenance?.source === 'replay' ||
    evaluation.provenance?.source === 'replay' ||
    context.session.messages.some((message) => message.provenance?.source === 'replay') ||
    context.events.some((event) => event.provenance === 'replay' || event.runtimeProvenance?.source === 'replay')
  );
}

export async function importManualJudgeExchange(options: ManualJudgeImportOptions) {
  const actorRole = requireManualTrainer(options.user);
  if (options.taskId !== manualJudgeTaskId(options.sessionId)) {
    throw new ServiceError(409, 'SESSION_MISMATCH', 'The manual judge task belongs to a different Simulation session.');
  }
  const [trustedTask, initial] = await Promise.all([
    loadTrustedTask(options.sessionId, options.taskId),
    loadManualJudgeContext(options.user, options.sessionId),
  ]);
  if (
    trustedTask.sessionUpdatedAt !== initial.session.updatedAt ||
    trustedTask.package.checksum !== initial.manualPackage.checksum ||
    trustedTask.package.taskId !== initial.manualPackage.taskId
  ) {
    throw new ServiceError(409, 'STALE_MANUAL_PACKAGE', 'The Simulation or its judge evidence changed after export. Export a new manual package.');
  }

  return importManualExchange({
    actorRole,
    package: trustedTask.package,
    input: options.input,
    schema: JudgeOutputSchema,
    outputSchemaVersion: MANUAL_JUDGE_SCHEMA_VERSION,
    expectedTaskId: options.taskId,
    expectedTaskType: 'judge',
    externalProvider: options.externalProvider,
    externalModel: options.externalModel,
    importedAt: options.importedAt,
    diffAgainst: initial.session.evaluation,
    validateEvidence: (output) => validateJudgeEvidence(output, initial),
    commit: async ({ output, provenance }): Promise<ManualJudgeCommitResult> => {
      const judged = assembleSimEvaluation({
        judge: output,
        scenario: initial.scenario,
        secret: initial.secret,
        messages: initial.session.messages,
        selectedDisposition: initial.disposition.disposition,
        events: initial.events,
        evaluatedAt: options.evaluatedAt,
        provenance,
      });
      const evaluation = applyDeterministicAssessment({
        evaluation: judged,
        gates: initial.gates,
        eligibility: initial.eligibility,
        disposition: initial.disposition,
      });
      const demoReplay = isReplay(initial, evaluation);
      if (demoReplay || initial.session.versionId === DRAFT_VERSION_ID) {
        await saveSimulationEvaluation({
          sessionId: initial.session.id,
          session: initial.session,
          evaluation,
          selectedDisposition: initial.disposition.disposition,
          expectedSessionUpdatedAt: initial.session.updatedAt,
        });
        return { evaluation, certified: false, demoReplay };
      }

      const currentVersion =
        initial.track.publishedVersionId && initial.track.publishedVersionId !== initial.session.versionId
          ? ((await loadVersion(initial.track.id, initial.track.publishedVersionId)) ?? initial.version)
          : initial.version;
      const { certified } = await recordSimulationEvaluation({
        user: progressUserForSession(initial.session),
        track: initial.track,
        version: currentVersion,
        session: initial.session,
        evaluation,
        scenario: initial.scenario,
        pillars: initial.version.competencyPillars,
        selectedDisposition: initial.disposition.disposition,
        expectedSessionUpdatedAt: initial.session.updatedAt,
      });
      return { evaluation, certified, demoReplay: false };
    },
  });
}
