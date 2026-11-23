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

describe('ordering Drills with options instead of steps (feedback 2026-11-23)', () => {
  it('spots steps that only apply in some situations', async () => {
    const { isConditionalStep } = await import('@/lib/services/drill-label');
    expect(isConditionalStep('Stop and withhold sharing if uncertain whether disclosure is permitted.')).toBe(true);
    expect(isConditionalStep('If the caller is a third party, end the call.')).toBe(true);
    expect(isConditionalStep('Greet the member with your first name.')).toBe(false);
    expect(isConditionalStep('Consult a supervisor or designated privacy contact for guidance.')).toBe(false);
  });

  it('makes the build repair loop and Studio flag such a Drill', async () => {
    const { explanationProblems } = await import('@/lib/ai/prompts/unit-builder');
    const { drillQualityNotes } = await import('@/components/studio/unit-review');
    const steps = [
      'Limit handling of patient records to assigned duties under the BAA.',
      'Consult a supervisor or designated privacy contact for guidance.',
      'Stop and withhold sharing if uncertain whether disclosure is permitted.',
      'Assist the patient with approved administrative steps without clinical advice.',
    ];
    const drill = {
      kind: 'SEQUENCE_ORDER' as const,
      prompt: 'Order the key steps an agent must follow when handling patient information.',
      explanation: 'Privacy comes first.',
      orderedSteps: steps.map((text) => ({ text })),
    };
    expect(explanationProblems(drill as never).join(' ')).toContain('is an option for a situation, not a step in a fixed order');
    const stored = { ...drill, id: 'd', competencyPillarId: 'p', sourcePages: [1], orderedSteps: steps.map((text, i) => ({ id: `s${i}`, text })) };
    expect(drillQualityNotes({ briefingCards: [], drills: [stored as never] }).join(' ')).toContain('some steps are options for different situations');
  });
});
