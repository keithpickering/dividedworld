import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Whoops!'s splat in a real browser, which jsdom cannot draw (cards plan Task 5): #41 on the Main board's
 * moment carries its ink on a canvas, a drag across the ink scrubs it away on the reader's own screen, and
 * a reload brings it back.
 */
test.use({ viewport: { width: 1440, height: 1120 }, reducedMotion: 'reduce' });

/* The hold's length, read from the touch rules' own source (importing it would pull in React and its stylesheet), and refused if it is not found, so a wait never silently becomes none: a wait below it is not a hold. */
const HOLD_MS = Number(/export const HOLD_MS = (\d+)/.exec(readFileSync(new URL('../instances/divided-world/cards/wiping.ts', import.meta.url), 'utf8'))?.[1]);
if (!Number.isFinite(HOLD_MS)) throw new Error('HOLD_MS is not in instances/divided-world/cards/wiping.ts');

/*
 * How much ink the canvas holds: the sum of its alpha, in whole pixels' worth. A wash takes some of the field each pass (the ink field
 * design), so a scrubbed core is thinned and see-through well before it is gone, and a count of pixels past a cutoff would not move until
 * the ink was gone; the sum falls with every pass.
 */
const inked = (page: Page, selector = '#post-41 .kb-whoops-ink') => page.evaluate((sel) => {
  const c = document.querySelector<HTMLCanvasElement>(sel);
  if (!c) return 0;
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) n += d[i]! / 255;
  return Math.round(n);
}, selector);

/**
 * The middle of the longest run of solid ink on a row between viewport heights `from` and `to`, clear of the tip card, the sticky
 * banner and what the engine lifts over the ink (`[data-kb-over-ink]`), and standing in the ink's own post body.
 */
const solidInk = (page: Page, selector: string, from: number, to: number) => page.evaluate(([sel, top, bottom]) => {
  const c = document.querySelector<HTMLCanvasElement>(sel as string)!;
  const post = c.closest('.kb-act-main');
  const r = c.getBoundingClientRect();
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  const k = c.width / r.width;
  const solid = (x: number, y: number) => {
    for (let dx = -12; dx <= 12; dx += 6) for (let dy = -12; dy <= 12; dy += 6) {
      const px = Math.floor((x + dx) * k), py = Math.floor((y + dy) * k);
      if (px < 0 || py < 0 || px >= c.width || py >= c.height || d[(py * c.width + px) * 4 + 3]! <= 40) return false;
    }
    const e = document.elementFromPoint(r.left + x, r.top + y);
    return e !== null && e.closest('.kb-callout, [data-kb-over-ink]') === null && post !== null && post.contains(e);
  };
  let best = { len: 0, x: 0, y: 0 };
  for (let y = Math.max(0, Math.ceil((top as number) - r.top)); y < Math.min(r.height, (bottom as number) - r.top); y += 6) {
    let run = 0;
    for (let x = 0; x < r.width; x += 2) {
      run = solid(x, y) ? run + 2 : 0;
      if (run > best.len) best = { len: run, x: x - run / 2, y };
    }
  }
  return { x: r.left + best.x, y: r.top + best.y, len: best.len };
}, [selector, from, to] as const);

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
  const layout = document.querySelector('#post-41 [data-kb-whoops-layout]') as HTMLElement;
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
    const at = await solidInk(page, '#post-41 .kb-whoops-ink', 280, 700);
    expect(at.len).toBeGreaterThan(220);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: x!, y: y! }] });
    return { at, touch, scrollY: () => page.evaluate(() => window.scrollY) };
  };

  test('a sideways drag washes and does not scroll', async ({ page }) => {
    const { at, touch, scrollY } = await setup(page);
    const y0 = await scrollY();
    const before = await inked(page);
    await touch('touchStart', at.x - 100, at.y);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', at.x - 100 + i * 20, at.y); await page.waitForTimeout(16); }
    await touch('touchEnd');
    await expect.poll(() => inked(page)).toBeLessThan(before);
    expect(await scrollY()).toBe(y0);
  });

  test('a quick vertical swipe scrolls the page and washes nothing', async ({ page }) => {
    const { at, touch, scrollY } = await setup(page);
    const before = await inked(page);
    const y0 = await scrollY();
    /* From solid ink, so a dab on the touch's start would show in the count. */
    await touch('touchStart', at.x, at.y);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', at.x, at.y - i * 20); await page.waitForTimeout(8); }
    await touch('touchEnd');
    await expect.poll(scrollY).toBeGreaterThan(y0);
    expect(await inked(page)).toBe(before);
  });

  test('a hold, then a vertical drag washes and does not scroll', async ({ page }) => {
    const { at, touch, scrollY } = await setup(page);
    const before = await inked(page);
    const y0 = await scrollY();
    await touch('touchStart', at.x, at.y);
    await page.waitForTimeout(HOLD_MS + 120);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', at.x, at.y + i * 12); await page.waitForTimeout(16); }
    await touch('touchEnd');
    await expect.poll(() => inked(page)).toBeLessThan(before);
    expect(await scrollY()).toBe(y0);
  });
});

