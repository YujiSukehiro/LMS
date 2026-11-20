/**
 * Records a captioned demo video for each user type against the local app.
 *
 * The recording shows a visible cursor that glides to each target, a highlight ring around the
 * element before it is clicked, a click ripple, and a key badge for keyboard shortcuts.
 * Navigation happens by clicking links and buttons, never by jumping to a URL.
 *
 * Needs: `npm run emulators`, `npm run seed:local`, the app on :3000 (for the demo stand-in:
 * `AI_PROVIDER=replay npm run start`), Google Chrome, and ffmpeg.
 * The replay file (demo-replay/demo.json) cites the 16-page Playbook
 * "demo-recordings/Standard Meds training PDFs/Standard Meds - 01 Neuropathy - NeuroCalmRx.pdf"; upload that one.
 * Run:   npx tsx --env-file=.env.local scripts/record-demo.ts [trainer agent supervisor admin] --pdf=path/to/Playbook.pdf
 * Check: npx tsx --env-file=.env.local scripts/record-demo.ts --dry-run [DEMO_TRACK_ID=<built draft>]
 *        signs in and checks every Studio selector the clips use, without recording, uploading or publishing.
 * Output: demo-recordings/<clip>.mp4 and demo-recordings/LogiCall-Pulse-demo.mp4 (all clips joined).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Locator, type Page } from '@playwright/test';
import { adminDb } from '../src/lib/firebase/admin';
import type { DrillItem, EvalRubricsDoc, TrackDoc, TrackVersionDoc } from '../src/lib/schemas/curriculum';
import { CanonicalDispositionSchema } from '../src/lib/schemas/source-truth';
import { demoQAFixtures } from './demo-qa-fixtures';

const BASE_URL = process.env.DEMO_BASE_URL ?? 'http://localhost:3000';
const PASSWORD = 'PulseDemo!2026';
const OUT_DIR = resolve('demo-recordings');
const RAW_DIR = join(OUT_DIR, 'raw');
const VIEWPORT = { width: 1280, height: 800 };

/** Injected into every page: fake cursor, click ripple, highlight ring, key badge, caption bar. */
const OVERLAY_SCRIPT = `
(() => {
  const Z = 2147483646;
  const install = () => {
    if (document.getElementById('demo-cursor')) return;
    const style = document.createElement('style');
    style.textContent = \`
      #demo-cursor { position: fixed; left: 0; top: 0; width: 30px; height: 30px; z-index: \${Z + 1}; pointer-events: none;
        transform: translate(-4px, -2px); transition: transform 60ms linear; filter: drop-shadow(0 2px 4px rgba(0,0,0,.6)); display: none; }
      .demo-ripple { position: fixed; z-index: \${Z}; pointer-events: none; width: 18px; height: 18px; margin: -9px 0 0 -9px;
        border-radius: 50%; border: 3px solid #fbbf24; background: rgba(251,191,36,.35); animation: demo-ripple 650ms ease-out forwards; }
      @keyframes demo-ripple { to { transform: scale(4.2); opacity: 0; } }
      #demo-hl { position: fixed; z-index: \${Z - 1}; pointer-events: none; border: 3px solid #fbbf24; border-radius: 10px;
        box-shadow: 0 0 0 4px rgba(251,191,36,.25), 0 0 24px rgba(251,191,36,.55); display: none; transition: all 180ms ease; }
      #demo-key { position: fixed; right: 28px; top: 74px; z-index: \${Z}; pointer-events: none; display: none;
        padding: 10px 16px; border-radius: 10px; background: rgba(2,6,23,.92); border: 2px solid #fbbf24; color: #fde68a;
        font: 700 18px/1 ui-monospace, Menlo, monospace; box-shadow: 0 10px 30px rgba(0,0,0,.5); }
      #demo-caption { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: \${Z}; max-width: 1000px;
        padding: 11px 20px; border-radius: 10px; background: rgba(2,6,23,.92); border: 1px solid rgba(99,102,241,.8); color: #f8fafc;
        font: 600 18px/1.35 system-ui, -apple-system, sans-serif; text-align: center; pointer-events: none;
        box-shadow: 0 10px 30px rgba(0,0,0,.45); display: none; }
    \`;
    document.head.appendChild(style);
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    cursor.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.6 14.6 L11.6 21.5 L14.6 20.2 L11.6 13.4 L18 13.4 Z" fill="#ffffff" stroke="#0b1120" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    const hl = document.createElement('div'); hl.id = 'demo-hl';
    const key = document.createElement('div'); key.id = 'demo-key';
    const cap = document.createElement('div'); cap.id = 'demo-caption';
    document.body.append(cursor, hl, key, cap);
    const place = (x, y) => { cursor.style.display = 'block'; cursor.style.left = x + 'px'; cursor.style.top = y + 'px'; };
    window.addEventListener('mousemove', (e) => { place(e.clientX, e.clientY); try { sessionStorage.setItem('demo-cursor', e.clientX + ',' + e.clientY); } catch {} }, true);
    window.addEventListener('mousedown', (e) => {
      const r = document.createElement('div'); r.className = 'demo-ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      document.body.appendChild(r); setTimeout(() => r.remove(), 700);
    }, true);
    try { const saved = sessionStorage.getItem('demo-cursor'); if (saved) { const [x, y] = saved.split(',').map(Number); place(x, y); } } catch {}
    window.__demoHl = (x, y, w, h) => { hl.style.display = 'block'; hl.style.left = (x - 6) + 'px'; hl.style.top = (y - 6) + 'px'; hl.style.width = (w + 12) + 'px'; hl.style.height = (h + 12) + 'px'; };
    window.__demoHlOff = () => { hl.style.display = 'none'; };
    window.__demoKey = (label) => { key.textContent = label; key.style.display = label ? 'block' : 'none'; };
    window.__demoCaption = (text) => { cap.textContent = text; cap.style.display = text ? 'block' : 'none'; };
    if (window.__demoPendingCaption) window.__demoCaption(window.__demoPendingCaption);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();
`;

