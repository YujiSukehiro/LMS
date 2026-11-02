/**
 * Shared helpers for the progress and Simulation route handlers (server only).
 */
import type { NextResponse } from 'next/server';
import type { z } from 'zod';
import { jsonError } from '@/lib/firebase/auth-guard';
import { LLMStructuredOutputError } from '@/lib/ai/types';
import { isServiceError } from './errors';

/** Read and validate a JSON body. Returns the data or a 400 response. */
export async function parseJsonBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: jsonError(400, 'INVALID_JSON', 'The request body is not valid JSON.') };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? ` (${first.path.join('.')})` : '';
    return {
      ok: false,
      response: jsonError(400, 'VALIDATION_FAILED', `The request is not valid${where}: ${first?.message ?? 'unknown error'}.`),
    };
  }
  return { ok: true, data: parsed.data };
}

/** Convert an unknown error to a plain-English JSON error response. */
export function errorResponse(error: unknown, context: string): NextResponse {
  if (isServiceError(error)) return jsonError(error.status, error.code, error.message);
  if (error instanceof LLMStructuredOutputError) {
    console.error(`[${context}] AI output failed validation after ${error.attempts} attempts`, error.message);
    return jsonError(502, 'AI_OUTPUT_INVALID', 'The AI coach did not return a valid result. Try again.');
  }
  console.error(`[${context}]`, error);
  return jsonError(500, 'INTERNAL_ERROR', 'Something went wrong on the server. Try again.');
}

/** Start of the current UTC day in epoch ms. */
export function startOfUtcDay(nowMs: number = Date.now()): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