/*
 * The reactions row is as wide as its tiles, so ink stands to the right of it, and a press there washes (the row's own children are the
 * only thing the ink leaves to the page). The mouse over ink wears the drawn sponge and the body's own cursor is none; over the React
 * button it is the ordinary arrow.
 */
test('a press on ink beside the reactions row starts a stroke, and the row is as wide as its tiles', async ({ page }) => {
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
  /* A point of ink on the row's own band, past the last tile (a press starts a stroke only on ink). */
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
  const cursor = () => page.locator('.kb-act-main').evaluate((el) => getComputedStyle(el).cursor);
  /* The body's own cursor with no pointer yet over the ink, which is what it must be again once the pointer is off the ink. */
  const plain = await cursor();
  expect(plain).not.toBe('none');
  await page.locator('.kb-whoops-ink').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const spot = await solidInk(page, '.kb-whoops-ink', 150, 900);
  expect(spot.len).toBeGreaterThan(100);
  await page.mouse.move(spot.x - 5, spot.y);
  await page.mouse.move(spot.x, spot.y + 2);
  await expect(sponge).toBeVisible();
  expect(await cursor()).toBe('none');
  const button = (await page.locator('.kb-react-button').boundingBox())!;
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2, { steps: 4 });
  await expect(sponge).toBeHidden();
  expect(await cursor()).toBe(plain);
});

/*
 * The owner on the spill: "the spill still has edges that end before the black post borders ... such things can just render in front
 * of the splat". The ink runs to the post body's borders on every side (its padding box, inside the border), and the reactions are drawn in front of it, visible and
 * usable. The action row is on the footer bar below the body (the owner's word of 2026-10-31), never under the ink (e2e/footer.spec.ts).
 */
test('the ink reaches the post body\'s padding box edges, the reactions are in front of it, clickable, and the action links stand on the footer bar clear of it', async ({ page }) => {
  await page.goto('/?fixture=boards&moment=01-main');
  await expect(page.locator('#post-41 .kb-whoops-ink')).toBeVisible();
  const read = await page.evaluate(() => {
    const main = document.querySelector('#post-41 .kb-act-main')!;
    const b = main.getBoundingClientRect();
    /* The ink canvas covers the body's padding box: inside the border, which the frame's own border is. */
    const body = { top: b.top + main.clientTop, bottom: b.top + main.clientTop + main.clientHeight, left: b.left + main.clientLeft, right: b.left + main.clientLeft + main.clientWidth };
    const ink = document.querySelector('#post-41 .kb-whoops-ink')!.getBoundingClientRect();
    const over = (sel: string) => {
      const r = document.querySelector(sel)!.getBoundingClientRect();
      return ink.left < r.right && ink.right > r.left && ink.top < r.bottom && ink.bottom > r.top;
    };
    return { body, ink: { top: ink.top, bottom: ink.bottom, left: ink.left, right: ink.right },
      tile: over('#post-41 .kb-reaction'), links: ink.bottom > document.querySelector('#post-41 .kb-act-foot')!.getBoundingClientRect().top + 1 };
  });
  /* Up to the body's top edge inside its border, and across to its sides. */
  expect(read.ink.top).toBeCloseTo(read.body.top, 0);
  expect(read.ink.left).toBeCloseTo(read.body.left, 0);
  expect(read.ink.right).toBeCloseTo(read.body.right, 0);
  expect(read.ink.bottom).toBeGreaterThan(read.body.top + 100);
  expect(read.tile).toBe(true);
  expect(read.links).toBe(false);
  /* The tile is under the canvas's box and still what a click reaches (a trial click fails if anything else would take it); the links are on the bar. */
  await page.locator('#post-41 .kb-act-links').getByRole('button', { name: 'Quote' }).click({ trial: true });
  await page.locator('#post-41 .kb-act-links').getByRole('button', { name: 'Spin thread' }).click({ trial: true });
  await page.locator('#post-41 .kb-reaction').first().click({ trial: true });
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
  expect(await hit('.kb-act-links .kb-button')).toBe(true);
});

