/**
 * npm run verify:ollama — checks the local Ollama daemon before `npm run dev`:
 * provider, base URL, required models, and one tiny structured generation on the fast model.
 * Exits with code 1 and a fix hint when Ollama is unreachable, a model is missing, or a model cannot chat
 * (POST /api/show capabilities lack "completion").
 */
import { z } from 'zod';
import { OllamaProvider, ollamaCannotChatMessage } from '../src/lib/ai/ollama-provider';
import { isAIUnavailableError } from '../src/lib/ai/types';

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(14)} ${value}`);
}

function fail(message: string, hints: string[]): never {
  console.error(`\n✖ ${message}`);
  for (const hint of hints) console.error(`  → ${hint}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const providerSetting = (process.env.AI_PROVIDER ?? 'ollama').trim().toLowerCase() || 'ollama';
  const provider = new OllamaProvider();

  console.log('LogiCall Pulse — LLMGateway check (Ollama)');
  line('AI_PROVIDER', providerSetting);
  line('Base URL', provider.baseUrl);
  line('Heavy model', provider.heavyModel);
  line('Fast model', provider.fastModel);

  if (providerSetting !== 'ollama') {
    console.log(`\nAI_PROVIDER is "${providerSetting}", so the app does not use Ollama. Nothing to check.`);
    return;
  }

  let installed: string[];
  try {
    installed = await provider.listInstalledModels();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(`Cannot reach Ollama at ${provider.baseUrl} (${reason}).`, [
      'Start Ollama: open the Ollama app, or run "ollama serve".',
      'If Ollama runs on another host or port, set OLLAMA_BASE_URL in .env.local.',
    ]);
  }

  const withTag = (name: string) => (name.includes(':') ? name : `${name}:latest`);
  const installedSet = new Set(installed.map(withTag));
  const required = [...new Set([provider.heavyModel, provider.fastModel])];
  const missing = required.filter((name) => !installedSet.has(withTag(name)));

  console.log('\nModels:');
  for (const name of required) line(installedSet.has(withTag(name)) ? '✔ found' : '✖ missing', name);
  if (missing.length > 0) {
    fail(
      `Missing Ollama model(s): ${missing.join(', ')}.`,
      [
        ...missing.map((name) => `Run: ollama pull ${name}`),
        'Or set OLLAMA_HEAVY_MODEL / OLLAMA_FAST_MODEL in .env.local to models you have installed ("ollama list").',
      ],
    );
  }

  console.log('\nCapabilities (POST /api/show):');
  const cannotChat: string[] = [];
  for (const name of required) {
    let capabilities: string[] | null;
    try {
      capabilities = await provider.getModelCapabilities(name);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      fail(`Could not read capabilities for ${name}: ${reason}`, ['Run the check again. If it fails again, restart Ollama.']);
    }
    const canChat = capabilities === null || capabilities.includes('completion');
    line(canChat ? '✔ chat' : '✖ no chat', `${name} (${capabilities === null ? 'capabilities not reported' : capabilities.join(', ') || 'none'})`);
    if (!canChat) cannotChat.push(ollamaCannotChatMessage(name, capabilities));
  }
  if (cannotChat.length > 0) {
    fail('Configured Ollama model(s) cannot chat.', [...cannotChat, 'List chat-capable models with "ollama list" and "ollama show <model>".']);
  }

  console.log('\nStructured output test (fast model)...');
  const TestSchema = z.object({
    status: z.literal('ready'),
    divisionCount: z.number().int(),
  });
  const started = Date.now();
  try {
    const result = await provider.generateStructured({
      tier: 'fast',
      systemPrompt: 'You return JSON only.',
      userPrompt: 'Return {"status":"ready","divisionCount":3}.',
      schema: TestSchema,
      schemaName: 'VerifyOllama',
      temperature: 0,
      maxOutputTokens: 256,
    });
    line('Result', JSON.stringify(result));
    line('Time', `${((Date.now() - started) / 1000).toFixed(1)} s`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (isAIUnavailableError(error)) fail(reason, ['Fix the runtime configuration above, then rerun npm run verify:ollama.']);
    fail(`The fast model could not return structured JSON: ${reason}`, [
      `Check the model runs: ollama run ${provider.fastModel} "hello"`,
      'Update Ollama to a version that supports JSON Schema "format" (0.5 or later).',
    ]);
  }

  console.log('\n✔ Ollama is ready for LogiCall Pulse.');
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  fail(`Unexpected error: ${reason}`, ['Run the check again. If it fails again, restart Ollama.']);
});
