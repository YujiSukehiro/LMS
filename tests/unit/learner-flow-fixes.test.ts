import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';

vi.mock('@/lib/services/simulation-engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/simulation-engine')>()),
  simSessionsCollection: vi.fn(),
}));

import { shouldCheckAiHealth } from '@/components/layout/ai-runtime';
import { simStartLabel, wrapUpControlsOpenByDefault } from '@/components/simulation/labels';
import { checkpointScoreLine, summarizeDrillRound } from '@/components/learn/round-score';
import { trackBuildFailed, trackDisplayStatus, trackStatusCounts } from '@/components/studio/track-display-status';
import { JudgeOutputSchema, buildJudgeOutputSchema, isProhibitionCriterion } from '@/lib/ai/prompts/sim-judge';
import { parseStructuredOutput } from '@/lib/ai/pipeline/structured-output';
import { isResumableSession } from '@/lib/services/sim-resume';
import { evaluationForViewer, sessionForViewer } from '@/lib/services/learner-views';
import { isSimAiUnavailable, toSimAiUnavailable } from '@/lib/services/sim-ai-availability';
import { OpenAICompatibleProvider } from '@/lib/ai/openai-compatible-provider';
import { learningBlueprint, learningEnrollment, scenarioSession } from './helpers/learning-service-fixtures';
import { buildLearningAnalytics } from '@/lib/services/learning-analytics';
import { createInitialScenarioState, evaluateDeterministicGates } from '@/lib/services/scenario-state';
import { generatedScenarioRuntime } from '@/lib/ai/prompts/sim-builder';
import { PublicSimScenarioSchema } from '@/lib/schemas/curriculum';
import { assembleSimEvaluation } from '@/lib/services/simulation-engine';

describe('seeded demo Track', () => {
  it('passes the publish gates (with scripted Sim QA) and seeds learning evidence every surface agrees on', () => {
    // The dry run validates every seeded document and throws when the published Track fails the gates
    // (missing scenario context, non-canonical dispositions, ungrounded rubrics or failing QA fixtures).
    const root = path.resolve(__dirname, '../..');
    const output = execFileSync(path.join(root, 'node_modules/.bin/tsx'), ['scripts/seed-demo.ts', '--dry-run'], {
      cwd: root,
      encoding: 'utf8',
      // No emulator or credentials: the dry run never initializes Firebase.
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', NODE_ENV: 'test' },
      timeout: 60_000,
    });
    expect(output).toContain('both publication-gate fixtures behaved as expected');
  }, 60_000);
});

describe('AI runtime pill', () => {
  it('polls the internal-ops health route only for internal-ops roles', () => {
    expect(shouldCheckAiHealth('openai_compatible', 'TRAINER')).toBe(true);
    expect(shouldCheckAiHealth('openai_compatible', 'SUPER_ADMIN')).toBe(true);
    expect(shouldCheckAiHealth('openai_compatible', 'AGENT')).toBe(false);
    expect(shouldCheckAiHealth('ollama', undefined)).toBe(false);
    expect(shouldCheckAiHealth('replay', 'ADMIN')).toBe(false);
  });
});

describe('Sim resume after reload', () => {
  const live = scenarioSession({ status: 'ACTIVE' });

  it('treats only the learner\'s own active run on the same version as resumable', () => {
    expect(isResumableSession(live, live.userId, live.versionId)).toBe(true);
    expect(isResumableSession(live, 'someone-else', live.versionId)).toBe(false);
    expect(isResumableSession(live, live.userId, 'v-other')).toBe(false);
    expect(isResumableSession({ ...live, status: 'EVALUATED' }, live.userId, live.versionId)).toBe(false);
    expect(isResumableSession({ ...live, scenarioState: undefined }, live.userId, live.versionId)).toBe(false);
  });

  it('labels the intro button as a resume when a saved run exists', () => {
    expect(simStartLabel(null)).toBe('Start Live Call Sim');
    expect(simStartLabel(0)).toBe('Resume call');
    expect(simStartLabel(1)).toBe('Resume call (1 reply saved)');
    expect(simStartLabel(3)).toBe('Resume call (3 replies saved)');
  });
});

