import { expect, test, type Page } from '@playwright/test';

/**
 * A card's plate and its play tile over a 2003 post, in a real browser (the owner on #80's round 2: "I think the Play
 * Here button is inheriting the Verdana"). Two things are held here: that no glass control in or under a 2003 post is set
 * in the 2003 board's faces (a control drawn into the post's slot sits under the board's `body`, so it takes the board's
 * font unless it names the glass's own), and the shape the approved stories (engine/ui/cards/Plate.board.stories.tsx)
 * give the plate: outside the post's body and attached at its bottom right (full width on a phone), a readout and a meter,
 * tiles that are buttons, the play tile in the plate or under the post and never in the 2003 action row.
 */
test.use({ reducedMotion: 'reduce' });

const SPLATTED_AND_ARMED = '/?fixture=boards&story=boards-01-plate--splatted-and-armed';
const ARMED = '/?fixture=boards&story=boards-01-plate--armed';
const SPLATTED = '/?fixture=boards&story=boards-01-plate--splatted';

/** The 2003 board's faces (engine/ui/tokens.css) and the glass's own, as the page computes them. */
async function faces(page: Page) {
  return page.evaluate(() => {
    const probe = (token: string) => {
      const el = document.createElement('span');
      el.style.fontFamily = `var(${token})`;
      document.body.append(el);
      const family = getComputedStyle(el).fontFamily;
      el.remove();
      return family;
    };
    return { body: probe('--kb-font-body'), mono: probe('--kb-font-mono'), display: probe('--kb-glass-font-display'), glass: probe('--kb-glass-font-body') };
  });
}

