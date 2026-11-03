export const MANUAL_JUDGE_RESULT_FILE_MAX_BYTES = 2_000_000;

export interface ManualJudgeResultSummary {
  score: number;
  passed: boolean;
  certified: boolean;
  demoReplay: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Browser file inputs can be bypassed, so validate again before reading or importing. */
export function validateManualJudgeResultFile(file: Pick<File, 'name' | 'size'>): string | null {
  if (!/\.(json|txt)$/i.test(file.name)) return 'Choose a .json or .txt result file.';
  if (file.size === 0) return 'The selected result file is empty.';
  if (file.size > MANUAL_JUDGE_RESULT_FILE_MAX_BYTES) return 'The result file must be 2 MB or smaller.';
  return null;
}

/** Reads only export metadata; the package itself is neither returned nor retained. */
export function manualJudgeExportTaskId(value: unknown, expectedSessionId: string): string | null {
  if (!isRecord(value) || value.sessionId !== expectedSessionId || !isRecord(value.package)) return null;
  return typeof value.taskId === 'string' && value.taskId.trim().length > 0 ? value.taskId : null;
}

/** Deliberately extracts only the four displayable server verdict fields. */
export function parseManualJudgeResultSummary(value: unknown): ManualJudgeResultSummary | null {
  if (!isRecord(value) || !isRecord(value.evaluation)) return null;
  const { overallScorePct, passed } = value.evaluation;
  const { certified, demoReplay } = value;
  if (
    typeof overallScorePct !== 'number' ||
    !Number.isFinite(overallScorePct) ||
    overallScorePct < 0 ||
    overallScorePct > 100 ||
    typeof passed !== 'boolean' ||
    typeof certified !== 'boolean' ||
    typeof demoReplay !== 'boolean' ||
    (demoReplay && certified)
  ) {
    return null;
  }
  return { score: overallScorePct, passed, certified, demoReplay };
}

export function manualJudgePackageFileName(sessionId: string): string {
  const safeId = sessionId.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 160) || 'session';
  return `manual-judge-${safeId}.json`;
}
