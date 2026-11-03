import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EvalRubricsDocSchema,
  PublicSimScenarioSchema,
  TrackUnitSchema,
  TrackVersionDocSchema,
} from '@/lib/schemas/curriculum';
import {
  STANDARD_MEDS_CALL_PACKS,
  STANDARD_MEDS_ORIENTATION_PACK,
  STANDARD_MEDS_SHARED_RULE_IDS,
  STANDARD_MEDS_SME_DECISIONS,
  STANDARD_MEDS_SME_DECISION_IDS,
  STANDARD_MEDS_SOURCE_CATALOG,
  STANDARD_MEDS_SOURCE_CODES,
  STANDARD_MEDS_SOURCE_MANIFEST,
  STANDARD_MEDS_SOURCES,
  STANDARD_MEDS_TRACK_RULE_IDS,
  getStandardMedsSource,
} from '@/lib/content/standard-meds';
import { registerStandardMedsSources } from '@/lib/content/standard-meds/register-sources';
import { STANDARD_MEDS_SCENARIO_IDS, standardMedsQAFixtures } from '@/lib/content/standard-meds-scenarios';

const workspaceRoot = process.cwd();
const prefixByCode = { 'SM-01': 'NC', 'SM-02': 'LR', 'SM-03': 'ED', 'SM-04': 'ZR', 'SM-05': 'NAD', 'SM-06': 'CS', 'SM-07': 'MC', 'SM-08': 'RN' } as const;

