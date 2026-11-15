import { expect, test, type Page } from '@playwright/test';
import { pageViolations } from './axe.ts';

/**
 * Steel Chair as a browser draws it (docs/plans/2026-11-15-steel-chair-plan.md, Task 7, as amended: the chair's world is the post's content area,
 * `.kb-act-main`, the bordered box that holds the words; its borders are the walls and its floor). The stories are
 * instances/divided-world/ui/steel-chair/Chair.board.stories.tsx. A throw is drawn when the post's middle has been in view for 300 ms, lands, tips
 * and sleeps; each test waits for the chairs to be asleep (`data-rest`) and then measures what the browser laid out: where the chair's drawn box
 * lies against the content area's borders, where the floor's room is, that no word is under a chair lying flat, that the frame loop has stopped,
 * and that the Lens and a scroll away and back run it again somewhere else.
 *
 * The geometry (chair.ts): the world is drawn in an oblique view, so the floor recedes UP the screen the farther back it is. A chair is therefore
 * always inside the content area's padding box (the side walls are the borders at every depth, and the floor's front is the bottom border), and
 * its lowest drawn point is on the border only when it rests at the very front. A chair lying flat (its big face down) on the floor is at most the
 * floor's room, 28 px, above the border. A chair standing on a narrow face is not bounded by the room: its contact edge is at most 4 px in front of
 * its middle, which is at most DEPTH + GIVE = 52 px behind the front, so it may be drawn up to K·(Z_FRONT + 52 + 4) = 33.7 px above the border, and
 * that is what is asserted for it (34, and a pixel's rounding). A chair lying on another chair is higher by that one's thickness or more, and is only
 * held to the border and the top of the content area.
 */
test.use({ bypassCSP: true });

const STORY = (name: string) => `/?fixture=boards&story=boards-25-steel-chair--${name}`;

/** The floor's room, and the highest a chair standing on a narrow face may be drawn above the bottom border (see above). */
const ROOM = 28;
const HIGHEST_STANDING = 34;
/** A pixel's rounding, and the half pixel the plan allows at a border. */
const ROUND = 1;
const EDGE = 0.5;

/** The post that wears the card: its content area (the world) and its parts. */
const area = (page: Page) => page.locator('.kb-act-main:has(.dw-chair)').first();
const chairs = (page: Page) => area(page).locator('.dw-chair-group');
const dents = (page: Page) => area(page).locator('.dw-chair-dents .dw-chair-dent');

/** Opens a story, the post in view, and starts counting the frames the page asks for. */
async function open(page: Page, name: string, size: { width: number; height: number } = { width: 1280, height: 760 }) {
  await page.setViewportSize(size);
  await page.addInitScript(() => {
    const w = window as unknown as { __frames: number };
    w.__frames = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb: FrameRequestCallback) => { w.__frames++; return raf(cb); };
  });
  await page.goto(STORY(name));
  await expect(page.locator('.dw-chair').first()).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
  await area(page).scrollIntoViewIfNeeded();
}

/** Waits until `n` chairs are drawn and every one is asleep. */
async function atRest(page: Page, n: number, timeout = 6000) {
  await expect.poll(() => page.evaluate((count) => {
    const groups = [...document.querySelectorAll('.kb-act-main .dw-chair-group')];
    return groups.length === count && groups.every((g) => g.hasAttribute('data-rest'));
  }, n), { timeout, message: `${n} chair(s) drawn and asleep` }).toBe(true);
}

