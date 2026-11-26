/**
 * Server-only Live Call Sim engine: session loading and Rubric Judge evaluation.
 * The Judge (heavy tier) gives per-criterion scores; every number in the SimEvaluation is computed
 * here with the pure rules in ./scoring.
 */
import { createHash } from 'node:crypto';
import { isEchoOf, quotedFragments } from '@/lib/services/feedback-text';
import { scanSensitiveData } from '@/lib/security/synthetic-data';
import { adminDb } from '@/lib/firebase/admin';
import { getActiveAiRuntime, getLLMGateway } from '@/lib/ai/gateway';
import { createProvenance, type ProvenanceRecord } from '@/lib/ai/provenance';
import { LLMStructuredOutputError, type LLMGateway } from '@/lib/ai/types';
import { parseStructuredOutput } from '@/lib/ai/pipeline/structured-output';
import {
  JudgeOutputSchema,
  isProhibitionCriterion,
  buildJudgeOutputSchema,
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
import { startOfUtcDay } from './route-helpers';
import { dailyWindowStart, summarizeDailySimUsage, type DailySimUsage } from './sim-session-limits';
import type { CompetencyPillar, PublicSimScenario, SecretSimScenarioConfig } from '@/lib/schemas/curriculum';
import type { SessionUser } from '@/lib/schemas/domain';
import type { SimulationEvent } from '@/lib/schemas/simulation-state';
import { ServiceError } from './errors';
import { applySimScoringRules, computeRawSimScore } from './scoring';

const MAX_FEEDBACK_ITEMS = 4;
const SIMULATION_PROMPT_VERSION = '1';
/** Explicit output budget for the Judge JSON (coaching notes are capped at ~25 words each). */
export const JUDGE_MAX_OUTPUT_TOKENS = 3000;
/**
 * Overall Judge deadline, kept inside the evaluate route's maxDuration (300 s) so a slow local
 * model (including its repair retries) ends in the manual-judge fallback instead of a platform timeout.
 */
export const JUDGE_DEADLINE_MS = 240_000;

export type SimulationProvenanceTask = 'session' | 'actor' | 'judge';

function hashProvenanceInput(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

/** Provider-neutral evidence metadata for sessions, generated actor turns, and judge results. */
export function createSimulationProvenance(input: {
  task: SimulationProvenanceTask;
  systemPrompt?: string;
  userPrompt?: string;
  messages?: SimMessage[];
  recordedAt?: string;
}): ProvenanceRecord {
  const runtime = getActiveAiRuntime();
  const source =
    runtime.provider === 'replay'
      ? 'replay'
      : runtime.provider === 'manual_chat'
        ? 'manual_chat'
        : runtime.provider === 'gemini'
          ? 'hosted_ai'
          : 'local_ai';
  const protocol =
    runtime.provider === 'openai_compatible'
      ? 'openai_compatible_http'
      : runtime.provider === 'ollama'
        ? 'ollama_http'
        : runtime.provider;

  return createProvenance({
    source,
    provider: runtime.provider,
    model: input.task === 'judge' ? runtime.heavyModel : runtime.fastModel,
    prompt:
      input.task === 'session'
        ? null
        : {
            templateId: `simulation.${input.task}`,
            templateVersion: SIMULATION_PROMPT_VERSION,
            inputHash: hashProvenanceInput({
              systemPrompt: input.systemPrompt ?? '',
              userPrompt: input.userPrompt ?? '',
              messages: input.messages?.map(({ role, content }) => ({ role, content })) ?? [],
            }),
          },
    schema:
      input.task === 'judge'
        ? { name: 'SimJudgeOutput', version: SIMULATION_PROMPT_VERSION }
        : input.task === 'actor'
          ? { name: 'SimActorText', version: SIMULATION_PROMPT_VERSION }
          : null,
    runtime: { label: runtime.runtimeLabel ?? runtime.provider, protocol },
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  });
}

/** Map a runtime provenance source onto the append-only event provenance label (actual provider, not a guess). */
export function simulationEventProvenanceFor(
  source: ProvenanceRecord['source'] | undefined,
): 'local_ai' | 'hosted_ai' | 'manual_chat' | 'replay' {
  if (source === 'replay') return 'replay';
  if (source === 'manual_chat') return 'manual_chat';
  if (source === 'hosted_ai') return 'hosted_ai';
  return 'local_ai';
}

/** Daily Simulation start limit per user (env MAX_SIM_SESSIONS_PER_USER_PER_DAY, default 15). */
export function maxSimSessionsPerDay(): number {
  const raw = Number.parseInt(process.env.MAX_SIM_SESSIONS_PER_USER_PER_DAY ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 15;
}

export function simSessionsCollection() {
  return adminDb.collection('simSessions');
}

/** Staff resets of a learner's daily practice count: one doc per learner (`simLimitResets/{uid}`), server only. */
export function simLimitResetsCollection() {
  return adminDb.collection('simLimitResets');
}

/**
 * The learner's practice usage today (UTC day, or since a staff reset made today): runs that count toward the
 * daily limit (2+ replies) and runs that used the AI caller at all (cost guard).
 * Uses the existing (partnerCohortId ASC, startedAt DESC) composite index and filters by user in memory.
 */
export async function dailySimUsage(uid: string, partnerCohortId: string, nowMs: number): Promise<DailySimUsage> {
  const resetSnap = await simLimitResetsCollection().doc(uid).get();
  const rawReset = resetSnap.exists ? resetSnap.get('resetAt') : null;
  const resetAt = typeof rawReset === 'number' && rawReset >= startOfUtcDay(nowMs) ? rawReset : null;
  const windowStart = dailyWindowStart(nowMs, resetAt);
  const snap = await simSessionsCollection()
    .where('partnerCohortId', '==', partnerCohortId)
    .where('startedAt', '>=', windowStart)
    .orderBy('startedAt', 'desc')
    .select('userId', 'status', 'turnCount', 'startedAt')
    .get();
  return summarizeDailySimUsage(
    snap.docs.map((d) => ({ userId: d.get('userId'), status: d.get('status'), turnCount: d.get('turnCount'), startedAt: d.get('startedAt') })),
    uid,
    windowStart,
    resetAt,
  );
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

const STOP_WORDS = new Set(['the', 'and', 'you', 'your', 'that', 'this', 'with', 'for', 'are', 'was', 'have', 'will', 'can', 'just', 'our', 'about', 'what', 'from', 'they', 'them', 'then', 'there']);

function contentWords(text: string): string[] {
  return normalizeForQuoteMatch(text).split(' ').filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/**
 * How well a (possibly paraphrased) Judge quote is supported by one agent turn: 1 for a verbatim match,
 * otherwise the best share of the quote's content words found in a single agent turn (0..1).
 */
export function agentQuoteSupport(quote: string, agentMessages: SimMessage[]): number {
  if (verifyAgentQuote(quote, agentMessages)) return 1;
  const words = [...new Set(contentWords(quote))];
  if (words.length === 0) return 0;
  return agentMessages.reduce((best, message) => {
    const turn = new Set(contentWords(message.content));
    return Math.max(best, words.filter((word) => turn.has(word)).length / words.length);
  }, 0);
}

/** A paraphrased quote that shares this much of an agent turn's wording counts as pointing at that turn. */
export const QUOTE_SUPPORT_THRESHOLD = 0.6;

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
 * Strengths must point at something the agent really said (QA M6: "noted the pause in Atlas" when Atlas never came
 * up). Keep a strength only when it quotes 3+ words found in an agent turn. When none survive, credit the met
 * rubric criteria that have a verified quote instead. Pure; exported for tests.
 */
export function groundedStrengths(
  strengths: string[],
  agentMessages: SimMessage[],
  criterionResults: ReadonlyArray<Pick<SimCriterionResult, 'score' | 'criterionLabel' | 'agentQuoteEvidence'>>,
): string[] {
  const kept = cleanList(strengths).filter(
    (item) => scanSensitiveData(item).length === 0 && quotedFragments(item).some((fragment) => verifyAgentQuote(fragment, agentMessages)),
  );
  if (kept.length > 0) return kept;
  return criterionResults
    // Never echo sensitive data a learner typed (card or ID numbers) into a strength line.
    .filter((result) => Number(result.score) >= 100 && result.agentQuoteEvidence && scanSensitiveData(result.agentQuoteEvidence).length === 0)
    .slice(0, 2)
    .map((result) => `${result.criterionLabel}: "${result.agentQuoteEvidence}"`);
}

function normalizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function fallbackCoachingNote(score: number, label: string): string {
  if (score === 100) return `You followed this rule: ${label}.`;
  if (score === 50) return `You partly followed this rule: ${label}. Make it complete and clear next time.`;
  return `You did not show this rule on the call: ${label}.`;
}

type JudgeCriterion = JudgeOutput['criterionResults'][number];

/**
 * Pair each rubric criterion (by index) with at most one Judge result (pure; exported for tests).
 * Order of preference: exact id -> normalized id (case/punctuation) -> label written as the id ->
 * same position when the Judge returned exactly one result per criterion. A result is used once;
 * duplicates of an id keep the first occurrence. Unmatched criteria are left undefined (score 0).
 */
export function matchJudgeResults(
  results: JudgeCriterion[],
  rubric: ReadonlyArray<{ id: string; criterionLabel: string }>,
): Array<JudgeCriterion | undefined> {
  const matched: Array<JudgeCriterion | undefined> = rubric.map(() => undefined);
  const used = new Set<number>();
  const claim = (criterionIndex: number, predicate: (result: JudgeCriterion) => boolean) => {
    if (matched[criterionIndex]) return;
    const resultIndex = results.findIndex((result, index) => !used.has(index) && predicate(result));
    if (resultIndex === -1) return;
    used.add(resultIndex);
    matched[criterionIndex] = results[resultIndex];
  };
  rubric.forEach((criterion, i) => claim(i, (result) => result.criterionId.trim() === criterion.id));
  rubric.forEach((criterion, i) => claim(i, (result) => normalizeId(result.criterionId) === normalizeId(criterion.id)));
  rubric.forEach((criterion, i) =>
    claim(i, (result) => normalizeId(criterion.criterionLabel) !== '' && normalizeId(result.criterionId) === normalizeId(criterion.criterionLabel)),
  );
  // Positional fallback only for results whose id names no rubric criterion (e.g. "criterion_1" or a typo)
  // and only when the Judge returned one result per criterion, so a duplicate can never fill a gap.
  const rubricIds = new Set(rubric.map((criterion) => normalizeId(criterion.id)));
  if (results.length === rubric.length) {
    rubric.forEach((_, i) => {
      if (matched[i] || used.has(i)) return;
      const candidate = results[i];
      if (candidate && !rubricIds.has(normalizeId(candidate.criterionId))) {
        used.add(i);
        matched[i] = candidate;
      }
    });
  }
  return matched;
}

/**
 * Build the final SimEvaluation from the Judge output (pure; exported for tests).
 * - Every rubric criterion appears exactly once, in rubric order. Judge results are matched by id, then
 *   label/position (matchJudgeResults); a criterion the Judge truly skipped scores 0.
 * - Evidence that is not found verbatim in an agent turn is removed.
 * - Score, disposition penalty, auto-fail cap and pass result come from ./scoring.
 */
export function assembleSimEvaluation(input: {
  judge: JudgeOutput;
  scenario: PublicSimScenario;
  secret: SecretSimScenarioConfig;
  messages: SimMessage[];
  selectedDisposition: string;
  events?: SimulationEvent[];
  evaluatedAt?: number;
  provenance?: ProvenanceRecord;
}): SimEvaluation {
  const { judge, scenario, secret, messages, selectedDisposition } = input;
  const agentMessages = messages.filter((m) => m.role === 'agent');
  const validEventIds = new Set((input.events ?? []).map((event) => event.id));
  const agentEventIds = new Set((input.events ?? []).filter((event) => event.actor === 'learner').map((event) => event.id));

  const graded = matchJudgeResults(judge.criterionResults, secret.rubricCriteria);

  const criterionResults: SimCriterionResult[] = secret.rubricCriteria.map((criterion, index) => {
    const result = graded[index];
    const fallbackExample = `Follow this Playbook rule on the call: ${criterion.evaluationRule}`;
    if (!result) {
      return {
        criterionId: criterion.id,
        competencyPillarId: criterion.competencyPillarId,
        criterionLabel: criterion.criterionLabel,
        score: 0,
        agentQuoteEvidence: '',
        evidenceEventIds: [],
        coachingNote: 'No evidence was found that you met this rule during the call.',
        betterResponseExample: fallbackExample,
      };
    }
    const quote = verifyAgentQuote(result.agentQuoteEvidence, agentMessages);
    const evidenceEventIds = (result.evidenceEventIds ?? []).filter((id) => validEventIds.has(id));
    // A "never do X" rule is broken only by something an agent said or did. The Judge's deduction stands when
    // its quote matches an agent turn (verbatim or a close paraphrase) or its event evidence points at agent
    // events. With no quote and no agent-event evidence the deduction is unsupported, so the rule counts as
    // met. A quote that matches no agent turn is uncertain: the score stays and a Trainer reviews it.
    const prohibitionDeduction = result.score < 100 && isProhibitionCriterion(criterion);
    const quoteSupport = prohibitionDeduction && result.agentQuoteEvidence.trim() ? agentQuoteSupport(result.agentQuoteEvidence, agentMessages) : 0;
    const pointsAtAgentEvent = evidenceEventIds.some((id) => agentEventIds.has(id));
    const unsupportedProhibitionDeduction = prohibitionDeduction && !result.agentQuoteEvidence.trim() && !pointsAtAgentEvent;
    const uncertainProhibitionDeduction =
      prohibitionDeduction && !unsupportedProhibitionDeduction && !pointsAtAgentEvent && quoteSupport < QUOTE_SUPPORT_THRESHOLD;
    const score: number = unsupportedProhibitionDeduction ? 100 : result.score;
    const note = unsupportedProhibitionDeduction
      ? 'No agent turn broke this rule.'
      : uncertainProhibitionDeduction
        ? `${result.coachingNote.trim() || fallbackCoachingNote(score, criterion.criterionLabel)} A Trainer will review this rule.`
        : result.coachingNote.trim();
    return {
      criterionId: criterion.id,
      competencyPillarId: criterion.competencyPillarId,
      criterionLabel: criterion.criterionLabel,
      score,
      agentQuoteEvidence: quote,
      evidenceEventIds,
      coachingNote: note || fallbackCoachingNote(score, criterion.criterionLabel),
      // A suggestion that only repeats the agent's own words teaches nothing (QA M6); use the Playbook rule instead.
      betterResponseExample:
        score === 100
          ? null
          : result.betterResponseExample?.trim() && !isEchoOf(result.betterResponseExample, result.agentQuoteEvidence) && !isEchoOf(result.betterResponseExample, quote)
            ? result.betterResponseExample.trim()
            : fallbackExample,
      ...(uncertainProhibitionDeduction ? { needsTrainerReview: true } : {}),
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
    summaryFeedback:
      judge.summaryFeedback.trim() ||
      (overallScorePct >= (scenario.passScoreThreshold ?? DEFAULT_SIM_PASS_THRESHOLD)
        ? 'You met most of the Playbook rules on this call. Review the notes below to keep it consistent.'
        : 'Review each rule below and practice the better responses before your next call.'),
    strengthsHighlighted: groundedStrengths(judge.strengthsHighlighted, agentMessages, criterionResults),
    coachingImprovements,
    criterionResults,
    provenance: input.provenance,
    evaluatedAt: input.evaluatedAt ?? Date.now(),
  });
}

/** First ~600 characters of a raw Judge answer on one line, for server logs. */
export function judgeRawPreview(raw: string, max = 600): string {
  const flat = raw.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Run the heavy-tier Rubric Judge on a finished Simulation and return the scored SimEvaluation. */
export async function evaluateSimulation(input: {
  scenario: PublicSimScenario;
  secret: SecretSimScenarioConfig;
  messages: SimMessage[];
  selectedDisposition: string;
  pillars: CompetencyPillar[];
  events?: SimulationEvent[];
  gateway?: LLMGateway;
  /** Abort signal (request + deadline). The provider stops the model call when it fires. */
  signal?: AbortSignal;
}): Promise<SimEvaluation> {
  const gateway = input.gateway ?? getLLMGateway();
  const systemPrompt = buildJudgeSystemPrompt();
  const userPrompt = buildJudgeUserPrompt({
    scenario: input.scenario,
    secret: input.secret,
    messages: input.messages,
    selectedDisposition: input.selectedDisposition,
    pillars: input.pillars,
    events: input.events,
  });
  const strictSchema = buildJudgeOutputSchema(input.secret.rubricCriteria);
  let judge: JudgeOutput;
  try {
    judge = await gateway.generateStructured({
      tier: 'heavy',
      systemPrompt,
      userPrompt,
      schema: strictSchema,
      schemaName: 'SimJudgeOutput',
      temperature: 0.1,
      maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
      signal: input.signal,
    });
  } catch (error) {
    // The strict per-scenario check (ids) failed after repairs. If the last output is otherwise valid,
    // keep it: matchJudgeResults pairs results by label/position, which beats discarding a full grade.
    const lastRaw = error instanceof LLMStructuredOutputError ? error.lastRawOutput : '';
    const lenient = lastRaw ? parseStructuredOutput(lastRaw, JudgeOutputSchema) : null;
    if (!lenient?.ok) {
      // Synthetic training data only: the head of the rejected answer is what makes a schema miss diagnosable.
      if (lastRaw) console.warn(`[sim-judge] rejected output (${lastRaw.length} chars): ${judgeRawPreview(lastRaw)}`);
      throw error;
    }
    judge = lenient.data;
  }
  return assembleSimEvaluation({
    judge,
    scenario: input.scenario,
    secret: input.secret,
    messages: input.messages,
    selectedDisposition: input.selectedDisposition,
    events: input.events,
    provenance: createSimulationProvenance({ task: 'judge', systemPrompt, userPrompt }),
  });
}
