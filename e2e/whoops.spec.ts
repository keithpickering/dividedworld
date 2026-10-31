import { expect, test, type Page } from '@playwright/test';

/**
 * Whoops!'s splat in a real browser, which jsdom cannot draw (cards plan Task 5): #41 on the Main board's
 * moment carries its ink on a canvas, a drag across the ink scrubs it away on the reader's own screen, and
 * a reload brings it back.
 */
test.use({ viewport: { width: 1440, height: 1120 }, reducedMotion: 'reduce' });

const inked = (page: Page) => page.evaluate(() => {
  const c = document.querySelector<HTMLCanvasElement>('#post-41 .kb-whoops-ink');
  if (!c) return 0;
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i]! > 40) n++;
  return n;
});

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
 * The splatted post is the post at the board's widest (the owner's word: the 2003 board is at most 960px wide, and Whoops!'s lines break
 * as the same post's would unsplatted): its layer is the post's whole body, border to border, laid out at the width the body has at 960px,
 * and its words get the width any other post's words get, so they break in the same places.
 */
test('at the board\'s max the splat covers the post body edge to edge, and its words are as wide as an unsplatted post\'s', async ({ page }) => {
  await page.goto('/?fixture=boards&moment=01-main');
  await expect(page.locator('#post-41 .kb-whoops-ink')).toBeVisible();
  const read = await page.evaluate(() => {
    const px = (v: string) => parseFloat(v) || 0;
    const wordsOf = (el: Element) => { const c = getComputedStyle(el); return el.clientWidth - px(c.paddingLeft) - px(c.paddingRight); };
    const body = document.querySelector('#post-41 .kb-act-main')!.getBoundingClientRect();
    const frame = document.querySelector('#post-41 .kb-whoops-frame')!.getBoundingClientRect();
    const layout = document.querySelector('#post-41 .kb-whoops-layout') as HTMLElement;
    return {
      body: { x: body.x, width: body.width },
      frame: { x: frame.x, width: frame.width },
      layoutTransform: layout.style.transform,
      splattedWords: wordsOf(layout),
      plainWords: wordsOf(document.querySelector('#post-42 .kb-act-main')!),
    };
  });
  expect(read.frame.x).toBeCloseTo(read.body.x, 0);
  expect(read.frame.width).toBeCloseTo(read.body.width, 0);
  expect(read.layoutTransform).toBe('translateX(0px) scale(1)');
  expect(read.splattedWords).toBeCloseTo(read.plainWords, 0);
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
 * the post's controls are still in front of the ink inside it. What is at the center of the play tag, the reaction button and an action link is
 * that element itself and not the canvas.
 */
test('with a held Stick Around around the ink, the play tags, the reactions and the actions are in front of the ink', async ({ page }) => {
  await page.goto('/?fixture=boards&story=boards-08-hold--whoops-under-hold');
  await expect(page.locator('.kb-whoops-ink')).toBeVisible();
  await expect(page.locator('.kb-hold')).toBeVisible();
  await expect(page.locator('.kb-play-tag').first()).toBeVisible();
  await expect(page.locator('.kb-react-button')).toBeVisible();
  /* The ink lets pointers through, which would hide what paints over what: make it take them, so what is at a point is what is painted there. */
  await page.evaluate(() => { document.querySelector<HTMLElement>('.kb-whoops-ink')!.style.pointerEvents = 'auto'; });
  const hit = (sel: string) => page.evaluate((s) => {
    const el = document.querySelector(s)!;
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return at !== null && el.contains(at);
  }, sel);
  expect(await hit('.kb-play-tag')).toBe(true);
  expect(await hit('.kb-react-button')).toBe(true);
  expect(await hit('.kb-act-links .kb-link-button')).toBe(true);
});

/*
 * The scrub button, the author's tool toggles and the chosen ink swatch are drawn with a border, a
 * glow and underlining, which forced colors (Windows High Contrast) drop or recolor: each is also
 * marked by an outline or a border in a system color there. The swatch is the play form's, which a
 * moment does not open, so a swatch is made from the card's own markup beside the post.
 */
test.describe('in forced colors', () => {
  test.use({ forcedColors: 'active' });

  test('the scrub button, the author\'s tools and the chosen swatch are marked in system colors', async ({ page }) => {
    await page.goto('/?fixture=boards&moment=01-main');
    await expect(page.locator('#post-41 .kb-whoops-scrub')).toBeVisible();
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
      const tools = [...document.querySelectorAll('#post-41 .kb-whoops-tools button')];
      return {
        buttonText: system('ButtonText'), highlight: system('Highlight'),
        scrub: outline(document.querySelector('#post-41 .kb-whoops-scrub')!),
        tools: tools.map((t) => ({ pressed: t.getAttribute('aria-pressed'), ...outline(t) })),
        chosen: border(chosen!), other: border(other!),
      };
    });
    expect(marks.scrub).toEqual({ style: 'solid', width: '2px', color: marks.buttonText });
    expect(marks.tools).toHaveLength(2);
    for (const t of marks.tools) {
      expect(t).toEqual(t.pressed === 'true' ? { pressed: 'true', style: 'solid', width: '3px', color: marks.highlight } : { pressed: 'false', style: 'solid', width: '1px', color: marks.buttonText });
    }
    expect(marks.chosen).toEqual({ style: 'solid', width: '4px', color: marks.highlight });
    expect(marks.other.style).not.toBe('solid');
  });
});
