import { expect, test, type Page } from '@playwright/test';
import { focusedIndicator } from './focus.ts';

/**
 * The booster pack's reveal at full motion, in the browser (booster packs plan, Task 10; the design's amendment "The reveal's motion"): the reveal is a modal
 * like the glass's others, so its exit is inert from the first frame and focus is back on the slot at once, however far the picture has got. The machine is the
 * board story of the packs (engine/ui/vending/Packs.board.stories.tsx), the root marked for Smooth the way Settings marks it.
 */
test.use({ bypassCSP: true, reducedMotion: 'no-preference' });

async function buyTheBooster(page: Page, feel: 'smooth' | 'snappy') {
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto('/?fixture=boards&story=boards-booster-packs--machine');
  await page.evaluate((name) => { document.documentElement.setAttribute('data-kb-motion', 'full'); document.documentElement.setAttribute('data-kb-motion-feel', name); }, feel);
  const slot = page.getByRole('button', { name: /^Buy Booster, 3\.00 orbs/ });
  await slot.click();
  await page.getByRole('button', { name: 'Buy Booster · 3.00' }).click();
  await expect(page.getByRole('dialog', { name: 'Opening a Booster' })).toBeVisible();
  return slot;
}

for (const feel of ['smooth', 'snappy'] as const) {
  test(`${feel}: buying a pack and pressing Esc at once returns focus to the slot, with the reveal inert while its picture plays`, async ({ page }) => {
    const slot = await buyTheBooster(page, feel);
    await page.keyboard.press('Escape');
    await expect(slot).toBeFocused();
    expect((await focusedIndicator(page))?.visible).toBe(true);
    /* The reveal is still on the screen, playing its exit, and nothing in it answers: it is inert from its first frame. */
    const layer = page.locator('.kb-opening-layer');
    if (await layer.count()) {
      await expect(layer).toHaveAttribute('inert', '');
      await expect(layer).toHaveAttribute('data-kb-exiting', 'true');
    }
    await expect(layer).toHaveCount(0, { timeout: 5000 });
    await expect(slot).toBeFocused();
  });
}

test('a Space in the middle of the entrance finishes it and turns the first card; Done in the middle of the turn leaves at once', async ({ page }) => {
  const slot = await buyTheBooster(page, 'smooth');
  await page.keyboard.press('Space');
  await expect(page.locator('.kb-opening-count')).toHaveText(/1 of 5 turned over/iu);
  await expect(page.locator('.kb-opening')).toHaveAttribute('data-kb-stage', 'ready');
  await page.getByRole('button', { name: 'Turn all' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(slot).toBeFocused();
  await expect(page.locator('.kb-opening-layer')).toHaveCount(0, { timeout: 5000 });
});

test('on a phone, full motion: each tap or swipe on the pile turns exactly one card, through all five', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?fixture=boards&story=boards-booster-packs--machine');
  await page.evaluate(() => { document.documentElement.setAttribute('data-kb-motion', 'full'); document.documentElement.setAttribute('data-kb-motion-feel', 'smooth'); });
  await expect(page.locator('html')).toHaveAttribute('data-kb-layout', 'phone');
  await page.getByRole('button', { name: /^Buy Booster, 3\.00 orbs/ }).click();
  await page.getByRole('button', { name: 'Buy Booster · 3.00' }).click();
  await expect(page.locator('.kb-opening')).toHaveAttribute('data-kb-stage', 'ready', { timeout: 6000 });
  const count = page.locator('.kb-opening-count');
  const pile = page.locator('.kb-opening-spot');
  /* A finger across the pile on the card on top: down, a drag past a third of the card's width, up. */
  const swipe = async () => {
    const box = (await pile.boundingBox())!;
    const y = box.y + box.height / 2;
    const x = box.x + box.width * 0.8;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - box.width * 0.2, y, { steps: 4 });
    await page.mouse.move(x - box.width * 0.5, y, { steps: 4 });
    await page.mouse.up();
  };
  const tap = async () => {
    const box = (await pile.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  /* The first card by a tap on its button, the second by a swipe, then taps and swipes on whatever card is on top of the pile. */
  const gestures = [tap, swipe, tap, swipe, tap];
  for (const [n, gesture] of gestures.entries()) {
    await gesture();
    await expect(count).toHaveText(n === 4 ? /5 of 5/iu : new RegExp(`${n + 1} of 5 turned over`, 'iu'));
    /* One card per gesture: the count does not go on past it once the beat has played. */
    await page.waitForTimeout(700);
    await expect(count).toHaveText(n === 4 ? /5 of 5/iu : new RegExp(`${n + 1} of 5 turned over`, 'iu'));
  }
  await expect(page.locator('.kb-opening-tag')).toBeVisible();
});

/** The pixels of the slot's pack light, as a string a spec can compare, and how many of them are not transparent. */
async function lightOf(page: Page) {
  return page.locator('.kb-pack[data-kb-pictured] .kb-pack-light').first().evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d')!;
    const d = c.width > 0 && c.height > 0 ? ctx.getImageData(0, 0, c.width, c.height).data : new Uint8ClampedArray(0);
    let lit = 0;
    let sum = 0;
    let weight = 0;
    let weightedX = 0;
    let glint = 0;
    let glintX = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3]! > 0) lit++; weight += d[i + 3]!; weightedX += d[i + 3]! * (((i / 4) % c.width) + 0.5); if (d[i + 3]! > 128) { glint++; glintX += ((i / 4) % c.width) + 0.5; } sum = (sum * 31 + d[i]! + d[i + 1]! * 3 + d[i + 2]! * 7 + d[i + 3]! * 11) % 2147483647; }
    /* The alpha-weighted centroid's x as a fraction of the bitmap's width (0.5 when nothing is lit), and the same for only the pixels with alpha above 128, the tight glint. */
    return { width: c.width, lit, sum, centroidX: weight > 0 ? weightedX / weight / c.width : 0.5, glint, glintX: glint > 0 ? glintX / glint / c.width : 0.5 };
  });
}

