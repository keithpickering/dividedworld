import { expect, test, type Page } from '@playwright/test';

/**
 * The Chrome button in a real browser (the board-look plan, Task 4, quality review): a small button is a target of at least 24px
 * (WCAG 2.5.8) where Quote, Spin and History stand beside one another and the toolbar's buttons beside one another; under forced
 * colors (Windows High Contrast), where backgrounds and shadows are not drawn, the primary is told from the rest by its border and
 * a pressed button by an outline; and aria-disabled draws as :disabled does.
 */
async function openThread(page: Page): Promise<void> {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'The long one', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'The long one' })).toBeVisible();
}

test.describe('target size', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('a post\'s small actions and a toolbar button are at least 24px tall and wide', async ({ page }) => {
    await openThread(page);
    const post = page.getByRole('article').first();
    const buttons = [
      ...(await post.locator('.kb-button[data-kb-size="small"]').all()),
      ...(await page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button').all()),
    ];
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const b of buttons) {
      const box = await b.boundingBox();
      expect(box, await b.innerText()).not.toBeNull();
      expect(box!.height, `${await b.innerText()} (${box!.width} x ${box!.height})`).toBeGreaterThanOrEqual(24);
      expect(box!.width, await b.innerText()).toBeGreaterThanOrEqual(24);
    }
  });
});

test.describe('forced colors', () => {
  test.use({ viewport: { width: 1280, height: 900 }, forcedColors: 'active' });

  test('the primary button is told from the others by its border, a pressed one by an outline', async ({ page }) => {
    await openThread(page);
    const send = page.getByRole('button', { name: 'Send' });
    const quote = page.getByRole('button', { name: 'Quote' }).first();
    const width = (b: typeof send) => b.evaluate((e) => getComputedStyle(e).borderTopWidth);
    expect(await width(send), 'Send\'s border').toBe('2px');
    expect(await width(quote), 'Quote\'s border').toBe('1px');

    const outline = (b: typeof send) => b.evaluate((e) => { const c = getComputedStyle(e); return `${c.outlineStyle} ${c.outlineWidth}`; });
    const preview = page.getByRole('button', { name: 'Preview' });
    await expect(preview).toHaveAttribute('aria-pressed', 'false');
    expect(await outline(preview), 'not pressed').toMatch(/^none/u);
    await page.getByRole('textbox', { name: 'Your reply' }).fill('hello');
    await preview.click();
    await expect(preview).toHaveAttribute('aria-pressed', 'true');
    expect(await outline(preview), 'pressed').toBe('solid 2px');
  });
});

test.describe('aria-disabled', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('draws as :disabled does: the muted label and edge on the plain face, no glow, no shadow', async ({ page }) => {
    await openThread(page);
    const quote = page.getByRole('button', { name: 'Quote' }).first();
    const look = () => quote.evaluate((e) => { const c = getComputedStyle(e); return [c.color, c.borderTopColor, c.backgroundImage, c.backgroundColor, c.textShadow, c.boxShadow]; });
    await quote.evaluate((e) => e.setAttribute('aria-disabled', 'true'));
    const aria = await look();
    await quote.evaluate((e) => { e.removeAttribute('aria-disabled'); e.setAttribute('disabled', ''); });
    const native = await look();
    expect(aria).toEqual(native);
  });
});
