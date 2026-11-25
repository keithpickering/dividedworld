import { expect, test, type Page } from '@playwright/test';
import { DEPTH, HALF } from '../instances/divided-world/ui/steel-chair/body.ts';
import { GIVE, INSET, K, roomHeightOf, Z_FRONT } from '../instances/divided-world/ui/steel-chair/chair.ts';
import { DENT_SCALE, dentHeight, dentShade, dentShape } from '../instances/divided-world/ui/steel-chair/dent.ts';
import { pageViolations } from './axe.ts';

/** The room a post of chairs keeps: the stories' plays have ids that roll chairs. */
const ROOM_HEIGHT = roomHeightOf([]);

/**
 * Steel Chair as a browser draws it (docs/plans/2026-11-15-steel-chair-plan.md, Task 7, as amended: the chair's world is the post's content
 * area, `.kb-act-main`, the bordered box that holds the words; its borders are the walls and its floor). The stories are
 * instances/divided-world/ui/steel-chair/Chair.board.stories.tsx. A throw is drawn when the post's middle has been in view for 300 ms, lands,
 * tips and sleeps; each test waits for the chairs to be asleep (`data-rest`) and then measures what the browser laid out: where the chair's
 * drawn box lies against the content area's borders, where the floor's room is, that no word is under a chair, that the frame loop has
 * stopped, and that the Lens and a scroll away and back run it again somewhere else.
 *
 * The geometry (chair.ts): the world is drawn in an oblique view, so the floor recedes UP the screen the farther back it is. A chair is
 * therefore always inside the content area's padding box (the side walls are the borders at every depth, and the floor's front is the bottom
 * border), and its lowest drawn point is on the border only when it rests at the very front. A body sleeps only while it lies low (body.ts
 * REST_RISE: no corner higher than three flat chairs and a chair across them above the floor); one that goes quiet standing on an end or
 * leaning is nudged and falls over. So every chair at rest, whole box included, is drawn no higher than ROOM_HEIGHT above the bottom border
 * (the room the content area keeps, derived in chair.ts), covers no line of words and does not reach the reactions row.
 *
 * Why most seeds are pinned. Each run draws its throws from a generator seeded by `crypto.getRandomValues` (Effect.tsx `freshSeed`), and the
 * geometry is checked on the rests one run happened to make, and the nudge of a body that goes quiet high (body.ts) is drawn from a seeded
 * generator, so a CI run would test a different set of rests each time. So every test replaces that call with a counter over a short list of
 * seeds, the nth run of a page getting the nth seed. The seeds were chosen by trying 20 candidates for each page layout and keeping ones whose
 * rests are ordinary: every chair under the room, none overlapping another. Two runs in one test still get different seeds, so "the dent's
 * place changes" still means something.
 *
 * Why two poses are found, not pinned. Where a chair lands is a function of the seed AND the content area's measured size and the text's
 * rects, which differ by platform (fonts): a seed that stacks two chairs, or stands one up, on one machine does not on another. The two tests
 * that need such a pose (a chair on another, a chair that stood up and fell) scan seeds 1, 2, 3, ... on the page they will run on (`findSeed`),
 * under reduced motion, whose picture is drawn at once and is exactly the rest the animated run ends in for the same seed (Effect.test.tsx),
 * until the pose is there, and fail if none of the first SCAN_SEEDS has it. The pose of the second is a chair that took a nudge, which the
 * effect writes on the chair as `data-nudges`; a rest alone does not show it.
 *
 * `KB_POISON` (environment, default none) plants one defect back by hand so that a run shows a test red: `clip` (the foil test, with-fab only):
 * the chair's host gets the old filter, its region grown back to the words box, which clips the foil to it; `trap` (the signature test, with-fab
 * only): the element that holds Fab's host gets the area's filter, which holds the foil in a stacking context over the signature; `inherit` (the
 * nested-area test): the nested content area takes the post's bend properties again.
 */
test.use({ bypassCSP: true });

/** What a scan puts at the start of `window.name` to give the next load its seed. */
const SEED_NAME = 'kb-seeds:';
const STORY = (name: string) => `/?fixture=boards&story=boards-25-steel-chair--${name}`;

/** A pixel's rounding, and the half pixel the plan allows at a border. */
const ROUND = 1;
const EDGE = 0.5;
/** The longest a throw is waited for: a slow runner at 20 fps runs the capped simulation (4 steps a frame) at about two thirds speed. */
const REST_MS = 10_000;

/** The seeds each page layout's runs are given, in order (see above). One-light and the reduced story share a layout, and so seeds. */
const SEEDS = {
  'one-light': [101, 104],
  'one-dark': [101, 104],
  reduced: [101],
  'short-post': [101],
  /* Three dents on one line. The tight case (this seed, 172) has two dents over the line and overlapping each other (their centers 15 px apart at
     the closest), the nearer two with the line at 0.59 and 0.72 of their radii from their centers; the spread case (SPREAD_SEED, 158) has the
     dents' centers 70 px apart at the closest, one of them over the line and shading it (the line at 0.63 of its radius). Found by running seeds 1 to
     200 on the widened hit zone (dent.ts `hitZone`), the stepped throws (Effect.tsx) and the content area's 22.5em body, re-pinned (they were 1 and
     46) when the dent became one that fills its box (dent.ts `SPREAD`): the new dent's shade is in its bowl and not at its box's rim, so a seed
     shades the line only if the line lies inside a bowl, and a seed is a fixture and not a bound. Of the 200 seeds 22 shade the line by more than
     25 levels (the bound below), 7 by 50 or more; of those that also meet each case's own conditions the most-shaded are taken. See the two tests. */
  'short-three': [172],
  three: [101],
  phone: [113],
  'with-fab': [101],
  'fab-after': [101],
} as const;
/** The short-three layout's second pinned seed: the spread case. */
const SPREAD_SEED = 158;
type Story = 'one-light' | 'one-dark' | 'reduced' | 'short-post' | 'short-three' | 'three' | 'with-fab' | 'fab-after';

/** The post that wears the card: its content area (the world) and its parts. */
const area = (page: Page) => page.locator('.kb-act-main:has(.dw-chair)').first();
const chairs = (page: Page) => area(page).locator('.dw-chair-group');
const dents = (page: Page) => area(page).locator('.dw-chair-dents .dw-chair-dent');

/** Opens a story with its pinned seeds, the post in view, and starts counting the frames the page asks for. */
async function open(page: Page, name: Story, size = { width: 1280, height: 760 }, seeds: readonly number[] = SEEDS[name]) {
  await page.setViewportSize(size);
  await page.addInitScript(({ given, tag }: { given: readonly number[]; tag: string }) => {
    /* A scan (`findSeed`) re-seeds the page by naming the window, which survives a reload; otherwise the test's own list is used. */
    const list: readonly number[] = window.name.startsWith(tag) ? JSON.parse(window.name.slice(tag.length)) : given;
    const w = window as unknown as { __frames: number; __seed: number };
    w.__frames = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb: FrameRequestCallback) => { w.__frames++; return raf(cb); };
    /* A run's seed is the one value read as `getRandomValues(new Uint32Array(1))`; any other read is the page's own and is left alone. */
    const real = crypto.getRandomValues.bind(crypto);
    let runs = 0;
    crypto.getRandomValues = ((a: ArrayBufferView) => {
      if (a instanceof Uint32Array && a.length === 1) { a[0] = list[runs++ % list.length]!; w.__seed = a[0]; return a; }
      return real(a as Uint8Array);
    }) as typeof crypto.getRandomValues;
  }, { given: seeds, tag: SEED_NAME });
  await page.goto(STORY(name));
  await expect(page.locator('.dw-chair').first()).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
  await area(page).scrollIntoViewIfNeeded();
}

/** Waits until `n` chairs are drawn and every one is asleep. */
async function atRest(page: Page, n: number, timeout = REST_MS) {
  await expect.poll(() => page.evaluate((count) => {
    const groups = [...document.querySelectorAll('.kb-act-main .dw-chair-group')];
    return groups.length === count && groups.every((g) => g.hasAttribute('data-rest'));
  }, n), { timeout, message: `${n} chair(s) drawn and asleep` }).toBe(true);
}

interface Box { left: number; top: number; right: number; bottom: number }
interface Measure {
  /** The content area's padding box (inside its borders), in the window. */
  readonly area: Box;
  /** Each chair's drawn box: the union of its pieces' boxes, in the window. */
  readonly chairs: Box[];
  /**
   * The room: the `::after` the stylesheet adds to the content area, its computed size, and the gap between the last real child and the
   * content's end.
   */
  readonly room: { display: string; height: number; gap: number; paddingBottom: number };
  /** Every line of the post's words, in the window. */
  readonly lines: Box[];
}
const measure = (page: Page): Promise<Measure> => page.evaluate(() => {
  const box = document.querySelector<HTMLElement>('.kb-act-main:has(.dw-chair)')!;
  const r = box.getBoundingClientRect();
  const inner = {
    left: r.left + box.clientLeft, top: r.top + box.clientTop,
    right: r.left + box.clientLeft + box.clientWidth, bottom: r.top + box.clientTop + box.clientHeight,
  };
  const chairs = [...box.querySelectorAll<HTMLElement>('.dw-chair-group')].map((g) => {
    const rects = [...g.querySelectorAll('.dw-chair-piece')].map((p) => p.getBoundingClientRect());
    return {
      left: Math.min(...rects.map((x) => x.left)), top: Math.min(...rects.map((x) => x.top)),
      right: Math.max(...rects.map((x) => x.right)), bottom: Math.max(...rects.map((x) => x.bottom)),
    };
  });
  const after = getComputedStyle(box, '::after');
  const style = getComputedStyle(box);
  /* The last box that takes room in the flow: the content area's last child that is not absolutely placed (the effect's layers are inside
     its host). */
  const last = [...box.children].filter((c) => getComputedStyle(c).position !== 'absolute').at(-1)!;
  const contentBottom = inner.bottom - parseFloat(style.paddingBottom);
  const lines: Box[] = [];
  const walker = document.createTreeWalker(box.querySelector('[data-kb-words-box]')!, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const q of range.getClientRects()) {
      if (q.width > 0 && q.height > 0) lines.push({ left: q.left, top: q.top, right: q.right, bottom: q.bottom });
    }
  }
  const room = {
    display: after.display, height: parseFloat(after.height), gap: contentBottom - last.getBoundingClientRect().bottom,
    paddingBottom: parseFloat(style.paddingBottom),
  };
  return { area: inner, chairs, room, lines };
});

