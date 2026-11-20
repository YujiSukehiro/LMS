'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Download, Loader2, Upload, X } from 'lucide-react';
import { RosterImportResponseSchema, type RosterImportResponse } from '@/lib/schemas/api';
import { ROLE_LABELS } from '@/lib/schemas/constants';
import { cn } from '@/lib/utils';
import { parseRosterCsv, ROSTER_CSV_COLUMNS } from './roster-csv';

const EXAMPLE_CSV = [
  ROSTER_CSV_COLUMNS.join(','),
  'Maria Fernanda Lopez,LC-1101,,AGENT,THS,TELEHEALTH|INBOUND',
  'Jordan Blake,,jordan.blake@partner-example.com,PARTNER_SUPERVISOR,DOZ,INBOUND',
].join('\n');

export function BulkImportDialog({
  cohorts,
  canCreateSuperAdmin,
}: {
  cohorts: Array<{ id: string; name: string }>;
  canCreateSuperAdmin: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [csvText, setCsvText] = useState('');
  const [pending, setPending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [result, setResult] = useState<RosterImportResponse | null>(null);
  const [submittedLineNumbers, setSubmittedLineNumbers] = useState<number[]>([]);

  const cohortIds = useMemo(() => new Set(cohorts.map((cohort) => cohort.id)), [cohorts]);
  const lines = useMemo(() => {
    return parseRosterCsv(csvText).map((line) => {
      if (!line.row) return line;
      if (!cohortIds.has(line.row.partnerCohortId)) {
        return { ...line, row: null, error: `Cohort "${line.row.partnerCohortId}" does not exist.` };
      }
      if (line.row.role === 'SUPER_ADMIN' && !canCreateSuperAdmin) {
        return { ...line, row: null, error: 'Only a Super Admin can create a Super Admin account.' };
      }
      return line;
    });
  }, [csvText, cohortIds, canCreateSuperAdmin]);

  const validRows = lines.flatMap((line) => (line.row ? [line.row] : []));
  const invalidCount = lines.length - validRows.length;
  const tooMany = validRows.length > 500;

  function open(): void {
    setRequestError(null);
    setResult(null);
    dialogRef.current?.showModal();
  }

  function close(): void {
    dialogRef.current?.close();
  }

  async function submit(): Promise<void> {
    if (validRows.length === 0 || invalidCount > 0 || tooMany) return;
    setPending(true);
    setRequestError(null);
    setSubmittedLineNumbers(lines.map((line) => line.lineNumber));
    try {
      const response = await fetch('/api/roster/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: validRows }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
        throw new Error(typeof record.message === 'string' ? record.message : 'The import failed. Try again.');
      }
      const parsed = RosterImportResponseSchema.parse(body);
      setResult(parsed);
      if (parsed.createdCount > 0) {
        setCsvText('');
        router.refresh();
      }
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'The import failed. Try again.');
    } finally {
      setPending(false);
    }
  }

  function downloadCredentials(): void {
    if (!result) return;
    const blob = new Blob([result.credentialsCsv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `pulse-roster-credentials-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <>
      <button type="button" className="pulse-btn pulse-btn-primary" onClick={open}>
        <Upload className="h-4 w-4" aria-hidden="true" />
        Bulk Import
      </button>
      <dialog
        ref={dialogRef}
        className="pulse-dialog"
        style={{ width: 'min(920px, calc(100vw - 2rem))' }}
        aria-labelledby="bulk-import-title"
      >
        <div className="flex max-h-[calc(100vh-4rem)] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-pulse-border-subtle p-6">
            <div>
              <h2 id="bulk-import-title" className="text-lg font-semibold">
                Bulk Import Roster
              </h2>
              <p className="mt-1 text-sm text-pulse-secondary">
                Paste CSV rows. Columns: <span className="pulse-metric text-xs">{ROSTER_CSV_COLUMNS.join(',')}</span>.
                Separate Divisions with <span className="pulse-kbd">|</span>. An optional 7th column sets the initial
                password; otherwise Pulse makes a strong temporary password.
              </p>
            </div>
            <button type="button" className="pulse-btn pulse-btn-ghost p-1.5" aria-label="Close" onClick={close}>
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {result ? (
              <div className="space-y-3">
                <p className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-pulse-emerald" aria-hidden="true" />
                  <span>
                    <span className="pulse-metric font-semibold">{result.createdCount}</span> account
                    {result.createdCount === 1 ? '' : 's'} created.
                  </span>
                </p>
                {result.createdCount > 0 ? (
                  <div className="rounded-pulse-md border border-pulse-amber/50 bg-pulse-amber/10 p-3 text-sm text-pulse-secondary">
                    Download the credentials file now. Pulse does not keep a copy of the temporary passwords.
                    <div className="mt-3">
                      <button type="button" className="pulse-btn pulse-btn-success" onClick={downloadCredentials}>
                        <Download className="h-4 w-4" aria-hidden="true" />
                        Download credentials CSV
                      </button>
                    </div>
                  </div>
                ) : null}
                {result.errors.length > 0 ? (
                  <div className="rounded-pulse-md border border-pulse-crimson/50 bg-pulse-crimson/10 p-3 text-sm">
                    <p className="font-medium text-pulse-crimson">{result.errors.length} row(s) were not imported:</p>
                    <ul className="mt-2 space-y-1 text-pulse-secondary">
                      {result.errors.map((entry) => (
                        <li key={entry.rowIndex}>
                          Line {submittedLineNumbers[entry.rowIndex] ?? entry.rowIndex + 1}: {entry.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <button type="button" className="pulse-btn" onClick={() => setResult(null)}>
                  Import more rows
                </button>
              </div>
            ) : (
              <>
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label htmlFor="bulk-import-csv" className="pulse-label">
                      CSV rows
                    </label>
                    <button
                      type="button"
                      className="text-xs font-medium text-pulse-indigo hover:underline"
                      onClick={() => setCsvText(EXAMPLE_CSV)}
                    >
                      Insert example
                    </button>
                  </div>
                  <textarea
                    id="bulk-import-csv"
                    className="pulse-textarea min-h-36 w-full font-mono text-xs"
                    spellCheck={false}
                    placeholder={EXAMPLE_CSV}
                    value={csvText}
                    onChange={(event) => setCsvText(event.target.value)}
                    disabled={pending}
                  />
                </div>

                {lines.length > 0 ? (
                  <div>
                    <p className="pulse-label mb-2">
                      Preview · {validRows.length} ready{invalidCount > 0 ? ` · ${invalidCount} with errors` : ''}
                    </p>
                    <div className="relative overflow-x-auto rounded-pulse-md border border-pulse-border-subtle">
                      <table className="w-full min-w-[720px] text-left text-xs">
                        <thead className="bg-pulse-surface-2">
                          <tr>
                            <th scope="col" className="px-3 py-2">Line</th>
                            <th scope="col" className="px-3 py-2">Name</th>
                            <th scope="col" className="px-3 py-2">Sign-in</th>
                            <th scope="col" className="px-3 py-2">Role</th>
                            <th scope="col" className="px-3 py-2">Cohort</th>
                            <th scope="col" className="px-3 py-2">Divisions</th>
                            <th scope="col" className="px-3 py-2">Check</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map((line) => (
                            <tr
                              key={line.lineNumber}
                              className={cn('border-t border-pulse-border-subtle', line.error && 'bg-pulse-crimson/5')}
                            >
                              <td className="pulse-metric px-3 py-2 text-pulse-muted">{line.lineNumber}</td>
                              <td className="px-3 py-2">{line.row?.displayName ?? line.cells[0] ?? ''}</td>
                              <td className="pulse-metric px-3 py-2">
                                {line.row ? (line.row.lcNumber ?? line.row.email) : (line.cells[1] || line.cells[2] || '')}
                              </td>
                              <td className="px-3 py-2">{line.row ? ROLE_LABELS[line.row.role] : (line.cells[3] ?? '')}</td>
                              <td className="px-3 py-2">{line.row?.partnerCohortId ?? line.cells[4] ?? ''}</td>
                              <td className="px-3 py-2">{line.row ? line.row.divisionIds.join(', ') : (line.cells[5] ?? '')}</td>
                              <td className="px-3 py-2">
                                {line.error ? (
                                  <span className="inline-flex items-center gap-1 text-pulse-crimson">
                                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                    {line.error}
                                  </span>
                                ) : (
                                  <span className="text-pulse-emerald">Ready</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {tooMany ? <p className="text-sm text-pulse-crimson">Import 500 rows or fewer at a time.</p> : null}
                {requestError ? (
                  <p role="alert" className="text-sm text-pulse-crimson">
                    {requestError}
                  </p>
                ) : null}
              </>
            )}
          </div>

          {result ? null : (
            <div className="flex items-center justify-between gap-3 border-t border-pulse-border-subtle p-4">
              <p className="text-xs text-pulse-muted">
                {invalidCount > 0 ? 'Correct the rows with errors before you import.' : 'Each Agent row adds 1 to its Cohort count.'}
              </p>
              <div className="flex gap-2">
                <button type="button" className="pulse-btn pulse-btn-ghost" onClick={close} disabled={pending}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="pulse-btn pulse-btn-primary"
                  onClick={submit}
                  disabled={pending || validRows.length === 0 || invalidCount > 0 || tooMany}
                >
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
                  Import {validRows.length > 0 ? validRows.length : ''} row{validRows.length === 1 ? '' : 's'}
                </button>
              </div>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
