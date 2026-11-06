import { expect, test, type Page } from '@playwright/test';

/**
 * Whoops!'s splat in a real browser, which jsdom cannot draw (cards plan Task 5): #41 on the Main board's
 * moment carries its ink on a canvas, a drag across the ink scrubs it away on the reader's own screen, and
 * a reload brings it back.
 */
test.use({ viewport: { width: 1440, height: 1120 }, reducedMotion: 'reduce' });

const inked = (page: Page, selector = '#post-41 .kb-whoops-ink') => page.evaluate((sel) => {
  const c = document.querySelector<HTMLCanvasElement>(sel);
  if (!c) return 0;
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i]! > 40) n++;
  return n;
}, selector);

test('the splat on #41 is drawn, scrubbed by a drag, and back after a reload', async ({ page }) => {
  await page.goto('/?fixture=boards&moment=01-main');
  const canvas = page.locator('#post-41 .kb-whoops-ink');
  await expect(canvas).toBeVisible();
  await expect.poll(() => inked(page)).toBeGreaterThan(1000);
  const before = await inked(page);
  const box = (await canvas.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.47, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, y, { steps: 20 });
  await page.mouse.up();
  await expect.poll(() => inked(page)).toBeLessThan(before);
  /* The demo world starts over on a load (the address is rewritten once it is in), so a reload is a fresh visit to the moment. */
  await page.goto('/?fixture=boards&moment=01-main');
  await expect.poll(() => inked(page)).toBeGreaterThan(before * 0.95);
});

/*
 * The splatted post's words are laid out at natural size in the body, as any post's are (the whoops refinements design's section 5): the
 * layer is the post's whole body, border to border, and its words get the width and the type any other post's words get, so they break
 * in the same places, at the board's max and on a phone alike.
 */
const words = (page: Page) => page.evaluate(() => {
  const px = (v: string) => parseFloat(v) || 0;
  const wordsOf = (el: Element) => { const c = getComputedStyle(el); return el.clientWidth - px(c.paddingLeft) - px(c.paddingRight); };
  const layout = document.querySelector('#post-41 .kb-whoops-layout') as HTMLElement;
  const body = document.querySelector('#post-41 .kb-act-main')!;
  const ink = document.querySelector('#post-41 .kb-whoops-ink')!.getBoundingClientRect();
  const rect = body.getBoundingClientRect();
  const text = layout.querySelector('p, div') ?? layout;
  return {
    body: { x: rect.x, width: rect.width, clientWidth: body.clientWidth }, border: body.clientLeft,
    ink: { x: ink.x, width: ink.width },
    layoutTransform: layout.style.transform, layoutWidth: layout.style.width,
    splattedWords: wordsOf(layout),
    plainWords: wordsOf(document.querySelector('#post-42 .kb-act-main')!),
    fontSize: getComputedStyle(text).fontSize,
    plainFontSize: getComputedStyle(document.querySelector('#post-42 .kb-act-main p, #post-42 .kb-act-main')!).fontSize,
  };
});

