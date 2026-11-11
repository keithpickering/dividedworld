import { expect, test, type Page } from '@playwright/test';

/**
 * Autocorrect's masking tape in a real browser, which jsdom cannot lay out (docs/plans/2026-11-11-autocorrect-tape-plan.md, Task 10),
 * on its stories ("Boards/11 Autocorrect", instances/divided-world/ui/autocorrect/Autocorrect.board.stories.tsx):
 *  - a strip peeled by a held key takes at least the pick and the width at the pace, and the post's words do not move by a pixel;
 *  - three short drags of a reader's, on a phone, lift a stack of three off the words under it;
 *  - a strip the author peeled before this load takes its words' own width: no room after them, and its residue stands on the words.
 */
const STORY = (name: string) => `/?fixture=boards&story=boards-11-autocorrect--${name}`;
/* The card's settings as the Effect defaults them (Effect.tsx DEFAULTS; autocorrect.pace, pickMs). */
const PACE = 90;
const PICK_MS = 450;

const open = async (page: Page, name: string, size: { width: number; height: number }, ready = '[data-kb-ac-piece]') => {
  await page.setViewportSize(size);
  await page.goto(STORY(name));
  await page.waitForSelector(ready);
  /* The pieces are measured once the fonts are in. */
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(500);
};

/** Every word of the post's own text (not the anchors', the room's or the tape's), with its box, by the Range over it. */
const wordBoxes = (page: Page) => page.evaluate(() => {
  const post = document.querySelector('[data-kb-ac-anchor]')!.closest('article')!;
  const root = post.querySelector('[data-kb-ac-seg]')!.parentElement!;
  const out: string[] = [];
  /* From the post's own corner, so a scroll the focus caused moves nothing. */
  const o = post.getBoundingClientRect();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement!;
    if (el.closest('.kb-visually-hidden, .dw-ac-tape, .dw-ac-room, [data-kb-report]')) continue;
    const text = n.textContent ?? '';
    for (const m of text.matchAll(/\S+/g)) {
      const r = document.createRange();
      r.setStart(n, m.index!);
      r.setEnd(n, m.index! + m[0].length);
      for (const b of r.getClientRects()) out.push(`${m[0]} ${(b.x - o.x).toFixed(1)} ${(b.y - o.y).toFixed(1)} ${b.width.toFixed(1)} ${b.height.toFixed(1)}`);
    }
  }
  return out;
});

const pieces = (page: Page) => page.locator('[data-kb-ac-piece]').count();

test('a strip peeled by the keyboard takes the pick and its width at the pace, and no word of the post moves', async ({ page }) => {
  await open(page, 'one-author', { width: 1440, height: 1120 });
  const before = await wordBoxes(page);
  expect(before.length).toBeGreaterThan(10);
  const count = await pieces(page);
  const width = (await page.locator('[data-kb-ac-piece]').first().boundingBox())!.width;
  await page.locator('[data-kb-ac-anchor]').first().focus();
  const start = Date.now();
  await page.keyboard.down('Enter');
  await expect.poll(() => pieces(page), { timeout: 5000, intervals: [20] }).toBe(count - 1);
  const took = Date.now() - start;
  await page.keyboard.up('Enter');
  expect(took).toBeGreaterThanOrEqual(PICK_MS + (width / PACE) * 1000 - 50);
  /* A half second of slack at the top: a peel that took twice as long is a hand that lagged, not the pace. */
  expect(took).toBeLessThan(PICK_MS + (width / PACE) * 1000 + 1500);
  await page.waitForTimeout(600);
  expect(await wordBoxes(page)).toEqual(before);
});

