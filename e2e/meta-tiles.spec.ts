import { expect, test } from '@playwright/test';

/**
 * The meta tile (docs/plans/2026-11-06-meta-acts-design.md, sections 1 and 5): every mark is one 2.25rem tile and answers a hover.
 */
test.use({ bypassCSP: true, reducedMotion: 'reduce', deviceScaleFactor: 1, viewport: { width: 1440, height: 900 } });

test('every mark is a 36px tile and answers a hover', async ({ page }) => {
  await page.goto('/?fixture=boards&moment=01-main');
  const marks = page.locator('.kb-mark');
  await expect(marks.first()).toBeVisible();
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  const heights = await marks.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(heights.length).toBeGreaterThan(0);
  for (const h of heights) expect(Math.abs(h - 36)).toBeLessThanOrEqual(1);

  const first = marks.first();
  const look = () => first.evaluate((el) => { const cs = getComputedStyle(el); return `${cs.borderTopColor}|${cs.backgroundColor}`; });
  await page.mouse.move(0, 0);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const before = await look();
  await first.scrollIntoViewIfNeeded();
  await first.hover();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  expect(await look()).not.toBe(before);
});
