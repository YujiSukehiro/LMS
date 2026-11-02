import { describe, expect, it } from 'vitest';
import {
  assertDesignatedSyntheticToken,
  assertSensitiveDataSafe,
  redactSensitiveData,
  scanSensitiveData,
  SensitiveDataError,
} from '@/lib/security/synthetic-data';

// All values below are published test patterns or fabricated strings, never real records.
const TEST_CARD = '4111 1111 1111 1111';
const TEST_IDENTITY = '123-45-6789';
const TEST_SECRET = 'sk-test-abcdefghijklmnop';

describe('sensitive-data detection', () => {
  it('rejects card-number-like, identity-document-like, and real-looking credential patterns', () => {
    const findings = scanSensitiveData({
      paymentNote: `Synthetic test pattern ${TEST_CARD}`,
      identityNote: `Synthetic test pattern ${TEST_IDENTITY}`,
      credential: TEST_SECRET,
    });

    expect(findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(['card_number', 'identity_document', 'credential']),
    );
    expect(JSON.stringify(findings)).not.toContain(TEST_CARD);
    expect(JSON.stringify(findings)).not.toContain(TEST_IDENTITY);
    expect(JSON.stringify(findings)).not.toContain(TEST_SECRET);
  });

  it('detects labelled identity documents, bearer tokens, and private-key blocks', () => {
    const findings = scanSensitiveData([
      'passport number: X12345678',
      'Authorization: Bearer abcdefghijklmnop',
      '-----BEGIN PRIVATE KEY-----\nfabricated-test-body\n-----END PRIVATE KEY-----',
    ]);

    expect(findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(['identity_document', 'bearer_token', 'private_key']),
    );
  });

  it('does not mistake an explicit synthetic marker for permission', () => {
    expect(scanSensitiveData({ synthetic: true, value: TEST_CARD })).toHaveLength(1);
  });
});

describe('redaction and explicit synthetic fixtures', () => {
  it('redacts sensitive values recursively without including them in thrown errors', () => {
    const input = { note: `card ${TEST_CARD}`, nested: [{ credential: `api_key=${TEST_SECRET}` }] };
    const redacted = redactSensitiveData(input);

    expect(JSON.stringify(redacted)).not.toContain(TEST_CARD);
    expect(JSON.stringify(redacted)).not.toContain(TEST_SECRET);
    expect(JSON.stringify(redacted)).toContain('[REDACTED_CARD_NUMBER]');
    expect(JSON.stringify(redacted)).toContain('[REDACTED_CREDENTIAL]');

    let thrown: unknown;
    try {
      assertSensitiveDataSafe(input);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SensitiveDataError);
    expect(String(thrown)).not.toContain(TEST_CARD);
    expect(String(thrown)).not.toContain(TEST_SECRET);
  });

  it('permits an exact explicitly designated synthetic fixture', () => {
    const policy = { allowedSyntheticValues: [TEST_CARD, TEST_SECRET] };
    expect(scanSensitiveData({ card: TEST_CARD, token: TEST_SECRET }, policy)).toEqual([]);
    expect(redactSensitiveData(TEST_CARD, policy)).toBe(TEST_CARD);
  });

  it('does not let an allowlisted fixture whitelist surrounding sensitive content', () => {
    const policy = { allowedSyntheticValues: [TEST_CARD] };
    expect(scanSensitiveData(`card ${TEST_CARD} and token ${TEST_SECRET}`, policy)).toEqual([
      { kind: 'credential', path: '$' },
    ]);
  });

  it('keeps fake tokens blocked unless they are explicitly designated', () => {
    expect(scanSensitiveData(TEST_SECRET)).toHaveLength(1);
    expect(scanSensitiveData(TEST_SECRET, { allowedSyntheticValues: [TEST_SECRET] })).toEqual([]);

    const fakeToken = 'fake_payment_token_standard_meds';
    expect(() => assertDesignatedSyntheticToken(fakeToken)).toThrow(SensitiveDataError);
    expect(() => assertDesignatedSyntheticToken(fakeToken, { allowedSyntheticValues: [fakeToken] })).not.toThrow();
  });
});
