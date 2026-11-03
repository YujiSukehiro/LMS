import { describe, expect, it } from 'vitest';
import {
  MANUAL_JUDGE_RESULT_FILE_MAX_BYTES,
  manualJudgeExportTaskId,
  manualJudgePackageFileName,
  parseManualJudgeResultSummary,
  validateManualJudgeResultFile,
} from '@/components/studio/manual-judge-ui-helpers';

describe('manual Judge result file validation', () => {
  it.each(['synthetic-result.json', 'synthetic-result.txt', 'SYNTHETIC-RESULT.JSON'])('accepts supported file %s', (name) => {
    expect(validateManualJudgeResultFile({ name, size: 128 })).toBeNull();
  });

  it.each(['synthetic-result.pdf', 'synthetic-result.json.exe', 'synthetic-result'])('rejects unsupported file %s', (name) => {
    expect(validateManualJudgeResultFile({ name, size: 128 })).toMatch(/\.json or \.txt/);
  });

  it('enforces a non-empty file no larger than 2 MB', () => {
    expect(validateManualJudgeResultFile({ name: 'empty.json', size: 0 })).toMatch(/empty/);
    expect(validateManualJudgeResultFile({ name: 'limit.txt', size: MANUAL_JUDGE_RESULT_FILE_MAX_BYTES })).toBeNull();
    expect(validateManualJudgeResultFile({ name: 'too-large.json', size: MANUAL_JUDGE_RESULT_FILE_MAX_BYTES + 1 })).toMatch(/2 MB/);
  });
});

describe('manual Judge response narrowing', () => {
  it('extracts only the export task ID without retaining the package', () => {
    const body = { sessionId: 'synthetic-session', taskId: 'simulation-judge:synthetic-session', package: { hidden: true } };
    expect(manualJudgeExportTaskId(body, 'synthetic-session')).toBe('simulation-judge:synthetic-session');
    expect(manualJudgeExportTaskId(body, 'another-session')).toBeNull();
    expect(manualJudgeExportTaskId({ ...body, package: null }, 'synthetic-session')).toBeNull();
  });

  it('returns the four authoritative display fields only', () => {
    expect(parseManualJudgeResultSummary({
      sessionId: 'synthetic-session',
      evaluation: { overallScorePct: 87.5, passed: true, summaryFeedback: 'not for display' },
      certified: false,
      demoReplay: true,
      validationReport: { hidden: true },
    })).toEqual({ score: 87.5, passed: true, certified: false, demoReplay: true });
  });

  it.each([
    null,
    {},
    { evaluation: { overallScorePct: 101, passed: true }, certified: true, demoReplay: false },
    { evaluation: { overallScorePct: 80, passed: 'yes' }, certified: false, demoReplay: false },
    { evaluation: { overallScorePct: 80, passed: true }, certified: true, demoReplay: true },
  ])('rejects malformed or contradictory result %#', (body) => {
    expect(parseManualJudgeResultSummary(body)).toBeNull();
  });
});

describe('manual Judge package download name', () => {
  it('keeps the synthetic session ID safe for a file name', () => {
    expect(manualJudgePackageFileName('synthetic/session 1')).toBe('manual-judge-synthetic-session-1.json');
  });
});
