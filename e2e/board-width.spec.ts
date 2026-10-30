import { expect, test, type Page } from '@playwright/test';

/**
 * The 2003 board stands in a column at most 960px wide, centered past it (the owner's word, the glass plan's
 * section 8 amendment of 2026-10-30; `--kb-board-max` in engine/ui/tokens.css), and the glass keeps its own
 * widths: the HUD spans the window at every width. Below the column's max the board fills the window less the
 * board's 2% gutters, and nothing scrolls sideways.
 */
const MAX = 960;

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

  test('the thread, the banner and the links are 960px wide and centered; the HUD spans the window', async ({ page }) => {
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

  for (const [label, path] of [['the index', '/'], ['a board', '/b/general'], ['the standings', '/standings']] as const) {
    test(`${label} is a column at most 960px wide, centered`, async ({ page }) => {
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
  for (const width of [320, 390, 960, 1000, 1200, 2560]) {
    test(`no sideways scroll at ${width}px, and the thread is never past ${MAX}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openThread(page);
      expect((await box(page, '.kb-acts')).width).toBeLessThanOrEqual(MAX + 0.5);
      expect(await overflow(page)).toBe(0);
    });
  }
});
