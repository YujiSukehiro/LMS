/**
 * Server-only Live Call Sim engine: session loading and Rubric Judge evaluation.
 * The Judge (heavy tier) gives per-criterion scores; every number in the SimEvaluation is computed
 * here with the pure rules in ./scoring.
 */
import { adminDb } from '@/lib/firebase/admin';
import { getLLMGateway } from '@/lib/ai/gateway';
import type { LLMGateway } from '@/lib/ai/types';
import {
  JudgeOutputSchema,
  buildJudgeSystemPrompt,
  buildJudgeUserPrompt,
  type JudgeOutput,
} from '@/lib/ai/prompts/sim-judge';
import {
  SimEvaluationSchema,
  SimSessionDocSchema,
  type SimCriterionResult,
  type SimEvaluation,
  type SimMessage,
  type SimSessionDoc,
} from '@/lib/schemas/analytics';
import { DEFAULT_SIM_PASS_THRESHOLD } from '@/lib/schemas/constants';
import type { CompetencyPillar, PublicSimScenario, SecretSimScenarioConfig } from '@/lib/schemas/curriculum';
import type { SessionUser } from '@/lib/schemas/domain';
import { ServiceError } from './errors';
import { applySimScoringRules, computeRawSimScore } from './scoring';

const MAX_FEEDBACK_ITEMS = 4;

