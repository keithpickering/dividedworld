import { expect, test, type Page } from '@playwright/test';
import { holdScrollDriven, type HeldScrollDriven } from './scroll-driven.ts';

/**
 * A screenshot taken with `animations: 'disabled'` draws an animation on a scroll's timeline as though it were not there (Playwright
 * finishes or cancels every animation for the capture), so a card the phone hand poses from the scroll (engine/ui/cards/Hand.tsx
 * `animatePoses`) is shot unposed, where its text was measured posed. `holdScrollDriven` holds each such animation's values on its
 * element for the capture, and its release gives the animation back to its timeline.
 */

const PAGE = `<body style="margin:0"><div id="row" style="display:flex;overflow-x:auto;width:300px;padding-top:50px"><div id="card" style="flex:none;width:100px;height:50px;background:rgb(255,0,0)"></div>${'<div style="flex:none;width:100px"></div>'.repeat(4)}</div></body>`;

/** The first and last rows of the window where column 50 is red, in a screenshot. */
const redRows = async (page: Page, animations: 'allow' | 'disabled') => {
  const png = (await page.screenshot({ animations })).toString('base64');
  return page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const g = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
    g.drawImage(bitmap, 0, 0);
    const rows: number[] = [];
    for (let y = 0; y < bitmap.height; y++) { const [r, gr, b] = g.getImageData(50, y, 1, 1).data; if (r === 255 && gr === 0 && b === 0) rows.push(y); }
    return [rows[0], rows.at(-1)];
  }, png);
};

test.use({ viewport: { width: 300, height: 200 } });

test.beforeEach(async ({ page }) => {
  await page.setContent(PAGE);
  await page.evaluate(() => {
    const card = document.getElementById('card')!;
    const Timeline = (globalThis as unknown as { ViewTimeline: new (o: { subject: Element; axis: string }) => AnimationTimeline }).ViewTimeline;
    card.animate([{ translate: '0 80px' }, { translate: '0 -40px' }], { timeline: new Timeline({ subject: card, axis: 'inline' }), fill: 'both' });
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
});

test('without the hold, a disabled-animations screenshot draws the card unposed (the fault the hold is for)', async ({ page }) => {
  const drawn = await redRows(page, 'allow');
  expect(await redRows(page, 'disabled')).not.toEqual(drawn);
});

test('with the hold, the screenshot draws the card where the scroll poses it, and the release gives the animation back to the scroll', async ({ page }) => {
  const drawn = await redRows(page, 'allow');
  const posed = await page.locator('#card').evaluate((el) => getComputedStyle(el).translate);
  await holdScrollDriven(page);
  expect(await redRows(page, 'disabled')).toEqual(drawn);
  /* The animation is drawing again when the release returns, so a hold taken next reads the pose and not the card unanimated: read in the page, in the turn the release ends. */
  const released = await page.evaluate(async () => {
    await (globalThis as { kbHeldScrollDriven?: HeldScrollDriven }).kbHeldScrollDriven!.release();
    return getComputedStyle(document.getElementById('card')!).translate;
  });
  expect(released, 'the pose once released').toBe(posed);
  expect(await page.locator('#card').getAttribute('style')).not.toContain('translate');
  /* Held again at once (a second capture, as glass-text's high contrast takes), the card is where the scroll poses it, not where it stands unanimated. */
  const again = await holdScrollDriven(page);
  expect(await redRows(page, 'disabled'), 'the card held a second time').toEqual(drawn);
  await again();
  await page.locator('#row').evaluate((el) => { el.scrollLeft = 150; });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  expect(await redRows(page, 'allow'), 'the card after the row scrolls on').not.toEqual(drawn);
});
