import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { getAdminBucket } from '@/lib/firebase/admin';
import { normalizeManifest, type GuideMediaManifest } from './media';

/**
 * Where How To media is read from, server side only:
 * - `local`: the gitignored `guide-media/` folder at the app root (made by `npm run guides:media`).
 * - `storage`: Firebase Storage `guide-media/` (uploaded by `npm run guides:media:upload`), read with the Admin SDK.
 * GUIDE_MEDIA_SOURCE picks one; by default the local folder when it exists, else Storage.
 */
export const GUIDE_MEDIA_STORAGE_PREFIX = 'guide-media/';

export function guideMediaLocalDir(): string {
  return process.env.GUIDE_MEDIA_LOCAL_DIR || path.join(process.cwd(), 'guide-media');
}

export function guideMediaSource(): 'local' | 'storage' {
  const configured = process.env.GUIDE_MEDIA_SOURCE;
  if (configured === 'local' || configured === 'storage') return configured;
  return existsSync(path.join(guideMediaLocalDir(), 'manifest.json')) ? 'local' : 'storage';
}

export interface GuideMediaFile {
  size: number;
  stream(range?: { start: number; end: number }): ReadableStream;
}

/** One media file by its `<folder>/<name>` path, or null when it does not exist. Callers check access first. */
export async function openGuideMediaFile(relPath: string): Promise<GuideMediaFile | null> {
  if (guideMediaSource() === 'local') {
    const { stat } = await import('node:fs/promises');
    const { createReadStream } = await import('node:fs');
    const file = path.join(guideMediaLocalDir(), relPath);
    if (!file.startsWith(guideMediaLocalDir() + path.sep)) return null;
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return null;
    return {
      size: info.size,
      stream: (range) => Readable.toWeb(createReadStream(file, range ? { start: range.start, end: range.end } : undefined)) as ReadableStream,
    };
  }
  const file = getAdminBucket().file(`${GUIDE_MEDIA_STORAGE_PREFIX}${relPath}`);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [meta] = await file.getMetadata();
  return {
    size: Number(meta.size),
    stream: (range) => Readable.toWeb(file.createReadStream(range ? { start: range.start, end: range.end } : {})) as ReadableStream,
  };
}

const TTL_MS = 5 * 60_000;
let cached: { at: number; source: string; manifest: GuideMediaManifest | null } | null = null;

/** The media manifest, or null when no media is published. Never throws: the text guide must still render. */
export async function loadGuideMediaManifest(): Promise<GuideMediaManifest | null> {
  const source = guideMediaSource();
  if (cached && cached.source === source && Date.now() - cached.at < TTL_MS) return cached.manifest;
  let manifest: GuideMediaManifest | null = null;
  try {
    const raw =
      source === 'local'
        ? await readFile(path.join(guideMediaLocalDir(), 'manifest.json'), 'utf8')
        : (await getAdminBucket().file(`${GUIDE_MEDIA_STORAGE_PREFIX}manifest.json`).download())[0].toString('utf8');
    manifest = normalizeManifest(JSON.parse(raw));
  } catch {
    manifest = null;
  }
  cached = { at: Date.now(), source, manifest };
  return manifest;
}

/** Tests only. */
export function resetGuideMediaManifestCache(): void {
  cached = null;
}
