/**
 * The marks on a post (docs/plans/2026-10-31-marks-and-the-lens-design.md, section 1), measured in a browser, which jsdom
 * cannot: #41 of the story `Boards/01 Plays on a post`, with six plays, at the Main board's width and the Phone board's.
 * Marks are positioned over the post and never in the page's flow, so the post is as tall with its marks as with none
 * and as with six kinds of them; every mark stays inside the window; and a mark opens its card's play.
 *
 * The story has plays of two cards. Six kinds are drawn by cloning a drawn mark into its strip, which is what the layout
 * has to bear whatever made the marks; Task 8 of the plan builds a story whose six plays are six cards, and the
 * measurement stands.
 */
import { expect, test } from '@playwright/test';

for (const [label, viewport, story] of [
  ['the Main board', { width: 1440, height: 1120 }, 'boards-01-plays-on-a-post--six-plays'],
  ['the Phone board', { width: 390, height: 844 }, 'boards-01-plays-on-a-post--six-plays-phone'],
] as const) {
  test.describe(`the marks on #41 on ${label}`, () => {
    test.use({ viewport });

    test('the post is as tall with no marks, the story\'s marks, and six kinds of them, and none leaves the window', async ({ page }) => {
      await page.goto(`/?fixture=boards&story=${story}`);
      const post = page.locator('#post-41');
      const marks = post.locator('.kb-mark[data-kb-card]');
      await expect(marks.first()).toBeVisible();
      const height = async () => (await post.boundingBox())!.height;
      const drawn = await height();
      /* Six kinds: clone a drawn mark into the strip until it holds six. */
      await post.locator('.kb-marks').evaluate((strip) => {
        const first = strip.querySelector('.kb-mark')!;
        while (strip.querySelectorAll('.kb-mark').length < 6) strip.append(first.cloneNode(true));
      });
      await expect(post.locator('.kb-mark')).toHaveCount(6);
      expect(await height(), 'the post is as tall with six marks as with the story\'s').toBe(drawn);
      for (const box of await post.locator('.kb-mark').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right }; }))) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(viewport.width);
      }
      /* None at all: the strip taken out of the page. */
      await post.locator('.kb-marks').evaluate((strip) => { (strip as HTMLElement).style.display = 'none'; });
      expect(await height(), 'the post is as tall with no marks as with six').toBe(drawn);
    });

    test('a mark stands over the post\'s words without taking their place, and opens its card\'s play', async ({ page }) => {
      await page.goto(`/?fixture=boards&story=${story}`);
      const post = page.locator('#post-41');
      const mark = post.locator('.kb-mark[data-kb-card]').first();
      await expect(mark).toBeVisible();
      await expect(mark).toHaveAttribute('aria-expanded', 'false');
      await mark.click();
      await expect(mark).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(mark).toHaveAttribute('aria-expanded', 'false');
      await expect(mark).toBeFocused();
    });
  });
}
