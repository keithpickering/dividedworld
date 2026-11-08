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