interface Segment {
  start: number; // seconds from clip start
  speed: number;
}

type DemoWindow = Window & {
  __demoHl?: (x: number, y: number, w: number, h: number) => void;
  __demoHlOff?: () => void;
  __demoKey?: (label: string) => void;
  __demoCaption?: (text: string) => void;
};

class Clip {
  private readonly t0 = Date.now();
  readonly segments: Segment[] = [{ start: 0, speed: 1 }];
  private caption = '';
  private cursor = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

  constructor(
    readonly name: string,
    readonly page: Page,
  ) {
    page.on('load', () => {
      void this.paintCaption().catch(() => undefined);
    });
  }

  /** Change playback speed from this moment on (applied in post-production). */
  speed(value: number) {
    this.segments.push({ start: (Date.now() - this.t0) / 1000, speed: value });
  }

  async pause(ms: number) {
    await this.page.waitForTimeout(ms);
  }

  async say(text: string, holdMs = 2200) {
    this.caption = text;
    await this.paintCaption();
    await this.page.waitForTimeout(holdMs);
  }

  private async paintCaption() {
    await this.page.evaluate((value) => {
      const w = window as DemoWindow & { __demoPendingCaption?: string };
      w.__demoPendingCaption = value;
      w.__demoCaption?.(value);
    }, this.caption);
  }

  /** Glide the visible cursor to a point. */
  async moveTo(x: number, y: number) {
    const distance = Math.hypot(x - this.cursor.x, y - this.cursor.y);
    const steps = Math.max(12, Math.min(40, Math.round(distance / 14)));
    await this.page.mouse.move(x, y, { steps });
    this.cursor = { x, y };
  }

  /** Highlight the target, glide to it, pause so viewers see it, then click with a ripple. */
  async click(target: Locator, opts: { hold?: number; after?: number } = {}) {
    await target.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(250);
    const box = await target.boundingBox();
    if (!box) throw new Error('Click target is not visible.');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await this.page.evaluate((b) => (window as DemoWindow).__demoHl?.(b.x, b.y, b.width, b.height), box);
    await this.moveTo(x, y);
    await this.page.waitForTimeout(opts.hold ?? 750);
    await this.page.mouse.down();
    await this.page.waitForTimeout(90);
    await this.page.mouse.up();
    await this.page.evaluate(() => (window as DemoWindow).__demoHlOff?.()).catch(() => undefined);
    await this.page.waitForTimeout(opts.after ?? 900);
  }

  /** Click a field and type into it so viewers can read the text. */
  async type(target: Locator, text: string, delay = 45) {
    await this.click(target, { hold: 400, after: 200 });
    await target.pressSequentially(text, { delay });
    await this.page.waitForTimeout(500);
  }

  /** Show a key badge, then press the key. */
  async key(key: string, label: string, hold = 700) {
    await this.page.evaluate((l) => (window as DemoWindow).__demoKey?.(l), label);
    await this.page.waitForTimeout(hold);
    await this.page.keyboard.press(key);
    await this.page.waitForTimeout(450);
    await this.page.evaluate(() => (window as DemoWindow).__demoKey?.('')).catch(() => undefined);
  }

  /** Pick a value in a native <select> (its popup does not render in recordings, so a badge shows the choice). */
  async select(target: Locator, value: string, label: string) {
    await this.click(target, { hold: 600, after: 200 });
    await this.page.keyboard.press('Escape').catch(() => undefined);
    await this.page.evaluate((l) => (window as DemoWindow).__demoKey?.(l), `Selected: ${label}`);
    await target.selectOption(value);
    await this.page.waitForTimeout(1200);
    await this.page.evaluate(() => (window as DemoWindow).__demoKey?.('')).catch(() => undefined);
  }

  /** Smooth scroll by a number of pixels. */
  async scroll(dy: number, ms = 1400) {
    const steps = 14;
    for (let i = 0; i < steps; i++) {
      await this.page.mouse.wheel(0, dy / steps);
      await this.page.waitForTimeout(ms / steps);
    }
  }
}

