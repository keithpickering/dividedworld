import { expect, test } from '@playwright/test';

/**
 * A play's moment on its post (engine/ui/cards/Moment.tsx, moment.css; docs/plans/2026-11-03-effect-history-plan.md, Task 5), laid out
 * in the browser: the frame's tag and its list of what else was on the post stand on the moment's own room, and cover no words
 * outside it. A moment shown in a play-spun ORIGIN box has no Back to now, so words it covered there would stay covered for every
 * reader (the final review of #167, F2); this holds the frame to it, on #41 of the boards fixture at a desktop's width and a phone's.
 */
for (const { story, size } of [
  { story: 'boards-01-marks--as-it-landed', size: { width: 1440, height: 1120 } },
  { story: 'boards-01-marks--as-it-landed-phone', size: { width: 390, height: 844 } },
]) {
  test(`the moment's tag and list cover no words outside the moment (${story})`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto(`/?fixture=boards&story=${story}`);
    const moment = page.locator('#post-41 .kb-moment');
    await expect(moment).toBeVisible({ timeout: 15_000 });
    await expect(moment.locator('.kb-moment-list')).toBeVisible();
    const covered = await page.evaluate(() => {
      const box = document.querySelector('#post-41 .kb-moment')!;
      const hung = [...box.querySelectorAll<HTMLElement>('.kb-moment-tag, .kb-moment-list')].map((el) => el.getBoundingClientRect());
      const meets = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      /* Every run of words on the page outside the moment and outside the floating Lens, by the box of its text. */
      const out: string[] = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const el = n.parentElement;
        if (!el || !n.textContent?.trim() || box.contains(el) || el.closest('.kb-float, [hidden], .kb-visually-hidden')) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) if (r.width > 0 && hung.some((h) => meets(h, r))) out.push(n.textContent.trim().slice(0, 40));
      }
      return out;
    });
    expect(covered).toEqual([]);
  });
}