/** Every glass control in or under a 2003 post, with the family it computes. */
function glassFamilies(page: Page) {
  return page.evaluate(() => {
    const pick = 'article.kb-act .kb-glass, article.kb-act .kb-glass *, article.kb-act .kb-plate-tile, article.kb-act .kb-play-tag, article.kb-act .kb-play-here';
    return Array.from(new Set(document.querySelectorAll<HTMLElement>(pick)))
      .filter((el) => !(el instanceof SVGElement) && !(el instanceof HTMLCanvasElement) && el.closest('.kb-act-main, .kb-act-links') === null)
      .map((el) => ({ what: `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80), text: (el.textContent ?? '').trim().slice(0, 30), family: getComputedStyle(el).fontFamily }));
  });
}

async function expectGlassFaces(page: Page, expectTile: string) {
  const f = await faces(page);
  expect(f.body).not.toBe(f.glass);
  const got = await glassFamilies(page);
  expect(got.some((g) => g.what.includes(expectTile)), `a ${expectTile} is on the page`).toBe(true);
  for (const g of got) {
    expect([f.glass, f.display], `${g.what} (“${g.text}”) is set in ${g.family}`).toContain(g.family);
    expect(g.family).not.toMatch(/Verdana|Geneva|Courier/u);
  }
}

test('the play tile standing under #42 is set in the glass\'s face, not the 2003 board\'s', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1120 });
  await page.goto(ARMED);
  await expect(page.locator('#post-42 .kb-play-here')).toBeVisible();
  await expectGlassFaces(page, 'kb-play-here');
});

test('the play tile in #41\'s plate, the plate and its tiles are set in the glass\'s face', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1120 });
  await page.goto(SPLATTED_AND_ARMED);
  await expect(page.locator('#post-41 .kb-effect-strip .kb-play-here')).toBeVisible();
  await expectGlassFaces(page, 'kb-play-here');
  await expectGlassFaces(page, 'kb-plate-tile');
});

for (const [name, width, height] of [['1440', 1440, 1120], ['390', 390, 844]] as const) {
  test.describe(`at ${name}`, () => {
    test.use({ viewport: { width, height } });

    test('the plate is outside #41\'s body and attached to it at its bottom right (full width on a phone)', async ({ page }) => {
      await page.goto(SPLATTED);
      const plate = page.locator('#post-41 .kb-effect-strip');
      await expect(plate).toBeVisible();
      expect(await page.locator('#post-41 .kb-act-main .kb-effect-strip').count()).toBe(0);
      const r = await page.evaluate(() => {
        const rect = (s: string) => { const b = document.querySelector(s)!.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width }; };
        return { body: rect('#post-41 .kb-act-main'), foot: rect('#post-41 .kb-act-foot'), plate: rect('#post-41 .kb-effect-strip') };
      });
      /* Attached: it starts at the post's footer bar's bottom edge (a border's width of play), under the bar and never over the words. */
      expect(r.foot.t).toBeGreaterThanOrEqual(r.body.b - 3);
      expect(r.plate.t).toBeGreaterThanOrEqual(r.foot.b - 3);
      expect(r.plate.t - r.foot.b).toBeLessThan(24);
      if (width >= 1000) {
        /* At the bottom right: the plate's right edge is the body's less the slot's padding, and it is narrower than the body. */
        expect(r.body.r - r.plate.r).toBeGreaterThanOrEqual(0);
        expect(r.body.r - r.plate.r).toBeLessThan(48);
        expect(r.plate.w).toBeLessThan(r.body.w - 48);
      } else {
        /* Full width: the body's width less the slot's padding on each side. */
        expect(r.plate.l - r.body.l).toBeLessThan(32);
        expect(r.body.r - r.plate.r).toBeLessThan(32);
        expect(r.plate.w).toBeGreaterThan(r.body.w - 64);
      }
    });

    test('the armed play tile is never in the 2003 action row: in the plate on #41, under #42 on its own', async ({ page }) => {
      await page.goto(SPLATTED_AND_ARMED);
      await expect(page.locator('#post-41 .kb-effect-strip .kb-play-here')).toBeVisible();
      await expect(page.locator('#post-42 .kb-play-here')).toBeVisible();
      await expect(page.locator('article.kb-act .kb-act-links .kb-play-here, article.kb-act .kb-act-main .kb-play-here')).toHaveCount(0);
      const own = await page.evaluate(() => {
        const tile = document.querySelector('#post-42 .kb-play-here')!;
        const body = document.querySelector('#post-42 .kb-act-main')!.getBoundingClientRect();
        return { under: tile.getBoundingClientRect().top >= body.bottom - 3, slot: tile.closest('.kb-act-slot') !== null };
      });
      expect(own).toEqual({ under: true, slot: true });
    });

    test('no post has "Play card" in its row, armed or not: the armed card is the glass tile alone', async ({ page }) => {
      await page.goto(SPLATTED);
      await expect(page.locator('#post-42 .kb-act-links')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Play card' })).toHaveCount(0);
      await expect(page.locator('.kb-play-here')).toHaveCount(0);
      await page.goto(ARMED);
      await expect(page.locator('#post-42 .kb-play-here')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Play card' })).toHaveCount(0);
    });
  });
}

test('the plate on #41 reads out the card and its layers, and its controls are buttons with their names', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1120 });
  await page.goto(SPLATTED_AND_ARMED);
  const plate = page.locator('#post-41 .kb-effect-strip');
  await expect(plate).toBeVisible();
  await expect(plate.locator('.kb-plate-name')).toHaveText(/whoops!/iu);
  /* The readout names the top layer, its caster and its ink, with its own share washed (the plays-on-a-post design, section 5). */
  await expect(plate.locator('.kb-plate-state')).toHaveText(/^\d+ layers? · top: .+'s [a-z]+, \d+% washed$/u);
  const bars = await plate.locator('.kb-whoops-meter > *, [role="meter"] > *, .kb-whoops-bar').count();
  const layers = Number(/^(\d+)/u.exec((await plate.locator('.kb-plate-state').textContent()) ?? '')![1]);
  expect(bars).toBe(layers);
  await expect(plate.getByRole('button', { name: 'Hold to scrub' })).toBeVisible();
  await expect(plate.getByRole('button', { name: 'Play Whoops! here' })).toBeVisible();
  for (const name of ['Wash', 'Write in ink']) {
    const tool = plate.getByRole('button', { name });
    if (await tool.count()) await expect(tool).toHaveAttribute('aria-pressed', /^(true|false)$/u);
  }
});

/*
 * Forced colors (Windows High Contrast) replace the plate's backgrounds, which draw its edge, with the canvas: the plate
 * is edged by a border in a system color there, and is not cut by a clip-path that would cut the border's corners off.
 */
test.describe('in forced colors', () => {
  test.use({ forcedColors: 'active' });

  test('the effect plate has a visible edge in a system color', async ({ page }) => {
    await page.goto('/?fixture=boards&moment=01-main');
    const plate = page.locator('#post-41 .kb-effect-plate');
    await expect(plate).toBeVisible();
    const edge = await plate.evaluate((el) => {
      const probe = document.createElement('div');
      probe.style.cssText = 'forced-color-adjust: none; color: CanvasText';
      document.body.append(probe);
      const text = getComputedStyle(probe).color;
      probe.remove();
      const c = getComputedStyle(el);
      return { style: c.borderTopStyle, width: parseFloat(c.borderTopWidth), color: c.borderTopColor, text };
    });
    expect(edge.style).toBe('solid');
    expect(edge.width).toBeGreaterThanOrEqual(1);
    expect(edge.color).toBe(edge.text);
  });
});

/* The plate takes the post's width on the Phone board's layout, including a wide window folded to it by large text. */
test('the plate takes the post\'s full width where the layout is the phone\'s, whatever the window\'s width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1120 });
  await page.goto('/?fixture=boards&moment=01-main');
  const strip = page.locator('#post-41 .kb-effect-strip');
  await expect(strip).toBeVisible();
  const narrow = (await strip.boundingBox())!.width;
  await page.evaluate(() => document.documentElement.setAttribute('data-kb-layout', 'phone'));
  const folded = await strip.evaluate((el) => getComputedStyle(el).flexBasis);
  expect(narrow).toBeLessThan((await page.locator('#post-41 .kb-act-main').boundingBox())!.width - 48);
  expect(folded).toBe('100%');
});
