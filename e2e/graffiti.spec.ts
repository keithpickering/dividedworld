import { expect, test, devices, type Locator, type Page } from '@playwright/test';
import type { Fake } from '../engine/ui/data/fake.ts';
import type { Demo } from '../web/src/demo.ts';

/**
 * Graffiti in a real browser, which jsdom cannot draw (docs/plans/2026-11-11-graffiti-plan.md, Task 12), against the fake data: a card played on a
 * post by drawing on it and Tag it, a second character's tag through the Draw tile, the author's wash and the meter falling for both masks, a
 * reader's scrub that a reload brings back, a tag over the limit refused with the figures, a stencil tagged by keyboard alone, and, on an emulated
 * Pixel 7, a quick vertical swipe over the wall that scrolls the page and draws nothing.
 *
 * The demo world is Mrs. Hooligan and Pipewrench (both the signed-in player's) and Spritey (another player's) in "Who keeps reacting with a thumbs up?". Post
 * #2 is Pipewrench's, so Mrs. Hooligan casts the card on it and Pipewrench is the author who may wash. A seed has to land before the player's hand is
 * read, so an init script waits for the demo to be exposed (web/src/demo.ts `exposeFake`) and seeds in the same task.
 */
type E2eWindow = typeof globalThis & { readonly __kbFake: Fake; readonly __kbDemo: Demo; __kbWall?: Promise<string> };

const THREAD = 'Who keeps reacting with a thumbs up?';
const POST = 2;
const LIMIT = 40;

/** A wave across the body about the height `y`, as a stroke of the card's own shape (aspect 3, the cells it covers are shares of the box). */
type Spec = readonly [can: string, cap: string, y: number, x0: number, x1: number, amp: number];
/** One fat stroke: a wall of about 8%. */
const SMALL: readonly Spec[] = [['red', 'fat', 0.3, 0.04, 0.7, 0.08]];
/** Three: about 25%, enough paint to scrub and to see. */
const SOME: readonly Spec[] = [['red', 'fat', 0.3, 0.04, 0.7, 0.08], ['orange', 'fat', 0.62, 0.2, 0.9, 0.1], ['lime', 'fat', 0.12, 0.4, 0.95, 0.05]];
/** Five: the story's wall at 31% of its 40% limit. */
const NEAR: readonly Spec[] = [...SOME, ['pink', 'stock', 0.82, 0.05, 0.6, 0.06], ['purple', 'fat', 0.45, 0.05, 0.54, 0.12]];

/**
 * Hands the demo player a Graffiti card (and a Whoops!, so the hand is not one card) before the app reads its hand, and, for `wall`, Mrs. Hooligan's play of
 * the card on post 2 with her tag on it (`by` Spritey, another player's mask, for a reader who is neither tagger nor author), as a real draw so the fake's surface model counts it. `__kbWall` settles to the play's id once it is written.
 */
async function world(page: Page, wall: readonly Spec[] | null = null, by: 'hooligan' | 'spritey' = 'hooligan'): Promise<void> {
  await page.addInitScript(([strokes, by]) => {
    let demo: unknown;
    Object.defineProperty(globalThis, '__kbDemo', {
      configurable: true,
      get: () => demo,
      set(v: Demo) {
        demo = v;
        const w = globalThis as E2eWindow;
        w.__kbFake.seed.cards(v.me, { graffiti: 2, whoops: 1 });
        /* Every card met, so no callout hangs off a mark over the post's Draw tile. */
        for (const card of ['graffiti', 'whoops', 'stick-around']) void w.__kbFake.meetCard(card);
        if (!strokes) return;
        w.__kbWall = (async () => {
          const fake = w.__kbFake;
          const target = (await fake.acts(v.thread, 1, 3)).find((a) => a.seq === 2)!;
          const tagger = v.characters[by];
          const play = fake.seed.card(tagger, target.id, 'graffiti', { layer: 1 });
          const wave = ([can, cap, y, x0, x1, amp]: readonly [string, string, number, number, number, number]) => ({
            can, cap, aspect: 3,
            points: Array.from({ length: 25 }, (_, i) => [Math.round((x0 + (x1 - x0) * (i / 24)) * 1e4) / 1e4, Math.round((y + amp * Math.sin((i / 24) * Math.PI * 2)) * 1e4) / 1e4]),
          });
          /* Spritey is another player's: the draw is made as that account (the call reads the session as it starts), and the player is signed back in at once. */
          if (by === 'spritey') fake.signInAs(v.other);
          const drawing = fake.draw(play, tagger, { strokes: strokes.map(wave) });
          if (by === 'spritey') fake.signInAs(v.me);
          const drawn = await drawing;
          if (!drawn.ok) throw new Error(drawn.error);
          return play;
        })();
      },
    });
  }, [wall, by] as const);
}