async function newClip(browser: Browser, name: string): Promise<Clip> {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: join(RAW_DIR, name), size: VIEWPORT },
    colorScheme: 'dark',
  });
  await context.addInitScript(OVERLAY_SCRIPT);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return new Clip(name, page);
}

async function finishClip(clip: Clip) {
  const video = clip.page.video();
  await clip.page.context().close();
  const raw = video ? await video.path() : null;
  if (!raw) throw new Error(`No video recorded for ${clip.name}`);
  const webm = join(RAW_DIR, `${clip.name}.webm`);
  renameSync(raw, webm);
  writeFileSync(join(RAW_DIR, `${clip.name}.segments.json`), JSON.stringify(clip.segments, null, 2));
  renderClip(clip.name, webm, clip.segments);
}

/** Speed each segment, then join them into demo-recordings/<name>.mp4. */
function renderClip(name: string, webm: string, segments: Segment[]) {
  const duration = Number(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', webm]).toString().trim(),
  );
  const parts: string[] = [];
  const labels: string[] = [];
  segments.forEach((seg, i) => {
    const end = i + 1 < segments.length ? segments[i + 1].start : duration;
    if (end - seg.start < 0.05) return;
    parts.push(`[0:v]trim=start=${seg.start.toFixed(3)}:end=${end.toFixed(3)},setpts=(PTS-STARTPTS)/${seg.speed}[v${i}]`);
    labels.push(`[v${i}]`);
  });
  const filter = `${parts.join(';')};${labels.join('')}concat=n=${labels.length}:v=1:a=0,fps=30,format=yuv420p[out]`;
  execFileSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-i', webm, '-filter_complex', filter, '-map', '[out]', '-c:v', 'libx264', '-crf', '22', '-preset', 'medium', join(OUT_DIR, `${name}.mp4`)],
    { stdio: 'inherit' },
  );
}

async function signIn(clip: Clip, identifier: string, label: string) {
  const { page } = clip;
  await page.goto(`${BASE_URL}/login`);
  await clip.say(`Signing in as ${label}`, 900);
  clip.speed(1.6);
  await clip.type(page.getByPlaceholder('LC-1042 or name@partner.com'), identifier, 35);
  await clip.type(page.locator('input[type="password"]'), PASSWORD, 20);
  await clip.click(page.getByRole('button', { name: /^Sign In$/i }), { hold: 500, after: 200 });
  await page.waitForURL((url) => url.pathname === '/', { timeout: 30_000, waitUntil: 'commit' });
  await page.getByRole('navigation').first().waitFor();
  await page.waitForTimeout(600);
  clip.speed(1);
}

