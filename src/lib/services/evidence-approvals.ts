/**
 * Evidence approval state is owned by the server. Trainers approve exact evidence only through the Source Review
 * command endpoint, which re-verifies the excerpts first. A Studio "Save Draft" carries the whole draft from the
 * browser, and that copy can be stale (approved after the page loaded) or hand-edited. These helpers make a save
 * keep the persisted approval of evidence whose content did not change, and never accept a client-side approval.
 */
import type { SecretSimScenarioConfig, TrackUnit } from '@/lib/schemas/curriculum';
import type { ClaimEvidence, SourceExcerptRef, SourcePageEvidence } from '@/lib/schemas/source-truth';

/** Everything an approval vouches for: the claim, its exact excerpts, rule links and severity flags. */
function approvedContentKey(evidence: ClaimEvidence): string {
  return JSON.stringify([
    evidence.claim,
    [...evidence.ruleIds].sort(),
    evidence.critical,
    evidence.requiresInterfaceDetails,
    evidence.excerpts.map((ref) => [ref.documentId, ref.revisionId, ref.pageNumber, ref.exactText, Boolean(ref.fromApprovedTranscription)]),
  ]);
}

/**
 * Keep the persisted trainer approval when the incoming evidence is unchanged; otherwise the evidence is (or
 * becomes) unapproved. The approval fields of the incoming copy are never trusted.
 */
export function carryEvidenceApproval(incoming: ClaimEvidence, persisted: ClaimEvidence | undefined): ClaimEvidence {
  if (
    persisted &&
    persisted.approvalStatus === 'approved' &&
    persisted.reviewerUid &&
    persisted.reviewedAt &&
    approvedContentKey(persisted) === approvedContentKey(incoming)
  ) {
    return {
      ...incoming,
      support: persisted.support,
      approvalStatus: 'approved',
      reviewerUid: persisted.reviewerUid,
      reviewedAt: persisted.reviewedAt,
    };
  }
  if (incoming.approvalStatus !== 'approved') return incoming;
  return { ...incoming, approvalStatus: 'draft', reviewerUid: null, reviewedAt: null };
}

function evidenceById(items: Array<{ evidence?: ClaimEvidence[] }>): Map<string, ClaimEvidence> {
  return new Map(items.flatMap((item) => (item.evidence ?? []).map((evidence) => [evidence.id, evidence] as const)));
}

function reconcileList<T extends { evidence?: ClaimEvidence[] }>(items: T[], persisted: Map<string, ClaimEvidence>): T[] {
  return items.map((item) =>
    item.evidence ? { ...item, evidence: item.evidence.map((evidence) => carryEvidenceApproval(evidence, persisted.get(evidence.id))) } : item,
  );
}

/** Apply {@link carryEvidenceApproval} to every Briefing Card and Drill evidence entry of a draft save. */
export function reconcileUnitEvidenceApprovals(persistedUnits: TrackUnit[], incomingUnits: TrackUnit[]): TrackUnit[] {
  const persisted = evidenceById(persistedUnits.flatMap((unit) => [...unit.briefingCards, ...unit.drills]));
  return incomingUnits.map((unit) => ({
    ...unit,
    briefingCards: reconcileList(unit.briefingCards, persisted),
    drills: reconcileList(unit.drills, persisted),
  }));
}

/** Apply {@link carryEvidenceApproval} to every Sim rubric criterion evidence entry of a secrets save. */
export function reconcileRubricEvidenceApprovals(
  persistedSecrets: SecretSimScenarioConfig[],
  incomingSecrets: SecretSimScenarioConfig[],
): SecretSimScenarioConfig[] {
  const persisted = evidenceById(persistedSecrets.flatMap((config) => config.rubricCriteria));
  return incomingSecrets.map((config) => ({ ...config, rubricCriteria: reconcileList(config.rubricCriteria, persisted) }));
}

/** The persisted rubric evidence with this id, if any Sim rubric criterion holds it. */
export function findRubricEvidence(secrets: SecretSimScenarioConfig[], evidenceId: string): ClaimEvidence | undefined {
  for (const config of secrets) {
    for (const criterion of config.rubricCriteria) {
      const evidence = criterion.evidence?.find((candidate) => candidate.id === evidenceId);
      if (evidence) return evidence;
    }
  }
  return undefined;
}

/** Replace the rubric evidence with this id (used after the server verified and approved it). */
export function replaceRubricEvidence(
  secrets: SecretSimScenarioConfig[],
  evidenceId: string,
  next: ClaimEvidence,
): SecretSimScenarioConfig[] {
  return secrets.map((config) => ({
    ...config,
    rubricCriteria: config.rubricCriteria.map((criterion) =>
      criterion.evidence
        ? { ...criterion, evidence: criterion.evidence.map((evidence) => (evidence.id === evidenceId ? next : evidence)) }
        : criterion,
    ),
  }));
}

function excerptKey(excerpt: SourceExcerptRef): string {
  return JSON.stringify([excerpt.documentId, excerpt.revisionId, excerpt.pageNumber, excerpt.exactText, Boolean(excerpt.fromApprovedTranscription)]);
}

/**
 * New approved excerpts grouped by page, so a claim with two excerpts on one page records both (writing the page
 * once per excerpt from the same original kept only the last). Pages that already hold every excerpt are left out.
 * `pageFor` resolves (or throws for) each excerpt's page.
 */
export function approvedExcerptsByPage(
  excerpts: readonly SourceExcerptRef[],
  pageFor: (excerpt: SourceExcerptRef) => SourcePageEvidence,
): Array<{ page: SourcePageEvidence; added: SourceExcerptRef[] }> {
  const byPage = new Map<string, { page: SourcePageEvidence; added: SourceExcerptRef[]; keys: Set<string> }>();
  for (const excerpt of excerpts) {
    const page = pageFor(excerpt);
    const entry = byPage.get(page.id) ?? { page, added: [], keys: new Set(page.approvedExcerpts.map(excerptKey)) };
    byPage.set(page.id, entry);
    if (entry.keys.has(excerptKey(excerpt))) continue;
    entry.keys.add(excerptKey(excerpt));
    entry.added.push(excerpt);
  }
  return [...byPage.values()].filter((entry) => entry.added.length > 0).map(({ page, added }) => ({ page, added }));
}

/**
 * A draft save cannot move a Live Call Sim to another source revision: that happens only through Source Review's
 * rebind (which re-verifies every approved excerpt first). Kept scenarios carry the persisted value forward.
 */
export function carryScenarioSourceRevision<S extends { id: string; context?: { sourceRevision: string } | null }>(
  persisted: readonly S[],
  incoming: readonly S[],
  draftSourceRevision: string | null | undefined,
): S[] {
  const before = new Map(persisted.map((scenario) => [scenario.id, scenario.context?.sourceRevision] as const));
  return incoming.map((scenario) => {
    if (!scenario.context) return scenario;
    const kept = before.get(scenario.id) ?? draftSourceRevision ?? undefined;
    return kept && kept !== scenario.context.sourceRevision
      ? { ...scenario, context: { ...scenario.context, sourceRevision: kept } }
      : scenario;
  });
}