async function openThread(page: Page): Promise<void> {
  await page.goto('/b/general');
  await page.getByRole('link', { name: THREAD, exact: true }).click();
  await expect(page.locator(`#post-${POST}`)).toBeVisible();
  if (await page.evaluate(() => (globalThis as E2eWindow).__kbWall !== undefined)) await page.evaluate(() => (globalThis as E2eWindow).__kbWall);
}

const post = (page: Page) => page.locator(`#post-${POST}`);
const wallInk = (page: Page) => post(page).locator('.kb-graffiti-ink');
const dock = (page: Page) => page.getByRole('group', { name: 'Graffiti tools' });
const surface = (page: Page) => page.locator(`#post-${POST} [data-kb-draw-surface]`);
const swap = (page: Page, name: string) => page.getByLabel(/^(Swap mask|Posting as)$/).selectOption({ label: name });

/** The pixels of the wall's canvas that hold paint. */
const inked = (page: Page) => page.evaluate((n) => {
  const c = document.querySelector<HTMLCanvasElement>(`#post-${n} .kb-graffiti-ink`);
  if (!c) return 0;
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let count = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i]! > 40) count++;
  return count;
}, POST);

/** A stroke with the mouse across the drawing surface at `y` (a share of its height), from `x0` to `x1`. */
async function stroke(page: Page, y: number, x0 = 0.1, x1 = 0.9): Promise<void> {
  const box = (await surface(page).boundingBox())!;
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y, { steps: 14 });
  await page.mouse.up();
}

