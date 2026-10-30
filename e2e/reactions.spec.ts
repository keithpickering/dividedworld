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
    const picker = page.getByRole('dialog', { name: /^React to / });
    await expect(picker).toBeVisible();
    const hud = page.getByRole('region', { name: 'Game HUD' });
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

/*
 * A 1000px window is below the switch to the Phone board's layout (engine/ui/glass/board.ts), where the
 * picker is the sheet above the HUD; it must still stay inside the window and clear of the HUD, even for a
 * post at the page's foot, and every kind must be reachable where the room is short.
 */
test.describe('a short desktop window', () => {
  test.use({ viewport: { width: 1000, height: 500 } });

  test('the picker opened on the last post lies inside the window, above the HUD', async ({ page }) => {
    await page.goto('/b/general');
    await page.getByRole('link', { name: 'Who keeps reacting with tea?', exact: true }).click();
    const posts = page.getByRole('article');
    await expect(posts.first()).toBeVisible();
    /* The last post another player's character wrote has a React button; scroll to the very foot of the page first. */
    const last = posts.filter({ has: page.getByRole('button', { name: 'React' }) }).last();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await last.getByRole('button', { name: 'React' }).click();
    const picker = page.getByRole('dialog', { name: /^React to / });
    await expect(picker).toBeVisible();
    const hud = page.getByRole('region', { name: 'Game HUD' });
    const [p, h] = [(await picker.boundingBox())!, (await hud.boundingBox())!];
    expect(p.y).toBeGreaterThanOrEqual(-1);
    expect(p.y + p.height).toBeLessThanOrEqual(h.y + 1);
    expect(p.x).toBeGreaterThanOrEqual(-1);
    expect(p.x + p.width).toBeLessThanOrEqual(1001);
    /* It is above the HUD in stacking too: its middle is not covered by the HUD or anything else. */
    expect(await picker.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 10));
      return !!top && el.contains(top);
    })).toBe(true);
    /* And every kind can be reached: where the room is short the popover scrolls, so each, scrolled to, lies inside its box. */
    for (const k of await picker.locator('.kb-picker-kind').all()) {
      await k.scrollIntoViewIfNeeded();
      const box = (await k.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(p.y - 1);
      expect(box.y + box.height).toBeLessThanOrEqual(p.y + p.height + 1);
    }
  });
});

/* On the Main board's layout the picker opens by its post, as the React board draws it: below the reactions row, its left edge at the row's, or above it where below would run under the HUD. */
test.describe('a wide window', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the picker opens by the post\'s reactions, inside the window and clear of the HUD', async ({ page }) => {
    await page.goto('/b/general');
    await page.getByRole('link', { name: 'Who keeps reacting with tea?', exact: true }).click();
    const post = page.locator('#post-3');
    await post.getByRole('button', { name: 'React' }).click();
    const picker = page.getByRole('dialog', { name: /^React to / });
    await expect(picker).toBeVisible();
    await expect(picker).toHaveAttribute('data-kb-place', /^(below|above)$/u);
    const row = (await post.locator('.kb-reactions').boundingBox())!;
    const [p, h] = [(await picker.boundingBox())!, (await page.getByRole('region', { name: 'Game HUD' }).boundingBox())!];
    expect(Math.abs(p.x - row.x)).toBeLessThanOrEqual(1);
    if ((await picker.getAttribute('data-kb-place')) === 'below') expect(p.y).toBeGreaterThan(row.y + row.height);
    else expect(p.y + p.height).toBeLessThan(row.y);
    expect(p.y + p.height).toBeLessThanOrEqual(h.y + 1);
    expect(p.x + p.width).toBeLessThanOrEqual(1441);
  });
});