/** Wait until the current address matches (works even if the navigation already finished). */
async function waitPath(page: Page, pattern: RegExp, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  while (!pattern.test(new URL(page.url()).pathname + new URL(page.url()).search)) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${pattern} (at ${page.url()})`);
    await page.waitForTimeout(150);
  }
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForTimeout(500);
}

function nav(page: Page, label: string): Locator {
  return page.getByRole('navigation').first().getByRole('link', { name: label, exact: true });
}

// ---------------------------------------------------------------------------
// Data helpers (read the published Track so the script knows the right answers)
// ---------------------------------------------------------------------------

async function loadPublished(trackId: string) {
  const track = (await adminDb.doc(`tracks/${trackId}`).get()).data() as TrackDoc;
  const versionId = track.publishedVersionId ?? track.currentDraftVersionId;
  const version = (await adminDb.doc(`tracks/${trackId}/versions/${versionId}`).get()).data() as TrackVersionDoc;
  const secrets = (await adminDb.doc(`tracks/${trackId}/versions/${versionId}/secrets/evalRubrics`).get()).data() as EvalRubricsDoc;
  return { track, version, secrets };
}

function escapeRe(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function answerDrill(clip: Clip, drill: DrillItem, answerCorrectly: boolean) {
  const { page } = clip;
  switch (drill.kind) {
    case 'MULTIPLE_CHOICE': {
      const option = answerCorrectly
        ? drill.options.find((o) => o.id === drill.correctOptionId)
        : drill.options.find((o) => o.id !== drill.correctOptionId);
      await clip.click(
        page.getByRole('radiogroup', { name: 'Answer options' }).getByRole('radio', { name: new RegExp(escapeRe(option!.text.slice(0, 40))) }),
      );
      break;
    }
    case 'TRUE_FALSE_SPOT': {
      const pickCompliant = answerCorrectly ? drill.isCompliant : !drill.isCompliant;
      await clip.click(page.getByRole('radiogroup', { name: 'Verdict' }).getByRole('radio', { name: pickCompliant ? /Compliant/ : /Violation/ }));
      break;
    }
    case 'FILL_BLANK_CHOICE': {
      const word = answerCorrectly ? drill.correctWord : drill.wordBank.find((w) => w !== drill.correctWord)!;
      await clip.click(page.getByRole('radiogroup', { name: 'Word bank' }).getByRole('radio', { name: word, exact: true }));
      break;
    }
    case 'SEQUENCE_ORDER': {
      for (let target = 0; target < drill.orderedSteps.length; target++) {
        const want = drill.orderedSteps[target].text;
        const current = await page.getByRole('list', { name: 'Steps in your order' }).locator(':scope > li').allInnerTexts();
        const at = current.findIndex((t) => t.includes(want));
        for (let k = at; k > target; k--) {
          await clip.click(page.getByRole('button', { name: `Move "${want}" up` }), { hold: 300, after: 300 });
        }
      }
      break;
    }
    case 'MATCH_PAIRS': {
      for (const pair of drill.pairs) {
        await clip.click(page.getByRole('list', { name: 'Triggers' }).getByRole('button', { name: new RegExp(escapeRe(pair.leftPrompt.slice(0, 40))) }), { hold: 350, after: 250 });
        await clip.click(page.getByRole('list', { name: 'Matches' }).getByRole('button', { name: new RegExp(escapeRe(pair.rightMatch.slice(0, 40))) }), { hold: 350, after: 350 });
      }
      break;
    }
  }
  const check = page.getByRole('button', { name: /^Check/ });
  if (await check.isVisible().catch(() => false)) await clip.click(check, { hold: 500, after: 300 });
}

async function findVisibleDrill(page: Page, drills: DrillItem[]): Promise<DrillItem | null> {
  const text = await page.locator('main').innerText();
  return drills.find((d) => text.includes(d.prompt.slice(0, 60))) ?? null;
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

/**
 * Demo-only setup: the generated Sims already carry canonical dispositions, a context and an evidence
 * checklist (sim-builder), and every claim, rubric evidence included, is approved on camera in Source Review.
 * What a Trainer would author by hand in "Scripted scenario QA" is added here: one golden pass and one
 * critical-fail fixture per Sim, each executed with the real engine before it is written.
 */
async function prepareGeneratedDraft(trackId: string) {
  const draftRef = adminDb.doc(`tracks/${trackId}/versions/draft`);
  const secretsRef = adminDb.doc(`tracks/${trackId}/versions/draft/secrets/evalRubrics`);
  const [draftSnapshot, secretsSnapshot] = await Promise.all([draftRef.get(), secretsRef.get()]);
  const draft = draftSnapshot.data() as TrackVersionDoc | undefined;
  const secrets = secretsSnapshot.data() as EvalRubricsDoc | undefined;
  if (!draft || !secrets) throw new Error('Generated draft or simulation rubrics are missing.');
  const scenarios = secrets.scenarios.map((secret) => {
    const scenario = draft.simScenarios.find((candidate) => candidate.id === secret.scenarioId);
    const expected = CanonicalDispositionSchema.safeParse(secret.expectedDisposition);
    if (!scenario || !expected.success) throw new Error(`Scenario ${secret.scenarioId} needs a canonical expected disposition.`);
    const qaFixtures = demoQAFixtures(scenario, expected.data);
    if (!qaFixtures.some((fixture) => fixture.kind === 'golden_pass') || !qaFixtures.some((fixture) => fixture.kind === 'golden_critical_fail')) {
      throw new Error(`Could not script QA fixtures for scenario ${scenario.id}; add them in Scripted scenario QA.`);
    }
    return { ...secret, qaFixtures };
  });
  await secretsRef.update({ scenarios, updatedAt: Date.now() });
}

async function trainerClip(browser: Browser, pdfPath: string): Promise<string> {
  const clip = await newClip(browser, 'trainer');
  const { page } = clip;
  await signIn(clip, 'trainer@logicall.io', 'a Trainer');
  await clip.say('A prepared demo response turns the synthetic Playbook into grounded training', 3000);
  await clip.say('Trainer home. Open Track Studio to build a new Track', 1200);
  await clip.click(nav(page, 'Track Studio'));
  await clip.say('Track Studio lists every Track. Click "New Campaign Track"', 1000);
  await clip.click(page.getByRole('link', { name: /New Campaign Track/i }).first());
  await waitPath(page, /\/studio\/new/);
  await clip.say('Only 3 inputs: a Division, a Track title, and the training PDF', 2200);
  await clip.click(page.getByRole('radiogroup', { name: 'Division' }).getByText('Outbound Sales'));
  await clip.type(page.getByPlaceholder('MVP Retention & Save-Offer Playbook'), 'NeuroCalmRx Recovery Calling', 40);
  await clip.type(page.getByPlaceholder('Code (optional)'), 'NEURO', 60);
  await clip.say('The full synthetic Standard Meds NeuroCalmRx Playbook PDF is dropped in', 600);
  await page.locator('input[type="file"]').setInputFiles(pdfPath);
  await clip.pause(2000);
  await clip.click(page.getByRole('button', { name: /Upload and map content/i }));
  await clip.say('Content map: Pulse measures the Playbook and suggests how many Checkpoints it supports', 2200);
  const buildButton = page.getByRole('button', { name: /^Build \d+ checkpoints$/i });
  await buildButton.waitFor({ timeout: 120_000 });
  await clip.click(buildButton);
  const buildAnyway = page.getByRole('button', { name: /Build anyway/i });
  if (await buildAnyway.isVisible().catch(() => false)) await clip.click(buildAnyway);
  await clip.say('Source approval locks generation to this exact Playbook revision', 1800);
  const approveBundle = page.getByRole('button', { name: /Approve source bundle revision/i });
  await approveBundle.waitFor({ timeout: 120_000 });
  await clip.click(approveBundle);
  await clip.say('Demo AI builds Checkpoints, Drills and Live Call Sims from the approved PDF (sped up)', 1500);
  clip.speed(4);
  await page.waitForURL(/\/studio\/(?!new)[^/?]+$/, { timeout: 600_000, waitUntil: 'commit' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const trackId = new URL(page.url()).pathname.split('/').pop()!;
  await prepareGeneratedDraft(trackId);
  clip.speed(1);
  await clip.say('Track Studio, Play mode: the trainer sees every Briefing Card and Drill exactly as an agent will', 3000);
  await clip.click(page.getByRole('button', { name: /^Source Review$/ }));
  await clip.say('Source Review pairs every generated claim with an exact Playbook excerpt. The trainer approves each one', 3200);
  const approveEvidence = page.getByRole('button', { name: /Approve exact evidence/i });
  await approveEvidence.waitFor();
  await clip.click(approveEvidence);
  await clip.say('Remaining claim approvals (sped up)', 600);
  clip.speed(4);
  const claimButtons = page.locator('[data-testid="source-review"] button:has(span.line-clamp-2)');
  const claimCount = await claimButtons.count();
  for (let index = 1; index < claimCount; index++) {
    await clip.click(claimButtons.nth(index), { hold: 150, after: 150 });
    await clip.click(approveEvidence, { hold: 150, after: 150 });
  }
  clip.speed(1);
  await page.reload();
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await clip.click(page.getByRole('button', { name: /^Source Review$/ }));
  await clip.say('All exact evidence is approved and the publication gates pass', 2600);
  await clip.click(page.getByRole('button', { name: /^Edit$/ }));
  await clip.say('Edit mode: plain-English fields, and "Regenerate This Item" for any single card or Drill', 2600);
  await clip.scroll(420, 1600);
  await clip.pause(1200);
  await clip.scroll(-420, 900);
  await clip.click(page.getByRole('button', { name: /Publish & Assign/i }));
  const dialog = page.getByRole('dialog');
  await clip.say('Publish & Assign: choose which Cohorts must take this Track', 1500);
  await clip.click(dialog.getByText(/All Active Cohorts/i));
  await clip.click(dialog.locator('button.pulse-btn-success'));
  await dialog.getByText(/Published as TrackVersion/i).waitFor();
  await clip.say('Published. Every agent in those Cohorts now sees it on their home page', 2600);
  await finishClip(clip);
  return trackId;
}

/** Demo setup: mark the first Checkpoints as done for LC-1042 so the clip can show the last one and the Live Call Sim. */
async function prepareAgentProgress(trackId: string) {
  const { track, version } = await loadPublished(trackId);
  const users = await adminDb.collection('users').where('lcNumber', '==', 'LC-1042').limit(1).get();
  const user = users.docs[0];
  if (!user) throw new Error('Demo user LC-1042 not found. Run npm run seed:local.');
  const units = [...version.units].sort((a, b) => a.orderIndex - b.orderIndex).slice(0, -1);
  const now = Date.now();
  const unitScores = Object.fromEntries(
    units.map((u, i) => [u.id, { firstTryAccuracyPct: [80, 100, 80][i % 3], attemptsCount: 1, completedAt: now - (units.length - i) * 3_600_000 }]),
  );
  await adminDb.doc(`enrollments/${user.id}_${trackId}`).set({
    id: `${user.id}_${trackId}`,
    userId: user.id,
    userDisplayName: user.get('displayName'),
    partnerCohortId: user.get('partnerCohortId'),
    divisionId: track.divisionId,
    trackId,
    trackTitle: track.title,
    versionId: track.publishedVersionId,
    status: 'IN_PROGRESS',
    completedUnitIds: units.map((u) => u.id),
    passedScenarioIds: [],
    unitScores,
    bestSimScorePct: null,
    xpEarned: units.length * 115,
    progressPct: Math.round((80 * units.length) / version.units.length),
    certifiedAt: null,
    lastActivityAt: now,
  });
}

async function agentClip(browser: Browser, trackId: string) {
  const { track, version, secrets } = await loadPublished(trackId);
  const units = [...version.units].sort((a, b) => a.orderIndex - b.orderIndex);
  const unit = units[units.length - 1];
  const scenario = version.simScenarios[0];
  const secret = secrets.scenarios.find((s) => s.scenarioId === scenario.id)!;
  const clip = await newClip(browser, 'agent');
  const { page } = clip;

  await signIn(clip, 'LC-1042', 'an Agent (THS Cohort)');
  await clip.say('Agent home: the new NeuroCalmRx Track is assigned. Click "Continue"', 1500);
  await clip.click(page.getByRole('link').filter({ hasText: track.title }).first());
  await waitPath(page, /\/learn\//);
  await clip.say('Track Map: Checkpoints unlock in order. 3 are done; start the last one', 2200);
  await clip.click(page.getByRole('link', { name: /Start Checkpoint/i }).first());
  await waitPath(page, /\/unit\//);

  await clip.say('Briefing Card: one rule, a Key Rule banner, DO / DON\'T lists, and the PDF page it came from', 4200);
  for (let i = 0; i < unit.briefingCards.length; i++) {
    await clip.click(page.getByRole('navigation', { name: 'BriefingCard navigation' }).getByRole('button').last(), { hold: 500, after: 1300 });
  }

  await clip.say('Drills: 5 formats. Watch a wrong answer...', 800);
  const attempts = new Map<string, number>();
  let wrongDone = false;
  let shownCorrect = 0;
  for (let guard = 0; guard < 20; guard++) {
    await page.waitForTimeout(400);
    if (await page.getByText(/Checkpoint \d+ Complete|All Drills cleared/i).first().isVisible().catch(() => false)) break;
    const drill = await findVisibleDrill(page, unit.drills);
    if (!drill) break;
    const n = (attempts.get(drill.id) ?? 0) + 1;
    attempts.set(drill.id, n);
    const missOnPurpose = !wrongDone && n === 1 && drill.kind === 'TRUE_FALSE_SPOT';
    await answerDrill(clip, drill, !missOnPurpose);
    await page.getByRole('region', { name: 'Answer feedback' }).waitFor();
    if (missOnPurpose) {
      wrongDone = true;
      await clip.say('A wrong answer shows the Playbook rule and page right away. This Drill comes back at the end', 3800);
    } else if (shownCorrect === 0) {
      shownCorrect += 1;
      await clip.say('Correct answers earn XP and build a streak', 1800);
      await clip.say('Remaining Drills (sped up)', 200);
      clip.speed(3);
    } else {
      await clip.pause(700);
    }
    const feedback = page.getByRole('region', { name: 'Answer feedback' });
    await clip.click(feedback.getByRole('button', { name: /Continue|Finish/i }).last(), { hold: 350, after: 300 });
    await feedback.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
  }
  clip.speed(1);
  await clip.say('Checkpoint complete: true first-try accuracy goes to the analytics, XP to the agent', 3000);
  await clip.say('The last Checkpoint is done, so the Live Call Sim is unlocked', 600);
  const goSim = page.getByRole('link', { name: /Go to Live Call Sim/i }).or(page.getByRole('button', { name: /Go to Live Call Sim/i })).first();
  await clip.click(goSim);
  await waitPath(page, /\/sim\//, 4000).catch(async () => {
    await goSim.click();
    await waitPath(page, /\/sim\//);
  });
  await clip.say('The call ticket gives the context. The caller is played by the AI from the Playbook', 2600);
  // A saved run of this scenario (for example after a reload) shows "Resume call (N replies saved)".
  await clip.click(page.getByRole('button', { name: /Start Live Call Sim|Resume call/i }));
  const composer = page.locator('textarea').first();
  await composer.waitFor();
  await clip.say('Before dialing, the agent checks the synthetic local-time record', 1800);
  await clip.click(page.getByRole('button', { name: 'Local Time', exact: true }));
  await clip.click(page.getByRole('button', { name: /Dial synthetic contact/i }));
  await clip.click(page.getByRole('button', { name: /Record required disclosure/i }));
  await clip.pause(1200);

  const lines = [
    "Hi Linda, this is Sofia calling from Standard Meds. I'm not a doctor. You completed your neuropathy health assessment and got all the way to checkout. Is this a good time for a quick call?",
    'I completely understand, a lot of patients tell us they have tried everything. The 3-month plan is $297, which is about $99 a month, and it comes with a 90-day money-back guarantee. Pain usually drops in months two and three, so the guarantee covers that whole window.',
    'Not yet. After checkout, a physician reviews your assessment and, if approved, your medication ships. Can I send you the checkout link right now so you can pick up where you left off?',
  ];
  for (const [i, line] of lines.entries()) {
    if (i === 0) await clip.say('The agent types a reply in their own words (typing sped up)', 300);
    clip.speed(4);
    await clip.type(composer, line, 14);
    clip.speed(1);
    await clip.key('Enter', 'Enter ⏎  send', 600);
    clip.speed(1.5);
    await page.waitForTimeout(400);
    await page.waitForFunction(() => {
      const ta = document.querySelector('textarea');
      return Boolean(document.querySelector('dialog[open]') || (ta && !ta.disabled));
    }, undefined, { timeout: 120_000, polling: 200 }).catch(() => undefined);
    clip.speed(1);
    await clip.pause(2600);
    if (await page.getByRole('dialog').isVisible().catch(() => false)) break;
  }

  const dispositionDialog = page.getByRole('dialog');
  if (await dispositionDialog.isVisible().catch(() => false)) {
    await clip.click(dispositionDialog.getByRole('button', { name: 'Close and return to the call' }));
  }
  await clip.say('The agent records the observed recovery and a safe synthetic operational note', 2200);
  await clip.click(page.getByRole('button', { name: 'Recovery Confirmed', exact: true }));
  await clip.type(page.getByLabel('Synthetic operational note'), 'Synthetic recovery and checkout-link consent confirmed.', 20);
  await clip.click(page.getByRole('button', { name: /Save fake note/i }));
  await clip.click(page.getByRole('button', { name: /End & Disposition Call|Log Disposition/i }));
  const dialog = page.getByRole('dialog');
  await clip.say('The call ended. The agent picks the disposition they would log', 1500);
  // Options are the canonical dispositions only; the expected one comes from the trainer-only rubric.
  const expectedDisposition = CanonicalDispositionSchema.parse(secret.expectedDisposition);
  await clip.click(dialog.getByText(expectedDisposition, { exact: true }));
  await clip.click(dialog.getByRole('button', { name: /Submit for Evaluation/i }));
  await clip.say('The AI Judge grades the transcript against the Playbook rubric (sped up)', 300);
  clip.speed(4);
  const scored = await Promise.race([
    page.getByRole('region', { name: 'Simulation scorecard' }).waitFor({ timeout: 300_000 }).then(() => true),
    page.getByRole('status', { name: 'Scorecard pending' }).waitFor({ timeout: 300_000 }).then(() => false),
  ]);
  if (!scored) throw new Error('The judge did not score the call (the "a Trainer will score it" state). Check the replay judge output.');
  clip.speed(1);
  await clip.say('Scorecard: score and pass status, with a summary of strengths and what to fix', 3600);
  await clip.scroll(560);
  await clip.say('Each rubric rule: score, the agent\'s own words, and a better example where points were lost', 3600);
  await clip.scroll(620);
  await clip.pause(2600);
  await finishClip(clip);
}

async function supervisorClip(browser: Browser) {
  const clip = await newClip(browser, 'supervisor');
  const { page } = clip;
  await signIn(clip, 'LC-2001', 'a Partner Supervisor (THS)');
  await clip.say('Partner Supervisor home: only their own Cohort\'s agents and readiness', 3000);
  await clip.click(page.getByRole('link', { name: /Open Cohort Analytics/i }));
  await waitPath(page, /\/analytics/);
  await clip.say('Strength heatmap by skill. The Cohort filter is locked to THS; other partners stay hidden', 3400);
  await clip.scroll(640);
  await clip.say('Certification matrix (Export CSV) and the most-missed Playbook rules', 3000);
  const agentLink = page.locator('a[href^="/analytics/agents/"]', { hasText: 'Sofia Herrera' }).first();
  await clip.click(agentLink);
  await waitPath(page, /\/analytics\/agents\//);
  await clip.say('Agent Readiness Passport: skill radar, certifications and full Live Call Sim transcripts', 3200);
  await clip.scroll(560);
  await clip.pause(2000);
  await finishClip(clip);
}

async function adminClip(browser: Browser) {
  const clip = await newClip(browser, 'admin');
  const { page } = clip;
  await signIn(clip, 'ops.admin@logicall.io', 'an Admin');
  await clip.say('Admin home: company-wide readiness by Division and Cohort', 2800);
  await clip.click(nav(page, 'Roster'));
  await waitPath(page, /\/roster/);
  await clip.say('Roster: every user, role and Cohort, plus join codes for BPO partners', 2400);
  await clip.click(page.getByRole('button', { name: /Bulk Import/i }).first());
  await clip.say('Bulk import by LC Number: no company email needed for partner agents', 2600);
  await clip.click(page.getByRole('dialog').getByRole('button', { name: /Cancel/i }));
  const row = page.getByRole('row', { name: /Ana Ruiz/ });
  await clip.say('One click deactivates a user: sign-in stops at once, all history is kept', 600);
  await clip.click(row.getByRole('button', { name: /Deactivate/i }));
  await clip.click(page.getByRole('dialog').getByRole('button', { name: /Deactivate/i }));
  await row.waitFor({ state: 'detached' });
  await clip.say('Switch the status filter to Inactive to find and restore them', 600);
  await clip.select(page.locator('#roster-status-filter'), 'inactive', 'Inactive');
  await waitPath(page, /status=inactive/);
  await clip.click(row.getByRole('button', { name: /Reactivate/i }));
  await clip.click(page.getByRole('dialog').getByRole('button', { name: /Reactivate/i }));
  await row.waitFor({ state: 'detached' });
  await clip.click(nav(page, 'Analytics'));
  await waitPath(page, /\/analytics/);
  await clip.say('Analytics: every Cohort side by side, with filters by Division, Cohort and Track', 3200);
  await finishClip(clip);
}

/**
 * Selector check for the Studio steps, without recording, uploading or publishing. With DEMO_TRACK_ID set to a
 * built draft, it also checks Source Review, Publish & Assign and that the QA fixtures can be scripted.
 */
async function dryRun() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const problems: string[] = [];
  const expectVisible = async (label: string, locator: Locator) => {
    const ok = await locator.first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
    console.log(`${ok ? 'ok  ' : 'MISS'} ${label}`);
    if (!ok) problems.push(label);
  };
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.goto(`${BASE_URL}/login`);
    await page.getByPlaceholder('LC-1042 or name@partner.com').fill('trainer@logicall.io');
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await page.waitForURL((url) => url.pathname === '/', { timeout: 30_000, waitUntil: 'commit' });
    await expectVisible('nav: Track Studio', nav(page, 'Track Studio'));
    await page.goto(`${BASE_URL}/studio`);
    await expectVisible('link: New Campaign Track', page.getByRole('link', { name: /New Campaign Track/i }));
    await page.goto(`${BASE_URL}/studio/new`);
    await expectVisible('radio: Division / Outbound Sales', page.getByRole('radiogroup', { name: 'Division' }).getByText('Outbound Sales'));
    await expectVisible('input: Track title', page.getByPlaceholder('MVP Retention & Save-Offer Playbook'));
    await expectVisible('input: Code (optional)', page.getByPlaceholder('Code (optional)'));
    await expectVisible('input: PDF file', page.locator('input[type="file"]'));
    await expectVisible('button: Upload and map content', page.getByRole('button', { name: /Upload and map content/i }));
    const trackId = process.env.DEMO_TRACK_ID;
    if (trackId) {
      const { version, secrets } = await loadPublished(trackId);
      for (const secret of secrets.scenarios) {
        const scenario = version.simScenarios.find((candidate) => candidate.id === secret.scenarioId);
        const expected = CanonicalDispositionSchema.safeParse(secret.expectedDisposition);
        const fixtures = scenario && expected.success ? demoQAFixtures(scenario, expected.data) : [];
        const ok = fixtures.length === 2;
        console.log(`${ok ? 'ok  ' : 'MISS'} QA fixtures for ${secret.scenarioId} (${expected.success ? expected.data : secret.expectedDisposition})`);
        if (!ok) problems.push(`QA fixtures ${secret.scenarioId}`);
      }
      await page.goto(`${BASE_URL}/studio/${encodeURIComponent(trackId)}`);
      await expectVisible('button: Source Review', page.getByRole('button', { name: /^Source Review$/ }));
      await page.getByRole('button', { name: /^Source Review$/ }).click().catch(() => undefined);
      await expectVisible('source-review claim list', page.locator('[data-testid="source-review"] button:has(span.line-clamp-2)'));
      // A claim approved earlier shows its Approved badge in place of the button.
      await expectVisible('button: Approve exact evidence (or Approved badge)', page.getByRole('button', { name: /Approve exact evidence/i }).or(page.locator('[data-testid="source-review"]').getByText(/^approved$/i)));
      await expectVisible('button: Edit', page.getByRole('button', { name: /^Edit$/ }));
      await expectVisible('button: Publish & Assign', page.getByRole('button', { name: /Publish & Assign/i }));
    }
  } finally {
    await browser.close();
  }
  if (problems.length > 0) throw new Error(`Dry run found ${problems.length} missing selector(s): ${problems.join('; ')}`);
  console.log('Dry run passed.');
}

async function main() {
  const args = process.argv.slice(2);
  const pdfArg = args.find((a) => a.startsWith('--pdf='))?.slice(6);
  const wanted = args.filter((a) => !a.startsWith('--'));
  const order = ['trainer', 'agent', 'supervisor', 'admin'];
  const clips = wanted.length ? order.filter((c) => wanted.includes(c)) : order;
  if (args.includes('--dry-run')) {
    await dryRun();
    return;
  }

  if (existsSync(RAW_DIR)) rmSync(RAW_DIR, { recursive: true, force: true });
  mkdirSync(RAW_DIR, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    let trackId = process.env.DEMO_TRACK_ID ?? '';
    for (const name of clips) {
      console.log(`Recording ${name}...`);
      if (name === 'trainer') {
        if (!pdfArg) throw new Error('The trainer clip needs --pdf=path/to/Playbook.pdf');
        trackId = await trainerClip(browser, resolve(pdfArg));
        console.log(`Published Track ${trackId}`);
      }
      if (name === 'agent') {
        if (!trackId) throw new Error('The agent clip needs the trainer clip in the same run, or DEMO_TRACK_ID.');
        await prepareAgentProgress(trackId);
        await agentClip(browser, trackId);
      }
      if (name === 'supervisor') await supervisorClip(browser);
      if (name === 'admin') await adminClip(browser);
    }
  } catch (error) {
    for (const [i, context] of browser.contexts().entries()) {
      for (const [j, open] of context.pages().entries()) {
        await open.screenshot({ path: join(RAW_DIR, `error-${i}-${j}.png`) }).catch(() => undefined);
      }
    }
    throw error;
  } finally {
    await browser.close();
  }

  const all = order.map((c) => join(OUT_DIR, `${c}.mp4`)).filter((p) => existsSync(p));
  const list = join(RAW_DIR, 'concat.txt');
  writeFileSync(list, all.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', join(OUT_DIR, 'LogiCall-Pulse-demo.mp4')], { stdio: 'inherit' });
  for (const p of [...all, join(OUT_DIR, 'LogiCall-Pulse-demo.mp4')]) {
    const d = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).toString().trim();
    console.log(`${p}: ${Number(d).toFixed(1)} s`);
  }
  console.log(readdirSync(OUT_DIR).join('\n'));
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