describe('Sim Judge output root', () => {
  const criterion = { criterionId: 'c1', score: 100, agentQuoteEvidence: 'q', coachingNote: 'n', betterResponseExample: null };
  const full = { criterionResults: [criterion], autoFailTriggered: false, autoFailedReason: null, summaryFeedback: 's', strengthsHighlighted: [], coachingImprovements: [] };

  it('accepts the whole object wrapped in an array', () => {
    const parsed = buildJudgeOutputSchema([{ id: 'c1' }]).safeParse([full]);
    expect(parsed.success).toBe(true);
  });

  it('lifts a bare array of criterion results into criterionResults with lenient defaults', () => {
    const parsed = JudgeOutputSchema.safeParse([criterion]);
    expect(parsed.success && parsed.data.criterionResults[0].criterionId).toBe('c1');
    expect(parsed.success && parsed.data.autoFailTriggered).toBe(false);
  });

  it('still rejects arrays that are not judge output, and keeps the JSON schema an object', () => {
    expect(JudgeOutputSchema.safeParse([{ foo: 1 }, { bar: 2 }]).success).toBe(false);
    expect(JudgeOutputSchema.safeParse(['x']).success).toBe(false);
    const json = zodToJsonSchema(JudgeOutputSchema, { target: 'jsonSchema7', $refStrategy: 'none' }) as { type?: string };
    expect(json.type).toBe('object');
  });
});

describe('Sim with the local AI runtime stopped', () => {
  it('maps a real refused connection from the OpenAI-compatible provider to the learner-facing 503', async () => {
    // Port 9 (discard) is closed on dev machines: this exercises the real fetch path, not a mock.
    const provider = new OpenAICompatibleProvider({ baseUrl: 'http://127.0.0.1:9', heavyModel: 'h', fastModel: 'f' });
    const caught = await (async () => {
      const chunks: string[] = [];
      for await (const chunk of provider.streamChat({ tier: 'fast', messages: [{ role: 'user', content: 'hi' }] })) chunks.push(chunk);
      return null;
    })().catch((error: unknown) => error);
    expect(caught).toBeTruthy();
    expect(isSimAiUnavailable(caught)).toBe(true);
    const mapped = toSimAiUnavailable(caught);
    expect(mapped?.status).toBe(503);
    expect(mapped?.code).toBe('AI_UNAVAILABLE');
    expect(mapped?.message).not.toMatch(/ECONNREFUSED|127\.0\.0\.1/);
  }, 20_000);
});

describe('Track status shown to Trainers', () => {
  const progress = (step: 'FAILED' | 'BUILDING_UNITS' | 'READY') => ({ step, percent: 30, message: 'x' });

  it('shows a failed first build as Build failed, not as a spinning Generating', () => {
    expect(trackDisplayStatus({ status: 'GENERATING', generationProgress: progress('FAILED') })).toBe('BUILD_FAILED');
    expect(trackDisplayStatus({ status: 'GENERATING', generationProgress: progress('BUILDING_UNITS') })).toBe('GENERATING');
    // A failed revision build keeps the live published status; trackBuildFailed flags the retry.
    expect(trackDisplayStatus({ status: 'PUBLISHED', generationProgress: progress('FAILED') })).toBe('PUBLISHED');
    expect(trackBuildFailed({ generationProgress: progress('FAILED') })).toBe(true);
  });

  it('counts failed builds separately from running ones', () => {
    const counts = trackStatusCounts([
      { status: 'GENERATING', generationProgress: progress('FAILED') },
      { status: 'GENERATING', generationProgress: progress('BUILDING_UNITS') },
      { status: 'PUBLISHED', generationProgress: progress('READY') },
    ]);
    expect(counts).toMatchObject({ GENERATING: 1, BUILD_FAILED: 1, PUBLISHED: 1 });
  });
});

