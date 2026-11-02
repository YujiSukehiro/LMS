/**
 * Shared helpers for LLMGateway structured output: JSON Schema conversion, fence stripping,
 * parse + validate, and the self-repair message that lists the exact Zod issues.
 * Pure module (no network, no Firebase) so unit tests can import it.
 */
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/** Maximum self-repair retries after the first attempt (3 attempts in total). */
export const MAX_STRUCTURED_REPAIR_RETRIES = 2;

/** Convert a Zod schema to an inline draft-7 JSON Schema (no `$ref`, no top-level `$schema`). */
export function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const json = zodToJsonSchema(schema, { target: 'jsonSchema7', $refStrategy: 'none' }) as Record<string, unknown>;
  const rest: Record<string, unknown> = { ...json };
  delete rest.$schema;
  return rest;
}

/** Remove accidental markdown code fences and any prose around the JSON value. */
export function stripMarkdownFences(raw: string): string {
  let text = raw.trim();
  const fenced = /^```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?```\s*$/.exec(text);
  if (fenced) text = fenced[1].trim();
  if (!text.startsWith('{') && !text.startsWith('[')) {
    const firstObject = text.indexOf('{');
    const lastObject = text.lastIndexOf('}');
    if (firstObject !== -1 && lastObject > firstObject) text = text.slice(firstObject, lastObject + 1);
  }
  return text;
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
  const cleaned = stripMarkdownFences(raw);
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

/** The user turn that asks the model to repair its previous output. */
export function buildRepairMessage(schemaName: string, problem: string): string {
  return [
    `Your previous answer for "${schemaName}" was rejected.`,
    problem,
    'Correct every listed problem. Keep all content grounded in the SOURCE PAGES.',
    'Return the complete corrected JSON object only. Do not add markdown fences or comments.',
  ].join('\n');
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
