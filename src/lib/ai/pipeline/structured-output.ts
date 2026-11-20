/**
 * Shared helpers for LLMGateway structured output: JSON Schema conversion, fence stripping,
 * parse + validate, and the self-repair message that lists the exact Zod issues.
 * Pure module (no network, no Firebase) so unit tests can import it. Also hosts the provider-neutral repair loop.
 */
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  DEFAULT_STRUCTURED_MAX_OUTPUT_TOKENS,
  LLMOutputTruncatedError,
  LLMStructuredOutputError,
  MAX_STRUCTURED_MAX_OUTPUT_TOKENS,
} from '@/lib/ai/types';

/** Maximum self-repair retries after the first attempt (3 attempts in total). */
export const MAX_STRUCTURED_REPAIR_RETRIES = 2;

/** Convert a Zod schema to an inline draft-7 JSON Schema (no `$ref`, no top-level `$schema`). */
export function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const json = zodToJsonSchema(schema, { target: 'jsonSchema7', $refStrategy: 'none' }) as Record<string, unknown>;
  const rest: Record<string, unknown> = { ...json };
  delete rest.$schema;
  return rest;
}

const REASONING_BLOCK = /<(think|thinking|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const FENCED_BLOCK = /```[^\n`]*\n?([\s\S]*?)```/g;

/** Remove `<think>…</think>` / `<thinking>…</thinking>` reasoning blocks that some local models emit before the answer. */
export function stripReasoningBlocks(raw: string): string {
  let text = raw.replace(REASONING_BLOCK, ' ');
  // An unterminated reasoning block followed by a closing tag only (e.g. "...reasoning</think>{...}").
  const danglingClose = /<\/(think|thinking|reasoning)\s*>/i.exec(text);
  if (danglingClose) text = text.slice(danglingClose.index + danglingClose[0].length);
  return text;
}

/**
 * Return the end index (inclusive) of the JSON object/array that starts at `start`, honouring strings and
 * escapes, or -1 when the value never closes (for example, truncated output).
 */
export function findBalancedJsonEnd(text: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if (char === '}' || char === ']') {
      if (stack.pop() !== char) return -1;
      if (stack.length === 0) return index;
    }
  }
  return -1;
}

function jsonStartIndexes(text: string): number[] {
  const starts: number[] = [];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '{' || text[index] === '[') starts.push(index);
  }
  return starts;
}

/**
 * The best top-level JSON span. Spans are scanned left to right without re-entering one already found, so a
 * parseable outer value always hides its own inner arrays and objects. A span of the schema's root type (when
 * known) beats one of the other type; among those, the longest wins, so prose such as "PAGE [3]" before the
 * answer never shadows the real object.
 */
function bestParseableSpan(text: string, preferRoot?: 'object' | 'array'): string | null {
  let best: string | null = null;
  let cursor = 0;
  for (const start of jsonStartIndexes(text)) {
    if (start < cursor) continue;
    const end = findBalancedJsonEnd(text, start);
    if (end === -1) continue;
    const span = text.slice(start, end + 1);
    try {
      JSON.parse(span);
    } catch {
      // Prose such as "{the result}" before the real JSON; try the next opening bracket.
      continue;
    }
    cursor = end + 1;
    const rank = (candidate: string) => (preferRoot && (preferRoot === 'array') === candidate.startsWith('[') ? 1 : 0);
    if (!best || rank(span) > rank(best) || (rank(span) === rank(best) && span.length > best.length)) best = span;
  }
  return best;
}

/**
 * Extract the JSON value from raw model text: drop reasoning blocks, prefer fenced-block content, then take the
 * first balanced `{…}` / `[…]` span that parses (ignoring prose or a second JSON value after it). When nothing
 * parses, the text from the first opening bracket is returned so the parse error stays informative.
 */
export function extractJsonCandidate(raw: string, preferRoot?: 'object' | 'array'): string {
  const text = stripReasoningBlocks(raw).trim();
  const fencedBodies = [...text.matchAll(FENCED_BLOCK)].map((match) => match[1].trim()).filter(Boolean);
  for (const body of fencedBodies) {
    const span = bestParseableSpan(body, preferRoot);
    if (span) return span;
  }
  const span = bestParseableSpan(text, preferRoot);
  if (span) return span;
  const preferred = fencedBodies.find((body) => /[[{]/.test(body)) ?? text;
  const first = preferred.search(/[[{]/);
  return first === -1 ? preferred : preferred.slice(first);
}

const rootTypeCache = new WeakMap<z.ZodTypeAny, 'object' | 'array' | undefined>();

/** "object" or "array" when the schema's JSON root type is one of those (cached per schema). */
function schemaRootType(schema: z.ZodTypeAny): 'object' | 'array' | undefined {
  if (rootTypeCache.has(schema)) return rootTypeCache.get(schema);
  let root: 'object' | 'array' | undefined;
  try {
    const type = toJsonSchema(schema).type;
    root = type === 'object' || type === 'array' ? type : undefined;
  } catch {
    root = undefined;
  }
  rootTypeCache.set(schema, root);
  return root;
}

/** @deprecated Kept for existing callers; use `extractJsonCandidate`. */
export function stripMarkdownFences(raw: string): string {
  return extractJsonCandidate(raw);
}

export type StructuredParseResult<T> = { ok: true; data: T } | { ok: false; problem: string };

/** Format Zod issues as "path: message" lines for the repair turn. */
export function formatZodIssues(issues: readonly z.ZodIssue[]): string {
  return issues
    .slice(0, 25)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `- ${path}: ${issue.message}`;
    })
    .join('\n');
}

/** Parse raw model text and validate it with the schema. */
export function parseStructuredOutput<T extends z.ZodTypeAny>(raw: string, schema: T): StructuredParseResult<z.infer<T>> {
  const cleaned = extractJsonCandidate(raw, schemaRootType(schema));
  let value: unknown;
  try {
    value = JSON.parse(cleaned);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown parse error';
    return { ok: false, problem: `The output is not valid JSON (${reason}). Return one complete JSON object only.` };
  }
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data as z.infer<T> };
  return { ok: false, problem: `The JSON does not match the required schema:\n${formatZodIssues(result.error.issues)}` };
}

/** Keep at most this many characters of a rejected answer in the repair conversation. */
export const REPAIR_FULL_OUTPUT_MAX_CHARS = 4_000;
const REPAIR_TAIL_CHARS = 400;

/**
 * The user turn that asks the model to repair its previous output. When the previous output is long, only a short
 * tail is quoted (pass `previousRaw`) so repair turns do not double the context with a huge rejected answer.
 */
export function buildRepairMessage(schemaName: string, problem: string, previousRaw?: string): string {
  const lines = [`Your previous answer for "${schemaName}" was rejected.`, problem];
  if (previousRaw !== undefined && previousRaw.length > REPAIR_FULL_OUTPUT_MAX_CHARS) {
    lines.push(
      `Your previous answer was ${previousRaw.length} characters long. It ended with:`,
      previousRaw.slice(-REPAIR_TAIL_CHARS),
    );
  }
  lines.push(
    'Correct every listed problem. Keep all content grounded in the SOURCE PAGES.',
    'Return the complete corrected JSON object only. Do not add markdown fences or comments.',
  );
  return lines.join('\n');
}

export interface StructuredTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Resolve the output budget for a structured call: explicit value, else the safe default. */
export function resolveStructuredMaxOutputTokens(maxOutputTokens: number | undefined): number {
  return maxOutputTokens !== undefined && Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
    ? Math.floor(maxOutputTokens)
    : DEFAULT_STRUCTURED_MAX_OUTPUT_TOKENS;
}

export interface StructuredAttemptOutput {
  raw: string;
  /** True when the provider reported that generation stopped at the output-token limit. */
  truncated: boolean;
}

export interface StructuredRepairLoopOptions<T extends z.ZodTypeAny> {
  model: string;
  schema: T;
  schemaName: string;
  /** Initial system + user turns. They are never mutated. */
  baseMessages: StructuredTurn[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
  maxRepairRetries?: number;
  /** One provider request. */
  call: (messages: StructuredTurn[], maxOutputTokens: number) => Promise<StructuredAttemptOutput>;
}

function throwIfAborted(signal: AbortSignal | undefined, model: string): void {
  if (signal?.aborted) throw new Error(`Structured generation for model "${model}" was cancelled.`);
}

/**
 * Shared provider loop: validate with Zod, self-repair up to `maxRepairRetries` times, and treat truncation
 * separately (one retry with a doubled budget capped at MAX_STRUCTURED_MAX_OUTPUT_TOKENS, then
 * LLMOutputTruncatedError; truncated output is never sent through schema repair).
 */
export async function runStructuredRepairLoop<T extends z.ZodTypeAny>(opts: StructuredRepairLoopOptions<T>): Promise<z.infer<T>> {
  const maxAttempts = (opts.maxRepairRetries ?? MAX_STRUCTURED_REPAIR_RETRIES) + 1;
  let maxOutputTokens = resolveStructuredMaxOutputTokens(opts.maxOutputTokens);
  let truncationRetried = false;
  let messages = [...opts.baseMessages];
  let attempts = 0;
  let lastRaw = '';
  let lastProblem = '';

  while (attempts < maxAttempts) {
    throwIfAborted(opts.signal, opts.model);
    const output = await opts.call(messages, maxOutputTokens);
    lastRaw = output.raw;

    if (output.truncated) {
      if (!truncationRetried && maxOutputTokens < MAX_STRUCTURED_MAX_OUTPUT_TOKENS) {
        truncationRetried = true;
        maxOutputTokens = Math.min(maxOutputTokens * 2, MAX_STRUCTURED_MAX_OUTPUT_TOKENS);
        continue;
      }
      throw new LLMOutputTruncatedError(
        `Model "${opts.model}" stopped at the ${maxOutputTokens}-token output limit before finishing "${opts.schemaName}" ` +
          `(${output.raw.length} characters received). Raise the output limit (maxOutputTokens for this task, and ` +
          `MLX_MAX_TOKENS / the server's max-tokens setting for a local runtime) or split the stage into smaller parts.`,
        maxOutputTokens,
        output.raw.length,
        opts.schemaName,
      );
    }

    attempts += 1;
    const parsed = parseStructuredOutput(output.raw, opts.schema);
    if (parsed.ok) return parsed.data;
    lastProblem = parsed.problem;

    if (attempts < maxAttempts) {
      // Only the latest rejected answer is kept, so repairs do not grow the context without bound.
      messages = [...opts.baseMessages];
      if (output.raw.length <= REPAIR_FULL_OUTPUT_MAX_CHARS) messages.push({ role: 'assistant', content: output.raw });
      messages.push({ role: 'user', content: buildRepairMessage(opts.schemaName, parsed.problem, output.raw) });
    }
  }

  throw new LLMStructuredOutputError(
    `Model "${opts.model}" did not return valid "${opts.schemaName}" JSON after ${maxAttempts} attempts. ${lastProblem}`,
    opts.schemaName,
    maxAttempts,
    lastRaw,
  );
}

