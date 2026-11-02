import { describe, expect, it } from 'vitest';
import {
  createProvenance,
  getAssessmentEligibility,
  parseProvenance,
  PROVENANCE_SCHEMA_VERSION,
} from '@/lib/ai/provenance';

const allChecks = {
  schemaValid: true,
  evidenceValid: true,
  trainerApproved: true,
  preflightPassed: true,
  approvedContent: true,
};

describe('provider-neutral provenance', () => {
  it('keeps source, provider, model, prompt, schema, and runtime metadata separate', () => {
    const provenance = createProvenance({
      source: 'local_ai',
      provider: 'openai_compatible',
      model: 'synthetic-model-v1',
      prompt: { templateId: 'curriculum', templateVersion: 'p3', inputHash: 'sha256:synthetic' },
      schema: { name: 'CurriculumStage', version: 's2' },
      runtime: { label: 'local-runtime-display', profileId: 'profile-1', protocol: 'local_http' },
      recordedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(provenance).toEqual({
      schemaVersion: PROVENANCE_SCHEMA_VERSION,
      source: 'local_ai',
      provider: 'openai_compatible',
      model: 'synthetic-model-v1',
      prompt: { templateId: 'curriculum', templateVersion: 'p3', inputHash: 'sha256:synthetic' },
      schema: { name: 'CurriculumStage', version: 's2' },
      runtime: { label: 'local-runtime-display', profileId: 'profile-1', protocol: 'local_http' },
      recordedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('reads historical records without importing or naming a concrete adapter', () => {
    expect(parseProvenance('manual_chat')).toMatchObject({ source: 'manual_chat', provider: null, model: null });
    expect(parseProvenance({ type: 'local_ai', provider: 'retired-provider', model: 'old-model' })).toMatchObject({
      schemaVersion: 1,
      source: 'local_ai',
      provider: 'retired-provider',
      model: 'old-model',
      prompt: { templateId: null, templateVersion: null, inputHash: null },
      runtime: { label: null, profileId: null, protocol: null },
    });
  });
});

describe('assessment eligibility', () => {
  it('never lets replay evidence certify or count toward readiness, even with every check passed', () => {
    const result = getAssessmentEligibility({
      provenance: createProvenance({ source: 'replay' }),
      evidenceStatus: 'verified',
      checks: allChecks,
    });

    expect(result).toMatchObject({ eligible: false, canCertify: false, countsTowardReadiness: false });
    expect(result.reasons).toContain('replay_evidence');
  });

  it('never lets historical unverified evidence certify or count toward readiness', () => {
    const result = getAssessmentEligibility({
      provenance: { kind: 'deterministic' },
      evidenceStatus: 'historical_unverified',
      checks: allChecks,
    });

    expect(result).toMatchObject({ eligible: false, canCertify: false, countsTowardReadiness: false });
    expect(result.reasons).toContain('historical_unverified_evidence');
  });

  it('treats missing legacy verification as unverified rather than grandfathering it in', () => {
    const result = getAssessmentEligibility({ provenance: 'deterministic', checks: allChecks });
    expect(result.countsTowardReadiness).toBe(false);
    expect(result.reasons).toContain('historical_unverified_evidence');
  });

  it('allows fully validated local evidence and enforces local preflight/content gates', () => {
    const provenance = createProvenance({ source: 'local_ai' });
    expect(getAssessmentEligibility({ provenance, evidenceStatus: 'verified', checks: allChecks }).eligible).toBe(true);
    expect(
      getAssessmentEligibility({
        provenance,
        evidenceStatus: 'verified',
        checks: { ...allChecks, preflightPassed: false },
      }).reasons,
    ).toContain('preflight_not_passed');
  });

  it('requires trainer approval for manual evidence', () => {
    const provenance = createProvenance({ source: 'manual_chat' });
    const blocked = getAssessmentEligibility({
      provenance,
      evidenceStatus: 'verified',
      checks: { ...allChecks, trainerApproved: false },
    });
    const allowed = getAssessmentEligibility({ provenance, evidenceStatus: 'verified', checks: allChecks });

    expect(blocked.reasons).toContain('trainer_approval_required');
    expect(allowed).toMatchObject({ eligible: true, canCertify: true, countsTowardReadiness: true });
  });

  it('fails closed for malformed provenance', () => {
    expect(getAssessmentEligibility({ provenance: { source: 'hosted_hidden_fallback' }, checks: allChecks })).toEqual({
      eligible: false,
      canCertify: false,
      countsTowardReadiness: false,
      reasons: ['invalid_provenance'],
    });
  });
});
