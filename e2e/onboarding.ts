/**
 * The unseasoned account's way in, shared by the specs that need the HUD tour's first spotlight step on screen
 * (e2e/onboarding.spec.ts, and the glass-text spec's spotlight scenes). A new account with no character is sent to
 * /welcome from its first board page; one that already has a character is not, and the tour waits for the welcome to be
 * seen. So the way in is the player's own: sign in with no character, land on the welcome, make a character (seeded on
 * the fake while the page stays open, as another tab would), and go back to the board.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import type { Fake } from '../engine/ui/data/fake.ts';

/** The account lives on the page's window (`__kbUnseasoned`) for the page's lifetime: a reload resets the fake's world and drops it. */
type E2eWindow = typeof globalThis & { readonly __kbFake: Fake; __kbUnseasoned?: string };

export const TOUR_TITLES = ['This is your mask', 'These are your orbs', 'This is your hand'] as const;

/** Signs in a fresh account that has not seasoned (welcome unseen, no tip seen), with no character yet, and opens `/`. It lands on /welcome. */
export async function signInUnseasoned(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => '__kbFake' in globalThis);
  await page.evaluate(() => {
    const w = globalThis as E2eWindow;
    const account = w.__kbFake.seed.account('e2e-unseasoned');
    w.__kbUnseasoned = account;
    w.__kbFake.signInAs(account);
  });
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome' })).toBeVisible();
}

/** From the welcome: the account gets its one debuted character, and Back to the board leaves the welcome for the board. */
export async function finishWelcome(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = globalThis as E2eWindow;
    w.__kbFake.seed.character(w.__kbUnseasoned!, 'Newcomer', 'face');
  });
  /* The player's rows are read when an account signs in; a character made in another tab shows after the next read, which a sign-out and in is. */
  await flipSession(page, page.getByRole('heading', { level: 1, name: 'Welcome' }));
  await page.getByRole('navigation', { name: 'Menu' }).getByRole('link', { name: 'Back to the board' }).click();
  await expect(page.getByRole('region', { name: 'Game HUD' })).toBeVisible();
}

/** Signs in unseasoned, finishes the welcome and waits for the tour's first step: the page is on the board with that dialog open. */
export async function signInUnseasonedOnBoard(page: Page): Promise<void> {
  await signInUnseasoned(page);
  await finishWelcome(page);
  await expect(page.getByRole('dialog', { name: TOUR_TITLES[0] })).toBeVisible();
}

/**
 * Signs the session out and in again on the fake, so the page reads the account's preferences and rows afresh (a page reload would reset
 * the fake's world instead). It takes what to wait for once signed in again (`back`: the page's own marker, such as the Game HUD on the
 * board), and returns when that is visible. Out is waited for on the signed-out page's own prompt, so the page has seen the sign-out: a flip
 * with nothing between is batched into no change at all.
 */
export async function flipSession(page: Page, back: Locator): Promise<void> {
  await page.evaluate(() => { (globalThis as E2eWindow).__kbFake.signInAs(null); });
  await expect(page.getByRole('main').getByRole('link', { name: 'Sign in' })).toBeVisible();
  await page.evaluate(() => { const w = globalThis as E2eWindow; w.__kbFake.signInAs(w.__kbUnseasoned!); });
  await expect(back).toBeVisible();
}

/**
 * Walks the open tour from its first step: N is read from the first dialog's "1 of N", every step says "n of N" and is named by the
 * title in TOUR_TITLES, N equals the number of titles, and the last Got it closes the tour.
 */
export async function walkTour(page: Page): Promise<void> {
  const first = await page.getByRole('dialog').first().locator('.kb-tips-step').textContent();
  const total = Number(/^1 of (\d+)$/u.exec(first ?? '')?.[1]);
  expect(total, 'the first step reads "1 of N"').toBeGreaterThan(0);
  expect(total).toBe(TOUR_TITLES.length);
  for (let n = 1; n <= total; n += 1) {
    const dialog = page.getByRole('dialog', { name: TOUR_TITLES[n - 1] });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`${n} of ${total}`);
    await dialog.getByRole('button', { name: 'Got it' }).click();
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
