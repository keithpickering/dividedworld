import { expect, test, type Page } from '@playwright/test';

/* The demo account's address, and the code the in-memory backend accepts for any address. */
const EMAIL = 'demo-player@example.test';
const TEST_CODE = '123456';

/* The fake's link (engine/ui/data/fake.ts's TEST_LINK): it signs in the address of the last code asked for. */
const TEST_LINK = 'test-link-hash-0123456789_ABCDEF';

/** Moves the app to `to` as a link does, with no load: a load starts the demo world over, signed in. */
const goInApp = (page: Page, to: string) => page.evaluate((p) => { history.pushState(null, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, to);

/**
 * A reader of a thread signs out and asks for a code on `/sign-in?next=<the thread>`, then opens the emailed link as
 * its button does. Returns the thread's path.
 */
async function openLinkFromThread(page: Page, hash: string): Promise<string> {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'Who keeps reacting with a thumbs up?', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Your reply' })).toBeVisible();
  const thread = new URL(page.url()).pathname;
  await page.goto('/settings?section=account');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('region', { name: 'Game HUD' }).getByRole('link', { name: 'Sign in' })).toBeVisible();
  await goInApp(page, `/sign-in?next=${encodeURIComponent(thread)}`);
  await page.getByLabel('Email address').fill(EMAIL);
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Code from the email')).toBeVisible();
  expect(await page.evaluate(() => (globalThis as unknown as { __kbFake: { lastNext(): string | null } }).__kbFake.lastNext())).toBe(thread);
  /* The page the email's button opens: the same query, and the link in the fragment. */
  await goInApp(page, '/');
  await expect(page.getByLabel('Code from the email')).toHaveCount(0);
  await goInApp(page, `/sign-in?next=${encodeURIComponent(thread)}#token_hash=${hash}`);
  return thread;
}

test('signs out, then signs in again with a code, by keyboard alone', async ({ page }) => {
  await page.goto('/settings?section=board');
  await page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Dark' }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-kb-mode', 'dark');
  await expect(page.getByText('Saved to your account.')).toBeVisible();
  /* Sign out is at the foot of Settings › Account. */
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Account' }).focus();
  await page.keyboard.press('Enter');
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
  await page.goto('/settings?section=board');
  await page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Dark' }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-kb-mode', 'dark');
  await expect(page.getByText('Saved to your account.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Dark' })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-kb-mode', 'dark');
});

test('Register and Invites fit a 320px phone with no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ['/register', '/invites', '/settings', '/settings?section=board', '/settings?section=account']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(wide, path).toBe(false);
  }
});

test('on a phone the door\'s field rows are bare: the generic phone row\'s 16px padding does not reach them', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  /* The demo world starts signed in; the door is what a signed-out visit sees. */
  await page.goto('/settings?section=account');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/u);
  for (const path of ['/sign-in', '/register']) {
    /* A reload would start the demo world over, signed in; the app's own navigation keeps it signed out. */
    await page.evaluate((to) => { window.history.pushState({}, '', to); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
    await expect(page.getByRole('heading', { level: 1, name: path === '/sign-in' ? 'Sign in' : 'Register' })).toBeVisible();
    const pads = await page.locator('.kb-door .kb-acct-row').evaluateAll((rows) => rows.map((row) => {
      const style = getComputedStyle(row);
      return [style.paddingTop, style.paddingBottom];
    }));
    expect(pads.length, path).toBeGreaterThan(0);
    for (const pad of pads) expect(pad, path).toEqual(['0px', '0px']);
  }
});

test('the emailed link: the page shows the panel, the press signs in, and Continue lands on the thread the code was asked from', async ({ page }) => {
  const thread = await openLinkFromThread(page, TEST_LINK);
  await expect(page.getByText('This link signs you in. It works once.')).toBeVisible();
  await expect(page.getByLabel('Email address')).toHaveCount(0);
  /* Opening the page spent nothing, and no history entry holds the fragment. */
  expect(new URL(page.url()).hash).toBe('');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText(`You are signed in as ${EMAIL}.`)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL((u) => u.pathname === thread);
  await expect(page.getByRole('textbox', { name: 'Your reply' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Game HUD' }).getByRole('combobox', { name: 'Swap mask' })).toBeVisible();
});

test('a refused link ends on the form with the sentence', async ({ page }) => {
  await openLinkFromThread(page, 'not-the-link-0123456789_ABCDEF');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(/that link does not work, or it has expired: ask for a new code/u);
  await expect(page.getByLabel('Email address')).toBeVisible();
});
