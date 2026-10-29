import { expect, test } from '@playwright/test';

/* The reaction picker on a phone: a sheet above the HUD, the width of the screen, with the page not scrolling sideways. */
test.describe('a phone', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('the picker opens as a sheet above the HUD, with no horizontal scroll at 320px wide', async ({ page }) => {
    await page.goto('/b/general');
    await page.getByRole('link', { name: 'The long one', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'The long one' })).toBeVisible();
    const post = page.locator('#post-5'); // another player's character: your own posts have no React button
    await expect(post).toBeVisible();
    await post.getByRole('button', { name: 'React' }).click();
    const picker = page.getByRole('dialog', { name: /^React as / });
    await expect(picker).toBeVisible();
    const hud = page.getByRole('region', { name: 'HUD' });
    await expect(hud).toBeVisible();
    /* The sheet slides in; wait for it to settle before measuring. */
    await expect.poll(async () => {
      const [p, h] = [await picker.boundingBox(), await hud.boundingBox()];
      return p && h ? Math.round(h.y - (p.y + p.height)) : null;
    }).toBeGreaterThanOrEqual(0);
    const [p, h] = [(await picker.boundingBox())!, (await hud.boundingBox())!];
    expect(p.y + p.height).toBeLessThanOrEqual(h.y + 1);
    expect(p.x).toBeGreaterThanOrEqual(-1);
    expect(p.x + p.width).toBeLessThanOrEqual(321);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    /* Every kind is a button the size of a thumb, in view. */
    const kinds = picker.locator('.kb-picker-kind');
    expect(await kinds.count()).toBeGreaterThan(0);
    for (const k of await kinds.all()) {
      const box = (await k.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(321);
      expect(box.width).toBeGreaterThanOrEqual(24);
    }
  });
});
