/**
 * The marks on a post and the Lens they open (docs/plans/2026-10-31-marks-and-the-lens-design.md, sections 1 and 2), measured in a
 * browser, which jsdom cannot: #41 of the stories `Boards/01 Marks` (six kinds of card on one post) and `Boards/01 Lens` (the
 * mockup's post), at the Main board's width and the Phone board's. The critique's numbers (the stack's and the plate's, which the
 * marks and the Lens replace) are held here again: a post with marks is as tall as with none, at 1440 and at 390; every mark stays
 * inside the window; the Lens beside a post never overlaps the post's words; and a mark opens its card's Lens. Glass text in the
 * Lens meets the floor in e2e/glass-text.spec.ts, which reads the Lens stories. The ghost mark and the glass's faces (the
 * plate's old spec, folded in below) close the file.
 */
import { expect, test, type Page } from '@playwright/test';

for (const [label, viewport, story] of [
  ['the Main board', { width: 1440, height: 1120 }, 'boards-01-marks--six-kinds'],
  ['the Phone board', { width: 390, height: 844 }, 'boards-01-marks--six-kinds-phone'],
] as const) {
  test.describe(`the marks on #41 on ${label}`, () => {
    test.use({ viewport });

    test('a post with marks adds 0px to its height: as tall with the story\'s four marks and "+2" as with none, and none leaves the window', async ({ page }) => {
      await page.goto(`/?fixture=boards&story=${story}`);
      const post = page.locator('#post-41');
      const marks = post.locator('.kb-mark');
      await expect(marks.first()).toBeVisible();
      /* Six real kinds: the strip draws what it has room for, and the rest fold into "+N". */
      await expect(marks).toHaveCount(viewport.width <= 640 ? 4 : 5);
      await expect(post.locator('.kb-mark-more')).toHaveText(viewport.width <= 640 ? '+3' : '+2');
      const height = async () => (await post.boundingBox())!.height;
      const drawn = await height();
      for (const box of await marks.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right }; }))) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(viewport.width);
      }
      /* None at all: the strip taken out of the page. */
      await post.locator('.kb-marks').evaluate((strip) => { (strip as HTMLElement).style.display = 'none'; });
      expect(await height(), 'the post is as tall with no marks as with six kinds').toBe(drawn);
    });

    test('a mark stands over the post\'s words without taking their place, and opens the Lens on its card, which Esc and its mark close and which leaves the page in use', async ({ page }) => {
      await page.goto(`/?fixture=boards&story=${story}`);
      const post = page.locator('#post-41');
      const mark = post.locator('.kb-mark[data-kb-card]').first();
      await expect(mark).toBeVisible();
      await expect(mark).toHaveAttribute('aria-expanded', 'false');
      await mark.click();
      await expect(mark).toHaveAttribute('aria-expanded', 'true');
      const lens = page.getByRole('dialog', { name: 'Cards on this post' });
      await expect(lens).toBeVisible();
      await expect(lens).toHaveAttribute('aria-modal', 'false');
      await expect(lens).toHaveAttribute('data-kb-lens', viewport.width <= 640 ? 'sheet' : /^(side|under|above)$/u);
      const box = (await lens.boundingBox())!;
      expect(box.x, 'the Lens starts inside the window').toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, 'and ends inside it').toBeLessThanOrEqual(viewport.width + 1);
      expect(box.y + box.height, 'and stays above the window\'s foot').toBeLessThanOrEqual(viewport.height + 1);
      /* The glow is a drop shadow on the unclipped wrapper, in the open tab's ink. */
      expect(await lens.evaluate((el) => getComputedStyle(el.parentElement!).filter)).toContain('drop-shadow');
      /* The page stays in use: a press on the post's words leaves it open. */
      await post.locator('.kb-act-main').click({ position: { x: 4, y: 4 } });
      await expect(lens).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(mark).toHaveAttribute('aria-expanded', 'false');
      await expect(mark).toBeFocused();
    });
  });
}

/*
 * Room (the quality review of Task 3): the strip is out of the page's flow, so the row has to keep its own words clear of
 * it. #41 of the armed story carries a real ghost mark; five more marks are cloned in, so the strip is wider than any real
 * one (a post draws four, "+N" and the ghost at most, which `Boards/01 Marks` six kinds measures above without the ghost). No
 * mark may touch the date or the "#n" link, and the height holds.
 */
