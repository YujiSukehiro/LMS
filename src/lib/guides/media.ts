/**
 * How To videos and screenshots. Client-safe.
 *
 * - Chapter start times per guide section are generated from the recording run's timing
 *   (`npm run guides:media` writes media-chapters.generated.ts). Never type them by hand.
 * - The media files themselves are not in git. They are served from one base URL
 *   (NEXT_PUBLIC_GUIDE_MEDIA_BASE_URL): locally the gitignored public/guide-media/ folder, in production the
 *   signed-in-only proxy /api/guide-media (Firebase Storage guide-media/).
 * - What exists is listed in manifest.json at that base. No manifest, or a file missing from it, means the
 *   Watch buttons, player and screenshot toggles stay hidden and the text guide still works.
 */
import { GUIDE_SECTION_MEDIA, GUIDE_VIDEO_DURATIONS } from './media-chapters.generated';
import type { GuideRoleId } from './types';

export const VIDEO_ROLES = ['agent', 'supervisor', 'trainer', 'admin'] as const;
export type VideoRole = (typeof VIDEO_ROLES)[number];

/** Where a guide section starts in which role's video. */
export interface SectionMedia {
  video: VideoRole;
  /** Seconds from the start of that video. */
  start: number;
}

/** manifest.json at the media base URL. File names carry a content hash, so they can be cached forever. */
export interface GuideMediaManifest {
  version: 1;
  videos: Partial<Record<VideoRole, { file: string; poster: string; duration: number }>>;
  /** Screenshot files per `${guideRole}:${sectionId}`, in display order. */
  screenshots: Record<string, string[]>;
}

const DEFAULT_BASE = '/guide-media';

export function guideMediaBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_GUIDE_MEDIA_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
}

export function guideMediaUrl(file: string, base = guideMediaBaseUrl()): string {
  return `${base}/${file.split('/').map(encodeURIComponent).join('/')}`;
}

/** The video role that goes with each guide tab. */
export const VIDEO_FOR_GUIDE: Record<GuideRoleId, VideoRole> = {
  AGENT: 'agent',
  SUPERVISOR: 'supervisor',
  TRAINER: 'trainer',
  ADMIN: 'admin',
};

export function sectionMedia(role: GuideRoleId, sectionId: string): SectionMedia | null {
  return GUIDE_SECTION_MEDIA[role]?.[sectionId] ?? null;
}

export function recordedVideoDuration(video: VideoRole): number | null {
  return GUIDE_VIDEO_DURATIONS[video] ?? null;
}

export function screenshotKey(role: GuideRoleId, sectionId: string): string {
  return `${role}:${sectionId}`;
}

/** m:ss */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A manifest that only lists well-formed entries; anything else counts as missing. */
export function normalizeManifest(raw: unknown): GuideMediaManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<GuideMediaManifest>;
  if (value.version !== 1) return null;
  const videos: GuideMediaManifest['videos'] = {};
  for (const role of VIDEO_ROLES) {
    const v = value.videos?.[role];
    if (v && typeof v.file === 'string' && typeof v.poster === 'string' && typeof v.duration === 'number') videos[role] = v;
  }
  const screenshots: Record<string, string[]> = {};
  for (const [key, files] of Object.entries(value.screenshots ?? {})) {
    if (Array.isArray(files)) screenshots[key] = files.filter((f): f is string => typeof f === 'string').slice(0, 3);
  }
  return { version: 1, videos, screenshots };
}
