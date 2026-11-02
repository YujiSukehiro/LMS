/**
 * Browser helpers for the Track Studio REST endpoints (docs/06 §2). Each helper throws an Error with a
 * plain-English message when the request fails.
 */
import {
  ApiErrorBodySchema,
  PatchTrackResponseSchema,
  PublishTrackResponseSchema,
  RegenerateItemResponseSchema,
  UploadTrackResponseSchema,
  type PatchTrackRequest,
  type RegenerateItemRequest,
} from '@/lib/schemas/api';
import {
  EvalRubricsDocSchema,
  SecretSimScenarioConfigSchema,
  type BriefingCard,
  type DrillItem,
  type PublicSimScenario,
  type SecretSimScenarioConfig,
} from '@/lib/schemas/curriculum';
import type { DivisionId } from '@/lib/schemas/domain';
import { PublicationGateReportSchema, type PublicationGateReport } from '@/lib/schemas/source-truth';

export class PublicationGatesError extends Error {
  constructor(
    message: string,
    readonly report: PublicationGateReport,
  ) {
    super(message);
    this.name = 'PublicationGatesError';
  }
}

const STATUS_MESSAGES: Record<number, string> = {
  401: 'Your session expired. Sign in again.',
  403: 'Your account does not have permission to do this.',
  404: 'This Track was not found.',
  413: 'The PDF is too large.',
  429: 'Too many requests. Wait a moment and try again.',
};

async function errorFrom(response: Response, fallback: string): Promise<Error> {
  let message: string | undefined;
  try {
    const body: unknown = await response.json();
    const parsed = ApiErrorBodySchema.safeParse(body);
    if (parsed.success) message = parsed.data.message ?? humanizeCode(parsed.data.error);
  } catch {
    message = undefined;
  }
  return new Error(message ?? STATUS_MESSAGES[response.status] ?? `${fallback} (HTTP ${response.status}).`);
}

function humanizeCode(code: string): string {
  switch (code) {
    case 'UNAUTHENTICATED':
      return STATUS_MESSAGES[401];
    case 'FORBIDDEN':
      return STATUS_MESSAGES[403];
    case 'ACCOUNT_DEACTIVATED':
      return 'Your account is deactivated.';
    case 'VALIDATION_FAILED':
      return 'Some fields are not valid. Check the form and try again.';
    default:
      return code.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  }
}

export async function uploadPlaybook(input: {
  file: File;
  title: string;
  campaignCode: string;
  divisionId: DivisionId;
  /** Set to upload a revised Playbook onto an existing Track (generates a new draft). */
  trackId?: string;
}): Promise<{ trackId: string; pageCount: number }> {
  const form = new FormData();
  form.set('file', input.file);
  form.set('title', input.title);
  form.set('campaignCode', input.campaignCode);
  form.set('divisionId', input.divisionId);
  if (input.trackId) form.set('trackId', input.trackId);
  const response = await fetch('/api/tracks/upload', { method: 'POST', body: form });
  if (!response.ok) throw await errorFrom(response, 'The Playbook upload failed');
  const parsed = UploadTrackResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('The server sent an unexpected upload response.');
  return parsed.data;
}

export async function patchTrackDraft(trackId: string, body: PatchTrackRequest): Promise<number> {
  const response = await fetch(`/api/tracks/${encodeURIComponent(trackId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await errorFrom(response, 'The draft did not save');
  const parsed = PatchTrackResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('The server sent an unexpected save response.');
  return parsed.data.updatedAt;
}

export async function regenerateItem(
  trackId: string,
  body: RegenerateItemRequest,
): Promise<BriefingCard | DrillItem | PublicSimScenario> {
  const response = await fetch(`/api/tracks/${encodeURIComponent(trackId)}/regenerate-item`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await errorFrom(response, 'The item did not regenerate');
  const parsed = RegenerateItemResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('The server sent an unexpected item.');
  return parsed.data.item;
}

export async function publishTrack(trackId: string, assignedCohortIds: string[]): Promise<string> {
  const response = await fetch(`/api/tracks/${encodeURIComponent(trackId)}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignedCohortIds }),
  });
  if (!response.ok) {
    try {
      const body: unknown = await response.clone().json();
      const parsedError = ApiErrorBodySchema.safeParse(body);
      if (parsedError.success && parsedError.data.error === 'PUBLICATION_GATES_FAILED') {
        const details = parsedError.data.details;
        const candidate = details && typeof details === 'object' && 'publicationGate' in details
          ? (details as { publicationGate: unknown }).publicationGate
          : details;
        const report = PublicationGateReportSchema.safeParse(candidate);
        if (report.success) {
          throw new PublicationGatesError(
            parsedError.data.message ?? 'Resolve the Source Review issues before publishing.',
            report.data,
          );
        }
      }
    } catch (error) {
      if (error instanceof PublicationGatesError) throw error;
    }
    throw await errorFrom(response, 'The Track did not publish');
  }
  const parsed = PublishTrackResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('The server sent an unexpected publish response.');
  return parsed.data.publishedVersionId;
}

/** Reads the draft secret Simulation configs from `GET /api/tracks/{trackId}` (internal ops only). */
export async function fetchDraftSecrets(trackId: string): Promise<SecretSimScenarioConfig[] | null> {
  const response = await fetch(`/api/tracks/${encodeURIComponent(trackId)}`, { cache: 'no-store' });
  if (!response.ok) return null;
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !('secrets' in body)) return null;
  const secrets = (body as { secrets: unknown }).secrets;
  const asDoc = EvalRubricsDocSchema.safeParse(secrets);
  if (asDoc.success) return asDoc.data.scenarios;
  const asList = SecretSimScenarioConfigSchema.array().safeParse(secrets);
  return asList.success ? asList.data : null;
}