test('at the board\'s max the splat covers the post body edge to edge, and its words are as wide as an unsplatted post\'s', async ({ page }) => {
  await page.goto('/?fixture=boards&moment=01-main');
  await expect(page.locator('#post-41 .kb-whoops-ink')).toBeVisible();
  const read = await words(page);
  /* The ink canvas covers the body's padding box (which the frame, inside the padding, does not). */
  expect(read.ink.x).toBeCloseTo(read.body.x + read.border, 0);
  expect(read.ink.width).toBeCloseTo(read.body.clientWidth, 0);
  expect(read.layoutTransform).toBe('');
  expect(read.layoutWidth).toBe('');
  expect(read.splattedWords).toBeCloseTo(read.plainWords, 0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the splat\'s words are as wide as an unsplatted post\'s and at the board\'s 15px', async ({ page }) => {
    await page.goto('/?fixture=boards&moment=01-main');
    await expect(page.locator('#post-41 .kb-whoops-ink')).toBeVisible();
    const read = await words(page);
    expect(read.layoutTransform).toBe('');
    expect(read.splattedWords).toBeCloseTo(read.plainWords, 0);
    expect(read.fontSize).toBe('15px');
    expect(read.plainFontSize).toBe('15px');
  });

  test('the ink canvas covers the body\'s padding box', async ({ page }) => {
    await page.goto('/?fixture=boards&moment=01-main');
    await expect(page.locator('#post-41 .kb-whoops-ink')).toBeVisible();
    const read = await page.evaluate(() => {
      const body = document.querySelector('#post-41 .kb-act-main') as HTMLElement;
      const b = body.getBoundingClientRect();
      const ink = document.querySelector('#post-41 .kb-whoops-ink')!.getBoundingClientRect();
      return {
        left: ink.left - (b.left + body.clientLeft), top: ink.top - (b.top + body.clientTop),
        width: ink.width - body.clientWidth, height: ink.height - body.clientHeight,
      };
    });
    for (const d of Object.values(read)) expect(Math.abs(d)).toBeLessThanOrEqual(1);
  });
});

/*
 * A finger on the ink (the design's section 6), sent as real touches through the protocol: a sideways drag washes, a quick vertical swipe
 * is the page's (it scrolls and washes nothing), and a hold then a vertical drag washes and holds the page still.
 */
test.describe('with a finger on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  const setup = async (page: Page) => {
    await page.goto('/?fixture=boards&moment=01-main');
    await expect(page.locator('#post-41 .kb-whoops-ink')).toBeVisible();
    await expect.poll(() => inked(page)).toBeGreaterThan(1000);
    /* A point on the ink, in the viewport and above the reactions row, which the post's words fill. */
    await page.locator('#post-41 .kb-whoops-ink').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -300));
    /* The middle of the longest run of solid ink on a row in the viewport (clear of the tip card on the post, and of the sticky banner). */
    const at = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('#post-41 .kb-whoops-ink')!;
      const r = c.getBoundingClientRect();
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      const k = c.width / r.width;
      const solid = (x: number, y: number) => {
        for (let dx = -12; dx <= 12; dx += 6) for (let dy = -12; dy <= 12; dy += 6) {
          const px = Math.floor((x + dx) * k), py = Math.floor((y + dy) * k);
          if (px < 0 || py < 0 || px >= c.width || py >= c.height || d[(py * c.width + px) * 4 + 3]! <= 40) return false;
        }
        const e = document.elementFromPoint(r.left + x, r.top + y);
        return e !== null && e.closest('.kb-callout, [data-kb-over-ink]') === null && e.closest('#post-41') !== null;
      };
      let best = { len: 0, x: 0, y: 0 };
      for (let y = Math.max(0, Math.ceil(280 - r.top)); y < Math.min(r.height, 700 - r.top); y += 6) {
        let run = 0;
        for (let x = 0; x < r.width; x += 2) {
          run = solid(x, y) ? run + 2 : 0;
          if (run > best.len) best = { len: run, x: x - run / 2, y };
        }
      }
      return { x: r.left + best.x, y: r.top + best.y, len: best.len };
    });
    expect(at.len).toBeGreaterThan(220);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: x!, y: y! }] });
    return { at, touch, scrollY: () => page.evaluate(() => window.scrollY) };
  };

  test('a sideways drag washes', async ({ page }) => {
    const { at, touch } = await setup(page);
    const before = await inked(page);
    await touch('touchStart', at.x - 100, at.y);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', at.x - 100 + i * 20, at.y); await page.waitForTimeout(16); }
    await touch('touchEnd');
    await expect.poll(() => inked(page)).toBeLessThan(before);
  });

  test('a quick vertical swipe scrolls the page and washes nothing', async ({ page }) => {
    const { at, touch, scrollY } = await setup(page);
    const before = await inked(page);
    const y0 = await scrollY();
    await touch('touchStart', at.x, at.y + 100);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', at.x, at.y + 100 - i * 20); await page.waitForTimeout(8); }
    await touch('touchEnd');
    await expect.poll(scrollY).toBeGreaterThan(y0);
    expect(await inked(page)).toBe(before);
  });

  test('a hold, then a vertical drag washes and does not scroll', async ({ page }) => {
    const { at, touch, scrollY } = await setup(page);
    const before = await inked(page);
    const y0 = await scrollY();
    await touch('touchStart', at.x, at.y);
    await page.waitForTimeout(300);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', at.x, at.y + i * 12); await page.waitForTimeout(16); }
    await touch('touchEnd');
    await expect.poll(() => inked(page)).toBeLessThan(before);
    expect(await scrollY()).toBe(y0);
  });
});

