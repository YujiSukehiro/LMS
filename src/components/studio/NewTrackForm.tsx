'use client';

import { useState, type FormEvent } from 'react';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { DivisionIdSchema, type DivisionId } from '@/lib/schemas/domain';
import { DIVISION_LABELS } from '@/lib/schemas/constants';
import { cn } from '@/lib/utils';
import { DIVISION_PILL_CLASS } from '@/components/layout/labels';
import { PdfDropzone, validatePlaybookFile } from './PdfDropzone';
import { GenerationStepper } from './GenerationStepper';
import { uploadPlaybook } from './api-client';
import { ContentMapStep } from './ContentMapStep';
import { CreationSteps } from './CreationSteps';

interface FormErrors {
  division?: string;
  title?: string;
  campaignCode?: string;
  file?: string;
  submit?: string;
}

/**
 * The 3-input "Upload PDF & Go" screen: Division, Track title (+ optional code), Playbook PDF.
 * `resume` opens an uploaded Track that has not been built yet directly on its Content map
 * (after a reload of /studio/new?trackId=… or a revised Playbook upload).
 */
export function NewTrackForm({ resume }: { resume?: { trackId: string; title: string } } = {}) {
  const [divisionId, setDivisionId] = useState<DivisionId | null>(null);
  const [title, setTitle] = useState('');
  const [campaignCode, setCampaignCode] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<{ trackId: string; title: string } | null>(resume ?? null);
  const [building, setBuilding] = useState(false);
  // Set when the trainer clicked "Approve source and build N" on the Content map (0 = "Build anyway" without a map).
  const [approvedTarget, setApprovedTarget] = useState<number | null>(null);

  function validate(): FormErrors {
    const next: FormErrors = {};
    if (!divisionId) next.division = 'Select a Division.';
    const trimmed = title.trim();
    if (trimmed.length < 3) next.title = 'Type a Track title with 3 or more characters.';
    else if (trimmed.length > 100) next.title = 'The Track title must be 100 characters or fewer.';
    if (campaignCode.trim().length > 32) next.campaignCode = 'The campaign code must be 32 characters or fewer.';
    if (!file) next.file = 'Add the Playbook PDF.';
    else {
      const problem = validatePlaybookFile(file);
      if (problem) next.file = problem;
    }
    return next;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0 || !divisionId || !file) return;
    setSubmitting(true);
    try {
      const result = await uploadPlaybook({
        file,
        title: title.trim(),
        campaignCode: campaignCode.trim().toUpperCase(),
        divisionId,
      });
      setCreated({ trackId: result.trackId, title: title.trim() });
      window.history.replaceState(null, '', `/studio/new?trackId=${encodeURIComponent(result.trackId)}`);
    } catch (error) {
      setErrors({ submit: error instanceof Error ? error.message : 'The Playbook upload failed.' });
    } finally {
      setSubmitting(false);
    }
  }

  if (created && !building) {
    return (
      <div className="flex flex-col gap-4">
        <CreationSteps current={1} />
        <ContentMapStep
          trackId={created.trackId}
          onBuild={(unitTarget) => {
            setApprovedTarget(unitTarget);
            setBuilding(true);
          }}
        />
      </div>
    );
  }

  if (created) {
    return (
      <div className="flex flex-col gap-4">
        <CreationSteps current={2} />
        <GenerationStepper
          trackId={created.trackId}
          trackTitle={created.title}
          initialProgress={{ step: 'EXTRACTING_PDF', percent: 5, message: 'Playbook uploaded. Starting the build…' }}
          approvedOnContentMap={approvedTarget !== null && approvedTarget > 0}
          unitTarget={approvedTarget && approvedTarget > 0 ? approvedTarget : null}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <CreationSteps current={0} />
      <form onSubmit={onSubmit} noValidate className="pulse-card flex flex-col gap-6 p-5 md:p-6">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold">
            <span className="pulse-metric mr-2 text-pulse-muted">1</span>Division
          </legend>
          <div role="radiogroup" aria-label="Division" className="flex flex-wrap gap-2">
            {DivisionIdSchema.options.map((id) => {
              const selected = divisionId === id;
              return (
                <label
                  key={id}
                  className={cn(
                    'pulse-pill cursor-pointer px-4 py-2 text-sm transition-colors',
                    selected ? DIVISION_PILL_CLASS[id] : 'hover:border-pulse-muted',
                    selected && 'ring-2 ring-current/40',
                  )}
                >
                  <input
                    type="radio"
                    name="divisionId"
                    value={id}
                    checked={selected}
                    onChange={() => setDivisionId(id)}
                    className="sr-only"
                    disabled={submitting}
                  />
                  <span aria-hidden className="size-2 rounded-full bg-current" />
                  {DIVISION_LABELS[id]}
                </label>
              );
            })}
          </div>
          {errors.division ? <p className="text-xs text-pulse-crimson">{errors.division}</p> : null}
        </fieldset>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold">
            <span className="pulse-metric mr-2 text-pulse-muted">2</span>Track title
          </span>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <label className="flex flex-col gap-1">
              <span className="sr-only">Track title</span>
              <input
                className="pulse-input placeholder:text-pulse-muted/60"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. NeuroCalmRx Recovery Calling"
                maxLength={100}
                disabled={submitting}
                aria-invalid={Boolean(errors.title)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="sr-only">Campaign code (optional)</span>
              <input
                className="pulse-input pulse-metric uppercase"
                value={campaignCode}
                onChange={(e) => setCampaignCode(e.target.value)}
                placeholder="Code (optional)"
                maxLength={32}
                disabled={submitting}
                aria-invalid={Boolean(errors.campaignCode)}
              />
            </label>
          </div>
          {errors.title ? <p className="text-xs text-pulse-crimson">{errors.title}</p> : null}
          {errors.campaignCode ? <p className="text-xs text-pulse-crimson">{errors.campaignCode}</p> : null}
        </div>

        <div className="flex flex-col gap-1">
          <PdfDropzone
            file={file}
            onFileChange={(next) => {
              setFile(next);
              if (next) setErrors((prev) => ({ ...prev, file: undefined }));
            }}
            disabled={submitting}
            label={
              <>
                <span className="pulse-metric mr-2 text-pulse-muted">3</span>Playbook PDF
              </>
            }
          />
          {errors.file && !file ? <p className="text-xs text-pulse-crimson">{errors.file}</p> : null}
        </div>

        {errors.submit ? (
          <p role="alert" className="rounded-pulse-md border border-pulse-crimson/40 bg-pulse-crimson/10 px-3 py-2 text-sm text-pulse-crimson">
            {errors.submit}
          </p>
        ) : null}

        <div className="flex justify-end">
          <button type="submit" className="pulse-btn pulse-btn-primary px-5 py-2.5 text-base" disabled={submitting}>
            {submitting ? (
              <>
                <LoaderCircle aria-hidden className="size-4 animate-spin" />
                Uploading Playbook…
              </>
            ) : (
              <>
                Upload and map content
                <ArrowRight aria-hidden className="size-4" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
