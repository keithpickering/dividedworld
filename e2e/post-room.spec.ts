import { expect, test } from '@playwright/test';

/**
 * Every post has room for a card to be worth playing on (the owner, 2026-11-06: "posts should have a min-height so it's never a waste
 * of time to play a card even if someone wrote a single line with no avatar/sig"; 2026-11-14: the natural height of a post on desktop
 * with a 1:2 avatar is the right one, and it carries over to a phone): a post's body (`.kb-act-main`, where a card's effect is drawn)
 * stands at least 22.5em tall, stacked on a phone where no postbit beside it lends it height, and side by side. The reactions row stands
 * at the foot of the body, not straight under the words, so the room a short post is given lies between the words and the row. A line
 * of the game's (an unmask, a move's end) is no post and keeps its own height. Held on the boards fixture's Main thread at both widths.
 *
 * The bodies are found by the post they are in, wherever in the post the grid puts them: the first version of this spec read
 * `.kb-act > .kb-act-main`, and when the cells moved into `.kb-act-grid` it matched no body and passed for weeks with the rule gone.
 * So each test first holds that it found posts at all.
 */
const POSTS = '.kb-act:is([data-kb-kind="post"], [data-kb-kind="spin"]) .kb-act-main';

for (const size of [{ width: 1440, height: 1120 }, { width: 390, height: 844 }]) {
  test(`every post's body is at least 22.5em tall (${size.width}px)`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/?fixture=boards&story=boards-01-marks--one-play');
    await expect(page.locator('.kb-act[data-kb-kind="post"]').first()).toBeVisible({ timeout: 15_000 });
    const bodies = await page.evaluate((sel) => [...document.querySelectorAll<HTMLElement>(sel)].map((el) => ({
      id: el.closest('article')!.id,
      height: el.getBoundingClientRect().height,
      em: parseFloat(getComputedStyle(el).fontSize),
    })), POSTS);
    expect(bodies.length, 'the spec finds the posts it measures').toBeGreaterThan(1);
    expect(bodies.filter((b) => b.height + 0.5 < 22.5 * b.em).map((b) => `${b.id}: ${Math.round(b.height)}px`)).toEqual([]);
  });

  test(`a short post's reactions row stands at the foot of its body (${size.width}px)`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/?fixture=boards&story=boards-01-cards-beyond-a-post--thread');
    await expect(page.locator('.kb-act[data-kb-kind="post"] .kb-reactions').first()).toBeVisible({ timeout: 15_000 });
    /* Each post body with a reactions row: how far the row (and the signature, if one follows it) stands from the foot of the body's content. */
    const rows = await page.evaluate((sel) => [...document.querySelectorAll<HTMLElement>(sel)].filter((m) => m.querySelector(':scope > .kb-reactions')).map((m) => {
      const box = m.getBoundingClientRect();
      const foot = box.bottom - parseFloat(getComputedStyle(m).paddingBottom);
      const last = [...m.children].filter((c) => (c as HTMLElement).offsetParent !== null).at(-1)!;
      const row = m.querySelector(':scope > .kb-reactions')!.getBoundingClientRect();
      const words = m.querySelector(':scope > .kb-reactions')!.previousElementSibling!.getBoundingClientRect();
      return { id: m.closest('article')!.id, gap: foot - last.getBoundingClientRect().bottom, room: row.top - words.bottom, em: parseFloat(getComputedStyle(m).fontSize) };
    }), POSTS);
    expect(rows.length, 'the spec finds posts with a reactions row').toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.gap, `${r.id}: nothing stands under the row's block at the foot of the body`).toBeLessThan(1);
      expect(r.room, `${r.id}: the row keeps at least its own margin from the words`).toBeGreaterThanOrEqual(0.6 * r.em - 0.5);
    }
  });
}