for (const [label, viewport] of [['1440', { width: 1440, height: 1120 }], ['390', { width: 390, height: 844 }]] as const) {
  test.describe(`a strip wider than any real one, with the ghost mark, on #41 at ${label}`, () => {
    test.use({ viewport });

    test('no mark meets the date or the permalink, the date gives way on one line, and the post keeps its height', async ({ page }) => {
      await page.goto('/?fixture=boards&story=boards-01-marks--armed');
      const post = page.locator('#post-41');
      await expect(post.locator('.kb-ghost-mark')).toBeVisible();
      await expect(post.locator('.kb-mark[data-kb-card]:not(.kb-ghost-mark)').first()).toBeVisible();
      const height = async () => (await post.boundingBox())!.height;
      const before = await height();
      await post.locator('.kb-marks').evaluate((strip) => {
        const first = strip.querySelector('.kb-mark:not(.kb-ghost-mark)')!;
        const ghost = strip.querySelector('.kb-ghost-mark')!;
        for (let i = 0; i < 5; i++) strip.insertBefore(first.cloneNode(true), ghost);
      });
      await expect(post.locator('.kb-mark')).toHaveCount(7);
      /* The strip tells its cell its width from a ResizeObserver, a step after the clones land: read nothing until it has. */
      await expect.poll(() => post.locator('.kb-marks').evaluate((strip) => strip.parentElement!.style.getPropertyValue('--kb-marks-width') === `${Math.ceil(strip.getBoundingClientRect().width)}px`)).toBe(true);
      const rects = await post.evaluate((el) => {
        const r = (e: Element) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
        return {
          marks: [...el.querySelectorAll('.kb-mark')].map(r),
          time: r(el.querySelector('header time')!),
          number: r(el.querySelector('.kb-act-number')!),
          timeHeight: el.querySelector('header time')!.getBoundingClientRect().height,
          lineHeight: parseFloat(getComputedStyle(el.querySelector('header time')!).lineHeight) || 0,
          row: r(el.querySelector('header')!),
        };
      });
      const meets = (a: { l: number; r: number; t: number; b: number }, b: { l: number; r: number; t: number; b: number }) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
      for (const [i, m] of rects.marks.entries()) {
        expect(meets(m, rects.time), `mark ${i + 1} meets the date`).toBe(false);
        expect(meets(m, rects.number), `mark ${i + 1} meets the permalink`).toBe(false);
        expect(m.l).toBeGreaterThanOrEqual(0);
        expect(m.r).toBeLessThanOrEqual(viewport.width);
      }
      expect(await post.locator('header time').evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('nowrap');
      expect(await height(), 'the post keeps its height').toBe(before);
    });
  });
}

test.describe('the ghost mark and the edge', () => {
  test.use({ viewport: { width: 1440, height: 1120 } });

  test('the ghost takes the card\'s color over its alignment\'s', async ({ page }) => {
    await page.goto('/?fixture=boards&story=boards-01-marks--armed');
    const ghost = page.locator('#post-41 .kb-ghost-mark');
    await expect(ghost).toBeVisible();
    const same = await ghost.evaluate((el) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--kb-mark-color)';
      el.append(probe);
      const card = getComputedStyle(probe).color;
      probe.remove();
      return getComputedStyle(el).borderTopColor === card;
    });
    expect(same).toBe(true);
  });

  test.describe('in forced colors', () => {
    test.use({ forcedColors: 'active' });

    test('an edge keeps its fill: progress is still a gradient, not a full bar', async ({ page }) => {
      await page.goto('/?fixture=boards&story=boards-01-marks--six-kinds');
      const mark = page.locator('#post-41 .kb-mark[data-kb-card]').first();
      await expect(mark).toBeVisible();
      const image = await mark.evaluate((el) => {
        const edge = document.createElement('span');
        edge.className = 'kb-mark-edge';
        el.style.setProperty('--kb-mark-progress', '0.4');
        el.append(edge);
        return getComputedStyle(edge).backgroundImage;
      });
      expect(image).toContain('linear-gradient');
    });
  });
});

/*
 * The Lens never overlaps its post's words where the window has room for its side panel (the critique measured the unstacked list
 * over the plate by 37 to 194px). The mockup's post #41 where the window has room for the side panel: the board is a column at most
 * 960px wide (engine/ui/tokens.css `--kb-board-max`), the Lens is 420px and wants a gutter, so it stands in the margin from about
 * 1660px wide up, and the post's words and ink are all left of it. At 1440 the margin is 240px, so the Lens stands under its mark
 * (`data-kb-lens="under"`, kept in the window); that it then covers the post's own words is the plan's gap, reported with Task 8. On a
 * phone it is a sheet, which the first describe above measures inside the window.
 */
for (const [name, story] of [['Whoops!', 'boards-01-lens--lens-whoops-who'], ['Stick Around', 'boards-01-lens--lens-stick-around-who'], ['the author\'s Whoops!', 'boards-01-lens--lens-author-whoops-who']] as const) {
  test.describe(`the Lens on ${name}, Who unfolded, at 1920`, () => {
    test.use({ viewport: { width: 1920, height: 1080 } });

    test('stands beside the post and never overlaps its words or its ink, and stays in the window', async ({ page }) => {
      await page.goto(`/?fixture=boards&story=${story}`);
      const lens = page.getByRole('dialog', { name: 'Cards on this post' });
      await expect(lens).toBeVisible();
      await expect(lens).toHaveAttribute('data-kb-lens', 'side');
      await expect(lens.locator('.kb-lens-fold')).toHaveAttribute('aria-expanded', 'true');
      const [l, body, article] = await Promise.all([lens.boundingBox(), page.locator('#post-41 .kb-act-main').boundingBox(), page.locator('#post-41').boundingBox()]);
      expect(l!.x, 'the Lens starts right of the post\'s words').toBeGreaterThanOrEqual(body!.x + body!.width - 1);
      expect(l!.x, 'and of the post').toBeGreaterThanOrEqual(article!.x + article!.width - 1);
      expect(l!.x + l!.width).toBeLessThanOrEqual(1920 + 1);
      expect(l!.y).toBeGreaterThanOrEqual(0);
      expect(l!.y + l!.height).toBeLessThanOrEqual(1080 + 1);
    });
  });
}

