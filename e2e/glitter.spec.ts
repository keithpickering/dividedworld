import { expect, test, type Locator, type Page } from '@playwright/test';

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

/**
 * Cling (docs/plans/2026-11-06-shine-design.md, section 2, "settle, burst and cling"): a mouse passing over a bombed post picks glitter
 * up, and the page-fixed cling layer (`canvas[data-kb-shine="cling"]`) is made by that first pickup. Chromium, the light board, reduced
 * motion off (reduced motion turns cling off by design). The glitter's canvases take no pointer, so what the pointer hits is the post's
 * body, never the surface they stand on: issue #399, where cling knew only the surface and nothing was ever picked up.
 */
test('a mouse passing over a bombed post picks glitter up, and it drops off over what the pointer passes next', async ({ page }) => {
  await page.goto(STORY('light'));
  await expect.poll(() => page.locator(HOST).count()).toBeGreaterThan(0);
  const host = page.locator(HOST).first();
  await host.scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => window.__kbShineDraws?.(0) ?? -1)).toBeGreaterThan(0);
  expect(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  const box = (await host.boundingBox())!;
  const y = box.y + box.height / 2;
  /* Back and forth across the words, a few px a move, as a hand passes over a post. */
  for (let i = 0; i < 6 && (await page.locator('canvas[data-kb-shine="cling"]').count()) === 0; i++) {
    await page.mouse.move(box.x + 10, y);
    await page.mouse.move(box.x + box.width - 10, y, { steps: 40 });
  }
  await expect(page.locator('canvas[data-kb-shine="cling"]')).toHaveCount(1);
  /* Off the post, down the page's left edge: what was carried drops off, falls, and the layer goes once nothing is in the air. */
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(2, 100);
    await page.mouse.move(2, 600, { steps: 25 });
  }
  await expect(page.locator('canvas[data-kb-shine="cling"]')).toHaveCount(0, { timeout: 10_000 });
});

/**
 * Shake (docs/plans/2026-11-11-shake-plan.md, Task 5): glitter a fling shakes off lands on a post's cell and on the page, and lies there
 * until the thread is left. The story hands the engine's landing probe over as `window.__kbLanding`. Chromium, the Light story, reduced
 * motion off; the Still story lands nothing.
 */
const landed = (page: Page) => page.evaluate(() => window.__kbLanding?.landed() ?? null);
const nextFrame = (page: Page) => page.evaluate(() => new Promise<void>((r) => { requestAnimationFrame(() => r()); }));

/**
 * The bench's fling: 6,000 px a second coasting with exp(-2.6 dt), by scrollBy each frame, down (`dir` 1) or back up (-1). The post is read
 * first: its burst fires once its burst point has stayed in the middle of the view for 300 ms, and a post that has never been read has no
 * flakes to shake.
 */
