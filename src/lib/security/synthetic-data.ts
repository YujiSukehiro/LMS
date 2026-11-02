export type SensitiveDataKind =
  | 'card_number'
  | 'identity_document'
  | 'credential'
  | 'private_key'
  | 'bearer_token';

export interface SensitiveDataFinding {
  kind: SensitiveDataKind;
  path: string;
}

export interface SyntheticDataPolicy {
  /**
   * Exact, explicitly designated synthetic values only. A matching substring or a
   * `synthetic: true` property does not bypass detection.
   */
  allowedSyntheticValues?: readonly string[];
}

const CARD_NUMBER = /(?<!\d)(?:\d[ -]*){13,19}(?!\d)/g;
const FORMATTED_IDENTITY = /\b(?:\d{3}-\d{2}-\d{4}|[A-Z][0-9]{7,8})\b/gi;
const LABELLED_IDENTITY =
  /\b(?:passport|national\s+id|identity\s+document|driver'?s\s+licen[cs]e|social\s+security|ssn)\b\s*(?:number|no\.?|#|:|=)?\s*["']?([A-Z0-9-]{6,20})/gi;
const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g;
const PREFIXED_CREDENTIAL =
  /\b(?:sk-(?:live-|test-)?[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[A-Z0-9]{16})\b/g;
const LABELLED_CREDENTIAL =
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|authorization)\b\s*[:=]\s*["']?([A-Za-z0-9_./+=:-]{12,})/gi;

const REDACTIONS: Record<SensitiveDataKind, string> = {
  card_number: '[REDACTED_CARD_NUMBER]',
  identity_document: '[REDACTED_IDENTITY_DOCUMENT]',
  credential: '[REDACTED_CREDENTIAL]',
  private_key: '[REDACTED_PRIVATE_KEY]',
  bearer_token: '[REDACTED_BEARER_TOKEN]',
};

function allowed(match: string, captured: string | undefined, policy: SyntheticDataPolicy): boolean {
  const allowedValues = policy.allowedSyntheticValues ?? [];
  // Some delimiter-tolerant patterns capture a trailing separator; trim only that
  // regex artifact, never arbitrary content around the designated fixture.
  const candidate = match.trim();
  return allowedValues.includes(candidate) || (captured !== undefined && allowedValues.includes(captured));
}

function collectStringFindings(value: string, path: string, policy: SyntheticDataPolicy): SensitiveDataFinding[] {
  const findings: SensitiveDataFinding[] = [];
  const patterns: Array<[SensitiveDataKind, RegExp]> = [
    ['private_key', PRIVATE_KEY],
    ['bearer_token', BEARER_TOKEN],
    ['credential', PREFIXED_CREDENTIAL],
    ['credential', LABELLED_CREDENTIAL],
    ['identity_document', FORMATTED_IDENTITY],
    ['identity_document', LABELLED_IDENTITY],
    ['card_number', CARD_NUMBER],
  ];

  for (const [kind, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      if (!allowed(match[0], match[1], policy)) {
        findings.push({ kind, path });
        break;
      }
    }
  }
  return findings;
}

/** Return locations and categories only; matched sensitive values are never retained. */
export function scanSensitiveData(value: unknown, policy: SyntheticDataPolicy = {}): SensitiveDataFinding[] {
  const findings: SensitiveDataFinding[] = [];
  const visited = new WeakSet<object>();

  function visit(current: unknown, path: string): void {
    if (typeof current === 'string') {
      findings.push(...collectStringFindings(current, path, policy));
      return;
    }
    if (!current || typeof current !== 'object') return;
    if (visited.has(current)) {
      findings.push({ kind: 'credential', path: `${path} (cyclic value cannot be exported safely)` });
      return;
    }
    visited.add(current);
    if (Array.isArray(current)) current.forEach((entry, index) => visit(entry, `${path}[${index}]`));
    else for (const [key, entry] of Object.entries(current)) visit(entry, path ? `${path}.${key}` : key);
  }

  visit(value, '$');
  return findings;
}

function redactString(input: string, policy: SyntheticDataPolicy): string {
  let output = input;
  const replace = (pattern: RegExp, kind: SensitiveDataKind): void => {
    pattern.lastIndex = 0;
    output = output.replace(pattern, (...args: unknown[]) => {
      const match = String(args[0]);
      const captured = typeof args[1] === 'string' ? args[1] : undefined;
      return allowed(match, captured, policy) ? match : REDACTIONS[kind];
    });
  };

  replace(PRIVATE_KEY, 'private_key');
  replace(BEARER_TOKEN, 'bearer_token');
  replace(PREFIXED_CREDENTIAL, 'credential');
  replace(LABELLED_CREDENTIAL, 'credential');
  replace(FORMATTED_IDENTITY, 'identity_document');
  replace(LABELLED_IDENTITY, 'identity_document');
  replace(CARD_NUMBER, 'card_number');
  return output;
}

/** Recursively redact strings for logs or other display-only output. */
export function redactSensitiveData<T>(value: T, policy: SyntheticDataPolicy = {}): T {
  const visited = new WeakMap<object, unknown>();

  function visit(current: unknown): unknown {
    if (typeof current === 'string') return redactString(current, policy);
    if (!current || typeof current !== 'object') return current;
    if (visited.has(current)) return '[REDACTED_CYCLIC_VALUE]';
    if (Array.isArray(current)) {
      const result: unknown[] = [];
      visited.set(current, result);
      for (const entry of current) result.push(visit(entry));
      return result;
    }
    const result: Record<string, unknown> = {};
    visited.set(current, result);
    for (const [key, entry] of Object.entries(current)) result[key] = visit(entry);
    return result;
  }

  return visit(value) as T;
}

export class SensitiveDataError extends Error {
  constructor(public readonly findings: SensitiveDataFinding[]) {
    super(`Sensitive data is not permitted (${findings.map((finding) => `${finding.kind} at ${finding.path}`).join('; ')}).`);
    this.name = 'SensitiveDataError';
  }
}

/** Fail closed before exports, prompt construction, or log persistence. */
export function assertSensitiveDataSafe(value: unknown, policy: SyntheticDataPolicy = {}): void {
  const findings = scanSensitiveData(value, policy);
  if (findings.length > 0) throw new SensitiveDataError(findings);
}

/** Token-bearing workflows must explicitly designate every synthetic/fake token. */
export function assertDesignatedSyntheticToken(token: string, policy: SyntheticDataPolicy = {}): void {
  if (!policy.allowedSyntheticValues?.includes(token)) {
    throw new SensitiveDataError([{ kind: 'credential', path: '$ (not an explicitly designated synthetic token)' }]);
  }
}