function sha256(value: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

describe('Standard Meds local source registration', () => {
  it('registers all nine supplied PDFs with real byte hashes and document-06 page counts', async () => {
    expect(STANDARD_MEDS_SOURCES.map((source) => source.code)).toEqual(STANDARD_MEDS_SOURCE_CODES);
    expect(STANDARD_MEDS_SOURCES).toHaveLength(9);

    for (const definition of STANDARD_MEDS_SOURCE_CATALOG) {
      const source = getStandardMedsSource(definition.code);
      const bytes = await readFile(path.join(workspaceRoot, source.relativePath));
      expect(source.fileName).toBe(definition.fileName);
      expect(source.contentHash).toBe(sha256(bytes));
      expect(source.revisionId).toBe(source.contentHash);
      expect(source.pageCount).toBe(definition.expectedPageCount);
      expect(source.pages).toHaveLength(definition.expectedPageCount);
      expect(source.approvalStatus).toBe('draft');
    }
  });

  it('reproduces every page hash, character count, and extraction flag from actual local extraction', async () => {
    const extracted = await registerStandardMedsSources({ workspaceRoot });
    expect(extracted).toEqual(STANDARD_MEDS_SOURCE_MANIFEST);
    expect(STANDARD_MEDS_SOURCES.reduce((sum, source) => sum + source.pageCount, 0)).toBe(120);

    for (const source of STANDARD_MEDS_SOURCES) {
      source.pages.forEach((page, index) => {
        expect(page.pageNumber).toBe(index + 1);
        expect(page.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(page.characterCount).toBeGreaterThan(0);
        expect(new Set(page.extractionFlags).size).toBe(page.extractionFlags.length);
      });
    }
  });

  it('keeps raw and normalized source text out of the generated manifest', () => {
    expect(STANDARD_MEDS_SOURCE_MANIFEST.rawTextIncluded).toBe(false);
    const serialized = JSON.stringify(STANDARD_MEDS_SOURCE_MANIFEST);
    expect(serialized).not.toContain('"rawText"');
    expect(serialized).not.toContain('"normalizedText"');
    expect(serialized).not.toContain('"transcription"');
  });
});

describe('Standard Meds TrackVersion-compatible call packs', () => {
  it('provides exactly eight schema-valid call tracks plus orientation-only SM-00', () => {
    expect(STANDARD_MEDS_CALL_PACKS.map((pack) => pack.code)).toEqual(['SM-01', 'SM-02', 'SM-03', 'SM-04', 'SM-05', 'SM-06', 'SM-07', 'SM-08']);
    for (const pack of STANDARD_MEDS_CALL_PACKS) {
      expect(pack.kind).toBe('call_training');
      expect(TrackVersionDocSchema.parse(pack.version)).toEqual(pack.version);
      expect(EvalRubricsDocSchema.parse(pack.evalRubrics)).toEqual(pack.evalRubrics);
      expect(pack.version.units).toHaveLength(3);
      expect(pack.version.trackId).toBe(pack.source.trackId);
      expect(pack.version.sourceRevision).toBe(pack.source.contentHash);
      expect(pack.version.publishedAt).toBeNull();
      expect(pack.inheritedSourceCodes.length).toBeGreaterThan(0);
      for (const inheritedCode of pack.inheritedSourceCodes) expect(() => getStandardMedsSource(inheritedCode)).not.toThrow();
    }

    expect(STANDARD_MEDS_ORIENTATION_PACK.kind).toBe('orientation');
    expect(STANDARD_MEDS_ORIENTATION_PACK.code).toBe('SM-00');
    expect(STANDARD_MEDS_ORIENTATION_PACK.units).toHaveLength(2);
    expect(STANDARD_MEDS_ORIENTATION_PACK.sourceRegistry).toHaveLength(9);
    expect(STANDARD_MEDS_ORIENTATION_PACK).not.toHaveProperty('version');
    expect(STANDARD_MEDS_ORIENTATION_PACK).not.toHaveProperty('simScenarios');
    expect(STANDARD_MEDS_ORIENTATION_PACK.syntheticLinks).toEqual([]);
    STANDARD_MEDS_ORIENTATION_PACK.units.forEach((unit) => expect(TrackUnitSchema.parse(unit)).toEqual(unit));
  });

  it('covers every existing document-06 builder scenario exactly once with matching QA fixtures', () => {
    const covered = STANDARD_MEDS_CALL_PACKS.flatMap((pack) => pack.version.simScenarios.map((scenario) => scenario.id));
    expect(covered).toHaveLength(STANDARD_MEDS_SCENARIO_IDS.length);
    expect(new Set(covered).size).toBe(STANDARD_MEDS_SCENARIO_IDS.length);
    expect(new Set(covered)).toEqual(new Set(STANDARD_MEDS_SCENARIO_IDS));

    for (const pack of STANDARD_MEDS_CALL_PACKS) {
      const prefix = prefixByCode[pack.code];
      const expectedIds = STANDARD_MEDS_SCENARIO_IDS.filter((id) => id.startsWith(`${prefix}-`));
      expect(pack.version.simScenarios.map((scenario) => scenario.id)).toEqual(expectedIds);
      expect(pack.evalRubrics.scenarios.map((scenario) => scenario.scenarioId)).toEqual(expectedIds);

      for (const scenario of pack.version.simScenarios) {
        expect(PublicSimScenarioSchema.parse(scenario)).toEqual(scenario);
        expect(scenario.context).toMatchObject({
          sourceRevision: pack.source.contentHash,
          curriculumVersion: pack.version.versionId,
          syntheticTimezone: 'America/Boise',
        });
        expect(scenario.evidenceRequirements?.requiredGateIds.length).toBeGreaterThan(0);
        const secret = pack.evalRubrics.scenarios.find((candidate) => candidate.scenarioId === scenario.id)!;
        expect(secret.qaFixtures).toEqual(standardMedsQAFixtures(scenario.id as (typeof STANDARD_MEDS_SCENARIO_IDS)[number]));
        expect(secret.qaFixtures?.some((fixture) => fixture.kind === 'golden_pass')).toBe(true);
        expect(secret.qaFixtures?.some((fixture) => fixture.kind === 'golden_critical_fail')).toBe(true);
      }
    }
  });

  it('uses stable required rules and server-scored drills with varied mappings and valid page refs', () => {
    for (const pack of STANDARD_MEDS_CALL_PACKS) {
      const rules = pack.version.requiredRuleIds!;
      expect(rules).toEqual([...STANDARD_MEDS_SHARED_RULE_IDS, ...STANDARD_MEDS_TRACK_RULE_IDS[pack.code]]);
      expect(new Set(rules).size).toBe(rules.length);
      const drills = pack.version.units.flatMap((unit) => unit.drills);
      const mappedRules = new Set(drills.flatMap((drill) => drill.ruleIds ?? []));
      for (const rule of rules) expect(mappedRules.has(rule), `${pack.code} must score ${rule}`).toBe(true);

      const pillarIds = new Set(pack.version.competencyPillars.map((pillar) => pillar.id));
      for (const unit of pack.version.units) {
        expect(TrackUnitSchema.parse(unit)).toEqual(unit);
        for (const drill of unit.drills) {
          expect(pillarIds.has(drill.competencyPillarId)).toBe(true);
          expect(drill.ruleIds?.length).toBeGreaterThan(0);
          for (const rule of drill.ruleIds ?? []) expect(rules).toContain(rule);
          for (const page of drill.sourcePages) expect(page).toBeLessThanOrEqual(pack.source.pageCount);
        }
        for (const card of unit.briefingCards) {
          for (const page of card.sourcePages) expect(page).toBeLessThanOrEqual(pack.source.pageCount);
        }
      }

      const voicemailDrills = drills.filter((drill) => drill.ruleIds?.includes('SHARED_NO_VOICEMAIL_SMS'));
      expect(voicemailDrills.length).toBeGreaterThanOrEqual(2);
      expect(new Set(voicemailDrills.map((drill) => drill.kind))).toEqual(new Set(['MATCH_PAIRS', 'FILL_BLANK_CHOICE']));
      expect(new Set(voicemailDrills.map((drill) => drill.id)).size).toBe(voicemailDrills.length);
    }
  });

  it('contains substantive track-specific operations rather than placeholder curriculum', () => {
    const expectations = {
      'SM-01': ['LDN + B12', 'three-month', 'personalized checkout'],
      'SM-02': ['tretinoin 0.05%', 'six-month', 'irritation'],
      'SM-03': ['$149', 'combined Dosage + Checkout', 'base commitment'],
      'SM-04': ['9–12-month', 'fungus checkout host', 'DMSO'],
      'SM-05': ['0% installments', 'personalized results', 'physician-set dose'],
      'SM-06': ['$74.25', 'next renewal only', '911'],
      'SM-07': ['seven-day', 'patient owns the answer', 'Organic'],
      'SM-08': ['Pause recording', 'Recovered only after confirmation', 'neutral bank framing'],
    } as const;

    for (const pack of STANDARD_MEDS_CALL_PACKS) {
      const curriculum = JSON.stringify(pack.version.units);
      expect(curriculum).not.toMatch(/lorem ipsum|\bplaceholder\b|\bTBD\b|\bTODO\b/i);
      for (const expected of expectations[pack.code]) expect(curriculum.toLowerCase()).toContain(expected.toLowerCase());
      expect(pack.version.units[0]).not.toEqual(pack.version.units[1]);
      expect(pack.evalRubrics.scenarios.every((scenario) => scenario.rubricCriteria.length === 3)).toBe(true);
    }
  });

  it('uses only explicitly synthetic links, actor data, and scenario revisions', () => {
    for (const pack of STANDARD_MEDS_CALL_PACKS) {
      expect(pack.syntheticLinks.length).toBeGreaterThan(0);
      for (const link of pack.syntheticLinks) {
        expect(link.url.startsWith('https://synthetic.invalid/')).toBe(true);
        expect(link.synthetic).toBe(true);
        expect(link.approvalStatus).toBe('draft');
        expect(link.sourcePages.every((page) => page > 0 && page <= pack.source.pageCount)).toBe(true);
      }
      for (const scenario of pack.version.simScenarios) {
        expect(scenario.title).toContain('SYNTHETIC QA');
        expect(scenario.contextTicketSummary).toContain('SYNTHETIC TRAINING');
        expect(scenario.context?.sourceRevision).toBe(pack.source.contentHash);
      }
      for (const secret of pack.evalRubrics.scenarios) {
        expect(secret.personaName).toContain('Synthetic');
        expect(secret.personaBackstoryAndMood).toContain('No real customer, order, health, identity, or payment data');
      }
    }
  });
});

describe('Standard Meds publication remains explicitly blocked', () => {
  it('leaves every SME-01 through SME-10 decision open with no invented decision metadata', () => {
    expect(STANDARD_MEDS_SME_DECISIONS.map((decision) => decision.id)).toEqual(STANDARD_MEDS_SME_DECISION_IDS);
    expect(STANDARD_MEDS_SME_DECISIONS).toHaveLength(10);
    for (const decision of STANDARD_MEDS_SME_DECISIONS) {
      expect(decision.status).toBe('open');
      expect(decision.decision).toBeNull();
      expect(decision.decisionOwnerUid).toBeNull();
      expect(decision.decidedAt).toBeNull();
      expect(decision.requiredDecision.length).toBeGreaterThan(30);
    }
    expect(new Set(STANDARD_MEDS_CALL_PACKS.flatMap((pack) => pack.openSmeDecisionIds))).toEqual(new Set(STANDARD_MEDS_SME_DECISION_IDS));
  });

  it('exposes precise excerpt, asset, trainer, transcription, and SME blockers without approving or publishing packs', () => {
    const packs = [...STANDARD_MEDS_CALL_PACKS, STANDARD_MEDS_ORIENTATION_PACK];
    for (const pack of packs) {
      expect(pack.publication.eligible).toBe(false);
      expect(pack.publication.approvalStatus).toBe('draft');
      expect(pack.source.approvalStatus).toBe('draft');
      const codes = new Set(pack.publication.blockers.map((blocker) => blocker.code));
      expect([...codes]).toEqual(expect.arrayContaining(['EXACT_EXCERPT_APPROVAL_REQUIRED', 'OPERATIONAL_ASSET_APPROVAL_REQUIRED', 'SME_DECISION_REQUIRED', 'TRAINER_SIGNOFF_REQUIRED']));
      const excerptBlocker = pack.publication.blockers.find((blocker) => blocker.code === 'EXACT_EXCERPT_APPROVAL_REQUIRED')!;
      expect(excerptBlocker.message).toMatch(/\d+ briefing, drill, and rubric items/);
      const smeBlocker = pack.publication.blockers.find((blocker) => blocker.code === 'SME_DECISION_REQUIRED')!;
      expect(smeBlocker.smeDecisionIds).toEqual(pack.openSmeDecisionIds);
      const trainerBlocker = pack.publication.blockers.find((blocker) => blocker.code === 'TRAINER_SIGNOFF_REQUIRED')!;
      expect(trainerBlocker.message).toContain(pack.source.revisionId);

      const transcriptionPages = pack.source.pages.filter((page) => page.extractionFlags.includes('manual_transcription_required')).map((page) => page.pageNumber);
      const transcriptionBlocker = pack.publication.blockers.find((blocker) => blocker.code === 'SOURCE_TRANSCRIPTION_REQUIRED');
      if (transcriptionPages.length > 0) expect(transcriptionBlocker?.pageNumbers).toEqual(transcriptionPages);
      else expect(transcriptionBlocker).toBeUndefined();
    }
    for (const pack of STANDARD_MEDS_CALL_PACKS) expect(pack.version.publishedAt).toBeNull();
  });
});
