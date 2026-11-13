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

/*
 * E2 at frame grain: the rise is sampled after every paint from the click on Buy (a timeout queued in a frame runs once that frame is drawn), so a pose that lasts
 * one frame is seen. The pack is drawn when the layer and its body are both above zero opacity; the dim fades in on the same frames as the rise, so the first frame
 * drawn is already a step into it, and how far depends on the machine's frame rate. Every frame drawn before the tear stands between the slot and the middle, give
 * or take the landing's overshoot (Snappy's spring passes the middle by about 8px); the parked place the bug started from is about 300px above the slot.
 * A start pose put on the pack by an instant `animate` lands on Motion's next frame, after the rise has already read where the pack stood (parked, past the
 * top edge): the pack came down from above the window, and its slot's pose flashed for a frame or never showed.
 */
/** How far past the way from the slot to the middle a frame may stand, px: the landing's overshoot, with room. */
const OVERSHOOT = 24;
type Drawn = { x: number; y: number; seen: boolean; torn: boolean; cards: number };
for (const feel of ['smooth', 'snappy'] as const) {
  test(`${feel}: the pack rises from its slot to the middle, and no card is drawn before its top tears`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.goto('/?fixture=boards&story=boards-booster-packs--machine');
    await page.evaluate((name) => { document.documentElement.setAttribute('data-kb-motion', 'full'); document.documentElement.setAttribute('data-kb-motion-feel', name); }, feel);
    const slot = page.getByRole('button', { name: /^Buy Booster, 3\.00 orbs/ });
    await slot.click();
    const s = (await slot.boundingBox())!;
    await page.evaluate(() => {
      const frames: Drawn[] = [];
      (window as unknown as { kbFrames: Drawn[] }).kbFrames = frames;
      const opacity = (el: Element) => Number(getComputedStyle(el).opacity);
      const sample = () => {
        const layer = document.querySelector('.kb-opening-layer');
        const pack = document.querySelector('.kb-opening-pack');
        const packIn = document.querySelector('.kb-opening-pack-in');
        const top = document.querySelector('.kb-opening-pack-top');
        if (layer && pack && packIn && top) {
          const r = pack.getBoundingClientRect();
          const moved = getComputedStyle(top).transform;
          frames.push({
            x: r.x + r.width / 2, y: r.y + r.height / 2, seen: opacity(layer) > 0 && opacity(packIn) > 0, torn: moved !== 'none' && moved !== 'matrix(1, 0, 0, 1, 0, 0)',
            cards: Math.max(0, ...Array.from(document.querySelectorAll('.kb-opening-cardbox'), opacity)),
          });
        }
        if (frames.length < 120) requestAnimationFrame(() => setTimeout(sample, 0));
      };
      requestAnimationFrame(() => setTimeout(sample, 0));
    });
    await page.getByRole('button', { name: 'Buy Booster · 3.00' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { kbFrames: Drawn[] }).kbFrames.length), { timeout: 10_000 }).toBeGreaterThanOrEqual(120);
    const frames = await page.evaluate(() => (window as unknown as { kbFrames: Drawn[] }).kbFrames);
    const tear = frames.findIndex((f) => f.torn);
    expect(tear, 'a frame with the top torn').toBeGreaterThan(0);
    const rising = frames.slice(0, tear).filter((f) => f.seen);
    expect(rising.length, 'frames drawn before the tear').toBeGreaterThan(1);
    const from = { x: s.x + s.width / 2, y: s.y + s.height / 2 };
    const to = rising[rising.length - 1]!;
    const between = (v: number, a: number, b: number) => v >= Math.min(a, b) - OVERSHOOT && v <= Math.max(a, b) + OVERSHOOT;
    expect(rising.filter((f) => !between(f.x, from.x, to.x) || !between(f.y, from.y, to.y)), 'frames drawn outside the way from the slot to the middle').toEqual([]);
    expect(frames.slice(0, tear).filter((f) => f.cards > 0), 'frames before the tear with a card drawn').toEqual([]);
  });
}

/*
 * E3 at frame grain, on the 1440 and on a phone: on the first frame the five are drawn (the top tearing), each back stands inside the pack's body, so the pack
 * hides them until they rise out of it. A card in the row is drawn at the fan's size inside a box that was the sheet's (the flip was 276 by 414 whatever the
 * card's size), and the entrance centers the box in the pack: the back stood up and to the left of the pack's middle and showed past its top left corner.
 */
for (const [layout, viewport] of [['1440', { width: 1440, height: 1080 }], ['phone', { width: 360, height: 700 }]] as const) {
  test(`${layout}: when the top tears, every card's back stands inside the pack`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/?fixture=boards&story=boards-booster-packs--machine');
    await page.evaluate(() => { document.documentElement.setAttribute('data-kb-motion', 'full'); document.documentElement.setAttribute('data-kb-motion-feel', 'smooth'); });
    await page.getByRole('button', { name: /^Buy Booster, 3\.00 orbs/ }).click();
    const buy = page.getByRole('button', { name: 'Buy Booster · 3.00' });
    await buy.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      type Box = { left: number; top: number; right: number; bottom: number };
      const at = (r: DOMRect): Box => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      const w = window as unknown as { kbTear?: { pack: Box; backs: Box[] } };
      const sample = () => {
        const pack = document.querySelector('.kb-opening-pack');
        const boxes = Array.from(document.querySelectorAll<HTMLElement>('.kb-opening-row .kb-opening-cardbox'));
        if (pack && boxes.length > 0 && boxes.some((b) => Number(getComputedStyle(b).opacity) > 0)) {
          w.kbTear = { pack: at(pack.getBoundingClientRect()), backs: boxes.map((b) => at(b.querySelector('.kb-opening-side')!.firstElementChild!.getBoundingClientRect())) };
          return;
        }
        requestAnimationFrame(() => setTimeout(sample, 0));
      };
      requestAnimationFrame(() => setTimeout(sample, 0));
    });
    await buy.click();
    await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { kbTear?: unknown }).kbTear)), { timeout: 10_000 }).toBe(true);
    const { pack, backs } = await page.evaluate(() => (window as unknown as { kbTear: { pack: { left: number; top: number; right: number; bottom: number }; backs: { left: number; top: number; right: number; bottom: number }[] } }).kbTear);
    const outside = backs.filter((b) => b.left < pack.left - 1 || b.top < pack.top - 1 || b.right > pack.right + 1 || b.bottom > pack.bottom + 1);
    expect(outside, `backs past the pack (${JSON.stringify(pack)}) on the frame the five are first drawn`).toEqual([]);
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
    /* The glint stops moving when it stands where the pointer is: poll until it does, so a frame from before the move cannot pass for the settled one. */
    await expect.poll(async () => Math.abs((await lightOf(page)).glintX - share), { message: `the glint's distance from a pointer ${share} across the pack`, timeout: 5000 }).toBeLessThan(GLINT_NEAR);
    return (await lightOf(page)).glintX;
  };
  const at25 = await glintAt(0.25);
  await glintAt(0.75);
  await expect.poll(async () => (await lightOf(page)).glintX - at25, { message: 'the glint at 75% across the pack, right of where it was at 25%', timeout: 5000 }).toBeGreaterThan(GLINT_MOVED);
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
