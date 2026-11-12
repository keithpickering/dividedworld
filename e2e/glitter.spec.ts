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
 * A post is read first: its burst fires once its burst point has stayed in the middle of the view for 300 ms, and a post that has never
 * been read has no flakes to shake.
 */
const read = new WeakSet<Page>();
async function readPost(page: Page): Promise<void> {
  if (read.has(page)) return;
  read.add(page);
  await page.locator(HOST).first().scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => window.__kbShineDraws?.(0) ?? -1)).toBeGreaterThan(0);
  await page.waitForTimeout(2500);
}

/**
 * The bench's flick: a hand jostling the page at the top, `JOSTLES` times. Each jostle is a frame scrolled down at `JOSTLE` px a second,
 * just past the shake threshold (SHAKE_SPEED, 2,200), then back up at a sixth of that pace, under the threshold, so it shakes nothing
 * back and the page ends where it began.
 *
 * Why this and not a long fling: a flake is thrown at 0.55 of the scroll's speed against the page's way and one that flies off the screen
 * is culled (the owner's decision), and the page's own ground is only the 121 px gutters, the thin gaps between posts and the band above
 * the first post (document y 120 to 243 at 1440 by 1120). A 6,000 px/s fling throws its flakes 280 to 660 px and carries the page 1,000 px
 * from under them, so it almost never lands one on the page (measured: none in eight flings, in CI and here). A jostle sheds from the first
 * post while it is near the top of the view and moves the page so little that the band above it is still in view where the flakes
 * come down: some come back to rest on the post's cell, some on the band, in every flick (measured, 30 flicks: 2 to 9 on the cell
 * and 7 to 19 on the page at 2,800 px/s a flick).
 *
 * The engine reads a scroll's speed from the page's own clock: the distance between two scroll events over the time between them. So
 * the down frame scrolls `JOSTLE` times the time the frame really took, never 50 ms at most: with that cap a frame of 65 ms or more on a
 * busy CI shard read under SHAKE_SPEED and shook nothing (#520). A scroll made in one frame is heard in the next, so the speed read is
 * `JOSTLE` only where the two frames are alike; on uneven frames a jostle can read slow and shed nothing, and `flingUntilLanded` flicks
 * again rather than count on one. A frame past 80 ms scrolls 80 ms' worth, so the band above the first post stays in view (the engine
 * hears no shake across a gap of 100 ms anyway). The way back goes at a sixth of the pace by the same clock, at most 50 ms' worth a
 * frame, so it reads under SHAKE_SPEED however the frames fall (23 px over a 60 Hz frame is 1,400 px a second), until the page is where
 * it began.
 */
