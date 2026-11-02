import { describe, expect, it } from 'vitest';
import {
  BriefingCardSchema,
  CanonicalPillarKeySchema,
  DrillItemSchema,
  EvalRubricsDocSchema,
  PublicSimScenarioSchema,
  SecretSimScenarioConfigSchema,
  TrackDocSchema,
  TrackUnitSchema,
  TrackVersionDocSchema,
} from '@/lib/schemas/curriculum';
import { card, drills, pillars, scenario, secret, unit } from './helpers/fixtures';

describe('curriculum schemas', () => {
  it('has exactly the 8 canonical CompetencyPillar keys', () => {
    expect(CanonicalPillarKeySchema.options).toHaveLength(8);
  });

  it('validates a BriefingCard and enforces length limits', () => {
    expect(BriefingCardSchema.parse(card('c1')).id).toBe('c1');
    expect(BriefingCardSchema.safeParse({ ...card('c1'), headline: 'x'.repeat(91) }).success).toBe(false);
    expect(BriefingCardSchema.safeParse({ ...card('c1'), doList: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(false);
    expect(BriefingCardSchema.safeParse({ ...card('c1'), sourcePages: [0] }).success).toBe(false);
  });

  it('validates all 5 Drill kinds through the discriminated union', () => {
    const kinds = drills('u1').map((d) => DrillItemSchema.parse(d).kind);
    expect(kinds).toEqual(['MULTIPLE_CHOICE', 'TRUE_FALSE_SPOT', 'SEQUENCE_ORDER', 'MATCH_PAIRS', 'FILL_BLANK_CHOICE']);
  });

  it('rejects malformed Drill items', () => {
    const [mc, , seq, match, fill] = drills('u1');
    expect(DrillItemSchema.safeParse({ ...mc, kind: 'ESSAY' }).success).toBe(false);
    if (mc.kind === 'MULTIPLE_CHOICE') {
      expect(DrillItemSchema.safeParse({ ...mc, options: mc.options.slice(0, 3) }).success).toBe(false);
    }
    if (seq.kind === 'SEQUENCE_ORDER') {
      expect(DrillItemSchema.safeParse({ ...seq, orderedSteps: seq.orderedSteps.slice(0, 2) }).success).toBe(false);
    }
    if (match.kind === 'MATCH_PAIRS') {
      expect(DrillItemSchema.safeParse({ ...match, pairs: match.pairs.slice(0, 2) }).success).toBe(false);
    }
    if (fill.kind === 'FILL_BLANK_CHOICE') {
      expect(DrillItemSchema.safeParse({ ...fill, wordBank: ['a', 'b', 'c'] }).success).toBe(false);
    }
  });

  it('requires 2-6 BriefingCards and 4-8 Drills per Unit', () => {
    const u = unit('u1', 0);
    expect(TrackUnitSchema.parse(u).drills).toHaveLength(5);
    expect(TrackUnitSchema.safeParse({ ...u, briefingCards: [u.briefingCards[0]] }).success).toBe(false);
    expect(TrackUnitSchema.safeParse({ ...u, drills: u.drills.slice(0, 3) }).success).toBe(false);
    expect(TrackUnitSchema.safeParse({ ...u, estimatedMinutes: 11 }).success).toBe(false);
  });

  it('applies Simulation defaults and bounds', () => {
    const { maxTurns: _maxTurns, passScoreThreshold: _pass, ...rest } = scenario;
    void _maxTurns;
    void _pass;
    const parsed = PublicSimScenarioSchema.parse(rest);
    expect(parsed.maxTurns).toBe(8);
    expect(parsed.passScoreThreshold).toBe(80);
    expect(PublicSimScenarioSchema.safeParse({ ...scenario, maxTurns: 13 }).success).toBe(false);
    expect(PublicSimScenarioSchema.safeParse({ ...scenario, dispositionOptions: ['a', 'b'] }).success).toBe(false);
  });

  it('validates secret Simulation configs and the evalRubrics document', () => {
    expect(SecretSimScenarioConfigSchema.parse(secret).rubricCriteria).toHaveLength(3);
    expect(
      SecretSimScenarioConfigSchema.safeParse({ ...secret, rubricCriteria: secret.rubricCriteria.slice(0, 2) }).success,
    ).toBe(false);
    expect(
      SecretSimScenarioConfigSchema.safeParse({
        ...secret,
        rubricCriteria: [{ ...secret.rubricCriteria[0], weight: 60 }, ...secret.rubricCriteria.slice(1)],
      }).success,
    ).toBe(false);
    expect(EvalRubricsDocSchema.parse({ trackId: 't1', versionId: 'v1', scenarios: [secret], updatedAt: 1 }).scenarios).toHaveLength(1);
  });

  it('keeps secret fields out of the public learner bundle', () => {
    const version = TrackVersionDocSchema.parse({
      versionId: 'v1',
      trackId: 't1',
      versionNumber: 1,
      competencyPillars: pillars,
      units: [unit('u1', 0), unit('u2', 1)],
      simScenarios: [{ ...scenario, ...secret }],
      publishedAt: 1,
      createdAt: 1,
    });
    const serialized = JSON.stringify(version);
    expect(serialized).not.toContain('autoFailTriggers');
    expect(serialized).not.toContain('hiddenFactsToRevealOnlyWhenAsked');
    expect(serialized).not.toContain('rubricCriteria');
  });

  it('validates a Track header document', () => {
    const track = {
      id: 't1',
      title: 'MVP Retention & Escalations',
      campaignCode: 'MVP',
      divisionId: 'INBOUND',
      status: 'PUBLISHED',
      generationProgress: { step: 'READY', percent: 100, message: 'Track Ready' },
      sourcePdfStoragePath: 'playbooks/t1/1-mvp.pdf',
      sourcePdfFileName: 'mvp.pdf',
      sourcePageCount: 16,
      currentDraftVersionId: 'draft',
      publishedVersionId: 'v1',
      assignedCohortIds: ['ALL'],
      competencyPillars: pillars,
      unitCount: 2,
      simScenarioCount: 1,
      estimatedTotalMinutes: 12,
      createdByUid: 'trainer-1',
      createdAt: 1,
      updatedAt: 2,
    };
    expect(TrackDocSchema.parse(track).status).toBe('PUBLISHED');
    expect(TrackDocSchema.safeParse({ ...track, status: 'LIVE' }).success).toBe(false);
    expect(TrackDocSchema.safeParse({ ...track, sourcePageCount: 0 }).success).toBe(false);
  });
});