interface Box { left: number; top: number; right: number; bottom: number }
interface Measure {
  /** The content area's padding box (inside its borders), in the window. */
  readonly area: Box;
  /** Each chair's drawn box: the union of its pieces' boxes, in the window, and whether it lies flat (its big face turned to the floor). */
  readonly chairs: (Box & { flat: boolean })[];
  /** The room: the `::after` the stylesheet adds to the content area, its computed size, and the gap between the last real child and the content box's bottom. */
  readonly room: { display: string; height: number; gap: number; paddingBottom: number };
  /** Every line of the post's words, in the window. */
  readonly lines: Box[];
}
const measure = (page: Page): Promise<Measure> => page.evaluate(() => {
  const box = document.querySelector<HTMLElement>('.kb-act-main:has(.dw-chair)')!;
  const r = box.getBoundingClientRect();
  const inner = { left: r.left + box.clientLeft, top: r.top + box.clientTop, right: r.left + box.clientLeft + box.clientWidth, bottom: r.top + box.clientTop + box.clientHeight };
  const chairs = [...box.querySelectorAll<HTMLElement>('.dw-chair-group')].map((g) => {
    const rects = [...g.querySelectorAll('.dw-chair-piece')].map((p) => p.getBoundingClientRect());
    /* The rotation is the last matrix3d of the transform; its third column is the direction the big face looks, and a chair lies flat when that is up or down. */
    const matrices = [...g.style.transform.matchAll(/matrix3d\(([^)]*)\)/gu)];
    const m = matrices.at(-1)![1]!.split(',').map(Number);
    return { left: Math.min(...rects.map((x) => x.left)), top: Math.min(...rects.map((x) => x.top)), right: Math.max(...rects.map((x) => x.right)), bottom: Math.max(...rects.map((x) => x.bottom)), flat: Math.abs(m[9]!) > 0.98 };
  });
  const after = getComputedStyle(box, '::after');
  const style = getComputedStyle(box);
  /* The last box that takes room in the flow: the content area's last child that is not absolutely placed (the effect's layers are inside its host). */
  const last = [...box.children].filter((c) => getComputedStyle(c).position !== 'absolute').at(-1)!;
  const contentBottom = inner.bottom - parseFloat(style.paddingBottom);
  const lines: Box[] = [];
  const walker = document.createTreeWalker(box.querySelector('.dw-chair-words')!, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const q of range.getClientRects()) if (q.width > 0 && q.height > 0) lines.push({ left: q.left, top: q.top, right: q.right, bottom: q.bottom });
  }
  return { area: inner, chairs, room: { display: after.display, height: parseFloat(after.height), gap: contentBottom - last.getBoundingClientRect().bottom, paddingBottom: parseFloat(style.paddingBottom) }, lines };
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
 * Each chair's lowest drawn point is no lower than the border and within the floor's depth above it: the room for one lying flat, more for one
 * standing on a narrow face. A chair whose drawn box overlaps another's across may be resting on it, and is not held to that depth.
 */
function onTheFloor(m: Measure) {
  m.chairs.forEach((c, i) => {
    const above = m.area.bottom - c.bottom;
    expect(above, `lowest point ${above} px above the bottom border (flat: ${c.flat})`).toBeGreaterThanOrEqual(-EDGE);
    const stacked = m.chairs.some((o, j) => j !== i && o.left < c.right && o.right > c.left && o.top < c.bottom && o.bottom > c.top);
    if (!stacked) expect(above, `lowest point ${above} px above the bottom border (flat: ${c.flat})`).toBeLessThanOrEqual(c.flat ? ROOM + ROUND : HIGHEST_STANDING + ROUND);
  });
}

/** The room is the content area's last 28 px above its bottom padding: a block `::after` of that height, and at least that much between the last box and the content's end. */
function roomIsLast(m: Measure) {
  expect(m.room.display).toBe('block');
  expect(m.room.height).toBeCloseTo(ROOM, 0);
  expect(m.room.gap, 'room left between the last box and the bottom of the content').toBeGreaterThanOrEqual(ROOM - ROUND);
}

/** No word is under a chair lying flat (one standing on a narrow face reaches higher than the room, and may cover a line; the card does not claim otherwise). */
function noWordsUnderFlat(m: Measure) {
  for (const c of m.chairs.filter((x) => x.flat)) {
    const covered = m.lines.filter((l) => l.left < c.right && l.right > c.left && l.top < c.bottom && l.bottom > c.top);
    expect(covered, `lines under the flat chair's box ${JSON.stringify(c)}`).toEqual([]);
  }
}

