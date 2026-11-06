import { expect, test, type Page } from '@playwright/test';

/**
 * Glitter Bomb's stories as a browser draws them (docs/plans/2026-11-06-shine-plan.md, Task 10): each of the Light, Dark and Still
 * stories ("Boards/09 Glitter Bomb", instances/divided-world/ui/glitter-bomb/Glitter.board.stories.tsx) shows at least one Glitter Bomb
 * host with a painted under-canvas, and the story's probe (`window.__kbShineDraws(n)`) reports draws. A story that seeds its play after
 * the page mounted showed no glitter at all, and only a real page says so.
 */
const STORY = (name: string) => `/?fixture=boards&story=boards-09-glitter-bomb--${name}`;
const HOST = '[data-kb-glitter]';

/** How many of the canvas's pixels are painted at all, 0 to 1. */
const painted = (page: Page): Promise<number> =>
  page.locator(`${HOST} canvas.dw-glitter-under`).first().evaluate((cv: HTMLCanvasElement) => {
    const { data } = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height);
    let n = 0, hit = 0;
    for (let i = 3; i < data.length; i += 4 * 13) { n++; if (data[i]! > 0) hit++; }
    return n === 0 ? 0 : hit / n;
  });

for (const name of ['light', 'dark', 'still']) {
  test(`the ${name} story shows glitter, painted under the words, and reports its draws`, async ({ page }) => {
    await page.goto(STORY(name));
    await expect.poll(() => page.locator(HOST).count()).toBeGreaterThan(0);
    await page.locator(HOST).first().scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => window.__kbShineDraws?.(0) ?? -1)).toBeGreaterThan(0);
    await expect.poll(() => painted(page)).toBeGreaterThan(0);
  });
}
