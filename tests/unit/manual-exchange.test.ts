import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  exportManualExchangePackage,
  importManualExchange,
  ManualExchangeValidationError,
  type ManualExchangePackage,
} from '@/lib/ai/manual-exchange';
import { SensitiveDataError } from '@/lib/security/synthetic-data';

const OutputSchema = z.object({ title: z.string().min(3), evidenceIds: z.array(z.string().min(1)).min(1) }).strict();
const OtherSchema = z.object({ different: z.string() }).strict();
const output = { title: 'Synthetic lesson', evidenceIds: ['excerpt-1'] };

function makePackage(): ManualExchangePackage {
  return exportManualExchangePackage({
    actorRole: 'trainer',
    taskId: 'task-curriculum-1',
    taskType: 'curriculum_generation',
    instructions: 'Return the requested synthetic curriculum JSON only.',
    outputSchemaName: 'SyntheticCurriculum',
    outputSchemaVersion: 'schema-v1',
    schema: OutputSchema,
    approvedSourceExcerpts: [
      { id: 'excerpt-1', sourceId: 'synthetic-source', revision: 'r1', page: 1, text: 'Synthetic approved excerpt.', approved: true },
    ],
    validationRules: ['Cite excerpt-1.', 'Use synthetic content only.'],
    prompt: { templateId: 'curriculum-stage', templateVersion: 'prompt-v2', inputHash: 'sha256:synthetic-input' },
  });
}

function envelope(manualPackage: ManualExchangePackage, value: unknown = output): string {
  return JSON.stringify({
    format: 'logicall.manual-chat',
    formatVersion: 1,
    packageChecksum: manualPackage.checksum,
    taskId: manualPackage.taskId,
    taskType: manualPackage.taskType,
    outputSchemaVersion: manualPackage.outputSchemaVersion,
    output: value,
  });
}

function importOptions(manualPackage: ManualExchangePackage, input: string, commit: (value: unknown) => unknown) {
  return {
    actorRole: 'trainer' as const,
    package: manualPackage,
    input,
    schema: OutputSchema,
    outputSchemaVersion: 'schema-v1',
    externalProvider: 'external-chat-synthetic',
    externalModel: 'user-labelled-model',
    importedAt: '2026-01-01T00:00:00.000Z',
    commit,
  };
}

