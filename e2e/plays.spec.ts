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

/*
 * Room (the quality review of Task 3): the strip is out of the page's flow, so the row has to keep its own words clear of
 * it. #41 of the armed story carries a real ghost mark; five more marks are cloned in, so the strip is wider than any real
 * one (a post draws four and "+N" at most, and the ghost). No mark may touch the date or the "#n" link, and the height holds.
 */
for (const [label, viewport] of [['1440', { width: 1440, height: 1120 }], ['390', { width: 390, height: 844 }]] as const) {
  test.describe(`six kinds and the ghost mark on #41 at ${label}`, () => {
    test.use({ viewport });

    test('no mark meets the date or the permalink, the date gives way on one line, and the post keeps its height', async ({ page }) => {
      await page.goto('/?fixture=boards&story=boards-01-plate--splatted-and-armed');
      const post = page.locator('#post-41');
      await expect(post.locator('.kb-ghost-mark')).toBeVisible();
      await expect(post.locator('.kb-mark[data-kb-card]:not(.kb-ghost-mark)').first()).toBeVisible();
      const height = async () => (await post.boundingBox())!.height;
      const before = await height();
      await post.locator('.kb-marks').evaluate((strip) => {
        const first = strip.querySelector('.kb-mark:not(.kb-ghost-mark)')!;
        const ghost = strip.querySelector('.kb-ghost-mark')!;
        for (let i = 0; i < 5; i++) strip.insertBefore(first.cloneNode(true), ghost);
      });
      await expect(post.locator('.kb-mark')).toHaveCount(7);
      const rects = await post.evaluate((el) => {
        const r = (e: Element) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
        return {
          marks: [...el.querySelectorAll('.kb-mark')].map(r),
          time: r(el.querySelector('header time')!),
          number: r(el.querySelector('.kb-act-number')!),
          timeHeight: el.querySelector('header time')!.getBoundingClientRect().height,
          lineHeight: parseFloat(getComputedStyle(el.querySelector('header time')!).lineHeight) || 0,
          row: r(el.querySelector('header')!),
        };
      });
      const meets = (a: { l: number; r: number; t: number; b: number }, b: { l: number; r: number; t: number; b: number }) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
      for (const [i, m] of rects.marks.entries()) {
        expect(meets(m, rects.time), `mark ${i + 1} meets the date`).toBe(false);
        expect(meets(m, rects.number), `mark ${i + 1} meets the permalink`).toBe(false);
        expect(m.l).toBeGreaterThanOrEqual(0);
        expect(m.r).toBeLessThanOrEqual(viewport.width);
      }
      expect(await post.locator('header time').evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('nowrap');
      expect(await height(), 'the post keeps its height').toBe(before);
    });
  });
}

test.describe('the ghost mark and the edge', () => {
  test.use({ viewport: { width: 1440, height: 1120 } });

  test('the ghost takes the card\'s color over its alignment\'s', async ({ page }) => {
    await page.goto('/?fixture=boards&story=boards-01-plate--splatted-and-armed');
    const ghost = page.locator('#post-41 .kb-ghost-mark');
    await expect(ghost).toBeVisible();
    const same = await ghost.evaluate((el) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--kb-mark-color)';
      el.append(probe);
      const card = getComputedStyle(probe).color;
      probe.remove();
      return getComputedStyle(el).borderTopColor === card;
    });
    expect(same).toBe(true);
  });

  test.describe('in forced colors', () => {
    test.use({ forcedColors: 'active' });

    test('an edge keeps its fill: progress is still a gradient, not a full bar', async ({ page }) => {
      await page.goto('/?fixture=boards&story=boards-01-plays-on-a-post--six-plays');
      const mark = page.locator('#post-41 .kb-mark[data-kb-card]').first();
      await expect(mark).toBeVisible();
      const image = await mark.evaluate((el) => {
        const edge = document.createElement('span');
        edge.className = 'kb-mark-edge';
        el.style.setProperty('--kb-mark-progress', '0.4');
        el.append(edge);
        return getComputedStyle(edge).backgroundImage;
      });
      expect(image).toContain('linear-gradient');
    });
  });
});
