import { expect, test } from '@playwright/test';
import { loadFaces } from './fonts.ts';
import { standInFaces } from './board-snapshot.ts';

/**
 * A mini avatar and its name are one unit (board-look plan, Task 3): the avatar is centered on the name's capitals, not on its line box.
 * Verdana's line box holds more room under its capitals than over them, so the nudge (`--kb-who-lift`, engine/ui/mini.css) is measured here
 * on the face the page loads (the system's Verdana, or the stand-in of its metrics where the machine has none: e2e/board-snapshot.ts). The
 * name's capitals are found from its own text: its baseline from the font's ascent over the text's content box, the capitals' middle from
 * the height of an "H". The poison lifts nothing and expects the unit named off-center.
 */
test.use({ reducedMotion: 'reduce', bypassCSP: true });

async function offCenter(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const unit = document.querySelector('.kb-board-last .kb-who')!;
    const mini = unit.querySelector('.kb-mini')!.getBoundingClientRect();
    const link = unit.querySelector('a')!;
    const text = (link.querySelector('.kb-who-name') ?? link).firstChild!;
    const range = document.createRange();
    range.selectNodeContents(text);
    const content = range.getBoundingClientRect();
    const style = getComputedStyle(link);
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const cap = ctx.measureText('H');
    const baseline = content.top + cap.fontBoundingBoxAscent;
    const capsMiddle = baseline - cap.actualBoundingBoxAscent / 2;
    return mini.top + mini.height / 2 - capsMiddle;
  });
}

test('the avatar sits on the middle of the name\'s capitals, within a pixel', async ({ page }) => {
  await standInFaces(page.context());
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/?fixture=boards&story=boards-01-index--index');
  await expect(page.locator('.kb-board-last .kb-who a')).toBeVisible();
  await loadFaces(page);
  expect(Math.abs(await offCenter(page))).toBeLessThanOrEqual(1);
});

test('poison: an avatar that is not lifted is named off-center', async ({ page }) => {
  await standInFaces(page.context());
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/?fixture=boards&story=boards-01-index--index');
  await expect(page.locator('.kb-board-last .kb-who a')).toBeVisible();
  await loadFaces(page);
  await page.addStyleTag({ content: '.kb-who > .kb-mini, .kb-who-link > .kb-mini { top: 0 !important }' });
  expect(Math.abs(await offCenter(page))).toBeGreaterThan(1);
});
