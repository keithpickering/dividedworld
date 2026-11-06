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

    test('a bar with marks is as tall as one with none, 29 to 31px', async ({ page }) => {
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
      expect(bars.withMarks.h).toBeLessThanOrEqual(31);
      expect(Math.abs(bars.withMarks.h - bars.without.h)).toBeLessThanOrEqual(0.5);
    });

    test('each mark hangs over its bar by 1 to 4px each side, and clear of the first line of words', async ({ page }) => {
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
        for (const o of f.over) {
          expect(o).toBeGreaterThan(0);
          expect(o).toBeLessThanOrEqual(OVERHANG);
        }
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
    /* The General banner is taller than a tile on its own, so the reservation is read as the rule: the computed min-height is the tile. */
    for (const sel of ['.kb-board-banner']) expect(await page.locator(sel).first().evaluate((el) => parseFloat(getComputedStyle(el).minHeight))).toBeCloseTo(36, 0);
    await page.goto('/?fixture=boards&moment=01-main');
    expect(await page.locator('.kb-thread-head').evaluate((el) => parseFloat(getComputedStyle(el).minHeight))).toBeCloseTo(36, 0);
  });

  test('a pinned row is as tall as an unpinned one, and the pin mark adds one line of words to it', async ({ page }) => {
    await page.goto(`${STORY}pinned`);
    await expect(page.locator('.kb-thread-pin-mark .kb-mark').first()).toBeVisible();
    const rows = await page.evaluate(() => {
      const pinned = document.querySelector('.kb-thread-pinned > tr')!.getBoundingClientRect().height;
      const other = [...document.querySelectorAll('tr.kb-thread-row')].find((r) => !r.closest('.kb-thread-pinned'))!.getBoundingClientRect().height;
      const pin = document.querySelector<HTMLElement>('.kb-thread-pin-mark')!;
      const cs = getComputedStyle(pin);
      const probe = document.createElement('span');
      probe.style.cssText = 'display:inline-block;height:1lh;width:0';
      pin.parentElement!.append(probe);
      const line = probe.getBoundingClientRect().height;
      probe.remove();
      return { pinned, other, box: pin.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom), line };
    });
    expect(Math.abs(rows.pinned - rows.other)).toBeLessThanOrEqual(1.5);
    /* The tile straddles its row: its margin box is one line of the title's words, so the row grows by nothing. */
    expect(Math.abs(rows.box - rows.line)).toBeLessThanOrEqual(1);
  });

  for (const [scene, title] of [['thread', '.kb-thread-head > h1'], ['banner', '.kb-board-banner > h1']] as const) {
    test(`the ${scene} strip is centered on its title's line`, async ({ page }) => {
      await page.goto(`${STORY}${scene}`);
      const mark = page.locator('.kb-thread-head-marks .kb-mark, .kb-board-banner-marks .kb-mark').first();
      await expect(mark).toBeVisible();
      const d = await page.evaluate((sel) => {
        const h = document.querySelector(sel)!;
        const range = document.createRange();
        range.selectNodeContents(h);
        const line = range.getClientRects()[0]!;
        const m = document.querySelector('.kb-thread-head-marks .kb-mark, .kb-board-banner-marks .kb-mark')!.getBoundingClientRect();
        return (m.top + m.bottom) / 2 - (line.top + line.bottom) / 2;
      }, title);
      expect(Math.abs(d)).toBeLessThanOrEqual(2);
    });
  }
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

/* Reactions are tiles too (meta acts design, sections 1 and 6): 36px, a button where the player may react, one tab stop for a row. */
test('every reaction tile is 36px tall', async ({ page }) => {
  await page.goto('/?fixture=boards&moment=01-main');
  const tiles = page.locator('.kb-reaction');
  await expect(tiles.first()).toBeVisible();
  const heights = await tiles.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(heights.length).toBeGreaterThan(0);
  for (const h of heights) expect(Math.abs(h - 36)).toBeLessThanOrEqual(1);
});