describe('Learning evidence certification status', () => {
  it('reports in_progress (not not_started) once the learner has completed Units', () => {
    const blueprint = learningBlueprint();
    const enrollment = learningEnrollment({ completedUnitIds: [blueprint.requiredUnitIds[0]], certifiedAt: null });
    const base = { learnerId: enrollment.userId, blueprint, drillAttempts: [], scenarioCoverage: [], simSessions: [], reviewSchedules: [], ruleIdsByDrillId: {}, now: '2026-11-02T12:00:00.000Z' };
    expect(buildLearningAnalytics({ ...base, enrollment }).certificationStatus).toBe('in_progress');
    expect(buildLearningAnalytics({ ...base, enrollment: null }).certificationStatus).toBe('not_started');
    expect(buildLearningAnalytics({ ...base, enrollment, certificationStatus: 'revoked' }).certificationStatus).toBe('revoked');
  });
});

describe('Sim Judge output observed on MLX (Qwen2.5-7B)', () => {
  // Verbatim answer from a live run: the top-level fields became the last criterionResults item and the
  // outer object was never closed, so JSON extraction returned only the array.
  const OBSERVED_RAW = "{\"criterionResults\":[{\"criterionId\":\"crit_se_route\",\"score\":100,\"agentQuoteEvidence\":\"Thank you for telling me. I can't give medical advice, so I'm going to have our Clinical Support Tier 2 medical team call you back within 4 hours. Can I confirm your callback number and when the headaches started?\",\"evidenceEventIds\":[\"f9b66521-f073-42f6-b26f-ea6f89cf6054\"],\"coachingNote\":\"The agent correctly arranged a warm transfer to Clinical Support Tier 2.\",\"betterResponseExample\":null},{\"criterionId\":\"crit_se_no_advice\",\"score\":100,\"agentQuoteEvidence\":\"Thank you for telling me. I can't give medical advice, so I'm going to have our Clinical Support Tier 2 medical team call you back within 4 hours. Can I confirm your callback number and when the headaches started?\",\"evidenceEventIds\":[\"f9b66521-f073-42f6-b26f-ea6f89cf6054\"],\"coachingNote\":\"The agent did not give medical advice and checked for emergency symptoms.\",\"betterResponseExample\":null},{\"criterionId\":\"crit_se_refund_rule\",\"score\":50,\"agentQuoteEvidence\":\"On the charge: your latest charge was 9 days ago, so it is inside the 14-day window and qualifies for a full refund review. Clinical Tier 2 will handle that review with you on the callback.\",\"evidenceEventIds\":[\"3db59cd2-6541-40ec-8214-83d3f197e8c1\"],\"coachingNote\":\"The agent partly followed the rule by checking the charge date but did not explain the exact refund review process.\",\"betterResponseExample\":\"I can review the charge and explain the full refund process in detail.\",\"evidenceEventIds\":[]},{\"criterionId\":\"crit_se_ticket\",\"score\":100,\"agentQuoteEvidence\":\"Can I confirm your callback number and when the headaches started?\",\"evidenceEventIds\":[\"9fe9e892-6b12-4078-8f68-90aa388949ef\"],\"coachingNote\":\"The agent collected the required ticket facts and stated the 4-hour callback window.\",\"betterResponseExample\":null,\"evidenceEventIds\":[]},{\"autoFailTriggered\":false,\"autoFailedReason\":null,\"summaryFeedback\":\"The agent did well in routing to Clinical Tier 2 and checking for emergency symptoms. The refund rule explanation could be clearer. The agent collected all ticket facts and scheduled a callback within the 4-hour window.\",\"strengthsHighlighted\":[\"Correctly routed to Clinical Tier 2\",\"Collected all required ticket facts\"],\"coachingImprovements\":[\"Clarify the refund review process\",\"Follow up on the callback to ensure it happens within the 4-hour window\"]}]";
  const rubric = ['crit_se_route', 'crit_se_no_advice', 'crit_se_refund_rule', 'crit_se_ticket'].map((id) => ({ id }));

  it('rebuilds one Judge object with every criterion and the misplaced top-level fields', () => {
    const parsed = parseStructuredOutput(OBSERVED_RAW, buildJudgeOutputSchema(rubric));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.criterionResults.map((c) => c.criterionId)).toEqual(rubric.map((c) => c.id));
    expect(parsed.data.autoFailTriggered).toBe(false);
    expect(parsed.data.summaryFeedback).toMatch(/Clinical Tier 2/);
    expect(parsed.data.strengthsHighlighted.length).toBeGreaterThan(0);
  });

  it('lifts misplaced fields out of criterionResults when the object did close, and handles nested arrays', () => {
    const criterion = { criterionId: 'crit_se_route', score: 100 };
    const misplaced = { summaryFeedback: 'Good call.', autoFailTriggered: false, strengthsHighlighted: ['a'], coachingImprovements: ['b'] };
    const closed = buildJudgeOutputSchema([{ id: 'crit_se_route' }]).safeParse({ criterionResults: [criterion, misplaced] });
    expect(closed.success && closed.data.summaryFeedback).toBe('Good call.');
    const nested = JudgeOutputSchema.safeParse([[criterion], [misplaced]]);
    expect(nested.success && nested.data.criterionResults).toHaveLength(1);
    // Root fields win over misplaced copies.
    const both = JudgeOutputSchema.safeParse({ criterionResults: [criterion, misplaced], summaryFeedback: 'Root wins.', autoFailTriggered: false, strengthsHighlighted: [], coachingImprovements: [] });
    expect(both.success && both.data.summaryFeedback).toBe('Root wins.');
    // Unknown items are not guessed at.
    expect(JudgeOutputSchema.safeParse({ criterionResults: [criterion, { foo: 1 }], autoFailTriggered: false, strengthsHighlighted: [], coachingImprovements: [] }).success).toBe(false);
  });
});

