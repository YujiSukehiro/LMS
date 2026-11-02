import { z } from 'zod';

export const LocalCapabilitySchema = z.enum([
  'availability',
  'basic_chat',
  'streaming_chat',
  'structured_output',
  'heavy_generation',
  'judge_evidence',
  'cancellation_timeout',
  'concurrency',
]);

export type LocalCapability = z.infer<typeof LocalCapabilitySchema>;

export const CapabilityResultSchema = z.object({
  capability: LocalCapabilitySchema,
  status: z.enum(['passed', 'failed', 'not_tested']),
  model: z.string().min(1).optional(),
  latencyMs: z.number().int().nonnegative(),
  outputChars: z.number().int().nonnegative().optional(),
  lastSuccessAt: z.string().datetime().optional(),
  error: z.string().min(1).optional(),
  nextStep: z.string().min(1).optional(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export type CapabilityResult = z.infer<typeof CapabilityResultSchema>;

export const LocalRuntimeProfileSchema = z.object({
  id: z.string().min(1),
  provider: z.enum(['openai_compatible', 'ollama']),
  runtimeLabel: z.string().min(1).optional(),
  baseUrl: z.string().min(1),
  models: z.object({
    structuredGeneration: z.string().min(1).optional(),
    streamingChat: z.string().min(1).optional(),
    judge: z.string().min(1).optional(),
  }),
  defaults: z.object({
    temperatureByTask: z.record(z.string(), z.number().min(0).max(2)),
    timeoutMsByTask: z.record(z.string(), z.number().int().positive()),
    maxConcurrency: z.literal(1),
    contextBudgetByTask: z.record(z.string(), z.number().int().positive()),
  }),
  validatedCapabilities: z.array(CapabilityResultSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type LocalRuntimeProfile = z.infer<typeof LocalRuntimeProfileSchema>;

export const DEFAULT_LOCAL_RUNTIME_DEFAULTS: LocalRuntimeProfile['defaults'] = {
  temperatureByTask: {
    basicChat: 0,
    streamingChat: 0.6,
    structuredGeneration: 0.2,
    heavyGeneration: 0.2,
    judge: 0.1,
  },
  timeoutMsByTask: {
    availability: 30_000,
    basicChat: 30_000,
    streamingChat: 60_000,
    structuredGeneration: 90_000,
    heavyGeneration: 180_000,
    judge: 90_000,
    cancellation: 5_000,
    concurrency: 60_000,
  },
  maxConcurrency: 1,
  contextBudgetByTask: {
    basicChat: 4_096,
    streamingChat: 8_192,
    structuredGeneration: 16_384,
    heavyGeneration: 16_384,
    judge: 8_192,
  },
};

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

/** Validate and normalize a local HTTP endpoint. Credentials, query strings, and fragments are rejected. */
export function normalizeLoopbackBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Local runtime base URL must be a valid HTTP loopback URL, such as http://127.0.0.1:8080.');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    throw new Error('Local runtime base URL must use http://localhost, http://127.0.0.1, or http://[::1]. Hosted endpoints are not allowed.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Local runtime base URL must not contain credentials, a query string, or a fragment.');
  }
  return url.toString().replace(/\/+$/, '');
}

export interface CreateLocalRuntimeProfileInput {
  id?: string;
  provider: LocalRuntimeProfile['provider'];
  runtimeLabel?: string;
  baseUrl: string;
  models: LocalRuntimeProfile['models'];
  defaults?: LocalRuntimeProfile['defaults'];
  validatedCapabilities?: CapabilityResult[];
  now?: Date;
}

export function createLocalRuntimeProfile(input: CreateLocalRuntimeProfileInput): LocalRuntimeProfile {
  const timestamp = (input.now ?? new Date()).toISOString();
  return LocalRuntimeProfileSchema.parse({
    id: input.id ?? `${input.provider}-local`,
    provider: input.provider,
    runtimeLabel: nonEmpty(input.runtimeLabel),
    baseUrl: normalizeLoopbackBaseUrl(input.baseUrl),
    models: {
      structuredGeneration: nonEmpty(input.models.structuredGeneration),
      streamingChat: nonEmpty(input.models.streamingChat),
      judge: nonEmpty(input.models.judge),
    },
    defaults: input.defaults ?? DEFAULT_LOCAL_RUNTIME_DEFAULTS,
    validatedCapabilities: input.validatedCapabilities ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

/** Build the generic local profile without reading or logging any credentials. */
export function openAICompatibleProfileFromEnv(
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): LocalRuntimeProfile | null {
  const baseUrl = nonEmpty(env.OPENAI_COMPATIBLE_BASE_URL);
  if (!baseUrl) return null;
  const heavyModel = nonEmpty(env.OPENAI_COMPATIBLE_HEAVY_MODEL);
  return createLocalRuntimeProfile({
    provider: 'openai_compatible',
    runtimeLabel: nonEmpty(env.LOCAL_RUNTIME_LABEL),
    baseUrl,
    models: {
      structuredGeneration: heavyModel,
      streamingChat: nonEmpty(env.OPENAI_COMPATIBLE_FAST_MODEL),
      judge: heavyModel,
    },
    now,
  });
}

/** A small provider-neutral FIFO limiter. Local profiles deliberately start at one in-flight request. */
export class LocalRuntimeLimiter {
  readonly maxConcurrency = 1 as const;
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  get activeCount(): number {
    return this.active;
  }

  get pendingCount(): number {
    return this.waiting.length;
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new Error('Local runtime request was cancelled before acquiring a concurrency slot.');
    if (this.active >= this.maxConcurrency) {
      await new Promise<void>((resolve, reject) => {
        const waiter = () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        };
        const onAbort = () => {
          const index = this.waiting.indexOf(waiter);
          if (index !== -1) this.waiting.splice(index, 1);
          signal?.removeEventListener('abort', onAbort);
          reject(new Error('Local runtime request was cancelled while waiting for a concurrency slot.'));
        };
        this.waiting.push(waiter);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      const next = this.waiting.shift();
      if (next) next();
    };
  }

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try {
      return await task();
    } finally {
      release();
    }
  }
}
