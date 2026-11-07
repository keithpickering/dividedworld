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