const read = new WeakSet<Page>();
async function fling(page: Page, dir: 1 | -1 = 1): Promise<void> {
  if (dir === 1 && !read.has(page)) {
    read.add(page);
    await page.locator(HOST).first().scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => window.__kbShineDraws?.(0) ?? -1)).toBeGreaterThan(0);
    await page.waitForTimeout(2500);
  }
  if (dir === 1) { await page.evaluate(() => { window.scrollTo(0, 0); }); await page.waitForTimeout(300); }
  await page.evaluate(async (d) => {
    let v = 6000, last = performance.now();
    await new Promise<void>((done) => {
      const step = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        window.scrollBy(0, d * v * dt);
        v *= Math.exp(-2.6 * dt);
        if (v < 30) done(); else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, dir);
}

/**
 * A post 130 px tall is in view for four frames of a 6,000 px/s fling (100 px a frame), so one fling shakes a handful of flakes off it,
 * and where each lands (a post cell, or the gutters and gaps that are the page's ground) is the flake's own. So flings go down and back up
 * until glitter has landed on a post cell and on the page, each given the plan's 3 s, at most `FLINGS` of them.
 */
const FLINGS = 8;
async function flingUntilLanded(page: Page): Promise<void> {
  const both = async () => { const l = await landed(page); return l!.cell > 0 && l!.page > 0; };
  for (let i = 0; i < FLINGS; i++) {
    await fling(page, i % 2 === 0 ? 1 : -1);
    const end = Date.now() + 3000;
    while (Date.now() < end) { if (await both()) return; await page.waitForTimeout(100); }
  }
  expect(await landed(page), `after ${FLINGS} flings`).toMatchObject({ cell: expect.any(Number), page: expect.any(Number) });
  expect(await both(), `glitter on a post cell and on the page after ${FLINGS} flings: ${JSON.stringify(await landed(page))}`).toBe(true);
}

async function seeded(page: Page, name: string): Promise<void> {
  /* The story's own size (the Glitter story is opened at 1440 by 1120): a post is in view for as many frames of a 6,000 px/s fling as the
   * view is tall, and a short view shakes only a few flakes off it. */
  await page.setViewportSize({ width: 1440, height: 1120 });
  await page.goto(STORY(name));
  await expect.poll(() => page.locator(HOST).count()).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__kbLanding !== undefined)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** The pixels of a clip of the page's screenshot, as a string, to compare two shots. */
const shot = async (page: Page, x: number, y: number): Promise<string> =>
  (await page.screenshot({ clip: { x: Math.max(0, x - 6), y: Math.max(0, y - 6), width: 12, height: 12 } })).toString('base64');

test.setTimeout(120_000);
test('a fling shakes glitter onto a post and the page, and nothing stays in the air', async ({ page }) => {
  await seeded(page, 'light');
  await flingUntilLanded(page);
  await page.waitForTimeout(5000);
  expect(await page.evaluate(() => window.__kbLanding!.tiles().cell > 0 && window.__kbLanding!.tiles().page > 0)).toBe(true);
  expect(await page.locator('canvas[data-kb-shine="cling"]').count()).toBe(0);
});

test('leaving the thread sweeps what landed', async ({ page }) => {
  await seeded(page, 'light');
  await flingUntilLanded(page);

  await page.locator('a[href*="/b/"]').first().click();
  await expect.poll(async () => { const l = await landed(page); return l!.page + l!.cell; }, { timeout: 5000 }).toBe(0);
  expect(await page.evaluate(() => window.__kbLanding!.tiles().page)).toBe(0);
});

test('what landed shows, a scroll over it draws no tile, and the ground is not painted over', async ({ page }) => {
  await seeded(page, 'light');
  await flingUntilLanded(page);
  await page.waitForTimeout(1500);
  /* A tile out of view has no backing store, so each kind's first tile is brought into view, read once it has drawn again, and its flake's
   * point compared with the ground there: the same screen with every tile hidden. */
  const withTiles = new Map<string, { x: number; y: number; png: string; scroll: number }>();
  for (const kind of ['cell', 'page']) {
    const tile = page.locator(`canvas[data-kb-landing="${kind}"]`).first();
    await tile.evaluate((t) => { t.scrollIntoView({ block: 'center' }); });
    await page.waitForTimeout(600);
    const at = await tile.evaluate((t: HTMLCanvasElement) => {
      const r = t.getBoundingClientRect();
      const { data } = t.getContext('2d')!.getImageData(0, 0, t.width, t.height);
      let best = -1, alpha = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]! > alpha) { alpha = data[i]!; best = i >> 2; }
      return best < 0 ? null : { x: r.left + ((best % t.width) / t.width) * r.width, y: r.top + (Math.floor(best / t.width) / t.height) * r.height };
    });
    expect(at, `a painted flake on the ${kind}'s tile`).not.toBeNull();
    withTiles.set(kind, { ...at!, png: await shot(page, at!.x, at!.y), scroll: await page.evaluate(() => window.scrollY) });
    /* A scroll over landed glitter draws no tile. */
    const draws0 = await page.evaluate(() => window.__kbLanding!.draws());
    await page.evaluate(() => { window.scrollBy(0, 30); });
    await nextFrame(page); await nextFrame(page); await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__kbLanding!.draws()), 'tile draws over a scroll').toBe(draws0);
  }
  /* (The page's CSP takes no injected style sheet; the style property is the CSSOM's.) */
  await page.evaluate(() => { document.querySelectorAll<HTMLElement>('canvas[data-kb-landing]').forEach((c) => { c.style.visibility = 'hidden'; }); });
  for (const [kind, w] of withTiles) {
    await page.evaluate((y) => { window.scrollTo(0, y); }, w.scroll);
    await nextFrame(page); await nextFrame(page);
    expect(await shot(page, w.x, w.y), `the ${kind} flake's point is the ground's`).not.toBe(w.png);
  }
});

