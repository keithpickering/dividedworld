import { expect, test, type Page } from '@playwright/test';
import { loadFaces } from './fonts.ts';
import { standInFaces } from './board-snapshot.ts';

/**
 * The index's "last post" cell holds two links, one above the other: the character's name and the time of the latest post. Each is a
 * target of 24px at the least (WCAG 2.2, 2.5.8), and the two boxes may not intersect, or the lower one's padding takes the upper
 * one's hit area away (board-look plan, Task 3, quality review). The poison puts back the padding with the negative margin that
 * pulled the time link up into the name's line.
 */
test.use({ reducedMotion: 'reduce', bypassCSP: true });

type Box = { x: number; y: number; width: number; height: number };

async function boxes(page: Page): Promise<{ who: Box; time: Box }[]> {
  await standInFaces(page.context());
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/?fixture=boards&story=boards-01-index--index');
  await expect(page.locator('.kb-board-last .kb-who a').first()).toBeVisible();
  await loadFaces(page);
  return page.evaluate(() => [...document.querySelectorAll('.kb-board-last')].flatMap((cell) => {
    const who = cell.querySelector('.kb-who > a');
    const time = cell.querySelector('.kb-board-last-by > a');
    if (!who || !time) return [];
    const r = (e: Element) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    return [{ who: r(who), time: r(time) }];
  }));
}

const intersect = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('the name link and the time link of the last post do not intersect, and each is 24px tall', async ({ page }) => {
  const cells = await boxes(page);
  expect(cells.length).toBeGreaterThan(0);
  for (const { who, time } of cells) {
    expect(intersect(who, time), `${JSON.stringify(who)} and ${JSON.stringify(time)}`).toBe(false);
    expect(who.height).toBeGreaterThanOrEqual(24);
    expect(time.height).toBeGreaterThanOrEqual(24);
  }
});

test('poison: the padded time link with the negative margin is named as intersecting the name', async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '.kb-board-last-by > a { display: inline-block !important; padding-block: 0.3rem !important; margin-block: -0.3rem !important; min-height: 0 !important }';
      document.head.append(style);
    });
  });
  const cells = await boxes(page);
  expect(cells.some(({ who, time }) => intersect(who, time))).toBe(true);
});
