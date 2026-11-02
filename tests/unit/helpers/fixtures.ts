import type {
  BriefingCard,
  CompetencyPillar,
  DrillItem,
  PublicSimScenario,
  SecretSimScenarioConfig,
  TrackUnit,
} from '@/lib/schemas/curriculum';

export const pillars: CompetencyPillar[] = [
  { id: 'p1', key: 'verification_crm', label: 'Identity & CRM Verification', description: 'Verify the caller and the order.' },
  { id: 'p2', key: 'retention_objection', label: 'Save-Offer Ladder', description: 'Walk the 25% / 50% / 70% ladder.' },
  { id: 'p3', key: 'escalation_triage', label: 'Escalation Triage', description: 'Escalate medical complaints.' },
  { id: 'p4', key: 'empathy_communication', label: 'Empathy & Clarity', description: 'De-escalate with empathy.' },
];

export function card(id: string): BriefingCard {
  return {
    id,
    headline: 'Verify before you discuss the order',
    bodyMarkdown: 'Confirm the full name, zip code, and order number before you discuss any refund.',
    keyTakeaway: 'No verification, no refund discussion.',
    doList: ['Ask for the order number first'],
    dontList: ['Do not read card numbers aloud'],
    sourcePages: [2],
  };
}

export function drills(prefix: string): DrillItem[] {
  return [
    {
      id: `${prefix}-d1`,
      kind: 'MULTIPLE_CHOICE',
      competencyPillarId: 'p1',
      prompt: 'What do you confirm first?',
      explanation: 'Page 2 requires the order number first.',
      sourcePages: [2],
      options: [
        { id: 'a', text: 'Order number' },
        { id: 'b', text: 'Favorite color' },
        { id: 'c', text: 'Card number' },
        { id: 'd', text: 'Nothing' },
      ],
      correctOptionId: 'a',
    },
    {
      id: `${prefix}-d2`,
      kind: 'TRUE_FALSE_SPOT',
      competencyPillarId: 'p2',
      prompt: 'Is this compliant?',
      explanation: 'Medical complaints skip to 70%.',
      sourcePages: [3],
      statement: 'Agent offers 25% to a caller with a doctor-advised reaction.',
      isCompliant: false,
    },
    {
      id: `${prefix}-d3`,
      kind: 'SEQUENCE_ORDER',
      competencyPillarId: 'p3',
      prompt: 'Order the escalation steps.',
      explanation: 'Page 4 lists the order.',
      sourcePages: [4],
      orderedSteps: [
        { id: 's1', text: 'Verify identity' },
        { id: 's2', text: 'Capture symptom details' },
        { id: 's3', text: 'Submit the escalation form' },
      ],
    },
    {
      id: `${prefix}-d4`,
      kind: 'MATCH_PAIRS',
      competencyPillarId: 'p4',
      prompt: 'Match each trigger to the action.',
      explanation: 'Page 3 maps triggers to actions.',
      sourcePages: [3],
      pairs: [
        { id: 'm1', leftPrompt: 'Medical reaction', rightMatch: 'Immediate 70% refund' },
        { id: 'm2', leftPrompt: 'Price complaint', rightMatch: 'Offer 25% first' },
        { id: 'm3', leftPrompt: 'Chargeback threat', rightMatch: 'Escalate to supervisor' },
      ],
    },
    {
      id: `${prefix}-d5`,
      kind: 'FILL_BLANK_CHOICE',
      competencyPillarId: 'p2',
      prompt: 'Complete the rule.',
      explanation: 'Page 3: medical complaints get 70%.',
      sourcePages: [3],
      sentenceTemplate: 'A medical complaint receives an immediate {{BLANK}} refund.',
      wordBank: ['25%', '50%', '70%', '100%'],
      correctWord: '70%',
    },
  ];
}

export function unit(id: string, orderIndex: number): TrackUnit {
  return {
    id,
    orderIndex,
    title: `Unit ${orderIndex + 1}`,
    summary: 'Verification and the save-offer ladder.',
    estimatedMinutes: 4,
    briefingCards: [card(`${id}-c1`), card(`${id}-c2`)],
    drills: drills(id),
  };
}

export const scenario: PublicSimScenario = {
  id: 's1',
  title: 'Medical Side-Effect Refund Request',
  difficulty: 'HIGH_PRESSURE',
  counterpartyRoleLabel: 'Inbound Buyer',
  contextTicketSummary: 'Queue: Flow A — MVP | Inbound Call',
  openingMessage: 'My cardiologist told me to stop taking this. I want my money back now.',
  dispositionOptions: ['Refund - Medical', 'Save - 25%', 'Escalated - Supervisor'],
  maxTurns: 8,
  passScoreThreshold: 80,
};

export const secret: SecretSimScenarioConfig = {
  scenarioId: 's1',
  personaName: 'Dana Reyes',
  personaBackstoryAndMood: 'Anxious buyer who ordered three bottles last week.',
  hiddenFactsToRevealOnlyWhenAsked: ['Order #MVP-55821', 'Zip code 33101'],
  conditionalBehaviors: ['Calms down when the agent shows empathy'],
  expectedDisposition: 'Refund - Medical',
  autoFailTriggers: ['Offers a 25% discount after the medical complaint'],
  rubricCriteria: [
    { id: 'r1', competencyPillarId: 'p1', criterionLabel: 'Verified identity', evaluationRule: 'Ask for order number and zip.', weight: 30, sourcePages: [2] },
    { id: 'r2', competencyPillarId: 'p2', criterionLabel: 'Correct refund tier', evaluationRule: 'Offer 70% immediately.', weight: 40, sourcePages: [3] },
    { id: 'r3', competencyPillarId: 'p4', criterionLabel: 'Empathy', evaluationRule: 'Acknowledge the concern.', weight: 30, sourcePages: [3] },
  ],
};
