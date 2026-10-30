import { expect, test } from '@playwright/test';

/* The demo account's address, and the code the in-memory backend accepts for any address. */
const EMAIL = 'demo-player@example.test';
const TEST_CODE = '123456';

test('signs out, then signs in again with a code, by keyboard alone', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('radio', { name: /^Dark/u }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-kb-mode', 'dark');
  await expect(page.getByText('Saved to your account.')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/$/u);
  /* Signed out: the page is the device's again, and the HUD offers Sign in (the drafts' removal is in Gate.test.tsx). */
  await expect(page.locator('html')).not.toHaveAttribute('data-kb-mode', /.*/u);
  await expect(page.getByRole('region', { name: 'Game HUD' }).getByRole('link', { name: 'Sign in' })).toBeVisible();
  /* A reload would start the demo world over, signed in; the HUD's own link is the way. */
  await page.getByRole('link', { name: 'Sign in' }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email address').focus();
  await page.keyboard.type(EMAIL);
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Code from the email')).toBeFocused();
  await page.keyboard.type(TEST_CODE);
  await page.keyboard.press('Enter');
  /* Playwright's 1280px window is above the switch (engine/ui/glass/board.ts): the Main board's HUD, scaled, whose swap is Swap mask. */
  await expect(page.getByRole('region', { name: 'Game HUD' }).getByRole('combobox', { name: 'Swap mask' })).toBeVisible();
});

test('a theme chosen in Settings is still there after a reload', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('radio', { name: /^Dark/u }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-kb-mode', 'dark');
  await expect(page.getByText('Saved to your account.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('radio', { name: /^Dark/u })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-kb-mode', 'dark');
});

test('Register and Invites fit a 320px phone with no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ['/register', '/invites', '/settings']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(wide, path).toBe(false);
  }
});
