/**
 * GET /api/guide-media/<file> — How To videos, posters and screenshots for signed-in users.
 *
 * Streams from Firebase Storage `guide-media/` (uploaded by `npm run guides:media:upload`), with Range support so
 * the video player can seek. Set NEXT_PUBLIC_GUIDE_MEDIA_BASE_URL=/api/guide-media to use it. File names carry a
 * content hash, so responses are cached privately for a year.
 */
import { Readable } from 'node:stream';
import { requireAuth } from '@/lib/firebase/auth-guard';
import { getAdminBucket } from '@/lib/firebase/admin';
import { GUIDE_MEDIA_STORAGE_PREFIX } from '@/lib/guides/media-manifest.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SAFE_NAME = /^[a-z0-9][a-z0-9._-]{0,120}$/i;
const TYPES: Record<string, string> = { mp4: 'video/mp4', webp: 'image/webp', jpg: 'image/jpeg', json: 'application/json' };

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { path } = await params;
  const name = path.join('/');
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (path.length !== 1 || !SAFE_NAME.test(name) || !TYPES[ext]) return new Response('Not found', { status: 404 });

  const file = getAdminBucket().file(`${GUIDE_MEDIA_STORAGE_PREFIX}${name}`);
  const [exists] = await file.exists();
  if (!exists) return new Response('Not found', { status: 404 });
  const [meta] = await file.getMetadata();
  const size = Number(meta.size);
  const cache = ext === 'json' ? 'private, max-age=300' : 'private, max-age=31536000, immutable';
  const headers: Record<string, string> = { 'Content-Type': TYPES[ext], 'Accept-Ranges': 'bytes', 'Cache-Control': cache };

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
  if (range && size > 0) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    const stream = Readable.toWeb(file.createReadStream({ start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  const stream = Readable.toWeb(file.createReadStream()) as ReadableStream;
  return new Response(stream, { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
}
