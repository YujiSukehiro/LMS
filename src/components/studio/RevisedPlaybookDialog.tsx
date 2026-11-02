'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import type { DivisionId } from '@/lib/schemas/domain';
import { PdfDropzone } from './PdfDropzone';
import { uploadPlaybook } from './api-client';

/**
 * Uploads a revised Playbook PDF onto an existing Track. The server regenerates the draft TrackVersion;
 * the published TrackVersion and all learner records stay intact until the next publish.
 */
export function RevisedPlaybookDialog({
  trackId,
  title,
  campaignCode,
  divisionId,
  hasUnsavedChanges,
}: {
  trackId: string;
  title: string;
  campaignCode: string;
  divisionId: DivisionId;
  hasUnsavedChanges: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onUpload() {
    if (!file) {
      setError('Add the revised Playbook PDF.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await uploadPlaybook({ file, title, campaignCode, divisionId, trackId });
      router.push(`/studio/new?trackId=${encodeURIComponent(result.trackId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The Playbook upload failed.');
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="pulse-btn"
        onClick={() => {
          setError(null);
          dialogRef.current?.showModal();
        }}
      >
        <FileUp aria-hidden className="size-4" />
        <span className="hidden xl:inline">Upload Revised Playbook</span>
        <span className="xl:hidden">Revise PDF</span>
      </button>
      <dialog ref={dialogRef} className="pulse-dialog" aria-labelledby="revised-playbook-title">
        <div className="flex items-start justify-between gap-3 border-b border-pulse-border px-5 py-4">
          <div>
            <h2 id="revised-playbook-title" className="text-base font-semibold">
              Upload Revised Playbook
            </h2>
            <p className="mt-0.5 text-xs text-pulse-muted">{title}</p>
          </div>
          <button type="button" className="pulse-btn pulse-btn-ghost px-2" onClick={() => dialogRef.current?.close()} aria-label="Close">
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <div className="flex flex-col gap-4 px-5 py-5">
          <p className="text-sm text-pulse-secondary">
            Pulse builds a new draft from the revised PDF. Agents keep training on the published TrackVersion until you publish
            again.
          </p>
          <p className="flex items-start gap-2 rounded-pulse-md border border-pulse-amber/40 bg-pulse-amber/10 px-3 py-2 text-xs text-pulse-amber">
            <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            The new draft replaces the current draft{hasUnsavedChanges ? ', including your unsaved changes' : ''}.
          </p>
          <PdfDropzone file={file} onFileChange={setFile} disabled={busy} label="Revised Playbook PDF" />
          {error ? (
            <p role="alert" className="text-sm text-pulse-crimson">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="pulse-btn pulse-btn-ghost" onClick={() => dialogRef.current?.close()} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="pulse-btn pulse-btn-primary" onClick={onUpload} disabled={busy || !file}>
              {busy ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <FileUp aria-hidden className="size-4" />}
              {busy ? 'Uploading…' : 'Upload and Rebuild Draft'}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
