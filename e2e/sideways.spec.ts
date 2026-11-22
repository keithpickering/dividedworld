import { expect, test } from '@playwright/test';
import { sideways } from './sideways.ts';

/**
 * The self-test of `sideways` (e2e/sideways.ts), the measure every "does not scroll sideways" guard reads (#994): on a board page at a
 * 320px phone's width it reads 0 or less, and a heading made too wide for the window drives it red while the frame's clip keeps the
 * document itself from scrolling, which is the case the document's own `scrollWidth` cannot see. Something placed against the window,
 * which the frame's clip does not reach, drives it red too.
 */
test.use({ viewport: { width: 320, height: 640 } });

const open = async (page: import('@playwright/test').Page) => {
  await page.goto('/b/general');
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
};

test('a board page that fits its window reads 0 or less', async ({ page }) => {
  await open(page);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});

test('a heading too wide for the window reads past it, though the clipped document does not scroll', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { document.querySelector<HTMLElement>('.kb-page h1')!.style.minWidth = '600px'; });
  const doc = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  /* The case: the clip holds the document, so a guard on the document is blind to the heading. */
  expect(doc).toBeLessThanOrEqual(0);
  expect(await sideways(page)).toBeGreaterThan(200);
});

test('an element placed against the window past its edge reads past it', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const past = document.createElement('div');
    past.style.cssText = 'position: absolute; left: 300px; top: 0; width: 200px; height: 10px;';
    document.body.append(past);
  });
  expect(await sideways(page)).toBeGreaterThan(100);
});
