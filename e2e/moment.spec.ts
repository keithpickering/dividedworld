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
  test(`the moment's tag and list cover no words outside the moment, and the list stands in the post's foot (${story})`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto(`/?fixture=boards&story=${story}`);
    const moment = page.locator('#post-41 .kb-moment');
    await expect(moment).toBeVisible({ timeout: 15_000 });
    /* The list is the frame's small print and no part of the post (the owner, 2026-11-21): first in the post's foot, out of the content area an effect fills. */
    const list = page.locator('#post-41 .kb-act-foot > .kb-moment-list[data-kb-strip]');
    await expect(list).toBeVisible();
    expect(await list.evaluate((el) => el.closest('[data-kb-content-area]'))).toBeNull();
    expect(await list.evaluate((el) => el.parentElement!.firstElementChild === el || getComputedStyle(el).order === '-1')).toBe(true);
    const covered = await page.evaluate(() => {
      const box = document.querySelector('#post-41 .kb-moment')!;
      const strip = document.querySelector<HTMLElement>('#post-41 .kb-moment-list')!;
      const hung = [...box.querySelectorAll<HTMLElement>('.kb-moment-tag'), strip].map((el) => el.getBoundingClientRect());
      const meets = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      /* Every run of words on the page outside the moment and outside the floating Lens, by the box of its text. */
      const out: string[] = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const el = n.parentElement;
        /* In the thread the tag hangs over the post's own date, which the moment stands in for while it shows (the owner, 2026-11-06: "Moving it up to cover the post date works"). */
        if (!el || !n.textContent?.trim() || box.contains(el) || strip.contains(el) || el.closest('.kb-float, [hidden], .kb-visually-hidden, #post-41 .kb-act-meta > time')) continue;
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
 * edges accordingly, so it can show the effect accurately"), and a mask (the owner, 2026-11-21: the chamfered area "does not act as a true
 * mask, the effect area overflows it"): in the thread its ring is the body's box (`.kb-act-main`), border to border and bar to bar, the words'
 * wrapper is cut to that box along the ring's chamfers, and nothing else between an effect drawn in the moment and the body clips it. Held on #41
 * with Whoops!'s moment shown, at a desktop's width and a phone's.
 */
for (const { story, size } of [
  { story: 'boards-01-lens--washed-clean-as-it-landed', size: { width: 1440, height: 1120 } },
  { story: 'boards-01-lens--washed-clean-as-it-landed-phone', size: { width: 390, height: 844 } },
]) {
  test(`the moment's frame is the post body's edge, and masks the effect along it (${story})`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto(`/?fixture=boards&story=${story}`);
    const moment = page.locator('#post-41 .kb-moment');
    await expect(moment).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#post-41 .kb-moment [data-kb-effect-ink]').first()).toBeAttached();
    /*
     * Asked until it holds, not once. The ring is placed by a ResizeObserver (Moment.tsx, useRing), which the browser answers when it
     * next renders, so for the one frame after the body changes height the ring is still where the body was. A single reading that
     * lands in that frame fails on a page with nothing wrong: 1 run in 200 here, and once in CI ("the ring's bottom is 553, the body's
     * is 533"), which a probe reproduces exactly by shrinking the body 20px and measuring in the same task (-20 at once, 0 a frame
     * later). A ring that does not follow the body never comes to hold, and still fails.
     */
    const read = () => page.evaluate(() => {
      const out: string[] = [];
      const cell = document.querySelector<HTMLElement>('#post-41 .kb-act-main')!;
      const ring = document.querySelector<HTMLElement>('#post-41 .kb-moment-ring');
      const words = document.querySelector<HTMLElement>('#post-41 .kb-moment-body')!;
      if (!ring) return ['the moment draws no ring'];
      const c = cell.getBoundingClientRect(), r = ring.getBoundingClientRect();
      for (const k of ['left', 'top', 'right', 'bottom'] as const) {
        if (Math.abs(c[k] - r[k]) > 1) out.push(`the ring's ${k} is ${Math.round(r[k])}, the body's is ${Math.round(c[k])}`);
      }
      /* The mask: the words' wrapper is cut, and its cut is the ring's box. */
      if (getComputedStyle(words).clipPath === 'none') out.push('the moment does not mask what it draws');
      const w = words.getBoundingClientRect(), s = words.style;
      const cut = { left: w.left + parseFloat(s.getPropertyValue('--kb-moment-clip-left')), top: w.top + parseFloat(s.getPropertyValue('--kb-moment-clip-top')) };
      const cutBox = { ...cut, right: cut.left + parseFloat(s.getPropertyValue('--kb-moment-clip-w')), bottom: cut.top + parseFloat(s.getPropertyValue('--kb-moment-clip-h')) };
      for (const k of ['left', 'top', 'right', 'bottom'] as const) {
        if (!(Math.abs(cutBox[k] - r[k]) <= 1)) out.push(`the mask's ${k} is ${Math.round(cutBox[k])}, the ring's is ${Math.round(r[k])}`);
      }
      /* Every other element from an effect's ink up to the body: none may clip what it holds. */
      for (const ink of document.querySelectorAll<HTMLElement>('#post-41 .kb-moment [data-kb-effect-ink]')) {
        for (let el = ink.parentElement; el && el !== cell; el = el.parentElement) {
          const st = getComputedStyle(el);
          if (el !== words && st.clipPath !== 'none') out.push(`${el.className} clips the effect with a clip-path`);
          if (st.overflow !== 'visible' && st.overflow !== 'visible visible') out.push(`${el.className} clips the effect (overflow ${st.overflow})`);
        }
      }
      /* A point past the ring's top right chamfer, inside the body's box, is cut: what is drawn there is not the moment's. */
      const corner = document.elementFromPoint(r.right - 3, r.top + 3);
      if (corner && words.contains(corner)) out.push('the top right chamfer does not cut the effect');
      return [...new Set(out)];
    });
    await expect.poll(read, { timeout: 5_000 }).toEqual([]);
  });
}

/**
 * On a phone the Lens's sheet is held low while a moment shows (the owner, 2026-11-21: at its full height the sheet "takes up about 75% of the
 * screen", and a quick effect plays out of sight): the moment's whole content area stands in the window above it.
 */
test('on a phone the sheet is held low under a shown moment, and the moment stands whole above it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?fixture=boards&story=boards-01-marks--as-it-landed-phone');
  await expect(page.locator('#post-41 .kb-moment')).toBeVisible({ timeout: 15_000 });
  const read = () => page.evaluate(() => {
    const area = document.querySelector<HTMLElement>('#post-41 .kb-act-main')!.getBoundingClientRect();
    const sheet = document.querySelector<HTMLElement>('.kb-float-box')!.getBoundingClientRect();
    const out: string[] = [];
    if (area.top < 0) out.push(`the moment's top is ${Math.round(area.top)}, above the window`);
    if (area.bottom > sheet.top + 1) out.push(`the moment's foot is at ${Math.round(area.bottom)}, under the sheet's top at ${Math.round(sheet.top)}`);
    if (sheet.height > window.innerHeight * 0.3) out.push(`the sheet is ${Math.round(sheet.height)}px, more than 30% of the window`);
    return out;
  });
  await expect.poll(read, { timeout: 5_000 }).toEqual([]);
});

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

