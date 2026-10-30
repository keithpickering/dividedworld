import { expect, test, type Page } from '@playwright/test';

/**
 * Whoops!'s splat in a real browser, which jsdom cannot draw (cards plan Task 5): #41 on the Main board's
 * moment carries its ink on a canvas, a drag across the ink scrubs it away on the reader's own screen, and
 * a reload brings it back.
 */
test.use({ viewport: { width: 1440, height: 1120 }, reducedMotion: 'reduce' });

const inked = (page: Page) => page.evaluate(() => {
  const c = document.querySelector<HTMLCanvasElement>('#post-41 .kb-whoops-ink');
  if (!c) return 0;
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i]! > 40) n++;
  return n;
});

test('the splat on #41 is drawn, scrubbed by a drag, and back after a reload', async ({ page }) => {
  await page.goto('/?fixture=boards&moment=01-main');
  const canvas = page.locator('#post-41 .kb-whoops-ink');
  await expect(canvas).toBeVisible();
  await expect.poll(() => inked(page)).toBeGreaterThan(1000);
  const before = await inked(page);
  const box = (await canvas.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.47, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, y, { steps: 20 });
  await page.mouse.up();
  await expect.poll(() => inked(page)).toBeLessThan(before);
  /* The demo world starts over on a load (the address is rewritten once it is in), so a reload is a fresh visit to the moment. */
  await page.goto('/?fixture=boards&moment=01-main');
  await expect.poll(() => inked(page)).toBeGreaterThan(before * 0.95);
});
