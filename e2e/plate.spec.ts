import { expect, test, type Page } from '@playwright/test';

/**
 * A card's ghost mark over a 2003 post, and Whoops!'s controls in the Lens, in a real browser (the owner on #80's round 2: "I think
 * the Play Here button is inheriting the Verdana"; the play control is the ghost mark since the marks-and-the-lens plan's Task 3,
 * and Whoops! draws no plate since its Task 6: its state and controls are the Lens's, opened by its mark). Two things are held
 * here: that no glass control in or under a 2003 post, or in the Lens, is set in the 2003 board's faces (a control drawn under
 * the board's `body` takes the board's font unless it names the glass's own), and the shape the approved stories
 * (engine/ui/cards/Plate.board.stories.tsx) give the marks: the ghost mark in the post's date row, never in the 2003 action
 * row, and the Lens's State, Hold to scrub and the author's tool choice as buttons with their names.
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
    const pick = 'article.kb-act .kb-glass, article.kb-act .kb-glass *, article.kb-act .kb-plate-tile, article.kb-act .kb-mark';
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

/** Opens the Lens on #41's Whoops! mark (the card's state and controls are there, not in a plate), and answers the Lens. */
async function openWhoopsLens(page: Page) {
  const mark = page.locator('#post-41 .kb-mark[data-kb-card="whoops"]:not(.kb-ghost-mark)');
  await expect(mark).toBeVisible();
  await mark.click();
  const lens = page.getByRole('dialog', { name: 'Cards on this post' });
  await expect(lens).toBeVisible();
  return lens;
}

test('the ghost mark on #42 is set in the glass\'s face, not the 2003 board\'s', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1120 });
  await page.goto(ARMED);
  await expect(page.locator('#post-42 .kb-ghost-mark')).toBeVisible();
  await expectGlassFaces(page, 'kb-ghost-mark');
});

test('the ghost mark on #41, and the Lens\'s kit tiles, are set in the glass\'s face', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1120 });
  await page.goto(SPLATTED_AND_ARMED);
  await expect(page.locator('#post-41 .kb-ghost-mark')).toBeVisible();
  await expectGlassFaces(page, 'kb-ghost-mark');
  await openWhoopsLens(page);
  const f = await faces(page);
  const tiles = await page.locator('.kb-lens .kb-kit-tile').evaluateAll((els) => els.map((el) => ({ text: (el.textContent ?? '').trim(), family: getComputedStyle(el).fontFamily })));
  expect(tiles.length).toBeGreaterThan(0);
  for (const t of tiles) {
    expect([f.glass, f.display], `${t.text} is set in ${t.family}`).toContain(t.family);
    expect(t.family).not.toMatch(/Verdana|Geneva|Courier/u);
  }
});

for (const [name, width, height] of [['1440', 1440, 1120], ['390', 390, 844]] as const) {
  test.describe(`at ${name}`, () => {
    test.use({ viewport: { width, height } });

    test('the armed card\'s ghost mark is never in the 2003 action row or body: it ends the strip in the date row of #41 and of #42', async ({ page }) => {
      await page.goto(SPLATTED_AND_ARMED);
      await expect(page.locator('#post-41 .kb-ghost-mark')).toBeVisible();
      await expect(page.locator('#post-42 .kb-ghost-mark')).toBeVisible();
      await expect(page.locator('article.kb-act .kb-act-links .kb-ghost-mark, article.kb-act .kb-act-main .kb-ghost-mark, article.kb-act .kb-act-slot .kb-ghost-mark')).toHaveCount(0);
      await expect(page.locator('#post-42 .kb-act-meta .kb-ghost-mark')).toHaveCount(1);
    });

    test('no post has "Play card" in its row, armed or not: the armed card is the ghost mark alone', async ({ page }) => {
      await page.goto(SPLATTED);
      await expect(page.locator('#post-42 .kb-act-links')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Play card' })).toHaveCount(0);
      await expect(page.locator('.kb-ghost-mark')).toHaveCount(0);
      await page.goto(ARMED);
      await expect(page.locator('#post-42 .kb-ghost-mark')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Play card' })).toHaveCount(0);
    });
  });
}

test('Whoops!\'s mark on #41 opens the Lens, which reads out the card and its layers, and its controls are buttons with their names; no plate is drawn', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1120 });
  await page.goto(SPLATTED_AND_ARMED);
  await expect(page.locator('#post-41 .kb-whoops')).toBeVisible();
  await expect(page.locator('.kb-effect-strip, .kb-effect-plate')).toHaveCount(0);
  const lens = await openWhoopsLens(page);
  /* The State names the top layer, its caster and its ink, with its own share washed (the plays-on-a-post design, section 5). */
  await expect(lens.locator('.kb-lens-state .kb-lens-line')).toHaveText(/^\d+ layers? · top: .+'s [a-z]+, \d+% washed$/u);
  await expect(lens.locator('.kb-lens-ends')).toHaveText(/^Ends on your screen when you scrub every layer off\./u);
  await expect(lens.getByRole('button', { name: 'Hold to scrub' })).toBeVisible();
  /* The armed card is the post's ghost mark, in its date row, and not among the Lens's controls. */
  await expect(lens.getByRole('button', { name: /^Play Whoops!/u })).toHaveCount(0);
  await expect(page.locator('#post-41').getByRole('button', { name: 'Play Whoops! on post 41' })).toBeVisible();
  /* The reader has the hold alone; the author's two tools are there only for the author. */
  const tools = await lens.getByRole('group', { name: 'Your tool' }).count();
  if (tools) {
    for (const name of ['Wash', 'Write in ink']) await expect(lens.getByRole('button', { name })).toHaveAttribute('aria-pressed', /^(true|false)$/u);
  }
  expect(await lens.locator('.kb-kit-tile').count()).toBeLessThanOrEqual(3);
});

