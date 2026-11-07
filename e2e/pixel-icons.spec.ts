import { expect, test, type Page } from '@playwright/test';

/**
 * The board's pixel icons are never scaled (the board-look plan, Task 5; engine/ui/board/Icons.tsx): each is drawn at its viewBox's own
 * whole-pixel size, so its half-pixel strokes land on the screen's pixels. A browser check, since a stylesheet that resized one would pass a
 * jsdom test: a folder's box is exactly 24 by 20 CSS px, a nav icon 16 by 14, Start a thread's 14 by 14 and the who icon 24 by 20, at the
 * default text size and at a larger one (an icon does not follow the text), and on a phone.
 */
test.use({ reducedMotion: 'reduce', bypassCSP: true });

const STORY = '/?fixture=boards&story=boards-02-board--board';

async function sizes(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }));
}

async function check(page: Page) {
  await page.goto(STORY);
  await expect(page.getByRole('link', { name: 'The long one', exact: true })).toBeVisible();
  const folders = await sizes(page, '.kb-thread-flags svg');
  expect(folders).toHaveLength(4);
  for (const box of folders) expect(box).toEqual([24, 20]);
  for (const box of await sizes(page, '.kb-thread-legend svg')) expect(box).toEqual([24, 20]);
  for (const box of await sizes(page, '.kb-nav svg')) expect(box).toEqual([16, 14]);
  for (const box of await sizes(page, '.kb-new-thread-toggle svg')) expect(box).toEqual([14, 14]);
  for (const box of await sizes(page, '.kb-presence-icon svg')) expect(box).toEqual([24, 20]);
}

test('the icons draw at their own whole-pixel size', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await check(page);
});

test('the icons keep their size at a larger text size and on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => { try { localStorage.setItem('kb-text-size', '200'); } catch { /* not stored */ } });
  await page.goto(STORY);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  for (const box of await sizes(page, '.kb-thread-flags svg')) expect(box).toEqual([24, 20]);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const box of await sizes(page, '.kb-thread-flags svg')) expect(box).toEqual([24, 20]);
});

test('poison: a stylesheet that resizes an icon is named by its box', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(STORY);
  await expect(page.getByRole('link', { name: 'The long one', exact: true })).toBeVisible();
  await page.addStyleTag({ content: '.kb-icon { width: 30px; height: 25px; }' });
  expect((await sizes(page, '.kb-thread-flags svg'))[0]).not.toEqual([24, 20]);
});