/*
 * The reactions row is as wide as its chips, so ink stands to the right of it, and a press there washes (the row's own children are the
 * only thing the ink leaves to the page). The mouse over ink wears the drawn sponge and the body's own cursor is none; over the React
 * button it is the ordinary arrow.
 */
test('a press on ink beside the reactions row starts a stroke, and the row is as wide as its chips', async ({ page }) => {
  await page.goto('/?fixture=boards&moment=01-main');
  await expect(page.locator('#post-41 .kb-whoops-ink')).toBeVisible();
  await expect.poll(() => inked(page)).toBeGreaterThan(1000);
  const read = await page.evaluate(() => {
    const row = document.querySelector('#post-41 [data-kb-over-ink]') as HTMLElement;
    const kids = [...row.children].map((c) => c.getBoundingClientRect());
    const r = row.getBoundingClientRect();
    return { row: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, kidsRight: Math.max(...kids.map((k) => k.right)), kidsLeft: Math.min(...kids.map((k) => k.left)) };
  });
  expect(read.row.right - read.kidsRight).toBeLessThanOrEqual(1);
  expect(read.kidsLeft - read.row.left).toBeLessThanOrEqual(1);
  const body = (await page.locator('#post-41 .kb-act-main').boundingBox())!;
  expect(body.x + body.width - read.row.right).toBeGreaterThan(150);
  /* A point of ink on the row's own band, past the last chip (a press starts a stroke only on ink). */
  const spot = await page.evaluate((r) => {
    const c = document.querySelector<HTMLCanvasElement>('#post-41 .kb-whoops-ink')!;
    const box = c.getBoundingClientRect();
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const y = (r.top + r.bottom) / 2;
    /* Ink all round, so the brush has a body to take hold of and not the thin edge of the splat. */
    const inkAt = (x: number, y: number) => d[(Math.floor(y - box.top) * c.width + Math.floor(x - box.left)) * 4 + 3]! > 40;
    for (let x = r.right + 20; x < box.right - 40; x++) {
      let all = true;
      for (let dx = -12; dx <= 12 && all; dx += 6) for (let dy = -12; dy <= 12 && all; dy += 6) all = inkAt(x + dx, y + dy);
      if (all) return { x, y };
    }
    return null;
  }, read.row);
  expect(spot).not.toBeNull();
  const before = await inked(page);
  await page.mouse.move(spot!.x, spot!.y);
  await page.mouse.down();
  await page.mouse.move(spot!.x + 60, spot!.y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => inked(page)).toBeLessThan(before);
});

test('with a mouse over ink the sponge is drawn and the body\'s cursor is none; over the React button the sponge is hidden', async ({ page }) => {
  /* Post 41 of the moment has no React button (its viewer cannot react to it), so this is the story whose splatted post has one. */
  await page.goto('/?fixture=boards&story=boards-08-hold--whoops-under-hold');
  await expect(page.locator('.kb-whoops-ink')).toBeVisible();
  await expect.poll(() => inked(page, '.kb-whoops-ink')).toBeGreaterThan(1000);
  const sponge = page.locator('[data-kb-cursor="sponge"]');
  const box = (await page.locator('.kb-whoops-ink').boundingBox())!;
  const cursor = () => page.locator('.kb-act-main').evaluate((el) => getComputedStyle(el).cursor);
  await page.mouse.move(box.x + box.width * 0.4, box.y + 40);
  await page.mouse.move(box.x + box.width * 0.45, box.y + 45);
  await expect(sponge).toBeVisible();
  expect(await cursor()).toBe('none');
  const button = (await page.locator('.kb-react-button').boundingBox())!;
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2, { steps: 4 });
  await expect(sponge).toBeHidden();
  expect(await cursor()).not.toBe('none');
});

