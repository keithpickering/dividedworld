import { expect, test, type Page } from '@playwright/test';
import { open, type E2eWindow } from './glass-screens.ts';

/**
 * The menu bar holds an admin's nine tabs and Back on one row (board 37, the admin queue): the bar is as tall as a player's, every tab
 * stands at the same top, and where the tabs still do not fit, the row scrolls sideways with the current tab inside the bar.
 */
test.use({ bypassCSP: true, reducedMotion: 'reduce', deviceScaleFactor: 1 });

const facts = (page: Page) => page.evaluate(async () => {
  await document.fonts.ready;
  const bar = document.querySelector('nav.kb-glass-menu')!.getBoundingClientRect();
  const tabs = [...document.querySelectorAll('.kb-glass-menu-tab')].map((t) => t.getBoundingClientRect());
  const current = document.querySelector('.kb-glass-menu-tab[aria-current="page"]')?.getBoundingClientRect();
  const list = document.querySelector('.kb-glass-menu-list')!;
  return {
    height: Math.round(bar.height), tops: [...new Set(tabs.map((t) => Math.round(t.top)))], count: tabs.length,
    current: current && { left: current.left, right: current.right }, bar: { left: bar.left, right: bar.right },
    scrolls: list.scrollWidth > list.clientWidth, fade: list.getAttribute('data-kb-fade'),
  };
});

/* Signed in as a new admin account, not open(asAdmin): that seeds the flag after the menu may have asked, and the menu does not ask again. */
async function asAdmin(page: Page) {
  await page.goto('/settings');
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  await page.evaluate(() => {
    const w = globalThis as E2eWindow;
    w.__kbFake.signInAs(w.__kbFake.seed.account('boss', { admin: true }));
  });
  await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test('at 1440 an admin\'s nine tabs stand on the one row a player\'s eight do', async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, { name: 'Settings', path: '/settings' });
  const player = await facts(page);
  expect(player.count).toBe(8);
  const other = await context.newPage();
  await other.setViewportSize({ width: 1440, height: 900 });
  await asAdmin(other);
  const admin = await facts(other);
  expect(admin.count).toBe(9);
  expect(admin.tops).toHaveLength(1);
  expect(admin.height).toBe(player.height);
  /* The step-down fits them before any scroll. */
  expect(admin.scrolls).toBe(false);
  expect(admin.fade).toBe('none');
});

test('at 834 an admin\'s nine tabs scroll in their strip, the current one inside the bar, and the strip fades where more wait', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 900 });
  await asAdmin(page);
  await expect.poll(async () => (await facts(page)).scrolls).toBe(true);
  await expect.poll(async () => { const f = await facts(page); return f.current!.right <= f.bar.right && f.current!.left >= f.bar.left; }).toBe(true);
  await expect(page.locator('.kb-glass-menu-list')).toHaveAttribute('data-kb-fade', /^(start|end|both)$/u);
});

test('at 1440 a focused tab\'s ring lies inside the list\'s visible box', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await asAdmin(page);
  for (const label of ['Alerts', 'Admin']) {
    await page.getByRole('link', { name: label }).focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => {
      const tab = document.activeElement!;
      const cs = getComputedStyle(tab);
      const reach = parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset);
      const r = tab.getBoundingClientRect();
      const l = document.querySelector('.kb-glass-menu-list')!.getBoundingClientRect();
      return { style: cs.outlineStyle, top: r.top - reach - l.top, bottom: l.bottom - (r.bottom + reach), left: r.left - reach - l.left, right: l.right - (r.right + reach) };
    });
    expect(ring.style).not.toBe('none');
    expect(Math.min(ring.top, ring.bottom)).toBeGreaterThanOrEqual(0);
    expect(label === 'Alerts' ? ring.left : ring.right).toBeGreaterThanOrEqual(0);
  }
});

test('at 1440 Back is clickable across its whole box, not under the list\'s ring room', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await asAdmin(page);
  const hit = await page.evaluate(() => {
    const back = document.querySelector('.kb-glass-menu-back')!;
    const r = back.getBoundingClientRect();
    /* The link is skewed: its layout box, not its wider bounding box, is what a click reaches at mid-height. */
    const at = document.elementFromPoint((r.left + r.right) / 2 + (back as HTMLElement).offsetWidth / 2 - 2, r.top + r.height / 2);
    return back.contains(at);
  });
  expect(hit).toBe(true);
});

test('at 834 under high contrast the edge fade does not mask the tabs', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 900 });
  await asAdmin(page);
  const list = page.locator('.kb-glass-menu-list');
  await expect(list).toHaveAttribute('data-kb-fade', /^(start|end|both)$/u);
  expect(await list.evaluate((el) => getComputedStyle(el).maskImage)).not.toBe('none');
  await page.evaluate(() => document.documentElement.setAttribute('data-kb-contrast', 'high'));
  expect(await list.evaluate((el) => getComputedStyle(el).maskImage)).toBe('none');
});

test('at 834 the strip lies within the bar\'s content, its ring room taken back on both sides', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 900 });
  await asAdmin(page);
  const got = await page.evaluate(() => {
    const l = document.querySelector('.kb-glass-menu-list')!.getBoundingClientRect();
    const b = document.querySelector('.kb-glass-menu-back')!.getBoundingClientRect();
    const row = document.querySelector('.kb-glass-menu-row')!.getBoundingClientRect();
    return { left: l.left - row.left, right: row.right - l.right, b: b.left };
  });
  expect(Math.abs(got.left)).toBeLessThan(2);
  expect(Math.abs(got.right)).toBeLessThan(2);
});