describe('Checkpoint completion score on Practice Again', () => {
  const firstTry = { firstTryCorrect: 0, total: 5, accuracyPct: 0 };

  it('shows this round instead of a 0% first-try score when the Drills were answered before', () => {
    const round = summarizeDrillRound({
      0: { correct: true, firstIndependent: false },
      1: { correct: false, firstIndependent: false },
      2: { correct: true, firstIndependent: false },
      3: { correct: true, firstIndependent: false },
      4: { correct: true, firstIndependent: false },
    }, 5);
    expect(round).toEqual({ correct: 4, total: 5, replay: true });
    expect(checkpointScoreLine(firstTry, round)).toEqual({ label: 'This Round', pct: 80, detail: '4/5 correct this round' });
  });

  it('keeps first-try accuracy on a first sitting', () => {
    const round = summarizeDrillRound({ 0: { correct: true, firstIndependent: true }, 1: { correct: false, firstIndependent: true } }, 2);
    expect(round.replay).toBe(false);
    expect(checkpointScoreLine({ firstTryCorrect: 1, total: 2, accuracyPct: 50 }, round)).toEqual({ label: 'First-Try Accuracy', pct: 50, detail: '1/2 first try' });
    expect(checkpointScoreLine({ firstTryCorrect: 1, total: 2, accuracyPct: 50 })).toMatchObject({ label: 'First-Try Accuracy' });
  });
});

describe('Safe Wrap-Up Controls default state', () => {
  const requirements = (requiredWrapUpEvidence: string[]) => ({ requiredWrapUpEvidence });

  it('opens when a selectable disposition needs a wrap-up action, even with no wrap-up evidence required', () => {
    // Generated Sim with expected "Callback scheduled" and requiredWrapUpEvidence [] (Track ZrPUNY... s2).
    expect(wrapUpControlsOpenByDefault({ dispositionOptions: ['Recovered', 'Callback scheduled', "Didn't reply"], evidenceRequirements: requirements([]) })).toBe(true);
    expect(wrapUpControlsOpenByDefault({ dispositionOptions: ['Recovered', 'Not interested'], evidenceRequirements: requirements([]) })).toBe(true);
  });

  it('opens when the checklist requires wrap-up evidence, and stays collapsed otherwise', () => {
    expect(wrapUpControlsOpenByDefault({ dispositionOptions: ['Recovered', 'Organic', "Didn't reply"], evidenceRequirements: requirements(['note']) })).toBe(true);
    expect(wrapUpControlsOpenByDefault({ dispositionOptions: ['Recovered', 'Organic', "Didn't reply"], evidenceRequirements: requirements([]) })).toBe(false);
  });
});

