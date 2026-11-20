/**
 * Live Call Sim view of AI availability: refuse to start or continue a call when the AI caller cannot
 * run, and turn provider "unavailable" failures into one plain-English 503 for learners.
 * Server only.
 */
import { getCachedAiAvailability, noteAiUnavailable } from '@/lib/ai/availability';
import { isAIUnavailableError } from '@/lib/ai/types';
import { ServiceError } from './errors';

export const SIM_AI_UNAVAILABLE_CODE = 'AI_UNAVAILABLE';
export const SIM_AI_UNAVAILABLE_MESSAGE =
  'The AI caller is not available right now. Nothing was counted against your daily limit. Try again in a minute, or ask a Trainer to check the AI runtime.';
export const SIM_AI_UNAVAILABLE_MID_CALL_MESSAGE =
  'The AI caller is not available right now. Your call so far is saved. Wait a minute, then send your message again.';

export function simAiUnavailableError(message: string = SIM_AI_UNAVAILABLE_MESSAGE): ServiceError {
  return new ServiceError(503, SIM_AI_UNAVAILABLE_CODE, message);
}

/** Throw 503 AI_UNAVAILABLE when the provider is manual_chat/invalid or the cached health check is blocked. */
export function assertSimAiAvailable(): void {
  const availability = getCachedAiAvailability();
  if (availability.status === 'blocked') {
    console.warn(`[simulations] AI unavailable (${availability.provider}): ${availability.message}`);
    throw simAiUnavailableError();
  }
}

const CONNECTION_FAILURE = /ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|UND_ERR_CONNECT|fetch failed|socket hang up|network error/i;

function errorChainText(error: unknown, depth = 0): string {
  if (!error || depth > 3) return '';
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return `${error.name} ${error.message} ${typeof code === 'string' ? code : ''} ${errorChainText((error as { cause?: unknown }).cause, depth + 1)}`;
  }
  return typeof error === 'string' ? error : '';
}

/** True for AIUnavailableError and raw connection failures to the model runtime. */
export function isSimAiUnavailable(error: unknown): boolean {
  if (isAIUnavailableError(error)) return true;
  if (error instanceof ServiceError) return error.code === SIM_AI_UNAVAILABLE_CODE;
  return CONNECTION_FAILURE.test(errorChainText(error));
}

/** Map an AI failure to the learner-facing 503 (and record it in the availability cache); null when not an availability failure. */
export function toSimAiUnavailable(error: unknown, message?: string): ServiceError | null {
  if (!isSimAiUnavailable(error)) return null;
  if (error instanceof ServiceError) return error;
  noteAiUnavailable(error);
  return simAiUnavailableError(message);
}
