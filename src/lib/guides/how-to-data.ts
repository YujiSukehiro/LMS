/**
 * What the How To page may send to a signed-in user. SERVER SIDE (page and /api/how-to/[role]).
 *
 * RBAC: a reader gets their own role's guide and the guides of the roles below theirs, never above
 * (visibleGuideRoles). Only the reader's own guide, and a lower one they deep-linked to, travel with the page; other
 * lower roles are sent as a title and section count and load from /api/how-to/[role] when expanded.
 */
import type { UserRole } from '@/lib/schemas/domain';
import { GUIDES } from '.';
import { guideRoleFor, resolveGuideRole, visibleGuideRoles } from './access';
import { GUIDE_SECTION_MEDIA } from './media-chapters.generated';
import {
  VIDEO_FOR_GUIDE,
  allowedVideoRoles,
  guideMediaUrl,
  screenshotKey,
  type GuideMediaManifest,
  type SectionMedia,
  type VideoRole,
} from './media';
import type { GuideRoleId, RoleGuide } from './types';

export interface HowToVideo {
  url: string;
  posterUrl: string;
  vttUrl: string | null;
  duration: number;
}

export interface HowToRoleContent {
  guide: RoleGuide;
  /** Chapter start per section, only where that video exists. */
  media: Record<string, SectionMedia>;
  /** Videos this block plays: its own, plus the Trainer video for sections Admins share with Trainers. */
  videos: Partial<Record<VideoRole, HowToVideo>>;
  /** Screenshot URLs per section id. */
  screenshots: Record<string, string[]>;
}

export interface HowToRoleBlock {
  role: GuideRoleId;
  label: string;
  title: string;
  sectionCount: number;
  /** Null until the block is opened (fetched from /api/how-to/[role]). */
  content: HowToRoleContent | null;
}

export interface HowToPageData {
  /** Reader's own role first, then the roles below it. */
  blocks: HowToRoleBlock[];
  /** Block to open and scroll to (own role, or a lower role from ?role=). */
  focus: GuideRoleId;
}

/** Full content of one guide, with media limited to the folders this reader may load. */
export function buildRoleContent(guideRole: GuideRoleId, readerRole: UserRole, manifest: GuideMediaManifest | null): HowToRoleContent {
  const guide = GUIDES[guideRole];
  const allowed = new Set(allowedVideoRoles(readerRole));
  const videos: HowToRoleContent['videos'] = {};
  const media: Record<string, SectionMedia> = {};
  const screenshots: Record<string, string[]> = {};
  for (const [sectionId, m] of Object.entries(GUIDE_SECTION_MEDIA[guideRole] ?? {})) {
    const entry = manifest?.videos[m.video];
    if (!entry || !allowed.has(m.video)) continue;
    media[sectionId] = m;
    videos[m.video] ??= {
      url: guideMediaUrl(entry.file),
      posterUrl: guideMediaUrl(entry.poster),
      vttUrl: entry.vtt ? guideMediaUrl(entry.vtt) : null,
      duration: entry.duration,
    };
    const shots = (manifest?.screenshots[screenshotKey(guideRole, sectionId)] ?? []).filter((path) => allowed.has(path.split('/')[0] as VideoRole));
    if (shots.length > 0) screenshots[sectionId] = shots.map(guideMediaUrl);
  }
  // The block's own video plays at the top even if no section points at it.
  const own = VIDEO_FOR_GUIDE[guideRole];
  const ownEntry = manifest?.videos[own];
  if (ownEntry && allowed.has(own) && !videos[own]) {
    videos[own] = { url: guideMediaUrl(ownEntry.file), posterUrl: guideMediaUrl(ownEntry.poster), vttUrl: ownEntry.vtt ? guideMediaUrl(ownEntry.vtt) : null, duration: ownEntry.duration };
  }
  return { guide, media, videos, screenshots };
}

/** The page payload for a reader. Never contains a guide above the reader's role. */
export function buildHowToPage(readerRole: UserRole, roleParam: string | null | undefined, manifest: GuideMediaManifest | null): HowToPageData {
  const own = guideRoleFor(readerRole);
  const focus = resolveGuideRole(readerRole, roleParam);
  const blocks = visibleGuideRoles(readerRole).map((role): HowToRoleBlock => {
    const guide = GUIDES[role];
    return {
      role,
      label: guide.label,
      title: guide.title,
      sectionCount: guide.chapters.reduce((sum, chapter) => sum + chapter.sections.length, 0),
      content: role === own || role === focus ? buildRoleContent(role, readerRole, manifest) : null,
    };
  });
  return { blocks, focus };
}

/** May this reader load that guide? (Own role or below.) */
export function canReadGuide(readerRole: UserRole, guideRole: string): guideRole is GuideRoleId {
  return (visibleGuideRoles(readerRole) as string[]).includes(guideRole);
}
