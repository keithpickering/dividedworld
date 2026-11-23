import { expect, test, type Page } from '@playwright/test';

/* The forum-load design's end to end: the demo world with every api answer 300 ms late (`?latency=`, web/src/data/backend.ts). */
const LATENCY = '/b/general?latency=300';

const meter = (page: Page) => page.getByRole('progressbar', { name: 'Loading the page' });
const banner = (page: Page) => page.locator('.kb-address-text');
const rows = (page: Page) => page.locator('.kb-thread-row');

async function openBoard(page: Page) {
  await page.goto(LATENCY);
  await expect(rows(page).first()).toBeVisible();
}

test('a click to a thread keeps the board on screen, shows the meter and Opening, then lands the first post with the presence box', async ({ page }) => {
  await openBoard(page);
  /* Watch every frame: when the first post first shows, is the presence box already there? */
  await page.evaluate(() => {
    const w = window as unknown as { __frames: { post: boolean; presence: boolean }[] };
    w.__frames = [];
    const tick = () => {
      const post = document.querySelector('#post-1') !== null;
      const presence = [...document.querySelectorAll('*')].some((e) => e.children.length === 0 && e.textContent?.includes('Users browsing this thread'));
      w.__frames.push({ post, presence });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const first = rows(page).first();
  const list = page.locator('.kb-thread-list');
  await first.locator('.kb-thread-title').click();
  await expect(banner(page)).toContainText('Opening ');
  await expect(banner(page)).toContainText('…');
  await expect(meter(page)).toBeVisible();
  /* Mid-load the board's list is still what is shown. */
  await expect(list).toBeVisible();
  await expect(page.locator('#post-1')).toHaveCount(0);
  await expect(page.locator('#post-1')).toBeVisible();
  await expect(page.getByText('Users browsing this thread')).toBeVisible();
  const frames = await page.evaluate(() => (window as unknown as { __frames: { post: boolean; presence: boolean }[] }).__frames);
  const at = frames.findIndex((f) => f.post);
  expect(at).toBeGreaterThanOrEqual(0);
  expect(frames[at]!.presence).toBe(true);
  await expect(banner(page)).not.toContainText('Opening ');
});

test('a second click during the load lands on the second page', async ({ page }) => {
  await openBoard(page);
  const links = page.locator('.kb-thread-title');
  const second = await links.nth(1).evaluate((a) => (a as HTMLAnchorElement).getAttribute('href'));
  const secondTitle = (await links.nth(1).textContent())!.trim();
  await links.nth(0).click();
  await expect(banner(page)).toContainText('Opening ');
  await links.nth(1).click();
  await expect(page.getByRole('heading', { level: 1, name: secondTitle })).toBeVisible();
  await expect(page).toHaveURL((u) => u.pathname === new URL(second!, 'http://x').pathname);
  /* The first click's page never lands on top of the second. */
  await page.waitForTimeout(600);
  await expect(page.getByRole('heading', { level: 1, name: secondTitle })).toBeVisible();
  await expect(page).toHaveURL((u) => u.pathname === new URL(second!, 'http://x').pathname);
});

test('Back to the board shows it with no meter: the cache answers at once', async ({ page }) => {
  await openBoard(page);
  await page.locator('.kb-thread-title').first().click();
  await expect(page.locator('#post-1')).toBeVisible();
  await expect(meter(page)).toHaveAttribute('aria-valuenow', '0', { timeout: 3000 });
  await page.goBack();
  /* Inside one latency the board is back, and the meter never filled. */
  await expect(rows(page).first()).toBeVisible({ timeout: 150 });
  const seen = await page.evaluate(() => new Promise<number>((resolve) => {
    let max = 0;
    const bar = document.querySelector('[role="progressbar"]')!;
    const end = performance.now() + 200;
    const tick = () => { max = Math.max(max, Number(bar.getAttribute('aria-valuenow'))); if (performance.now() < end) requestAnimationFrame(tick); else resolve(max); };
    tick();
  }));
  /* A cached landing shows only the full flash (100); a load in flight would climb through 0..90 first. */
  expect(seen === 0 || seen === 100).toBe(true);
  await expect(banner(page)).not.toContainText('Opening ');
});

test('an address with a thread that does not exist shows "The thread you requested does not exist."', async ({ page }) => {
  await page.goto('/t/00000000-0000-4000-8000-000000000000?latency=300');
  await expect(page.getByRole('heading', { level: 1, name: 'The thread you requested does not exist.' })).toBeVisible();
});

/*
 * The banner holds still while a page opens (the owner's word of 2026-11-22): `Opening {host}{path}…` is longer than the host at rest, and
 * nothing around it may move for that, neither the banner's height nor any of its pieces, so the page under it does not jump on every click.
 * The address is the one thing allowed to change, and only its words. Measured at a desk, between the desk and the phone, and on a phone.
 */
const STILL = ['.kb-banner', '.kb-logo', '.kb-tagline', '.kb-address', '.kb-meter', '.kb-banner-search', '.kb-menu-button', '.kb-nav', '.kb-frame > .kb-page'];
for (const [label, viewport] of [['desk', { width: 1280, height: 800 }], ['mid', { width: 700, height: 800 }], ['phone', { width: 390, height: 800 }]] as const) {
  test(`${label}: the banner and the page under it hold still while a page opens`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/b/general?latency=2000');
    await expect(rows(page).first()).toBeVisible();
    const boxes = () => page.evaluate((selectors) => selectors.map((s) => {
      const e = document.querySelector(s);
      if (!e) return `${s}: none`;
      const r = e.getBoundingClientRect();
      return `${s}: ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
    }), STILL);
    const rest = await boxes();
    await rows(page).first().locator('.kb-thread-title').click();
    await expect(banner(page)).toContainText('Opening ');
    expect(await boxes()).toEqual(rest);
    /* The address is one line, whatever it says. */
    const lines = await banner(page).evaluate((e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)));
    expect(lines).toBe(1);
  });
}
