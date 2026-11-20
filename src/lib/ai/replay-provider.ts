/**
 * Demo stand-in for the LLMGateway (AI_PROVIDER=replay).
 *
 * Serves pre-written AI output from a JSON file through the real pipeline, so the Track build,
 * Studio, Live Call Sim streaming and rubric grading run end to end without a live model.
 * Use it only to record demos. It shows what the app looks like with a cloud model such as Gemini.
 *
 * File (DEMO_REPLAY_FILE, default demo-replay/demo.json):
 * {
 *   "TrackBlueprint": {...}, "TrackUnitContent": [{...}, ...], "SimScenarios": {...},
 *   "sims": { "<personaName>": { "replies": ["...", ...], "judge": {...} } },
 *   "latencyMs": { "heavy": 3000, "fastToken": 35 }
 * }
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { z } from 'zod';
import { LLMStructuredOutputError, type GenerateStructuredOptions, type LLMGateway, type LLMHealth, type StreamChatOptions } from '@/lib/ai/types';
import { formatZodIssues } from '@/lib/ai/pipeline/structured-output';

interface ReplaySim {
  replies: string[];
  judge: unknown;
}

interface ReplayFile {
  TrackBlueprint?: unknown;
  TrackUnitContent?: unknown[];
  SimScenarios?: unknown;
  sims?: Record<string, ReplaySim>;
  latencyMs?: { heavy?: number; fastToken?: number };
}

type ReplaySourcePage = { pageNumber: number; text: string };
type ReplayEvidenceItem = { sourcePages?: number[]; evidence?: unknown; keyTakeaway?: string; explanation?: string; evaluationRule?: string };

/** Older prepared demos did not include evidence. Bind their citations to exact uploaded source text;
 * the real generation pipeline still verifies every excerpt and marks it as an unapproved proposal. */
function addReplayEvidence(raw: unknown, prompt: string): unknown {
  const pages = replaySourcePages(prompt);
  if (pages.length === 0) return raw;

  const attach = (item: ReplayEvidenceItem) => {
    if (item.evidence) return;
    const page = pages.find((candidate) => candidate.pageNumber === item.sourcePages?.[0]) ?? pages[0];
    // The model-facing contract cites a PAGE label and copies one passage; the server fills identity.
    item.evidence = [{
      claim: item.keyTakeaway ?? item.explanation ?? item.evaluationRule ?? 'Source-backed training requirement.',
      ruleIds: [],
      excerpts: [{ pageNumber: page.pageNumber, exactText: firstPassage(page.text) }],
    }];
  };

  const copy = structuredClone(raw) as {
    briefingCards?: ReplayEvidenceItem[];
    drills?: ReplayEvidenceItem[];
    scenarios?: Array<{ secretConfig?: { rubricCriteria?: ReplayEvidenceItem[] } }>;
  };
  copy.briefingCards?.forEach(attach);
  copy.drills?.forEach(attach);
  copy.scenarios?.forEach((scenario) => scenario.secretConfig?.rubricCriteria?.forEach(attach));
  return copy;
}

/**
 * Older prepared demos used campaign disposition codes. The Simulation engine accepts only the canonical
 * list, so map the recorded demo's codes the way the demo recording always configured them
 * (a sent link on these recovery calls is logged as Recovered after the recovery confirmation step).
 */
const LEGACY_DEMO_DISPOSITIONS: Record<string, string> = {
  'link sent - checkout': 'Recovered',
  'link sent - dosage page': 'Recovered',
  'callback requested': 'Callback scheduled',
  'not interested - suppress': 'Not interested',
  'voicemail left': "Didn't reply",
};

function canonicalReplayDisposition(value: unknown): unknown {
  return typeof value === 'string' ? LEGACY_DEMO_DISPOSITIONS[value.trim().toLowerCase()] ?? value : value;
}

/** Rewrite legacy demo disposition codes in a recorded SimScenarios answer (options keep their order, minus duplicates). */
export function normalizeReplayDispositions(raw: unknown): unknown {
  const copy = structuredClone(raw) as {
    scenarios?: Array<{ publicScenario?: { dispositionOptions?: unknown[] }; secretConfig?: { expectedDisposition?: unknown } }>;
  };
  copy.scenarios?.forEach((scenario) => {
    const options = scenario.publicScenario?.dispositionOptions;
    if (Array.isArray(options) && scenario.publicScenario) {
      scenario.publicScenario.dispositionOptions = [...new Set(options.map(canonicalReplayDisposition))];
    }
    if (scenario.secretConfig) scenario.secretConfig.expectedDisposition = canonicalReplayDisposition(scenario.secretConfig.expectedDisposition);
  });
  return copy;
}