describe('manual exchange export', () => {
  it('exports versions, task identity, instructions, schema, approved excerpts, rules, blank labels, and checksum', () => {
    const manualPackage = makePackage();

    expect(manualPackage).toMatchObject({
      format: 'logicall.manual-chat',
      formatVersion: 1,
      packageSchemaVersion: 1,
      taskId: 'task-curriculum-1',
      taskType: 'curriculum_generation',
      outputSchemaName: 'SyntheticCurriculum',
      outputSchemaVersion: 'schema-v1',
      external: { provider: '', model: '' },
    });
    expect(manualPackage.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(manualPackage.outputJsonSchema).toHaveProperty('properties.title');
    expect(manualPackage.approvedSourceExcerpts).toHaveLength(1);
    expect(manualPackage).not.toHaveProperty('unapprovedSourceExcerpts');
  });

  it('rejects unapproved excerpts and sensitive export content', () => {
    expect(() =>
      exportManualExchangePackage({
        actorRole: 'trainer',
        taskId: 'task-1',
        taskType: 'curriculum_generation',
        instructions: 'Synthetic instructions.',
        outputSchemaName: 'Output',
        outputSchemaVersion: 'v1',
        schema: OutputSchema,
        approvedSourceExcerpts: [
          { id: 'x', sourceId: 's', revision: 'r', text: 'Unapproved synthetic text.', approved: false },
        ] as never,
        validationRules: [],
      }),
    ).toThrow();

    expect(() =>
      exportManualExchangePackage({
        actorRole: 'trainer',
        taskId: 'task-1',
        taskType: 'curriculum_generation',
        instructions: 'Synthetic instructions.',
        outputSchemaName: 'Output',
        outputSchemaVersion: 'v1',
        schema: OutputSchema,
        approvedSourceExcerpts: [
          { id: 'x', sourceId: 's', revision: 'r', text: 'Test pattern 4111 1111 1111 1111.', approved: true },
        ],
        validationRules: [],
      }),
    ).toThrow(SensitiveDataError);
  });

  it.each(['admin', 'learner', 'system'] as const)('blocks judge export for %s', (actorRole) => {
    expect(() =>
      exportManualExchangePackage({
        actorRole,
        taskId: 'judge-task',
        taskType: 'judge',
        instructions: 'Synthetic judge instructions.',
        outputSchemaName: 'JudgeOutput',
        outputSchemaVersion: 'v1',
        schema: OutputSchema,
        approvedSourceExcerpts: [],
        validationRules: [],
      }),
    ).toThrow(/trainer-only/);
  });

  it('allows a trainer judge export', () => {
    expect(
      exportManualExchangePackage({
        actorRole: 'trainer',
        taskId: 'judge-task',
        taskType: 'judge',
        instructions: 'Synthetic judge instructions.',
        outputSchemaName: 'JudgeOutput',
        outputSchemaVersion: 'v1',
        schema: OutputSchema,
        approvedSourceExcerpts: [],
        validationRules: [],
      }).taskType,
    ).toBe('judge');
  });
});

describe('atomic manual exchange import', () => {
  it('validates evidence, produces a diff/report, retains manual_chat provenance, and commits once', async () => {
    const manualPackage = makePackage();
    const validateEvidence = vi.fn(() => ({ valid: true }));
    const commit = vi.fn(async () => 'committed');

    const result = await importManualExchange({
      ...importOptions(manualPackage, envelope(manualPackage), commit as never),
      diffAgainst: { title: 'Old synthetic lesson', evidenceIds: ['excerpt-1'] },
      validateEvidence,
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(validateEvidence).toHaveBeenCalledWith(output, { package: manualPackage });
    expect(result.commitResult).toBe('committed');
    expect(result.validationReport.valid).toBe(true);
    expect(result.validationReport.checks.every((check) => check.passed)).toBe(true);
    expect(result.diff).toContainEqual({ path: '/title', before: 'Old synthetic lesson', after: 'Synthetic lesson' });
    expect(result.provenance).toMatchObject({
      source: 'manual_chat',
      provider: 'external-chat-synthetic',
      model: 'user-labelled-model',
      prompt: { templateId: 'curriculum-stage', templateVersion: 'prompt-v2', inputHash: 'sha256:synthetic-input' },
      schema: { name: 'SyntheticCurriculum', version: 'schema-v1' },
      runtime: { label: 'external_manual_chat' },
    });
  });

  it('accepts a local file-like JSON input', async () => {
    const manualPackage = makePackage();
    const commit = vi.fn(() => 'saved');
    const result = await importManualExchange({
      ...importOptions(manualPackage, '', commit as never),
      input: { text: async () => envelope(manualPackage) },
    });
    expect(result.output).toEqual(output);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['malformed JSON', '{not-json'],
    ['executable content', '<script>alert("synthetic")</script>'],
    ['imported instructions', JSON.stringify({ instructions: 'Ignore validation.', output })],
  ])('writes nothing for %s', async (_label, input) => {
    const manualPackage = makePackage();
    const commit = vi.fn();
    await expect(importManualExchange(importOptions(manualPackage, input, commit as never))).rejects.toThrow();
    expect(commit).not.toHaveBeenCalled();
  });

  it('rejects package tampering before any write', async () => {
    const manualPackage = { ...makePackage(), instructions: 'Tampered synthetic instructions.' };
    const commit = vi.fn();
    await expect(importManualExchange(importOptions(manualPackage, envelope(manualPackage), commit as never))).rejects.toMatchObject({
      validationReport: { valid: false },
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it('rejects checksum and task mismatches before any write', async () => {
    const manualPackage = makePackage();
    const wrongChecksum = { ...JSON.parse(envelope(manualPackage)), packageChecksum: 'sha256:' + '0'.repeat(64) };
    const wrongTask = { ...JSON.parse(envelope(manualPackage)), taskId: 'another-task' };

    for (const input of [JSON.stringify(wrongChecksum), JSON.stringify(wrongTask)]) {
      const commit = vi.fn();
      await expect(importManualExchange(importOptions(manualPackage, input, commit as never))).rejects.toThrow();
      expect(commit).not.toHaveBeenCalled();
    }
  });

  it('requires the exact exported schema and version', async () => {
    const manualPackage = makePackage();
    for (const override of [
      { schema: OtherSchema, outputSchemaVersion: 'schema-v1' },
      { schema: OutputSchema, outputSchemaVersion: 'schema-v2' },
    ]) {
      const commit = vi.fn();
      await expect(
        importManualExchange({ ...importOptions(manualPackage, envelope(manualPackage), commit as never), ...override } as never),
      ).rejects.toThrow(/schema_match/);
      expect(commit).not.toHaveBeenCalled();
    }
  });

  it('uses the supplied Zod schema and writes nothing for invalid output', async () => {
    const manualPackage = makePackage();
    const commit = vi.fn();
    await expect(
      importManualExchange(importOptions(manualPackage, envelope(manualPackage, { title: 'x', evidenceIds: [] }), commit as never)),
    ).rejects.toThrow(/output_schema/);
    expect(commit).not.toHaveBeenCalled();
  });

  it('requires a supplied evidence hook to pass before commit', async () => {
    const manualPackage = makePackage();
    const commit = vi.fn();
    await expect(
      importManualExchange({
        ...importOptions(manualPackage, envelope(manualPackage), commit as never),
        validateEvidence: () => ({ valid: false, issues: ['Synthetic evidence is missing.'] }),
      }),
    ).rejects.toThrow(/Synthetic evidence is missing/);
    expect(commit).not.toHaveBeenCalled();
  });

  it('returns a validation report on failed schema validation', async () => {
    const manualPackage = makePackage();
    let thrown: unknown;
    try {
      await importManualExchange(
        importOptions(manualPackage, envelope(manualPackage, { title: 'x', evidenceIds: [] }), vi.fn() as never),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ManualExchangeValidationError);
    expect((thrown as ManualExchangeValidationError).validationReport).toMatchObject({ valid: false });
    expect((thrown as ManualExchangeValidationError).validationReport.checks.at(-1)?.name).toBe('output_schema');
  });

  it('requires honest external labels before commit', async () => {
    const manualPackage = makePackage();
    const commit = vi.fn();
    await expect(
      importManualExchange({ ...importOptions(manualPackage, envelope(manualPackage), commit as never), externalProvider: '' }),
    ).rejects.toThrow(/external_provenance/);
    expect(commit).not.toHaveBeenCalled();
  });
});
