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
        /* In the thread the tag hangs over the post's own date, which the moment stands in for while it shows (the owner, 2026-11-06: "Moving it up to cover the post date works"). */
        if (!el || !n.textContent?.trim() || box.contains(el) || el.closest('.kb-float, [hidden], .kb-visually-hidden, #post-41 .kb-act-meta > time')) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) if (r.width > 0 && hung.some((h) => meets(h, r))) out.push(n.textContent.trim().slice(0, 40));
      }
      return out;
    });
    expect(covered).toEqual([]);
  });
}

/**
 * The moment's frame is the post body's own edge (the owner, 2026-11-06: "the 'As it landed' frame should extend all the way to the
 * edges accordingly, so it can show the effect accurately"): in the thread its ring is the body's box (`.kb-act-main`), border to
 * border and bar to bar, and nothing between an effect drawn in the moment and the body clips it, so a splat that reaches the body's
 * corners live reaches them as it landed too. Held on #41 with Whoops!'s moment shown, at a desktop's width and a phone's.
 */
for (const { story, size } of [
  { story: 'boards-01-lens--washed-clean-as-it-landed', size: { width: 1440, height: 1120 } },
  { story: 'boards-01-lens--washed-clean-as-it-landed-phone', size: { width: 390, height: 844 } },
]) {
  test(`the moment's frame is the post body's edge, and clips no effect inside it (${story})`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto(`/?fixture=boards&story=${story}`);
    const moment = page.locator('#post-41 .kb-moment');
    await expect(moment).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#post-41 .kb-moment [data-kb-effect-ink]').first()).toBeAttached();
    const problems = await page.evaluate(() => {
      const out: string[] = [];
      const cell = document.querySelector<HTMLElement>('#post-41 .kb-act-main')!;
      const ring = document.querySelector<HTMLElement>('#post-41 .kb-moment-ring');
      if (!ring) return ['the moment draws no ring'];
      const c = cell.getBoundingClientRect(), r = ring.getBoundingClientRect();
      for (const k of ['left', 'top', 'right', 'bottom'] as const) {
        if (Math.abs(c[k] - r[k]) > 1) out.push(`the ring's ${k} is ${Math.round(r[k])}, the body's is ${Math.round(c[k])}`);
      }
      /* Every element from an effect's ink up to the body: none may clip what it holds. */
      for (const ink of document.querySelectorAll<HTMLElement>('#post-41 .kb-moment [data-kb-effect-ink]')) {
        for (let el = ink.parentElement; el && el !== cell; el = el.parentElement) {
          const s = getComputedStyle(el);
          if (s.clipPath !== 'none') out.push(`${el.className} clips the effect with a clip-path`);
          if (s.overflow !== 'visible' && s.overflow !== 'visible visible') out.push(`${el.className} clips the effect (overflow ${s.overflow})`);
        }
      }
      return [...new Set(out)];
    });
    expect(problems).toEqual([]);
  });
}

/**
 * The tag takes no room in the post (the owner, 2026-11-06: "position:absolute the 'As it landed' label so it doesn't reflow the post
 * ... Moving it up to cover the post date works"): in the thread it hangs on the date bar, its foot on the body's top edge, out of the
 * post's flow, so the words stand where they stood when the play landed; and it stops short of the date bar's marks and permalink
 * ("not to rub up against the Marks on the right"), at a desktop's width and a phone's.
 */
for (const { story, size } of [
  { story: 'boards-01-lens--washed-clean-as-it-landed', size: { width: 1440, height: 1120 } },
  { story: 'boards-01-lens--washed-clean-as-it-landed-phone', size: { width: 390, height: 844 } },
  { story: 'boards-01-marks--as-it-landed-phone', size: { width: 390, height: 844 } },
]) {
  test(`the tag hangs on the date bar, out of the post's flow and clear of the marks (${story})`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto(`/?fixture=boards&story=${story}`);
    await expect(page.locator('#post-41 .kb-moment')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const problems = await page.evaluate(() => {
      const out: string[] = [];
      const tag = document.querySelector<HTMLElement>('#post-41 .kb-moment-tag')!;
      const cell = document.querySelector<HTMLElement>('#post-41 .kb-act-main')!;
      const body = document.querySelector<HTMLElement>('#post-41 .kb-moment-body')!;
      if (getComputedStyle(tag).position !== 'absolute') out.push(`the tag is ${getComputedStyle(tag).position}, in the post's flow`);
      const t = tag.getBoundingClientRect(), c = cell.getBoundingClientRect(), b = body.getBoundingClientRect();
      if (Math.abs(t.bottom - c.top) > 1) out.push(`the tag's foot is at ${Math.round(t.bottom)}, the body's top at ${Math.round(c.top)}`);
      /* The words begin at the body's own padding, as on a post with no moment shown. */
      const pad = parseFloat(getComputedStyle(cell).paddingTop) + cell.clientTop;
      if (Math.abs(b.top - (c.top + pad)) > 1) out.push(`the words start ${Math.round(b.top - c.top)}px into the body, not ${Math.round(pad)}px`);
      for (const other of document.querySelectorAll<HTMLElement>('#post-41 .kb-act-meta > :not(time)')) {
        const o = other.getBoundingClientRect();
        if (o.width > 0 && t.right > o.left && t.left < o.right && t.top < o.bottom && o.top < t.bottom) out.push(`the tag runs into ${other.className}`);
      }
      return out;
    });
    expect(problems).toEqual([]);
  });
}
