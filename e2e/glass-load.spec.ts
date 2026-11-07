import { expect, test, type Page } from '@playwright/test';
import type { Fake } from '../engine/ui/data/fake.ts';

/**
 * The glass-load design's end to end (docs/plans/2026-11-07-glass-load-plan.md, Task 16): the demo world with every api answer 300 ms
 * late (`?latency=`, web/src/data/backend.ts), so a screen's wait can be watched. A glass screen opens only once its data is in, over
 * the screen the player pressed from; the control pressed spins meanwhile, and a failed load says so and can be tried again
 * (`?fail=<rpc>`, which fails that call's first answer only, in the same builds as the latency).
 */
test.use({ deviceScaleFactor: 1, viewport: { width: 1440, height: 900 } });

const LATENCY = 'latency=300';
const menu = (page: Page) => page.getByRole('navigation', { name: 'Menu' });
const logTab = (page: Page) => menu(page).getByRole('link', { name: 'Log' });
const roster = (page: Page) => page.locator('.kb-roster-card');
const logLines = (page: Page) => page.locator('.kb-glass-screen tr[data-kb-kind]');
type E2eWindow = typeof globalThis & { readonly __kbFake: Fake };

async function openRoster(page: Page, query = LATENCY) {
  await page.goto(`/characters?${query}`);
  await expect(roster(page).first()).toBeVisible();
}

test('from a board, the HUD avatar spins and the board stays until My characters lands, over a complete roster', async ({ page }) => {
  await page.goto(`/b/general?${LATENCY}`);
  const avatar = page.locator('.kb-hud-avatar');
  await expect(avatar).toBeVisible();
  await expect(page.locator('.kb-thread-list')).toBeVisible();
  /* The frame the glass mounts in: are the roster's panels already in it? */
  await page.evaluate(() => {
    const w = window as unknown as { __mount: { cards: number } | null };
    w.__mount = null;
    new MutationObserver(() => {
      if (w.__mount === null && document.querySelector('[data-kb-world="glass"] .kb-glass-page') !== null) {
        w.__mount = { cards: document.querySelectorAll('[data-kb-world="glass"] .kb-roster-card').length };
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  await avatar.click();
  await expect(avatar.locator('.kb-spinner')).toBeVisible();
  await expect(page.locator('.kb-thread-list')).toBeVisible();
  await expect(page.locator('.kb-glass-page')).toHaveCount(0);
  await expect(roster(page).first()).toBeVisible();
  const mount = await page.evaluate(() => (window as unknown as { __mount: { cards: number } | null }).__mount);
  expect(mount).not.toBeNull();
  expect(mount!.cards).toBeGreaterThan(0);
  await expect(avatar.locator('.kb-spinner')).toHaveCount(0);
});

test('from My characters, the Log tab keeps the roster and spins, and the Log has its lines when its entrance starts', async ({ page }) => {
  await openRoster(page);
  await page.evaluate(() => {
    const w = window as unknown as { __entered: { lines: number } | null };
    w.__entered = null;
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) {
        if (w.__entered === null && n instanceof HTMLElement && n.matches('.kb-glass-screen') && n.querySelector('.kb-roster-card') === null) {
          w.__entered = { lines: n.querySelectorAll('tr[data-kb-kind]').length };
        }
      }
    }).observe(document.querySelector('main')!, { childList: true, subtree: true });
  });
  await logTab(page).click();
  await expect(logTab(page)).toHaveAttribute('data-kb-pending', '');
  await expect(logTab(page).locator('.kb-spinner')).toBeVisible();
  await expect(roster(page).first()).toBeVisible();
  await expect(logLines(page).first()).toBeVisible();
  const entered = await page.evaluate(() => (window as unknown as { __entered: { lines: number } | null }).__entered);
  expect(entered).not.toBeNull();
  expect(entered!.lines).toBeGreaterThan(0);
  await expect(logTab(page)).not.toHaveAttribute('data-kb-pending', '');
});

test('a hover on the Log tab and then a press shows no spinner: the load was read ahead', async ({ page }) => {
  await openRoster(page);
  await logTab(page).hover();
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const w = window as unknown as { __spun: boolean };
    w.__spun = false;
    const look = () => { if (document.querySelector('.kb-glass-menu .kb-spinner, .kb-glass-menu [data-kb-pending]') !== null) w.__spun = true; requestAnimationFrame(look); };
    look();
  });
  await logTab(page).click();
  await expect(logLines(page).first()).toBeVisible({ timeout: 250 });
  expect(await page.evaluate(() => (window as unknown as { __spun: boolean }).__spun)).toBe(false);
});

test('Escape during a load leaves the old screen', async ({ page }) => {
  await page.goto(`/b/general?${LATENCY}`);
  await expect(page.locator('.kb-thread-list')).toBeVisible();
  await page.locator('.kb-hud-avatar').click();
  await expect(page.locator('.kb-hud-avatar .kb-spinner')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  await expect(page.locator('.kb-glass-page')).toHaveCount(0);
  await expect(page.locator('.kb-thread-list')).toBeVisible();
  await expect(page.locator('.kb-hud-avatar .kb-spinner')).toHaveCount(0);
  await expect(page).toHaveURL((u) => u.pathname === '/b/general');
});

test('the reveal overlay opens with its boards, with no wait', async ({ page }) => {
  await openRoster(page);
  await page.getByRole('button', { name: /^Reveal .+'s class$/ }).first().click();
  const dialog = page.locator('.kb-reveal-dialog');
  await expect(dialog).toBeVisible({ timeout: 150 });
  expect(await dialog.locator('option').count()).toBeGreaterThan(0);
});

test('a failed load says so, and Try again loads it', async ({ page }) => {
  await page.goto(`/log?${LATENCY}&fail=log_page`);
  await expect(page.getByRole('heading', { name: "This screen didn't load" })).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(logLines(page).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: "This screen didn't load" })).toHaveCount(0);
});

test('with Motion Off, the spinner stands still', async ({ page }) => {
  await page.goto(`/characters?${LATENCY}`);
  await page.waitForFunction(() => '__kbFake' in globalThis);
  await page.evaluate(async () => { await (globalThis as E2eWindow).__kbFake.setPreferences({ motion: 'reduce' }); });
  await page.reload();
  await expect(roster(page).first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-kb-motion', 'reduce');
  await logTab(page).click();
  const bars = logTab(page).locator('.kb-spinner > i');
  await expect(bars.first()).toBeVisible();
  expect(await bars.count()).toBe(4);
  const still = await bars.evaluateAll((els) => els.map((e) => ({ name: getComputedStyle(e).animationName, running: e.getAnimations().length })));
  for (const b of still) { expect(b.name).toBe('none'); expect(b.running).toBe(0); }
});
