'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, FileCheck2, GitBranch, Link2, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import type { SecretSimScenarioConfig, TrackVersionDoc } from '@/lib/schemas/curriculum';
import type {
  ClaimEvidence,
  OperationalAsset,
  SourceConflict,
  SourceExcerptRef,
  SourcePageEvidence,
} from '@/lib/schemas/source-truth';
import { evaluatePublicationGates, verifyClaimEvidence } from '@/lib/services/source-evidence';
import { cn } from '@/lib/utils';
import { pageSentenceChoices } from '@/lib/services/evidence-rematch';
import {
  approvedEvidenceFrom,
  fetchSourceReview,
  postSourceReview,
  rebindDraftToSource,
  RebindDraftError,
  pickExcerpt,
  rematchEvidence,
  type RebindProblem,
  type SourceReviewAction,
  type SourceReviewData,
} from './source-review-api';

const EMPTY_REVIEW: SourceReviewData = { bundle: null, pages: [], rulePacks: [], assets: [], conflicts: [] };
type Filter = 'all' | 'unsupported' | 'conflicted' | 'low-quality' | 'critical';
type ReviewClaim = {
  ownerId: string;
  /** Checkpoint id, or the Live Call Sim id for rubric evidence. */
  unitId: string;
  ownerKind: 'Briefing Card' | 'Drill' | 'Sim rubric';
  evidence: ClaimEvidence;
};

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All evidence' },
  { id: 'unsupported', label: 'Unsupported' },
  { id: 'conflicted', label: 'Conflicted' },
  { id: 'low-quality', label: 'Low extraction quality' },
  { id: 'critical', label: 'Critical' },
];

export function claimsForDraft(draft: TrackVersionDoc, secrets: SecretSimScenarioConfig[] = []): ReviewClaim[] {
  const scenarioIds = new Set(draft.simScenarios.map((scenario) => scenario.id));
  return [
    ...draft.units.flatMap((unit) => [
      ...unit.briefingCards.flatMap((card) =>
        (card.evidence ?? []).map((evidence) => ({ ownerId: card.id, unitId: unit.id, ownerKind: 'Briefing Card' as const, evidence })),
      ),
      ...unit.drills.flatMap((drill) =>
        (drill.evidence ?? []).map((evidence) => ({ ownerId: drill.id, unitId: unit.id, ownerKind: 'Drill' as const, evidence })),
      ),
    ]),
    // Live Call Sim rubric criteria are graded against the Playbook too, so their exact evidence needs approval.
    ...secrets
      .filter((config) => scenarioIds.has(config.scenarioId))
      .flatMap((config) => config.rubricCriteria.flatMap((criterion) =>
        (criterion.evidence ?? []).map((evidence) => ({ ownerId: criterion.id, unitId: config.scenarioId, ownerKind: 'Sim rubric' as const, evidence })),
      )),
  ];
}

function pageFor(pages: SourcePageEvidence[], ref: SourceExcerptRef): SourcePageEvidence | undefined {
  return pages.find((page) =>
    page.documentId === ref.documentId && page.revisionId === ref.revisionId && page.pageNumber === ref.pageNumber,
  );
}

/** Gate codes that a "rebind draft to current approved revision" can clear (after exact re-verification). */
const REBINDABLE_CODES = new Set(['SOURCE_REVISION_MISSING', 'SCENARIO_SOURCE_REVISION_MISMATCH']);

