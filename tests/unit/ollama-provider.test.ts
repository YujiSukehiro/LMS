import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OllamaProvider } from '@/lib/ai/ollama-provider';

const Schema = z.object({
  pillarLabel: z.string().min(3),
  units: z.array(z.object({ title: z.string() })).min(1),
});

function chatResponse(content: string): Response {
  return new Response(JSON.stringify({ model: 'clef:27b-mxfp8', message: { role: 'assistant', content }, done: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface CapturedBody {
  model: string;
  stream: boolean;
  format: Record<string, unknown>;
  keep_alive: string;
  options: { temperature: number; num_ctx: number };
  messages: Array<{ role: string; content: string }>;
}

function bodyOf(call: unknown[]): CapturedBody {
  const init = call[1] as RequestInit;
  return JSON.parse(String(init.body)) as CapturedBody;
}

const baseOpts = {
  tier: 'heavy' as const,
  systemPrompt: 'You build Tracks.',
  userPrompt: '=== SOURCE PAGE 1 ===\nVerify the order number.',
  schema: Schema,
  schemaName: 'TestBlueprint',
};

describe('OllamaProvider.generateStructured', () => {
  it('posts a JSON Schema format request to /api/chat on the heavy model', async () => {
    const fetchImpl = vi.fn(async () => chatResponse(JSON.stringify({ pillarLabel: 'Verification', units: [{ title: 'Unit 1' }] })));
    const provider = new OllamaProvider({
      baseUrl: 'http://127.0.0.1:11434',
      heavyModel: 'clef:27b-mxfp8',
      fastModel: 'clef-flash:9b-mxfp8',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await provider.generateStructured(baseOpts);

    expect(result).toEqual({ pillarLabel: 'Verification', units: [{ title: 'Unit 1' }] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0] as unknown[];
    expect(String(call[0])).toBe('http://127.0.0.1:11434/api/chat');
    const body = bodyOf(call);
    expect(body.model).toBe('clef:27b-mxfp8');
    expect(body.stream).toBe(false);
    expect(body.keep_alive).toBe('15m');
    expect(body.options.temperature).toBe(0.2);
    expect(body.options.num_ctx).toBe(16384);
    expect(body.format.type).toBe('object');
    expect(body.format).toHaveProperty('properties.pillarLabel');
    expect(body.format).toHaveProperty('properties.units');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You build Tracks.' });
    expect(body.messages[1].role).toBe('user');
  });

  it('strips markdown code fences before parsing', async () => {
    const fenced = '```json\n{"pillarLabel":"Empathy","units":[{"title":"U"}]}\n```';
    const fetchImpl = vi.fn(async () => chatResponse(fenced));
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(provider.generateStructured(baseOpts)).resolves.toEqual({ pillarLabel: 'Empathy', units: [{ title: 'U' }] });
  });

  it('self-repairs with Zod error feedback and succeeds on the second retry', async () => {
    const responses = [
      chatResponse(JSON.stringify({ pillarLabel: 'X', units: [] })),
      chatResponse('not json at all'),
      chatResponse(JSON.stringify({ pillarLabel: 'Escalation', units: [{ title: 'Unit 1' }] })),
    ];
    const fetchImpl = vi.fn(async () => responses.shift() as Response);
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await provider.generateStructured(baseOpts);

    expect(result.pillarLabel).toBe('Escalation');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const repairBody = bodyOf(fetchImpl.mock.calls[1] as unknown[]);
    const lastUserMessage = repairBody.messages[repairBody.messages.length - 1];
    expect(lastUserMessage.role).toBe('user');
    expect(lastUserMessage.content).toMatch(/pillarLabel|units/);
  });

  it('fails after 2 retries (3 attempts total)', async () => {
    const fetchImpl = vi.fn(async () => chatResponse(JSON.stringify({ pillarLabel: 'X', units: [] })));
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(provider.generateStructured(baseOpts)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe('OllamaProvider.streamChat', () => {
  it('parses NDJSON chunks split across network reads and yields tokens on the fast model', async () => {
    const lines = [
      { message: { role: 'assistant', content: 'I want ' }, done: false },
      { message: { role: 'assistant', content: 'my money ' }, done: false },
      { message: { role: 'assistant', content: 'back.' }, done: false },
      { message: { role: 'assistant', content: '' }, done: true },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n');
    const mid = Math.floor(lines.length / 2);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(lines.slice(0, mid)));
        controller.enqueue(encoder.encode(lines.slice(mid) + '\n'));
        controller.close();
      },
    });
    const fetchImpl = vi.fn(async () => new Response(stream, { status: 200 }));
    const provider = new OllamaProvider({ fastModel: 'clef-flash:9b-mxfp8', fetchImpl: fetchImpl as unknown as typeof fetch });

    const tokens: string[] = [];
    for await (const token of provider.streamChat({ tier: 'fast', messages: [{ role: 'user', content: 'Hello' }] })) {
      tokens.push(token);
    }

    expect(tokens.join('')).toBe('I want my money back.');
    const body = bodyOf(fetchImpl.mock.calls[0] as unknown[]);
    expect(body.model).toBe('clef-flash:9b-mxfp8');
    expect(body.stream).toBe(true);
  });
});
