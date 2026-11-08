import { expect, test } from '@playwright/test';

/* The demo account's address, and the code the in-memory backend accepts for any address. */
const EMAIL = 'demo-player@example.test';
const TEST_CODE = '123456';

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

/* A change of section is the body's alone (docs/plans/2026-11-08-glass-in-page-swap-design.md): the heading stays put, untouched by the crossing, and the pressed control keeps focus. */
test('Settings › The board on the Smooth feel leaves the heading unfiltered and opaque the whole way, and the press keeps focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/settings?section=account');
  await page.evaluate(() => { document.documentElement.setAttribute('data-kb-motion', 'full'); document.documentElement.setAttribute('data-kb-motion-feel', 'smooth'); });
  const h1 = page.getByRole('heading', { level: 1, name: 'Settings' });
  await expect(h1).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Account' })).toBeVisible();
  /* The page's own entrance (the head's stagger) is over before the press: only the section's change is sampled. */
  await expect.poll(() => page.evaluate(() => {
    for (let el: Element | null = document.querySelector('h1'); el && el.tagName !== 'MAIN'; el = el.parentElement) if (getComputedStyle(el).opacity !== '1') return false;
    return true;
  })).toBe(true);
  await page.evaluate(() => {
    const w = globalThis as unknown as { __h1: string[]; __stop: boolean };
    w.__h1 = [];
    w.__stop = false;
    const tick = () => {
      /* Every h1 in the document, the leaving screen's and the entering one's alike, and each ancestor up to the page's own main: a screen's crossing fades and blurs the screen's box, so the heading's own style stays 'none|1' while the heading in it is mid-fade. */
      for (const h of document.querySelectorAll('h1')) {
        for (let el: Element | null = h; el && el.tagName !== 'MAIN'; el = el.parentElement) {
          const c = getComputedStyle(el);
          w.__h1.push(`${c.filter}|${c.opacity}`);
        }
      }
      if (!w.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const press = page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'The board' });
  await press.click();
  await expect(page.getByRole('radiogroup', { name: 'Mode' })).toBeVisible();
  /* The old section has left: the crossing is over. */
  await expect(page.locator('.kb-settings-body [data-kb-exiting]')).toHaveCount(0);
  const seen = await page.evaluate(() => { const w = globalThis as unknown as { __h1: string[]; __stop: boolean }; w.__stop = true; return w.__h1; });
  expect(seen.length).toBeGreaterThan(5);
  /* At rest Motion leaves a settled head as `blur(0px)` or `none`: neither filters. Any other value is a heading mid-fade or mid-blur. */
  expect([...new Set(seen)].filter((v) => v !== 'none|1' && v !== 'blur(0px)|1')).toEqual([]);
  await expect(press).toBeFocused();
});
