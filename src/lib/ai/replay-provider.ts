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
import type { GenerateStructuredOptions, LLMGateway, LLMHealth, StreamChatOptions } from '@/lib/ai/types';

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

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveSleep, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(resolveSleep, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    });
  });
}

export class ReplayProvider implements LLMGateway {
  readonly providerName = 'replay' as const;
  private unitIndex = 0;

  constructor(private readonly filePath: string = process.env.DEMO_REPLAY_FILE ?? 'demo-replay/demo.json') {}

  private load(): ReplayFile {
    return JSON.parse(readFileSync(resolve(this.filePath), 'utf8')) as ReplayFile;
  }

  async generateStructured<T extends z.ZodTypeAny>(opts: GenerateStructuredOptions<T>): Promise<z.infer<T>> {
    const data = this.load();
    let raw: unknown;
    if (opts.schemaName === 'TrackBlueprint') {
      this.unitIndex = 0;
      raw = data.TrackBlueprint;
    } else if (opts.schemaName === 'TrackUnitContent') {
      const units = data.TrackUnitContent ?? [];
      raw = units[this.unitIndex % Math.max(units.length, 1)];
      this.unitIndex += 1;
    } else if (opts.schemaName === 'SimScenarios') {
      raw = data.SimScenarios;
    } else if (opts.schemaName === 'SimJudgeOutput') {
      raw = this.findSim(data, `${opts.systemPrompt}\n${opts.userPrompt}`)?.judge;
    }
    if (raw === undefined) {
      throw new Error(`The demo replay file has no output for "${opts.schemaName}".`);
    }
    await sleep(data.latencyMs?.heavy ?? 3000);
    return opts.schema.parse(raw) as z.infer<T>;
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