/*
 * Stick Around moves the post's words into the post after they are mounted (the takeover draws them once and moves their element), so
 * Whoops! finds the post body it bleeds over each time it measures. In the thread, with a hold around the ink, the ink still reaches
 * the post body's padding box (inside its borders).
 */
test('with a held Stick Around around the ink, the ink still reaches the post body\'s padding box', async ({ page }) => {
  await page.goto('/?fixture=boards&story=boards-08-hold--whoops-under-hold');
  await expect(page.locator('.kb-whoops-ink')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const main = document.querySelector('.kb-act-main')!;
    const body = main.getBoundingClientRect();
    const ink = document.querySelector('.kb-whoops-ink')!.getBoundingClientRect();
    /* The padding box: inside the body's border. */
    return [ink.left - (body.left + main.clientLeft), ink.right - (body.left + main.clientLeft + main.clientWidth), ink.top - (body.top + main.clientTop)].map((d) => Math.round(Math.abs(d)));
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
      const tools = [...document.querySelectorAll('.kb-lens [role="group"] .kb-kit-tile[aria-pressed]')];
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

test('a mouse dab washes the ink where the pointer pressed, not offset by the frame\'s place in the cell', async ({ page }) => {
  await page.goto('/?fixture=boards&moment=01-main');
  await expect(page.locator('#post-41 .kb-whoops-ink')).toBeVisible();
  await expect.poll(() => inked(page)).toBeGreaterThan(1000);
  await page.locator('#post-41 .kb-whoops-ink').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const at = await solidInk(page, '#post-41 .kb-whoops-ink', 150, 900);
  expect(at.len).toBeGreaterThan(100);
  /* The ink's pixels before and after, and the press in the canvas's own CSS px. */
  const alphas = () => page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#post-41 .kb-whoops-ink')!;
    return { w: c.width, h: c.height, css: c.getBoundingClientRect().width, a: Array.from(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data.filter((_, i) => i % 4 === 3)) };
  });
  const before = await alphas();
  const rect = await page.locator('#post-41 .kb-whoops-ink').boundingBox();
  await page.mouse.move(at.x - 4, at.y);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
  /* A dab takes some of the field under it, so the ink there is thinned (its alpha falls) and not necessarily gone. */
  const THINNED = 12;
  const total = (a: readonly number[]) => a.reduce((n, v) => n + v, 0);
  await expect.poll(async () => total((await alphas()).a)).toBeLessThan(total(before.a));
  const after = await alphas();
  const k = before.w / before.css;
  let n = 0, sx = 0, sy = 0;
  for (let i = 0; i < before.a.length; i++) {
    const lost = before.a[i]! - after.a[i]!;
    if (lost > THINNED) { n += lost; sx += (lost * (i % before.w)) / k; sy += (lost * Math.floor(i / before.w)) / k; }
  }
  expect(n).toBeGreaterThan(2000);
  /* The thinned patch is the dab's disc cut by the splat's own edge, so its center of mass is near the press and not on it; an offset by the frame's place in the cell is tens of px. */
  expect(Math.abs(sx / n - (at.x - rect!.x))).toBeLessThan(8);
  expect(Math.abs(sy / n - (at.y - rect!.y))).toBeLessThan(8);
});

/*
 * The ink field's look in the running game (docs/plans/2026-11-12-whoops-ink-field-design.md): the author's pen line ends in a bulb, a
 * wash takes some of the field each pass so the core is see-through before it is gone, and "Hold to scrub" goes round a splat more than once.
 */
const SPOT = '#post-41 .kb-whoops-ink';
const MARK = '#post-41 .kb-mark[data-kb-card="whoops"]:not(.kb-ghost-mark)';

/** The post's field is built (its layers' pictures are held): until then the canvas is the flat stand-in, which a scrub only dims, and these tests read the field's look. */
const built = (page: Page) => expect.poll(() => page.evaluate(() => {
  const el = document.querySelector('#post-41 .kb-whoops')!;
  return Number(el.getAttribute('data-kb-pictures')) === (el.getAttribute('data-kb-layers') ?? '').split(' ').length;
}), { timeout: 20_000 }).toBe(true);

/** The card's tip ("Got it") comes up some while after the post and covers part of the ink, so a stroke there is the tip's: it is put away first. */
async function putAwayTip(page: Page): Promise<void> {
  const got = page.locator('#post-41 .kb-callout').getByRole('button', { name: 'Got it' });
  await got.click({ timeout: 5000 }).catch(() => undefined);
  await expect(page.locator('#post-41 .kb-callout')).toBeHidden();
}

/** The Lens's own tile of `name`, pressed, and the Lens closed again (a tool stays chosen, a hold is pressed apart). */
async function chooseTool(page: Page, name: string): Promise<void> {
  await page.locator(MARK).click();
  const lens = page.getByRole('dialog', { name: 'Cards on this post' });
  await lens.getByRole('button', { name }).click();
  await page.keyboard.press('Escape');
  await expect(lens).toBeHidden();
}

test('an author\'s pen line ends in a bulb wider than the line', async ({ page }) => {
  await page.goto('/?fixture=boards&moment=01-main');
  await expect(page.locator(SPOT)).toBeVisible();
  await expect.poll(() => inked(page)).toBeGreaterThan(1000);
  await built(page);
  await putAwayTip(page);
  await chooseTool(page, 'Write in ink');
  await page.locator(SPOT).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  /* A band of the post's body out of the splat's edge (no ink on the canvas there), where the page is the post's own words and not a control. */
  const band = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#post-41 .kb-whoops-ink')!;
    const post = c.closest('.kb-act-main');
    const r = c.getBoundingClientRect();
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const k = c.width / r.width;
    const empty = (x: number, y: number) => {
      const px = Math.floor(x * k), py = Math.floor(y * k);
      return px >= 0 && py >= 0 && px < c.width && py < c.height && d[(py * c.width + px) * 4 + 3] === 0;
    };
    const free = (x: number, y: number) => {
      const e = document.elementFromPoint(r.left + x, r.top + y);
      return e !== null && post !== null && post.contains(e) && e.closest('.kb-callout, [data-kb-over-ink]') === null;
    };
    for (let y = 24; y < r.height - 24; y += 4) {
      if (r.top + y < 80 || r.top + y > innerHeight - 80) continue;
      for (let x = 20; x < r.width - 200; x += 6) {
        let ok = true;
        for (let dx = 0; dx <= 180 && ok; dx += 6) for (let dy = -24; dy <= 24 && ok; dy += 6) ok = empty(x + dx, y + dy);
        if (ok && free(x, y) && free(x + 160, y)) return { x: r.left + x, y: r.top + y };
      }
    }
    return null;
  });
  expect(band).not.toBeNull();
  const LENGTH = 140;
  await page.mouse.move(band!.x, band!.y);
  await page.mouse.down();
  await page.mouse.move(band!.x + LENGTH, band!.y, { steps: 25 });
  await page.mouse.up();
  /* The line, read from the alpha: how thick the ink is down each column of the band, mid-line and at the line's end. */
  const read = () => page.evaluate(([x0, y0, length]) => {
    const c = document.querySelector<HTMLCanvasElement>('#post-41 .kb-whoops-ink')!;
    const r = c.getBoundingClientRect();
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const k = c.width / r.width;
    const thick = (x: number) => {
      let n = 0;
      for (let y = y0 - r.top - 24; y <= y0 - r.top + 24; y += 1 / k) {
        const px = Math.floor((x - r.left) * k), py = Math.floor(y * k);
        if (px >= 0 && py >= 0 && px < c.width && py < c.height && d[(py * c.width + px) * 4 + 3]! > 40) n++;
      }
      return n / k;
    };
    const mid: number[] = [];
    for (let x = x0 + length * 0.3; x <= x0 + length * 0.7; x += 2) mid.push(thick(x));
    mid.sort((a, b) => a - b);
    let end = 0;
    for (let x = x0 + length - 18; x <= x0 + length + 2; x += 1) end = Math.max(end, thick(x));
    return { mid: mid[Math.floor(mid.length / 2)]!, end };
  }, [band!.x, band!.y, LENGTH] as const);
  await page.waitForTimeout(100);
  await built(page);
  await expect.poll(async () => (await read()).mid).toBeGreaterThan(4);
  const line = await read();
  /* The bulb is 1.35 of the pen's radius where the line is 1 (field.ts END_BULB), so the ink at the end is clearly thicker than mid-line. */
  expect(line.end, `mid-line ${line.mid}px, at the end ${line.end}px`).toBeGreaterThan(line.mid * 1.15);
});

