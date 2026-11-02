import { expect, test } from '@playwright/test';

test.describe('LogiCall Pulse smoke', () => {
  test('root redirects unauthenticated users to the Operations Sign-In', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeVisible();
    await expect(page.getByLabel(/LC Number or Email/i)).toBeVisible();
  });

  test('join page renders the Cohort join form', async ({ page }) => {
    await page.goto('/join/THS-7842');
    await expect(page.getByText('THS-7842')).toBeVisible();
    await expect(page.getByLabel(/LC Number/i)).toBeVisible();
  });
});
