/**
 * How To videos and screenshots. Client-safe types and helpers.
 *
 * - Chapter start times per guide section are generated from the recording run's timing
 *   (`npm run guides:media` writes media-chapters.generated.ts). Never type them by hand.
 * - Media files are not in git and are never public. Every file sits in a role folder (agent/, supervisor/,
 *   trainer/, admin/) and is served only through /api/guide-media, which checks the viewer's role.
 * - manifest.json lists what exists. No manifest, or a file missing from it, means the player, Watch buttons and
 *   screenshot toggles stay hidden and the text guide still works.
 */
import type { UserRole } from '@/lib/schemas/domain';
import { visibleGuideRoles } from './access';
import type { GuideRoleId } from './types';

export const VIDEO_ROLES = ['agent', 'supervisor', 'trainer', 'admin'] as const;
export type VideoRole = (typeof VIDEO_ROLES)[number];

/** Where a guide section starts in which role's video. */
export interface SectionMedia {
  video: VideoRole;
  /** Seconds from the start of that video. */
  start: number;
}

/** manifest.json in the media store. Paths are `<role folder>/<content-hashed file>`. */
export interface GuideMediaManifest {
  version: 2;
  videos: Partial<Record<VideoRole, { file: string; poster: string; vtt?: string; duration: number }>>;
  /** Screenshot paths per `${guideRole}:${sectionId}`, in display order. */
  screenshots: Record<string, string[]>;
}

/** Same-origin route that serves media after a role check. */
export const GUIDE_MEDIA_ROUTE = '/api/guide-media';

export function guideMediaUrl(path: string): string {
  return `${GUIDE_MEDIA_ROUTE}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** The video role that goes with each guide. */
export const VIDEO_FOR_GUIDE: Record<GuideRoleId, VideoRole> = {
  AGENT: 'agent',
  SUPERVISOR: 'supervisor',
  TRAINER: 'trainer',
  ADMIN: 'admin',
};

/** Media folders a signed-in role may load: its own role and the roles below it, never above. */
export function allowedVideoRoles(role: UserRole): VideoRole[] {
  return visibleGuideRoles(role).map((guideRole) => VIDEO_FOR_GUIDE[guideRole]);
}

export function screenshotKey(role: GuideRoleId, sectionId: string): string {
  return `${role}:${sectionId}`;
}

/** m:ss */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const FOLDER_PATH = /^(agent|supervisor|trainer|admin)\/[a-z0-9][a-z0-9._-]{0,120}$/i;

/** True for a well-formed media path inside one of the role folders. */
export function isGuideMediaPath(path: string): boolean {
  return FOLDER_PATH.test(path);
}

/** A manifest with only well-formed entries; anything else counts as missing. */
export function normalizeManifest(raw: unknown): GuideMediaManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<GuideMediaManifest>;
  if (value.version !== 2) return null;
  const videos: GuideMediaManifest['videos'] = {};
  for (const role of VIDEO_ROLES) {
    const v = value.videos?.[role];
    if (
      v &&
      typeof v.file === 'string' &&
      isGuideMediaPath(v.file) &&
      v.file.startsWith(`${role}/`) &&
      typeof v.poster === 'string' &&
      isGuideMediaPath(v.poster) &&
      typeof v.duration === 'number'
    ) {
      videos[role] = { file: v.file, poster: v.poster, duration: v.duration, ...(typeof v.vtt === 'string' && isGuideMediaPath(v.vtt) ? { vtt: v.vtt } : {}) };
    }
  }
  const screenshots: Record<string, string[]> = {};
  for (const [key, files] of Object.entries(value.screenshots ?? {})) {
    if (Array.isArray(files)) screenshots[key] = files.filter((f): f is string => typeof f === 'string' && isGuideMediaPath(f)).slice(0, 3);
  }
  return { version: 2, videos, screenshots };
}