/** Opens the Draw tile as the HUD's character, reads the dock's meter ("Wall 12% of 40%") and leaves with nothing drawn. */
async function meter(page: Page): Promise<number> {
  await post(page).getByRole('button', { name: 'Draw' }).click();
  const label = dock(page).locator('.kb-graffiti-label');
  await expect(label).toContainText(`% of ${LIMIT}%`);
  const text = ((await label.textContent()) ?? "").replace(/\s+/gu, " ");
  await dock(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(dock(page)).toBeHidden();
  return Number(/Wall (\d+)% of/iu.exec(text)![1]);
}

/** The Lens's hold, pressed by keyboard for `ms` and let go: the kit's tile starts on Space and stops on its release. */
async function hold(page: Page, name: 'Hold to scrub' | 'Wash', ms: number): Promise<void> {
  await post(page).locator('.kb-mark[data-kb-card="graffiti"]:not(.kb-ghost-mark)').click();
  const lens = page.getByRole('dialog', { name: 'Cards on this post' });
  const tile = lens.getByRole('button', { name });
  await tile.focus();
  await page.keyboard.down('Space');
  await page.waitForTimeout(ms);
  await page.keyboard.up('Space');
  await page.keyboard.press('Escape');
  await expect(lens).toBeHidden();
}

test.describe('on a wide screen', () => {
  test.use({ viewport: { width: 1280, height: 1100 }, reducedMotion: 'reduce' });

  test('Graffiti is played on a post by drawing on it and Tag it, and the post becomes a wall', async ({ page }) => {
    await world(page);
    await openThread(page);
    await page.getByRole('button', { name: /^Hand, \d+ postcards?$/ }).click();
    await page.getByRole('dialog', { name: 'Your hand' }).getByRole('button', { name: /^Graffiti, / }).first().click();
    const ghost = post(page).getByRole('button', { name: `Play Graffiti on post ${POST}` });
    await ghost.click();
    /* The drawing is the card's form: Tag it waits for something drawn, and says so. */
    const tag = dock(page).getByRole('button', { name: 'Tag it' });
    await expect(tag).toHaveAttribute('aria-disabled', 'true');
    await expect(dock(page)).toContainText('Draw something first');
    await dock(page).getByRole('radio', { name: 'Fat' }).click();
    await stroke(page, 0.5);
    await expect(surface(page)).toHaveAttribute('data-kb-strokes', '1');
    await expect(dock(page).locator('.kb-graffiti-label')).not.toContainText('Wall 0%');
    /* The figure the toolbar read for the drawing is the wall's once it lands: the drawing and the wall are in the body's one box. */
    const drawn = Number(/Wall (\d+)% of/iu.exec((await dock(page).locator('.kb-graffiti-label').textContent()) ?? '')![1]);
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(LIMIT);
    await tag.click();
    await expect(dock(page)).toBeHidden();
    /* The post wears the card: its mark and the wall's ink. */
    await expect(post(page).locator('.kb-mark[data-kb-card="graffiti"]:not(.kb-ghost-mark)')).toBeVisible();
    await expect(wallInk(page)).toBeVisible();
    await expect.poll(() => inked(page)).toBeGreaterThan(500);
    expect(await meter(page)).toBe(drawn);
    /* A wall takes a Draw tile for any character at the body's top right (a card's own tile, never over the words' left). */
    const tile = await post(page).getByRole('button', { name: 'Draw' }).boundingBox();
    const body = (await post(page).locator('.kb-act-main').boundingBox())!;
    expect(tile).not.toBeNull();
    expect(tile!.y).toBeGreaterThanOrEqual(body.y - 1);
    expect(tile!.y, 'the tile sits 8px under the top of the body, not in its flow below the words').toBeLessThan(body.y + 20);
    expect(tile!.x + tile!.width, 'and inside its right edge').toBeLessThanOrEqual(body.x + body.width + 1);
  });

  test('a second character draws through the Draw tile, the author washes, and the meter falls for both masks', async ({ page }) => {
    await world(page, SMALL);
    await openThread(page);
    await expect.poll(() => inked(page)).toBeGreaterThan(500);
    /* Mrs. Hooligan's tag is there: the meter reads it. Pipewrench, the post's author, is a second mask and tags like anyone. */
    const first = await meter(page);
    expect(first).toBeGreaterThan(0);
    await swap(page, 'Pipewrench');
    await post(page).getByRole('button', { name: 'Draw' }).click();
    await dock(page).getByRole('radio', { name: 'Fat' }).click();
    await dock(page).getByRole('radio', { name: 'Cyan' }).click();
    await stroke(page, 0.8);
    await dock(page).getByRole('button', { name: 'Tag it' }).click();
    await expect(dock(page)).toBeHidden();
    const both = await meter(page);
    expect(both, 'two tags cover more than one').toBeGreaterThan(first);
    /* The other mask reads the same wall before the wash. */
    await swap(page, 'Mrs. Hooligan');
    expect(await meter(page)).toBe(both);
    await swap(page, 'Pipewrench');
    /* The author washes: held on the Lens's Wash (Space), the wall is swept and saved for everyone. */
    await hold(page, 'Wash', 6000);
    await expect.poll(() => meter(page), { timeout: 15_000 }).toBeLessThan(both);
    const washed = await meter(page);
    /* The fall is the other mask's too: the wall is one, not each mask's own. */
    await swap(page, 'Mrs. Hooligan');
    expect(await meter(page)).toBe(washed);
    expect(washed).toBeLessThan(both);
  });

  test('a reader who neither tagged nor wrote the post scrubs on their own screen only, and the wall is back on coming to the page again', async ({ page }) => {
    /* Spritey's tag on Pipewrench's post: the signed-in player's Mrs. Hooligan is the reader. */
    await world(page, SOME, 'spritey');
    await openThread(page);
    await expect(wallInk(page)).toBeVisible();
    await expect.poll(() => inked(page)).toBeGreaterThan(1500);
    const before = await inked(page);
    const wall = () => page.evaluate(async () => {
      const w = globalThis as E2eWindow;
      const s = (await w.__kbFake.surfaceActs(await w.__kbWall!))!;
      return { acts: s.acts.map((a) => a.id + a.kind), covered: s.covered };
    });
    const saved = await wall();
    const figure = await meter(page);
    await hold(page, 'Hold to scrub', 3000);
    await expect.poll(() => inked(page)).toBeLessThan(before * 0.9);
    /* The scrub is this screen's: the wall's own Acts and the covered figure are what they were, and the toolbar still reads them. */
    await page.waitForTimeout(1500);
    expect(await wall()).toEqual(saved);
    expect(await meter(page)).toBe(figure);
    /* Leaving the page and coming back (client-side: a reload would seed the demo again) brings the paint back. */
    await page.getByRole('link', { name: 'General', exact: true }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'General' })).toBeVisible();
    await page.getByRole('link', { name: THREAD, exact: true }).click();
    await expect(wallInk(page)).toBeVisible();
    await expect.poll(() => inked(page)).toBeGreaterThan(before * 0.95);
  });

  test('a tag over the limit is refused with the figures, in the toolbar and by the data itself', async ({ page }) => {
    await world(page, NEAR);
    await openThread(page);
    await expect.poll(() => inked(page)).toBeGreaterThan(1500);
    expect(await meter(page)).toBe(31);
    await post(page).getByRole('button', { name: 'Draw' }).click();
    const tag = dock(page).getByRole('button', { name: 'Tag it' });
    await dock(page).getByRole('radio', { name: 'Fat' }).click();
    for (const y of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]) await stroke(page, y, 0.05, 0.95);
    /* The toolbar says what the tag would do, with both figures, and Tag it sends nothing. */
    await expect(dock(page).locator('.kb-graffiti-reason')).toHaveText(/^This tag would take the wall to \d+%; its limit is 40%$/u);
    await expect(tag).toHaveAttribute('aria-disabled', 'true');
    /* Pressed anyway (force: the button is aria-disabled, which a click would wait on forever): nothing is sent, and the toolbar stays. */
    await tag.click({ force: true });
    await expect(dock(page)).toBeVisible();
    expect(await page.evaluate(async () => {
      const w = globalThis as E2eWindow;
      return (await w.__kbFake.surfaceActs(await w.__kbWall!))!.acts.filter((a) => a.kind === 'draw').length;
    })).toBe(1);
    /* Not a guard the screen alone holds: the data refuses the same tag in the database's own words, with the figures. */
    const refused = await page.evaluate(async () => {
      const w = globalThis as E2eWindow;
      const rows = Array.from({ length: 8 }, (_, i) => ({ can: 'black', cap: 'fat', aspect: 3, points: [[0.02, 0.05 + i * 0.12], [0.98, 0.05 + i * 0.12]] }));
      return w.__kbFake.draw(await w.__kbWall!, w.__kbDemo.characters.hooligan, { strokes: rows });
    });
    expect(refused).toMatchObject({ ok: false });
    expect((refused as { error: string }).error).toMatch(/^this wall is 31% covered, and its limit is 40%; this tag would take it to \d+%$/u);
  });

  test('a stencil is tagged by keyboard alone', async ({ page }) => {
    await world(page, SMALL);
    await openThread(page);
    await expect.poll(() => inked(page)).toBeGreaterThan(500);
    const before = await page.evaluate(async () => { const w = globalThis as E2eWindow; return (await w.__kbFake.surfaceActs(await w.__kbWall!))!.acts.length; });
    /* Focus is put on the tile as a Tab would reach it; every key after it is the keyboard's. */
    await post(page).getByRole('button', { name: 'Draw' }).focus();
    await page.keyboard.press('Enter');
    await expect(dock(page)).toBeVisible();
    const tabs = dock(page).getByRole('tab');
    await expect(tabs.first()).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(dock(page).getByRole('tab', { name: 'Stencils' })).toHaveAttribute('aria-selected', 'true');
    await expect(dock(page)).toContainText('Choose a stencil first');
    /* Tab goes on into the stencils (one stop for the group), where an arrow chooses and the group's own focus follows. */
    const tabTo = async (target: Locator) => {
      for (let i = 0; i < 40; i++) {
        if (await target.evaluate((el) => el === document.activeElement)) return;
        await page.keyboard.press('Tab');
      }
      throw new Error(`the keyboard never reached the control; it is on ${await page.evaluate(() => { const e = document.activeElement; return `${e?.tagName} ${e?.getAttribute('aria-label') ?? e?.textContent?.slice(0, 20)}`; })}`);
    };
    const stencils = dock(page).getByRole('radiogroup', { name: 'Stencil' });
    await tabTo(stencils.locator('[role="radio"][tabindex="0"]'));
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
    await expect(stencils.getByRole('radio', { checked: true })).toHaveCount(1);
    const spot = dock(page).getByRole('radiogroup', { name: 'Spot' });
    /* A group is one stop, the chosen choice's (the spot starts at the middle). */
    await tabTo(spot.locator('[role="radio"][tabindex="0"]'));
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
    await expect(dock(page).getByRole('button', { name: 'Tag it' })).toHaveAttribute('aria-disabled', 'false');
    await tabTo(dock(page).getByRole('button', { name: 'Tag it' }));
    await page.keyboard.press('Enter');
    await expect(dock(page)).toBeHidden();
    const after = await page.evaluate(async () => { const w = globalThis as E2eWindow; return (await w.__kbFake.surfaceActs(await w.__kbWall!))!.acts; });
    expect(after.length).toBe(before + 1);
    expect(JSON.stringify(after.at(-1)!.payload)).toContain('stencil');
    /* Focus returns to the tile the keyboard came from. */
    await expect(post(page).getByRole('button', { name: 'Draw' })).toBeFocused();
  });
});

