import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OpenAICompatibleProvider } from '@/lib/ai/openai-compatible-provider';
import type { StreamChatOptions } from '@/lib/ai/types';

const Schema = z.object({
  title: z.string().min(3),
  modules: z.array(z.object({ objectives: z.array(z.string()).min(1) })).min(1),
});

const structuredOpts = {
  tier: 'heavy' as const,
  systemPrompt: 'Return synthetic curriculum JSON.',
  userPrompt: 'Create one synthetic module.',
  schema: Schema,
  schemaName: 'SyntheticCurriculum',
  maxOutputTokens: 321,
};

function config(fetchImpl: typeof fetch) {
  return {
    baseUrl: 'http://127.0.0.1:8080',
    heavyModel: 'synthetic-heavy',
    fastModel: 'synthetic-fast',
    fetchImpl,
  };
}

function chatResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

function requestBody(call: unknown[]): Record<string, unknown> {
  return JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;
}

async function collect(opts: StreamChatOptions, provider: OpenAICompatibleProvider): Promise<string> {
  let output = '';
  for await (const token of provider.streamChat(opts)) output += token;
  return output;
}

describe('OpenAICompatibleProvider configuration', () => {
  it('accepts only credential-free HTTP loopback base URLs', () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(new OpenAICompatibleProvider(config(fetchImpl)).baseUrl).toBe('http://127.0.0.1:8080');
    expect(new OpenAICompatibleProvider({ ...config(fetchImpl), baseUrl: 'http://[::1]:1234/' }).baseUrl).toBe('http://[::1]:1234');
    for (const baseUrl of [
      'https://127.0.0.1:8080',
      'http://localhost.evil.example:8080',
      'http://192.168.1.10:8080',
      'https://api.openai.com',
      'http://user:password@localhost:8080',
    ]) {
      expect(() => new OpenAICompatibleProvider({ ...config(fetchImpl), baseUrl })).toThrow(/loopback|Hosted|credentials/i);
    }
  });
});

