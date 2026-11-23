/** QA M7: "Top missed items" shows what the Drill is about, not "Complete the Playbook rule." */
import { describe, expect, it } from 'vitest';
import { drillLabel, isGenericDrillPrompt } from '@/lib/services/drill-label';
import type { DrillItem } from '@/lib/schemas/curriculum';

const base = { id: 'd1', competencyPillarId: 'p', explanation: 'x', sourcePages: [1] };

describe('drillLabel', () => {
  it('spots generic prompts', () => {
    expect(isGenericDrillPrompt('Complete the Playbook rule.')).toBe(true);
    expect(isGenericDrillPrompt('Put the steps in the correct order.')).toBe(true);
    expect(isGenericDrillPrompt('Does this agent action follow the Playbook?')).toBe(true);
    expect(isGenericDrillPrompt('A member says the Plus plan is too expensive. What is the first save offer?')).toBe(false);
  });

  it('uses the sentence for a generic fill-in-the-blank Drill', () => {
    const drill = {
      ...base,
      kind: 'FILL_BLANK_CHOICE',
      prompt: 'Complete the Playbook rule.',
      sentenceTemplate: 'Offer at most {{BLANK}} save offers before you honor the cancellation and end the call politely with the member.',
      wordBank: ['two', 'three', 'four', 'one'],
      correctWord: 'two',
    } as DrillItem;
    const label = drillLabel(drill);
    expect(label.startsWith('Offer at most ___ save offers')).toBe(true);
    expect(label.length).toBeLessThanOrEqual(80);
  });

  it('keeps a specific prompt as it is', () => {
    const drill = {
      ...base,
      kind: 'MULTIPLE_CHOICE',
      prompt: 'A member says the Plus plan is too expensive. What is the first save offer?',
      options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }, { id: 'c', text: 'c' }, { id: 'd', text: 'd' }],
      correctOptionId: 'a',
    } as DrillItem;
    expect(drillLabel(drill)).toBe('A member says the Plus plan is too expensive. What is the first save offer?');
  });
});