/** The canvas's alpha (0 to 255) at the point of the thickest ink (the center of the biggest disc the splat holds) and where that is, in the page's px. */
const core = (page: Page) => page.evaluate(() => {
  const c = document.querySelector<HTMLCanvasElement>('#post-41 .kb-whoops-ink')!;
  const r = c.getBoundingClientRect();
  const k = c.width / r.width;
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  /* Distance to the nearest empty pixel, two sweeps (a chamfer): its peak is the splat's deepest part. */
  const w = c.width, h = c.height, dist = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) dist[i] = d[i * 4 + 3]! > 40 ? 1e6 : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (x > 0) dist[i] = Math.min(dist[i]!, dist[i - 1]! + 1);
    if (y > 0) dist[i] = Math.min(dist[i]!, dist[i - w]! + 1);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (x < w - 1) dist[i] = Math.min(dist[i]!, dist[i + 1]! + 1);
    if (y < h - 1) dist[i] = Math.min(dist[i]!, dist[i + w]! + 1);
  }
  let best = 0;
  for (let i = 1; i < w * h; i++) if (dist[i]! > dist[best]!) best = i;
  return { x: r.left + (best % w) / k, y: r.top + Math.floor(best / w) / k, reach: dist[best]! / k };
});

const alphaAt = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => {
  const c = document.querySelector<HTMLCanvasElement>('#post-41 .kb-whoops-ink')!;
  const r = c.getBoundingClientRect();
  const k = c.width / r.width;
  return c.getContext('2d')!.getImageData(Math.floor((px! - r.left) * k), Math.floor((py! - r.top) * k), 1, 1).data[3]!;
}, [x, y] as const);

