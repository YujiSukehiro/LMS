import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Text-color tokens must stay readable (WCAG AA, 4.5:1) on every surface of each theme.
 * --pulse-indigo is a fill color (white text on it); as text, dark mode uses --pulse-indigo-text.
 */
const css = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No ${selector} block in globals.css`);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((match) => [match[1], match[2]]));
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_TOKENS = [
  '--pulse-text-primary', '--pulse-text-secondary', '--pulse-text-muted',
  '--pulse-indigo-text', '--pulse-emerald', '--pulse-amber', '--pulse-crimson',
  '--div-telehealth', '--div-inbound', '--div-outbound',
];
const SURFACES = ['--pulse-bg', '--pulse-surface-1', '--pulse-surface-2', '--pulse-surface-elevated'];

describe.each([
  ['light', ":root[data-theme='light']"],
  ['dark', ":root[data-theme='dark']"],
  ['contrast', ":root[data-theme='contrast']"],
])('%s theme text contrast', (_name, selector) => {
  const light = block(":root,\n:root[data-theme='light']");
  const tokens = selector.includes('light') ? light : { ...light, ...block(selector) };

  it.each(TEXT_TOKENS)('%s is at least 4.5:1 on every surface', (token) => {
    for (const surface of SURFACES) {
      expect(contrast(tokens[token], tokens[surface]), `${token} ${tokens[token]} on ${surface} ${tokens[surface]}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('system theme in dark mode', () => {
  it('repeats the dark text tokens exactly', () => {
    const dark = block(":root[data-theme='dark']");
    const media = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
    const system = Object.fromEntries([...media.slice(0, media.indexOf('}')).matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((match) => [match[1], match[2]]));
    for (const token of TEXT_TOKENS) expect(system[token], token).toBe(dark[token]);
  });

  it('reads the light indigo text token for text-pulse-indigo in dark and system-dark', () => {
    expect(css).toMatch(/:root\[data-theme='dark'\] \.text-pulse-indigo \{\s*color: var\(--pulse-indigo-text\);/);
    expect(css).toMatch(/:root\[data-theme='system'\] \.text-pulse-indigo \{\s*color: var\(--pulse-indigo-text\);/);
  });
});
