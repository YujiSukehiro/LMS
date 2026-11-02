import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import type { ManualExchangePackage } from '@/lib/ai/manual-exchange';
import { createProvenance } from '@/lib/ai/provenance';
import { finalizeUnit, type UnitGeneration } from '@/lib/ai/prompts/unit-builder';
import { DRAFT_VERSION_ID, TrackVersionDocSchema, type TrackDoc, type TrackUnit } from '@/lib/schemas/curriculum';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';

const { mockRequireAuth, mockRunTransaction, mockCommit } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockRunTransaction: vi.fn(),
  mockCommit: vi.fn(),
}));

vi.mock('@/lib/firebase/auth-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/firebase/auth-guard')>();
  return { ...actual, requireAuth: mockRequireAuth };
});

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (path: string) => collection(path),
    runTransaction: async <T>(callback: (tx: FakeTransaction) => Promise<T>): Promise<T> => runTransaction(callback),
  },
}));

import { POST as exportPOST } from '@/app/api/tracks/[trackId]/manual-curriculum/export/route';
import { POST as importPOST } from '@/app/api/tracks/[trackId]/manual-curriculum/import/route';

interface FakeDocumentReference {
  path: string;
  collection(path: string): FakeCollectionReference;
  get(): Promise<{ exists: boolean; data(): unknown }>;
}

interface FakeCollectionReference {
  path: string;
  doc(id: string): FakeDocumentReference;
  get(): Promise<{ docs: Array<{ data(): unknown }> }>;
}

interface FakeTransaction {
  get(ref: FakeDocumentReference): Promise<{ exists: boolean; data(): unknown }>;
  get(ref: FakeCollectionReference): Promise<{ docs: Array<{ data(): unknown }> }>;
  update(ref: FakeDocumentReference, data: Record<string, unknown>): void;
  set(ref: FakeDocumentReference, data: unknown): void;
}

const store = new Map<string, unknown>();
const writeLog: Array<{ kind: 'set' | 'update'; path: string; data: unknown }> = [];

function clone<T>(value: T): T {
  return structuredClone(value);
}

function document(path: string): FakeDocumentReference {
  return {
    path,
    collection: (child) => collection(`${path}/${child}`),
    get: async () => {
      const exists = store.has(path);
      return { exists, data: () => (exists ? clone(store.get(path)) : undefined) };
    },
  };
}

function collection(path: string): FakeCollectionReference {
  return {
    path,
    doc: (id) => document(`${path}/${id}`),
    get: async () => ({
      docs: [...store.entries()]
        .filter(([candidate]) => candidate.startsWith(`${path}/`) && !candidate.slice(path.length + 1).includes('/'))
        .map(([, value]) => ({ data: () => clone(value) })),
    }),
  };
}

async function runTransaction<T>(callback: (tx: FakeTransaction) => Promise<T>): Promise<T> {
  mockRunTransaction();
  const pending: Array<{ kind: 'set' | 'update'; ref: FakeDocumentReference; data: unknown }> = [];
  const tx: FakeTransaction = {
    get: (ref: FakeDocumentReference | FakeCollectionReference) => ref.get(),
    update: (ref, data) => pending.push({ kind: 'update', ref, data: clone(data) }),
    set: (ref, data) => pending.push({ kind: 'set', ref, data: clone(data) }),
  } as FakeTransaction;
  const result = await callback(tx);
  for (const operation of pending) {
    if (operation.kind === 'set') store.set(operation.ref.path, clone(operation.data));
    else {
      const current = (store.get(operation.ref.path) ?? {}) as Record<string, unknown>;
      store.set(operation.ref.path, { ...current, ...(operation.data as Record<string, unknown>) });
    }
    writeLog.push({ kind: operation.kind, path: operation.ref.path, data: clone(operation.data) });
  }
  mockCommit(pending.map((operation) => ({ kind: operation.kind, path: operation.ref.path })));
  return result;
}

const pillars = [
  { id: 'pillar_compliance', key: 'compliance_boundaries', label: 'Synthetic compliance', description: 'Follow synthetic policy rules.' },
  { id: 'pillar_workflow', key: 'workflow_execution', label: 'Synthetic workflow', description: 'Complete synthetic call steps.' },
];

