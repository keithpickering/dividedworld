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
