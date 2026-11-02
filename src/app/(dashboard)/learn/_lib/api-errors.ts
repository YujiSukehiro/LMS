import { ApiErrorBodySchema } from '@/lib/schemas/api';

type ApiContext = 'progress' | 'simulation' | 'evaluation';

export interface ApiFailure {
  status: number;
  /** Machine code from the ApiErrorBody, when the server sent one. */
  code: string | null;
  /** Plain-English message for the learner. */
  message: string;
}

function fallbackMessage(status: number, context: ApiContext): string {
  switch (status) {
    case 403:
      return 'You do not have access to this Track.';
    case 404:
      return 'We could not find this item. It may have been replaced by a newer Track version.';
    case 409:
      return 'This action is not available right now. Go back to the Track Map and try again.';
    case 429:
      return "You reached today's Live Call Sim limit. You can start a new Simulation tomorrow (UTC).";
    default:
      break;
  }
  if (status >= 500) {
    if (context === 'progress') return 'The server could not save your progress. Try again in a moment.';
    if (context === 'evaluation') return 'The AI coach could not grade your call. Try again in a moment.';
    return 'The Live Call Sim service is not responding. Try again in a moment.';
  }
  return `The request failed (status ${status}). Try again.`;
}

/** Reads the error code and a plain-English message from a failed API response. */
export async function readApiFailure(response: Response, context: ApiContext): Promise<ApiFailure> {
  let serverMessage: string | undefined;
  let code: string | null = null;
  try {
    const parsed = ApiErrorBodySchema.safeParse(await response.json());
    if (parsed.success) {
      serverMessage = parsed.data.message;
      code = parsed.data.error;
    }
  } catch {
    // The body was not JSON: use the status-based message.
  }

  if (response.status === 401) {
    return { status: 401, code, message: 'Your session has expired. Sign in again, then come back to this page.' };
  }
  if (response.status === 403 && code === 'ACCOUNT_DEACTIVATED') {
    return { status: 403, code, message: 'Your account is deactivated. Contact your supervisor.' };
  }
  return { status: response.status, code, message: serverMessage ?? fallbackMessage(response.status, context) };
}

/** Plain-English message for a failed API response. */
export async function describeApiError(response: Response, context: ApiContext): Promise<string> {
  return (await readApiFailure(response, context)).message;
}

/** Message for network failures (fetch threw). */
export function describeNetworkError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'The request was cancelled.';
  return 'We could not reach the server. Check your connection and try again.';
}