/** Every resting chair's drawn box lies inside the content area's padding box, half a pixel allowed at a border. */
function inside(m: Measure) {
  expect(m.chairs.length).toBeGreaterThan(0);
  for (const c of m.chairs) {
    expect(c.left, 'chair left').toBeGreaterThanOrEqual(m.area.left - EDGE);
    expect(c.right, 'chair right').toBeLessThanOrEqual(m.area.right + EDGE);
    expect(c.top, 'chair top').toBeGreaterThanOrEqual(m.area.top - EDGE);
    expect(c.bottom, 'chair bottom: no lower than the bottom border').toBeLessThanOrEqual(m.area.bottom + EDGE);
  }
}

/**
 * Each chair's lowest drawn point is no lower than the border, and its top is no higher than the room: ROOM_HEIGHT above the bottom border
 * (a pixel's rounding allowed), whichever way it rests, on the floor or on another chair.
 */
function onTheFloor(m: Measure) {
  for (const [i, c] of m.chairs.entries()) {
    expect(m.area.bottom - c.bottom, `chair ${i}: lowest point above the bottom border`).toBeGreaterThanOrEqual(-EDGE);
    expect(m.area.bottom - c.top, `chair ${i}: top above the bottom border, the room being ${ROOM_HEIGHT}`).toBeLessThanOrEqual(ROOM_HEIGHT + ROUND);
  }
}

/**
 * The room is the content area's last ROOM_HEIGHT px above its bottom padding: a block `::after` of that height, with at least that much between
 * the last box and the content's end.
 */
function roomIsLast(m: Measure) {
  expect(m.room.display).toBe('block');
  expect(m.room.height).toBeCloseTo(ROOM_HEIGHT, 0);
  expect(m.room.gap, 'room left between the last box and the bottom of the content').toBeGreaterThanOrEqual(ROOM_HEIGHT - ROUND);
}

/**
 * No word is under a chair: each chair's whole drawn box covers no line of words.
 * The room is the height of the tallest rest (chair.ts ROOM_HEIGHT), so the words end above the tallest chair's top.
 */
function noWordsUnderChairs(m: Measure) {
  for (const c of m.chairs) {
    const covered = m.lines.filter((l) => l.left < c.right && l.right > c.left && l.top < c.bottom && l.bottom > c.top);
    expect(covered, `lines under the chair's box ${JSON.stringify(c)}`).toEqual([]);
  }
}

const frames = (page: Page) => page.evaluate(() => (window as unknown as { __frames: number }).__frames);

/** The frames the page has asked for, over `ms` of waiting. */
async function framesOver(page: Page, ms: number): Promise<number> {
  const before = await frames(page);
  await page.waitForTimeout(ms);
  return (await frames(page)) - before;
}

/**
 * The frames asked for over `ms` once the page is truly quiet: the fonts are in, the chairs sleep, and the loop has asked for nothing over
 * 300 ms. A resize observer firing late (a font arriving after the first layout) wakes the world once more and lets it rest again, and that
 * is not a loop that never stops, so it is waited out before the count is begun.
 */
async function framesAfterRest(page: Page, n: number, ms = 700): Promise<number> {
  await page.evaluate(() => document.fonts.ready);
  await atRest(page, n);
  let before = await frames(page);
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(300);
    const now = await frames(page);
    if (now === before) break;
    before = now;
  }
  await atRest(page, n);
  return framesOver(page, ms);
}

/** Where the first dent's shading stands, in the content area's px. */
const dentAt = (page: Page) => dents(page).first().evaluate((el) => `${(el as HTMLElement).style.left},${(el as HTMLElement).style.top}`);

test('one-light: a dent and a chair, the chair inside the content area, on or just above its bottom border, and no frame asked for once it rests', async ({ page }) => {
  await open(page, 'one-light');
  await atRest(page, 1);
  /* First, so that a geometry failure below cannot skip it. */
  expect(await framesAfterRest(page, 1), 'frames asked for after the chair rests').toBe(0);
  await expect(dents(page)).toHaveCount(1);
  await expect(chairs(page)).toHaveCount(1);
  const m = await measure(page);
  inside(m);
  onTheFloor(m);
});

test('one-light: the room is the last ROOM_HEIGHT px of the content area, above its bottom padding', async ({ page }) => {
  await open(page, 'one-light');
  await atRest(page, 1);
  roomIsLast(await measure(page));
});

test('one-light: every word is still in the page\'s text, selectable, and none is under a chair', async ({ page }) => {
  await open(page, 'one-light');
  await atRest(page, 1);
  await expect(page.getByText('The best driver in the entire series is Luigi.').first()).toBeVisible();
  const read = await area(page).evaluate((box) => {
    const words = box.querySelector('[data-kb-words-box]')!;
    const range = document.createRange();
    range.selectNodeContents(words);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const selected = selection.toString();
    selection.removeAllRanges();
    return { text: words.textContent ?? '', selected, userSelect: getComputedStyle(words).userSelect };
  });
  const sentences = ['The best driver in the entire series is Luigi', 'Rainbow Road at two in the morning', 'Thank you for coming to my talk'];
  for (const w of sentences) {
    expect(read.text).toContain(w);
    expect(read.selected.replace(/\s+/gu, ' ')).toContain(w);
  }
  expect(read.userSelect).not.toBe('none');
  noWordsUnderChairs(await measure(page));
});

test('three: three dents, three chairs at rest, all inside the content area on its floor', async ({ page }) => {
  await open(page, 'three', { width: 1280, height: 900 });
  await atRest(page, 3);
  expect(await framesAfterRest(page, 3), 'frames asked for after the chairs rest').toBe(0);
  await expect(dents(page)).toHaveCount(3);
  const m = await measure(page);
  expect(m.chairs).toHaveLength(3);
  inside(m);
  onTheFloor(m);
  roomIsLast(m);
  noWordsUnderChairs(m);
});

test('scrolling the post out of view and back runs it again, the dent in another place', async ({ page }) => {
  await open(page, 'one-light', { width: 1280, height: 600 });
  await atRest(page, 1);
  const first = await dentAt(page);
  /* The thread is short: a tall block after it gives the post somewhere to leave the view to. */
  await page.evaluate(() => {
    const s = document.createElement('div');
    s.id = 'chair-spacer';
    s.style.cssText = 'height:4000px';
    document.body.append(s);
  });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(chairs(page)).toHaveCount(0);
  await expect(dents(page)).toHaveCount(0);
  await area(page).scrollIntoViewIfNeeded();
  await area(page).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await atRest(page, 1);
  await expect(dents(page)).toHaveCount(1);
  expect(await dentAt(page), 'the dent\'s place').not.toBe(first);
  const m = await measure(page);
  inside(m);
  onTheFloor(m);
});

test('the Lens opens from the card\'s mark, says Dented by a chair, and Throw again runs it again', async ({ page }) => {
  await open(page, 'one-light');
  await atRest(page, 1);
  const first = await dentAt(page);
  await page.getByRole('button', { name: /Steel Chair/u }).first().click();
  const lens = page.getByRole('dialog');
  await expect(lens).toBeVisible();
  await expect(lens.getByText('Dented by a chair')).toBeVisible();
  const again = lens.getByRole('button', { name: 'Throw again' });
  await expect(again).toBeVisible();
  await again.click();
  await expect.poll(
    async () => (await dents(page).count()) === 1 && (await dentAt(page)) !== first,
    { timeout: REST_MS, message: 'a new dent in another place' },
  ).toBe(true);
  await atRest(page, 1);
  const m = await measure(page);
  inside(m);
  onTheFloor(m);
});

test('reduced: the dent and the resting chair are there on first paint and nothing moves', async ({ page }) => {
  await open(page, 'reduced');
  await atRest(page, 1, 2000);
  await expect(dents(page)).toHaveCount(1);
  const was = await chairs(page).first().evaluate((el) => (el as HTMLElement).style.transform);
  expect(await framesOver(page, 700), 'frames asked for').toBe(0);
  expect(await chairs(page).first().evaluate((el) => (el as HTMLElement).style.transform)).toBe(was);
  expect(await area(page).locator('[data-dw-chair-shake]').count()).toBe(0);
  const m = await measure(page);
  inside(m);
  onTheFloor(m);
});