const GEMINI_SCHEMA_KEYS = new Set([
  '$id',
  '$defs',
  '$ref',
  '$anchor',
  'type',
  'format',
  'title',
  'description',
  'enum',
  'items',
  'prefixItems',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'anyOf',
  'oneOf',
  'properties',
  'additionalProperties',
  'required',
  'propertyOrdering',
]);

/**
 * Keep only the JSON Schema keywords that Gemini `responseJsonSchema` supports.
 * `const` becomes a one-value `enum`. Length limits are enforced by Zod validation instead.
 */
export function toGeminiJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map((entry) => toGeminiJsonSchema(entry));
  if (schema === null || typeof schema !== 'object') return schema;
  const source = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === 'const') {
      out.enum = [value];
      continue;
    }
    if (!GEMINI_SCHEMA_KEYS.has(key)) continue;
    if ((key === 'properties' || key === '$defs') && value && typeof value === 'object' && !Array.isArray(value)) {
      const props: Record<string, unknown> = {};
      for (const [name, sub] of Object.entries(value as Record<string, unknown>)) props[name] = toGeminiJsonSchema(sub);
      out[key] = props;
      continue;
    }
    if (key === 'additionalProperties' && typeof value === 'boolean') {
      out[key] = value;
      continue;
    }
    out[key] = toGeminiJsonSchema(value);
  }
  if (out.type === 'object' && out.properties && !out.propertyOrdering) {
    out.propertyOrdering = Object.keys(out.properties as Record<string, unknown>);
  }
  return out;
}
