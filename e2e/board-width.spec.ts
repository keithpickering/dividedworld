import { expect, test, type Page } from '@playwright/test';

/**
 * The 2003 board stands in a column at most 1200px wide, centered past it (the owner's word, the glass plan's
 * section 8 amendment of 2026-10-30, scaled by 1.25 with the type in the glass-polish design's section 7; `--kb-board-max` in
 * engine/ui/tokens.css), and the glass keeps its own widths: the HUD spans the window at every width. Below the column's max the board fills the window less the
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
 * The vignette (the glass-polish design's section 8, as the owner changed it: it lies over the '03 board itself; the owner, 2026-11-07,
 * took its mask away and brought the glow outward) is violet laid toward the edges of the window, strongest at the corners and the
 * foot, with no mask: the corner glow is clear to the column's edge. Measured in the browser, with the HUD hidden so the foot above it is read
 * (the HUD is opaque, z-index 30, and would cover the foot's samples): a gutter strip is shifted by the vignette and a gutter corner
 * more than the gutter's vertical middle; the foot is drawn over the posts too; under High contrast none
 * is drawn; and every piece of text under it keeps 4.5:1 against the ground the vignette leaves it, in both board modes at three widths.
 */
const meanShift = (page: Page, a: Buffer, b: Buffer) => page.evaluate(async ([x, y]) => {
  const px = async (png: string) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const g = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
    g.drawImage(bitmap, 0, 0);
    return g.getImageData(0, 0, bitmap.width, bitmap.height).data;
  };
  const [p, q] = [await px(x!), await px(y!)];
  let sum = 0;
  for (let i = 0; i < p.length; i += 4) sum += Math.abs(p[i]! - q[i]!) + Math.abs(p[i + 1]! - q[i + 1]!) + Math.abs(p[i + 2]! - q[i + 2]!);
  return sum / (p.length / 4) / 3;
}, [a.toString('base64'), b.toString('base64')]);

