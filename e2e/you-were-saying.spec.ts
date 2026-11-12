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
          const last = [...range.getClientRects()].filter((r) => r.width > 0).at(-1)!;
          const first = tail0.getClientRects()[0]!;
          const rows = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top / 4)));
          return { lastCenter: last.top + last.height / 2, lastRight: last.right, lastHeight: last.height, tailCenter: first.top + first.height / 2, tailLeft: first.left, lines: rows.size };
        });
        expect(m.lines).toBeGreaterThanOrEqual(3);
        expect(Math.abs(m.tailCenter - m.lastCenter)).toBeLessThanOrEqual(m.lastHeight / 2);
        expect(m.tailLeft).toBeGreaterThanOrEqual(m.lastRight - 1);
      });

      test('every piece of tape lies over a box of its words', async ({ page }) => {
        /* A strip's segments are named by the offsets they cover, not by the strip, so a piece is held to lie over some segment's box. */
        const off = await page.evaluate(() => {
          const segs = [...document.querySelectorAll<HTMLElement>('[data-kb-ac-seg]')].flatMap((s) => [...s.getClientRects()]);
          const pieces = [...document.querySelectorAll<HTMLElement>('[data-kb-ac-piece]')];
          return pieces.flatMap((p) => {
            const b = p.getBoundingClientRect();
            const over = segs.some((r) => b.left < r.right + 2 && b.right > r.left - 2 && b.top < r.bottom + 2 && b.bottom > r.top - 2);
            return over ? [] : [`${p.dataset.kbAcPiece} line ${p.dataset.kbAcLine}`];
          }).concat(pieces.length ? [] : ['no piece']);
        });
        expect(off).toEqual([]);
      });
    });
  }
}