test('short-post: the host is as tall as its words, the content area holds the room, the chair rests inside it and the dent is within a diameter of the text', async ({ page }) => {
  await open(page, 'short-post');
  await atRest(page, 1);
  expect(await framesAfterRest(page, 1), 'frames asked for after the chair rests').toBe(0);
  const rows = await area(page).evaluate((box) => {
    const words = box.querySelector('[data-kb-words-box]')!.getBoundingClientRect();
    const host = box.querySelector('.dw-chair')!.getBoundingClientRect();
    const inner = box.getBoundingClientRect();
    /* The text's own rects: a range over the wrapper's contents would add the border box of every element, as wide as the wrapper. */
    const rects: DOMRect[] = [];
    const walker = document.createTreeWalker(box.querySelector('[data-kb-words-box]')!, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(n);
      rects.push(...[...range.getClientRects()].filter((q) => q.width > 0 && q.height > 0));
    }
    const left = Math.min(...rects.map((q) => q.left)), right = Math.max(...rects.map((q) => q.right));
    const top = Math.min(...rects.map((q) => q.top)), bottom = Math.max(...rects.map((q) => q.bottom));
    const dent = box.querySelector<HTMLElement>('.dw-chair-dent')!;
    const d = dent.getBoundingClientRect();
    return {
      words: words.height, host: host.height, hostStrip: box.querySelector('.dw-chair-room')!.getBoundingClientRect().height,
      text: { left, right, top, bottom }, dent: { left: d.left, right: d.right, top: d.top, bottom: d.bottom },
      wordsWidth: words.width, areaLeft: inner.left, areaWidth: inner.width,
    };
  });
  /* The effect's own box is just its words: the room is the content area's, not a strip under them. */
  expect(Math.abs(rows.host - rows.words), `host ${rows.host} vs words ${rows.words}`).toBeLessThanOrEqual(ROUND);
  expect(rows.hostStrip, 'the strip in the host is hidden inside a content area').toBe(0);
  /* The words wrapper is as wide as the content area but the text is one short line: the dent is over the text and not beside it. */
  expect(rows.text.right - rows.text.left, 'the text is narrower than its wrapper').toBeLessThan(rows.wordsWidth / 2);
  /* The throw aims at a box grown around the short line (dent.ts `hitZone`): the dent's center may be up to a dent's diameter beside the line
     (so the dent may lie wholly next to it) or below it, and not above its top by more than a radius. */
  const reach = `dent ${JSON.stringify(rows.dent)} against the text ${JSON.stringify(rows.text)}`;
  const dw = rows.dent.right - rows.dent.left, dh = rows.dent.bottom - rows.dent.top;
  const cx = (rows.dent.left + rows.dent.right) / 2, cy = (rows.dent.top + rows.dent.bottom) / 2;
  expect(cx >= rows.text.left - dw - ROUND && cx <= rows.text.right + dw + ROUND && cy >= rows.text.top - dh / 2 - ROUND && cy <= rows.text.bottom + dh + ROUND, reach).toBe(true);
  const m = await measure(page);
  roomIsLast(m);
  inside(m);
  onTheFloor(m);
  /* The row is as tall as the author column makes it, as for any post: the room does not stretch it, it is part of what the content holds. */
  expect(m.area.bottom - m.area.top).toBeGreaterThan(rows.words + ROOM_HEIGHT);
});

/**
 * How many pixels of `clip` differ from its top left pixel (the post's background) by more than a faint amount: the ink of what is drawn
 * there. The screenshot is decoded in the page, which has a canvas (the test runner has no PNG decoder).
 */
async function inkIn(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<number> {
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (Math.abs(px[i]! - px[0]!) + Math.abs(px[i + 1]! - px[1]!) + Math.abs(px[i + 2]! - px[2]!) > 60) n++;
    }
    return n;
  }, png);
}

/**
 * A one-line post is the case where the filter's default region (10% of the wrapper's own box beyond it, a couple of px) is smaller than
 * the displacement (up to DENT_SCALE / 2 px either way), which can clip the glyphs the dent moves outside it. The region the effect sets is
 * checked as written (it covers the wrapper's box plus DENT_SCALE on every side), and then as drawn: with the shading and the chairs hidden,
 * the words are drawn with the shipped region and again with a region 100 px larger on every side, and the two pictures hold the same ink,
 * so the shipped region cuts nothing a larger one would show. (The browser's default region is drawn too, and what it cuts is only
 * reported: a seed that does not displace a glyph past it cannot tell the two regions apart.)
 */
test('short-post: the filter\'s region covers the wrapper and its displacement, and cuts no glyph a larger region would show', async ({ page }) => {
  await open(page, 'short-post');
  await atRest(page, 1);
  await page.evaluate(() => document.fonts.ready);
  const region = await area(page).evaluate((box) => {
    const words = box.querySelector<HTMLElement>('[data-kb-words-box]')!;
    const filter = box.querySelector('filter')!;
    const num = (name: string) => Number(filter.getAttribute(name));
    const w = words.getBoundingClientRect();
    const a = box.getBoundingClientRect();
    return {
      units: filter.getAttribute('filterUnits'), scale: Number(filter.querySelector('feDisplacementMap')!.getAttribute('scale')),
      x: num('x'), y: num('y'), width: num('width'), height: num('height'),
      box: { left: w.left, top: w.top, width: words.offsetWidth, height: words.offsetHeight },
      area: {
        left: a.left + box.clientLeft, top: a.top + box.clientTop,
        right: a.left + box.clientLeft + box.clientWidth, bottom: a.top + box.clientTop + box.clientHeight,
      },
      filtered: getComputedStyle(words).filter,
    };
  });
  expect(region.filtered, 'the words carry the filter').toContain('url(');
  expect(region.units).toBe('userSpaceOnUse');
  expect(region.x, 'region starts left of the wrapper by the displacement').toBeLessThanOrEqual(-region.scale);
  expect(region.y, 'region starts above the wrapper by the displacement').toBeLessThanOrEqual(-region.scale);
  expect(region.x + region.width, 'region ends right of the wrapper by the displacement').toBeGreaterThanOrEqual(region.box.width + region.scale);
  expect(region.y + region.height, 'region ends below the wrapper by the displacement').toBeGreaterThanOrEqual(region.box.height + region.scale);
  /* The picture: the shading and the chairs are hidden, so what is left is the words and the post's own background. The clip is the wrapper's
     box and 60 px around it inside the content area (its border is ink too), which holds everything any of the three regions can draw. */
  await area(page).evaluate((box) => {
    for (const el of box.querySelectorAll<HTMLElement>('.dw-chair-dents, .dw-chair-layer')) el.style.visibility = 'hidden';
  });
  const left = Math.max(region.area.left + 1, region.box.left - 60), top = Math.max(region.area.top + 1, region.box.top - 60);
  const right = Math.min(region.area.right - 1, region.box.left + region.box.width + 60);
  const bottom = Math.min(region.area.bottom - 1, region.box.top + region.box.height + 60);
  const clip = { x: left, y: top, width: right - left, height: bottom - top };
  const setRegion = (x: number | null, y: number | null, width: number | null, height: number | null) => area(page).evaluate((box, r) => {
    const filter = box.querySelector('filter')!;
    for (const [name, v] of [['x', r[0]], ['y', r[1]], ['width', r[2]], ['height', r[3]]] as const) {
      if (v === null) filter.removeAttribute(name); else filter.setAttribute(name, String(v));
    }
    if (r[0] === null) filter.removeAttribute('filterUnits'); else filter.setAttribute('filterUnits', 'userSpaceOnUse');
    return new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
  }, [x, y, width, height] as const);
  const shipped = await inkIn(page, clip);
  await setRegion(-100, -100, region.box.width + 200, region.box.height + 200);
  const larger = await inkIn(page, clip);
  await setRegion(null, null, null, null);
  const byDefault = await inkIn(page, clip);
  const inks = `shipped region ${shipped}, larger region ${larger}, the browser's default region ${byDefault}`;
  test.info().annotations.push({ type: 'ink', description: inks });
  expect(shipped, 'the words are in the picture').toBeGreaterThan(50);
  expect(shipped, `ink with the shipped region against a region 100 px larger: ${inks}`).toBeGreaterThanOrEqual(larger * 0.99);
});

/** The row's band, as the page lays it out: its own height across the whole content area (a chair reaching its height anywhere is in its way). */
async function reactionsRow(page: Page, m: Measure) {
  const row = await area(page).locator('.kb-reactions').first().evaluate((el, m) => {
    const r = el.getBoundingClientRect();
    return { left: m.area.left, top: r.top, right: m.area.right, bottom: r.bottom, height: r.height };
  }, m);
  expect(row.height, 'the reactions row (the + React tile and the others, full width) was found').toBeGreaterThan(0);
  return row;
}

/** Every chair's whole drawn box covers no line of words and does not meet the reactions row, and its top is under the room. */
async function clearOfWordsAndRow(page: Page, m: Measure) {
  const row = await reactionsRow(page, m);
  noWordsUnderChairs(m);
  for (const c of m.chairs) {
    const touches = c.left < row.right && c.right > row.left && c.top < row.bottom && c.bottom > row.top;
    expect(touches, `the chair's box ${JSON.stringify(c)} against the reactions row ${JSON.stringify(row)}`).toBe(false);
  }
  onTheFloor(m);
  inside(m);
}

/**
 * The highest a chair lying flat on the floor can reach alone, px above the border: its 8 px thickness and, at the very back of the floor with
 * its long side along z, the oblique view's lift of its far end (chair.ts: K for each px of depth) and the INSET the border lies below the
 * world. A chair drawn higher than this is on another chair (or leaning on one).
 */
const FLAT_ALONE = INSET + 2 * HALF[2] + K * (Z_FRONT + DEPTH + GIVE + HALF[1]);

