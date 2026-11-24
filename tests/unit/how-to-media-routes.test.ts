import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@/lib/schemas/domain';

let currentRole: UserRole = 'AGENT';

vi.mock('@/lib/firebase/admin', () => ({ getAdminBucket: () => { throw new Error('Storage is not used in this test'); } }));
vi.mock('@/lib/firebase/auth-guard', () => ({
  requireAuth: vi.fn(async () => ({
    ok: true,
    user: { uid: 'u1', email: 'u@x.test', displayName: 'U', role: currentRole, partnerCohortId: 'THS', divisionIds: [], active: true },
  })),
}));

const { GET: getMedia } = await import('@/app/api/guide-media/[...path]/route');
const { GET: getGuide } = await import('@/app/api/how-to/[role]/route');

function mediaReq(rel: string, range?: string) {
  const req = new Request(`http://pulse.test/api/guide-media/${rel}`, { headers: range ? { range } : {} });
  return getMedia(req, { params: Promise.resolve({ path: rel.split('/') }) });
}
function guideReq(role: string) {
  return getGuide(new Request(`http://pulse.test/api/how-to/${role}`), { params: Promise.resolve({ role }) });
}

beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'guide-media-'));
  for (const folder of ['agent', 'supervisor', 'trainer', 'admin']) {
    mkdirSync(path.join(dir, folder));
    writeFileSync(path.join(dir, folder, `${folder}-1.mp4`), '0123456789');
    writeFileSync(path.join(dir, folder, `${folder}-shot.webp`), 'webp');
  }
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: 2, videos: {}, screenshots: {} }));
  process.env.GUIDE_MEDIA_SOURCE = 'local';
  process.env.GUIDE_MEDIA_LOCAL_DIR = dir;
});

describe('/api/guide-media role folders', () => {
  const allowed: Record<UserRole, string[]> = {
    AGENT: ['agent'],
    PARTNER_SUPERVISOR: ['supervisor', 'agent'],
    TRAINER: ['trainer', 'supervisor', 'agent'],
    ADMIN: ['admin', 'trainer', 'supervisor', 'agent'],
    SUPER_ADMIN: ['admin', 'trainer', 'supervisor', 'agent'],
  };

  it('serves a role’s own and lower folders and refuses higher ones with 403', async () => {
    for (const role of Object.keys(allowed) as UserRole[]) {
      currentRole = role;
      for (const folder of ['agent', 'supervisor', 'trainer', 'admin']) {
        const res = await mediaReq(`${folder}/${folder}-1.mp4`);
        expect(res.status, `${role} → ${folder}`).toBe(allowed[role].includes(folder) ? 200 : 403);
        const shot = await mediaReq(`${folder}/${folder}-shot.webp`);
        expect(shot.status, `${role} → ${folder} screenshot`).toBe(allowed[role].includes(folder) ? 200 : 403);
      }
    }
  });

  it('supports ranges for seeking and never serves the manifest or odd paths', async () => {
    currentRole = 'AGENT';
    const ranged = await mediaReq('agent/agent-1.mp4', 'bytes=2-5');
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await ranged.text()).toBe('2345');
    expect((await mediaReq('manifest.json')).status).toBe(404);
    expect((await mediaReq('agent/../admin/admin-1.mp4')).status).toBe(404);
    expect((await mediaReq('agent/missing.mp4')).status).toBe(404);
  });
});

describe('/api/how-to/[role]', () => {
  it('returns a lower guide and refuses a higher one', async () => {
    currentRole = 'PARTNER_SUPERVISOR';
    const agent = await guideReq('agent');
    expect(agent.status).toBe(200);
    expect((await agent.json()).guide.role).toBe('AGENT');
    expect((await guideReq('supervisor')).status).toBe(200);
    expect((await guideReq('trainer')).status).toBe(403);
    expect((await guideReq('admin')).status).toBe(403);
    currentRole = 'AGENT';
    expect((await guideReq('supervisor')).status).toBe(403);
    currentRole = 'TRAINER';
    expect((await guideReq('admin')).status).toBe(403);
    expect((await guideReq('supervisor')).status).toBe(200);
  });
});
