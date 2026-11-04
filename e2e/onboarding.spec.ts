import { expect, test, type Page } from '@playwright/test';
import { focusedIndicator } from './focus.ts';
import { finishWelcome, flipSession, signInUnseasoned, signInUnseasonedOnBoard, TOUR_TITLES, walkTour } from './onboarding.ts';

/**
 * The unseasoned path: a new account's welcome, the HUD tour's spotlight walked as a player walks it (real clicks, the keyboard),
 * skipped, replayed from Settings. A page reload cannot be the memory check against the fake: it forgets its world on a reload and
 * signs in the seasoned demo player, who has no tip to show. So "it stays skipped" is read by flipping the session (signed out and in
 * again, e2e/onboarding.ts's flipSession), which makes the page read the account's preferences afresh, and by Settings' Tips switch.
 */
const SIZES = [{ width: 1440, height: 900 }, { width: 390, height: 844 }] as const;
const tip = (page: Page, title: string) => page.getByRole('dialog', { name: title });
/** After a session flip: Settings' Tips switch reads off, and back on the board, once its HUD is there, no tip is open. */
async function expectSkippedAfterFlip(page: Page): Promise<void> {
  await flipSession(page, page.getByRole('region', { name: 'Game HUD' }));
  await page.getByRole('region', { name: 'Game HUD' }).getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('navigation', { name: 'Menu' }).getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('switch', { name: 'Tips' })).not.toBeChecked();
  await page.getByRole('navigation', { name: 'Menu' }).getByRole('link', { name: 'Back to the board' }).click();
  await expect(page.getByRole('region', { name: 'Game HUD' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
const inside = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));

for (const size of SIZES) {
  test.describe(`${size.width}x${size.height}`, () => {
    test.use({ viewport: size });

    test('a new account is sent to the welcome, and finishing it returns to the board', async ({ page }) => {
      await signInUnseasoned(page);
      expect(new URL(page.url()).pathname).toBe('/welcome');
      await finishWelcome(page);
      expect(new URL(page.url()).pathname).toBe('/');
    });

    test('the first step is a dialog with focus inside; Got it walks every step "n of N"; the last closes the tour', async ({ page }) => {
      await signInUnseasonedOnBoard(page);
      expect(await inside(page)).toBe(true);
      await walkTour(page);
    });

    test('Escape skips the rest, and the account stays skipped (Tips reads off) after the session is read again', async ({ page }) => {
      await signInUnseasonedOnBoard(page);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      /* Nothing to wait for but an absence, so a later step is given a moment to wrongly appear. */
      await page.waitForTimeout(500);
      for (const later of TOUR_TITLES.slice(1)) await expect(tip(page, later)).toHaveCount(0);
      await expectSkippedAfterFlip(page);
    });

    test('Skip all tips closes the tour, and Tips reads off after the session is read again', async ({ page }) => {
      await signInUnseasonedOnBoard(page);
      await tip(page, TOUR_TITLES[0]).getByRole('button', { name: 'Skip all tips' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expectSkippedAfterFlip(page);
    });

    test('Replay the HUD tour in Settings brings the first step back, and every step is reached again', async ({ page }) => {
      await signInUnseasonedOnBoard(page);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByRole('region', { name: 'Game HUD' }).getByRole('button', { name: 'Menu' }).click();
      await page.getByRole('navigation', { name: 'Menu' }).getByRole('link', { name: 'Settings' }).click();
      await page.getByRole('button', { name: 'Replay the HUD tour' }).click();
      await page.getByRole('navigation', { name: 'Menu' }).getByRole('link', { name: 'Back to the board' }).click();
      await walkTour(page);
    });

    test('keyboard: Tab stays inside the dialog, and Enter on Got it advances', async ({ page }) => {
      await signInUnseasonedOnBoard(page);
      for (let i = 0; i < 6; i += 1) {
        await page.keyboard.press('Tab');
        expect(await inside(page), `Tab press ${i + 1} left the dialog`).toBe(true);
      }
      await page.keyboard.press('Shift+Tab');
      expect(await inside(page)).toBe(true);
      await page.getByRole('button', { name: 'Got it' }).focus();
      expect((await focusedIndicator(page))?.visible).toBe(true);
      await page.keyboard.press('Enter');
      await expect(tip(page, TOUR_TITLES[1])).toBeVisible();
      expect(await inside(page)).toBe(true);
    });
  });
}

test.describe('the spotlight fade, as the marker reads it', () => {
  test.describe('reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });
    test('data-kb-fade is none and the overlay is fully opaque on the first read', async ({ page }) => {
      await signInUnseasoned(page);
      await finishWelcome(page);
      const overlay = page.locator('.kb-tips');
      await expect(overlay).toHaveAttribute('data-kb-fade', 'none');
      /* One read, on purpose: a fade that ran for even a frame would show an opacity below 1 here, and a retrying assertion would wait it out. */
      expect(await overlay.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    });
  });
  test('without it, data-kb-fade is in', async ({ page }) => {
    await signInUnseasonedOnBoard(page);
    await expect(page.locator('.kb-tips')).toHaveAttribute('data-kb-fade', 'in');
  });
});