/** The frames the page has asked for, over `ms` of waiting. */
async function framesOver(page: Page, ms: number): Promise<number> {
  const before = await page.evaluate(() => (window as unknown as { __frames: number }).__frames);
  await page.waitForTimeout(ms);
  return (await page.evaluate(() => (window as unknown as { __frames: number }).__frames)) - before;
}

/** Where the first dent's shading stands, in the content area's px. */
const dentAt = (page: Page) => dents(page).first().evaluate((el) => `${(el as HTMLElement).style.left},${(el as HTMLElement).style.top}`);

test('one-light: a dent and a chair within 6 seconds, the chair inside the content area, on or just above its bottom border, and no frame asked for once it rests', async ({ page }) => {
  await open(page, 'one-light');
  await atRest(page, 1);
  /* First, so that a geometry failure below cannot skip it. */
  expect(await framesOver(page, 700), 'frames asked for after the chair rests').toBe(0);
  await expect(dents(page)).toHaveCount(1);
  await expect(chairs(page)).toHaveCount(1);
  const m = await measure(page);
  inside(m);
  onTheFloor(m);
});

test('one-light: the room is the last 28 px of the content area, above its bottom padding', async ({ page }) => {
  await open(page, 'one-light');
  await atRest(page, 1);
  roomIsLast(await measure(page));
});

test('one-light: every word is still in the page\'s text, selectable, and none is under a chair lying flat', async ({ page }) => {
  await open(page, 'one-light');
  await atRest(page, 1);
  await expect(page.getByText('The best driver in the entire series is Luigi.').first()).toBeVisible();
  const read = await area(page).evaluate((box) => {
    const words = box.querySelector('.dw-chair-words')!;
    const range = document.createRange();
    range.selectNodeContents(words);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const selected = selection.toString();
    selection.removeAllRanges();
    return { text: words.textContent ?? '', selected, userSelect: getComputedStyle(words).userSelect };
  });
  for (const w of ['The best driver in the entire series is Luigi', 'Rainbow Road at two in the morning', 'Thank you for coming to my talk']) {
    expect(read.text).toContain(w);
    expect(read.selected.replace(/\s+/gu, ' ')).toContain(w);
  }
  expect(read.userSelect).not.toBe('none');
  noWordsUnderFlat(await measure(page));
});

test('three: three dents, three chairs at rest, all inside the content area on its floor', async ({ page }) => {
  await open(page, 'three', { width: 1280, height: 900 });
  await atRest(page, 3, 8000);
  expect(await framesOver(page, 700), 'frames asked for after the chairs rest').toBe(0);
  await expect(dents(page)).toHaveCount(3);
  const m = await measure(page);
  expect(m.chairs).toHaveLength(3);
  inside(m);
  onTheFloor(m);
  roomIsLast(m);
  noWordsUnderFlat(m);
});

test('scrolling the post out of view and back runs it again, the dent in another place', async ({ page }) => {
  await open(page, 'one-light', { width: 1280, height: 600 });
  await atRest(page, 1);
  const first = await dentAt(page);
  /* The thread is short: a tall block after it gives the post somewhere to leave the view to. */
  await page.evaluate(() => { const s = document.createElement('div'); s.id = 'chair-spacer'; s.style.cssText = 'height:4000px'; document.body.append(s); });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(chairs(page)).toHaveCount(0);
  await expect(dents(page)).toHaveCount(0);
  await area(page).scrollIntoViewIfNeeded();
  await area(page).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await atRest(page, 1);
  await expect(dents(page)).toHaveCount(1);
  expect(await dentAt(page), 'the dent\'s place').not.toBe(first);
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
  await expect.poll(async () => (await dents(page).count()) === 1 && (await dentAt(page)) !== first, { timeout: 6000, message: 'a new dent in another place' }).toBe(true);
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
  expect(await area(page).locator('.dw-chair-words[data-shake]').count()).toBe(0);
  const m = await measure(page);
  inside(m);
  onTheFloor(m);
});

