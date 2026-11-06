import { expect, test, type Page } from '@playwright/test';
import { OVERLAYS, open, type E2eWindow, type Probe } from './glass-screens.ts';

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

  /*
   * A dialog that scrolls itself keeps its ground under the scroll. The cut's panel (::after) is only as tall as the frame, so
   * below the first screen the dialog's own background is what lies there: it must be Canvas (the page's color), never CanvasText
   * all the way down. And the edge stays: CanvasText at the rim and along both diagonals, read at the foot of the scroll.
   * The dialogs are read as a phone sheet at 200% text, and as a centered overlay at a desktop width at 200% text.
   */
  test.describe('a dialog scrolled to its foot', () => {
    test.use({ deviceScaleFactor: 4 });
    const CASES = [['the phone sheet', { width: 390, height: 844 }], ['a desktop overlay', { width: 1440, height: 900 }]] as const;
    for (const [label, viewport] of CASES) {
      test(`${label}: Canvas below the first screen, CanvasText at the rim and on both diagonals`, async ({ page }) => {
        test.setTimeout(60_000);
        await page.emulateMedia({ forcedColors: 'active' });
        await page.setViewportSize(viewport);
        await page.goto('/characters');
        await page.waitForFunction(() => '__kbFake' in globalThis);
        await page.evaluate(async () => { await (globalThis as E2eWindow).__kbFake.setPreferences({ textSize: 200 }); });
        await open(page, OVERLAYS.find((s) => s.name.startsWith('The React picker'))!);
        /* At rest, before anything is scrolled: the top right diagonal, where the sticky title row has not yet come down over it. */
        const restBox = await page.locator('[role="dialog"]').last().boundingBox();
        const restShot = await page.screenshot();
        const at = await page.evaluate(async () => {
          const box = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!;
          const filler = document.createElement('div');
          filler.style.cssText = 'height:3000px;position:relative;z-index:1';
          box.lastElementChild!.append(filler);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const own = box.scrollHeight > box.clientHeight + 1;
          const scroller = own ? box : box.parentElement!;

          /* Scroll to the foot and wait on the position: settled when it has not moved for three frames (a float places itself again). */
          let last = -1;
          let still = 0;
          for (let i = 0; i < 120 && still < 3; i++) {
            scroller.scrollTop = 1e6;
            await new Promise((r) => requestAnimationFrame(r));
            still = scroller.scrollTop === last ? still + 1 : 0;
            last = scroller.scrollTop;
          }
          const cs0 = getComputedStyle(box);
          const probe = document.createElement('i');
          probe.style.cssText = 'color:Canvas';
          document.body.append(probe);
          const canvas = getComputedStyle(probe).color;
          probe.style.cssText = 'color:CanvasText';
          const text = getComputedStyle(probe).color;
          probe.remove();
          const r = box.getBoundingClientRect();
          const cs = getComputedStyle(box);
          return { own, scrollbarColor: cs0.scrollbarColor, canvas, text, left: r.left, right: r.right, top: r.top, bottom: r.bottom, scrolled: scroller.scrollTop, cut: parseFloat(cs.getPropertyValue('--kb-cut')), border: parseFloat(cs.getPropertyValue('--kb-border')), vh: innerHeight };
        });
        expect(at.scrollbarColor, 'the scrollbar is the system\'s, not the page\'s colors').toBe('auto');
        expect(at.scrolled, 'it is scrolled past its first screen').toBeGreaterThan(300);
        expect(at.top, 'the frame\'s top corner is in the window').toBeGreaterThanOrEqual(0);
        expect(at.bottom, 'the frame\'s foot is in the window').toBeLessThanOrEqual(at.vh + 0.5);
        const canvasRgb = (at.canvas.match(/\d+/gu) ?? []).map(Number) as unknown as readonly [number, number, number];
        const shot = await page.screenshot();
        const rgb = async (x: number, y: number, reach = 0) => {
          const [r, g, b] = await pixelAt(page, shot, Math.round(x * 4), Math.round(y * 4), reach, canvasRgb);
          return `rgb(${r}, ${g}, ${b})`;
        };
        const midY = (at.top + at.bottom) / 2;
        expect(await rgb(at.right - 12, midY), 'the ground below the first screen is Canvas').toBe(at.canvas);
        expect(await rgb(at.right - at.border / 2, midY), 'the rim is CanvasText').toBe(at.text);
        /* A point inside each diagonal's stroke: halfway along the cut, half a border in along the normal. */
        const k = at.cut / 2 + at.border * 0.35;
        const [tr = 0, tg = 0, tb = 0] = await pixelAt(page, restShot, Math.round((restBox!.x + restBox!.width - k) * 4), Math.round((restBox!.y + k) * 4), 3, canvasRgb);
        expect(`rgb(${tr}, ${tg}, ${tb})`, 'the top right diagonal at rest is CanvasText').toBe(at.text);
        expect(await rgb(at.left + k, at.bottom - k, 3), 'the bottom left diagonal is CanvasText').toBe(at.text);
      });
    }
  });
});

/* The pixel at (x, y), or with `reach` the one farthest from `away` (the Canvas color) in the square that far around it: a hairline stroke is antialiased at a fraction of a pixel. */
async function pixelAt(page: Page, shot: Buffer, x: number, y: number, reach = 0, away: readonly [number, number, number] = [0, 0, 0]): Promise<readonly [number, number, number]> {
  return page.evaluate(async ([b64, px, py, rc, from]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const n = (rc as number) * 2 + 1;
    const d = g.getImageData((px as number) - (rc as number), (py as number) - (rc as number), n, n).data;
    const f = from as unknown as number[];
    const far = (i: number) => Math.abs(d[i]! - f[0]!) + Math.abs(d[i + 1]! - f[1]!) + Math.abs(d[i + 2]! - f[2]!);
    let best = 0;
    for (let i = 0; i < d.length; i += 4) if (far(i) > far(best)) best = i;
    return [d[best]!, d[best + 1]!, d[best + 2]!] as const;
  }, [shot.toString('base64'), x, y, reach, [...away]] as const);
}
