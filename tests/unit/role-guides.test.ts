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
import { VIDEO_ROLES, allowedVideoRoles, normalizeManifest, type GuideMediaManifest } from '@/lib/guides/media';
import { buildHowToPage, buildRoleContent } from '@/lib/guides/how-to-data';
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

  const render = (role: UserRole, manifest: GuideMediaManifest | null = null, roleParam?: string) => {
    const data = buildHowToPage(role, roleParam, manifest);
    return { data, html: renderToStaticMarkup(createElement(HowToView, { uid: 'u1', blocks: data.blocks, focus: data.focus })) };
  };

  /** A manifest that lists every video and two screenshots for every section with a chapter. */
  const fullManifest: GuideMediaManifest = {
    version: 2,
    videos: Object.fromEntries(VIDEO_ROLES.map((v) => [v, { file: `${v}/${v}.mp4`, poster: `${v}/${v}.webp`, vtt: `${v}/${v}.vtt`, duration: 200 }])),
    screenshots: Object.fromEntries(
      GUIDE_ROLES.flatMap((role) =>
        Object.entries(GUIDE_SECTION_MEDIA[role]).map(([id, m]) => [`${role}:${id}`, [`${m.video}/${id}-1.webp`, `${m.video}/${id}-2.webp`]]),
      ),
    ),
  };

  /** Section titles that appear only in one guide (not shared with any other). */
  const uniqueTitles = (role: GuideRoleId) => {
    const others = GUIDE_ROLES.filter((r) => r !== role).flatMap((r) => GUIDES[r].chapters.flatMap((c) => c.sections.map((s) => s.title)));
    return GUIDES[role].chapters.flatMap((c) => c.sections.map((s) => s.title)).filter((t) => !others.includes(t));
  };
  const asHtml = (t: string) => `>${t.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}<`;
  const asJson = (t: string) => `"title":${JSON.stringify(t)}`;
  const ABOVE: Record<UserRole, GuideRoleId[]> = {
    AGENT: ['SUPERVISOR', 'TRAINER', 'ADMIN'],
    PARTNER_SUPERVISOR: ['TRAINER', 'ADMIN'],
    TRAINER: ['ADMIN'],
    ADMIN: [],
    SUPER_ADMIN: [],
  };

  it('opens the reader’s own guide, folds the roles below and leaves out the roles above', () => {
    const expected: Record<UserRole, GuideRoleId[]> = {
      AGENT: ['AGENT'],
      PARTNER_SUPERVISOR: ['SUPERVISOR', 'AGENT'],
      TRAINER: ['TRAINER', 'SUPERVISOR', 'AGENT'],
      ADMIN: ['ADMIN', 'TRAINER', 'SUPERVISOR', 'AGENT'],
      SUPER_ADMIN: ['ADMIN', 'TRAINER', 'SUPERVISOR', 'AGENT'],
    };
    for (const role of ALL_ROLES) {
      const { data, html } = render(role, fullManifest);
      expect(data.blocks.map((b) => b.role)).toEqual(expected[role]);
      const [own, ...lower] = data.blocks;
      // Own guide: content sent and rendered, expanded.
      expect(own.content?.guide.role).toBe(own.role);
      for (const title of uniqueTitles(own.role)) expect(html, `${role} sees ${title}`).toContain(asHtml(title));
      // Lower guides: folded header only; no content sent or rendered until expanded.
      for (const block of lower) {
        expect(block.content).toBeNull();
        expect(html).toContain(`aria-expanded="false" aria-controls="panel-${block.role}"`);
        for (const title of uniqueTitles(block.role)) expect(html, `${role} must not render ${title} yet`).not.toContain(asHtml(title));
      }
      // Higher guides: nowhere, not in the HTML and not in the data sent to the browser.
      const payload = JSON.stringify(data);
      for (const higher of ABOVE[role]) {
        expect(payload).not.toContain(GUIDES[higher].title);
        expect(html).not.toContain(GUIDES[higher].title);
        for (const title of uniqueTitles(higher)) {
          expect(payload, `${role} payload leaks ${title}`).not.toContain(asJson(title));
          expect(html, `${role} page leaks ${title}`).not.toContain(asHtml(title));
        }
      }
      // No role tabs any more.
      expect(html).not.toContain('role="tablist"');
    }
  });

  it('opens a lower role from a deep link and falls back to the reader’s role for a higher one', () => {
    const trainerToAgent = render('TRAINER', null, 'agent');
    expect(trainerToAgent.data.focus).toBe('AGENT');
    expect(trainerToAgent.data.blocks.find((b) => b.role === 'AGENT')?.content).not.toBeNull();
    expect(trainerToAgent.data.blocks.find((b) => b.role === 'SUPERVISOR')?.content).toBeNull();
    for (const section of GUIDES.AGENT.chapters.flatMap((c) => c.sections)) {
      expect(trainerToAgent.html).toContain(`id="agent--${section.id}"`);
    }
    const agentToAdmin = render('AGENT', null, 'admin');
    expect(agentToAdmin.data.focus).toBe('AGENT');
    expect(JSON.stringify(agentToAdmin.data)).not.toContain(GUIDES.ADMIN.title);
    const supervisorToTrainer = render('PARTNER_SUPERVISOR', null, 'trainer');
    expect(supervisorToTrainer.data.focus).toBe('SUPERVISOR');
    expect(JSON.stringify(supervisorToTrainer.data)).not.toContain(GUIDES.TRAINER.title);
  });

  it('gives every section of an open guide a stable, unique anchor', () => {
    for (const role of GUIDE_ROLES) {
      const reader: UserRole = role === 'SUPERVISOR' ? 'PARTNER_SUPERVISOR' : role;
      const { html } = render(reader);
      const ids = GUIDES[role].chapters.flatMap((c) => c.sections.map((s) => s.id));
      for (const id of ids) {
        expect(html, `${role}#${id}`).toContain(`id="${role.toLowerCase()}--${id}"`);
        expect(html).toContain(`href="#${role.toLowerCase()}--${id}"`);
      }
    }
    // Ids are explicit data, not slugs of the title: they survive a title edit.
    const edited = GUIDES.AGENT.chapters[0].sections.map((s) => ({ ...s, title: `${s.title} (renamed)` }));
    expect(edited.map((s) => s.id)).toEqual(GUIDES.AGENT.chapters[0].sections.map((s) => s.id));
  });

  it('hides every video control and screenshot toggle when no media is published', () => {
    for (const role of ALL_ROLES) {
      const { html } = render(role, null);
      expect(html).not.toContain('Watch (');
      expect(html).not.toContain('Show screenshots');
      expect(html).not.toContain('Watch the');
      expect(html).not.toContain('<video');
      expect(html).not.toContain('<img');
    }
    // A manifest without this role's video hides that role's player and Watch buttons.
    const noAgent = normalizeManifest({ ...fullManifest, videos: { trainer: fullManifest.videos.trainer } });
    expect(render('AGENT', noAgent).html).not.toContain('Watch (');
  });

  it('loads no video or image until the reader asks for one', () => {
    for (const role of ALL_ROLES) {
      const { html } = render(role, fullManifest);
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

  it('never hands a reader media from a role folder above theirs', () => {
    for (const role of ALL_ROLES) {
      const allowed = allowedVideoRoles(role);
      for (const guideRole of visibleGuideRoles(role)) {
        const content = buildRoleContent(guideRole, role, fullManifest);
        const urls = [
          ...Object.values(content.videos).flatMap((v) => [v!.url, v!.posterUrl, v!.vttUrl ?? '']),
          ...Object.values(content.screenshots).flat(),
        ].filter(Boolean);
        for (const url of urls) {
          const folder = url.replace('/api/guide-media/', '').split('/')[0];
          expect(allowed, `${role} gets ${url}`).toContain(folder);
        }
      }
    }
    expect(allowedVideoRoles('AGENT')).toEqual(['agent']);
    expect(allowedVideoRoles('PARTNER_SUPERVISOR')).toEqual(['supervisor', 'agent']);
    expect(allowedVideoRoles('TRAINER')).toEqual(['trainer', 'supervisor', 'agent']);
    expect(allowedVideoRoles('ADMIN')).toEqual(['admin', 'trainer', 'supervisor', 'agent']);
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

describe('How To player sound', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/components/guide/HowToView.tsx'), 'utf8');

  it('plays with sound at half volume after a click, with no muted start', () => {
    expect(source).toMatch(/PLAYER_START_VOLUME = 0\.5/);
    expect(source).toMatch(/el\.muted = false/);
    expect(source).not.toMatch(/Turn on sound/);
    expect(source).not.toMatch(/\bmuted=\{/);
    expect(source).not.toMatch(/\bautoPlay\b/);
  });
});
