import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getAdminBucket } from '@/lib/firebase/admin';
import { guideMediaBaseUrl, normalizeManifest, type GuideMediaManifest } from './media';

/** Storage folder the /api/guide-media proxy serves from. */
export const GUIDE_MEDIA_STORAGE_PREFIX = 'guide-media/';
export const GUIDE_MEDIA_PROXY_BASE = '/api/guide-media';

const TTL_MS = 5 * 60_000;
let cached: { at: number; base: string; manifest: GuideMediaManifest | null } | null = null;

async function readManifest(base: string): Promise<unknown> {
  if (base === GUIDE_MEDIA_PROXY_BASE) {
    const [buffer] = await getAdminBucket().file(`${GUIDE_MEDIA_STORAGE_PREFIX}manifest.json`).download();
    return JSON.parse(buffer.toString('utf8'));
  }
  if (base.startsWith('/')) {
    // A folder under public/ (local development: public/guide-media).
    const file = path.join(process.cwd(), 'public', base.replace(/^\/+/, ''), 'manifest.json');
    return JSON.parse(await readFile(file, 'utf8'));
  }
  const response = await fetch(`${base}/manifest.json`, { next: { revalidate: 300 } });
  if (!response.ok) return null;
  return response.json();
}

/** The media manifest, or null when no media is published. Never throws: the text guide must still render. */
export async function loadGuideMediaManifest(): Promise<GuideMediaManifest | null> {
  const base = guideMediaBaseUrl();
  if (cached && cached.base === base && Date.now() - cached.at < TTL_MS) return cached.manifest;
  let manifest: GuideMediaManifest | null = null;
  try {
    manifest = normalizeManifest(await readManifest(base));
  } catch {
    manifest = null;
  }
  cached = { at: Date.now(), base, manifest };
  return manifest;
}