/** Daily Simulation start limit per user (env MAX_SIM_SESSIONS_PER_USER_PER_DAY, default 15). */
export function maxSimSessionsPerDay(): number {
  const raw = Number.parseInt(process.env.MAX_SIM_SESSIONS_PER_USER_PER_DAY ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 15;
}

export function simSessionsCollection() {
  return adminDb.collection('simSessions');
}

/**
 * Load `simSessions/{sessionId}` and check that the user owns it.
 * Throws 404 when it does not exist or belongs to a different user (no information leak).
 */
export async function loadOwnedSimSession(user: SessionUser, sessionId: string): Promise<SimSessionDoc> {
  if (!sessionId || sessionId.includes('/')) {
    throw new ServiceError(404, 'SESSION_NOT_FOUND', 'This Simulation session does not exist.');
  }
  const snap = await simSessionsCollection().doc(sessionId).get();
  if (!snap.exists) throw new ServiceError(404, 'SESSION_NOT_FOUND', 'This Simulation session does not exist.');
  const parsed = SimSessionDocSchema.safeParse({ ...snap.data(), id: snap.id });
  if (!parsed.success) {
    console.error(`[simulation-engine] Session ${sessionId} has an invalid shape`, parsed.error.flatten());
    throw new ServiceError(500, 'SESSION_DATA_INVALID', 'This Simulation session data is not valid.');
  }
  if (parsed.data.userId !== user.uid) {
    throw new ServiceError(404, 'SESSION_NOT_FOUND', 'This Simulation session does not exist.');
  }
  return parsed.data;
}

/** Lowercase, unify quotes and dashes, remove punctuation and collapse whitespace for a tolerant verbatim check. */
function normalizeForQuoteMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Return the quote when it occurs in an agent turn (tolerant match), else ''. Removes surrounding quote marks. */
export function verifyAgentQuote(quote: string, agentMessages: SimMessage[]): string {
  const trimmed = quote.trim().replace(/^["'“‘]+|["'”’]+$/g, '').trim();
  if (!trimmed) return '';
  const needle = normalizeForQuoteMatch(trimmed);
  if (!needle) return '';
  const found = agentMessages.some((m) => normalizeForQuoteMatch(m.content).includes(needle));
  return found ? trimmed : '';
}

/** Scale weights so they sum to 100 (the rubric contract), keeping the relative weights. */
function normalizedWeights(weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + (Number.isFinite(w) && w > 0 ? w : 0), 0);
  if (sum <= 0) return weights.map(() => (weights.length > 0 ? 100 / weights.length : 0));
  if (sum === 100) return weights;
  return weights.map((w) => ((Number.isFinite(w) && w > 0 ? w : 0) * 100) / sum);
}

function cleanList(items: string[]): string[] {
  return items
    .map((i) => i.trim())
    .filter(Boolean)
    .slice(0, MAX_FEEDBACK_ITEMS);
}

/**
 * Build the final SimEvaluation from the Judge output (pure; exported for tests).
 * - Every rubric criterion appears exactly once, in rubric order. A criterion the Judge skipped scores 0.
 * - Evidence that is not found verbatim in an agent turn is removed.
 * - Score, disposition penalty, auto-fail cap and pass result come from ./scoring.
 */
export function assembleSimEvaluation(input: {
  judge: JudgeOutput;
  scenario: PublicSimScenario;
  secret: SecretSimScenarioConfig;
  messages: SimMessage[];
  selectedDisposition: string;
  evaluatedAt?: number;
}): SimEvaluation {
  const { judge, scenario, secret, messages, selectedDisposition } = input;
  const agentMessages = messages.filter((m) => m.role === 'agent');

  const judgeById = new Map<string, JudgeOutput['criterionResults'][number]>();
  for (const result of judge.criterionResults) {
    const id = result.criterionId.trim();
    if (!judgeById.has(id)) judgeById.set(id, result);
  }

  const criterionResults: SimCriterionResult[] = secret.rubricCriteria.map((criterion) => {
    const graded = judgeById.get(criterion.id);
    const fallbackExample = `Follow this Playbook rule on the call: ${criterion.evaluationRule}`;
    if (!graded) {
      return {
        criterionId: criterion.id,
        competencyPillarId: criterion.competencyPillarId,
        criterionLabel: criterion.criterionLabel,
        score: 0,
        agentQuoteEvidence: '',
        coachingNote: 'No evidence was found that you met this rule during the call.',
        betterResponseExample: fallbackExample,
      };
    }
    const score: number = graded.score;
    return {
      criterionId: criterion.id,
      competencyPillarId: criterion.competencyPillarId,
      criterionLabel: criterion.criterionLabel,
      score,
      agentQuoteEvidence: verifyAgentQuote(graded.agentQuoteEvidence, agentMessages),
      coachingNote: graded.coachingNote.trim(),
      betterResponseExample: score === 100 ? null : graded.betterResponseExample?.trim() || fallbackExample,
    };
  });

  const weights = normalizedWeights(secret.rubricCriteria.map((c) => c.weight));
  const rawScore = computeRawSimScore(
    criterionResults.map((result, i) => ({ weight: weights[i] ?? 0, score: result.score })),
  );

  const autoFailTriggered = secret.autoFailTriggers.length > 0 && judge.autoFailTriggered;
  const { overallScorePct, passed, dispositionCorrect } = applySimScoringRules({
    rawScore,
    selectedDisposition,
    expectedDisposition: secret.expectedDisposition,
    autoFailTriggered,
    passThreshold: scenario.passScoreThreshold ?? DEFAULT_SIM_PASS_THRESHOLD,
  });

  const coachingImprovements = cleanList(judge.coachingImprovements);
  if (!dispositionCorrect) {
    const note = `Log the disposition "${secret.expectedDisposition}" for this call. You selected "${selectedDisposition}".`;
    coachingImprovements.unshift(note);
    if (coachingImprovements.length > MAX_FEEDBACK_ITEMS) coachingImprovements.length = MAX_FEEDBACK_ITEMS;
  }

  return SimEvaluationSchema.parse({
    overallScorePct,
    passed,
    autoFailedReason: autoFailTriggered
      ? judge.autoFailedReason?.trim() || 'The call broke a Playbook rule that causes an automatic fail.'
      : null,
    dispositionCorrect,
    summaryFeedback: judge.summaryFeedback.trim(),
    strengthsHighlighted: cleanList(judge.strengthsHighlighted),
    coachingImprovements,
    criterionResults,
    evaluatedAt: input.evaluatedAt ?? Date.now(),
  });
}

/** Run the heavy-tier Rubric Judge on a finished Simulation and return the scored SimEvaluation. */
export async function evaluateSimulation(input: {
  scenario: PublicSimScenario;
  secret: SecretSimScenarioConfig;
  messages: SimMessage[];
  selectedDisposition: string;
  pillars: CompetencyPillar[];
  gateway?: LLMGateway;
}): Promise<SimEvaluation> {
  const gateway = input.gateway ?? getLLMGateway();
  const judge = await gateway.generateStructured({
    tier: 'heavy',
    systemPrompt: buildJudgeSystemPrompt(),
    userPrompt: buildJudgeUserPrompt({
      scenario: input.scenario,
      secret: input.secret,
      messages: input.messages,
      selectedDisposition: input.selectedDisposition,
      pillars: input.pillars,
    }),
    schema: JudgeOutputSchema,
    schemaName: 'SimJudgeOutput',
    temperature: 0.1,
  });
  return assembleSimEvaluation({
    judge,
    scenario: input.scenario,
    secret: input.secret,
    messages: input.messages,
    selectedDisposition: input.selectedDisposition,
  });
}