/** How many seeds a scan tries, from 1, before it gives up (the poses it looks for turn up in a few percent of seeds). */
const SCAN_SEEDS = 300;
/**
 * Measured on the development machine: a scan's first run is up at about 2 s and each further run takes about 0.15 s (a full 300 seeds, 45 s);
 * the animated load and its rest take about 3 s (the cap, REST_MS, is 10 s). SCAN_MS is twice a full scan; a scan that has not found its pose by
 * then throws its own message, before the test's timeout does. TEST_MS is the scan, then the animated load, REST_MS for its rest, and 20 s over.
 */
const SCAN_MS = 90_000;
const TEST_MS = SCAN_MS + REST_MS + 40_000;

/** The content area's and the words' boxes in the window (the layout a pose depends on), measured on whatever the page now shows. */
const layoutOf = (page: Page) => page.evaluate(() => {
  const box = document.querySelector<HTMLElement>('.kb-act-main:has(.dw-chair)')!;
  const words = box.querySelector<HTMLElement>('[data-kb-words-box]')!;
  const rect = (e: Element) => { const r = e.getBoundingClientRect(); return { left: r.left + scrollX, top: r.top + scrollY, width: r.width, height: r.height }; };
  return { area: rect(box), words: rect(words), client: [box.clientWidth, box.clientHeight], viewport: [document.documentElement.clientWidth, innerWidth] };
});
type Layout = Awaited<ReturnType<typeof layoutOf>>;

/**
 * Gives every load of the page below a tall spacer, so it can scroll away from the post and back, at the same layout (the same scrollbar) in a
 * scan and in the animated run that follows it. It is added before the story's first run, not after.
 */
async function addSpacer(page: Page) {
  await page.addInitScript(() => {
    const add = () => {
      const s = document.createElement('div');
      s.id = 'chair-spacer';
      s.style.cssText = 'height:4000px';
      document.body.append(s);
    };
    if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
  });
}

/** The layout the scan measured, kept by `findSeed` for the animated load that follows to be compared against. */
const scanLayouts = new WeakMap<Page, Layout>();

/** Gives the next load of the page its seed, the way `open`'s init script reads it, and loads the story again with the post in view. */
async function loadWith(page: Page, name: Story, seed: number) {
  await page.evaluate(([tag, s]) => { window.name = `${tag}${JSON.stringify([s])}`; }, [SEED_NAME, seed] as const);
  /* The story's address, not a reload: the page rewrites its own address once it has loaded the fixture. */
  await page.goto(STORY(name));
  await expect(page.locator('.dw-chair').first()).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
  await area(page).scrollIntoViewIfNeeded();
  /* The pose was found on the scan's layout; on another one it says nothing. */
  const scanned = scanLayouts.get(page);
  if (scanned) expect(await layoutOf(page), 'the animated load has the layout the scan found the seed on (content area and words)').toEqual(scanned);
}

/**
 * Finds a seed whose run makes the pose `pose` asks for, on this machine's layout. The story opens under reduced motion, whose picture is drawn
 * at once and is the rest the animated run ends in for the same seed (Effect.test.tsx), with seeds `after + 1` to SCAN_SEEDS queued as its runs'
 * seeds; and each further run is made without loading the page again, by scrolling the post out of view and back (a run's seed is the next
 * in the queue), until `pose` is true of what the page measures. None in the queue, or none before `budgetMs` has passed (so that this message
 * comes before the test's own timeout), is a failure that says how many were tried. The page is left on the run found, and the seed is
 * returned. A pinned seed cannot do this: where a chair lands depends on the content area's size and the text's rects, which differ by platform.
 */
