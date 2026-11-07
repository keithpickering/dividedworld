/**
 * The Lens's frame (docs/plans/2026-11-05-backfill-boards-design.md, section 6; plan Task 10; board 28 and board 32's first screen),
 * measured in a browser, which jsdom cannot: the Lens open on #41 with its five kinds and Who unfolded (the story `Boards/01 Lens` >
 * `Five kinds`), the panel longer than its room. The critique's find was that nothing in a Lens was reachable below the HUD and nothing
 * said there was more; so at 1440 and at 390 (and at a tablet's 834) the Lens's scrolling part is scrolled to its end and its last
 * control must lie inside the panel and above the HUD, and be what a pointer finds there (not covered by the HUD, the bar or the fade).
 *
 * Docked at the right from the page's top, 16px, to 16px above the HUD, 460px wide at 1440 and never under 360, where the window is wider than a
 * tablet's 1024px (64em); up to that a sheet that ends on the HUD's top edge (834 and 390 here). The fade at the foot is there only while more lies below.
 */
import { expect, test, type Page } from '@playwright/test';
import { settled } from './settled.ts';

const STORY = '/?fixture=boards&story=boards-01-lens--five-kinds';

const VIEWPORTS = [
  { label: '1440', width: 1440, height: 1000, place: 'dock' },
  { label: '834', width: 834, height: 1112, place: 'sheet' },
  { label: '390', width: 390, height: 844, place: 'sheet' },
] as const;

/** Opens the story and waits for its Lens. */
async function openLens(page: Page) {
  await page.goto(STORY);
  const lens = page.getByRole('dialog', { name: 'Cards on this post' });
  await expect(lens).toBeVisible({ timeout: 15_000 });
  /* Who is unfolded by the story, so there is more than a screen of it. */
  await expect(lens.getByRole('button', { name: /^3 plays · / })).toHaveAttribute('aria-expanded', 'true');
  /* Unfolding Who grows the panel, which places itself again a frame later: its body is not scrollable (and the fade is not shown) until it has. */
  await expect(lens).toHaveAttribute('data-kb-more', 'true');
  /* The Lens enters by the feel (it scales up from its button): a measure is taken where it will stand, not mid-way (the smoke drifts for as long as the page is up, so loops are not waited on). */
  await settled(page, { loops: true });
  return lens;
}

/**
 * Waits until the Lens's body has stopped changing size: its head, its heading and its list arrive a few frames after it opens and grow it by a hundred
 * pixels or so, with no scroll event, so a position taken before that is short of the end the body ends up with. Settled is 30 frames (half a second) of
 * the same scroll height and client height.
 */
async function bodySettled(page: Page) {
  await page.evaluate(() => new Promise<void>((done) => {
    const body = document.querySelector<HTMLElement>('.kb-lens-body')!;
    let still = 0;
    let last = '';
    const frame = () => {
      const now = `${body.scrollHeight}/${body.clientHeight}`;
      still = now === last ? still + 1 : 0;
      last = now;
      if (still >= 30) done(); else requestAnimationFrame(frame);
    };
    frame();
  }));
}

/** Scrolls whatever the Lens scrolls to its end: the first of the panel and its descendants that holds more than it shows. */
async function scrollToEnd(page: Page) {
  return page.evaluate(() => {
    const lens = document.querySelector<HTMLElement>('.kb-lens')!;
    const scroller = [lens, ...lens.querySelectorAll<HTMLElement>('*')].find((el) => {
      const overflow = getComputedStyle(el).overflowY;
      return (overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight + 1;
    });
    if (!scroller) return { scrolled: false, more: lens.getAttribute('data-kb-more') };
    scroller.scrollTop = scroller.scrollHeight;
    return { scrolled: true, more: lens.getAttribute('data-kb-more') };
  });
}

/** The Lens's last control as it stands now: its name, and every way it is cut (outside the panel, under the HUD, or not what a pointer finds at its middle). */
async function lastControl(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.kb-lens')!.getBoundingClientRect();
    const hud = document.querySelector('.kb-hud')!.getBoundingClientRect();
    const controls = [...document.querySelectorAll<HTMLElement>('.kb-lens button, .kb-lens a[href]')].filter((el) => el.getBoundingClientRect().height > 0);
    const last = controls[controls.length - 1]!;
    const box = last.getBoundingClientRect();
    const found = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    const cut: string[] = [];
    if (box.top < panel.top || box.bottom > panel.bottom || box.left < panel.left || box.right > panel.right) cut.push('outside the panel');
    if (box.bottom > hud.top) cut.push('under the HUD');
    if (!(found !== null && (found === last || last.contains(found)))) cut.push('not what a pointer finds');
    return { name: last.textContent?.trim() ?? '', cut };
  });
}