describe('OpenAICompatibleProvider non-streaming and structured output', () => {
  it('uses the heavy model, max_tokens, and shared Zod parsing without native schema or tools', async () => {
    const value = { title: 'Synthetic', modules: [{ objectives: ['Verify the practice order'] }] };
    const fetchImpl = vi.fn(async () => chatResponse(JSON.stringify(value)));
    const provider = new OpenAICompatibleProvider(config(fetchImpl as unknown as typeof fetch));

    await expect(provider.generateStructured(structuredOpts)).resolves.toEqual(value);
    const call = fetchImpl.mock.calls[0] as unknown[];
    expect(String(call[0])).toBe('http://127.0.0.1:8080/v1/chat/completions');
    const body = requestBody(call);
    expect(body.model).toBe('synthetic-heavy');
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBe(321);
    expect(body).not.toHaveProperty('response_format');
    expect(body).not.toHaveProperty('tools');
    expect(JSON.stringify(body.messages)).toContain('JSON Schema');
  });

  it('uses the existing self-repair turn after a Zod validation failure', async () => {
    const responses = [
      chatResponse(JSON.stringify({ title: 'X', modules: [] })),
      chatResponse(JSON.stringify({ title: 'Repaired', modules: [{ objectives: ['Use synthetic evidence'] }] })),
    ];
    const fetchImpl = vi.fn(async () => responses.shift() as Response);
    const provider = new OpenAICompatibleProvider(config(fetchImpl as unknown as typeof fetch));

    const result = await provider.generateStructured(structuredOpts);
    expect(result.title).toBe('Repaired');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const repairMessages = requestBody(fetchImpl.mock.calls[1] as unknown[]).messages as Array<{ role: string; content: string }>;
    expect(repairMessages.at(-1)?.content).toMatch(/rejected|modules|corrected JSON/i);
  });

  it('rejects empty responses and actionable HTTP failures', async () => {
    const empty = new OpenAICompatibleProvider(config(vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch));
    await expect(empty.generateChat({ tier: 'fast', messages: [{ role: 'user', content: 'Hello' }] })).rejects.toThrow(/empty response/i);

    const failed = new OpenAICompatibleProvider(
      config(vi.fn(async () => new Response('synthetic model unavailable', { status: 503 })) as unknown as typeof fetch),
    );
    await expect(failed.generateChat({ tier: 'fast', messages: [{ role: 'user', content: 'Hello' }] })).rejects.toThrow(
      /HTTP 503.*Check the local server/i,
    );
  });

  it('health performs real chat for selected models instead of listing models', async () => {
    const fetchImpl = vi.fn(async () => chatResponse('OK'));
    const provider = new OpenAICompatibleProvider(config(fetchImpl as unknown as typeof fetch));
    await expect(provider.healthCheck()).resolves.toEqual({
      ok: true,
      provider: 'openai_compatible',
      models: ['synthetic-heavy', 'synthetic-fast'],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const rawCall of fetchImpl.mock.calls) {
      const call = rawCall as unknown[];
      expect(String(call[0])).toContain('/v1/chat/completions');
      expect(String(call[0])).not.toContain('/models');
      expect(requestBody(call).stream).toBe(false);
    }
  });
});

describe('OpenAICompatibleProvider SSE streaming', () => {
  const streamOpts: StreamChatOptions = { tier: 'fast', messages: [{ role: 'user', content: 'Synthetic hello' }] };

  it('parses fragmented SSE events, uses the fast model, and stops at [DONE]', async () => {
    const first = JSON.stringify({ choices: [{ delta: { content: 'Synthetic ' } }] });
    const second = JSON.stringify({ choices: [{ delta: { content: 'stream.' } }] });
    const wire = `data: ${first}\r\n\r\ndata: ${second}\r\n\r\ndata: [DONE]\r\n\r\n`;
    const fetchImpl = vi.fn(async () => streamResponse([wire.slice(0, 17), wire.slice(17, 53), wire.slice(53)]));
    const provider = new OpenAICompatibleProvider(config(fetchImpl as unknown as typeof fetch));

    await expect(collect(streamOpts, provider)).resolves.toBe('Synthetic stream.');
    const body = requestBody(fetchImpl.mock.calls[0] as unknown[]);
    expect(body.model).toBe('synthetic-fast');
    expect(body.stream).toBe(true);
  });

  it('reports malformed SSE and truncated streams with actionable errors', async () => {
    const malformed = new OpenAICompatibleProvider(
      config(vi.fn(async () => streamResponse(['data: {not-json}\n\ndata: [DONE]\n\n'])) as unknown as typeof fetch),
    );
    await expect(collect(streamOpts, malformed)).rejects.toThrow(/malformed SSE JSON.*streaming compatibility/i);

    const truncated = new OpenAICompatibleProvider(
      config(
        vi.fn(async () => streamResponse(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'])) as unknown as typeof fetch,
      ),
    );
    await expect(collect(streamOpts, truncated)).rejects.toThrow(/ended before \[DONE\].*truncated/i);
  });

  it('rejects a cleanly terminated but empty stream', async () => {
    const provider = new OpenAICompatibleProvider(
      config(vi.fn(async () => streamResponse(['data: [DONE]\n\n'])) as unknown as typeof fetch),
    );
    await expect(collect(streamOpts, provider)).rejects.toThrow(/without text.*chat-capable/i);
  });
});

describe('OpenAICompatibleProvider cancellation and timeout', () => {
  function pendingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    void input;
    return new Promise<Response>((_resolve, reject) => {
      const rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'));
      if (init?.signal?.aborted) rejectAbort();
      else init?.signal?.addEventListener('abort', rejectAbort, { once: true });
    });
  }

  it('cancels an active request through AbortSignal', async () => {
    const fetchImpl = vi.fn(pendingFetch);
    const provider = new OpenAICompatibleProvider(config(fetchImpl as unknown as typeof fetch));
    const controller = new AbortController();
    const request = provider.generateChat({ tier: 'fast', messages: [{ role: 'user', content: 'Wait' }], signal: controller.signal });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(request).rejects.toThrow(/cancelled/i);
  });

  it('aborts and reports a request that exceeds its timeout', async () => {
    const provider = new OpenAICompatibleProvider({ ...config(vi.fn(pendingFetch) as unknown as typeof fetch), timeoutMs: 10 });
    await expect(provider.generateChat({ tier: 'fast', messages: [{ role: 'user', content: 'Wait' }] })).rejects.toThrow(
      /timed out after 10 ms.*Retry/i,
    );
  });
});