test('a reader scrubs the core: one pass leaves it see-through and not gone, and a few more clear it', async ({ page }) => {
  await page.goto('/?fixture=boards&moment=01-main');
  await expect(page.locator(SPOT)).toBeVisible();
  await expect.poll(() => inked(page)).toBeGreaterThan(1000);
  await built(page);
  await putAwayTip(page);
  await page.locator(SPOT).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const at = await core(page);
  expect(at.reach).toBeGreaterThan(20);
  const rectOf = () => page.locator(SPOT).evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top }; });
  const rect0 = await rectOf();
  /* The page may settle a little as a pass is made (a saved report, a tip going), so the core is followed by where the canvas lies now. */
  const here = async () => { const r = await rectOf(); return { x: at.x + r.x - rect0.x, y: at.y + r.y - rect0.y }; };
  const full = await alphaAt(page, at.x, at.y);
  expect(full).toBeGreaterThan(200);
  /* One pass: a stroke straight across the core, its own length and a brush each side. */
  const pass = async () => {
    /* A press while a rebuild of the field is out is the page's (nothing is built to take it), so each pass waits for the build to be back, and the next for this one's. */
    await built(page);
    const p = await here();
    await page.mouse.move(p.x - 60, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 60, p.y, { steps: 12 });
    await page.mouse.up();
    /* The canvas is drawn on the next frames and a pass shows when it has: read once the build is back and it has stopped changing. */
    await page.waitForTimeout(100);
    await built(page);
    const read = async () => { const q = await here(); return alphaAt(page, q.x, q.y); };
    let was = -1, now = await read();
    for (let i = 0; i < 20 && now !== was; i++) { was = now; await page.waitForTimeout(120); now = await read(); }
    return now;
  };
  const seen: number[] = [];
  /* The core takes two to six passes or more (the design); a cap well past that keeps a regression from looping on. */
  for (let i = 0; i < 14 && (seen.at(-1) ?? 1) > 0; i++) seen.push(await pass());
  expect(seen[0], `after one pass: ${seen.join(', ')}`).toBeGreaterThan(0);
  expect(seen.at(-1), `the alpha after each pass: ${seen.join(', ')}`).toBe(0);
  expect(seen.length, `the alpha after each pass: ${seen.join(', ')}`).toBeGreaterThan(1);
  /* Not endless either: a core takes two to six passes (the design), and the canvas lags one pass here, so no more than seven reads show it. Counting the passes would catch a wash that stopped taking enough. */
  expect(seen.length, `the alpha after each pass: ${seen.join(', ')}`).toBeLessThanOrEqual(7);
  /* See-through before gone: some pass leaves the core lowered and above 0, and it never darkens. */
  expect(seen.some((a) => a > 0 && a < full), `the alpha after each pass: ${seen.join(', ')} from ${full}`).toBe(true);
  for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeLessThanOrEqual(seen[i - 1]!);
});