function generation(page: number, label: string): UnitGeneration {
  const card = (index: number) => ({
    headline: `${label} rule ${index}`,
    bodyMarkdown: `Synthetic training rule ${index} from the approved source page.`,
    keyTakeaway: `${label} takeaway ${index}`,
    doList: ['Use the synthetic rule.', 'Cite the approved page.'],
    dontList: ['Do not invent a policy.', 'Do not use real customer data.'],
    sourcePages: [page],
  });
  const base = { competencyPillarId: 'pillar_compliance', explanation: 'The synthetic source page states this rule.', sourcePages: [page] };
  return {
    briefingCards: [card(1), card(2), card(3)],
    drills: [
      {
        ...base,
        kind: 'MULTIPLE_CHOICE',
        prompt: `${label}: which synthetic action follows policy?`,
        options: [
          { id: 'a', text: 'Follow the synthetic rule.' },
          { id: 'b', text: 'Invent a policy.' },
          { id: 'c', text: 'Ignore the source.' },
          { id: 'd', text: 'Use real customer data.' },
        ],
        correctOptionId: 'a',
      },
      {
        ...base,
        kind: 'TRUE_FALSE_SPOT',
        prompt: `${label}: assess this synthetic statement.`,
        statement: 'The agent followed the synthetic source rule.',
        isCompliant: true,
      },
      {
        ...base,
        kind: 'SEQUENCE_ORDER',
        prompt: `${label}: order the synthetic steps.`,
        orderedSteps: [{ text: 'Read the rule.' }, { text: 'Apply the rule.' }, { text: 'Record the result.' }],
      },
      {
        ...base,
        kind: 'MATCH_PAIRS',
        prompt: `${label}: match the synthetic situations.`,
        pairs: [
          { leftPrompt: 'Rule known', rightMatch: 'Apply it' },
          { leftPrompt: 'Rule missing', rightMatch: 'Escalate' },
          { leftPrompt: 'Sensitive data', rightMatch: 'Do not import' },
        ],
      },
      {
        ...base,
        kind: 'FILL_BLANK_CHOICE',
        prompt: `${label}: complete the synthetic rule.`,
        sentenceTemplate: 'Always follow the {{BLANK}} source rule.',
        wordBank: ['approved', 'invented', 'hidden', 'real'],
        correctWord: 'approved',
      },
    ],
  };
}

function unit(id: string, orderIndex: number, page: number, label: string): TrackUnit {
  return finalizeUnit(
    {
      id,
      orderIndex,
      title: `${label} Unit`,
      summary: `${label} synthetic unit summary.`,
      focus: 'Synthetic source rules.',
      sourcePages: [page],
      pillarIds: ['pillar_compliance'],
    },
    generation(page, label),
    { pillarIds: ['pillar_compliance'], allowedPages: [page] },
  );
}

const track: TrackDoc = {
  id: 'track-1',
  title: 'Synthetic Curriculum Track',
  campaignCode: 'SYNTH',
  divisionId: 'INBOUND',
  status: 'DRAFT',
  generationProgress: { step: 'READY', percent: 100, message: 'Synthetic draft ready.' },
  sourcePdfStoragePath: 'synthetic/path.pdf',
  sourcePdfFileName: 'synthetic.pdf',
  sourcePageCount: 2,
  currentDraftVersionId: DRAFT_VERSION_ID,
  publishedVersionId: null,
  assignedCohortIds: [],
  competencyPillars: pillars,
  unitCount: 2,
  simScenarioCount: 1,
  estimatedTotalMinutes: 20,
  createdByUid: 'trainer-1',
  createdAt: 1,
  updatedAt: 1,
};

function draft() {
  return TrackVersionDocSchema.parse({
    versionId: DRAFT_VERSION_ID,
    trackId: 'track-1',
    versionNumber: 1,
    competencyPillars: pillars,
    units: [unit('u1', 0, 1, 'Original'), unit('u2', 1, 2, 'Unrelated')],
    simScenarios: [
      {
        id: 'sim-1',
        title: 'Unrelated synthetic simulation',
        difficulty: 'STANDARD',
        counterpartyRoleLabel: 'Synthetic caller',
        contextTicketSummary: 'Synthetic training queue.',
        openingMessage: 'This is a synthetic training call.',
        dispositionOptions: ['Completed', 'Escalated', 'Follow up'],
        maxTurns: 8,
        passScoreThreshold: 80,
      },
    ],
    provenance: createProvenance({ source: 'local_ai', provider: 'synthetic-local', model: 'synthetic-model' }),
    publishedAt: null,
    createdAt: 1,
  });
}

function seed(): void {
  store.set('tracks/track-1', clone(track));
  store.set('tracks/track-1/versions/draft', draft());
  store.set('tracks/track-1/sourcePages/batch-001', {
    id: 'batch-001',
    trackId: 'track-1',
    startPage: 1,
    endPage: 2,
    pages: [
      { pageNumber: 1, text: 'Synthetic approved page one. Follow the approved source rule and escalate missing rules.' },
      { pageNumber: 2, text: 'Synthetic page two belongs only to the unrelated Unit.' },
    ],
    createdAt: 1,
  });
  store.set('tracks/track-1/versions/draft/secrets/evalRubrics', {
    scenarios: [{ hidden: 'hidden-rubric-secret-must-not-be-exported' }],
  });
}

