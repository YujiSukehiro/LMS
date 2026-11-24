import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ALL_ROLES, can } from '@/lib/auth/rbac';
import { PASSWORD_MIN_LENGTH } from '@/lib/schemas/constants';
import type { UserRole } from '@/lib/schemas/domain';
import { GUIDES } from '@/lib/guides';
import { guideRoleFor, resolveGuideRole, visibleGuideRoles } from '@/lib/guides/access';
import { guideFileName, guideToMarkdown } from '@/lib/guides/markdown';
import { filterGuide } from '@/lib/guides/search';
import { GUIDE_ROLES, type GuideRoleId } from '@/lib/guides/types';
import { HowToView } from '@/components/guide/HowToView';
import { GUIDE_NAV_ITEM } from '@/components/layout/nav-config';
import { GUIDE_SECTION_MEDIA, GUIDE_VIDEO_DURATIONS } from '@/lib/guides/media-chapters.generated';
import { VIDEO_ROLES, normalizeManifest, type GuideMediaManifest } from '@/lib/guides/media';
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
    expect(patterns.some((p) => p.test('/how-to'))).toBe(true);
    expect(patterns.some((p) => p.test('/guide'))).toBe(true); // old links redirect
    for (const role of GUIDE_ROLES) {
      const allowed = visibleGuideRoles(ROLE_FOR_GUIDE[role]).map((id) => id.toLowerCase());
      for (const section of GUIDES[role].chapters.flatMap((chapter) => chapter.sections)) {
        for (const link of section.links ?? []) {
          const url = new URL(link.href.replace(':uid', 'uid-1'), 'https://pulse.test');
          expect(patterns.some((p) => p.test(url.pathname)), `${role}/${section.id} → ${link.href}`).toBe(true);
          if (url.pathname === '/how-to' && url.searchParams.has('role')) {
            expect(allowed, `${role}/${section.id} → ${link.href}`).toContain(url.searchParams.get('role'));
          }
        }
      }
    }
  });

  it('keeps the staff guides pointing at the Agent guide', () => {
    for (const role of ['SUPERVISOR', 'TRAINER', 'ADMIN'] as const) {
      const hrefs = GUIDES[role].chapters.flatMap((c) => c.sections.flatMap((s) => (s.links ?? []).map((l) => l.href)));
      expect(hrefs).toContain('/how-to?role=agent');
    }
  });

  it('filters sections by every word of the search', () => {
    const guide = GUIDES.AGENT;
    expect(filterGuide(guide, '')).toBe(guide.chapters);
    expect(filterGuide(guide, 'zzzz-no-such-word')).toEqual([]);
    const hits = filterGuide(guide, 'verbal practice').flatMap((c) => c.sections.map((s) => s.id));
    expect(hits).toContain('verbal-practice');
  });

  const render = (role: UserRole, manifest: GuideMediaManifest | null = null, initial?: GuideRoleId) =>
    renderToStaticMarkup(
      createElement(HowToView, {
        uid: 'u1',
        roles: visibleGuideRoles(role),
        initialRole: initial ?? guideRoleFor(role),
        manifest,
        mediaBase: '/guide-media',
      }),
    );

  /** A manifest that lists every video and two screenshots for every section with a chapter. */
  const fullManifest: GuideMediaManifest = {
    version: 1,
    videos: Object.fromEntries(VIDEO_ROLES.map((v) => [v, { file: `${v}.mp4`, poster: `${v}.webp`, duration: 200 }])),
    screenshots: Object.fromEntries(
      GUIDE_ROLES.flatMap((role) => Object.keys(GUIDE_SECTION_MEDIA[role]).map((id) => [`${role}:${id}`, [`${id}-1.webp`, `${id}-2.webp`]])),
    ),
  };

  it('renders the reader’s guide with tabs only for the guides they may open', () => {
    const agent = render('AGENT');
    expect(agent).toContain(GUIDES.AGENT.title);
    expect(agent).not.toContain('role="tablist"');
    const supervisor = render('PARTNER_SUPERVISOR');
    expect(supervisor).toContain(GUIDES.SUPERVISOR.title);
    expect((supervisor.match(/role="tab"/g) ?? []).length).toBe(2);
    expect(supervisor).not.toContain('>Trainer<');
    const admin = render('SUPER_ADMIN');
    expect(admin).toContain(GUIDES.ADMIN.title);
    expect((admin.match(/role="tab"/g) ?? []).length).toBe(4);
    // Own-uid links (the Readiness Passport) resolve for the reader.
    expect(agent).toContain('/analytics/agents/u1');
  });

  it('hides every video control and screenshot toggle when no media is published', () => {
    for (const role of ['AGENT', 'PARTNER_SUPERVISOR', 'TRAINER', 'ADMIN'] as const) {
      const html = render(role, null);
      expect(html).not.toContain('Watch (');
      expect(html).not.toContain('Show screenshots');
      expect(html).not.toContain('Watch the');
      expect(html).not.toContain('<video');
      expect(html).not.toContain('<img');
    }
    // A manifest without this role's video hides that role's player and Watch buttons.
    const noAgent = normalizeManifest({ ...fullManifest, videos: { trainer: fullManifest.videos.trainer } });
    expect(render('AGENT', noAgent)).not.toContain('Watch (');
  });

  it('loads no video or image until the reader asks for one', () => {
    for (const role of ['AGENT', 'PARTNER_SUPERVISOR', 'TRAINER', 'ADMIN'] as const) {
      const html = render(role, fullManifest);
      expect(html).not.toContain('<video');
      expect(html).not.toContain('<img');
      expect(html).not.toContain('.webp');
      expect(html).not.toContain('.mp4');
      if (Object.keys(GUIDE_SECTION_MEDIA[guideRoleFor(role)]).length > 0) {
        expect(html).toContain('Watch the');
        expect(html).toContain('Watch (');
        expect(html).toContain('Show screenshots (2)');
      }
    }
  });

  it('gives every section a stable anchor, and ?role= picks the tab', () => {
    for (const role of GUIDE_ROLES) {
      const reader: UserRole = role === 'SUPERVISOR' ? 'PARTNER_SUPERVISOR' : role;
      const html = render('SUPER_ADMIN', null, resolveGuideRole('SUPER_ADMIN', role.toLowerCase()));
      expect(html).toContain(`<h1 class="text-xl font-bold tracking-tight sm:text-2xl">${GUIDES[role].title}</h1>`);
      expect(html).toContain(`aria-selected="true" aria-controls="guide-panel"`);
      for (const section of GUIDES[role].chapters.flatMap((c) => c.sections)) {
        expect(html, `${role}#${section.id}`).toContain(`id="${section.id}"`);
        expect(html).toContain(`href="#${section.id}"`);
      }
      expect(resolveGuideRole(reader, role.toLowerCase())).toBe(role);
    }
    // Ids are explicit data, not slugs of the title: they survive a title edit.
    const edited = GUIDES.AGENT.chapters[0].sections.map((s) => ({ ...s, title: `${s.title} (renamed)` }));
    expect(edited.map((s) => s.id)).toEqual(GUIDES.AGENT.chapters[0].sections.map((s) => s.id));
  });

  it('only times sections that exist, inside the recorded video', () => {
    for (const role of GUIDE_ROLES) {
      const ids = new Set(GUIDES[role].chapters.flatMap((c) => c.sections.map((s) => s.id)));
      for (const [id, media] of Object.entries(GUIDE_SECTION_MEDIA[role])) {
        expect(ids.has(id), `${role}#${id}`).toBe(true);
        expect(media.start).toBeGreaterThanOrEqual(0);
        const duration = GUIDE_VIDEO_DURATIONS[media.video];
        if (duration) expect(media.start).toBeLessThan(duration);
      }
    }
  });

  it('names the page How To in the navigation', () => {
    expect(GUIDE_NAV_ITEM).toMatchObject({ href: '/how-to', label: 'How To' });
  });

  it('keeps docs/guides in sync with the guide data (run npm run guides:export)', () => {
    for (const role of GUIDE_ROLES) {
      const guide = GUIDES[role];
      const file = path.join(ROOT, 'docs', 'guides', guideFileName(guide));
      expect(readFileSync(file, 'utf8'), file).toBe(guideToMarkdown(guide));
    }
  });

  it('teaches multi-Cohort assignment and revoking with the labels the app really shows', () => {
    const read = (rel: string) => readFileSync(path.join(ROOT, 'src', rel), 'utf8');
    const ui = {
      'Also in these Cohorts': read('app/(dashboard)/roster/_components/EditUserPermissionsDialog.tsx'),
      'Save trainings': read('app/(dashboard)/roster/_components/CohortTrainingsDialog.tsx'),
      'Specific people': read('components/studio/PublishDialog.tsx'),
      'Save assignment only': read('components/studio/PublishDialog.tsx'),
      Revoke: read('components/analytics/RevokeCertificationButton.tsx'),
      'Revoke certification': read('components/analytics/RevokeCertificationButton.tsx'),
    };
    for (const role of ['TRAINER', 'ADMIN'] as const) {
      const text = guideToMarkdown(GUIDES[role]);
      expect(text).toContain('### Assign trainings to Cohorts or people');
      expect(text).toContain('### Revoke a certification');
      for (const [label, source] of Object.entries(ui)) {
        expect(source, `UI still shows "${label}"`).toContain(label);
        expect(text, `${role} guide mentions "${label}"`).toContain(`**${label}**`);
      }
    }
    // Password minimum matches the app everywhere a guide mentions one.
    for (const role of GUIDE_ROLES) {
      const text = guideToMarkdown(GUIDES[role]);
      for (const match of text.matchAll(/at least (\d+) characters/g)) expect(Number(match[1])).toBe(PASSWORD_MIN_LENGTH);
    }
    // Every guide states the any-Cohort-or-by-name rule; no section is left flagged for a later update.
    expect(guideToMarkdown(GUIDES.AGENT)).toContain('one of your Cohorts or to you by name');
    const retention = readFileSync(path.join(ROOT, 'src/app/(dashboard)/learn/_components/RetentionRunner.tsx'), 'utf8');
    expect(retention).toContain('Mastered</span>');
    expect(retention).not.toContain('Certified Unlocked');
    expect(guideToMarkdown(GUIDES.AGENT)).toContain('**Mastered**');
    for (const role of GUIDE_ROLES) {
      for (const section of GUIDES[role].chapters.flatMap((c) => c.sections)) {
        expect(section.maintainerNote, `${role}/${section.id}`).toBeUndefined();
      }
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