test('short-post: the host is as tall as its words, the content area holds the room, the chair rests inside it and the dent is over the text', async ({ page }) => {
  await open(page, 'short-post');
  await atRest(page, 1);
  expect(await framesOver(page, 700), 'frames asked for after the chair rests').toBe(0);
  const rows = await area(page).evaluate((box) => {
    const words = box.querySelector('.dw-chair-words')!.getBoundingClientRect();
    const host = box.querySelector('.dw-chair')!.getBoundingClientRect();
    const inner = box.getBoundingClientRect();
    /* The text's own rects: a range over the wrapper's contents would add the border box of every element, as wide as the wrapper. */
    const rects: DOMRect[] = [];
    const walker = document.createTreeWalker(box.querySelector('.dw-chair-words')!, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(n);
      rects.push(...[...range.getClientRects()].filter((q) => q.width > 0 && q.height > 0));
    }
    const left = Math.min(...rects.map((q) => q.left)), right = Math.max(...rects.map((q) => q.right)), top = Math.min(...rects.map((q) => q.top)), bottom = Math.max(...rects.map((q) => q.bottom));
    const dent = box.querySelector<HTMLElement>('.dw-chair-dent')!;
    const d = dent.getBoundingClientRect();
    return {
      words: words.height, host: host.height, hostStrip: box.querySelector('.dw-chair-room')!.getBoundingClientRect().height,
      text: { left, right, top, bottom }, dent: { x: d.left + d.width / 2, y: d.top + d.height / 2 }, wordsWidth: words.width, areaLeft: inner.left, areaWidth: inner.width,
    };
  });
  /* The effect's own box is just its words: the room is the content area's, not a strip under them. */
  expect(Math.abs(rows.host - rows.words), `host ${rows.host} vs words ${rows.words}`).toBeLessThanOrEqual(ROUND);
  expect(rows.hostStrip, 'the strip in the host is hidden inside a content area').toBe(0);
  /* The words wrapper is as wide as the content area but the text is one short line: the dent is over the text and not beside it. */
  expect(rows.text.right - rows.text.left, 'the text is narrower than its wrapper').toBeLessThan(rows.wordsWidth / 2);
  expect(rows.dent.x, `dent x ${rows.dent.x} over the text ${rows.text.left} to ${rows.text.right}`).toBeGreaterThanOrEqual(rows.text.left - 2);
  expect(rows.dent.x).toBeLessThanOrEqual(rows.text.right + 2);
  expect(rows.dent.y, `dent y ${rows.dent.y} over the text ${rows.text.top} to ${rows.text.bottom}`).toBeGreaterThanOrEqual(rows.text.top - 2);
  expect(rows.dent.y).toBeLessThanOrEqual(rows.text.bottom + 2);
  const m = await measure(page);
  roomIsLast(m);
  inside(m);
  onTheFloor(m);
  /* The row is as tall as the author column makes it, as for any post: the room does not stretch it, it is part of what the content holds. */
  expect(m.area.bottom - m.area.top).toBeGreaterThan(rows.words + ROOM);
});

for (const name of ['one-light', 'one-dark', 'reduced']) {
  test(`axe finds nothing on ${name}`, async ({ page }) => {
    await open(page, name);
    await atRest(page, 1);
    expect(await pageViolations(page)).toEqual([]);
  });
}

test.describe('at a phone\'s width', () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  test('the chair stays inside the post and the page does not scroll sideways', async ({ page }) => {
    await open(page, 'one-light', { width: 390, height: 800 });
    await atRest(page, 1);
    const m = await measure(page);
    inside(m);
    onTheFloor(m);
    const wide = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(wide.scroll, 'the page\'s width').toBeLessThanOrEqual(wide.client);
  });
});