async function findSeed(
  page: Page, name: Story, n: number, pose: (m: Measure, nudges: number[]) => boolean, after = 0, size?: { width: number; height: number },
  budgetMs = SCAN_MS,
): Promise<number> {
  const deadline = Date.now() + budgetMs;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  /* A name left by `loadWith` would give every run the one seed it holds. */
  await page.evaluate(() => { window.name = ''; });
  const queue = Array.from({ length: SCAN_SEEDS - after }, (_, i) => after + 1 + i);
  if (!scanLayouts.has(page)) await addSpacer(page);
  await open(page, name, size, queue);
  let tried = 0;
  for (;;) {
    await atRest(page, n, 2000);
    const nudges = await chairs(page).evaluateAll((gs) => gs.map((g) => Number(g.getAttribute('data-nudges'))));
    const seed = await page.evaluate(() => (window as unknown as { __seed: number }).__seed);
    tried++;
    if (pose(await measure(page), nudges)) { scanLayouts.set(page, await layoutOf(page)); return seed; }
    if (seed >= SCAN_SEEDS) throw new Error(`no seed from ${after + 1} to ${SCAN_SEEDS} makes the pose "${name}" asks for on this layout`);
    if (Date.now() > deadline) throw new Error(`no seed from ${after + 1} to ${seed} (${tried} tried in ${budgetMs} ms) makes the pose "${name}" asks for on this layout`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(chairs(page)).toHaveCount(0);
    await area(page).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  }
}

/**
 * A chair that comes to rest on another is the tallest rest the game keeps (body.ts REST_RISE). The seed is found by scanning (above) for one in
 * which one does: its top is higher than a chair lying alone can reach, FLAT_ALONE. Then the page is loaded again with that seed in full motion,
 * and on the animated run's rest every chair's whole drawn box covers no line of words, does not meet the reactions row, and has its top under
 * the room; and a chair is on another, so this cannot pass by measuring nothing. (That the reduced picture is the animated run's rest is
 * Effect.test.tsx's; here it is the animated run that is measured.)
 */
test('three: a chair that rests on another covers no words, does not reach the reactions row, and is under the room', async ({ page }) => {
  test.setTimeout(TEST_MS);
  const highestOf = (m: Measure) => Math.max(...m.chairs.map((c) => m.area.bottom - c.top));
  const seed = await findSeed(page, 'three', 3, (m) => highestOf(m) > FLAT_ALONE);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await loadWith(page, 'three', seed);
  await atRest(page, 3);
  test.info().annotations.push({ type: 'seed', description: `seed ${seed} stacks a chair` });
  const m = await measure(page);
  await clearOfWordsAndRow(page, m);
  expect(highestOf(m), `a chair came to rest on another on the animated run, its top higher than a chair lying alone reaches (${FLAT_ALONE})`).toBeGreaterThan(FLAT_ALONE);
});

/**
 * Starts counting, in the page and frame by frame, the longest run of consecutive frames in which the first chair is awake, higher than a flat
 * chair reaches (FLAT_ALONE) and has not moved by half a pixel since the frame before: a chair standing still (teetering, in its few tenths of
 * a second before the nudge takes it over). Counting frames in the page, and not sampling from the test every 100 ms, keeps the count from
 * depending on how busy the test runner is; a frame is at least one step of the world and at most four.
 */
async function watchStanding(page: Page) {
  await page.evaluate((flat) => {
    const w = window as unknown as { __stand: { best: number } };
    w.__stand = { best: 0 };
    let run = 0, last = NaN;
    const tick = () => {
      const box = document.querySelector<HTMLElement>('.kb-act-main:has(.dw-chair)');
      const g = box?.querySelector<HTMLElement>('.dw-chair-group');
      if (box && g) {
        const r = box.getBoundingClientRect();
        const bottom = r.top + box.clientTop + box.clientHeight;
        const top = bottom - Math.min(...[...g.querySelectorAll('.dw-chair-piece')].map((p) => p.getBoundingClientRect().top));
        if (!g.hasAttribute('data-rest') && Math.abs(top - last) < 0.5 && top > flat) w.__stand.best = Math.max(w.__stand.best, ++run); else run = 0;
        last = top;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, FLAT_ALONE);
}
const standingFrames = (page: Page) => page.evaluate(() => (window as unknown as { __stand: { best: number } }).__stand.best);
/** The fewest frames in a row that count as standing (about 0.1 s at 60 fps, and the same in steps of the world at the slowest frame rate the cap allows). */
const STOOD_FRAMES = 6;

/** How many nudged seeds are tried, at most, for one whose run in animation holds a chair still long enough to count (a brief teeter may not). */
const NUDGED_TRIES = 6;

/**
 * A chair that stands on its end or its narrow face is not let sleep: it teeters and falls over (body.ts nudge), and ends lying low inside the
 * room. A seed is found by scanning (above) for a single chair that took a nudge (`data-nudges`), the one thing the rest alone does not show;
 * then the page is loaded again with that seed in full motion, and the test watches for the chair standing still, awake, above what a flat chair
 * reaches before it fell, so it cannot pass on a run that never stood, and checks the rest as above. A nudge can come from a brief teeter too
 * short to count, and then the scan goes on to the next nudged seed (up to NUDGED_TRIES).
 */
test('one-light: a chair that stands up falls over, and ends lying inside the room, clear of the words and the reactions row', async ({ page }) => {
  /* Up to NUDGED_TRIES scans share one scan budget, and each animated run may take REST_MS. */
  test.setTimeout(SCAN_MS + NUDGED_TRIES * (REST_MS + 5_000) + 40_000);
  const scanUntil = Date.now() + SCAN_MS;
  let seed = 0, stood = 0;
  const tried: number[] = [];
  for (let i = 0; i < NUDGED_TRIES && stood < STOOD_FRAMES; i++) {
    seed = await findSeed(page, 'one-light', 1, (_m, nudges) => nudges[0]! >= 1, seed, undefined, Math.max(scanUntil - Date.now(), 1));
    tried.push(seed);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await loadWith(page, 'one-light', seed);
    await watchStanding(page);
    await atRest(page, 1);
    stood = await standingFrames(page);
  }
  test.info().annotations.push({ type: 'seed', description: `nudged seeds tried ${tried.join(', ')}; the chair stood ${stood} frames` });
  await clearOfWordsAndRow(page, await measure(page));
  expect(stood, `frames in a row the chair stood still above ${FLAT_ALONE.toFixed(0)} px before it fell, over the nudged seeds ${tried.join(', ')}`).toBeGreaterThanOrEqual(STOOD_FRAMES);
});

/** Opens a clip of the page as RGBA pixels (the screenshot is decoded in the page, which has a canvas). */
async function pixelsOf(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<{ width: number; height: number; px: number[] }> {
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    return { width: canvas.width, height: canvas.height, px: [...ctx.getImageData(0, 0, canvas.width, canvas.height).data] };
  }, png);
}
const luma = (px: number[], i: number) => 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
/** WCAG's relative luminance of an sRGB pixel. */
const relative = (px: number[], i: number) => {
  const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(px[i]!) + 0.7152 * f(px[i + 1]!) + 0.0722 * f(px[i + 2]!);
};

/** Each dent's box (the shading's ellipse) and the text's line box, in the window. */
async function shading(page: Page) {
  return area(page).evaluate((box) => {
    const dentRects = [...box.querySelectorAll<HTMLElement>('.dw-chair-dents .dw-chair-dent')].map((d) => {
      const r = d.getBoundingClientRect();
      return { play: d.dataset.play ?? '', left: r.left, top: r.top, width: r.width, height: r.height };
    });
    const walker = document.createTreeWalker(box.querySelector('[data-kb-words-box]')!, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    range.selectNodeContents(walker.nextNode()!);
    const t = range.getBoundingClientRect();
    const a = box.getBoundingClientRect();
    return {
      dents: dentRects, text: { left: t.left, top: t.top, right: t.right, bottom: t.bottom },
      area: { left: a.left + box.clientLeft, top: a.top + box.clientTop, right: a.left + box.clientLeft + box.clientWidth, bottom: a.top + box.clientTop + box.clientHeight },
      scale: Number(box.querySelector('feDisplacementMap')!.getAttribute('scale')),
    };
  });
}
type Dent = Awaited<ReturnType<typeof shading>>['dents'][number];
const center = (d: Dent) => ({ x: d.left + d.width / 2, y: d.top + d.height / 2 });
/** How far the ellipses overlap, by the mean radii: negative where the footprints are apart (a test of its own: the effect's rule is in dent.ts). */
const gap = (a: Dent, b: Dent) => Math.hypot(center(a).x - center(b).x, center(a).y - center(b).y) - ((a.width + a.height) / 4 + (b.width + b.height) / 4);

/** The shaded picture of a clip, and the same clip with the dents' layer hidden (the chairs are hidden in both: the line is what is measured). */
async function pair(page: Page, clip: { x: number; y: number; width: number; height: number }) {
  await area(page).evaluate((box) => { for (const el of box.querySelectorAll<HTMLElement>('.dw-chair-layer')) el.style.visibility = 'hidden'; });
  const shaded = await pixelsOf(page, clip);
  await area(page).evaluate((box) => { for (const el of box.querySelectorAll<HTMLElement>('.dw-chair-dents')) el.style.visibility = 'hidden'; });
  const bare = await pixelsOf(page, clip);
  await area(page).evaluate((box) => { for (const el of box.querySelectorAll<HTMLElement>('.dw-chair-dents')) el.style.visibility = ''; });
  return { shaded, bare };
}
/**
 * Whether each pixel of the BARE picture is plain background: one of the lumas (rounded) that at least 5% of the picture has. A glyph is a few
 * percent of a one-line clip and is thinly spread over many lumas; the post's background (and the page's, where a clip leaves the post) is not.
 */
function plain(px: number[]): boolean[] {
  const count = new Map<number, number>();
  const key = (i: number) => Math.round(luma(px, i) / 2);
  for (let i = 0; i < px.length; i += 4) count.set(key(i), (count.get(key(i)) ?? 0) + 1);
  const pixels = px.length / 4;
  return Array.from({ length: pixels }, (_, p) => (count.get(key(p * 4)) ?? 0) >= 0.05 * pixels);
}
/** The darkest the shading makes a pixel of plain background (one with no glyph in the bare picture), in levels of 255. */
function darkest(p: { shaded: { px: number[] }; bare: { px: number[] } }): number {
  let most = 0;
  const bg = plain(p.bare.px);
  for (let i = 0; i < p.bare.px.length; i += 4) if (bg[i / 4]) most = Math.max(most, luma(p.bare.px, i) - luma(p.shaded.px, i));
  return most;
}

/**
 * How dark the shading makes plain background at its deepest, as a fraction of the background: the lowest shaded luma over the bare luma of
 * the same pixel. One dent's shade is 128 of 255 at its darkest (a fraction of 0.50 of the post's own color, `multiply`), two added would be 0.00 to
 * 0.25, so this does not depend on the post's own color, as a difference in levels does.
 */
function deepest(p: { shaded: { px: number[] }; bare: { px: number[] } }): number {
  let low = 1;
  const bg = plain(p.bare.px);
  for (let i = 0; i < p.bare.px.length; i += 4) if (bg[i / 4] && luma(p.bare.px, i) > 100) low = Math.min(low, luma(p.shaded.px, i) / luma(p.bare.px, i));
  return low;
}

/**
 * The hard case: one line of words with three dents on it, run on two pinned throws. The tight one has two dents over the line and
 * overlapping each other; the spread one has the dents' centers far apart (the hit zone is wide on a short post, so the dents land beside
 * and below the line as well as on it) with at least one over the line, so the line still has shading to be read through. What is held in
 * both: (i) no crease element is drawn in the content area (a dent is a height map's shading, nothing else; this count guards against the removed crease layer coming back), (ii) the shading over the line is capped at what one lone dent
 * gives at its darkest (measured in the same test, from the one-dent story), however many overlap, (iii) the glyphs keep a contrast of
 * 4.5:1 against the shaded background, and the displacement keeps the ink within its line box plus what the filter's scale and the dents
 * allow. A tolerance of 6 levels of 255 is allowed on the cap, for the screenshot's rounding (the bound is kept from the first build).
 */
async function theLineCanBeRead(page: Page, seed: number, kind: 'tight' | 'spread') {
  /* Three full runs of the page in one test (the three-dent line, the one-dent story, the three-dent line again), each waiting for its chairs to
     sleep, so the default 30 s is not enough on a busy runner. */
  test.setTimeout(90_000);
  await open(page, 'short-three', undefined, [seed]);
  await atRest(page, 3);
  await page.evaluate(() => document.fonts.ready);
  const s = await shading(page);
  expect(s.dents).toHaveLength(3);
  const overlapping = s.dents.map((d, i) => s.dents.some((o, j) => j !== i && gap(d, o) < -8));
  const closest = Math.min(...s.dents.flatMap((d, i) => s.dents.slice(i + 1).map((o) => Math.hypot(center(d).x - center(o).x, center(d).y - center(o).y))));
  const overText = s.dents.map((d) => d.left < s.text.right && d.left + d.width > s.text.left && d.top < s.text.bottom && d.top + d.height > s.text.top);
  test.info().annotations.push({ type: kind, description: `closest two dent centers ${closest.toFixed(0)} px apart, ${overText.filter(Boolean).length} over the line` });
  if (kind === 'tight') {
    expect(overlapping.filter(Boolean).length, 'the tight seed has at least two dents overlapping').toBeGreaterThanOrEqual(2);
    expect(overText.filter(Boolean).length, 'the tight seed has at least two dents over the line').toBeGreaterThanOrEqual(2);
  } else {
    expect(closest, 'the spread seed keeps every pair of dent centers well apart').toBeGreaterThanOrEqual(60);
    expect(overText.filter(Boolean).length, 'the spread seed still has a dent over the line').toBeGreaterThanOrEqual(1);
  }
  /* (i) */
  expect(await area(page).locator('[class*="crease"]').count(), 'no crease element is in the content area').toBe(0);
  /* The line's box and its picture: a little air above and below, and as wide as the text. */
  const lineClip = { x: Math.floor(s.text.left), y: Math.floor(s.text.top - 2), width: Math.ceil(s.text.right - s.text.left) + 2, height: Math.ceil(s.text.bottom - s.text.top) + 4 };
  const three = await pair(page, lineClip);
  const peak3 = darkest(three);
  /* The line may sit near the edge of the dents (it is a thin strip at the top of a tall area), where one dent gives little and two added give
     little more, so the cap is also read where the dents are deepest: over the union of their boxes, inside the content area, with the
     light hidden so that only the shade layer (the dents' shade images combined by `darken`) is measured. Where two dents overlap at
     their deepest the darkness must still be one dent's darkest, and not the sum of two. */
  const onlyShade = (hide: boolean) => area(page).evaluate((box, h) => {
    for (const el of box.querySelectorAll<HTMLElement>('.dw-chair-glows')) el.style.visibility = h ? 'hidden' : '';
  }, hide);
  await onlyShade(true);
  const ux0 = Math.max(s.area.left + 1, Math.floor(Math.min(...s.dents.map((d) => d.left))));
  const uy0 = Math.max(s.area.top + 1, Math.floor(Math.min(...s.dents.map((d) => d.top))));
  const ux1 = Math.min(s.area.right - 1, Math.ceil(Math.max(...s.dents.map((d) => d.left + d.width))));
  const uy1 = Math.min(s.area.bottom - 1, Math.ceil(Math.max(...s.dents.map((d) => d.top + d.height))));
  const unionClip = { x: ux0, y: uy0, width: ux1 - ux0, height: uy1 - uy0 };
  const union = await pair(page, unionClip);
  const deepDents = deepest(union);
  /* Where dents overlap, the shade is the darker of the dents there (`darken`): each later dent's shade image is corrected against the earlier
     ones (dent.ts `capped`), so a dent read alone (the others hidden) is no longer its own shade and the alones' minimum is not the reference.
     The reference is made here instead, in Node: each dent's UNCAPPED shade gray, from its play's id (the dent's `data-play`) and its box, by
     dent.ts' pure functions (alpha is 255 less the gray), sampled bilinearly at each screenshot pixel's center (1 outside the box), and the
     least over the dents is the ratio the browser's union should show. The bound of 0.12 is the allowance for the screenshot's rounding and
     is kept from the first build. The grids are made at density 1, which is what the page's screenshots are drawn at. */
  const grays = s.dents.map((d) => {
    const w = Math.round(d.width), h = Math.round(d.height);
    const alpha = dentShade(dentHeight(dentShape(d.play), w, h), w, h);
    const g = new Float64Array(w * h);
    for (let k = 0; k < g.length; k++) g[k] = 255 - alpha[k * 4 + 3]!;
    return { d, w, h, g };
  });
  const grayAt = (e: (typeof grays)[number], px: number, py: number): number => {
    if (px < e.d.left || px > e.d.left + e.d.width || py < e.d.top || py > e.d.top + e.d.height) return 255;
    const x = Math.min(e.w - 1, Math.max(0, ((px - e.d.left) / e.d.width) * e.w - 0.5)), y = Math.min(e.h - 1, Math.max(0, ((py - e.d.top) / e.d.height) * e.h - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(e.w - 1, x0 + 1), y1 = Math.min(e.h - 1, y0 + 1), fx = x - x0, fy = y - y0;
    const top = e.g[y0 * e.w + x0]! * (1 - fx) + e.g[y0 * e.w + x1]! * fx, bottom = e.g[y1 * e.w + x0]! * (1 - fx) + e.g[y1 * e.w + x1]! * fx;
    return top * (1 - fy) + bottom * fy;
  };
  let worstGap = 0, overlapPixels = 0;
  const flat = plain(union.bare.px);
  for (let i = 0; i < union.bare.px.length; i += 4) {
    if (!flat[i / 4] || luma(union.bare.px, i) <= 100) continue;
    const p = i / 4, px = unionClip.x + (p % unionClip.width) + 0.5, py = unionClip.y + Math.floor(p / unionClip.width) + 0.5;
    const each = grays.map((e) => grayAt(e, px, py) / 255);
    if (each.filter((r) => r < 0.97).length >= 2) overlapPixels++;
    worstGap = Math.max(worstGap, Math.abs(luma(union.shaded.px, i) / luma(union.bare.px, i) - Math.min(...each)));
  }
  await onlyShade(false);

  /* One lone dent, from the one-dent story: the darkest the shading ever makes plain background (the whole dent is in the picture). */
  await open(page, 'short-post');
  await atRest(page, 1);
  await page.evaluate(() => document.fonts.ready);
  const one = await shading(page);
  expect(one.dents).toHaveLength(1);
  const d1 = one.dents[0]!;
  const clip1 = { x: Math.floor(Math.max(0, d1.left)), y: Math.floor(Math.max(0, d1.top)), width: Math.ceil(d1.width), height: Math.ceil(d1.height) };
  const pr1 = await pair(page, clip1);
  const lone = darkest(pr1);
  test.info().annotations.push({ type: 'darkness', description: `darkest background pixel over the three-dent line ${peak3.toFixed(0)}, deepest shade under all three dents ${deepDents.toFixed(2)} of the post's color, worst gap from the darker disc ${worstGap.toFixed(3)} over ${overlapPixels} overlapping pixels, one lone dent's darkest ${lone.toFixed(0)}` });
  expect(lone, 'a lone dent really darkens its background').toBeGreaterThan(40);
  /* (ii) */
  expect(peak3, 'the dents do shade the line (a cap on nothing proves nothing)').toBeGreaterThan(25);
  /* One dent takes the post to 0.50 of its color at its darkest; the tolerance is the screenshot's rounding and is kept from the first build. Added, two dents would be 0.25 or less. */
  expect(deepDents, 'the dents do shade the post where they lie').toBeLessThan(0.62);
  expect(worstGap, `where discs overlap the shade is the darker of them (the worst pixel is ${worstGap.toFixed(3)} off, over ${overlapPixels} overlapping pixels)`).toBeLessThanOrEqual(0.12);
  if (kind === 'tight') expect(overlapPixels, 'the tight seed has overlapping discs to compare').toBeGreaterThan(500);
  expect(deepDents, `the deepest shade under the three dents is ${deepDents.toFixed(2)} of the post's color: overlapping discs do not add (one disc is 0.50)`).toBeGreaterThanOrEqual(0.46);
  expect(peak3, `the darkest background on the three-dent line (${peak3.toFixed(0)}) against one lone dent's darkest (${lone.toFixed(0)})`).toBeLessThanOrEqual(lone + 6);

  /* (iii) the contrast of the glyphs against the shaded background, from the three-dent pictures. */
  let darkestGlyph = Infinity;
  const backgrounds: number[] = [];
  const bg3 = plain(three.bare.px);
  for (let i = 0; i < three.bare.px.length; i += 4) {
    darkestGlyph = Math.min(darkestGlyph, relative(three.shaded.px, i));
    if (bg3[i / 4]) backgrounds.push(relative(three.shaded.px, i));
  }
  backgrounds.sort((x, y) => x - y);
  const median = backgrounds[Math.floor(backgrounds.length / 2)]!;
  const ratio = (median + 0.05) / (darkestGlyph + 0.05);
  test.info().annotations.push({ type: 'contrast', description: `darkest glyph vs median shaded background ${ratio.toFixed(2)}:1` });
  expect(backgrounds.length, 'there is background between the glyphs').toBeGreaterThan(50);
  expect(ratio, `the darkest glyph against the median shaded background: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  /* And against the very darkest background pixel between the glyphs. */
  const worst = (backgrounds[0]! + 0.05) / (darkestGlyph + 0.05);
  expect(worst, `the darkest glyph against the darkest shaded background: ${worst.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);

  /* The displacement: each dent pushes at most scale/2 px either way, and they add, so the ink of the bare picture lies within the line's box
     plus 3 * scale / 2 px (and a pixel's rounding). */
  await open(page, 'short-three', undefined, [seed]);
  await atRest(page, 3);
  await page.evaluate(() => document.fonts.ready);
  const again = await shading(page);
  const reach = 3 * again.scale / 2 + 1;
  /* Inside the content area, with its other children (the reactions row) hidden: the line alone is in the picture. */
  await area(page).evaluate((box) => { for (const el of box.querySelectorAll<HTMLElement>(':scope > :not(.dw-chair)')) el.style.visibility = 'hidden'; });
  const x0 = Math.max(again.area.left + 1, Math.floor(again.text.left - reach - 12)), y0 = Math.max(again.area.top + 1, Math.floor(again.text.top - reach - 12));
  const wide = { x: x0, y: y0, width: Math.ceil(Math.min(again.area.right - 1, again.text.right + reach + 12) - x0), height: Math.ceil(Math.min(again.area.bottom - 1, again.text.bottom + reach + 12) - y0) };
  const bare = (await pair(page, wide)).bare;
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  const bareLuma = Math.max(...bare.px.filter((_, k) => k % 4 === 0));
  for (let i = 0; i < bare.px.length; i += 4) {
    if (luma(bare.px, i) >= bareLuma - 100) continue;
    const x = wide.x + ((i / 4) % bare.width), y = wide.y + Math.floor(i / 4 / bare.width);
    l = Math.min(l, x); r = Math.max(r, x + 1); t = Math.min(t, y); b = Math.max(b, y + 1);
  }
  expect(r, 'the line has ink').toBeGreaterThan(l);
  const box = `ink ${l},${t} to ${r},${b} in the line's box ${again.text.left.toFixed(0)},${again.text.top.toFixed(0)} to ${again.text.right.toFixed(0)},${again.text.bottom.toFixed(0)} plus ${reach}`;
  expect(l, box).toBeGreaterThanOrEqual(again.text.left - reach);
  expect(r, box).toBeLessThanOrEqual(again.text.right + reach);
  expect(t, box).toBeGreaterThanOrEqual(again.text.top - reach);
  expect(b, box).toBeLessThanOrEqual(again.text.bottom + reach);
  expect(DENT_SCALE, 'the filter carries the scale this test reads').toBe(again.scale);
}

test('short-three, tight: the one line can be read: no crease element, shading capped at one dent\'s, glyphs keep 4.5:1, ink stays near its line', async ({ page }) => {
  await theLineCanBeRead(page, SEEDS['short-three'][0], 'tight');
});

test('short-three, spread: dents land beside and below the line, and the line can still be read', async ({ page }) => {
  await theLineCanBeRead(page, SPREAD_SEED, 'spread');
});

/** On a post of little text the throws are spread beyond the line, and every dent's circle is inside the content area and above the room. */
for (const [kind, seed] of [['tight', SEEDS['short-three'][0]], ['spread', SPREAD_SEED]] as const) {
  test(`short-three, ${kind}: every dent lies inside the content area`, async ({ page }) => {
    await open(page, 'short-three', undefined, [seed]);
    await atRest(page, 3);
    const s = await shading(page);
    expect(s.dents).toHaveLength(3);
    s.dents.forEach((d, i) => {
      const where = `dent ${i} ${JSON.stringify(d)} in the area ${JSON.stringify(s.area)}`;
      expect(d.left, where).toBeGreaterThanOrEqual(s.area.left - 1);
      expect(d.top, where).toBeGreaterThanOrEqual(s.area.top - 1);
      expect(d.left + d.width, where).toBeLessThanOrEqual(s.area.right + 1);
      expect(d.top + d.height, where).toBeLessThanOrEqual(s.area.bottom + 1);
      /* The body is at least 22.5em tall (thread.css), so the hit zone fits above the floor's room, where the chairs lie: no dent reaches it. */
      expect(d.top + d.height, `${where}: above the room's top`).toBeLessThanOrEqual(s.area.bottom - ROOM_HEIGHT + 1);
    });
  });
}

/**
 * The shading draws no block (issue #768, plan Task 4, case 1), on the post Steel Chair and Feelin' Fab share: the four corners of each dent's box, 4 px
 * squares where the dent is flat and its images' alpha is 0, are the same pixels with the shading shown and hidden, within 2 levels of 255. Feelin' Fab's foil
 * is under the shading and is not still, so reduced motion is asked for (the foil is then drawn as it is and not moved on). Poison: the shade image made
 * opaque again (alpha 255, the gray kept) in dent.ts, whose corners are then the shade's gray block.
 */
test('with-fab: no block: the four corners of each dent\'s box are the same with the shading shown and hidden', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, 'with-fab');
  await atRest(page, 1);
  await expect(page.locator('.kb-act-main:has(.dw-chair) canvas.dw-fab-foil'), 'Feelin\' Fab\'s foil is on the post').toHaveCount(1);
  const s = await shading(page);
  expect(s.dents.length, 'a dent').toBeGreaterThan(0);
  await area(page).evaluate((box) => { for (const el of box.querySelectorAll<HTMLElement>('.dw-chair-layer')) el.style.visibility = 'hidden'; });
  const SQ = 4;
  for (const [i, d] of s.dents.entries()) {
    const corners = [[d.left, d.top], [d.left + d.width - SQ, d.top], [d.left, d.top + d.height - SQ], [d.left + d.width - SQ, d.top + d.height - SQ]] as const;
    for (const [k, [x, y]] of corners.entries()) {
      const clip = { x: Math.ceil(x), y: Math.ceil(y), width: SQ, height: SQ };
      const shown = (await pixelsOf(page, clip)).px;
      await area(page).evaluate((box) => { for (const el of box.querySelectorAll<HTMLElement>('.dw-chair-dents, .dw-chair-glows')) el.style.visibility = 'hidden'; });
      const hidden = (await pixelsOf(page, clip)).px;
      await area(page).evaluate((box) => { for (const el of box.querySelectorAll<HTMLElement>('.dw-chair-dents, .dw-chair-glows')) el.style.visibility = ''; });
      const worst = Math.max(...shown.map((v, j) => Math.abs(v - hidden[j]!)));
      expect(worst, `dent ${i}, corner ${k} (${JSON.stringify(clip)}): the shading changes a pixel there by ${worst} levels of 255`).toBeLessThanOrEqual(2);
    }
    const whole = { x: Math.ceil(d.left), y: Math.ceil(d.top), width: Math.floor(d.width) - 1, height: Math.floor(d.height) - 1 };
    const drawn = (await pixelsOf(page, whole)).px;
    await area(page).evaluate((box) => { for (const el of box.querySelectorAll<HTMLElement>('.dw-chair-dents, .dw-chair-glows')) el.style.visibility = 'hidden'; });
    const bare = (await pixelsOf(page, whole)).px;
    await area(page).evaluate((box) => { for (const el of box.querySelectorAll<HTMLElement>('.dw-chair-dents, .dw-chair-glows')) el.style.visibility = ''; });
    let most = 0;
    for (let j = 0; j < drawn.length; j++) most = Math.max(most, Math.abs(drawn[j]! - bare[j]!));
    expect(most, `dent ${i}: the dent is drawn: inside its box some pixel differs with the shading shown and hidden by more than 2 levels (the most is ${most})`).toBeGreaterThan(2);
  }
});

/**
 * The foil is whole and nothing is trapped (docs/plans/2026-11-23-dent-bend-plan.md, Task 3), on the post Steel Chair and Feelin' Fab share in each order
 * (`with-fab`: the chair played over a foil, so the chair's host holds Fab's; `fab-after`: a foil over a chair), under reduced motion (the foil holds still).
 * No element of the effect's carries a filter any more, so the chair's host neither clips the foil to the words' box nor makes a stacking context that
 * holds it above the signature. The chair's shading layers and chairs are hidden, so what is compared is the foil and the post. "Before the dent lands"
 * is the post with the bend taken off by a stylesheet (`bendOff`): reduced motion draws the dent on first paint, so there is no moment before it.
 *
 * Poisons (the defect itself, put back by hand; `KB_POISON=clip` or `KB_POISON=trap` in the environment does it, for the run that shows the test red).
 * `clip`: the chair's host gets the old filter (the words' filter, its region grown back to the words box), which clips the foil to it. `trap`: the
 * element that holds Fab's host gets `filter: url(#...-area)` (a region over the whole area), which holds the foil in a stacking context over the signature.
 * The clip and trap poisons can be red only on `with-fab`: on `fab-after` the foil is the outer effect, and the chair's host is inside Fab's, so it can
 * neither clip nor trap the foil. `fab-after` is a no-regression companion with no red run of its own.
 */
const POISON = process.env.KB_POISON ?? '';
const frames2 = (page: Page) => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));

/** The bend off (a stylesheet's `!important` beats the effect's inline properties) and on again. */
const bendOff = async (page: Page, off: boolean) => {
  await page.evaluate((on) => {
    document.getElementById('kb-test-no-bend')?.remove();
    if (on) {
      const style = document.createElement('style');
      style.id = 'kb-test-no-bend';
      style.textContent = '[data-kb-content-area], [data-kb-content-area] * { --kb-bend: none !important; --kb-bend-words: none !important; }';
      document.head.append(style);
    }
  }, off);
  await frames2(page);
};

/** The effect's layers hidden (or shown): the chair's shading and the chairs. */
const chairLayers = (page: Page, hidden: boolean) => area(page).evaluate((box, h) => {
  for (const el of box.querySelectorAll<HTMLElement>('.dw-chair-layer, .dw-chair-dents, .dw-chair-glows')) el.style.visibility = h ? 'hidden' : '';
}, hidden);

for (const name of ['with-fab', 'fab-after'] as const) {
  test.describe(`${name}: the foil and the bend`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      /* Tall enough that the HUD at the foot of the window is not over the post's bottom border. */
      await open(page, name, { width: 1440, height: 1120 });
      await atRest(page, 1);
      await expect(page.locator('.kb-act-main:has(.dw-chair) canvas.dw-fab-foil'), 'Feelin Fab\'s foil is on the post').toHaveCount(1);
      /* The post in the middle of the window, clear of the HUD at its foot. */
      await area(page).evaluate((box) => box.scrollIntoView({ block: 'center' }));
      await frames2(page);
      await expect(area(page).locator('.kb-signature'), 'the signature is drawn').toBeVisible();
      await chairLayers(page, true);
    });

    test('the foil is whole: five points of the content area outside the words\' box are the same before the dent lands and after', async ({ page }) => {
      const points = await area(page).evaluate((box) => {
        const a = box.getBoundingClientRect();
        const inner = { left: a.left + box.clientLeft, top: a.top + box.clientTop, right: a.left + box.clientLeft + box.clientWidth, bottom: a.top + box.clientTop + box.clientHeight };
        const walker = document.createTreeWalker(box.querySelector('[data-kb-words-box]')!, NodeFilter.SHOW_TEXT);
        let last: DOMRect | null = null;
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const q of range.getClientRects()) if (q.width > 0 && q.height > 0) last = q;
        }
        const sig = box.querySelector('.kb-signature')!.getBoundingClientRect();
        const wb = box.querySelector('[data-kb-words-box]')!.getBoundingClientRect();
        return { inner, last: last ? { right: last.right, top: last.top, bottom: last.bottom } : null, sigBottom: sig.bottom, words: { left: wb.left, top: wb.top, right: wb.right, bottom: wb.bottom }, viewport: window.innerHeight };
      });
      expect(points.last, 'the words have a last line').not.toBeNull();
      expect(points.inner.bottom + 1, 'the bottom border of the post is inside the window').toBeLessThanOrEqual(points.viewport);
      const w = points.inner.right - points.inner.left;
      /* The clip poison reaches only what lies inside the words' box, so every point is outside it: beside the words' box at the last line's height
         (the box ends before the area's right edge, or the point would be inside it), and below it. */
      const at = [
        { name: 'beside the last, short line', x: Math.min(points.inner.right - 4, points.words.right + 12), y: (points.last!.top + points.last!.bottom) / 2 },
        { name: 'near the bottom border, left', x: points.inner.left + w * 0.2, y: points.inner.bottom - 4 },
        { name: 'near the bottom border, middle', x: points.inner.left + w * 0.5, y: points.inner.bottom - 4 },
        { name: 'near the bottom border, right', x: points.inner.left + w * 0.8, y: points.inner.bottom - 4 },
        { name: 'under the signature', x: points.inner.left + w * 0.7, y: Math.min(points.inner.bottom - 4, points.sigBottom + 6) },
      ];
      for (const p of at) {
        const inside = p.x >= points.words.left && p.x <= points.words.right && p.y >= points.words.top && p.y <= points.words.bottom;
        expect(inside, `${p.name} (${Math.round(p.x)}, ${Math.round(p.y)}) lies outside the words' box ${JSON.stringify(points.words)}`).toBe(false);
      }
      const sample = async () => {
        const out: number[][] = [];
        for (const p of at) out.push((await pixelsOf(page, { x: Math.floor(p.x), y: Math.floor(p.y), width: 3, height: 3 })).px);
        return out;
      };
      await bendOff(page, true);
      const before = await sample();
      await bendOff(page, false);
      if (POISON === 'clip') {
        await area(page).evaluate((box) => {
          const host = box.querySelector<HTMLElement>('.dw-chair')!;
          const filter = box.querySelector('filter[id$="-words"]')!;
          const words = box.querySelector<HTMLElement>('[data-kb-words-box]')!;
          filter.setAttribute('x', '0'); filter.setAttribute('y', '0');
          filter.setAttribute('width', String(words.offsetWidth)); filter.setAttribute('height', String(words.offsetHeight));
          host.style.filter = `url(#${filter.id})`;
        });
        await frames2(page);
      }
      const after = await sample();
      /* The test can see the foil: with it hidden, most of the five points are another color (the post's ground). */
      await area(page).evaluate((box) => { for (const el of box.querySelectorAll<HTMLElement>('canvas.dw-fab-foil')) el.style.visibility = 'hidden'; });
      const bare = await sample();
      await area(page).evaluate((box) => { for (const el of box.querySelectorAll<HTMLElement>('canvas.dw-fab-foil')) el.style.visibility = ''; });
      const seen = at.filter((_, i) => Math.max(...before[i]!.map((v, j) => Math.abs(v - bare[i]![j]!))) > 10).length;
      expect(seen, 'points where the foil is visible (it differs from the bare post by more than 10 levels)').toBeGreaterThanOrEqual(4);
      for (const [i, p] of at.entries()) {
        const worst = Math.max(...before[i]!.map((v, j) => Math.abs(v - after[i]![j]!)));
        expect(worst, `${p.name} (${Math.round(p.x)}, ${Math.round(p.y)}): the foil there changes by ${worst} levels of 255 once the dent has landed (was ${JSON.stringify(before[i]!.slice(0, 4))}, is ${JSON.stringify(after[i]!.slice(0, 4))})`).toBeLessThanOrEqual(2);
      }
    });

    test('nothing is trapped: the signature\'s letters are the same with the foil shown and hidden', async ({ page }) => {
      const sig = await area(page).evaluate((box) => {
        const r = box.querySelector('.kb-signature')!.getBoundingClientRect();
        return { x: Math.ceil(r.left), y: Math.ceil(r.top) + 3, width: Math.floor(r.width) - 1, height: Math.floor(r.height) - 4 };
      });
      expect(sig.height, 'the signature is drawn').toBeGreaterThan(4);
      if (POISON === 'trap') {
        await area(page).evaluate((box) => {
          /* The area's filter, whose region covers the whole content area, so the foil is held and not clipped (the clip is the other poison). */
          const filter = box.querySelector('filter[id$="-area"]')!;
          box.querySelector('.dw-fab')!.parentElement!.style.filter = `url(#${filter.id})`;
        });
        await frames2(page);
      }
      /* The signature's own pixels are its letters, the darkest of the clip: the foil is behind them, so its colors change the ground and not them. */
      const letters = (px: number[]) => { let n = 0; for (let i = 0; i < px.length; i += 4) if (luma(px, i) < 110) n++; return n; };
      const shown = letters((await pixelsOf(page, sig)).px);
      await area(page).evaluate((box) => { for (const el of box.querySelectorAll<HTMLElement>('canvas.dw-fab-foil')) el.style.visibility = 'hidden'; });
      const hidden = letters((await pixelsOf(page, sig)).px);
      expect(hidden, 'the signature has letters').toBeGreaterThan(50);
      expect(shown, `letters drawn with the foil shown (${shown}) against hidden (${hidden})`).toBeGreaterThanOrEqual(hidden * 0.95);
    });
  });
}

