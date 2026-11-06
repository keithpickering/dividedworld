/**
 * The Lens leaves its post whole (the owner, 2026-11-06, on the critique of board 28: "Dock, but move the post"). Docked at the right of a wide
 * window or a sheet at a tablet's or a phone's, the Lens never lies over the post it is open on: the thread's column ends where the dock begins
 * (frame.css), a takeover's view does the same and ends above a sheet (stick-around/hold.css), and Float.tsx says the room it takes on the root
 * element. Measured in a browser, at 1920, 1440, 834 and 390, with the Lens open on
 *   - a Whoops! post (`Boards/01 Lens` > `Lens Whoops Who`, #41): the post's box, its words and its ink lie clear of the Lens's box; and
 *   - a Stick Around post that holds the reader (the Hold board's moment, `08-hold`): the post's visible box and Break free lie clear of it,
 *     and Break free is what a pointer finds at its center.
 */
import { expect, test, type Page } from '@playwright/test';

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 1000 },
  { width: 834, height: 1112 },
  { width: 390, height: 844 },
] as const;

type Box = readonly [left: number, top: number, right: number, bottom: number];

/** How much two boxes overlap, in px squared: none is 0. */
const overlap = (a: Box, b: Box): number => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

/** The boxes of the Lens and of whatever `pick` names, read in the page (each box clipped to `clip` when one is given: a post longer than its scroller shows only what the scroller does). */
async function boxes(page: Page, names: Record<string, { selector: string; clip?: string; text?: string }>): Promise<Record<string, Box | null>> {
  return page.evaluate((wanted) => {
    const rect = (el: Element | null | undefined, clip?: Element | null): Box | null => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return null;
      let out: Box = [b.left, b.top, b.right, b.bottom];
      if (clip) { const c = clip.getBoundingClientRect(); out = [Math.max(out[0], c.left), Math.max(out[1], c.top), Math.min(out[2], c.right), Math.min(out[3], c.bottom)]; }
      return out;
    };
    const out: Record<string, Box | null> = { lens: rect(document.querySelector('.kb-lens')) };
    for (const [name, { selector, clip, text }] of Object.entries(wanted)) {
      const el = [...document.querySelectorAll(selector)].find((e) => text === undefined || e.textContent === text);
      out[name] = rect(el, clip ? document.querySelector(clip) : null);
    }
    return out;
  }, names);
}

/** Waits until the page and the Lens stand still: the same boxes on two reads a couple of frames apart (the page narrows, and the Lens places itself again a frame later). */
async function settled(page: Page, names: Record<string, { selector: string; clip?: string; text?: string }>): Promise<void> {
  await expect.poll(async () => {
    const before = JSON.stringify(await boxes(page, names));
    await page.evaluate(() => new Promise<void>((done) => { requestAnimationFrame(() => requestAnimationFrame(() => done())); }));
    return before === JSON.stringify(await boxes(page, names));
  }, { message: 'the page and the Lens stand still' }).toBe(true);
}

for (const { width, height } of VIEWPORTS) {
  test.describe(`the Lens beside its post at ${width}`, () => {
    test.use({ viewport: { width, height }, reducedMotion: 'reduce' });

    test('on a Whoops! post, the post, its words and its ink lie clear of the Lens', async ({ page }) => {
      await page.goto('/?fixture=boards&story=boards-01-lens--lens-whoops-who');
      const lens = page.getByRole('dialog', { name: 'Cards on this post' });
      await expect(lens).toBeVisible({ timeout: 15_000 });
      await expect(lens).toHaveAttribute('data-kb-lens', width <= 1024 ? 'sheet' : 'dock');
      const names = {
        post: { selector: '#post-41' },
        words: { selector: '#post-41 .kb-act-main' },
        ink: { selector: '#post-41 canvas' },
      };
      /* The page narrows and the Lens places itself again a frame later: wait for both to settle. */
      await expect(page.locator('html')).toHaveAttribute('data-kb-float', width <= 1024 ? 'sheet' : 'dock');
      await settled(page, names);
      if (width <= 1024) {
        /* A sheet lies over the page's foot: the post begins above it as it opens, and the page ends above it, so the post can be scrolled clear. */
        const opened = await boxes(page, names);
        expect(opened.words![1], 'the post\'s words begin above the sheet').toBeLessThan(opened.lens![1]);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await settled(page, names);
      }
      const read = await boxes(page, names);
      expect(read.lens, 'the Lens is on the page').not.toBeNull();
      for (const part of ['post', 'words'] as const) {
        expect(read[part], `${part} is on the page`).not.toBeNull();
        expect(overlap(read[part]!, read.lens!), `the post's ${part} ${JSON.stringify(read[part])} lie clear of the Lens ${JSON.stringify(read.lens)}`).toBe(0);
      }
      if (read.ink) expect(overlap(read.ink, read.lens!), 'the ink lies clear of the Lens').toBe(0);
      /* Whole beside the dock: inside the window, ending where the dock begins. */
      if (width > 1024) {
        expect(read.post![0]).toBeGreaterThanOrEqual(0);
        expect(read.post![2]).toBeLessThanOrEqual(read.lens![0]);
      }
    });

    test('on a Stick Around post that holds the reader, the post and Break free lie clear of the Lens, and Break free is what a pointer finds', async ({ page }) => {
      await page.goto('/?fixture=boards&moment=08-hold');
      await page.evaluate(() => document.fonts.ready);
      const view = page.getByRole('dialog', { name: 'Stick Around' });
      await expect(view).toBeVisible({ timeout: 10_000 });
      await view.getByRole('button', { name: /^Stick Around, 1 play/u }).click();
      const lens = page.getByRole('dialog', { name: 'Cards on this post' });
      await expect(lens).toBeVisible();
      await expect(lens).toHaveAttribute('data-kb-lens', width <= 1024 ? 'sheet' : 'dock');
      const names = {
        post: { selector: '.kb-hold-post', clip: '.kb-hold-scroll' },
        words: { selector: '.kb-hold-post-body', clip: '.kb-hold-scroll' },
        breakFree: { selector: '[role="dialog"][aria-label="Stick Around"] button', text: 'Break free' },
      };
      await expect(page.locator('html')).toHaveAttribute('data-kb-float', width <= 1024 ? 'sheet' : 'dock');
      await settled(page, names);
      const read = await boxes(page, names);
      expect(read.lens, 'the Lens is on the page').not.toBeNull();
      for (const part of ['post', 'words', 'breakFree'] as const) {
        expect(read[part], `${part} is on the page`).not.toBeNull();
        expect(overlap(read[part]!, read.lens!), `${part} ${JSON.stringify(read[part])} lies clear of the Lens ${JSON.stringify(read.lens)}`).toBe(0);
      }
      const found = await page.evaluate(() => {
        const button = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Stick Around"] button')].find((b) => b.textContent === 'Break free')!;
        const b = button.getBoundingClientRect();
        const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return at === button || button.contains(at) ? 'Break free' : `${at?.tagName.toLowerCase()}.${at?.className}`;
      });
      expect(found, 'a pointer at the center of Break free finds it').toBe('Break free');
    });
  });
}