test('"Hold to scrub" clears a splat, and goes over some line more than once', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/?fixture=boards&moment=01-main');
  await expect(page.locator(SPOT)).toBeVisible();
  await expect.poll(() => inked(page)).toBeGreaterThan(1000);
  await built(page);
  await page.locator(MARK).click();
  const lens = page.getByRole('dialog', { name: 'Cards on this post' });
  const tile = lens.getByRole('button', { name: 'Hold to scrub' });
  await tile.focus();
  const whoops = page.locator('#post-41 .kb-whoops');
  /* The ink in each band of the canvas, a band being the sweep's line (22.5px), sampled as the sweep runs. */
  const bands = () => page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#post-41 .kb-whoops-ink')!;
    const k = c.width / c.getBoundingClientRect().width, row = Math.max(1, Math.round(22.5 * k));
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const out: number[] = [];
    for (let y0 = 0; y0 < c.height; y0 += row) {
      let n = 0;
      for (let y = y0; y < Math.min(c.height, y0 + row); y++) for (let x = 0; x < c.width; x += 2) n += d[(y * c.width + x) * 4 + 3]! / 255;
      out.push(n);
    }
    return out;
  });
  const start = await bands();
  const drops = start.map(() => 0);
  let last = start, plateau = start.map(() => 0);
  await page.keyboard.down('Space');
  const until = Date.now() + 200_000;
  /* A band's ink falls while the sweep is on it, then holds while the sweep is elsewhere; a fall after a hold is another pass. */
  while (Date.now() < until && (await whoops.getAttribute('data-kb-layers')) !== 'clean') {
    await page.waitForTimeout(250);
    const now = await bands();
    now.forEach((v, i) => {
      if (v < last[i]! - 2) { if (plateau[i]! >= 3) drops[i]!++; else if (drops[i] === 0) drops[i] = 1; plateau[i] = 0; } else plateau[i]!++;
    });
    last = now;
  }
  await page.keyboard.up('Space');
  await expect(whoops).toHaveAttribute('data-kb-layers', 'clean');
  await expect(whoops).toHaveAttribute('data-kb-washed', /^1\.000$|^0?\.9\d\d$/u);
  expect(Math.max(...drops), `passes seen over each band: ${drops.join(' ')}`).toBeGreaterThanOrEqual(2);
});
