import { expect, test, type Page } from '@playwright/test';

/**
 * The 2003 board stands in a column at most 1200px wide, centered past it (the owner's word, the glass plan's
 * section 8 amendment of 2026-10-30, scaled by 1.25 with the type in the glass-polish design's section 7; `--kb-board-max` in engine/ui/tokens.css), and the glass keeps its own
 * widths: the HUD spans the window at every width. Below the column's max the board fills the window less the
 * board's 2% gutters, and nothing scrolls sideways.
 */
const MAX = 1200;

const box = async (page: Page, selector: string) => {
  const b = await page.locator(selector).first().boundingBox();
  expect(b, selector).not.toBeNull();
  return b!;
};
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function openThread(page: Page): Promise<void> {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'The long one', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'The long one' })).toBeVisible();
}

test.describe('a wide window', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the thread, the banner and the links are 1200px wide and centered; the HUD spans the window', async ({ page }) => {
    await openThread(page);
    for (const selector of ['.kb-acts', '.kb-banner', '.kb-nav', '.kb-frame > .kb-page']) {
      const b = await box(page, selector);
      expect(b.width, selector).toBeCloseTo(MAX, 0);
      expect(b.x, selector).toBeCloseTo((1440 - MAX) / 2, 0);
    }
    const hud = await box(page, '.kb-hud');
    expect(hud.x).toBe(0);
    expect(hud.width).toBe(1440);
    expect(await overflow(page)).toBe(0);
  });

  for (const [label, path] of [['the index', '/'], ['a board', '/b/general']] as const) {
    test(`${label} is a column at most 1200px wide, centered`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('.kb-frame > .kb-page')).toBeVisible();
      const b = await box(page, '.kb-frame > .kb-page');
      expect(b.width).toBeCloseTo(MAX, 0);
      expect(b.x).toBeCloseTo((1440 - MAX) / 2, 0);
      expect(await overflow(page)).toBe(0);
    });
  }
});

test.describe('a narrower window', () => {
  test.use({ viewport: { width: 800, height: 900 } });

  test('the thread fills the window less its 2% gutters, and the HUD spans it', async ({ page }) => {
    await openThread(page);
    const acts = await box(page, '.kb-acts');
    expect(acts.width).toBeCloseTo(800 * 0.96, 0);
    expect(acts.x).toBeCloseTo(800 * 0.02, 0);
    const hud = await box(page, '.kb-hud');
    expect(hud.width).toBe(800);
    expect(await overflow(page)).toBe(0);
  });
});

test.describe('at the column\'s own width and either side of it', () => {
  for (const width of [320, 390, 1000, 1200, 1240, 2560]) {
    test(`no sideways scroll at ${width}px, and the thread is never past ${MAX}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openThread(page);
      expect((await box(page, '.kb-acts')).width).toBeLessThanOrEqual(MAX + 0.5);
      expect(await overflow(page)).toBe(0);
    });
  }
});

/**
 * The vignette (the glass-polish design's section 8) is violet laid toward the edges of the window, and the board's text column is
 * untouched, so the board's contrast is what it was. Measured in the browser: a strip inside the column is the same pixels with the
 * vignette drawn as with it hidden, a strip in the gutter is not, and under High contrast it is not drawn at all.
 */
test.describe('the vignette', () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

  const strip = (page: Page, x: number, y: number) => page.screenshot({ clip: { x, y, width: 40, height: 40 }, animations: 'disabled' });

  test('lies in the gutters and never inside the 1200px column; High contrast draws none', async ({ page }) => {
    await openThread(page);
    const vignette = page.locator('.kb-vignette');
    await expect(vignette).toHaveCount(1);
    await expect(vignette).toHaveAttribute('aria-hidden', 'true');
    expect(await vignette.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
    expect(await vignette.evaluate((e) => getComputedStyle(e).position)).toBe('fixed');
    /* Just inside the column's left edge (x 120) and its right (x 1320), at the top, the middle and the foot above the HUD. */
    const inside = [[122, 20], [122, 450], [122, 700], [1318 - 40, 20], [1318 - 40, 450], [1318 - 40, 700], [700, 20], [700, 700]] as const;
    const outside = [[2, 20], [2, 700], [1398, 450]] as const;
    const drawn = await Promise.all([...inside, ...outside].map(([x, y]) => strip(page, x, y)));
    await vignette.evaluate((e) => { (e as HTMLElement).style.display = 'none'; });
    const bare = await Promise.all([...inside, ...outside].map(([x, y]) => strip(page, x, y)));
    inside.forEach((at, i) => expect(drawn[i]!.equals(bare[i]!), `inside the column at ${at}`).toBe(true));
    outside.forEach((at, i) => expect(drawn[inside.length + i]!.equals(bare[inside.length + i]!), `in the gutter at ${at}`).toBe(false));
    await vignette.evaluate((e) => { (e as HTMLElement).style.display = ''; });
    await page.evaluate(() => document.documentElement.setAttribute('data-kb-contrast', 'high'));
    expect(await vignette.evaluate((e) => getComputedStyle(e).display)).toBe('none');
  });
});