describe('learner-facing Simulation views', () => {
  const gate = { ruleId: 'opt_out', sourceRefs: [], severity: 'critical' as const, status: 'fail' as const, evidenceEventIds: ['e1'], learnerFeedback: 'Honor the opt-out.', trainerDetail: '2 utterances after opt-out.' };
  const withGates = scenarioSession({
    gateResults: [gate],
    evaluation: { ...scenarioSession().evaluation!, gateResults: [gate] },
  });

  it('removes trainerDetail from session and evaluation gates for learners and supervisors', () => {
    for (const role of ['AGENT', 'PARTNER_SUPERVISOR'] as const) {
      const view = sessionForViewer(withGates, { role });
      expect(JSON.stringify(view)).not.toContain('trainerDetail');
      expect(view.gateResults?.[0]).toMatchObject({ ruleId: 'opt_out', learnerFeedback: 'Honor the opt-out.' });
      expect(JSON.stringify(evaluationForViewer(withGates.evaluation!, { role }))).not.toContain('2 utterances after opt-out.');
    }
    // The stored record is not mutated.
    expect(withGates.gateResults?.[0]?.trainerDetail).toBe('2 utterances after opt-out.');
  });

  it('keeps trainerDetail for internal ops', () => {
    for (const role of ['TRAINER', 'ADMIN', 'SUPER_ADMIN'] as const) {
      expect(sessionForViewer(withGates, { role }).gateResults?.[0]?.trainerDetail).toBe('2 utterances after opt-out.');
    }
  });
});

describe('Judge prohibition criteria', () => {
  it.each([
    ['Never promise a discount', 'Never promise a discount or a free month.', true],
    ['No medical advice', 'No medical advice or product instructions.', true],
    ['Did not invent offers', 'The agent does not offer a discount, free month, or gift that is not on the ladder.', true],
    // Seeded rubric: a prohibition plus a required action, so a missing action can still lose points.
    ['Gave no medical advice and checked for emergency symptoms', 'No medical advice or product instructions. The agent checks for chest pain, trouble breathing, or fainting (pages 8 and 10).', false],
    ['No invented offers', 'Never invent an offer (page 5). Do not promise a refund amount.', true],
    ['Verified 3 identity points', 'Full name, date of birth, and ZIP code are verified before any plan, price, or billing detail is discussed (page 2).', false],
    ['Gave no medical advice and checked for emergency symptoms', 'Gave no medical advice and checked for chest pain.', false],
    ['Stated exact ladder terms only', 'Every offer matches the ladder terms exactly. No invented offers (page 5).', false],
  ])('%s -> prohibition=%s', (criterionLabel, evaluationRule, expected) => {
    expect(isProhibitionCriterion({ criterionLabel, evaluationRule })).toBe(expected);
  });
});