/*
 * The Whoops! and ghost mark tests of the plate's file (the plate's old spec), folded in. The plate is gone: the
 * ghost mark is the play control, and Whoops!'s state and controls are the Lens's, opened by its mark.
 */
/**
 * A card's ghost mark over a 2003 post, and Whoops!'s controls in the Lens, in a real browser (the owner on #80's round 2: "I think
 * the Play Here button is inheriting the Verdana"; the play control is the ghost mark since the marks-and-the-lens plan's Task 3,
 * and Whoops! draws no plate since its Task 6: its state and controls are the Lens's, opened by its mark). Two things are held
 * here: that no glass control in or under a 2003 post, or in the Lens, is set in the 2003 board's faces (a control drawn under
 * the board's `body` takes the board's font unless it names the glass's own), and the shape the approved stories
 * (engine/ui/cards/Marks.board.stories.tsx) give the marks: the ghost mark in the post's date row, never in the 2003 action
 * row, and the Lens's State, Hold to scrub and the author's tool choice as buttons with their names.
 */
test.describe('glass in the 2003 board, reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  const SPLATTED_AND_ARMED = '/?fixture=boards&story=boards-01-marks--armed';
  const ARMED = '/?fixture=boards&story=boards-01-marks--armed';
  const SPLATTED = '/?fixture=boards&story=boards-01-marks--one-play';

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
      const pick = 'article.kb-act .kb-glass, article.kb-act .kb-glass *, article.kb-act .kb-mark';
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
        await expect(page.locator('article.kb-act .kb-act-links .kb-ghost-mark, article.kb-act .kb-act-main .kb-ghost-mark')).toHaveCount(0);
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
    await expect(page.locator('.kb-effect-strip, .kb-effect-plate, .kb-act-slot')).toHaveCount(0);
    const lens = await openWhoopsLens(page);
    /* The State names the top layer, its caster and its ink, with its own share washed (the plays-on-a-post design, section 5). */
    await expect(lens.locator('.kb-lens-state .kb-lens-line')).toHaveText(/^\d+ layers? · top: .+'s [a-z]+, \d+% washed$/u);
    await expect(lens.locator('.kb-lens-ends')).toHaveText(/^Ends on your screen when you scrub every layer off\./u);
    await expect(lens.getByRole('button', { name: 'Hold to scrub' })).toBeVisible();
    /* The armed card is the post's ghost mark, in its date row, and not among the Lens's controls. */
    await expect(lens.getByRole('button', { name: /^Play Whoops!/u })).toHaveCount(0);
    await expect(page.locator('#post-41').getByRole('button', { name: 'Play Whoops! on post 41' })).toBeVisible();
    /* The moment's player is #41's author (the mark says "Yours to act on"): the hold and the two-tool choice, no more. */
    await expect(page.locator('#post-41 .kb-mark[data-kb-card="whoops"]:not(.kb-ghost-mark)')).toHaveAttribute('aria-label', /Yours to act on/u);
    await expect(lens.getByRole('group', { name: 'Your tool' })).toBeVisible();
    for (const name of ['Wash', 'Write in ink']) await expect(lens.getByRole('button', { name })).toHaveAttribute('aria-pressed', /^(true|false)$/u);
    await expect(lens.locator('.kb-kit-tile')).toHaveCount(3);
  });


  test('a reader of a splatted post has the hold alone in the Lens: no tool choice', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1120 });
    /* The 08-hold moment signs in the reader account, who wrote none of the posts. */
    await page.goto('/?fixture=boards&story=boards-08-hold--whoops-under-hold');
    const mark = page.locator('.kb-mark[data-kb-card="whoops"]:not(.kb-ghost-mark)').first();
    await expect(mark).toBeVisible();
    await expect(mark).not.toHaveAttribute('aria-label', /Yours to act on/u);
    await mark.click();
    const lens = page.getByRole('dialog', { name: 'Cards on this post' });
    await expect(lens.getByRole('button', { name: 'Hold to scrub' })).toBeVisible();
    await expect(lens.locator('.kb-kit-tile')).toHaveCount(1);
    await expect(lens.getByRole('group', { name: 'Your tool' })).toHaveCount(0);
  });

});