for (const { label, width, height, place } of VIEWPORTS) {
  test.describe(`the Lens's frame at ${label}`, () => {
    test.use({ viewport: { width, height } });

    test('scrolled to its end, its last control lies inside the panel and above the HUD, and is what a pointer finds there', async ({ page }) => {
      const lens = await openLens(page);
      await bodySettled(page);
      const scrolled = await scrollToEnd(page);
      expect(scrolled.scrolled, 'the Lens holds more than it shows, so something in it scrolls').toBe(true);
      /* The panel places itself again as the body scrolls; the control is read until it is where it will stay. */
      await expect.poll(async () => (await lastControl(page)).cut, { message: 'nothing of the last control is cut' }).toEqual([]);
      expect((await lastControl(page)).name, 'the last control is the last play\'s Go to post').toBe('Go to post');
      await expect(lens).toBeVisible();
    });

    /* The check's own poison: the panel's height and the body's scrolling taken away, the last control runs under the HUD and the check must say it is cut. */
    test('poisoned (the panel unbounded, the body not scrolling), the same check reports the last control cut', async ({ page }) => {
      await openLens(page);
      /* Through the style object, which the page's policy allows (a style tag it does not). */
      await page.evaluate(() => {
        const box = document.querySelector<HTMLElement>('.kb-float-box.kb-lens')!;
        box.style.setProperty('height', 'auto', 'important');
        box.style.setProperty('max-height', 'none', 'important');
        const body = box.querySelector<HTMLElement>('.kb-lens-body')!;
        body.style.setProperty('overflow', 'visible', 'important');
        body.style.setProperty('flex', 'none', 'important');
      });
      await scrollToEnd(page);
      await expect.poll(async () => (await lastControl(page)).cut.length, { message: 'the poisoned Lens is reported cut' }).toBeGreaterThan(0);
    });

    test(`stands as ${place === 'dock' ? 'a dock at the right, 16px from the top and 16px above the HUD' : 'a sheet that ends on the HUD\'s top edge'}`, async ({ page }) => {
      const lens = await openLens(page);
      await expect(lens).toHaveAttribute('data-kb-lens', place);
      const read = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>('.kb-lens')!.getBoundingClientRect();
        const hud = document.querySelector('.kb-hud')!.getBoundingClientRect();
        return { top: panel.top, bottom: panel.bottom, left: panel.left, right: panel.right, width: panel.width, hudTop: hud.top, window: document.documentElement.clientWidth };
      });
      if (place === 'dock') {
        expect(read.top).toBeCloseTo(16, 0);
        expect(read.bottom).toBeCloseTo(read.hudTop - 16, 0);
        expect(read.right).toBeCloseTo(read.window - 16, 0);
        expect(read.width).toBeGreaterThanOrEqual(360);
        expect(read.width).toBeLessThanOrEqual(460);
        if (width === 1440) expect(read.width).toBeCloseTo(460, 0);
      } else {
        expect(read.bottom).toBeCloseTo(read.hudTop, 0);
        expect(read.left).toBeCloseTo(0, 0);
        expect(read.right).toBeCloseTo(read.window, 0);
        expect(read.top, 'a sheet leaves the page above it').toBeGreaterThan(100);
      }
    });

    /* Placing the panel again (the page scrolled, the window resized) measures it unbounded for a moment, which must not send its body back to the top. */
    test('the page scrolling under it leaves where its body is scrolled to', async ({ page }) => {
      await openLens(page);
      await page.evaluate(() => { document.querySelector<HTMLElement>('.kb-lens-body')!.scrollTop = 200; });
      /* The page's scroll is placed again a frame later (Float's rAF): two frames after each scroll it has been. */
      const frames = () => page.evaluate(() => new Promise<void>((done) => { requestAnimationFrame(() => requestAnimationFrame(() => done())); }));
      await frames();
      await page.evaluate(() => window.scrollBy(0, 7));
      await frames();
      await page.evaluate(() => window.scrollBy(0, -7));
      await frames();
      await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>('.kb-lens-body')!.scrollTop), { message: 'the body is where the reader left it' }).toBeGreaterThan(150);
    });

    /* A row's actions are the grid's cells (the reactions' own box takes none), so the picker stands by the React button it was opened from. */
    test('React in a play\'s row opens its picker by the button, in the window', async ({ page }) => {
      const lens = await openLens(page);
      const button = lens.getByRole('button', { name: 'React' }).first();
      await button.scrollIntoViewIfNeeded();
      await button.click();
      const picker = page.getByRole('dialog', { name: /^React to / });
      await expect(picker).toBeVisible();
      const [p, b] = await Promise.all([picker.boundingBox(), button.boundingBox()]);
      expect(p!.x).toBeGreaterThanOrEqual(0);
      expect(p!.y).toBeGreaterThanOrEqual(0);
      expect(p!.x + p!.width).toBeLessThanOrEqual(width + 1);
      /* Beside the button, not at the window's corner: it overlaps the button's row or stands within a button's height of it. */
      const near = p!.y <= b!.y + b!.height + 300 && p!.y + p!.height >= b!.y - 300;
      expect(near, `the picker (${Math.round(p!.y)}) is by the button (${Math.round(b!.y)})`).toBe(true);
    });

    test('the fade at its foot is there while more lies below, and gone when the end is reached', async ({ page }) => {
      const lens = await openLens(page);
      await expect(lens).toHaveAttribute('data-kb-more', 'true');
      const fade = lens.locator('.kb-lens-fade');
      await expect(fade).toBeVisible();
      /* The body's size is settled first, so the end scrolled to is the end it will keep. */
      await bodySettled(page);
      await scrollToEnd(page);
      await expect(lens).toHaveAttribute('data-kb-more', 'false');
      await expect(fade).toBeHidden();
    });
  });
}