/*
 * A finger on the wall (design section 6), sent as real touches through the protocol on an emulated Pixel 7: a quick vertical swipe over the wall is the
 * page's. It scrolls, and draws nothing, whether the toolbar is closed (the wall's own scrub) or open (the drawing surface).
 */
test.describe('on a Pixel 7', () => {
  const { defaultBrowserType: _browser, ...pixel } = devices['Pixel 7'];
  test.use({ ...pixel });

  test('a quick vertical swipe over the wall scrolls the page and draws nothing, closed and open', async ({ page }) => {
    await world(page, SOME);
    await openThread(page);
    await expect(wallInk(page)).toBeVisible();
    await expect.poll(() => inked(page)).toBeGreaterThan(1500);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: x!, y: y! }] });
    const scrollY = () => page.evaluate(() => window.scrollY);
    /* The point is on the wall's body, above the toolbar's foot and the HUD, whatever the layout. */
    const swipe = async () => {
      await wallInk(page).evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => window.scrollBy(0, -140));
      const box = (await wallInk(page).boundingBox())!;
      const x = box.x + box.width / 2, y = Math.min(box.y + box.height * 0.5, 600);
      const y0 = await scrollY();
      await touch('touchStart', x, y);
      for (let i = 1; i <= 8; i++) { await touch('touchMove', x, y - i * 20); await page.waitForTimeout(8); }
      await touch('touchEnd');
      await expect.poll(scrollY).toBeGreaterThan(y0);
    };
    const before = await inked(page);
    await swipe();
    expect(await inked(page), 'the swipe scrubbed nothing off the wall').toBe(before);
    /* The toolbar open: the surface lies over the body, and the same swipe is still the page's. */
    await post(page).getByRole('button', { name: 'Draw' }).tap();
    await expect(surface(page)).toBeVisible();
    await swipe();
    await expect(surface(page)).toHaveAttribute('data-kb-strokes', '0');
    await expect(dock(page).getByRole('button', { name: 'Tag it' })).toHaveAttribute('aria-disabled', 'true');
  });
});
