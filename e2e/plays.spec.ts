/**
 * The plays on a post, stacked and unstacked (docs/plans/2026-10-31-plays-on-a-post-design.md, section 3, as the owner
 * amended it on #97's shots: "unstack the list and have it float over the post like a dropdown menu - absolutely
 * positioned, not a block that will cause the post to change height whether it is expanded or collapsed"). Measured in
 * a browser, which jsdom cannot: #41 of the story `Boards/01 Plays on a post`, with three plays, at the Main board's
 * width and the Phone board's. The post is as tall unstacked as stacked, the list stands over the post's words, and
 * every name on the tags is in the glass's face, in capitals, never the board's Verdana.
 */
import { expect, test } from '@playwright/test';

for (const [label, viewport, story, six] of [
  ['the Main board', { width: 1440, height: 1120 }, 'boards-01-plays-on-a-post--three-plays', 'boards-01-plays-on-a-post--six-plays'],
  ['the Phone board', { width: 390, height: 844 }, 'boards-01-plays-on-a-post--three-plays-phone', 'boards-01-plays-on-a-post--six-plays-phone'],
] as const) {
  test.describe(`the plays on #41 on ${label}`, () => {
    test.use({ viewport });

    test('unstack over the post, which keeps its height, and stack again', async ({ page }) => {
      await page.goto(`/?fixture=boards&story=${story}`);
      const post = page.locator('#post-41');
      const tags = post.getByRole('list', { name: 'Cards played on this post' });
      const button = tags.getByRole('button', { name: 'Unstack 2 more cards played on this post' });
      await expect(button).toBeVisible();
      const stacked = await post.boundingBox();
      await button.click();
      const list = tags.locator('.kb-play-unstacked');
      await expect(list).toBeVisible();
      await expect(list.getByRole('button', { name: /Opens the play\.$/u })).toHaveCount(2);
      const unstacked = await post.boundingBox();
      expect(unstacked!.height, 'the post is as tall unstacked as stacked').toBe(stacked!.height);
      /* The list stands over the post's words: it overlaps them, and what is at its middle is the list itself. */
      const [box, words] = await Promise.all([list.boundingBox(), post.locator('.kb-act-main').boundingBox()]);
      expect(box!.y).toBeLessThan(words!.y + words!.height);
      expect(box!.y + box!.height).toBeGreaterThan(words!.y);
      expect(await list.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return at !== null && el.contains(at);
      })).toBe(true);
      /* It stays inside the window's width. */
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      await page.keyboard.press('Escape');
      await expect(list).toBeHidden();
      expect((await post.boundingBox())!.height).toBe(stacked!.height);
    });

    test('unstacked, a list long enough to run past the post\'s words stands over the card\'s plate and the next post: every tag is what is at its middle', async ({ page }) => {
      await page.goto(`/?fixture=boards&story=${six}`);
      const tags = page.locator('#post-41').getByRole('list', { name: 'Cards played on this post' });
      await tags.getByRole('button', { name: 'Unstack 5 more cards played on this post' }).click();
      const listed = tags.locator('.kb-play-unstacked .kb-play-tag');
      await expect(listed).toHaveCount(5);
      const covered = await listed.evaluateAll((els) => els.flatMap((el, i) => {
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return at !== null && el.contains(at) ? [] : [`tag ${i + 1} is under ${at?.className ?? 'nothing'}`];
      }));
      expect(covered).toEqual([]);
    });

    test('names every caster in the glass\'s face, in capitals, never the board\'s Verdana', async ({ page }) => {
      await page.goto(`/?fixture=boards&story=${story}`);
      const tags = page.locator('#post-41').getByRole('list', { name: 'Cards played on this post' });
      await tags.getByRole('button', { name: /^Unstack/u }).click();
      const names = tags.locator('.kb-play-tag-who');
      await expect(names).toHaveCount(3);
      for (const style of await names.evaluateAll((els) => els.map((el) => { const s = getComputedStyle(el); return { family: s.fontFamily, transform: s.textTransform }; }))) {
        expect(style.family).not.toMatch(/verdana/iu);
        expect(style.transform).toBe('uppercase');
      }
    });
  });
}