/**
 * An ORIGIN box's content area inside a dented post's does not wear the post's bend (thread.css resets both properties on every content area): a post
 * shown in the box is its own. No story holds an ORIGIN box inside a dented post's body, so the box is built in the page: a content area with a words
 * box, inserted into the dented area. Poison (`KB_POISON=inherit`): the nested area takes the properties from its parent again.
 */
test('one-light: a content area nested in the dented post does not inherit its bend', async ({ page }) => {
  await open(page, 'one-light');
  await atRest(page, 1);
  const read = await area(page).evaluate((box, poison) => {
    const nested = document.createElement('div');
    nested.setAttribute('data-kb-content-area', '');
    nested.innerHTML = '<div data-kb-words-box>x</div>';
    if (poison) { nested.style.setProperty('--kb-bend', 'inherit'); nested.style.setProperty('--kb-bend-words', 'inherit'); }
    box.append(nested);
    const prop = (el: Element, name: string) => getComputedStyle(el).getPropertyValue(name).trim();
    return {
      outer: { bend: prop(box, '--kb-bend'), words: prop(box, '--kb-bend-words') },
      nested: { bend: prop(nested, '--kb-bend'), words: prop(nested, '--kb-bend-words'), filter: getComputedStyle(nested.firstElementChild!).filter },
    };
  }, POISON === 'inherit');
  expect(read.outer.bend, 'the dented post names the area filter').toContain('url(');
  expect(read.outer.words, 'the dented post names the words filter').toContain('url(');
  expect(read.nested.bend, 'the nested area\'s --kb-bend').toBe('none');
  expect(read.nested.words, 'the nested area\'s --kb-bend-words').toBe('none');
  expect(read.nested.filter, 'the nested words box\'s computed filter').toBe('none');
});

