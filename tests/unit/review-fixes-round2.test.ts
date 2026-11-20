import { describe, expect, it } from 'vitest';
import { approvedExcerptsByPage, carryScenarioSourceRevision } from '@/lib/services/evidence-approvals';
import { isNoActiveSourceBundle, SourceReviewApiError } from '@/components/studio/source-review-api';
import { appendDrill } from '@/components/studio/unit-review';
import type { SourceExcerptRef, SourcePageEvidence } from '@/lib/schemas/source-truth';

const page = { id: 'p3', documentId: 'doc', revisionId: 'rev', pageNumber: 3, approvedExcerpts: [] as SourceExcerptRef[] } as unknown as SourcePageEvidence;
const ref = (exactText: string): SourceExcerptRef => ({ documentId: 'doc', revisionId: 'rev', pageNumber: 3, exactText, fromApprovedTranscription: false });

describe('approving a claim with two excerpts on one page', () => {
  it('records both excerpts in one page write', () => {
    const writes = approvedExcerptsByPage([ref('First sentence.'), ref('Second sentence.'), ref('First sentence.')], () => page);
    expect(writes).toHaveLength(1);
    expect(writes[0].added.map((excerpt) => excerpt.exactText)).toEqual(['First sentence.', 'Second sentence.']);
    const already = { ...page, approvedExcerpts: [ref('First sentence.')] } as SourcePageEvidence;
    expect(approvedExcerptsByPage([ref('First sentence.')], () => already)).toEqual([]);
  });
});

describe('PATCH keeps the bound Sim source revision', () => {
  const scenario = (id: string, sourceRevision: string) => ({ id, context: { sourceRevision } });
  it('ignores a client-side source revision change and binds new Sims to the draft revision', () => {
    const next = carryScenarioSourceRevision([scenario('s1', 'sha256:a')], [scenario('s1', 'sha256:forged'), scenario('s9', 'sha256:other')], 'sha256:a');
    expect(next.map((item) => item.context.sourceRevision)).toEqual(['sha256:a', 'sha256:a']);
  });
});

describe('GenerationStepper source check', () => {
  it('treats only the no-active-bundle 404 as "nothing to approve"', () => {
    expect(isNoActiveSourceBundle(new SourceReviewApiError('none', 404, 'NO_ACTIVE_SOURCE_BUNDLE'))).toBe(true);
    expect(isNoActiveSourceBundle(new SourceReviewApiError('gone', 404, 'NOT_FOUND'))).toBe(false);
    expect(isNoActiveSourceBundle(new Error('x'))).toBe(false);
  });
});

describe('Add a Drill keeps edits made during the AI call', () => {
  it('appends only the new Drill to the local Unit', () => {
    const local = { id: 'u1', title: 'Edited while waiting', drills: [{ id: 'u1-d1', prompt: 'edited' }] };
    const next = appendDrill(local, { id: 'u1-d2', prompt: 'new' });
    expect(next.title).toBe('Edited while waiting');
    expect(next.drills.map((drill) => drill.prompt)).toEqual(['edited', 'new']);
    expect(appendDrill(next, { id: 'u1-d2', prompt: 'server copy' }).drills).toHaveLength(2);
  });
});