/*
 * The owner on the spill: "the spill still has edges that end before the black post borders ... such things can just render in front
 * of the splat". The ink runs to the post body's borders on every side, and the reactions are drawn in front of it, visible and
 * usable. The action row is on the footer bar below the body (the owner's word of 2026-10-31), never under the ink (e2e/footer.spec.ts).
 */
test('the ink reaches the post body\'s borders, the reactions are in front of it, clickable, and the action links stand on the footer bar clear of it', async ({ page }) => {
  await page.goto('/?fixture=boards&moment=01-main');
  await expect(page.locator('#post-41 .kb-whoops-ink')).toBeVisible();
  const read = await page.evaluate(() => {
    const body = document.querySelector('#post-41 .kb-act-main')!.getBoundingClientRect();
    const ink = document.querySelector('#post-41 .kb-whoops-ink')!.getBoundingClientRect();
    const over = (sel: string) => {
      const r = document.querySelector(sel)!.getBoundingClientRect();
      return ink.left < r.right && ink.right > r.left && ink.top < r.bottom && ink.bottom > r.top;
    };
    return { body: { top: body.top, bottom: body.bottom, left: body.left, right: body.right }, ink: { top: ink.top, bottom: ink.bottom, left: ink.left, right: ink.right },
      chip: over('#post-41 .kb-chip'), links: ink.bottom > document.querySelector('#post-41 .kb-act-foot')!.getBoundingClientRect().top + 1 };
  });
  /* Down to the body's top border, and across to its sides: the ink's canvas starts at the body's top. */
  expect(read.ink.top).toBeCloseTo(read.body.top, 0);
  expect(read.ink.left).toBeCloseTo(read.body.left, 0);
  expect(read.ink.right).toBeCloseTo(read.body.right, 0);
  expect(read.ink.bottom).toBeGreaterThan(read.body.top + 100);
  expect(read.chip).toBe(true);
  expect(read.links).toBe(false);
  /* The chip is under the canvas's box and still what a click reaches (a trial click fails if anything else would take it); the links are on the bar. */
  await page.locator('#post-41 .kb-act-links').getByRole('button', { name: 'Quote' }).click({ trial: true });
  await page.locator('#post-41 .kb-act-links').getByRole('button', { name: 'Spin thread' }).click({ trial: true });
  await page.locator('#post-41 .kb-chip').first().click({ trial: true });
});

/*
 * Another card's effect may wrap Whoops! (Stick Around played after it, held and not yet lifted): the wrapper is the body's child, and
 * the post's controls are still in front of the ink inside it. What is at the center of the card's mark, the reaction button and an action link is
 * that element itself and not the canvas.
 */
test('with a held Stick Around around the ink, the marks, the reactions and the actions are in front of the ink', async ({ page }) => {
  await page.goto('/?fixture=boards&story=boards-08-hold--whoops-under-hold');
  await expect(page.locator('.kb-whoops-ink')).toBeVisible();
  await expect(page.locator('.kb-hold')).toBeVisible();
  await expect(page.locator('.kb-mark').first()).toBeVisible();
  await expect(page.locator('.kb-react-button')).toBeVisible();
  /* The ink lets pointers through, which would hide what paints over what: make it take them, so what is at a point is what is painted there. */
  await page.evaluate(() => { document.querySelector<HTMLElement>('.kb-whoops-ink')!.style.pointerEvents = 'auto'; });
  const hit = (sel: string) => page.evaluate((s) => {
    const el = document.querySelector(s)!;
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return at !== null && el.contains(at);
  }, sel);
  expect(await hit('.kb-mark')).toBe(true);
  expect(await hit('.kb-react-button')).toBe(true);
  expect(await hit('.kb-act-links .kb-link-button')).toBe(true);
});

