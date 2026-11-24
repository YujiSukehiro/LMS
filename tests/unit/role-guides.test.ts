import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ALL_ROLES, can } from '@/lib/auth/rbac';
import type { UserRole } from '@/lib/schemas/domain';
import { GUIDES } from '@/lib/guides';
import { guideRoleFor, resolveGuideRole, visibleGuideRoles } from '@/lib/guides/access';
import { guideFileName, guideToMarkdown } from '@/lib/guides/markdown';
import { filterGuide } from '@/lib/guides/search';
import { GUIDE_ROLES, type GuideRoleId } from '@/lib/guides/types';
import { GuideView } from '@/components/guide/GuideView';
import { dismissedCookieValue, shouldShowGuideBanner } from '@/components/guide/guide-banner-cookie';

const ROOT = path.resolve(__dirname, '../..');
const APP_DIR = path.join(ROOT, 'src', 'app');

/** Every page route under src/app as a regex (route groups dropped, [param] = one segment). */
function pageRoutePatterns(): RegExp[] {
  const patterns: RegExp[] = [];
  const walk = (dir: string, segments: string[]) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === 'api' || name.startsWith('_')) continue;
        walk(full, /^\(.*\)$/.test(name) ? segments : [...segments, name]);
      } else if (name === 'page.tsx') {
        const body = segments.map((s) => (/^\[.+\]$/.test(s) ? '[^/]+' : s.replace(/[.*+?^${}()|\\]/g, '\\$&'))).join('/');
        patterns.push(new RegExp(`^/${body}$`));
      }
    }
  };
  walk(APP_DIR, []);
  return patterns;
}

/** Representative signed-in role for each guide. */
const ROLE_FOR_GUIDE: Record<GuideRoleId, UserRole> = {
  AGENT: 'AGENT',
  SUPERVISOR: 'PARTNER_SUPERVISOR',
  TRAINER: 'TRAINER',
  ADMIN: 'ADMIN',
};

