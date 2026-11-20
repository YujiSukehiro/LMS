import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const DEMO_PASSWORD = 'PulseDemo!2026';
const SCREENSHOT_DIR = process.env.QA_SCREENSHOT_DIR?.trim() || '';

interface RuntimeIssueTracker {
  assertClean: (allowedFailedUrls?: RegExp[]) => void;
}

function attachCleanRuntimeMonitor(page: Page): RuntimeIssueTracker {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const apiErrors: string[] = [];

  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && res.url().includes('/api/')) {
      apiErrors.push(`${res.status()} ${res.url()}`);
    }
  });

  return {
    assertClean(allowedFailedUrls: RegExp[] = []) {
      const relevantApiErrors = apiErrors.filter((entry) => !allowedFailedUrls.some((re) => re.test(entry)));
      const relevantConsoleErrors =
        allowedFailedUrls.length > 0
          ? consoleErrors.filter((msg) => !msg.includes('Failed to load resource'))
          : consoleErrors;
      expect(pageErrors, `Uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
      expect(relevantConsoleErrors, `Console errors: ${relevantConsoleErrors.join(' | ')}`).toEqual([]);
      expect(relevantApiErrors, `Unexpected 4xx/5xx API responses: ${relevantApiErrors.join(' | ')}`).toEqual([]);
    },
  };
}

async function captureShot(page: Page, filename: string) {
  if (!SCREENSHOT_DIR) return;
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, filename), fullPage: true });
}

function mainNavLink(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name, exact: true });
}

async function signIn(page: Page, identifier: string) {
  await page.goto('/login');
  await expect(page.getByLabel(/LC Number or Email/i)).toBeVisible();
  await page.getByLabel(/LC Number or Email/i).fill(identifier);
  await page.getByLabel(/^Password$/i).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: /^Sign In$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 25_000 });
}

async function answerAnyDrillInRetention(page: Page) {
  const radioCount = await page.getByRole('radio').count();
  if (radioCount > 0) {
    await page.getByRole('radio').first().click();
  } else {
    const triggers = page.getByRole('list', { name: 'Triggers' }).locator('button');
    const matches = page.getByRole('list', { name: 'Matches' }).locator('button');
    const pairCount = await triggers.count();
    if (pairCount > 0) {
      for (let i = 0; i < pairCount; i += 1) {
        await triggers.nth(i).click();
        await matches.nth(i).click();
      }
    }
  }
  await page.getByRole('button', { name: /^Check$/i }).click();
}

test.describe('LogiCall Pulse usable verbal & retention product flows', () => {
  test.setTimeout(120_000);
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Login modal works cleanly and Agent completes Retention Hub review + Track deep-link', async ({ page }) => {
    const monitor = attachCleanRuntimeMonitor(page);

    // Verify Sign-In screen copy & Claim Access modal open/close interactions
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /LogiCall Pulse Operations Sign-In/i })).toBeVisible();
    await expect(page.getByText(/Verbal Practice, and Knowledge Retention/i)).toBeVisible();
    await page.getByRole('button', { name: /Have a Team Join Code\? Claim Access/i }).click();
    await expect(page.getByRole('heading', { name: /Claim Access with a Join Code/i })).toBeVisible();
    await page.getByRole('button', { name: /^Cancel$/i }).click();
    await expect(page.getByRole('heading', { name: /Claim Access with a Join Code/i })).toBeHidden();
    await captureShot(page, '01-login-operations.png');

    await signIn(page, 'LC-1042');

    await expect(page.getByRole('heading', { name: /Welcome back, Sofia/i })).toBeVisible();
    await expect(mainNavLink(page, 'Retention')).toBeVisible();

    const retentionSection = page.getByRole('region', { name: 'Knowledge Retention' });
    await expect(retentionSection).toBeVisible();
    await expect(retentionSection).toContainText('15 spaced review drills due now');
    await captureShot(page, '02-agent-home-retention.png');

    await retentionSection.getByRole('link', { name: /Start Keep-Sharp Review/i }).click();
    await expect(page).toHaveURL(/\/learn\/review/);
    await expect(page.getByRole('heading', { name: 'Keep-Sharp Review' })).toBeVisible();
    await expect(page.getByText('15 Due Now')).toBeVisible();
    await expect(page.locator('article h2').first()).toBeVisible();
    await captureShot(page, '03-retention-hub-active-drill.png');

    await answerAnyDrillInRetention(page);
    await expect(page.getByRole('region', { name: 'Answer feedback' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Next review in/i)).toBeVisible();
    await captureShot(page, '04-retention-feedback-drawer.png');

    // Click Home in sidebar, open MVP Retention & Escalations, and verify Track Retention link works
    await mainNavLink(page, 'Home').click();
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole('link', { name: /MVP Retention & Escalations/i }).click();
    await expect(page).toHaveURL(/\/learn\/demo-mvp-retention$/);
    const trackRetention = page.getByRole('region', { name: 'Track Knowledge Retention' });
    await expect(trackRetention).toBeVisible();
    await trackRetention.getByRole('link', { name: /Open Retention Review/i }).click();
    await expect(page).toHaveURL(/\/learn\/review\?trackId=demo-mvp-retention/);

    monitor.assertClean();
  });

  test('Agent plays fresh Verbal Mastery track from Checkpoints -> Verbal Practice -> Scorecard with zero dialer UI', async ({
    page,
  }) => {
    const monitor = attachCleanRuntimeMonitor(page);

    await signIn(page, 'LC-1042');
    await page.getByRole('link', { name: /NeuroCalmRx Verbal Mastery/i }).click();
    await expect(page).toHaveURL(/\/learn\/demo-verbal-neurocalm$/);
    await expect(page.getByText('Verbal Practice', { exact: false }).first()).toBeVisible();

    // Checkpoint 1
    await expect(page.getByRole('heading', { name: /Verbal Identity & Scope Boundaries/i })).toBeVisible();
    await page.getByRole('link', { name: /Start Checkpoint/i }).first().click();
    await expect(page).toHaveURL(/\/learn\/demo-verbal-neurocalm\/unit\/unit-nc-1/);
    await page.getByRole('button', { name: /^Next/i }).click();
    await page.getByRole('button', { name: /Start Drills/i }).click();

    const checkpoint1Answers = [
      /Full name, date of birth, and ZIP code/i,
      /Policy Violation/i,
      /Screen for red-flag symptoms/i,
      /Policy Compliant/i,
    ];
    for (let i = 0; i < checkpoint1Answers.length; i += 1) {
      await page.getByRole('radio', { name: checkpoint1Answers[i] }).click();
      await page.getByRole('button', { name: /^Check$/i }).click();
      const continueName = i === checkpoint1Answers.length - 1 ? /Finish Drills/i : /^Continue/i;
      await page.getByRole('button', { name: continueName }).click();
    }

    await expect(page.getByText(/Checkpoint 1 Complete/i)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('link', { name: /Next Checkpoint/i }).click();
    await expect(page).toHaveURL(/\/learn\/demo-verbal-neurocalm\/unit\/unit-nc-2/);

    // Checkpoint 2
    await page.getByRole('button', { name: /^Next/i }).click();
    await page.getByRole('button', { name: /Start Drills/i }).click();

    const checkpoint2Answers = [
      /Policy Violation/i,
      /Clinical Support Tier 2/i,
      /Policy Compliant/i,
      /Acknowledge immediately/i,
    ];
    for (let i = 0; i < checkpoint2Answers.length; i += 1) {
      await page.getByRole('radio', { name: checkpoint2Answers[i] }).click();
      await page.getByRole('button', { name: /^Check$/i }).click();
      const continueName = i === checkpoint2Answers.length - 1 ? /Finish Drills/i : /^Continue/i;
      await page.getByRole('button', { name: continueName }).click();
    }

    await expect(page.getByText(/Checkpoint 2 Complete/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: /Go to Verbal Practice/i })).toBeVisible();
    await captureShot(page, '05-checkpoint-complete-verbal-cta.png');

    await page.getByRole('link', { name: /Go to Verbal Practice/i }).click();
    await expect(page).toHaveURL(/\/learn\/demo-verbal-neurocalm\/sim\/scenario-nc-verbal-1/);

    // Verify zero dialer / CRM mechanics anywhere on intro or active session
    await expect(page.getByText(/Synthetic Operations|Dial caller|Inspect order|Send SMS|Post Slack/i)).toHaveCount(0);
    await page.getByRole('button', { name: /Start Verbal Practice/i }).click();

    const input = page.getByLabel(/Your verbal response/i);
    await expect(input).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Synthetic Operations|Dial caller|Inspect order|Send SMS|Post Slack/i)).toHaveCount(0);

    await input.fill('May I confirm your full name, date of birth, and ZIP code before reviewing your refill?');
    await page.getByRole('button', { name: /Send reply/i }).click();
    await expect(page.getByText(/mild dizziness before my next refill/i).first()).toBeVisible({ timeout: 15_000 });

    await input.fill(
      'Thank you. I do not give dosing advice, and I am screening for chest pain or fainting and warm-transferring you to Clinical Support Tier 2 with a callback read-back.',
    );
    await page.getByRole('button', { name: /Send reply/i }).click();
    await expect(page.getByText(/mild dizziness before my next refill/i)).toHaveCount(2, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Finish & Grade Practice/i })).toBeEnabled();
    await captureShot(page, '06-verbal-practice-conversation.png');

    await page.getByRole('button', { name: /Finish & Grade Practice/i }).click();

    const scorecard = page.getByRole('region', { name: 'Simulation scorecard' });
    await expect(scorecard).toBeVisible({ timeout: 25_000 });
    await expect(scorecard).toContainText(/100%\s*—\s*PASSED/i);
    await expect(scorecard).toContainText(/Verify three identity points before account details/i);
    await captureShot(page, '07-verbal-practice-scorecard.png');

    monitor.assertClean();
  });

  test('Trainer navigates Studio catalog, edits Verbal Practice scenario without dialer fields, and saves cleanly', async ({
    page,
  }) => {
    const monitor = attachCleanRuntimeMonitor(page);

    await signIn(page, 'trainer@logicall.io');
    await mainNavLink(page, 'Track Studio').click();
    await expect(page).toHaveURL(/\/studio$/);
    await expect(page.getByRole('heading', { name: /Campaign Tracks/i })).toBeVisible();

    await page.getByRole('link', { name: /NeuroCalmRx Verbal Mastery/i }).click();
    await expect(page).toHaveURL(/\/studio\/demo-verbal-neurocalm$/);

    await page.getByRole('button', { name: /^Edit$/i }).click();
    await page.getByRole('button', { name: /1\. Refill & Mild Dizziness Verbal Triage/i }).click();

    await expect(page.getByText(/Verbal Practice 1 — what the agent sees/i)).toBeVisible();
    await expect(page.getByText(/^Scenario brief$/i)).toBeVisible();
    await expect(page.getByText(/Disposition options/i)).toHaveCount(0);
    await expect(page.getByText(/Expected disposition/i)).toHaveCount(0);
    await expect(page.getByText(/Pre-call inspections/i)).toHaveCount(0);

    const briefInput = page.getByLabel(/Scenario brief/i);
    const existingBrief = await briefInput.inputValue();
    await briefInput.fill(
      existingBrief.endsWith('(reviewed)')
        ? existingBrief.replace(/\s*\(reviewed\)$/, '')
        : `${existingBrief.trim()} (reviewed)`,
    );
    await page.getByRole('button', { name: /Save Draft/i }).click();
    await expect(page.getByText(/Draft saved/i)).toBeVisible({ timeout: 15_000 });
    await captureShot(page, '08-trainer-studio-verbal-editor.png');

    monitor.assertClean();
  });

  test('Partner Supervisor views cohort-scoped Team Progress & Analytics and is blocked from Studio', async ({
    page,
  }) => {
    const monitor = attachCleanRuntimeMonitor(page);

    await signIn(page, 'LC-2001');
    await mainNavLink(page, 'Team Progress').click();
    await expect(page).toHaveURL(/\/progress$/);
    await expect(page.getByRole('heading', { name: /Who is ready to take calls\?/i })).toBeVisible();
    await expect(page.getByText(/Team Progress · THS/i)).toBeVisible();
    await expect(page.getByText(/Live Call Sim/i)).toHaveCount(0);
    await captureShot(page, '09-supervisor-team-progress.png');

    await mainNavLink(page, 'Analytics').click();
    await expect(page).toHaveURL(/\/analytics$/);
    await expect(page.getByRole('heading', { name: /Readiness Analytics/i })).toBeVisible();

    await page.goto('/studio');
    await expect(page).not.toHaveURL(/\/studio/);

    monitor.assertClean();
  });

  test('Admin navigates Roster & Cohorts view, exercises RBAC controls, and Analytics cleanly', async ({ page }) => {
    const monitor = attachCleanRuntimeMonitor(page);

    await signIn(page, 'ops.admin@logicall.io');
    await mainNavLink(page, 'Roster').click();
    await expect(page).toHaveURL(/\/roster$/);
    await expect(page.getByRole('heading', { name: /Agents, Supervisors & Staff/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Cohorts/i })).toBeVisible();

    await page.getByRole('button', { name: /^New Cohort$/i }).click();
    const cohortDialog = page.locator('dialog[open]');
    await cohortDialog.getByLabel(/^Cohort ID/i).fill('BPO_EAST');
    await cohortDialog.getByLabel(/^Display name/i).fill('BPO East');
    await cohortDialog.getByRole('button', { name: /^Create Cohort$/i }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'BPO East' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/^BPOEAST-\d+$/)).toBeVisible();

    await page.getByRole('button', { name: /^Invite Staff$/i }).click();
    const inviteDialog = page.locator('dialog[open]');
    await inviteDialog.getByLabel(/^Full name/i).fill('QA Trainer');
    await inviteDialog.getByLabel(/^Work email/i).fill('qa.trainer@logicall.io');
    await inviteDialog.getByRole('button', { name: /^Create invite$/i }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /Pending Staff & Supervisor Invites/i })).toBeVisible();
    await expect(page.getByText('qa.trainer@logicall.io')).toBeVisible();

    await page.getByRole('button', { name: 'Edit access for Riley Chen' }).click();
    const editDialog = page.locator('dialog[open]');
    await editDialog.getByRole('radio', { name: /^Trainer$/i }).check();
    await editDialog.getByRole('button', { name: /^Save access$/i }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0, { timeout: 10_000 });
    const rileyRow = page.locator('tbody tr', { hasText: 'Riley Chen' });
    await expect(rileyRow.locator('td').nth(1).getByText('Trainer', { exact: true })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Reset password for Ana Ruiz' }).click();
    const resetDialog = page.locator('dialog[open]');
    await resetDialog.getByRole('button', { name: /^Issue Temporary Password$/i }).click();
    await expect(resetDialog.getByText('LC-1044')).toBeVisible({ timeout: 10_000 });
    await expect(resetDialog.getByText(/Temporary Password:/i)).toBeVisible();
    await resetDialog.getByRole('button', { name: /^Done$/i }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);

    await captureShot(page, '10-admin-roster-view.png');

    await mainNavLink(page, 'Analytics').click();
    await expect(page).toHaveURL(/\/analytics$/);
    await expect(page.getByRole('heading', { name: /Readiness Analytics/i })).toBeVisible();

    monitor.assertClean();
  });
});