const JOSTLE = 2800, JOSTLES = 10;
async function flick(page: Page): Promise<void> {
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await page.waitForTimeout(300);
  await page.evaluate(async ({ v, n }) => {
    let last = performance.now(), jostles = 0, back = 0;
    await new Promise<void>((done) => {
      const step = (now: number) => {
        const dt = (now - last) / 1000; last = now;
        if (back > 0) {
          const up = Math.min(back, (v / 6) * Math.min(0.05, dt));
          window.scrollBy(0, -up); back -= up;
        } else if (jostles++ < n) {
          const before = window.scrollY;
          window.scrollBy(0, v * Math.min(0.08, dt));
          back = window.scrollY - before;
        } else { done(); return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, { v: JOSTLE, n: JOSTLES });
}

/** The old bench's fling, a long one: 6,000 px a second coasting with exp(-2.6 dt). Used where nothing should land, to be sure it could have. */
async function fling(page: Page): Promise<void> {
  await readPost(page);
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await page.waitForTimeout(300);
  await page.evaluate(async () => {
    let v = 6000, last = performance.now();
    await new Promise<void>((done) => {
      const step = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        window.scrollBy(0, v * dt);
        v *= Math.exp(-2.6 * dt);
        if (v < 30) done(); else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  });
}

/**
 * Glitter that lands is the flake's own: some on a post's cell and some on the page's ground. So flicks go on, each given the plan's 3 s
 * to land, until glitter lies on a post cell and on the page, at most `FLINGS` of them. The first does it in nearly every run; on a
 * busy shard's uneven frames a flick can shed little (see `flick`), so a few more are allowed before it fails.
 */
const FLINGS = 8;
async function flingUntilLanded(page: Page): Promise<void> {
  await readPost(page);
  const both = async () => { const l = await landed(page); return l!.cell > 0 && l!.page > 0; };
  for (let i = 0; i < FLINGS; i++) {
    await flick(page);
    const end = Date.now() + 3000;
    while (Date.now() < end) { if (await both()) return; await page.waitForTimeout(100); }
  }
  expect(await both(), `glitter on a post cell and on the page after ${FLINGS} flicks: ${JSON.stringify(await landed(page))}`).toBe(true);
}

async function seeded(page: Page, name: string): Promise<void> {
  /* The story's own size (the Glitter story is opened at 1440 by 1120): the band of page above the first post is as tall as the
   * flick needs, and a short view shakes only a few flakes off it. */
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
  /* A flake over what is neither a glitter cell nor the page's ground (a postbit, another post) keeps falling at its settled speed, about
   * 70 px a second, until it is over ground or leaves the screen (shake design, section 4): up to 16 s down a view 1,120 px tall. */
  await expect(page.locator('canvas[data-kb-shine="cling"]')).toHaveCount(0, { timeout: 20_000 });
});

test('leaving the thread sweeps what landed', async ({ page }) => {
  await seeded(page, 'light');
  await flingUntilLanded(page);

  await page.locator('a[href*="/b/"]').first().click();
  /* Every kind of landed glitter goes: the effect's own, a post cell's and the page's. */
  await expect.poll(async () => { const l = await landed(page); return [l!.effect, l!.cell, l!.page]; }, { timeout: 5000 }).toEqual([0, 0, 0]);
  expect(await page.evaluate(() => window.__kbLanding!.tiles().page)).toBe(0);
});

test('what landed shows, a scroll over it draws no tile, and the ground is not painted over', async ({ page }) => {
  await seeded(page, 'light');
  await flingUntilLanded(page);
  /* A second flick, so that more than the first flake lies on each. */
  await flick(page);
  await page.waitForTimeout(3000);
  /* A tile out of view has no backing store, so each tile is brought into view, read once it has drawn again, and its flakes' points
   * compared with the ground there: the same screen with every tile hidden. A flake can lie where a word's pixel is painted over it,
   * and one at rest under the glass HUD is on the page where nothing shows it (#493), so points are pooled across the kind's tiles, the
   * strongest of each, until there are `SAMPLES`, and at least one must differ (the page's own cells paint over the glitter under their
   * words, as the post's do). One tile's few flakes alone could all sit where the ground already looks the same (#520). */
  const SAMPLES = 6;
  const withTiles = new Map<string, Array<{ at: { x: number; y: number; png: string }[]; scroll: number }>>();
  for (const kind of ['cell', 'page']) {
    const tiles = page.locator(`canvas[data-kb-landing="${kind}"]`);
    expect(await tiles.count(), `${kind} tiles`).toBeGreaterThan(0);
    const groups: Array<{ at: { x: number; y: number; png: string }[]; scroll: number }> = [];
    let pooled = 0;
    for (let k = 0; k < await tiles.count() && pooled < SAMPLES; k++) {
      const tile = tiles.nth(k);
      await tile.evaluate((t) => { t.scrollIntoView({ block: 'center' }); });
      await page.waitForTimeout(600);
      const points = await tile.evaluate((t: HTMLCanvasElement, n: number) => {
        const r = t.getBoundingClientRect();
        if (!t.width || !t.height) return [];
        const { data } = t.getContext('2d')!.getImageData(0, 0, t.width, t.height);
        const painted: { p: number; a: number }[] = [];
        for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) painted.push({ p: i >> 2, a: data[i]! });
        painted.sort((u, v) => v.a - u.a);
        const out: { x: number; y: number }[] = [];
        for (const { p } of painted) {
          const x = r.left + ((p % t.width) / t.width) * r.width, y = r.top + (Math.floor(p / t.width) / t.height) * r.height;
          if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
          if (out.every((o) => Math.hypot(o.x - x, o.y - y) > 14)) out.push({ x, y });
          if (out.length >= n) break;
        }
        return out;
      }, SAMPLES - pooled);
      if (!points.length) continue;
      const at = [];
      for (const q of points) at.push({ ...q, png: await shot(page, q.x, q.y) });
      groups.push({ at, scroll: await page.evaluate(() => window.scrollY) });
      pooled += points.length;
    }
    expect(pooled, `painted flakes on the ${kind}'s tiles`).toBeGreaterThan(0);
    withTiles.set(kind, groups);
    /* A scroll over landed glitter draws no tile. */
    const draws0 = await page.evaluate(() => window.__kbLanding!.draws());
    await page.evaluate(() => { window.scrollBy(0, 30); });
    await nextFrame(page); await nextFrame(page); await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__kbLanding!.draws()), 'tile draws over a scroll').toBe(draws0);
  }
  /* (The page's CSP takes no injected style sheet; the style property is the CSSOM's.) */
  await page.evaluate(() => { document.querySelectorAll<HTMLElement>('canvas[data-kb-landing]').forEach((c) => { c.style.visibility = 'hidden'; }); });
  for (const [kind, groups] of withTiles) {
    let differ = 0, n = 0;
    for (const g of groups) {
      await page.evaluate((y) => { window.scrollTo(0, y); }, g.scroll);
      await nextFrame(page); await nextFrame(page);
      for (const q of g.at) { n++; if ((await shot(page, q.x, q.y)) !== q.png) differ++; }
    }
    expect(differ, `some of the ${kind}'s ${n} flakes' points, across ${groups.length} tiles, are not the ground's`).toBeGreaterThan(0);
  }
});

test('under reduced motion a fling lands nothing', async ({ page }) => {
  await seeded(page, 'still');
  await fling(page);
  await flick(page);
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
