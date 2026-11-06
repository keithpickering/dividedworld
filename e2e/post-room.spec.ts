import { expect, test } from '@playwright/test';

/**
 * Every post has room for a card to be worth playing on (the owner, 2026-11-06: "posts should have a min-height so it's never a waste
 * of time to play a card even if someone wrote a single line with no avatar/sig"): a post's body (`.kb-act-main`, where a card's
 * effect is drawn) stands at least 8em tall, stacked on a phone where no postbit beside it lends it height, and side by side. A line of
 * the game's (an unmask, a move's end) is no post and keeps its own height. Held on the boards fixture's Main thread at both widths.
 */
for (const size of [{ width: 1440, height: 1120 }, { width: 390, height: 844 }]) {
  test(`every post's body is at least 8em tall (${size.width}px)`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/?fixture=boards&story=boards-01-marks--one-play');
    await expect(page.locator('.kb-act[data-kb-kind="post"]').first()).toBeVisible({ timeout: 15_000 });
    const short = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.kb-act:is([data-kb-kind="post"], [data-kb-kind="spin"]) > .kb-act-main')]
      .filter((el) => el.getBoundingClientRect().height + 0.5 < 8 * parseFloat(getComputedStyle(el).fontSize))
      .map((el) => `${el.closest('article')!.id}: ${Math.round(el.getBoundingClientRect().height)}px`));
    expect(short).toEqual([]);
  });
}
