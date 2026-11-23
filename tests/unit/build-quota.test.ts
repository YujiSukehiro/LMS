/** Daily Track-build limit: only fresh builds count, the limit comes from the env, and the counter is per UTC day. */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}` }) }) },
}));

import {
  DEFAULT_MAX_TRACK_BUILDS_PER_DAY,
  buildLimitMessage,
  claimBuildSlot,
  isFreshBuildStart,
  maxTrackBuildsPerDay,
  utcDayKey,
} from '@/lib/services/build-quota';

function fakeTx(existing: Record<string, Record<string, unknown>>) {
  const writes: Array<{ path: string; data: Record<string, unknown> }> = [];
  const tx = {
    get: async (ref: { path: string }) => {
      const data = existing[ref.path];
      return { exists: Boolean(data), get: (key: string) => data?.[key] };
    },
    set: (ref: { path: string }, data: Record<string, unknown>) => {
      writes.push({ path: ref.path, data });
    },
  };
  return { tx: tx as never, writes };
}

const NOW = Date.UTC(2026, 10, 22, 23, 30);

describe('build quota', () => {
  it('reads the limit from the env, with a default of 10', () => {
    expect(maxTrackBuildsPerDay({} as unknown as NodeJS.ProcessEnv)).toBe(DEFAULT_MAX_TRACK_BUILDS_PER_DAY);
    expect(maxTrackBuildsPerDay({ MAX_TRACK_BUILDS_PER_USER_PER_DAY: '3' } as unknown as NodeJS.ProcessEnv)).toBe(3);
    expect(maxTrackBuildsPerDay({ MAX_TRACK_BUILDS_PER_USER_PER_DAY: 'zero' } as unknown as NodeJS.ProcessEnv)).toBe(10);
  });

  it('counts only builds that start from an uploaded, unbuilt source', () => {
    expect(isFreshBuildStart('EXTRACTING_PDF')).toBe(true);
    expect(isFreshBuildStart('UPLOADING')).toBe(true);
    expect(isFreshBuildStart('FAILED')).toBe(false);
    expect(isFreshBuildStart('BUILDING_UNITS')).toBe(false);
  });

  it('keys the counter by UTC day', () => {
    expect(utcDayKey(NOW)).toBe('2026-11-22');
    expect(utcDayKey(NOW + 60 * 60_000)).toBe('2026-11-23');
  });

  it('claims a slot and records the Track', async () => {
    const { tx, writes } = fakeTx({ 'trackBuildQuota/u1_2026-11-22': { count: 2, trackIds: ['a', 'b'] } });
    await expect(claimBuildSlot(tx, 'u1', 'c', NOW, 10)).resolves.toEqual({ ok: true, used: 3 });
    expect(writes[0]).toMatchObject({ path: 'trackBuildQuota/u1_2026-11-22', data: { count: 3, trackIds: ['a', 'b', 'c'], uid: 'u1' } });
  });

  it('refuses at the limit without writing', async () => {
    const { tx, writes } = fakeTx({ 'trackBuildQuota/u1_2026-11-22': { count: 10 } });
    await expect(claimBuildSlot(tx, 'u1', 'c', NOW, 10)).resolves.toEqual({ ok: false, limit: 10 });
    expect(writes).toHaveLength(0);
    expect(buildLimitMessage(10)).toMatch(/maximum of 10 new Track builds today/);
  });
});