function request(body: unknown): Request {
  return new Request('http://localhost/api/tracks/track-1/manual-curriculum', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ trackId: 'track-1' });

async function exportPackage(unitId = 'u1'): Promise<ManualExchangePackage> {
  const response = await exportPOST(request({ unitId }), { params });
  expect(response.status).toBe(200);
  return ((await response.json()) as { package: ManualExchangePackage }).package;
}

function envelope(manualPackage: ManualExchangePackage, output: unknown = generation(1, 'Imported')): string {
  return JSON.stringify({
    format: 'logicall.manual-chat',
    formatVersion: 1,
    packageChecksum: manualPackage.checksum,
    taskId: manualPackage.taskId,
    taskType: 'curriculum_generation',
    outputSchemaVersion: manualPackage.outputSchemaVersion,
    output,
  });
}

function importRequest(input: string, unitId = 'u1'): Request {
  return request({ unitId, input, externalProvider: 'external-chat-synthetic', externalModel: 'trainer-labelled-model' });
}

beforeEach(() => {
  store.clear();
  writeLog.length = 0;
  vi.clearAllMocks();
  seed();
  mockRequireAuth.mockResolvedValue({
    ok: true,
    user: {
      uid: 'trainer-1',
      email: 'trainer@synthetic.internal',
      displayName: 'Synthetic Trainer',
      role: 'TRAINER',
      partnerCohortId: 'INTERNAL',
      divisionIds: ['INBOUND'],
      active: true,
    },
  });
});

describe('manual curriculum route authorization', () => {
  it('uses the established internal trainer roles and blocks unauthorized export/import before data access', async () => {
    mockRequireAuth.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }),
    });

    const exportResponse = await exportPOST(request({ unitId: 'u1' }), { params });
    const importResponse = await importPOST(importRequest('{}'), { params });

    expect(exportResponse.status).toBe(403);
    expect(importResponse.status).toBe(403);
    expect(mockRequireAuth).toHaveBeenNthCalledWith(1, expect.any(Request), INTERNAL_OPS_ROLES);
    expect(mockRequireAuth).toHaveBeenNthCalledWith(2, expect.any(Request), INTERNAL_OPS_ROLES);
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(writeLog).toHaveLength(0);
  });
});

