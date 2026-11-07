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

/**
 * The glitter fills the post's body, as every card's effect does (the owner, 2026-11-06: "the card effect should apply to the entire
 * post in all cases"): in the thread each of its canvases is the body's box (`.kb-act-main`, its padding box, bar to bar), not only the
 * words' own, and a flake that falls lands anywhere on it.
 */
test('the glitter\'s canvases fill the post\'s body', async ({ page }) => {
  await page.goto(STORY('light'));
  await expect.poll(() => page.locator(HOST).count()).toBeGreaterThan(0);
  await page.locator(HOST).first().scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => window.__kbShineDraws?.(0) ?? -1)).toBeGreaterThan(0);
  const problems = await page.locator(HOST).first().evaluate((host) => {
    const cell = host.closest<HTMLElement>('.kb-act-main');
    if (!cell) return ['the post has no body'];
    const b = cell.getBoundingClientRect();
    const body = { left: b.left + cell.clientLeft, top: b.top + cell.clientTop, width: cell.clientWidth, height: cell.clientHeight };
    return [...host.querySelectorAll<HTMLCanvasElement>('canvas.dw-glitter-under, canvas.dw-glitter-flash')].flatMap((cv) => {
      const r = cv.getBoundingClientRect();
      return [r.left - body.left, r.top - body.top, r.width - body.width, r.height - body.height].some((d) => Math.abs(d) > 1)
        ? [`${cv.className} is ${Math.round(r.width)}x${Math.round(r.height)} at ${Math.round(r.left)},${Math.round(r.top)}, the body is ${body.width}x${body.height} at ${Math.round(body.left)},${Math.round(body.top)}`]
        : [];
    });
  });
  expect(problems).toEqual([]);
});