for (const scheme of ['light', 'dark'] as const) {
  for (const [width, height] of [[1440, 900], [800, 900]] as const) {
    test.describe(`the vignette, ${scheme}, ${width}px wide`, () => {
      test.use({ viewport: { width, height }, reducedMotion: 'reduce', colorScheme: scheme, bypassCSP: true });
      const W = 8;
      const strip = (page: Page, x: number, y: number) => page.screenshot({ clip: { x, y, width: W, height: W }, animations: 'disabled' });
      const left = (width - Math.min(width * 0.96, MAX)) / 2;

      test('lies in the gutters, has no mask; High contrast draws none', async ({ page }) => {
        await openThread(page);
        await page.addStyleTag({ content: '.kb-hud { visibility: hidden !important; }' });
        const vignette = page.locator('.kb-vignette');
        await expect(vignette).toHaveCount(1);
        await expect(vignette).toHaveAttribute('aria-hidden', 'true');
        expect(await vignette.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
        expect(await vignette.evaluate((e) => getComputedStyle(e).position)).toBe('fixed');
        /* No mask: a mask's edge at the column was a hard step, so the glow itself is drawn outward and fades softly. */
        expect(await vignette.evaluate((e) => { const c = getComputedStyle(e); return [c.maskImage, c.webkitMaskImage]; }), 'the vignette has no mask').toEqual(['none', 'none']);
        /* The column's own edges, and its middle, at the top, the middle, and the foot above the HUD (the foot's 220px is y 680 to 900). */
        const xs = [left, width / 2 - W / 2, width - left - W];
        const ys = [0, 450, 700, 800, height - W];
        const inside = xs.flatMap((x) => ys.map((y) => [x, y] as const));
        const gutter = [[0, 0], [0, 450], [0, height - W], [width - W, 450]] as const;
        const all = [...inside, ...gutter];
        const drawn = await Promise.all(all.map(([x, y]) => strip(page, x, y)));
        await vignette.evaluate((e) => { (e as HTMLElement).style.display = 'none'; });
        const bare = await Promise.all(all.map(([x, y]) => strip(page, x, y)));
        const shift = await Promise.all(all.map((_, i) => meanShift(page, drawn[i]!, bare[i]!)));
        /* The foot lies over the posts too. */
        const footIn = inside.findIndex(([x, y]) => x === xs[1] && y === 800);
        expect(shift[footIn], 'the foot over the posts').toBeGreaterThan(0);
        gutter.forEach((at, i) => expect(shift[inside.length + i], `in the gutter at ${at}`).toBeGreaterThan(0));
        if (width === 1440) {
          const [top, middle, foot] = shift.slice(inside.length) as [number, number, number];
          expect(top, 'the top corner against the gutter\'s middle').toBeGreaterThan(middle);
          expect(foot, 'the bottom corner against the gutter\'s middle').toBeGreaterThan(middle);
        }
        await vignette.evaluate((e) => { (e as HTMLElement).style.display = ''; });
        await page.evaluate(() => document.documentElement.setAttribute('data-kb-contrast', 'high'));
        expect(await vignette.evaluate((e) => getComputedStyle(e).display)).toBe('none');
      });
    });
  }
}

/**
 * The clear center covers the column at every height (the owner's request, 2026-11-07, and its review): the glow was an ellipse to the
 * window's corners, so at 1920x1080 its clear center was as tall as the column is wide only in proportion to the window, and the
 * column's top and bottom ~135px were tinted. The vignette adds nothing anywhere in the column above the foot: the same samples with
 * the vignette shown and hidden are identical, at the top, at the middle and just above the foot's 220px, at the column's edges and
 * its center, at four window sizes in both board modes.
 */
for (const scheme of ['light', 'dark'] as const) {
  for (const [width, height] of [[1024, 768], [1440, 900], [1920, 1080], [2560, 1080]] as const) {
    test.describe(`the vignette leaves the column clear, ${scheme}, ${width}x${height}`, () => {
      test.use({ viewport: { width, height }, reducedMotion: 'reduce', colorScheme: scheme, bypassCSP: true });

      test('adds nothing in the column from its top to the foot', async ({ page }) => {
        await openThread(page);
        await page.addStyleTag({ content: '.kb-hud { visibility: hidden !important; }' });
        const W = 8;
        const left = (width - Math.min(width * 0.96, MAX)) / 2;
        const xs = [left, width / 2 - W / 2, width - left - W];
        const ys = [0, 60, 135, 200, height / 2, height - 220 - W - 4];
        const at = xs.flatMap((x) => ys.map((y) => [x, y] as const));
        const strip = (x: number, y: number) => page.screenshot({ clip: { x, y, width: W, height: W }, animations: 'disabled' });
        const vignette = page.locator('.kb-vignette');
        const drawn = await Promise.all(at.map(([x, y]) => strip(x, y)));
        await vignette.evaluate((e) => { (e as HTMLElement).style.display = 'none'; });
        const bare = await Promise.all(at.map(([x, y]) => strip(x, y)));
        const shift = await Promise.all(at.map((_, i) => meanShift(page, drawn[i]!, bare[i]!)));
        at.forEach(([x, y], i) => expect(shift[i], `the column at ${x},${y} (${width}x${height})`).toBe(0));
      });
    });
  }
}

/* The worst contrast found under the vignette, read by the run that reports it. */
for (const scheme of ['light', 'dark'] as const) {
  for (const width of [1440, 800, 390]) {
    test.describe(`text under the vignette, ${scheme}, ${width}px wide`, () => {
      test.use({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: scheme, bypassCSP: true });

      test('keeps 4.5:1 against the ground the vignette leaves it', async ({ page }) => {
        await openThread(page);
        await page.addStyleTag({ content: '.kb-hud { visibility: hidden !important; }' });
        /* Every text-bearing element in the window, with its ink; then the same window with the ink hidden, so the pixels read are the ground under the vignette. */
        const boxes = await page.evaluate(() => {
          const out: { x: number; y: number; color: string; text: string }[] = [];
          for (const el of document.querySelectorAll('body *')) {
            if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) continue;
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            if (r.width < 4 || r.height < 4 || r.bottom > innerHeight || r.top < 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
            for (const f of [0.25, 0.5, 0.75]) out.push({ x: Math.round(r.left + r.width * f), y: Math.round(r.top + r.height / 2), color: cs.color, text: (el.textContent ?? '').trim().slice(0, 24) });
          }
          return out;
        });
        expect(boxes.length).toBeGreaterThan(20);
        await page.addStyleTag({ content: '*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-decoration-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }' });
        const shot = (await page.screenshot({ animations: 'disabled' })).toString('base64');
        const worst = await page.evaluate(async ([png, list]) => {
          const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
          const g = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
          g.drawImage(bitmap, 0, 0);
          const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
          const lum = (r: number, gg: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
          let low = { ratio: 99, text: '', at: '' };
          for (const b of JSON.parse(list) as { x: number; y: number; color: string; text: string }[]) {
            const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(b.color);
            if (!m) continue;
            const d = g.getImageData(b.x, b.y, 1, 1).data;
            const [l1, l2] = [lum(+m[1]!, +m[2]!, +m[3]!), lum(d[0]!, d[1]!, d[2]!)];
            const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            if (ratio < low.ratio) low = { ratio, text: b.text, at: `${b.x},${b.y} on rgb(${d[0]},${d[1]},${d[2]}) in ${b.color}` };
          }
          return low;
        }, [shot, JSON.stringify(boxes)] as const);
        console.log(`worst contrast under the vignette, ${scheme} ${width}: ${worst.ratio.toFixed(2)} ("${worst.text}" at ${worst.at})`);
        expect(worst.ratio, `"${worst.text}" at ${worst.at}`).toBeGreaterThanOrEqual(4.5);
      });
    });
  }
}

test('the vignette is the board\'s: a glass page draws none', async ({ page }) => {
  await page.goto('/log');
  await expect(page.locator('.kb-glass-page, .kb-glass-content').first()).toBeVisible();
  await expect(page.locator('.kb-vignette')).toHaveCount(0);
});