describe('manual curriculum export', () => {
  it('exports the exact Unit Builder schema, current draft context, and only the selected approved source page', async () => {
    const response = await exportPOST(request({ unitId: 'u1' }), { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.package).toMatchObject({
      taskId: 'curriculum-unit:track-1:u1',
      taskType: 'curriculum_generation',
      outputSchemaName: 'TrackUnitContent',
      outputSchemaVersion: 'unit-builder-v1',
      external: { provider: '', model: '' },
    });
    expect(body.package.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(body.package.outputJsonSchema.properties).toHaveProperty('briefingCards');
    expect(body.package.outputJsonSchema.properties).toHaveProperty('drills');
    expect(body.package.approvedSourceExcerpts).toHaveLength(1);
    expect(body.package.approvedSourceExcerpts[0]).toMatchObject({ page: 1, approved: true });
    expect(body.package.instructions).toContain('CURRENT UNIT DRAFT');
    expect(body.package.instructions).toContain('Original rule 1');
    expect(body.package.instructions).toContain('Replace only Unit "u1"');

    const serialized = JSON.stringify(body.package);
    expect(serialized).not.toContain('Synthetic page two belongs only to the unrelated Unit');
    expect(serialized).not.toContain('hidden-rubric-secret-must-not-be-exported');
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(writeLog).toHaveLength(0);
  });

  it('fails closed when the selected Unit has no persisted source-page evidence', async () => {
    const current = draft();
    current.units[0].briefingCards.forEach((card) => { card.sourcePages = []; });
    current.units[0].drills.forEach((drill) => { drill.sourcePages = []; });
    store.set('tracks/track-1/versions/draft', current);

    const response = await exportPOST(request({ unitId: 'u1' }), { params });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('NO_UNIT_EVIDENCE');
    expect(writeLog).toHaveLength(0);
  });
});

describe('manual curriculum atomic import', () => {
  it('commits one validated Unit with manual_chat provenance and preserves unrelated Units, Simulations, and draft provenance', async () => {
    const manualPackage = await exportPackage();
    const before = draft();
    const response = await importPOST(importRequest(envelope(manualPackage)), { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.validationReport.valid).toBe(true);
    expect(body.validationReport.checks).toContainEqual(expect.objectContaining({ name: 'evidence', passed: true }));
    expect(body.diff).toContainEqual(expect.objectContaining({ path: '/briefingCards/0/headline', after: 'Imported rule 1' }));
    expect(body.provenance).toMatchObject({
      source: 'manual_chat',
      provider: 'external-chat-synthetic',
      model: 'trainer-labelled-model',
      schema: { name: 'TrackUnitContent', version: 'unit-builder-v1' },
      runtime: { label: 'external_manual_chat' },
    });
    expect(body.unit.briefingCards[0].headline).toBe('Imported rule 1');

    const after = store.get('tracks/track-1/versions/draft') as ReturnType<typeof draft>;
    expect(after.units[0].briefingCards[0].headline).toBe('Imported rule 1');
    expect(after.units[1]).toEqual(before.units[1]);
    expect(after.simScenarios).toEqual(before.simScenarios);
    expect(after.provenance).toEqual(before.provenance);

    const provenance = store.get(body.provenancePath) as Record<string, unknown>;
    expect(provenance).toMatchObject({
      taskId: manualPackage.taskId,
      taskType: 'curriculum_generation',
      trackId: 'track-1',
      unitId: 'u1',
      packageChecksum: manualPackage.checksum,
      trainerUid: 'trainer-1',
      provenance: { source: 'manual_chat', provider: 'external-chat-synthetic', model: 'trainer-labelled-model' },
      validationReport: { valid: true },
    });
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
    expect(mockCommit).toHaveBeenCalledTimes(1);
    expect(writeLog.map((write) => `${write.kind}:${write.path}`)).toEqual([
      'update:tracks/track-1/versions/draft',
      `set:${body.provenancePath}`,
    ]);
    expect(writeLog[0].data).toEqual({ units: after.units });
  });

  it('rejects malformed JSON before opening a transaction or writing anything', async () => {
    const before = store.get('tracks/track-1/versions/draft');
    const response = await importPOST(importRequest('{not-json'), { params });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('MANUAL_IMPORT_INVALID');
    expect(body.validationReport.checks.at(-1)).toMatchObject({ name: 'import_json', passed: false });
    expect(store.get('tracks/track-1/versions/draft')).toEqual(before);
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(mockCommit).not.toHaveBeenCalled();
    expect(writeLog).toHaveLength(0);
  });

  it.each(['taskId', 'outputSchemaVersion', 'packageChecksum'])('rejects %s mismatch with zero writes', async (field) => {
    const manualPackage = await exportPackage();
    const decoded = JSON.parse(envelope(manualPackage)) as Record<string, unknown>;
    decoded[field] = field === 'packageChecksum' ? `sha256:${'0'.repeat(64)}` : 'mismatch';

    const response = await importPOST(importRequest(JSON.stringify(decoded)), { params });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('MANUAL_IMPORT_INVALID');
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(writeLog).toHaveLength(0);
  });

  it('rejects source-page evidence outside the exported excerpts with zero writes', async () => {
    const manualPackage = await exportPackage();
    const output = generation(1, 'Imported');
    output.briefingCards[0].sourcePages = [2];

    const response = await importPOST(importRequest(envelope(manualPackage, output)), { params });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('MANUAL_IMPORT_INVALID');
    expect(body.message).toContain('not in the provided SOURCE PAGES');
    expect(store.get('tracks/track-1/versions/draft')).toEqual(draft());
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(writeLog).toHaveLength(0);
  });

  it('rejects stale selected-unit context by package checksum before any write', async () => {
    const manualPackage = await exportPackage();
    const changed = draft();
    changed.units[0].briefingCards[0].headline = 'Changed after export';
    store.set('tracks/track-1/versions/draft', changed);

    const response = await importPOST(importRequest(envelope(manualPackage)), { params });
    expect(response.status).toBe(400);
    expect((await response.json()).validationReport.checks.at(-1)).toMatchObject({ name: 'import_checksum', passed: false });
    expect(store.get('tracks/track-1/versions/draft')).toEqual(changed);
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(writeLog).toHaveLength(0);
  });

  it('requires honest external provider/model labels before any write', async () => {
    const manualPackage = await exportPackage();
    const response = await importPOST(
      request({ unitId: 'u1', input: envelope(manualPackage), externalProvider: '', externalModel: 'trainer-labelled-model' }),
      { params },
    );

    expect(response.status).toBe(400);
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(writeLog).toHaveLength(0);
  });
});
