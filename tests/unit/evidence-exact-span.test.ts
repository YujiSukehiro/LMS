import { describe, expect, it } from 'vitest';
import { findExactSourceSpan } from '@/lib/ai/prompts/evidence';

/** The matcher folds only for matching; the result must always be an exact substring of the source. */
function expectExact(source: string, quote: string, expected: string) {
  const span = findExactSourceSpan(source, quote);
  expect(span).toBe(expected);
  expect(source.includes(span!)).toBe(true);
}

describe('findExactSourceSpan', () => {
  it('returns the exact source text when the quote is already exact', () => {
    const source = 'Intro. Always verify the order number before discussing a refund. Outro.';
    expectExact(source, 'Always verify the order number before discussing a refund.', 'Always verify the order number before discussing a refund.');
  });

  it('matches curly quotes and apostrophes against straight ones (both directions)', () => {
    const curly = 'Say “I’m sorry to hear that” before you offer the refund.';
    expectExact(curly, 'Say "I\'m sorry to hear that" before you offer the refund.', curly);
    const straight = 'Never say "we don\'t refund" to a medical complaint.';
    expectExact(straight, 'Never say “we don’t refund” to a medical complaint.', straight);
  });

  it('matches single-quoted model copies of double-quoted source text (7B JSON habit)', () => {
    const source = 'Rule 1 — Your single goal on every call is a verbal "yes, send me the\nlink." Once you have it, send and end.';
    const span = findExactSourceSpan(source, "Your single goal on every call is a verbal 'yes, send me the link.' Once you have it, send and end.");
    expect(span).toBe('Your single goal on every call is a verbal "yes, send me the\nlink." Once you have it, send and end.');
    const optOut = 'Stop on opt-out. "Stop calling," "not interested," "don\'t contact me again" — acknowledge, end the\ncall.';
    expect(findExactSourceSpan(optOut, "Stop on opt-out. 'Stop calling,' 'not interested,' 'don't contact me again' — acknowledge, end the call.")).toBe(optOut);
  });

  it('matches a word the PDF hyphenated across a line break, and dash spacing', () => {
    const source = 'Anchor the recommended bundle proactively: "the 3-\nmonth is what most patients go with — $297, about $99 a month."';
    expect(findExactSourceSpan(source, 'the 3-month is what most patients go with - $297, about $99 a month.'))
      .toBe('the 3-\nmonth is what most patients go with — $297, about $99 a month.');
    expect(findExactSourceSpan('Pick one—\nwas there a question?', 'Pick one — was there a question?')).toBe('Pick one—\nwas there a question?');
  });

  it('falls back to a fragment between flow arrows when the model paraphrases around them', () => {
    const source = 'The natural lead flow\nAdvertorial (VSL) ↓ Quiz ← contact info captured here, on the last question ↓ Dosage page';
    expect(findExactSourceSpan(source, 'The natural lead flow is Advertorial (VSL) ↓ Quiz ← contact info captured here, on the last question ↓ Dosage page ← patient picks a plan.'))
      .toBe('contact info captured here, on the last question');
  });

  it('matches en dashes, em dashes and minus signs against hyphens', () => {
    const source = 'Call only 09:00–21:00 in the lead’s local timezone — no exceptions.';
    expectExact(source, "Call only 09:00-21:00 in the lead's local timezone - no exceptions.", source);
  });

  it('ignores case differences but returns the source casing', () => {
    const source = 'ESCALATE every chargeback threat to a Supervisor.';
    expectExact(source, 'escalate every chargeback threat to a supervisor.', source);
  });

  it('collapses whitespace and line breaks', () => {
    const source = 'Offer the 70%\n   medical refund\tbefore any\n\nsave offer.';
    expectExact(source, 'Offer the 70% medical refund before any save offer.', source);
  });

  it('drops bullet glyphs and markdown emphasis the model adds or omits', () => {
    const source = '• Confirm the zip code\n• Confirm the order number';
    expect(findExactSourceSpan(source, 'Confirm the zip code Confirm the order number')).toBe('Confirm the zip code\n• Confirm the order number');
    expectExact('Do not read card numbers aloud.', '**Do not** read card numbers _aloud_.', 'Do not read card numbers aloud.');
  });

  it('strips wrapping quotes and ellipses from the model quote', () => {
    const source = 'Before checkout, confirm the shipping address with the patient.';
    expectExact(source, '"…confirm the shipping address with the patient."', 'confirm the shipping address with the patient.');
  });

  it('falls back to the longest matching sentence fragment of a spliced quote', () => {
    const source = 'Agents must confirm the patient date of birth on every call. Pricing is set by the pharmacy.';
    expect(findExactSourceSpan(source, 'Agents must confirm the patient date of birth on every call. They may also waive shipping.'))
      .toBe('Agents must confirm the patient date of birth on every call');
  });

  it('returns null when the passage is not on the page', () => {
    const source = 'Agents must confirm the patient date of birth on every call.';
    expect(findExactSourceSpan(source, 'Agents may waive the shipping fee for loyal customers.')).toBeNull();
    // Fragments shorter than the minimum never count as a match.
    expect(findExactSourceSpan(source, 'every call. Waive all fees.')).toBeNull();
  });

  it('returns null for an empty or quote-only proposal', () => {
    expect(findExactSourceSpan('Some page text.', '')).toBeNull();
    expect(findExactSourceSpan('Some page text.', '  ""  ')).toBeNull();
  });
});