/**
 * Reset is in the tag (docs/plans/2026-11-16-playable-moments-design.md, section 4): "As it landed · Reset · Back to now", Reset first, and the longer tag still stops short of the date
 * bar's marks and stays inside the page, at a desktop's width and a phone's.
 */
for (const { story, size } of [
  { story: 'boards-01-marks--as-it-landed', size: { width: 1440, height: 1120 } },
  { story: 'boards-01-marks--as-it-landed-phone', size: { width: 390, height: 844 } },
  { story: 'boards-01-lens--washed-clean-as-it-landed', size: { width: 1440, height: 1120 } },
  { story: 'boards-01-lens--washed-clean-as-it-landed-phone', size: { width: 390, height: 844 } },
]) {
  test(`Reset is in the tag before Back to now, and the tag still clears the marks (${story})`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto(`/?fixture=boards&story=${story}`);
    await expect(page.locator('#post-41 .kb-moment')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const tag = page.locator('#post-41 .kb-moment-tag');
    const reset = tag.getByRole('button', { name: 'Reset', exact: true });
    const back = tag.getByRole('button', { name: 'Back to now', exact: true });
    await expect(reset).toBeVisible();
    await expect(back).toBeVisible();
    const problems = await page.evaluate(() => {
      const out: string[] = [];
      const tagEl = document.querySelector<HTMLElement>('#post-41 .kb-moment-tag')!;
      const t = tagEl.getBoundingClientRect();
      const r = tagEl.querySelector('.kb-moment-reset')!.getBoundingClientRect();
      const b = tagEl.querySelector('.kb-moment-back')!.getBoundingClientRect();
      if (r.right > b.left + 1 && r.top < b.bottom && b.top < r.bottom) out.push('Reset is not before Back to now');
      if (t.left < -1 || t.right > window.innerWidth + 1) out.push(`the tag runs off the page (${Math.round(t.left)} to ${Math.round(t.right)} of ${window.innerWidth})`);
      for (const other of document.querySelectorAll<HTMLElement>('#post-41 .kb-act-meta > :not(time)')) {
        const o = other.getBoundingClientRect();
        if (o.width > 0 && t.right > o.left && t.left < o.right && t.top < o.bottom && o.top < t.bottom) out.push(`the tag runs into ${other.className}`);
      }
      return out;
    });
    expect(problems).toEqual([]);
  });
}
