/**
 * Measure the real cost of one Verbal Practice delivery-coach call (Connor 2026-11-24: report actual numbers).
 * Usage: npx tsx scripts/measure-delivery-cost.ts <clip1.webm> [clip2.webm ...]
 * Makes ONE paid Gemini call per run with the model in GEMINI_AUDIO_MODEL or GEMINI_FAST_MODEL. Prints the token
 * counts Gemini reports and the cost at the list prices passed in AUDIO_IN_PER_M / TEXT_IN_PER_M / OUT_PER_M (USD).
 */
import { readFileSync } from 'node:fs';
import { GeminiProvider } from '@/lib/ai/gemini-provider';
import { assessDelivery } from '@/lib/services/delivery-coach';
import type { SimMessage } from '@/lib/schemas/analytics';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Pass one or more audio clips (webm/ogg).');
  process.exit(1);
}

const messages: SimMessage[] = files.flatMap((file, i) => [
  { id: `c${i}`, role: 'counterparty' as const, content: i === 0 ? 'Hello?' : 'Okay, go on.', createdAt: i * 2 },
  { id: `a${i}`, role: 'agent' as const, content: `(spoken reply ${i + 1}, see audio: ${file.split('/').pop()})`, createdAt: i * 2 + 1 },
]);

async function main() {
  process.env.GEMINI_LOG_USAGE = '1';
  const provider = new GeminiProvider();
  const model = process.env.GEMINI_AUDIO_MODEL?.trim() || provider.fastModel;
  const started = Date.now();
  const durations = files.map((f) => Number(process.env[`DUR_${f.split('/').pop()?.replace(/\W/g, '_')}`] ?? 0));
  const result = await assessDelivery({
    gateway: provider,
    model,
    messages,
    counterpartyLabel: 'Patient',
    scenarioTitle: 'Refill recovery call (cost measurement)',
    clips: files.map((file, i) => ({
      agentTurnIndex: i,
      durationMs: durations[i] || 0,
      mimeType: file.endsWith('.ogg') ? 'audio/ogg' : 'audio/webm',
      base64: readFileSync(file).toString('base64'),
    })),
  });
  console.log(JSON.stringify({ model, ms: Date.now() - started, overall: result.overallScore, dimensions: result.dimensions, summary: result.summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