test('under reduced motion a fling lands nothing', async ({ page }) => {
  await seeded(page, 'still');
  await fling(page);
  await page.waitForTimeout(3000);
  expect(await landed(page)).toEqual({ effect: 0, cell: 0, page: 0 });
});

/**
 * What hangs out of a cell that glitter has landed on (the cell is positioned and isolated, engine/ui/thread/thread.css): the marks
 * strip and its first-time callout still paint above the body, and the things that open from a post (a mark's dialog, the Report
 * dialog; the postbit has no hover card in this codebase, engine/ui/postbit/Postbit.tsx, so there is none to check) are neither clipped nor behind the next post. Every cell of the bombed post carries `data-kb-landed`,
 * which is what the engine sets and all the CSS reads, after glitter has really landed on the thread.
 */
/** Whether the element is what the page shows at points across its box (the box cut to the view), not something under another. */
const onTop = (loc: Locator): Promise<string[]> => loc.evaluate((el) => {
  const r = el.getBoundingClientRect();
  const x0 = Math.max(0, r.left), x1 = Math.min(innerWidth, r.right), y0 = Math.max(0, r.top), y1 = Math.min(innerHeight, r.bottom);
  if (x1 - x0 < 2 || y1 - y0 < 2) return ['is not in view'];
  const bad: string[] = [];
  for (const [fx, fy] of [[0.15, 0.15], [0.85, 0.15], [0.5, 0.5], [0.15, 0.85], [0.85, 0.85]] as const) {
    const x = x0 + (x1 - x0) * fx, y = y0 + (y1 - y0) * fy;
    const hit = document.elementFromPoint(x, y);
    if (!hit || (!el.contains(hit) && !hit.contains(el))) bad.push(`at ${Math.round(x)},${Math.round(y)} the page shows ${hit?.tagName}.${hit?.className}`);
  }
  return bad;
});

test('with glitter landed on its cells, a post\'s marks, callout and dialogs are not covered or clipped', async ({ page }) => {
  await seeded(page, 'light');
  await flingUntilLanded(page);
  const post = page.locator(HOST).first().locator('xpath=ancestor::article[1]');
  await post.evaluate((a) => {
    for (const c of Array.from(a.children)) if (!c.classList.contains('kb-visually-hidden')) c.setAttribute('data-kb-landed', '');
  });
  await post.scrollIntoViewIfNeeded();
  await page.evaluate(() => { window.scrollBy(0, -200); });
  await page.waitForTimeout(300);
  /* (a) The marks strip, and the callout hung under it, over the body. */
  const marks = post.locator('.kb-marks').first();
  expect(await onTop(marks)).toEqual([]);
  const callout = post.locator('.kb-callout').first();
  await expect(callout).toBeVisible();
  expect(await onTop(callout)).toEqual([]);
  /* (b) A mark's dialog, the Report dialog. */
  const opened: Array<[string, () => Promise<unknown>, Locator]> = [
    ['a mark\'s dialog', () => post.locator('.kb-mark').first().click(), page.locator('[role="dialog"]:visible, [popover]:popover-open').first()],
    ['the Report dialog', () => post.getByRole('button', { name: 'Report' }).click(), page.locator('[role="dialog"]:visible, [popover]:popover-open').first()],
  ];
  for (const [what, open, shown] of opened) {
    await open();
    await page.waitForTimeout(400);
    /* A dialog that did not open would be a check passed for nothing. */
    await expect(shown, `${what} opens`).toBeVisible();
    expect(await onTop(shown), `${what} is shown whole, above the next post`).toEqual([]);
    await page.keyboard.press('Escape');
    await page.mouse.move(2, 2);
  }
});
