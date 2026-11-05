import { expect, test, type Page } from '@playwright/test';
import { open, type Probe } from './glass-screens.ts';

/**
 * A chamfered piece draws its border along the cut (docs/plans/2026-11-05-backfill-boards-design.md section 4;
 * tools/check-chamfer-borders.mjs holds the stylesheets to it). The glass cut (engine/ui/glass/base.css) makes the element the
 * border's color, cut, and its ::after the panel one border in, cut by the same line moved in. So, in the browser, on each of
 * the seven pieces that were once clipped under an outline or a border:
 *  - the ::after has a polygon clip-path, the element is painted (the border's color), it has no outline for the clip to cut,
 *    and its own --kb-cut wins over the class's;
 *  - on the welcome letter, the pixels say so: just inside the diagonal is the edge's color, and just inside that the ground;
 *  - under forced colors, where an author background is replaced by a system color, the edge is still a different color from
 *    the panel inside it.
 */
test.use({ bypassCSP: true, reducedMotion: 'reduce', deviceScaleFactor: 1 });

interface Piece { readonly name: string; readonly screen: Probe; readonly selector: string; readonly cut: string }
const PIECES: readonly Piece[] = [
  { name: 'the welcome letter', screen: { name: 'Welcome', path: '/welcome' }, selector: '.kb-welcome-post', cut: '24px' },
  { name: 'the Updates post', screen: { name: 'Updates', path: '/?fixture=boards&story=boards-03-updates--newest' }, selector: '.kb-updates-post', cut: '24px' },
  { name: 'the guide article', screen: { name: 'Strategy Guide', path: '/guide' }, selector: '.kb-guide-article', cut: '24px' },
  { name: "Gabe's note on the front door", screen: { name: 'Front door', path: '/', signedOut: true }, selector: '.kb-front-door-note', cut: '24px' },
  { name: "a season's podium", screen: { name: 'Season news', path: '/?fixture=boards&story=boards-04-season-news--news' }, selector: '.kb-season-podium', cut: '14px' },
  { name: 'the settled rank card', screen: { name: 'Settlement', path: '/?fixture=boards&moment=09-settlement' }, selector: '.kb-settled-rank', cut: '40px' },
  { name: 'the orbs board state', screen: { name: 'Orbs', path: '/?fixture=boards&story=boards-04-orbs--board' }, selector: '.kb-orbs-board-state', cut: '26px' },
];

for (const { name, screen, selector, cut } of PIECES) {
  test(`${name} draws its border on the cut`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, screen);
    const piece = page.locator(selector).first();
    await expect(piece).toBeVisible();
    const read = await piece.evaluate((el) => {
      const cs = getComputedStyle(el);
      const a = getComputedStyle(el, '::after');
      return { clip: cs.clipPath, background: cs.backgroundColor, outline: cs.outlineStyle, afterClip: a.clipPath, afterBackground: a.backgroundColor, afterContent: a.content, cut: cs.getPropertyValue('--kb-cut').trim() };
    });
    expect(read.clip, 'the element is cut').toContain('polygon(');
    expect(read.afterClip, 'its ::after is cut by the moved-in line').toContain('polygon(');
    expect(read.afterContent, 'the ::after is drawn').not.toBe('none');
    expect(read.background, 'the element is the border\'s color').not.toBe('rgba(0, 0, 0, 0)');
    expect(read.afterBackground, 'the ::after is an opaque ground, so the edge color is only at the rim').toMatch(/^rgb\(/u);
    expect(read.cut, 'its own size, not the class\'s').toBe(cut);
    expect(read.outline, 'no outline for the clip to cut').toBe('none');
  });
}

test.describe('the pixels', () => {
  test.use({ deviceScaleFactor: 4 });

  /* A point `d` device pixels inside the top right diagonal of a piece's screenshot, from the diagonal's middle. */
  async function pixelsInside(page: Page, selector: string, cut: number, distances: readonly number[]) {
    const piece = page.locator(selector).first();
    await piece.scrollIntoViewIfNeeded();
    const box = (await piece.boundingBox())!;
    const png = (await piece.screenshot({ animations: 'disabled' })).toString('base64');
    return page.evaluate(async ({ png, w, cut, distances }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + png;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const s = img.width / w;
      const mid = (cut * s) / 2;
      return distances.map((d) => {
        const x = Math.round(img.width - mid - d / Math.SQRT2);
        const y = Math.round(mid + d / Math.SQRT2);
        const [r = 0, gr = 0, b = 0] = g.getImageData(x, y, 1, 1).data;
        return r + gr + b;
      });
    }, { png, w: box.width, cut, distances });
  }

  test('the welcome letter: just inside the diagonal is the edge, and just inside that the ground', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, PIECES[0]!.screen);
    /* The 1px edge is 4 device pixels thick, measured along the diagonal's normal; the ground is black. */
    const [edge, ground] = await pixelsInside(page, '.kb-welcome-post', 24, [2, 12]);
    expect(edge, 'the diagonal has an edge').toBeGreaterThan(150);
    expect(ground, 'one border in is the ground').toBeLessThan(45);
  });
});

test.describe('forced colors', () => {
  test('the welcome letter keeps an edge that is not the panel\'s color', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, PIECES[0]!.screen);
    const read = await page.locator('.kb-welcome-post').evaluate((el) => ({ edge: getComputedStyle(el).backgroundColor, panel: getComputedStyle(el, '::after').backgroundColor }));
    expect(read.edge, 'the edge is a different color from the panel inside it').not.toBe(read.panel);
  });
});