/** "=== SOURCE PAGE N ... ===" blocks in a prompt (approved-source and legacy formats). */
function replaySourcePages(prompt: string): ReplaySourcePage[] {
  const pages: ReplaySourcePage[] = [];
  const marker = /=== SOURCE PAGE (\d+)[^\n]*===\n/g;
  const matches = [...prompt.matchAll(marker)];
  matches.forEach((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : prompt.length;
    const text = prompt
      .slice(start, end)
      .split(/\n(?:APPROVED EXCERPTS|APPROVED SHARED RULES|APPROVED OPERATIONAL ASSETS|BRIEFINGCARDS OF THIS UNIT|CONTENT SIZE|TASK)/)[0]
      .trimEnd();
    pages.push({ pageNumber: Number(match[1]), text });
  });
  return pages;
}

/** First line or sentence of a page (at most 400 characters): an exact passage the server can verify. */
function firstPassage(text: string): string {
  const line = text.split('\n').map((part) => part.trim()).find((part) => part.length >= 20) ?? text.trim();
  return line.slice(0, 400);
}

/** Recorded Unit for this prompt: the "UNIT n:" line names the Unit, so resumed or concurrent builds stay stable. */
function replayUnitIndex(prompt: string, unitCount: number): number {
  const match = /^UNIT (\d+):/m.exec(prompt);
  const index = match ? Number(match[1]) - 1 : 0;
  return Math.max(0, index) % Math.max(unitCount, 1);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveSleep, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolveSleep();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class ReplayProvider implements LLMGateway {
  readonly providerName = 'replay' as const;

  constructor(private readonly filePath: string = process.env.DEMO_REPLAY_FILE ?? 'demo-replay/demo.json') {}

  private load(): ReplayFile {
    return JSON.parse(readFileSync(resolve(this.filePath), 'utf8')) as ReplayFile;
  }

  async generateStructured<T extends z.ZodTypeAny>(opts: GenerateStructuredOptions<T>): Promise<z.infer<T>> {
    const data = this.load();
    let raw: unknown;
    if (opts.schemaName === 'TrackBlueprint') {
      raw = data.TrackBlueprint;
    } else if (opts.schemaName === 'TrackUnitContent') {
      const units = data.TrackUnitContent ?? [];
      raw = units[replayUnitIndex(opts.userPrompt, units.length)];
    } else if (opts.schemaName === 'SimScenarios') {
      raw = data.SimScenarios;
    } else if (opts.schemaName === 'SimJudgeOutput') {
      raw = this.findSim(data, `${opts.systemPrompt}\n${opts.userPrompt}`)?.judge;
    }
    if (raw === undefined) {
      throw new Error(`The demo replay file has no output for "${opts.schemaName}".`);
    }
    await sleep(data.latencyMs?.heavy ?? 3000, opts.signal);
    const grounded = opts.schemaName === 'TrackUnitContent'
      ? addReplayEvidence(raw, opts.userPrompt)
      : opts.schemaName === 'SimScenarios'
        ? addReplayEvidence(normalizeReplayDispositions(raw), opts.userPrompt)
        : raw;
    const parsed = opts.schema.safeParse(grounded);
    if (parsed.success) return parsed.data as z.infer<T>;
    // Same failure shape as a live provider, so the pipeline's lenient-evidence fallback applies.
    throw new LLMStructuredOutputError(
      `The demo replay output for "${opts.schemaName}" does not match the schema:\n${formatZodIssues(parsed.error.issues)}`,
      opts.schemaName,
      1,
      JSON.stringify(grounded),
    );
  }

  async *streamChat(opts: StreamChatOptions): AsyncGenerator<string, void, unknown> {
    const data = this.load();
    const system = opts.messages.find((m) => m.role === 'system')?.content ?? '';
    const sim = this.findSim(data, system);
    if (!sim) throw new Error('The demo replay file has no Simulation for this persona.');
    const turn = opts.messages.filter((m) => m.role === 'user').length - 1;
    const reply = sim.replies[Math.min(Math.max(turn - 1, 0), sim.replies.length - 1)] ?? '';
    const tokenMs = data.latencyMs?.fastToken ?? 35;
    await sleep(500, opts.signal);
    for (const token of reply.match(/\S+\s*/g) ?? []) {
      await sleep(tokenMs, opts.signal);
      yield token;
    }
  }

  async healthCheck(): Promise<LLMHealth> {
    try {
      this.load();
      return { ok: true, provider: 'replay', models: ['demo replay'] };
    } catch (error) {
      return { ok: false, provider: 'replay', models: [], error: error instanceof Error ? error.message : String(error) };
    }
  }

  private findSim(data: ReplayFile, text: string): ReplaySim | undefined {
    const entries = Object.entries(data.sims ?? {});
    return entries.find(([persona]) => text.includes(persona))?.[1];
  }
}
