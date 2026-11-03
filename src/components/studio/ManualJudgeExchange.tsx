'use client';

import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Download, FileUp, LoaderCircle, ShieldCheck } from 'lucide-react';
import { ApiErrorBodySchema } from '@/lib/schemas/api';
import {
  manualJudgeExportTaskId,
  manualJudgePackageFileName,
  parseManualJudgeResultSummary,
  validateManualJudgeResultFile,
  type ManualJudgeResultSummary,
} from './manual-judge-ui-helpers';

type BusyAction = 'export' | 'import' | null;

function serverErrorMessage(raw: string, status: number, fallback: string): string {
  try {
    const parsed = ApiErrorBodySchema.safeParse(JSON.parse(raw));
    if (parsed.success && parsed.data.message) return parsed.data.message;
  } catch {
    // A non-JSON or malformed error response gets the generic safe message below.
  }
  return `${fallback} (HTTP ${status}).`;
}

function downloadPackage(raw: string, sessionId: string): void {
  const blob = new Blob([raw], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = manualJudgePackageFileName(sessionId);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Trainer-only manual Judge exchange. The exported response is downloaded verbatim and never rendered or logged.
 * `sessionId` is an initial prefill; the trainer can edit it before exporting.
 */
export function ManualJudgeExchange({ sessionId: initialSessionId }: { sessionId?: string }) {
  const idPrefix = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const [sessionId, setSessionId] = useState(initialSessionId ?? '');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [externalProvider, setExternalProvider] = useState('');
  const [externalModel, setExternalModel] = useState('');
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<ManualJudgeResultSummary | null>(null);

  const sessionInputId = `${idPrefix}-session`;
  const fileInputId = `${idPrefix}-result-file`;
  const providerInputId = `${idPrefix}-provider`;
  const modelInputId = `${idPrefix}-model`;
  const fileHelpId = `${idPrefix}-file-help`;

  useEffect(() => {
    if (error) errorRef.current?.focus();
    else if (result) resultRef.current?.focus();
    else if (notice) noticeRef.current?.focus();
  }, [error, notice, result]);

  function clearOutcome(): void {
    setError(null);
    setNotice(null);
    setResult(null);
  }

  function onSessionChange(value: string): void {
    setSessionId(value);
    setTaskId(null);
    clearOutcome();
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const selected = event.currentTarget.files?.[0] ?? null;
    clearOutcome();
    if (!selected) {
      setFile(null);
      return;
    }
    const problem = validateManualJudgeResultFile(selected);
    if (problem) {
      setFile(null);
      setError(problem);
      event.currentTarget.value = '';
      return;
    }
    setFile(selected);
  }

  async function onExport(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const requestedSessionId = sessionId.trim();
    if (!requestedSessionId) {
      clearOutcome();
      setError('Enter a synthetic Simulation session ID.');
      return;
    }

    setBusy('export');
    setTaskId(null);
    clearOutcome();
    try {
      const response = await fetch(
        `/api/simulations/${encodeURIComponent(requestedSessionId)}/manual-judge/export`,
        { method: 'POST', cache: 'no-store' },
      );
      const raw = await response.text();
      if (!response.ok) throw new Error(serverErrorMessage(raw, response.status, 'The manual judge package could not be exported'));

      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new Error('The server sent an unexpected manual judge export response.');
      }
      const exportedTaskId = manualJudgeExportTaskId(body, requestedSessionId);
      if (!exportedTaskId) throw new Error('The server sent an unexpected manual judge export response.');

      downloadPackage(raw, requestedSessionId);
      setSessionId(requestedSessionId);
      setTaskId(exportedTaskId);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setNotice('Manual judge package downloaded. Choose the external result file to continue.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The manual judge package could not be exported.');
    } finally {
      setBusy(null);
    }
  }

  async function onImport(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    clearOutcome();
    const fileProblem = file ? validateManualJudgeResultFile(file) : 'Choose a .json or .txt result file.';
    if (!taskId) {
      setError('Export a manual judge package for this Simulation session before importing a result.');
      return;
    }
    if (fileProblem || !file) {
      setError(fileProblem ?? 'Choose a result file.');
      return;
    }
    if (!externalProvider.trim() || !externalModel.trim()) {
      setError('Enter honest external provider and model labels.');
      return;
    }

    setBusy('import');
    try {
      let input: string;
      try {
        input = await file.text();
      } catch {
        throw new Error('The selected result file could not be read. Choose it again.');
      }
      if (!input.trim()) throw new Error('The selected result file is empty.');

      const response = await fetch(
        `/api/simulations/${encodeURIComponent(sessionId.trim())}/manual-judge/import`,
        {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId,
            input,
            externalProvider: externalProvider.trim(),
            externalModel: externalModel.trim(),
          }),
        },
      );
      const raw = await response.text();
      if (!response.ok) throw new Error(serverErrorMessage(raw, response.status, 'The manual judge result could not be imported'));

      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new Error('The server sent an unexpected manual judge import response.');
      }
      const summary = parseManualJudgeResultSummary(body);
      if (!summary) throw new Error('The server sent an unexpected manual judge import response.');
      setResult(summary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The manual judge result could not be imported.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="pulse-card flex min-w-0 flex-col gap-5 p-4 sm:p-5" aria-labelledby={`${idPrefix}-title`}>
      <header>
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-pulse-indigo">
          <ShieldCheck aria-hidden className="size-4" /> Trainer-only · synthetic sessions
        </p>
        <h2 id={`${idPrefix}-title`} className="mt-1 text-xl font-bold">Manual Judge exchange</h2>
        <p className="mt-1 max-w-3xl text-sm text-pulse-secondary">
          Complete wrap-up and a valid disposition, and confirm supported, trainer-approved exact source excerpts for every rubric criterion before export.
          Deterministic gates, eligibility, and disposition checks remain authoritative and cannot be reversed by an external judge.
        </p>
      </header>

      <form className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end" onSubmit={(event) => void onExport(event)} noValidate>
        <fieldset disabled={busy !== null} className="min-w-0">
          <label className="pulse-label" htmlFor={sessionInputId}>Synthetic Simulation session ID</label>
          <input
            id={sessionInputId}
            className="pulse-input pulse-metric mt-1.5 w-full"
            type="text"
            value={sessionId}
            onChange={(event) => onSessionChange(event.target.value)}
            placeholder="Enter the synthetic session ID"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </fieldset>
        <button
          type="submit"
          className="pulse-btn pulse-btn-primary w-full md:w-auto"
          disabled={busy !== null || !sessionId.trim()}
        >
          {busy === 'export' ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Download aria-hidden className="size-4" />}
          {busy === 'export' ? 'Exporting…' : 'Export & Download Package'}
        </button>
      </form>

      <form className="flex flex-col gap-4 rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-1 p-3 sm:p-4" onSubmit={(event) => void onImport(event)} noValidate>
        <fieldset disabled={busy !== null} className="grid min-w-0 gap-4">
          <legend className="text-sm font-semibold">Import an external Judge result</legend>
          <p className="text-xs text-pulse-muted">Export a current package first. Its task ID is bound automatically; package and rubric contents stay hidden here.</p>
          <div className="min-w-0">
            <label className="pulse-label" htmlFor={fileInputId}>Judge result file</label>
            <input
              ref={fileInputRef}
              id={fileInputId}
              className="pulse-input mt-1.5 block w-full file:mr-3 file:rounded-pulse-sm file:border-0 file:bg-pulse-surface-2 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-pulse-primary"
              type="file"
              accept=".json,.txt"
              aria-describedby={fileHelpId}
              onChange={onFileChange}
              required
            />
            <p id={fileHelpId} className="mt-1.5 break-words text-xs text-pulse-muted">
              .json or .txt only, up to 2 MB.{file ? ` Selected: ${file.name}` : ''}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="pulse-label" htmlFor={providerInputId}>External provider label</label>
              <input
                id={providerInputId}
                className="pulse-input mt-1.5 w-full"
                type="text"
                value={externalProvider}
                onChange={(event) => setExternalProvider(event.target.value)}
                maxLength={120}
                autoComplete="off"
                required
              />
            </div>
            <div>
              <label className="pulse-label" htmlFor={modelInputId}>External model label</label>
              <input
                id={modelInputId}
                className="pulse-input mt-1.5 w-full"
                type="text"
                value={externalModel}
                onChange={(event) => setExternalModel(event.target.value)}
                maxLength={120}
                autoComplete="off"
                required
              />
            </div>
          </div>
        </fieldset>
        <button
          type="submit"
          className="pulse-btn w-full self-end sm:w-auto"
          disabled={busy !== null || !taskId || !file || !externalProvider.trim() || !externalModel.trim()}
        >
          {busy === 'import' ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <FileUp aria-hidden className="size-4" />}
          {busy === 'import' ? 'Importing…' : 'Import & Record Result'}
        </button>
      </form>

      <div aria-live="polite" aria-atomic="true">
        {busy ? (
          <p role="status" className="flex items-center gap-2 text-sm text-pulse-muted">
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            {busy === 'export' ? 'Preparing the server export and download…' : 'Validating and recording the server result…'}
          </p>
        ) : notice ? (
          <p ref={noticeRef} role="status" tabIndex={-1} className="w-fit rounded-pulse-md bg-pulse-emerald/10 px-3 py-2 text-sm text-pulse-emerald">
            {notice}
          </p>
        ) : null}
      </div>

      {error ? (
        <p
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="rounded-pulse-md border border-pulse-crimson/40 bg-pulse-crimson/10 px-3 py-2 text-sm text-pulse-crimson"
        >
          {error}
        </p>
      ) : null}

      {result ? (
        <section
          ref={resultRef}
          tabIndex={-1}
          aria-labelledby={`${idPrefix}-result-title`}
          className="rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-1 p-4"
        >
          <h3 id={`${idPrefix}-result-title`} className="text-sm font-semibold">Recorded server result</h3>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ResultMetric label="Score" value={`${result.score}%`} />
            <ResultMetric label="Pass" value={result.passed ? 'Yes' : 'No'} />
            <ResultMetric label="Certified" value={result.certified && !result.demoReplay ? 'Yes' : 'No'} />
            <ResultMetric label="Demo replay" value={result.demoReplay ? 'Yes' : 'No'} />
          </dl>
          <p className="mt-3 text-xs text-pulse-muted">
            This is the server-recorded verdict after deterministic assessment. Replay and draft results do not certify learners, even when a score or pass is shown.
          </p>
        </section>
      ) : null}
    </section>
  );
}

function ResultMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-pulse-md bg-pulse-surface-2 p-3">
      <dt className="text-xs text-pulse-muted">{label}</dt>
      <dd className="mt-1 text-lg font-bold pulse-metric">{value}</dd>
    </div>
  );
}