/** How far right, as a fraction of the bitmap's width, the light's centroid must move. */
const MOVED = 0.15;
/** How near, as a fraction of the pack's width, the tight glint's centroid must stand to the pointer's share across the pack (measured within 0.15; the pillow's edges lean it toward the middle). */
const GLINT_NEAR = 0.2;
/** How far right the glint must move between the pointer at 25% and at 75% across the pack (measured 0.39, 0.49 and 0.66 at 25%, 50% and 75%, so about 0.27: the pillow's edges lean the glint toward the middle). */
const GLINT_MOVED = 0.2;

async function theSlotsPack(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto('/?fixture=boards&story=boards-booster-packs--machine');
  const pack = page.locator('.kb-pack[data-kb-pictured]').first();
  await expect(pack).toBeVisible();
  await expect.poll(() => pack.locator('img.kb-pack-picture').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1080);
  return pack;
}

test('the Booster in the slot is a picture with a light: after a pointer move its canvas holds lit pixels, and the light follows the pointer', async ({ page }) => {
  const pack = await theSlotsPack(page);
  const box = (await pack.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3, { steps: 4 });
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 4 });
  await expect.poll(async () => (await lightOf(page)).lit, { timeout: 5000 }).toBeGreaterThan(0);
  /* The loop takes the pointer across the whole viewport: far upper left, then far lower right, and the light's centroid moves right (about 0.4 of the bitmap measured; idle drift alone moves it by about 0.05). */
  await page.mouse.move(2, 2, { steps: 6 });
  await expect.poll(async () => (await lightOf(page)).lit, { timeout: 5000 }).toBeGreaterThan(0);
  const left = (await lightOf(page)).centroidX;
  await page.mouse.move(1438, 1078, { steps: 6 });
  await expect.poll(async () => (await lightOf(page)).centroidX, { timeout: 5000 }).toBeGreaterThan(left + MOVED);
  /* A pack is lit from near: with the pointer on the pack, the tight glint stands at the pointer (alpha above 128; its centroid's share of the bitmap's width is the pointer's share of the pack). */
  const glintAt = async (share: number) => {
    await page.mouse.move(box.x + box.width * share, box.y + box.height / 2, { steps: 6 });
    await expect.poll(async () => (await lightOf(page)).glint, { timeout: 5000 }).toBeGreaterThan(0);
    await page.waitForTimeout(700); // the light's ease (110 ms) and the redraw have settled
    const at = (await lightOf(page)).glintX;
    expect(Math.abs(at - share), `the glint at ${at.toFixed(3)} for a pointer ${share} across the pack`).toBeLessThan(GLINT_NEAR);
    return at;
  };
  const at25 = await glintAt(0.25);
  await glintAt(0.5);
  const at75 = await glintAt(0.75);
  expect(at75 - at25).toBeGreaterThan(GLINT_MOVED);
});

test.describe('with motion reduced', () => {
  test.use({ reducedMotion: 'reduce' });
  test('the light does not follow the pointer: the canvas holds the same pixels before and after a move', async ({ page }) => {
    const pack = await theSlotsPack(page);
    const box = (await pack.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3, { steps: 4 });
    /* The still light is drawn (not an empty canvas that would equal itself): a reduced-motion pack is lit, only not by the pointer. */
    await expect.poll(async () => (await lightOf(page)).lit, { timeout: 5000 }).toBeGreaterThan(0);
    const before = await lightOf(page);
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8, { steps: 6 });
    await page.waitForTimeout(600);
    expect(await lightOf(page)).toEqual(before);
  });
});