/*
 * Stick Around moves the post's words into the post after they are mounted (the takeover draws them once and moves their element), so
 * Whoops! finds the post body it bleeds over each time it measures. In the thread, with a hold around the ink, the ink still reaches
 * the post body's borders.
 */
test('with a held Stick Around around the ink, the ink still reaches the post body\'s borders', async ({ page }) => {
  await page.goto('/?fixture=boards&story=boards-08-hold--whoops-under-hold');
  await expect(page.locator('.kb-whoops-ink')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const body = document.querySelector('.kb-act-main')!.getBoundingClientRect();
    const ink = document.querySelector('.kb-whoops-ink')!.getBoundingClientRect();
    return [ink.left - body.left, ink.right - body.right, ink.top - body.top].map((d) => Math.round(Math.abs(d)));
  })).toEqual([0, 0, 0]);
});

/*
 * The scrub button, the author's tool choice (both the kit's tiles in the Lens) and the chosen ink swatch are drawn with a border, a
 * glow and underlining, which forced colors (Windows High Contrast) drop or recolor: each is also
 * marked by an outline or a border in a system color there. The swatch is the play form's, which a
 * moment does not open, so a swatch is made from the card's own markup beside the post.
 */
test.describe('in forced colors', () => {
  test.use({ forcedColors: 'active' });

  test('the scrub button, the author\'s tools and the chosen swatch are marked in system colors', async ({ page }) => {
    await page.goto('/?fixture=boards&moment=01-main');
    /* The hold and the tools are the kit's tiles in the Lens, opened by Whoops!'s mark. */
    await page.locator('#post-41 .kb-mark[data-kb-card="whoops"]:not(.kb-ghost-mark)').click();
    const lens = page.getByRole('dialog', { name: 'Cards on this post' });
    await expect(lens.getByRole('button', { name: 'Hold to scrub' })).toBeVisible();
    const marks = await page.evaluate(() => {
      const system = (color: string) => {
        const probe = document.createElement('div');
        probe.style.cssText = `forced-color-adjust: none; color: ${color}`;
        document.body.append(probe);
        const resolved = getComputedStyle(probe).color;
        probe.remove();
        return resolved;
      };
      const form = document.createElement('div');
      form.innerHTML = '<label class="kb-whoops-swatch"><input type="radio" name="t" checked></label><label class="kb-whoops-swatch"><input type="radio" name="t"></label>';
      document.body.append(form);
      const outline = (el: Element) => { const c = getComputedStyle(el); return { style: c.outlineStyle, width: c.outlineWidth, color: c.outlineColor }; };
      const border = (el: Element) => { const c = getComputedStyle(el); return { style: c.borderTopStyle, width: c.borderTopWidth, color: c.borderTopColor }; };
      const [chosen, other] = [...form.querySelectorAll('input')];
      const tools = [...document.querySelectorAll('.kb-lens [role="group"] .kb-kit-tile')];
      return {
        buttonText: system('ButtonText'), highlight: system('Highlight'),
        scrub: outline(document.querySelector('.kb-lens .kb-kit-tile[data-kb-hold]')!),
        tools: tools.map((t) => ({ pressed: t.getAttribute('aria-pressed'), ...outline(t) })),
        chosen: border(chosen!), other: border(other!),
      };
    });
    /* The kit's tiles (kit.css) are outlined 2px in ButtonText, and in Highlight when lit (the hold) or pressed (the chosen tool). */
    expect(marks.scrub).toEqual({ style: 'solid', width: '2px', color: marks.highlight });
    expect(marks.tools).toHaveLength(2);
    for (const t of marks.tools) {
      expect(t).toEqual(t.pressed === 'true' ? { pressed: 'true', style: 'solid', width: '2px', color: marks.highlight } : { pressed: 'false', style: 'solid', width: '2px', color: marks.buttonText });
    }
    expect(marks.chosen).toEqual({ style: 'solid', width: '4px', color: marks.highlight });
    expect(marks.other.style).not.toBe('solid');
  });
});
