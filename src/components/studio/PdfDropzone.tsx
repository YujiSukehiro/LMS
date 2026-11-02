'use client';

import { useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { FileText, FileUp, X } from 'lucide-react';
import { PDF_LIMITS } from '@/lib/schemas/constants';
import { cn } from '@/lib/utils';

const MAX_MB = Math.round(PDF_LIMITS.maxBytes / (1024 * 1024));

/** Returns a plain-English problem with the file, or null when it is an acceptable Playbook PDF. */
export function validatePlaybookFile(file: File): string | null {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return 'The Playbook must be a PDF file (.pdf).';
  if (file.size === 0) return 'This PDF file is empty.';
  if (file.size > PDF_LIMITS.maxBytes) return `The PDF is larger than ${MAX_MB} MB. Use a smaller Playbook file.`;
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Drag-and-drop zone for one Playbook PDF (≤ 20 MB) with client validation. */
export function PdfDropzone({
  file,
  onFileChange,
  disabled,
  label = 'Playbook PDF',
}: {
  file: File | null;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
  label?: ReactNode;
}) {
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function accept(candidate: File | undefined) {
    if (!candidate) return;
    const problem = validatePlaybookFile(candidate);
    if (problem) {
      setError(problem);
      onFileChange(null);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setError(null);
    onFileChange(candidate);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const files = event.dataTransfer.files;
    if (files.length > 1) {
      setError('Drop one PDF file only.');
      return;
    }
    accept(files[0]);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      {file ? (
        <div className="flex items-center gap-3 rounded-pulse-md border border-pulse-emerald/40 bg-pulse-emerald/10 px-4 py-3">
          <FileText aria-hidden className="size-6 shrink-0 text-pulse-emerald" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="pulse-metric text-xs text-pulse-muted">{formatBytes(file.size)}</p>
          </div>
          <button
            type="button"
            className="pulse-btn pulse-btn-ghost px-2"
            onClick={() => {
              onFileChange(null);
              if (inputRef.current) inputRef.current.value = '';
            }}
            disabled={disabled}
            aria-label="Remove the selected PDF"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-pulse-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
            dragging ? 'border-pulse-indigo bg-pulse-indigo/10' : 'border-pulse-border hover:border-pulse-indigo/60 hover:bg-pulse-surface-2/50',
            error && 'border-pulse-crimson/60',
            disabled && 'pointer-events-none opacity-60',
          )}
        >
          <FileUp aria-hidden className={cn('size-8', dragging ? 'text-pulse-indigo' : 'text-pulse-muted')} />
          <span className="text-sm font-semibold">Drag and drop the Playbook PDF here</span>
          <span className="text-xs text-pulse-muted">or click to select a file · PDF up to {MAX_MB} MB</span>
        </label>
      )}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        disabled={disabled}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => accept(e.target.files?.[0])}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-pulse-crimson">
          {error}
        </p>
      ) : null}
    </div>
  );
}