test('a reader\'s three short drags lift a stack of three off the words under it at 390px', async ({ page }) => {
  await open(page, 'stack-phone', { width: 390, height: 844 });
  const keys = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-kb-ac-piece][data-kb-ac-line="0"]')].map((p) => p.dataset.kbAcPiece!).filter((k) => k.endsWith(':0')));
  expect(keys).toHaveLength(3);
  /* The three plays' first strips lie one over another on "Big cats are"; the last played is the top. */
  const top = page.locator(`[data-kb-ac-piece="${keys[2]}"][data-kb-ac-line="0"]`);
  await top.scrollIntoViewIfNeeded();
  const lifted = () => page.evaluate((ks) => ks.map((k) => {
    const body = document.querySelector<HTMLElement>(`[data-kb-ac-piece="${k}"][data-kb-ac-line="0"] .dw-ac-body`)!;
    /* Lifted whole: the mask is clear of the piece's width, with no opaque stop left. */
    return /linear-gradient\(90deg, transparent 0px, transparent [\d.]+px\)/.test(body.style.cssText);
  }), keys);
  expect(await lifted()).toEqual([false, false, false]);
  const SHORT = 120;
  for (let i = 0; i < 3; i++) {
    const b = (await top.locator('.dw-ac-hit').first().boundingBox())!;
    const y = b.y + b.height / 2;
    await page.mouse.move(b.x + 4, y);
    await page.mouse.down();
    for (let s = 1; s <= 10; s++) { await page.mouse.move(b.x + 4 + (s * SHORT) / 10, y); await page.waitForTimeout(16); }
    await page.mouse.up();
    /* Let go inside the peek's stay (peekStayMs), so the next press picks it up where it is. */
    await page.waitForTimeout(60);
    expect(SHORT).toBeLessThan(390 / 3);
  }
  expect(await lifted()).toEqual([true, true, true]);
});

test('after a reload, a peeled strip takes its words\' own width, and its residue stands on them', async ({ page }) => {
  const size = { width: 1440, height: 1120 };
  /* A visit with the strip still stuck: the room after its words is there, and the words that follow stand after it. */
  await open(page, 'wider-author', size);
  expect(await page.locator('[data-kb-ac-room]').count()).toBeGreaterThan(0);
  /* The box of a phrase of the post's own text, and where the text after it begins, by a Range over each. */
  const after = (p: Page) => p.evaluate(() => {
    const post = document.querySelector('[data-kb-ac-anchor], [data-kb-ac-seg]')!.closest('article')!;
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(post, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!n.parentElement!.closest('.kb-visually-hidden, .dw-ac-tape, .dw-ac-room, [data-kb-report]')) nodes.push(n as Text);
    const all = nodes.map((n) => n.data).join('');
    const at = (phrase: string) => {
      const from = all.indexOf(phrase);
      let seen = 0;
      const r = document.createRange();
      nodes.forEach((n) => {
        if (from >= seen && from < seen + n.length) r.setStart(n, from - seen);
        if (from + phrase.length > seen && from + phrase.length <= seen + n.length) r.setEnd(n, from + phrase.length - seen);
        seen += n.length;
      });
      return r.getBoundingClientRect();
    };
    const words = at('the boss fight is fine'), next = at('Music');
    return { left: words.left, right: words.right, next: next.left, rooms: post.querySelectorAll('[data-kb-ac-room]').length };
  });
  const stuck = await after(page);
  expect(stuck.next - stuck.right).toBeGreaterThan(100);

  await open(page, 'reloaded-light', size, 'canvas.dw-ac-residue');
  const peeled = await after(page);
  expect(peeled.rooms).toBe(0);
  /* Only a space's width between the words and what follows them (where it was the replacement's room). */
  expect(peeled.next - peeled.right).toBeLessThan(20);
  expect(peeled.right - peeled.left).toBeCloseTo(stuck.right - stuck.left, 0);
  /* The residue is drawn, and only over the words' own box. */
  await page.locator('canvas.dw-ac-residue').scrollIntoViewIfNeeded();
  const film = async () => page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas.dw-ac-residue');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const k = c.width / r.width;
    let lo = Infinity, hi = -Infinity;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3]! > 0) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    return hi < lo ? { none: true } : { left: r.left + lo / k, right: r.left + (hi + 1) / k };
  });
  /* Drawn when it comes near the viewport, so it is waited for. */
  await expect.poll(async () => 'left' in ((await film()) ?? {}), { timeout: 5000 }).toBe(true);
  const f = (await film()) as { left: number; right: number };
  expect(f.left).toBeGreaterThanOrEqual(peeled.left - 3);
  expect(f.right).toBeLessThanOrEqual(peeled.right + 3);
});