/* `01-main`'s posts that are another's carry no reactions yet, so the tiles that are buttons are read on `03-react`, the same thread with the HUD character on another's post. */
test.describe('a reaction tile that is a button', () => {
  const MOMENT = '/?fixture=boards&moment=03-react';

  test('the first free tile on another\'s post answers a hover, and pressing it raises its count by one and keeps focus', async ({ page }) => {
    await page.goto(MOMENT);
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
    const tile = page.locator('#post-41 button.kb-reaction:not([aria-disabled="true"]):not(.kb-react-button)').first();
    await expect(tile).toBeVisible();
    expect(Math.abs((await tile.boundingBox())!.height - 36)).toBeLessThanOrEqual(1);
    const look = () => tile.evaluate((el) => { const cs = getComputedStyle(el); return `${cs.borderTopColor}|${cs.backgroundColor}`; });
    await page.mouse.move(0, 0);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const before = await look();
    await tile.hover();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await look()).not.toBe(before);

    /* The tile is free until pressed, so it is held by its kind from here. */
    const key = (await tile.getAttribute('data-kb-reaction'))!;
    const same = page.locator(`#post-41 [data-kb-reaction="${key}"]`);
    const count = async () => Number((await same.locator('.kb-meta-tile-in').textContent())!.trim().split(/\s+/).pop());
    const n = await count();
    await same.click();
    await expect.poll(count).toBe(n + 1);
    await expect(same).toBeFocused();
  });

  test('two posts\' rows each take one Tab: from the first row\'s stop, Tab goes past the rest of that row', async ({ page }) => {
    await page.goto(MOMENT);
    const rows = page.locator('#post-41 .kb-reactions, #post-42 .kb-reactions');
    await expect(rows).toHaveCount(2);
    for (const row of await rows.all()) expect(await row.locator('[data-kb-stop][tabindex="0"]').count()).toBe(1);
    const stop = page.locator('#post-41 .kb-reactions [data-kb-stop][tabindex="0"]');
    await stop.focus();
    await expect(stop).toBeFocused();
    await page.keyboard.press('Tab');
    const inRow = await page.evaluate(() => !!document.activeElement?.closest('#post-41 .kb-reactions'));
    expect(inRow).toBe(false);
    /* And from the second row's stop, back with Shift+Tab, it is not in the first row's tiles either: the first row held one stop. */
    const second = page.locator('#post-42 .kb-reactions [data-kb-stop][tabindex="0"]');
    await second.focus();
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('#post-42 .kb-reactions'))).toBe(false);
  });

  test('keyboard focus on your own kind is visible on a light post: an outline of 3:1 against the post, other than the unfocused one', async ({ page }) => {
    await page.goto(MOMENT);
    const own = page.locator('#post-42 button.kb-reaction[data-kb-own]');
    await expect(own).toBeVisible();
    await page.keyboard.press('Tab'); /* keyboard modality, so a script focus matches :focus-visible */
    const read = () => own.evaluate((el) => {
      const px = (css: string): [number, number, number, number] => {
        const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
        c.clearRect(0, 0, 1, 1); c.fillStyle = css; c.fillRect(0, 0, 1, 1);
        const d = c.getImageData(0, 0, 1, 1).data;
        return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
      };
      const lum = ([r, g, b]: number[]) => { const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!); };
      /* The post's ground: the nearest ancestor with an opaque background. */
      let ground: [number, number, number, number] = [255, 255, 255, 1];
      for (let n: Element | null = el.parentElement; n; n = n.parentElement) { const p = px(getComputedStyle(n).backgroundColor); if (p[3] === 1) { ground = p; break; } }
      const cs = getComputedStyle(el);
      const o = px(cs.outlineColor);
      const [hi, lo] = [lum(o), lum(ground)].sort((a, b) => b - a);
      return { focusVisible: el.matches(':focus-visible'), outline: cs.outlineColor, width: cs.outlineWidth, style: cs.outlineStyle, ratio: (hi! + 0.05) / (lo! + 0.05) };
    });
    const unfocused = await read();
    await own.focus();
    const focused = await read();
    expect(focused.focusVisible).toBe(true);
    expect(focused.style).not.toBe('none');
    expect(focused.outline).not.toBe(unfocused.outline);
    expect(focused.ratio, `outline ${focused.outline} on the post's ground`).toBeGreaterThanOrEqual(3);
  });
});
