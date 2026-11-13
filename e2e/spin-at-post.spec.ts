import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * A thread spun from a card on a character, as a browser draws it (docs/plans/2026-11-12-spin-at-post-plan.md, Task 8). On Divided World's
 * seed (the Glitter Bomb story, instances/divided-world/ui/glitter-bomb/Glitter.board.stories.tsx: post #41's character, a Glitter Bomb
 * cast on it from #41): the spinner presses Spin thread on the card's mark on a later post by that character. The new thread's ORIGIN box
 * shows that post as it was spun, with the glitter painted under its words; its head links the pressed post and, on a second line, the post
 * the card was cast from, and the character's name and avatar are one link to its profile.
 *
 * It also holds the fix of the linked character's avatar (engine/ui/mini.css): the initial a character with no picture draws is no link
 * text (not underlined, not in the link's color), and the name beside it is the link's underline.
 */
const STORY = '/?fixture=boards&story=boards-09-glitter-bomb--still';
const MARK = '.kb-postbit .kb-mark[data-kb-card="glitter-bomb"]';

/** The seq of the post a postbit's mark is on. */
const seqOf = (mark: Locator): Promise<number> => mark.evaluate((el) => Number(el.closest('article')!.getAttribute('data-kb-seq')));

/** Presses Spin thread on the mark of a post later than #41 by the card's character; returns that post's seq. */
async function spinFromLaterPost(page: Page): Promise<number> {
  await page.goto(STORY);
  await expect.poll(() => page.locator(MARK).count()).toBeGreaterThan(0);
  const marks = page.locator(MARK);
  let pressed: Locator | null = null;
  let seq = 0;
  for (let i = 0; i < await marks.count(); i++) {
    const s = await seqOf(marks.nth(i));
    if (s > 41) { pressed = marks.nth(i); seq = s; break; }
  }
  expect(pressed, 'a post later than #41 by the same character, with the mark').not.toBeNull();
  await pressed!.scrollIntoViewIfNeeded();
  await pressed!.click();
  const lens = page.getByRole('dialog', { name: 'Cards on this character' });
  await lens.getByRole('button', { name: /^1 play/u }).click();
  await lens.getByRole('button', { name: 'Spin thread' }).click();
  const form = page.getByRole('form', { name: /^Spin a thread from /u });
  await form.getByLabel('Thread title').fill('About the shine');
  await form.getByRole('button', { name: 'Spin thread' }).click();
  return seq;
}

test('a spin pressed on a later post shows that post as it was spun, under a head with both posts linked and the profile', async ({ page }) => {
  const seq = await spinFromLaterPost(page);
  const box = page.getByRole('group', { name: 'Origin' });
  await expect(box).toBeVisible();
  const frame = box.getByRole('group', { name: /^As it was spun/u });
  await expect(frame).toBeVisible();
  /* The glitter is painted under the post's words in the box: a canvas, with pixels. */
  const canvas = box.locator('[data-kb-glitter] canvas.dw-glitter-under').first();
  await expect(canvas).toBeAttached();
  await expect.poll(() => canvas.evaluate((cv: HTMLCanvasElement) => {
    const { data } = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height);
    for (let i = 3; i < data.length; i += 4 * 13) if (data[i]! > 0) return true;
    return false;
  })).toBe(true);
  const head = box.locator('.kb-origin-head-text');
  await expect(head).toContainText('as it was spun');
  await expect(head.locator('.kb-origin-head-line')).toContainText('Cast from #41 in ');
  /* Both posts are linked, to the posts as they are now: the pressed one by its number, the cast-from one beside "Cast from". */
  const pressedLink = head.locator(`a:text-matches("^#${seq} in ")`);
  const castLink = head.locator('.kb-origin-head-line a');
  expect(await pressedLink.getAttribute('href')).toMatch(new RegExp(`^/t/[^/?#]+\\?page=\\d+#post-${seq}$`, 'u'));
  expect(await castLink.getAttribute('href')).toMatch(/^\/t\/[^/?#]+\?page=\d+#post-41$/u);
  /* The character's name and avatar are one link to its profile, in the head and in the byline. */
  const profile = box.locator('a.kb-who-link');
  await expect(profile).toHaveCount(2);
  for (const link of await profile.all()) expect(await link.getAttribute('href')).toMatch(/^\/c\/[^/?#]+$/u);
});

test('a linked character\'s avatar initial is no link text: not underlined, not in the link\'s color, while the name is underlined', async ({ page }) => {
  await spinFromLaterPost(page);
  const link = page.getByRole('group', { name: 'Origin' }).locator('a.kb-who-link').first();
  await expect(link).toBeVisible();
  const read = await link.evaluate((a) => {
    const initial = a.querySelector('.kb-mini-none');
    const name = a.querySelector('.kb-who-name')!;
    return {
      initial: initial ? { line: getComputedStyle(initial).textDecorationLine, color: getComputedStyle(initial).color } : null,
      linkLine: getComputedStyle(a).textDecorationLine,
      nameLine: getComputedStyle(name).textDecorationLine,
      link: getComputedStyle(a).color,
    };
  });
  expect(read.initial, 'a character with no picture draws an initial').not.toBeNull();
  /* An underline on the link is drawn through the initial whatever the initial's own property says, so the link's must be none too. */
  expect(read.linkLine).toBe('none');
  expect(read.initial!.line).toBe('none');
  expect(read.initial!.color).not.toBe(read.link);
  expect(read.nameLine).toBe('underline');
});