export function SourceReview({
  trackId,
  draft,
  secrets = [],
  hasUnsavedChanges = false,
  onDraftRebound,
  onEvidenceApproved,
}: {
  trackId: string;
  draft: TrackVersionDoc;
  /** Draft Sim persona/rubric configs (internal ops only): their rubric evidence is reviewed here too. */
  secrets?: SecretSimScenarioConfig[];
  /** Called with the server-verified evidence after an approval, so the Studio's local draft shows it. */
  onEvidenceApproved?: (evidence: ClaimEvidence) => void;
  hasUnsavedChanges?: boolean;
  /** Called after the server rebinds the draft, so the Studio's local draft and Sim contexts follow. */
  onDraftRebound?: (sourceRevision: string) => void;
}) {
  const bundleId = draft.sourceBundleId ?? null;
  const [review, setReview] = useState<SourceReviewData>(EMPTY_REVIEW);
  const [loading, setLoading] = useState(Boolean(bundleId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [transcriptionPageId, setTranscriptionPageId] = useState<string | null>(null);
  const [transcriptionText, setTranscriptionText] = useState('');
  const [rebindProblems, setRebindProblems] = useState<RebindProblem[]>([]);

  const load = useCallback(async () => {
    if (!bundleId) {
      setReview(EMPTY_REVIEW);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setReview(await fetchSourceReview(trackId, bundleId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Source Review did not load.');
    } finally {
      setLoading(false);
    }
  }, [trackId, bundleId]);

  useEffect(() => { void load(); }, [load]);

  const claims = useMemo(() => claimsForDraft(draft, secrets), [draft, secrets]);
  const gate = useMemo(() => evaluatePublicationGates({ draft, ...review, secrets }), [draft, review, secrets]);
  const filteredClaims = useMemo(() => claims.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'critical') return item.evidence.critical;
    const verified = verifyClaimEvidence(item.evidence, review.pages, review.conflicts);
    if (filter === 'unsupported') return verified.support !== 'supported';
    if (filter === 'conflicted') return verified.support === 'conflicted';
    return item.evidence.excerpts.some((ref) => (pageFor(review.pages, ref)?.extractionFlags.length ?? 0) > 0);
  }), [claims, filter, review.pages, review.conflicts]);
  const selectedClaim = filteredClaims.find((item) => item.evidence.id === selectedClaimId) ?? filteredClaims[0] ?? null;
  const selectedPage = review.pages.find((page) => page.id === transcriptionPageId) ?? null;
  const staleClaims = claims.filter((item) => item.evidence.excerpts.some((ref) => {
    const document = review.bundle?.documents.find((candidate) => candidate.id === ref.documentId);
    return !document || document.revisionId !== ref.revisionId;
  }));

  const revisionIssues = gate.issues.filter((issue) => REBINDABLE_CODES.has(issue.code));
  const bundleApprovedNow = Boolean(
    review.bundle &&
    (review.bundle.status === 'approved' || review.bundle.status === 'published') &&
    review.bundle.approvedSourceRevision === review.bundle.revisionHash &&
    review.bundle.approvedByUid,
  );
  const canRebind = revisionIssues.length > 0 && bundleApprovedNow && review.bundle?.id === draft.sourceBundleId;

  async function rebind() {
    if (!bundleId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setRebindProblems([]);
    try {
      const result = await rebindDraftToSource(trackId, bundleId, review.bundle?.revisionHash);
      onDraftRebound?.(result.sourceRevision);
      await load();
      setRebindProblems(result.warnings);
      setNotice(
        `Draft rebound to the approved source revision after every approved excerpt re-verified exactly.${result.warnings.length > 0 ? ` ${result.warnings.length} unapproved excerpt${result.warnings.length === 1 ? ' still does' : 's still do'} not match and stay blocked below.` : ''}`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The draft was not rebound.');
      if (cause instanceof RebindDraftError) setRebindProblems(cause.mismatches);
    } finally {
      setBusy(false);
    }
  }

  async function save(action: SourceReviewAction, body: Record<string, unknown>, message: string) {
    if (!bundleId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await postSourceReview(trackId, action, {
        bundleId,
        expectedRevisionHash: review.bundle?.revisionHash,
        ...body,
      });
      const approved = action === 'excerpt' ? approvedEvidenceFrom(result) : null;
      if (approved) onEvidenceApproved?.(approved);
      await load();
      setNotice(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Source Review change did not save.');
    } finally {
      setBusy(false);
    }
  }

  async function rematch(evidenceId: string) {
    if (!bundleId || hasUnsavedChanges) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const evidence = await rematchEvidence(trackId, bundleId, evidenceId, review.bundle?.revisionHash);
      onEvidenceApproved?.(evidence);
      await load();
      setNotice('Exact source passage found. Read it against the claim, then approve it.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The exact source passage was not found.');
    } finally {
      setBusy(false);
    }
  }

  async function pick(evidenceId: string, page: SourcePageEvidence, exactText: string) {
    if (!bundleId || hasUnsavedChanges) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const evidence = await pickExcerpt(trackId, { bundleId, evidenceId, pageId: page.id, exactText, expectedRevisionHash: review.bundle?.revisionHash });
      onEvidenceApproved?.(evidence);
      await load();
      setNotice('Excerpt replaced with the sentence you picked. Check it states the claim, then approve it.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The excerpt was not saved.');
    } finally {
      setBusy(false);
    }
  }

  function choosePage(page: SourcePageEvidence) {
    setTranscriptionPageId(page.id);
    setTranscriptionText(page.transcription?.text ?? page.normalizedText);
  }

  return (
    <div className="flex flex-col gap-5" data-testid="source-review">
      <section className="pulse-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-pulse-indigo">
              <ShieldCheck aria-hidden className="size-4" /> Source of truth
            </p>
            <h2 className="mt-1 text-xl font-bold">Source Review</h2>
            <p className="mt-1 max-w-3xl text-sm text-pulse-secondary">
              Verify exact excerpts, approve operational assets and inherited rules, and resolve SME conflicts before publishing this immutable curriculum revision.
            </p>
          </div>
          <button type="button" className="pulse-btn" onClick={() => void load()} disabled={loading || busy || !bundleId}>
            <RefreshCw aria-hidden className={cn('size-4', loading && 'animate-spin')} /> Refresh
          </button>
        </div>
        <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
          <RevisionField label="Draft source revision" value={draft.sourceRevision ?? 'legacy_unknown'} />
          <RevisionField label="Bundle revision" value={review.bundle?.revisionHash ?? 'Not registered'} />
          <RevisionField label="Approved source revision" value={review.bundle?.approvedSourceRevision ?? 'Not approved'} />
          <div className="rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-1 p-3">
            <p className="text-pulse-muted">Publication gate</p>
            <p className={cn('mt-1 font-semibold', gate.eligible ? 'text-pulse-emerald' : 'text-pulse-crimson')}>
              {gate.eligible ? 'Ready to publish' : `${gate.issues.length} blocking issue${gate.issues.length === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>
        {!bundleId ? (
          <p role="alert" className="mt-4 rounded-pulse-md border border-pulse-crimson/40 bg-pulse-crimson/10 p-3 text-sm text-pulse-crimson">
            This legacy draft has no source bundle revision. Register and approve its exact source evidence; legacy_unknown cannot be published under the new gates.
          </p>
        ) : null}
        {review.bundle && review.bundle.status !== 'approved' && review.bundle.status !== 'published' ? (
          <button
            type="button"
            className="pulse-btn pulse-btn-primary mt-4"
            disabled={busy}
            onClick={() => void save('bundle', { status: 'approved' }, 'Source bundle approved for this exact revision.')}
          >
            <FileCheck2 aria-hidden className="size-4" /> Approve source bundle revision
          </button>
        ) : null}
      </section>

      {revisionIssues.length > 0 && review.bundle ? (
        <section className="pulse-card border-pulse-amber/40 p-5" aria-label="Source revision changed" data-testid="rebind-draft">
          <SectionTitle icon={<Link2 aria-hidden className="size-4" />} title="The source revision changed after this draft was built" />
          <p className="mt-1 max-w-3xl text-sm text-pulse-secondary">
            {canRebind
              ? 'Rebind the draft to the current approved revision. Pulse first re-checks every approved claim, rubric, Sim gate and asset excerpt against the current pages; it rebinds only if all of them still match exactly. All other publish gates still apply.'
              : bundleApprovedNow
                ? 'This draft was built from a different source bundle. Build a new draft from the current bundle.'
                : 'Approve the current source bundle revision first. Then you can rebind the draft to it.'}
          </p>
          {canRebind ? (
            <button
              type="button"
              className="pulse-btn pulse-btn-primary mt-3"
              disabled={busy || loading || hasUnsavedChanges}
              title={hasUnsavedChanges ? 'Save the draft first.' : undefined}
              onClick={() => void rebind()}
            >
              <Link2 aria-hidden className="size-4" /> Rebind draft to current approved revision
            </button>
          ) : null}
          {canRebind && hasUnsavedChanges ? <p className="mt-2 text-xs text-pulse-amber">Save the draft before you rebind it.</p> : null}
        </section>
      ) : null}

      {rebindProblems.length > 0 ? (
        <section className="pulse-card p-5" aria-label="Excerpts that do not match the current source">
          <SectionTitle title="Excerpts that do not match the current source pages" />
          <ul className="mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto">
            {rebindProblems.map((problem, index) => (
              <li key={`${problem.ownerId}-${index}`} className="rounded-pulse-md border border-pulse-amber/40 bg-pulse-amber/10 p-3 text-xs">
                <p className="font-medium">
                  {problem.ownerType.replaceAll('_', ' ')} <span className="pulse-metric">{problem.ownerId}</span>
                  {problem.evidenceId ? <span className="pulse-metric text-pulse-muted"> · {problem.evidenceId}</span> : null} · page {problem.pageNumber} · {problem.reason.replaceAll('_', ' ')}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-pulse-secondary">{problem.exactText}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {error ? <p role="alert" className="rounded-pulse-md border border-pulse-crimson/40 bg-pulse-crimson/10 p-3 text-sm text-pulse-crimson">{error}</p> : null}
      {notice ? <p role="status" className="rounded-pulse-md border border-pulse-emerald/40 bg-pulse-emerald/10 p-3 text-sm text-pulse-emerald">{notice}</p> : null}
      {loading ? <p role="status" className="flex items-center gap-2 text-sm text-pulse-muted"><LoaderCircle aria-hidden className="size-4 animate-spin" /> Loading persisted source evidence…</p> : null}

      <section className="pulse-card p-5">
        <SectionTitle icon={<GitBranch aria-hidden className="size-4" />} title="Documents, hashes & inheritance" />
        {review.bundle ? (
          <div className="mt-3 relative overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-xs">
              <thead className="text-pulse-muted"><tr><th className="py-2 pr-3">Order</th><th className="py-2 pr-3">Document / role</th><th className="py-2 pr-3">Version</th><th className="py-2 pr-3">Revision</th><th className="py-2 pr-3">SHA-256 content hash</th><th className="py-2">State</th></tr></thead>
              <tbody className="divide-y divide-pulse-border-subtle">
                {[...review.bundle.documents].sort((a, b) => a.inheritanceOrder - b.inheritanceOrder).map((document) => (
                  <tr key={document.id}>
                    <td className="py-3 pr-3 pulse-metric">{document.inheritanceOrder + 1}</td>
                    <td className="py-3 pr-3"><p className="font-medium">{document.fileName}</p><p className="mt-0.5 text-pulse-muted">{document.role.replaceAll('_', ' ')}</p></td>
                    <td className="py-3 pr-3">{document.sourceVersion}</td>
                    <td className="max-w-40 truncate py-3 pr-3 pulse-metric" title={document.revisionId}>{document.revisionId}</td>
                    <td className="max-w-52 truncate py-3 pr-3 pulse-metric" title={document.contentHash}>{document.contentHash}</td>
                    <td className="py-3">{document.excluded ? `Excluded: ${document.exclusionReason ?? 'no reason recorded'}` : 'Included'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-pulse-muted">Shared rule packs: {review.bundle.sharedRulePackIds.join(', ') || 'none'} · Precedence: {review.bundle.precedencePolicyId}</p>
          </div>
        ) : <Empty>No source documents are registered for this draft.</Empty>}
      </section>

      <section className="pulse-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle title="Generated claim ↔ exact source excerpt" />
          <div className="flex flex-wrap gap-1" role="group" aria-label="Evidence filters">
            {FILTERS.map((item) => (
              <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)} className={cn('rounded-pulse-sm px-2.5 py-1 text-xs font-medium', filter === item.id ? 'bg-pulse-indigo text-pulse-on-accent' : 'bg-pulse-surface-1 text-pulse-muted hover:text-pulse-primary')}>{item.label}</button>
            ))}
          </div>
        </div>
        {filteredClaims.length === 0 ? <Empty>No generated evidence matches this filter. Missing claim evidence appears in the publish gate below.</Empty> : (
          <div className="mt-4 grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
            <div className="flex max-h-[36rem] flex-col gap-1 overflow-y-auto pr-1">
              {filteredClaims.map((item) => {
                const verified = verifyClaimEvidence(item.evidence, review.pages, review.conflicts);
                return (
                  <button key={item.evidence.id} type="button" onClick={() => setSelectedClaimId(item.evidence.id)} className={cn('rounded-pulse-md border p-3 text-left', selectedClaim?.evidence.id === item.evidence.id ? 'border-pulse-indigo bg-pulse-indigo/10' : 'border-pulse-border-subtle hover:border-pulse-border')}>
                    <span className="flex flex-wrap items-center gap-1.5"><StateBadge state={item.evidence.approvalStatus === 'approved' ? 'approved' : item.evidence.reviewerUid ? 'trainer edited' : 'AI proposal'} />{item.evidence.critical ? <span className="text-[10px] font-semibold uppercase text-pulse-crimson">Critical</span> : null}</span>
                    <span className="mt-2 line-clamp-2 block text-xs font-medium">{item.evidence.claim}</span>
                    <span className="mt-1 block text-[11px] text-pulse-muted">{item.ownerKind} · {verified.support.replaceAll('_', ' ')}</span>
                  </button>
                );
              })}
            </div>
            {selectedClaim ? (
              <div className="min-w-0 rounded-pulse-md border border-pulse-border-subtle p-4">
                <p className="text-xs text-pulse-muted">{selectedClaim.ownerKind} <span className="pulse-metric">{selectedClaim.ownerId}</span> · {selectedClaim.ownerKind === 'Sim rubric' ? 'Live Call Sim' : 'Checkpoint'} <span className="pulse-metric">{selectedClaim.unitId}</span></p>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-pulse-md bg-pulse-surface-1 p-3"><p className="pulse-label">Generated claim</p><p className="mt-2 whitespace-pre-wrap text-sm">{selectedClaim.evidence.claim}</p></div>
                  <div className="flex flex-col gap-2">
                    {selectedClaim.evidence.excerpts.map((ref, index) => {
                      const page = pageFor(review.pages, ref);
                      return <div key={`${ref.documentId}-${ref.revisionId}-${ref.pageNumber}-${index}`} className="rounded-pulse-md bg-pulse-surface-1 p-3"><p className="pulse-label">Exact excerpt {index + 1} · page {ref.pageNumber}</p><p className="mt-2 whitespace-pre-wrap text-sm">{ref.exactText}</p><p className="mt-2 break-all text-[11px] text-pulse-muted">{ref.documentId} · {ref.revisionId}{ref.fromApprovedTranscription ? ' · approved transcription' : ''}{page?.extractionFlags.length ? ` · ${page.extractionFlags.join(', ')}` : ''}</p></div>;
                    })}
                  </div>
                </div>
                {selectedClaim.evidence.approvalStatus !== 'approved' ? (
                  <button type="button" className="pulse-btn pulse-btn-primary mt-4" title={hasUnsavedChanges ? 'Save the draft first.' : undefined} disabled={busy || hasUnsavedChanges || verifyClaimEvidence(selectedClaim.evidence, review.pages, review.conflicts).support !== 'supported'} onClick={() => void save('excerpt', { evidenceId: selectedClaim.evidence.id, claimId: selectedClaim.evidence.id, approvalStatus: 'approved' }, 'Exact claim evidence approved.')}>
                    <Check aria-hidden className="size-4" /> Approve exact evidence
                  </button>
                ) : <StateBadge state="approved" />}
                {hasUnsavedChanges && selectedClaim.evidence.approvalStatus !== 'approved' ? <p className="mt-2 text-xs text-pulse-amber">Save the draft before approving or changing evidence: approval applies to the saved version of this item.</p> : null}
                {verifyClaimEvidence(selectedClaim.evidence, review.pages, review.conflicts).support !== 'supported' ? (
                  <>
                    <p className="mt-2 text-xs text-pulse-amber">Approval stays unavailable until every exact excerpt matches and no open conflict affects this claim. If the excerpt only differs from the Playbook in quotes, case or line breaks, Pulse can find the exact passage; otherwise regenerate or edit the item.</p>
                    <button type="button" className="pulse-btn mt-2" disabled={busy || hasUnsavedChanges} onClick={() => void rematch(selectedClaim.evidence.id)}>
                      <RefreshCw aria-hidden className="size-4" /> Find exact source passage
                    </button>
                    <ExcerptPicker
                      claim={selectedClaim.evidence.claim}
                      pages={selectedClaim.evidence.excerpts.map((ref) => pageFor(review.pages, ref) ?? review.pages.find((page) => page.pageNumber === ref.pageNumber)).filter((page): page is SourcePageEvidence => Boolean(page))}
                      busy={busy || hasUnsavedChanges}
                      onPick={(page, sentence) => void pick(selectedClaim.evidence.id, page, sentence)}
                    />
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section className="pulse-card p-5">
        <SectionTitle title="Extraction quality & approved transcription" />
        <p className="mt-1 text-xs text-pulse-muted">Image captions do not authorize interface steps. Enter the complete synthetic screen text, then approve it as trainer-reviewed evidence.</p>
        {review.pages.length === 0 ? <Empty>No page evidence is registered.</Empty> : (
          <div className="mt-4 grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {review.pages.map((page) => <button key={page.id} type="button" onClick={() => choosePage(page)} className={cn('rounded-pulse-md border p-2.5 text-left text-xs', selectedPage?.id === page.id ? 'border-pulse-indigo bg-pulse-indigo/10' : 'border-pulse-border-subtle')}><span className="font-medium">{page.documentId} · page {page.pageNumber}</span><span className="mt-1 block text-pulse-muted">{page.characterCount} chars · {page.extractionFlags.length ? page.extractionFlags.join(', ') : 'no quality flags'}</span>{page.transcription ? <span className="mt-1 block text-pulse-emerald">Approved transcription</span> : null}</button>)}
            </div>
            {selectedPage ? <div><label className="pulse-label" htmlFor="source-transcription">Trainer transcription for {selectedPage.documentId}, page {selectedPage.pageNumber}</label><textarea id="source-transcription" className="pulse-input mt-2 min-h-48 w-full font-mono text-xs" value={transcriptionText} onChange={(event) => setTranscriptionText(event.target.value)} /><p className="mt-1 break-all text-[11px] text-pulse-muted">Page hash: {selectedPage.contentHash}</p><button type="button" className="pulse-btn pulse-btn-primary mt-3" disabled={busy || !transcriptionText.trim()} onClick={() => void save('transcription', { pageId: selectedPage.id, text: transcriptionText.trim(), approve: true }, 'Transcription approved. Exact excerpts can now be reviewed against it.')}><Check aria-hidden className="size-4" /> Save & approve transcription</button></div> : <Empty>Select a page to inspect or transcribe it.</Empty>}
          </div>
        )}
      </section>

      <section className="pulse-card p-5">
        <SectionTitle title="Inherited rules & operational assets" />
        <div className="mt-4 grid gap-5 xl:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">Shared rule packs</h3>
            {review.rulePacks.length === 0 ? <Empty>No inherited rule packs loaded.</Empty> : review.rulePacks.map((pack) => <div key={pack.id} className="mt-3 rounded-pulse-md border border-pulse-border-subtle p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium">{pack.title}</p><p className="text-xs text-pulse-muted">{pack.id} · revision {pack.revision}</p></div><StateBadge state={pack.approvalStatus === 'approved' ? 'approved' : 'AI proposal'} /></div>{pack.approvalStatus !== 'approved' ? <button type="button" className="pulse-btn mt-3" disabled={busy} onClick={() => void save('rule', { packId: pack.id, status: 'approved' }, 'Shared rule pack approved.')}>Approve rule pack</button> : null}<div className="mt-3 flex flex-col gap-2">{pack.rules.map((rule) => <div key={rule.id} className="rounded-pulse-sm bg-pulse-surface-1 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-medium">{rule.title}</p><p className="mt-1 text-xs text-pulse-secondary">{rule.statement}</p><p className="mt-1 text-[11px] text-pulse-muted">{rule.id} · {rule.severity} · {rule.applicableTrackIds.join(', ')}</p></div><StateBadge state={rule.approvalStatus === 'approved' ? 'approved' : rule.approvedByUid ? 'trainer edited' : 'AI proposal'} /></div></div>)}</div></div>)}
          </div>
          <div>
            <h3 className="text-sm font-semibold">Offers, links, dispositions & workflows</h3>
            {review.assets.length === 0 ? <Empty>No operational assets loaded.</Empty> : review.assets.map((asset) => <AssetCard key={asset.id} asset={asset} busy={busy} onApprove={() => void save('asset', { assetId: asset.id, status: 'approved' }, `Operational asset ${asset.id} approved.`)} />)}
          </div>
        </div>
      </section>

      <section className="pulse-card p-5">
        <SectionTitle title="SME conflict register" />
        <p className="mt-1 text-xs text-pulse-muted">Only the named SME decision recorded through the trainer API can resolve a conflict. Open critical conflicts block their affected content.</p>
        {review.conflicts.length === 0 ? <Empty>No source conflicts are registered.</Empty> : review.conflicts.map((conflict) => <ConflictCard key={conflict.id} conflict={conflict} busy={busy} onSave={(body, message) => void save('conflict', { conflictId: conflict.id, ...body }, message)} />)}
      </section>

      <section className="pulse-card p-5">
        <SectionTitle title="Source revision invalidation preview" />
        <p className="mt-1 text-xs text-pulse-muted">Items below reference a document revision that is not in the active bundle. They must be regenerated or re-evidenced before approval; published versions remain immutable.</p>
        {staleClaims.length === 0 ? <p className="mt-3 text-sm text-pulse-emerald">No generated claims reference stale or unknown document revisions.</p> : <ul className="mt-3 grid gap-2 sm:grid-cols-2">{staleClaims.map((item) => <li key={item.evidence.id} className="rounded-pulse-md border border-pulse-amber/40 bg-pulse-amber/10 p-3 text-xs"><span className="font-medium">{item.ownerId}</span><span className="mt-1 block text-pulse-secondary">{item.evidence.id} · {item.unitId}</span></li>)}</ul>}
        {review.conflicts.some((conflict) => conflict.downstreamInvalidationStatus !== 'not_required') ? <div className="mt-4"><p className="text-xs font-semibold">Conflict-driven invalidation</p><ul className="mt-2 flex flex-col gap-1 text-xs text-pulse-secondary">{review.conflicts.filter((conflict) => conflict.downstreamInvalidationStatus !== 'not_required').map((conflict) => <li key={conflict.id}>{conflict.id}: {conflict.downstreamInvalidationStatus} · assets {conflict.affectedAssetIds.join(', ') || 'none named'} · rules {conflict.affectedRuleIds.join(', ') || 'none named'}</li>)}</ul></div> : null}
      </section>

      <section className="pulse-card p-5" aria-live="polite">
        <div className="flex items-center justify-between gap-3"><SectionTitle title="Publish gate results" /><span className={cn('text-sm font-semibold', gate.eligible ? 'text-pulse-emerald' : 'text-pulse-crimson')}>{gate.eligible ? 'All gates pass' : 'Publication blocked'}</span></div>
        <p className="mt-1 text-xs text-pulse-muted">Checked source: <span className="pulse-metric">{gate.checkedSourceRevision}</span>. The server repeats these checks transactionally before writing a published version or its secrets.</p>
        {gate.eligible ? <p className="mt-3 flex items-center gap-2 text-sm text-pulse-emerald"><Check aria-hidden className="size-4" /> Exact evidence, approvals, inherited coverage, assets, and conflict gates pass.</p> : <ul className="mt-3 flex max-h-96 flex-col gap-2 overflow-y-auto">{gate.issues.map((issue, index) => <li key={`${issue.code}-${issue.affectedId}-${index}`} className="rounded-pulse-md border border-pulse-crimson/30 bg-pulse-crimson/5 p-3"><p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-pulse-crimson"><AlertTriangle aria-hidden className="size-3.5" />{issue.code}<span className="pulse-metric font-normal text-pulse-muted">{issue.affectedType}: {issue.affectedId}</span></p><p className="mt-1 text-sm text-pulse-secondary">{issue.message}</p></li>)}</ul>}
      </section>
    </div>
  );
}

/** Pick a verbatim sentence of the cited page as the claim's excerpt (the trainer still approves it after). */
function ExcerptPicker({ claim, pages, busy, onPick }: { claim: string; pages: SourcePageEvidence[]; busy: boolean; onPick: (page: SourcePageEvidence, sentence: string) => void }) {
  const unique = pages.filter((page, index) => pages.findIndex((other) => other.id === page.id) === index);
  if (unique.length === 0) return null;
  return (
    <details className="mt-3 rounded-pulse-md border border-pulse-border-subtle p-3" data-testid="excerpt-picker">
      <summary className="cursor-pointer text-xs font-semibold">Choose a sentence from the source page</summary>
      {unique.map((page) => (
        <div key={page.id} className="mt-2">
          <p className="pulse-label">Page {page.pageNumber}</p>
          <ul className="mt-1 flex flex-col gap-1">
            {pageSentenceChoices(claim, page).map((sentence) => (
              <li key={sentence}>
                <button type="button" className="w-full rounded-pulse-sm bg-pulse-surface-1 p-2 text-left text-xs hover:bg-pulse-surface-2" disabled={busy} aria-label={`Use this sentence: ${sentence}`} onClick={() => onPick(page, sentence)}>
                  {sentence}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </details>
  );
}

function AssetCard({ asset, busy, onApprove }: { asset: OperationalAsset; busy: boolean; onApprove: () => void }) {
  return <div className="mt-3 rounded-pulse-md border border-pulse-border-subtle p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-medium">{asset.kind === 'offer' ? asset.label : asset.kind === 'disposition' ? asset.label : asset.id}</p><p className="mt-0.5 text-xs text-pulse-muted">{asset.kind} · {asset.product} · {asset.context} · {asset.stage}</p></div><StateBadge state={asset.status === 'approved' ? 'approved' : asset.approvedByUid ? 'trainer edited' : 'AI proposal'} /></div><div className="mt-2 text-xs text-pulse-secondary">{asset.kind === 'offer' ? <p>{asset.amountCents === null ? 'Calculated offer' : `$${(asset.amountCents / 100).toFixed(2)}`}{asset.discountBasisPoints !== null ? ` · ${asset.discountBasisPoints / 100}% discount` : ''} · {asset.duration.replaceAll('_', ' ')} · sequence {asset.sequence}{asset.prerequisites.length ? ` · requires ${asset.prerequisites.join(', ')}` : ''}</p> : null}{asset.kind === 'link' ? <p className="break-all">{asset.linkType} · {asset.host} · {asset.personalized ? 'personalized' : 'not personalized'}<br />{asset.url}</p> : null}{asset.kind === 'disposition' ? <p>Required evidence: {asset.requiredEvidence.join(', ')}<br />Forbidden evidence: {asset.forbiddenEvidence.join(', ') || 'none'}</p> : null}{asset.kind === 'workflow' ? <ol className="list-decimal pl-4">{[...asset.sequence].sort((a, b) => a.order - b.order).map((step) => <li key={step.order}>{step.action}{step.screenLabel ? ` (${step.screenLabel})` : ''}</li>)}</ol> : null}</div>{asset.status === 'draft' ? <button type="button" className="pulse-btn mt-3" disabled={busy} onClick={onApprove}>Approve structured asset</button> : null}</div>;
}

function ConflictCard({ conflict, busy, onSave }: { conflict: SourceConflict; busy: boolean; onSave: (body: Record<string, unknown>, message: string) => void }) {
  const [decision, setDecision] = useState(conflict.decision ?? '');
  const open = conflict.status === 'open' || conflict.status === 'sme_review';
  return <div className="mt-3 rounded-pulse-md border border-pulse-border-subtle p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold pulse-metric">{conflict.id}</p><p className="mt-1 text-xs text-pulse-muted">{conflict.severity}{conflict.origin === 'contradiction_check' ? ' · found by the PDF contradiction check' : ` · ${conflict.affectedProducts.join(', ')} · ${conflict.affectedContexts.join(', ')} · ${conflict.affectedStages.join(', ')}`}</p>{conflict.summary ? <p className="mt-1 text-sm">{conflict.summary}</p> : null}</div><StateBadge state={open ? 'AI proposal' : 'SME resolved'} /></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{conflict.sourceRefs.map((ref, index) => <div key={index} className="rounded-pulse-sm bg-pulse-surface-1 p-3"><p className="text-[11px] text-pulse-muted">{conflict.detectedValues[index] ?? `Conflicting value ${index + 1}`} · page {ref.pageNumber}</p><p className="mt-1 text-xs">{ref.exactText}</p></div>)}</div>{open ? <div className="mt-3"><label className="pulse-label" htmlFor={`decision-${conflict.id}`}>SME decision and effective scope</label><textarea id={`decision-${conflict.id}`} className="pulse-input mt-2 min-h-24 w-full text-sm" value={decision} onChange={(event) => setDecision(event.target.value)} placeholder="Record the SME’s explicit decision; do not infer one from either excerpt." /><div className="mt-2 flex flex-wrap gap-2"><button type="button" className="pulse-btn pulse-btn-primary" disabled={busy || !decision.trim()} onClick={() => onSave({ status: 'resolved', decision: decision.trim(), downstreamInvalidationStatus: 'required' }, `${conflict.id} resolved by the recorded SME decision.`)}>Record SME resolution</button><button type="button" className="pulse-btn" disabled={busy || !decision.trim()} onClick={() => onSave({ status: 'accepted_context_difference', decision: decision.trim(), downstreamInvalidationStatus: 'required' }, `${conflict.id} recorded as an approved context difference.`)}>Accept context difference</button></div></div> : <div className="mt-3 rounded-pulse-sm bg-pulse-emerald/5 p-3 text-xs"><StateBadge state="SME resolved" /><p className="mt-2">{conflict.decision}</p><p className="mt-1 text-pulse-muted">Owner {conflict.decisionOwnerUid ?? 'unknown'} · {conflict.decidedAt ? new Date(conflict.decidedAt).toLocaleString() : 'date unavailable'} · invalidation {conflict.downstreamInvalidationStatus}</p></div>}</div>;
}

function StateBadge({ state }: { state: 'AI proposal' | 'trainer edited' | 'SME resolved' | 'approved' }) {
  return <span className={cn('inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', state === 'approved' ? 'bg-pulse-emerald/15 text-pulse-emerald' : state === 'SME resolved' ? 'bg-pulse-indigo/15 text-pulse-indigo' : state === 'trainer edited' ? 'bg-pulse-amber/15 text-pulse-amber' : 'bg-pulse-surface-2 text-pulse-muted')}>{state}</span>;
}

function RevisionField({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-1 p-3"><p className="text-pulse-muted">{label}</p><p className="mt-1 truncate font-semibold pulse-metric" title={value}>{value}</p></div>;
}

function SectionTitle({ title, icon }: { title: string; icon?: ReactNode }) {
  return <h3 className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</h3>;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="mt-3 rounded-pulse-md bg-pulse-surface-1 p-3 text-sm text-pulse-muted">{children}</p>;
}