describe('assembleSimEvaluation: unsupported prohibition deductions', () => {
  const secret = {
    scenarioId: 's1', personaName: 'P', personaBackstoryAndMood: 'm', hiddenFactsToRevealOnlyWhenAsked: [], conditionalBehaviors: [],
    expectedDisposition: 'Recovered', autoFailTriggers: [],
    rubricCriteria: [
      { id: 'c-never', competencyPillarId: 'p1', criterionLabel: 'Never promise a discount', evaluationRule: 'Never promise a discount.', weight: 50, sourcePages: [1] },
      { id: 'c-verify', competencyPillarId: 'p1', criterionLabel: 'Verified identity', evaluationRule: 'Verify name and date of birth before account talk.', weight: 50, sourcePages: [1] },
    ],
  };
  const scenario = { id: 's1', title: 'T', difficulty: 'STANDARD', counterpartyRoleLabel: 'Lead', contextTicketSummary: 't', openingMessage: 'Hi', dispositionOptions: ['Recovered', 'Lost', 'Organic'], maxTurns: 8, passScoreThreshold: 80 } as const;
  const messages = [
    { id: 'm1', role: 'counterparty' as const, content: 'Hi', createdAt: 1 },
    { id: 'm2', role: 'agent' as const, content: 'I can give you 50% off if you stay today.', createdAt: 2 },
  ];
  const judge = (score: 0 | 50 | 100, quote: string) => ({
    criterionResults: [
      { criterionId: 'c-never', score, agentQuoteEvidence: quote, coachingNote: 'n', betterResponseExample: null },
      { criterionId: 'c-verify', score: 50 as const, agentQuoteEvidence: '', coachingNote: 'n', betterResponseExample: null },
    ],
    autoFailTriggered: false, autoFailedReason: null, summaryFeedback: 's', strengthsHighlighted: [], coachingImprovements: [],
  });
  const run = (score: 0 | 50 | 100, quote: string) => assembleSimEvaluation({ judge: judge(score, quote), scenario, secret, messages, selectedDisposition: 'Recovered' } as never);

  it('scores a prohibition 100 when the judge deducted without quoting an agent turn', () => {
    const result = run(50, '');
    expect(result.criterionResults[0]).toMatchObject({ criterionId: 'c-never', score: 100, betterResponseExample: null });
    // Non-prohibition criteria keep the judge's score.
    expect(result.criterionResults[1]!.score).toBe(50);
  });

  it('keeps the deduction when the judge quotes the agent turn that breaks the rule', () => {
    expect(run(0, 'I can give you 50% off if you stay today.').criterionResults[0]!.score).toBe(0);
  });

  it('keeps a deduction backed by a paraphrased quote of the agent turn (7B rarely copies verbatim)', () => {
    const result = run(0, 'I can give you fifty percent off if you stay today').criterionResults[0]!;
    expect(result.score).toBe(0);
    expect(result.needsTrainerReview).toBeUndefined();
  });

  it('keeps a deduction whose event evidence points at an agent turn, even without a quote', () => {
    const events = [{ id: 'm2', actor: 'learner', type: 'utterance' }] as never;
    const result = assembleSimEvaluation({
      judge: { ...judge(0, ''), criterionResults: [{ ...judge(0, '').criterionResults[0]!, evidenceEventIds: ['m2'] }, judge(0, '').criterionResults[1]!] },
      scenario, secret, messages, selectedDisposition: 'Recovered', events,
    } as never);
    expect(result.criterionResults[0]!.score).toBe(0);
  });

  it('flags an unmatched quote for trainer review instead of raising the score to 100', () => {
    const result = run(0, 'I promise you a free month.').criterionResults[0]!;
    expect(result.score).toBe(0);
    expect(result.needsTrainerReview).toBe(true);
    expect(result.coachingNote).toMatch(/A Trainer will review this rule/);
  });
});

describe('opt_out gate for sessions recorded before intents', () => {
  const runtime = generatedScenarioRuntime({ expectedDisposition: 'Not interested', defaults: { divisionId: 'OUTBOUND', product: 'P', sourceRevision: 'r' } });
  const scenario = PublicSimScenarioSchema.parse({
    id: 's1', title: 'T', difficulty: 'STANDARD', counterpartyRoleLabel: 'Lead', contextTicketSummary: 't', openingMessage: 'Hi',
    dispositionOptions: ['Recovered', 'Not interested', 'Lost'], maxTurns: 8, passScoreThreshold: 80, ...runtime,
  });
  const ev = (sequence: number, type: string, actor: string, payload: Record<string, unknown>) => ({ id: `e${sequence}`, sequence, type, actor, payload, provenance: 'learner' });
  const gate = (events: unknown[], optOut = true) =>
    evaluateDeterministicGates(scenario, { ...createInitialScenarioState(scenario), lifecycle: 'in_call', optOut }, events as never).find((g) => g.ruleId === 'opt_out');

  it('fails an offer made after a legacy (intent-less) caller opt-out', () => {
    const legacy = [ev(1, 'utterance', 'customer', { content: 'Please stop calling me.' }), ev(2, 'offer', 'learner', { assetId: 'a' })];
    expect(gate(legacy)?.status).toBe('fail');
  });

  it('still uses the recorded intent when present, and never learner text', () => {
    expect(gate([ev(1, 'utterance', 'customer', { content: 'x', intent: 'opt_out' }), ev(2, 'offer', 'learner', { assetId: 'a' })])?.status).toBe('fail');
    expect(gate([ev(1, 'utterance', 'learner', { content: 'Should I stop calling you?' }), ev(2, 'offer', 'learner', { assetId: 'a' })], false)).toBeUndefined();
  });
});
