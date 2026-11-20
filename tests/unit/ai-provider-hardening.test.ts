import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OllamaProvider } from '@/lib/ai/ollama-provider';
import { DEFAULT_OPENAI_COMPATIBLE_BASE_URL, OpenAICompatibleProvider } from '@/lib/ai/openai-compatible-provider';
import { activeProviderName, getLLMGateway } from '@/lib/ai/gateway';
import { AIUnavailableError, LLMOutputTruncatedError, isAIUnavailableError } from '@/lib/ai/types';

const Schema = z.object({ status: z.literal('ready') });
const structured = { tier: 'heavy' as const, systemPrompt: 's', userPrompt: 'u', schema: Schema, schemaName: 'T' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface CapturedBody {
  model: string;
  max_tokens?: number;
  messages: unknown[];
  options: { num_predict?: number };
}

function bodyOf(call: unknown[]): CapturedBody {
  return JSON.parse(String((call[1] as RequestInit).body)) as CapturedBody;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('OllamaProvider capability checks', () => {
  const tags = { models: [{ name: 'clef:27b-mxfp8' }, { name: 'clef-flash:9b-mxfp8' }] };

  it('fails health when an installed model lacks the "completion" capability', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/api/tags') ? json(tags) : json({ capabilities: ['decision', 'vision'] }),
    );
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const health = await provider.healthCheck();
    expect(health.ok).toBe(false);
    expect(health.error).toMatch(/installed but cannot chat \(capabilities: decision, vision\)/);
    expect(health.error).toMatch(/OLLAMA_HEAVY_MODEL\/OLLAMA_FAST_MODEL/);
    expect(health.error).toMatch(/npm run dev:mlx/);
    const showCalls = fetchImpl.mock.calls.filter((call) => String(call[0]).endsWith('/api/show'));
    expect(showCalls.map((call) => bodyOf(call).model)).toEqual(['clef:27b-mxfp8', 'clef-flash:9b-mxfp8']);
  });

  it('passes health for chat models and when capabilities are not reported', async () => {
    let show = 0;
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/api/tags') ? json(tags) : json(show++ === 0 ? { capabilities: ['completion', 'tools'] } : {}),
    );
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(provider.healthCheck()).resolves.toMatchObject({ ok: true });
  });

  it('maps HTTP 400 "does not support chat" to AIUnavailableError with the same message', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/api/chat')
        ? json({ error: '"clef:27b-mxfp8" does not support chat' }, 400)
        : json({ capabilities: ['decision', 'vision'] }),
    );
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const error = await provider.generateStructured(structured).catch((caught: unknown) => caught);
    expect(isAIUnavailableError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'model_cannot_chat' });
    expect((error as Error).message).toMatch(/installed but cannot chat \(capabilities: decision, vision\)/);
  });

  it('wraps connection failures in AIUnavailableError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed: ECONNREFUSED');
    });
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(provider.generateStructured(structured)).rejects.toMatchObject({ name: 'AIUnavailableError', code: 'unreachable' });
  });
});

describe('OllamaProvider structured requests', () => {
  it('passes a signal, sets num_predict (default 8192), and retries done_reason "length" once at double', async () => {
    const responses = [
      json({ message: { content: '{"status":' }, done: true, done_reason: 'length' }),
      json({ message: { content: '{"status":"ready"}' }, done: true, done_reason: 'stop' }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift() as Response);
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(provider.generateStructured(structured)).resolves.toEqual({ status: 'ready' });
    expect(fetchImpl.mock.calls.map((call) => bodyOf(call as unknown[]).options.num_predict)).toEqual([8192, 16384]);
    expect((fetchImpl.mock.calls[0] as unknown[])[1]).toHaveProperty('signal');
    expect(((fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('honours maxOutputTokens and aborts with the caller signal', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect(bodyOf([_url, init]).options.num_predict).toBe(1234);
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        controller.abort();
      });
    });
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(provider.generateStructured({ ...structured, maxOutputTokens: 1234, signal: controller.signal })).rejects.toThrow(/cancelled/);
  });

  it('times out a stuck request', async () => {
    const fetchImpl = vi.fn(
      async (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 10 });
    await expect(provider.generateStructured(structured)).rejects.toMatchObject({ code: 'timeout' });
  });
});

describe('OpenAICompatibleProvider truncation and defaults', () => {
  const config = (fetchImpl: unknown) => ({ heavyModel: 'h', fastModel: 'f', fetchImpl: fetchImpl as typeof fetch });

  it('defaults to the MLX port, not the Firestore emulator port', () => {
    expect(DEFAULT_OPENAI_COMPATIBLE_BASE_URL).toBe('http://127.0.0.1:8081');
    expect(new OpenAICompatibleProvider(config(vi.fn())).baseUrl).toBe('http://127.0.0.1:8081');
  });

  it('always sends max_tokens and raises LLMOutputTruncatedError after one doubled retry', async () => {
    const fetchImpl = vi.fn(async () => json({ choices: [{ message: { content: '{"status":' }, finish_reason: 'length' }] }));
    const provider = new OpenAICompatibleProvider(config(fetchImpl));
    const error = await provider.generateStructured(structured).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LLMOutputTruncatedError);
    expect(error).toMatchObject({ maxOutputTokens: 16384, rawLength: 10 });
    expect(fetchImpl.mock.calls.map((call) => bodyOf(call as unknown[]).max_tokens)).toEqual([8192, 16384]);
    // Truncated output was never sent back for schema repair.
    expect(fetchImpl.mock.calls.every((call) => bodyOf(call as unknown[]).messages.length === 2)).toBe(true);
  });

  it('wraps connection refused in AIUnavailableError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const provider = new OpenAICompatibleProvider(config(fetchImpl));
    await expect(provider.generateStructured(structured)).rejects.toMatchObject({ name: 'AIUnavailableError', code: 'unreachable' });
  });
});

describe('gateway provider selection', () => {
  it('throws a clear error for an unknown AI_PROVIDER', () => {
    vi.stubEnv('AI_PROVIDER', 'olama');
    expect(() => activeProviderName()).toThrow(/AI_PROVIDER="olama" is not supported.*ollama.*gemini.*openai_compatible.*replay.*manual_chat/);
    expect(() => getLLMGateway()).toThrow(AIUnavailableError);
  });

  it('accepts unset, aliases, and case variations', () => {
    vi.stubEnv('AI_PROVIDER', '');
    expect(activeProviderName()).toBe('ollama');
    vi.stubEnv('AI_PROVIDER', 'LOCAL');
    expect(activeProviderName()).toBe('openai_compatible');
  });

  it('throws a recognizable AIUnavailableError in manual_chat mode', () => {
    vi.stubEnv('AI_PROVIDER', 'manual_chat');
    const error = (() => {
      try {
        getLLMGateway();
      } catch (caught) {
        return caught;
      }
    })();
    expect(isAIUnavailableError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'manual_chat' });
  });
});
