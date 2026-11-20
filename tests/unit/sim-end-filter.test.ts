import { describe, expect, it } from 'vitest';
import { containsSimEndSentinel, createSimEndStreamFilter, stripSimEndSentinels } from '@/lib/services/sim-end-filter';

function runChunks(chunks: string[]) {
  const filter = createSimEndStreamFilter();
  let out = '';
  for (const chunk of chunks) out += filter.push(chunk);
  out += filter.flush();
  return { out, ended: filter.simEnded };
}

/** Feed the text one character at a time (worst case for partial-sentinel hold-back). */
function runCharByChar(text: string) {
  return runChunks([...text]);
}

describe('SIM_END stream filter', () => {
  const variants = [
    'Okay, goodbye. <SIM_END>',
    'Okay, goodbye. </SIM_END>',
    'Okay, goodbye. <SIM_END/>',
    'Okay, goodbye. [SIM_END]',
    'Okay, goodbye. <SIM-END>',
    'Okay, goodbye. **<SIM_END>**',
    'Okay, goodbye. SIM_END',
    'Okay, goodbye.\nSIM_END',
    'Okay, goodbye. < sim_end >',
  ];

  for (const text of variants) {
    it(`removes ${JSON.stringify(text.slice(15))} whole and character by character`, () => {
      for (const result of [runChunks([text]), runCharByChar(text)]) {
        expect(result.ended).toBe(true);
        expect(result.out.trim()).toBe('Okay, goodbye.');
        expect(result.out).not.toMatch(/SIM|<|\[|\*/i);
      }
    });
  }

  it('drops text after the sentinel', () => {
    const result = runChunks(['Bye now. <SIM_E', 'ND> Agent: thanks']);
    expect(result).toEqual({ out: 'Bye now. ', ended: true });
  });

  it('treats a cut-off sentinel at end of stream as an end', () => {
    expect(runChunks(['Bye. <SIM_EN'])).toEqual({ out: 'Bye. ', ended: true });
    expect(runChunks(['Bye. SIM_E'])).toEqual({ out: 'Bye. ', ended: true });
  });

  it('passes ordinary text, including words starting with S, brackets and emphasis', () => {
    const text = 'So, I simply want [a refund] for *Simon* <today>. Sim cards are fine. Is that OK?';
    expect(runCharByChar(text)).toEqual({ out: text, ended: false });
    expect(runChunks([text])).toEqual({ out: text, ended: false });
  });

  it('exposes non-streaming helpers', () => {
    expect(containsSimEndSentinel('Thanks [SIM_END]')).toBe(true);
    expect(containsSimEndSentinel('Thanks, simulation ended?')).toBe(false);
    expect(stripSimEndSentinels('Thanks. **<SIM_END>**')).toBe('Thanks.');
  });
});
