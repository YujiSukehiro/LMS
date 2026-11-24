/**
 * Typed content for the in-app "How to use LogiCall Pulse" guides. Pure data: the Guide page, the Markdown export
 * (scripts/export-guides.ts) and the tests all read the same objects, so a wording change happens in one place.
 *
 * Text conventions (kept tiny so the Markdown export stays identical):
 * - `**Label**` marks an exact UI label (a button, tab, page or field name). Rendered bold.
 * - Plain sentences otherwise. No other Markdown.
 */
import type { Permission } from '@/lib/auth/rbac';

/** The four guides. Super Admins read the Admin guide; Partner Supervisors read the Supervisor guide. */
export const GUIDE_ROLES = ['AGENT', 'SUPERVISOR', 'TRAINER', 'ADMIN'] as const;
export type GuideRoleId = (typeof GUIDE_ROLES)[number];

export interface GuideLink {
  label: string;
  /**
   * An app path. `:uid` is replaced with the reader's own uid (for example the Readiness Passport). Query strings are
   * allowed. The tests check that every path matches a real page.
   */
  href: string;
}

export interface GuideSection {
  /** Stable anchor id, unique within a guide (used by jump links: /guide?role=agent#verbal-practice). */
  id: string;
  title: string;
  /** "What it is": one or two plain sentences. */
  what: string;
  /** "When to use it". */
  when: string;
  /** "How to": numbered steps using the real UI labels. */
  steps: string[];
  /** Tips and gotchas. */
  tips?: string[];
  /** Deep links to the pages this section talks about. */
  links?: GuideLink[];
  /**
   * Permissions the reader's role must hold for this section to make sense. The tests check every section in a
   * role's guide against the RBAC matrix, so a guide never teaches a feature the role cannot reach.
   */
  requires?: Permission[];
  /**
   * Maintainer note, never shown in the app or the export. Use it to flag text that must change when a known
   * feature lands (for example multi-Cohort membership).
   */
  maintainerNote?: string;
}

export interface GuideChapter {
  id: string;
  title: string;
  sections: GuideSection[];
}

export interface RoleGuide {
  role: GuideRoleId;
  /** Tab label, e.g. "Agent". */
  label: string;
  title: string;
  /** One or two sentences: who this guide is for and what they do in Pulse. */
  intro: string;
  chapters: GuideChapter[];
}
