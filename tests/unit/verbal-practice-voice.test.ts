/**
 * Verbal Practice voice (2026-11-24): live dictation helpers, caller voice choice, and the coaching-only delivery
 * score from the agent's audio. Every Gemini call here is mocked: no paid API calls in tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const sdk = vi.hoisted(() => ({ generateContent: vi.fn(), createCache: vi.fn() }));
vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/genai')>();
  class GoogleGenAI {
    models = { generateContent: sdk.generateContent };
    caches = { create: sdk.createCache };
  }
  return { ...actual, GoogleGenAI };
});

import { FinishReason } from '@google/genai';
import { GeminiProvider } from '@/lib/ai/gemini-provider';
import type { LLMGateway } from '@/lib/ai/types';
import { appendSpoken, composeWithInterim, isFatalVoiceError, pickCallerVoice, speakableText } from '@/components/simulation/voice-core';
import { assessDelivery, deliveryOverallScore } from '@/lib/services/delivery-coach';
import { DeliveryModelOutputSchema, DeliveryRequestMetaSchema } from '@/lib/schemas/delivery';
import type { SimMessage } from '@/lib/schemas/analytics';

beforeEach(() => {
  sdk.generateContent.mockReset();
  sdk.createCache.mockReset();
});

describe('dictation helpers', () => {
  it('appends spoken words with one space and respects the length cap', () => {
    expect(appendSpoken('', ' hello there ', 100)).toBe('hello there');
    expect(appendSpoken('Hi,', 'this is Sam', 100)).toBe('Hi, this is Sam');
    expect(appendSpoken('abc', 'defgh', 6)).toBe('abc de');
    expect(appendSpoken('keep', '   ', 100)).toBe('keep');
  });
  it('shows words still being recognised after the draft', () => {
    expect(composeWithInterim('Thanks for', 'calling', 100)).toBe('Thanks for calling');
    expect(composeWithInterim('Thanks', '', 100)).toBe('Thanks');
  });
  it('only stops auto-restart for errors the learner must fix', () => {
    expect(isFatalVoiceError('not-allowed')).toBe(true);
    expect(isFatalVoiceError('audio-capture')).toBe(true);
    expect(isFatalVoiceError('no-speech')).toBe(false);
    expect(isFatalVoiceError('aborted')).toBe(false);
  });
});

describe('caller voice', () => {
  it('prefers a natural US English voice', () => {
    const voices = [
      { name: 'Alex', lang: 'en-US' },
      { name: 'Thomas', lang: 'fr-FR' },
      { name: 'Google US English', lang: 'en-US' },
    ];
    expect(pickCallerVoice(voices)?.name).toBe('Google US English');
    expect(pickCallerVoice([{ name: 'Thomas', lang: 'fr-FR' }])).toBeNull();
    expect(pickCallerVoice([{ name: 'Daniel', lang: 'en-GB' }])?.name).toBe('Daniel');
  });
  it('reads only the spoken words', () => {
    expect(speakableText('**Hi** [sighs] I need my *order*.')).toBe('Hi I need my order.');
  });
});

const messages: SimMessage[] = [
  { id: 'c1', role: 'counterparty', content: 'Hello?', createdAt: 1 },
  { id: 'a1', role: 'agent', content: 'Hi, this is Sam from LogiCall.', createdAt: 2 },
  { id: 'c2', role: 'counterparty', content: 'What is this about?', createdAt: 3 },
  { id: 'a2', role: 'agent', content: 'Your refill order.', createdAt: 4 },
];
const modelAnswer = {
  dimensions: [
    { key: 'warmth', score: 4, note: 'Friendly opener.' },
    { key: 'pace', score: 2, note: 'Rushed in reply 2.' },
    { key: 'conciseness', score: 5, note: 'Short and clear.' },
    { key: 'confidence', score: 3, note: 'Some hesitation.' },
    { key: 'professionalism', score: 4, note: 'Polite.' },
    { key: 'pace', score: 5, note: 'duplicate is ignored' },
  ],
  strengths: ['Warm greeting'],
  coachingTips: ['Slow down in reply 2.'],
  summary: 'Friendly but a little rushed.',
};

describe('delivery coach', () => {
  it('computes the overall score in code from 1-5 scores', () => {
    expect(deliveryOverallScore([{ score: 5 }, { score: 5 }])).toBe(100);
    expect(deliveryOverallScore([{ score: 1 }])).toBe(0);
    expect(deliveryOverallScore([{ score: 3 }, { score: 4 }])).toBe(63);
  });

  it('sends each clip as inline audio after its label and keeps one score per dimension', async () => {
    sdk.generateContent.mockResolvedValue({
      text: JSON.stringify(modelAnswer),
      candidates: [{ finishReason: FinishReason.STOP }],
      usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 200 },
    });
    const gateway = new GeminiProvider({ apiKey: 'k', fastModel: 'flash-lite-test' });
    const result = await assessDelivery({
      gateway,
      messages,
      counterpartyLabel: 'Patient',
      scenarioTitle: 'Refill call',
      clips: [
        { agentTurnIndex: 1, durationMs: 2500, mimeType: 'audio/webm', base64: 'QUJD' },
        { agentTurnIndex: 0, durationMs: 3000, mimeType: 'audio/webm', base64: 'REVG' },
        { agentTurnIndex: 7, durationMs: 1000, mimeType: 'audio/webm', base64: 'WFla' },
      ],
      now: 42,
    });
    expect(sdk.generateContent).toHaveBeenCalledTimes(1);
    const params = sdk.generateContent.mock.calls[0][0];
    expect(params.model).toBe('flash-lite-test');
    const parts = params.contents[0].parts;
    expect(parts[0].text).toContain('<transcript>');
    expect(parts[0].text).toContain('Agent reply 2: Your refill order.');
    expect(parts.slice(1)).toEqual([
      { text: 'Recording of agent reply 1:' },
      { inlineData: { mimeType: 'audio/webm', data: 'REVG' } },
      { text: 'Recording of agent reply 2:' },
      { inlineData: { mimeType: 'audio/webm', data: 'QUJD' } },
    ]);
    expect(result.dimensions.map((d) => d.key)).toEqual(['warmth', 'pace', 'conciseness', 'confidence', 'professionalism']);
    expect(result.dimensions.find((d) => d.key === 'pace')?.score).toBe(2);
    expect(result.overallScore).toBe(65);
    expect(result).toMatchObject({ spokenTurns: 2, spokenSeconds: 5.5, model: 'flash-lite-test', assessedAt: 42 });
  });

  it('uses GEMINI_AUDIO_MODEL when given', async () => {
    sdk.generateContent.mockResolvedValue({ text: JSON.stringify(modelAnswer), candidates: [{ finishReason: FinishReason.STOP }] });
    const gateway = new GeminiProvider({ apiKey: 'k', fastModel: 'fast' });
    const result = await assessDelivery({
      gateway, model: 'audio-model', messages, counterpartyLabel: 'Patient', scenarioTitle: 'x',
      clips: [{ agentTurnIndex: 0, durationMs: 1000, mimeType: 'audio/ogg', base64: 'QQ==' }],
    });
    expect(sdk.generateContent.mock.calls[0][0].model).toBe('audio-model');
    expect(result.model).toBe('audio-model');
  });

  it('refuses non-Gemini runtimes and sessions with no spoken replies, without calling a model', async () => {
    const fake = { providerName: 'ollama', generateStructured: vi.fn() } as unknown as LLMGateway;
    await expect(
      assessDelivery({ gateway: fake, messages, counterpartyLabel: 'P', scenarioTitle: 'x', clips: [{ agentTurnIndex: 0, durationMs: 1, mimeType: 'audio/webm', base64: 'QQ==' }] }),
    ).rejects.toMatchObject({ code: 'DELIVERY_UNAVAILABLE' });
    const gemini = new GeminiProvider({ apiKey: 'k' });
    await expect(
      assessDelivery({ gateway: gemini, messages, counterpartyLabel: 'P', scenarioTitle: 'x', clips: [{ agentTurnIndex: 9, durationMs: 1, mimeType: 'audio/webm', base64: 'QQ==' }] }),
    ).rejects.toMatchObject({ code: 'NO_SPOKEN_REPLIES' });
    expect(sdk.generateContent).not.toHaveBeenCalled();
  });

  it('clamps long model text and rejects unknown dimensions', () => {
    const long = DeliveryModelOutputSchema.parse({ ...modelAnswer, summary: 'x'.repeat(900) });
    expect(long.summary.length).toBe(400);
    expect(DeliveryModelOutputSchema.safeParse({ ...modelAnswer, dimensions: [{ key: 'accent', score: 3, note: '' }] }).success).toBe(false);
  });

  it('limits upload metadata', () => {
    expect(DeliveryRequestMetaSchema.safeParse({ clips: [] }).success).toBe(false);
    expect(DeliveryRequestMetaSchema.safeParse({ clips: [{ agentTurnIndex: 0, durationMs: 2000 }] }).success).toBe(true);
    expect(z.array(z.unknown()).max(30).safeParse(new Array(31).fill(0)).success).toBe(false);
  });
});
