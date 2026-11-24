/**
 * GET /api/guide-media/<role folder>/<file> — How To videos, posters, subtitles and screenshots.
 *
 * The only way media reaches a browser: the file must be in a role folder (agent/, supervisor/, trainer/, admin/) the
 * viewer may see (their own role and below), else 403. Files come from the local guide-media/ folder in development or
 * from Firebase Storage guide-media/ (Admin SDK; client reads are denied by storage.rules). Range requests are
 * supported so the player can seek. File names are content-hashed, so responses are cached privately for a year.
 */
import { requireAuth } from '@/lib/firebase/auth-guard';
import { allowedVideoRoles, isGuideMediaPath, type VideoRole } from '@/lib/guides/media';
import { openGuideMediaFile } from '@/lib/guides/media-manifest.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = { mp4: 'video/mp4', webp: 'image/webp', vtt: 'text/vtt; charset=utf-8' };

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const rel = (await params).path.join('/');
  const ext = rel.split('.').pop()?.toLowerCase() ?? '';
  if (!isGuideMediaPath(rel) || !TYPES[ext]) return new Response('Not found', { status: 404 });
  const folder = rel.split('/')[0] as VideoRole;
  if (!allowedVideoRoles(auth.user.role).includes(folder)) return new Response('Forbidden', { status: 403 });

  const file = await openGuideMediaFile(rel);
  if (!file) return new Response('Not found', { status: 404 });
  const headers: Record<string, string> = {
    'Content-Type': TYPES[ext],
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=31536000, immutable',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
  if (range && file.size > 0 && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : file.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : file.size - 1;
    start = Math.max(0, start);
    end = Math.min(file.size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${file.size}` } });
    return new Response(file.stream({ start, end }), {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${file.size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  return new Response(file.stream(), { status: 200, headers: { ...headers, 'Content-Length': String(file.size) } });
}