describe('role guides', () => {
  it('has one guide per role with unique, non-empty sections', () => {
    for (const role of GUIDE_ROLES) {
      const guide = GUIDES[role];
      expect(guide.role).toBe(role);
      const ids = guide.chapters.flatMap((chapter) => chapter.sections.map((section) => section.id));
      expect(ids.length).toBeGreaterThan(3);
      expect(new Set(ids).size).toBe(ids.length);
      for (const chapter of guide.chapters) {
        for (const section of chapter.sections) {
          expect(section.what.trim(), `${role}/${section.id} what`).not.toBe('');
          expect(section.when.trim(), `${role}/${section.id} when`).not.toBe('');
          expect(section.id).toMatch(/^[a-z0-9-]+$/);
          // Bold markers come in pairs, or the label renders with stray asterisks.
          for (const text of [section.what, section.when, ...section.steps, ...(section.tips ?? [])]) {
            expect((text.match(/\*\*/g) ?? []).length % 2, `${role}/${section.id}: ${text}`).toBe(0);
          }
        }
      }
    }
  });

  it('maps every signed-in role to its own guide', () => {
    expect(guideRoleFor('AGENT')).toBe('AGENT');
    expect(guideRoleFor('PARTNER_SUPERVISOR')).toBe('SUPERVISOR');
    expect(guideRoleFor('TRAINER')).toBe('TRAINER');
    expect(guideRoleFor('ADMIN')).toBe('ADMIN');
    expect(guideRoleFor('SUPER_ADMIN')).toBe('ADMIN');
  });

  it('shows each role its own guide plus the guides of the roles it manages', () => {
    expect(visibleGuideRoles('AGENT')).toEqual(['AGENT']);
    expect(visibleGuideRoles('PARTNER_SUPERVISOR')).toEqual(['SUPERVISOR', 'AGENT']);
    expect(visibleGuideRoles('TRAINER')).toEqual(['TRAINER', 'SUPERVISOR', 'AGENT']);
    expect(visibleGuideRoles('ADMIN')).toEqual(['ADMIN', 'TRAINER', 'SUPERVISOR', 'AGENT']);
    expect(visibleGuideRoles('SUPER_ADMIN')).toEqual(['ADMIN', 'TRAINER', 'SUPERVISOR', 'AGENT']);
  });

  it('never opens a guide above the reader through ?role=', () => {
    expect(resolveGuideRole('AGENT', 'admin')).toBe('AGENT');
    expect(resolveGuideRole('PARTNER_SUPERVISOR', 'trainer')).toBe('SUPERVISOR');
    expect(resolveGuideRole('TRAINER', 'admin')).toBe('TRAINER');
    expect(resolveGuideRole('TRAINER', 'agent')).toBe('AGENT');
    expect(resolveGuideRole('ADMIN', 'Supervisor')).toBe('SUPERVISOR');
    expect(resolveGuideRole('ADMIN', undefined)).toBe('ADMIN');
  });

  it('only teaches features the role can reach in the RBAC matrix', () => {
    for (const role of GUIDE_ROLES) {
      const userRole = ROLE_FOR_GUIDE[role];
      for (const section of GUIDES[role].chapters.flatMap((chapter) => chapter.sections)) {
        for (const permission of section.requires ?? []) {
          expect(can(userRole, permission), `${role}/${section.id} needs ${permission}`).toBe(true);
        }
      }
    }
    // Admin-only features stay out of the Trainer and Supervisor guides.
    for (const role of ['TRAINER', 'SUPERVISOR', 'AGENT'] as const) {
      const permissions = GUIDES[role].chapters.flatMap((c) => c.sections.flatMap((s) => s.requires ?? []));
      expect(permissions).not.toContain('cohorts.create');
      expect(permissions).not.toContain('cohorts.edit');
    }
  });

  it('links only to pages that exist, and to the Guide tabs the reader can open', () => {
    const patterns = pageRoutePatterns();
    expect(patterns.some((p) => p.test('/guide'))).toBe(true);
    for (const role of GUIDE_ROLES) {
      const allowed = visibleGuideRoles(ROLE_FOR_GUIDE[role]).map((id) => id.toLowerCase());
      for (const section of GUIDES[role].chapters.flatMap((chapter) => chapter.sections)) {
        for (const link of section.links ?? []) {
          const url = new URL(link.href.replace(':uid', 'uid-1'), 'https://pulse.test');
          expect(patterns.some((p) => p.test(url.pathname)), `${role}/${section.id} → ${link.href}`).toBe(true);
          if (url.pathname === '/guide' && url.searchParams.has('role')) {
            expect(allowed, `${role}/${section.id} → ${link.href}`).toContain(url.searchParams.get('role'));
          }
        }
      }
    }
  });

  it('keeps the staff guides pointing at the Agent guide', () => {
    for (const role of ['SUPERVISOR', 'TRAINER', 'ADMIN'] as const) {
      const hrefs = GUIDES[role].chapters.flatMap((c) => c.sections.flatMap((s) => (s.links ?? []).map((l) => l.href)));
      expect(hrefs).toContain('/guide?role=agent');
    }
  });

  it('filters sections by every word of the search', () => {
    const guide = GUIDES.AGENT;
    expect(filterGuide(guide, '')).toBe(guide.chapters);
    expect(filterGuide(guide, 'zzzz-no-such-word')).toEqual([]);
    const hits = filterGuide(guide, 'verbal practice').flatMap((c) => c.sections.map((s) => s.id));
    expect(hits).toContain('verbal-practice');
  });

  it('renders the reader’s guide with tabs only for the guides they may open', () => {
    const html = (role: UserRole) =>
      renderToStaticMarkup(
        createElement(GuideView, { uid: 'u1', roles: visibleGuideRoles(role), initialRole: guideRoleFor(role) }),
      );
    const agent = html('AGENT');
    expect(agent).toContain(GUIDES.AGENT.title);
    expect(agent).not.toContain('role="tablist"');
    const supervisor = html('PARTNER_SUPERVISOR');
    expect(supervisor).toContain(GUIDES.SUPERVISOR.title);
    expect((supervisor.match(/role="tab"/g) ?? []).length).toBe(2);
    expect(supervisor).not.toContain('>Trainer<');
    const admin = html('SUPER_ADMIN');
    expect(admin).toContain(GUIDES.ADMIN.title);
    expect((admin.match(/role="tab"/g) ?? []).length).toBe(4);
    // Own-uid links (the Readiness Passport) resolve for the reader.
    expect(agent).toContain('/analytics/agents/u1');
  });

  it('keeps docs/guides in sync with the guide data (run npm run guides:export)', () => {
    for (const role of GUIDE_ROLES) {
      const guide = GUIDES[role];
      const file = path.join(ROOT, 'docs', 'guides', guideFileName(guide));
      expect(readFileSync(file, 'utf8'), file).toBe(guideToMarkdown(guide));
    }
  });

  it('remembers the "New here?" banner per user', () => {
    expect(shouldShowGuideBanner(undefined, 'a')).toBe(true);
    const afterA = dismissedCookieValue(undefined, 'a');
    expect(shouldShowGuideBanner(afterA, 'a')).toBe(false);
    expect(shouldShowGuideBanner(afterA, 'b')).toBe(true);
    const afterB = dismissedCookieValue(afterA, 'b');
    expect(shouldShowGuideBanner(afterB, 'a')).toBe(false);
    expect(shouldShowGuideBanner(afterB, 'b')).toBe(false);
  });

  it('covers every app role', () => {
    for (const role of ALL_ROLES) expect(GUIDES[guideRoleFor(role)]).toBeDefined();
  });
});