for (const name of ['one-light', 'one-dark', 'reduced', 'with-fab'] as const) {
  test(`axe finds nothing on ${name}`, async ({ page }) => {
    await open(page, name);
    await atRest(page, 1);
    expect(await pageViolations(page)).toEqual([]);
  });
}

/**
 * On the dark theme the dent still shows: the shade's gray (multiplied) darkens the post's own color and the light's gray (screened) lifts it.
 * One clipped pair of pictures over the dent's whole box, with and without the two layers (the chairs hidden in both), compared on the pixels
 * that are plain post color (no glyph) in the bare picture, sorted by how much the dent changed them. Measured locally: the mean of the
 * lightest tenth is about +55 to +59 levels of 255 and the mean of the darkest tenth about -10.4, against a floor of about -19 (a shade at its
 * darkest leaves about half of the post's #262626, 38 of 255). The bounds below, 30 and -10, sit under those means; the darkest tenth's is the
 * closer.
 */
test('one-dark: the dent shows on the dark theme: the lightest tenth of its box is lighter than the post color, and the darkest tenth darker', async ({ page }) => {
  await open(page, 'one-dark');
  await atRest(page, 1);
  await page.evaluate(() => document.fonts.ready);
  const s = await shading(page);
  expect(s.dents).toHaveLength(1);
  const d = s.dents[0]!;
  const x0 = Math.max(s.area.left + 1, Math.floor(d.left)), y0 = Math.max(s.area.top + 1, Math.floor(d.top));
  const clip = { x: x0, y: y0, width: Math.ceil(Math.min(s.area.right - 1, d.left + d.width) - x0), height: Math.ceil(Math.min(s.area.bottom - 1, d.top + d.height) - y0) };
  await area(page).evaluate((box) => { for (const el of box.querySelectorAll<HTMLElement>('.dw-chair-layer')) el.style.visibility = 'hidden'; });
  const shaded = await pixelsOf(page, clip);
  await area(page).evaluate((box) => { for (const el of box.querySelectorAll<HTMLElement>('.dw-chair-dents, .dw-chair-glows')) el.style.visibility = 'hidden'; });
  const bare = await pixelsOf(page, clip);
  /* Only the pixels that are the post's own background in the bare picture, as the darkness checks above do. */
  const bg = plain(bare.px);
  const diffs: number[] = [];
  for (let i = 0; i < bare.px.length; i += 4) if (bg[i / 4]) diffs.push(luma(shaded.px, i) - luma(bare.px, i));
  expect(diffs.length, 'plain post-colored pixels in the dent box').toBeGreaterThan(100);
  diffs.sort((x, y) => x - y);
  const tenth = Math.max(1, Math.floor(diffs.length / 10));
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const lowered = mean(diffs.slice(0, tenth));
  const lifted = mean(diffs.slice(-tenth));
  test.info().annotations.push({ type: 'dark', description: `lightest tenth ${lifted.toFixed(2)}, darkest tenth ${lowered.toFixed(2)} levels of 255` });
  expect(lifted, 'the lightest tenth of the dent box is lighter than the post, levels of 255').toBeGreaterThanOrEqual(30);
  expect(lowered, 'the darkest tenth of the dent box is darker than the post, levels of 255').toBeLessThanOrEqual(-10);
});

test.describe('at a phone\'s width', () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  test('the chair stays inside the post and the page does not scroll sideways', async ({ page }) => {
    await open(page, 'one-light', { width: 390, height: 800 }, SEEDS.phone);
    await atRest(page, 1);
    const m = await measure(page);
    inside(m);
    onTheFloor(m);
    const wide = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(wide.scroll, 'the page\'s width').toBeLessThanOrEqual(wide.client);
  });
});
