import { expect, test, type Page } from '@playwright/test';
import { loadFaces } from './fonts.ts';
import { standInFaces } from './board-snapshot.ts';

/**
 * The mobile postbit (docs/plans/2026-11-14-mobile-postbit-design.md, section 2): on a phone the avatar slot is the whole portrait, 3.6em wide
 * (54px at the 15px body), in the shape the portrait was cut, at most twice as tall as wide and no taller than the right column of a postbit
 * with all four rows; the rank stands under the name, then the title, then the group bar. A reader who chose "stacked" gets the same on a phone,
 * and on a wide screen the stacked band's avatar is still the 3.2em square.
 */
test.use({ reducedMotion: 'reduce', bypassCSP: true, viewport: { width: 390, height: 844 } });

const STORY = '/?fixture=boards&story=boards-01-postbit-gear--gear-and-trophies';

async function open(page: Page) {
  await standInFaces(page.context());
  await page.goto(STORY);
  await expect(page.locator('.kb-postbit').first()).toBeVisible();
  await loadFaces(page);
  /* The pictures load lazily: bring each into view and wait for it, so the boxes below are measured at each picture's own shape (a picture that never loads fails here). */
  const pics = page.locator('.kb-postbit-avatar img');
  for (let i = 0, n = await pics.count(); i < n; i++) {
    const pic = pics.nth(i);
    await pic.scrollIntoViewIfNeeded();
    await expect.poll(() => pic.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0), { message: `avatar picture ${i} loads once in view`, timeout: 10000 }).toBe(true);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/**
 * Each postbit the story draws, in order: the thread's posts (the reader's side-by-side), then the story's band, which asks for the stacked layout
 * as a stacked reader's posts do. A phone draws the same side markup for both, so the three rules hold for the band as for the posts.
 */
const measure = (page: Page) => page.evaluate(() => [...document.querySelectorAll('.kb-postbit')].map((bit) => {
  const r = (s: string) => bit.querySelector(s)?.getBoundingClientRect();
  const img = bit.querySelector('.kb-postbit-avatar img') as HTMLImageElement | null;
  const slot = r('.kb-postbit-avatar')!;
  const pic = img!.getBoundingClientRect();
  return {
    kind: bit.getAttribute('data-kb-postbit'),
    font: parseFloat(getComputedStyle(bit).fontSize),
    slot: { w: slot.width, h: slot.height }, pic: { w: pic.width, h: pic.height }, natural: { w: img!.naturalWidth, h: img!.naturalHeight },
    column: r('.kb-postbit-text')!.height,
    rows: { rank: r('.kb-postbit-rank')?.top ?? null, title: r('.kb-postbit-title')?.top ?? null, group: r('.kb-postbit-group')?.top ?? null },
  };
}));

for (const [which, from] of [['side reader\'s posts', 0], ['stacked layout\'s band', -1]] as const) {
  test(`a phone's avatar is the whole portrait and the rank stands above the group, for a ${which}`, async ({ page }) => {
    await open(page);
    const all = await measure(page);
    expect(all.length).toBeGreaterThanOrEqual(3);
    const posts = from === 0 ? all.slice(0, -1) : all.slice(-1);
    let full = 0;
    for (const p of posts) {
      expect(p.kind, 'the side markup on a phone').toBe('side');
      /* (a) 3.6em wide. */
      expect(Math.abs(p.slot.w - 3.6 * p.font), 'slot is 3.6em wide').toBeLessThanOrEqual(0.5);
      expect(p.font).toBeCloseTo(15, 0);
      /* (b) The picture is the portrait's own shape, so the whole crop shows. */
      expect(Math.abs(p.pic.h / p.pic.w - p.natural.h / p.natural.w), 'picture keeps the portrait shape').toBeLessThanOrEqual(0.02);
      expect(Math.abs(p.slot.w - p.pic.w) + Math.abs(p.slot.h - p.pic.h), 'slot and picture boxes agree').toBeLessThanOrEqual(1.5);
      /* (c) At most twice as tall as wide. */
      expect(p.slot.h).toBeLessThanOrEqual(2 * p.slot.w + 0.5);
      /* (d) Name, rank, title, group in order. */
      if (p.rows.title !== null && p.rows.group !== null) {
        full++;
        expect(p.slot.h, 'no taller than the column of the four-row postbit').toBeLessThanOrEqual(p.column + 1);
      }
      expect(p.rows.rank, 'a rank').not.toBeNull();
      if (p.rows.title !== null) expect(p.rows.rank!).toBeLessThan(p.rows.title);
      if (p.rows.title !== null && p.rows.group !== null) expect(p.rows.title).toBeLessThan(p.rows.group);
      else if (p.rows.group !== null) expect(p.rows.rank!).toBeLessThan(p.rows.group);
    }
    expect(full, 'a post whose postbit has all four rows').toBeGreaterThan(0);
  });
}

test('at 1280 the stacked band\'s avatar is still the 3.2em square', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  const band = await page.evaluate(() => {
    const bit = document.querySelector('.kb-postbit[data-kb-postbit="stacked"]')!;
    const slot = bit.querySelector('.kb-postbit-avatar')!.getBoundingClientRect();
    return { w: slot.width, h: slot.height, font: parseFloat(getComputedStyle(bit).fontSize) };
  });
  expect(Math.abs(band.w - 3.2 * band.font)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(band.h - band.w)).toBeLessThanOrEqual(0.5);
});
