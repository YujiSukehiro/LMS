/**
 * Run with npm's existing tsx environment loading mechanism:
 *   npm exec -- tsx --env-file=.env.local scripts/verify-local-ai.ts
 *
 * Reads only OPENAI_COMPATIBLE_BASE_URL, OPENAI_COMPATIBLE_HEAVY_MODEL,
 * OPENAI_COMPATIBLE_FAST_MODEL, and optional LOCAL_RUNTIME_LABEL for profile selection.
 */
import { OpenAICompatibleProvider } from '../src/lib/ai/openai-compatible-provider';
import { openAICompatibleProfileFromEnv } from '../src/lib/ai/local-runtime';
import { runLocalCapabilityPreflight } from '../src/lib/ai/local-preflight';

function sanitized(message: string): string {
  let output = message;
  for (const [name, value] of Object.entries(process.env)) {
    if (value && value.length >= 3 && /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)) {
      output = output.split(value).join('[redacted]');
    }
  }
  return output.slice(0, 800);
}

function errorMessage(error: unknown): string {
  return sanitized(error instanceof Error ? error.message : String(error));
}

async function main(): Promise<void> {
  const profile = openAICompatibleProfileFromEnv();
  const provider = profile
    ? new OpenAICompatibleProvider({
        baseUrl: profile.baseUrl,
        heavyModel: profile.models.structuredGeneration,
        fastModel: profile.models.streamingChat,
      })
    : undefined;
  const report = await runLocalCapabilityPreflight(profile, provider);

  console.log('LogiCall Pulse — local OpenAI-compatible capability preflight');
  console.log(`  Profile       ${report.profileId}`);
  console.log(`  Protocol      ${report.provider}`);
  if (report.runtimeLabel) console.log(`  Runtime       ${report.runtimeLabel}`);
  if (report.baseUrl) console.log(`  Loopback URL  ${report.baseUrl}`);
  console.log(`  Heavy model   ${report.selectedModels.structuredGeneration ?? 'not configured'}`);
  console.log(`  Fast model    ${report.selectedModels.streamingChat ?? 'not configured'}`);
  console.log('\nCapabilities:');
  for (const result of report.capabilities) {
    const marker = result.status === 'passed' ? '✔' : result.status === 'failed' ? '✖' : '–';
    const size = result.outputChars === undefined ? '' : `, ${result.outputChars} chars`;
    console.log(`  ${marker} ${result.capability} [${result.status}] (${result.latencyMs} ms${size})`);
    if (result.error) console.log(`      Error: ${sanitized(result.error)}`);
    if (result.nextStep) console.log(`      Next: ${sanitized(result.nextStep)}`);
  }
  console.log(`\nOverall: ${report.status}`);
  if (report.status !== 'ready') {
    console.error('Local AI is not fully ready. Keep affected actions disabled and use the approved manual-chat path where available.');
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`Local AI preflight could not run: ${errorMessage(error)}`);
  console.error('Check the loopback URL and selected model names, then rerun preflight. No hosted fallback was attempted.');
  process.exitCode = 1;
});
