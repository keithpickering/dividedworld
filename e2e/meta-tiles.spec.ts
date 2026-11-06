import { expect, test } from '@playwright/test';

/**
 * The meta tile (docs/plans/2026-11-06-meta-acts-design.md, sections 1 and 5): every mark is one 2.25rem tile and answers a hover.
 */
test.use({ bypassCSP: true, reducedMotion: 'reduce', deviceScaleFactor: 1, viewport: { width: 1440, height: 900 } });

test('every mark is a 36px tile and answers a hover', async ({ page }) => {
  await page.goto('/?fixture=boards&moment=01-main');
  const marks = page.locator('.kb-mark');
  await expect(marks.first()).toBeVisible();
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  const heights = await marks.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(heights.length).toBeGreaterThan(0);
  for (const h of heights) expect(Math.abs(h - 36)).toBeLessThanOrEqual(1);

  const first = marks.first();
  const look = () => first.evaluate((el) => { const cs = getComputedStyle(el); return `${cs.borderTopColor}|${cs.backgroundColor}`; });
  await page.mouse.move(0, 0);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const before = await look();
  await first.scrollIntoViewIfNeeded();
  await first.hover();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  expect(await look()).not.toBe(before);
});

/* The tile is 36px; the bar it hangs on is about 30px, so a mark overhangs it by a few pixels each side and no more. */
const OVERHANG = 4;
const STORY = '/?fixture=boards&story=boards-01-cards-beyond-a-post--';

for (const [label, size] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]] as const) {
  test.describe(`the date bar holds the strip (${label})`, () => {
    test.use({ viewport: size });

    test('a bar with marks is as tall as one with none, and at least 29px', async ({ page }) => {
      await page.goto('/?fixture=boards&moment=01-main');
      await expect(page.locator('#post-41 .kb-mark').first()).toBeVisible();
      const bars = await page.evaluate(() => {
        const all = [...document.querySelectorAll<HTMLElement>('.kb-act-main')].map((main) => {
          const post = main.closest('[id^="post-"]')!;
          return { marks: post.querySelectorAll('.kb-act-meta .kb-mark').length, h: post.querySelector('header.kb-act-meta')!.getBoundingClientRect().height };
        });
        return { withMarks: all.find((a) => a.marks > 0)!, without: all.find((a) => a.marks === 0)! };
      });
      expect(bars.withMarks.h).toBeGreaterThanOrEqual(29);
      expect(Math.abs(bars.withMarks.h - bars.without.h)).toBeLessThanOrEqual(0.5);
    });

    test('each mark hangs no more than 4px past its bar, and clear of the first line of words', async ({ page }) => {
      await page.goto('/?fixture=boards&moment=01-main');
      await expect(page.locator('#post-41 .kb-mark').first()).toBeVisible();
      const found = await page.evaluate(() => {
        const out: { over: number[]; hit: boolean }[] = [];
        for (const mark of document.querySelectorAll<HTMLElement>('.kb-act-meta .kb-mark')) {
          const post = mark.closest('[id^="post-"]')!;
          const bar = post.querySelector('header.kb-act-meta')!.getBoundingClientRect();
          const m = mark.getBoundingClientRect();
          const walker = document.createTreeWalker(post.querySelector('.kb-act-main')!, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent ?? '').trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
          const text = walker.nextNode();
          let hit = false;
          if (text) {
            const range = document.createRange();
            range.selectNodeContents(text);
            const first = [...range.getClientRects()].filter((r) => r.width > 0);
            const top = Math.min(...first.map((r) => r.top));
            hit = first.filter((r) => Math.abs(r.top - top) < 2).some((r) => r.left < m.right && r.right > m.left && r.top < m.bottom && r.bottom > m.top);
          }
          out.push({ over: [bar.top - m.top, m.bottom - bar.bottom], hit });
        }
        return out;
      });
      expect(found.length).toBeGreaterThan(0);
      for (const f of found) {
        expect(f.over[0]!).toBeLessThanOrEqual(OVERHANG);
        expect(f.over[1]!).toBeLessThanOrEqual(OVERHANG);
        expect(f.hit).toBe(false);
      }
    });
  });
}

test.describe('the strips beyond a post add no height', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const height = (page: import('@playwright/test').Page, selector: string) => page.locator(selector).first().evaluate((el) => el.getBoundingClientRect().height);

  test('the thread head is as tall with a play as with none, and reserves a tile', async ({ page }) => {
    await page.goto('/?fixture=boards&moment=01-main');
    await expect(page.locator('.kb-thread-head')).toBeVisible();
    const bare = await height(page, '.kb-thread-head');
    await page.goto(`${STORY}thread`);
    await expect(page.locator('.kb-thread-head-marks .kb-mark').first()).toBeVisible();
    const played = await height(page, '.kb-thread-head');
    expect(Math.abs(played - bare)).toBeLessThanOrEqual(0.5);
    expect(bare).toBeGreaterThanOrEqual(36);
  });

  test('the board banner is as tall with a play as with none, and reserves a tile', async ({ page }) => {
    await page.goto('/?fixture=boards&moment=01-main');
    await page.locator('a[href="/b/general"]').first().click();
    await expect(page.locator('.kb-board-banner')).toBeVisible();
    const bare = await height(page, '.kb-board-banner');
    await page.goto(`${STORY}banner`);
    await expect(page.locator('.kb-board-banner-marks .kb-mark').first()).toBeVisible();
    const played = await height(page, '.kb-board-banner');
    expect(Math.abs(played - bare)).toBeLessThanOrEqual(0.5);
    expect(bare).toBeGreaterThanOrEqual(36);
  });

  test('a pinned row is as tall as an unpinned one', async ({ page }) => {
    await page.goto(`${STORY}pinned`);
    await expect(page.locator('.kb-thread-pin-mark .kb-mark').first()).toBeVisible();
    const rows = await page.evaluate(() => {
      const pinned = document.querySelector('.kb-thread-pinned > tr')!.getBoundingClientRect().height;
      const other = [...document.querySelectorAll('tr.kb-thread-row')].find((r) => !r.closest('.kb-thread-pinned'))!.getBoundingClientRect().height;
      return { pinned, other };
    });
    expect(Math.abs(rows.pinned - rows.other)).toBeLessThanOrEqual(1.5);
  });
});

test('a ghost mark has no glow', async ({ page }) => {
  await page.goto('/?fixture=boards&story=boards-01-marks--armed');
  const ghost = page.locator('#post-41 .kb-ghost-mark');
  await expect(ghost).toBeVisible();
  expect(await ghost.evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
});

test('a focused ghost mark keeps the ring\'s ink layer', async ({ page }) => {
  await page.goto('/?fixture=boards&story=boards-01-marks--armed');
  const ghost = page.locator('#post-41 .kb-ghost-mark');
  await expect(ghost).toBeVisible();
  for (let i = 0; i < 80 && !(await ghost.evaluate((el) => el.matches(':focus-visible'))); i++) await page.keyboard.press('Tab');
  expect(await ghost.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  expect(await ghost.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
});
