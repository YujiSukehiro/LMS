import { describe, expect, it } from 'vitest';
import { csvEscape } from '@/components/progress/csv-escape';

describe('csvEscape (team progress export)', () => {
  it('leaves ordinary text and numbers alone', () => {
    expect(csvEscape('Dana Reyes')).toBe('Dana Reyes');
    expect(csvEscape('3/5')).toBe('3/5');
    expect(csvEscape('87')).toBe('87');
    expect(csvEscape('')).toBe('');
  });

  it.each([
    ['=HYPERLINK("http://evil.example","Click")', `"'=HYPERLINK(""http://evil.example"",""Click"")"`],
    ['+1+1', "'+1+1"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1:A2)', "'@SUM(A1:A2)"],
    ['\t=1+1', "'\t=1+1"],
    ['\r=1+1', `"'\r=1+1"`],
  ])('neutralises a formula-looking cell %j', (input, expected) => {
    expect(csvEscape(input)).toBe(expected);
  });

  it('only treats a leading trigger character as a formula', () => {
    expect(csvEscape('Ana-Maria = lead')).toBe('Ana-Maria = lead');
  });

  it('still quotes commas, quotes and newlines', () => {
    expect(csvEscape('Reyes, Dana')).toBe('"Reyes, Dana"');
    expect(csvEscape('Dana "DR" Reyes')).toBe('"Dana ""DR"" Reyes"');
    expect(csvEscape('line one\nline two')).toBe('"line one\nline two"');
  });
});
