import { expect, test, type Page } from '@playwright/test';

/**
 * A tail stands next to the post's words whatever order its card and a covering card were played in, in a real browser
 * (docs/plans/2026-11-12-tail-innermost-plan.md, Task 1), on the stories "Boards/20 You Were Saying" `TapedFirst` and `TapedLast`
 * (instances/divided-world/ui/you-were-saying/YouWereSaying.board.stories.tsx): one post, Autocorrect and You Were Saying? played on it,
 * the lower layer first.
 *  - the tail is the next element sibling of the post's `.kb-bb`, both inside Autocorrect's box;
 *  - the tail's first client rect is on the line of the words' last, after them;
 *  - the tape is where it was: every piece lies over a box of its strip's words.
 */
const STORY = (name: string) => `/?fixture=boards&story=boards-20-you-were-saying--${name}`;

const open = async (page: Page, name: string, size: { width: number; height: number }) => {
  await page.setViewportSize(size);
  await page.goto(STORY(name));
  await page.waitForSelector('[data-kb-tail]');
  await page.waitForSelector('[data-kb-ac-piece]');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(500);
};

for (const story of ['taped-first', 'taped-last']) {
  for (const [width, height] of [[1440, 1120], [390, 844]] as const) {
    test.describe(`${story} at ${width}px`, () => {
      test.beforeEach(async ({ page }) => { await open(page, story, { width, height }); });

      test('the tail is the next sibling of the words, inside Autocorrect\'s box', async ({ page }) => {
        const where = await page.evaluate(() => {
          const tail = document.querySelector('[data-kb-tail]')!;
          const words = tail.closest('article')!.querySelector('.kb-bb')!;
          return { next: words.nextElementSibling === tail, inside: !!words.closest('[data-kb-autocorrect]') && !!tail.closest('[data-kb-autocorrect]') };
        });
        expect(where).toEqual({ next: true, inside: true });
      });

      test('the tail starts on the line the words end on, after them', async ({ page }) => {
        const m = await page.evaluate(() => {
          const tail0 = document.querySelector('[data-kb-tail]')!;
          const words = tail0.closest('article')!.querySelector('.kb-bb')!;
          const range = document.createRange();
          range.selectNodeContents(words);
          const rects = [...range.getClientRects()].filter((r) => r.width > 0);
          /* Lines: cluster the rects' vertical centers, a new line when a center is more than half a rect's height from its line's first, so a nested box (Autocorrect's segment) on a line is that line. */
          const tol = Math.max(...rects.map((r) => r.height)) / 2;
          const lines: { center: number; height: number; right: number }[] = [];
          for (const r of [...rects].sort((x, y) => x.top + x.height / 2 - (y.top + y.height / 2))) {
            const c = r.top + r.height / 2;
            const line = lines.at(-1);
            if (line && c - line.center <= tol) { line.right = Math.max(line.right, r.right); line.height = Math.max(line.height, r.height); }
            else lines.push({ center: c, height: r.height, right: r.right });
          }
          const last = lines.at(-1)!;
          const first = tail0.getClientRects()[0]!;
          return { lastCenter: last.center, lastRight: last.right, lastHeight: last.height, tailCenter: first.top + first.height / 2, tailLeft: first.left, lines: lines.length };
        });
        expect(m.lines).toBeGreaterThanOrEqual(3);
        expect(Math.abs(m.tailCenter - m.lastCenter)).toBeLessThanOrEqual(m.lastHeight / 2);
        expect(m.tailLeft).toBeGreaterThanOrEqual(m.lastRight - 1);
      });

      test('every piece of tape lies over a box of its words', async ({ page }) => {
        /*
         * The story has one strip, and a segment the strip covers is the one Autocorrect hides from readers (`aria-hidden`), so the covered segments
         * are its strip's words. A piece's box holds one line of the strip's words: its center falls inside a covered segment's box, and it spans
         * that box across (a few pixels of slack for the tape's tilt), so a piece shifted by a line or off its words cannot pass.
         */
        const off = await page.evaluate(() => {
          const covered = [...document.querySelectorAll<HTMLElement>('[data-kb-ac-seg][aria-hidden="true"]')].flatMap((s) => [...s.getClientRects()].filter((r) => r.width > 0));
          const pieces = [...document.querySelectorAll<HTMLElement>('[data-kb-ac-piece]')];
          const tol = 4;
          return pieces.flatMap((p) => {
            const b = p.getBoundingClientRect();
            const cx = b.left + b.width / 2;
            const cy = b.top + b.height / 2;
            const over = covered.some((r) => cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom && b.left <= r.left + tol && b.right >= r.right - tol);
            return over ? [] : [`${p.dataset.kbAcPiece} line ${p.dataset.kbAcLine}`];
          }).concat(pieces.length ? [] : ['no piece'], covered.length ? [] : ['no covered segment']);
        });
        expect(off).toEqual([]);
      });
    });
  }
}

/*
 * The post keeps its height while the tail types: the words not yet typed hold their place from the first frame, so nothing under the
 * post moves and a scroll is not fought. On the story `ChainLight` (full motion, three chained plays, several lines at either width):
 * the post is taken out of view and brought back, which types the tail in again from nothing, and every frame from then until it has
 * typed is read. The post's height is one number throughout, and so is the line each character of the whole text stands on, so no word
 * hops to the next line as it grows. That the typing was seen (fewer characters shown at some frame than at the end) is checked too:
 * a tail that never typed would hold its height for the wrong reason.
 */
for (const [width, height] of [[1440, 1120], [390, 844]] as const) {
  test(`the post holds its height and its lines while the tail types, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(STORY('chain-light'));
    await page.waitForSelector('[data-kb-tail]');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const seen = await page.evaluate(async () => {
      const frame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));
      const tail = document.querySelector<HTMLElement>('[data-kb-tail]')!;
      const article = tail.closest('article')!;
      tail.scrollIntoView({ block: 'center' });
      article.style.display = 'none';
      for (let i = 0; i < 5; i++) await frame();
      article.style.display = '';
      const typed = () => [...tail.querySelectorAll('[data-play]')].reduce((n, s) => n + (s.textContent ?? '').length, 0);
      /* The top of every character of the tail's text, in order, whichever element holds it now. */
      const lines = () => {
        const tops: number[] = [];
        const walk = document.createTreeWalker(tail, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        for (let node = walk.nextNode(); node; node = walk.nextNode()) {
          const n = (node.textContent ?? '').length;
          for (let i = 0; i < n; i++) { range.setStart(node, i); range.setEnd(node, i + 1); tops.push(Math.round(range.getBoundingClientRect().top)); }
        }
        return tops.join(',');
      };
      const heights = new Set<number>();
      const layouts = new Set<string>();
      let least = Infinity;
      const from = performance.now();
      while (performance.now() - from < 7000) {
        heights.add(article.getBoundingClientRect().height);
        layouts.add(lines());
        least = Math.min(least, typed());
        await frame();
      }
      return { heights: [...heights], layouts: layouts.size, least, most: typed(), lineCount: new Set([...layouts][0]!.split(',')).size };
    });
    expect(seen.least).toBeLessThan(seen.most / 2);
    expect(seen.lineCount).toBeGreaterThanOrEqual(2);
    expect(seen.heights).toHaveLength(1);
    expect(seen.layouts).toBe(1);
  });
}
