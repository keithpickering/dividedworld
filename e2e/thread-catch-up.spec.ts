import { expect, test, type Page } from '@playwright/test';
import type { Fake } from '../engine/ui/data/fake.ts';
import type { Demo } from '../web/src/demo.ts';

type E2eWindow = typeof globalThis & { readonly __kbFake: Fake; readonly __kbDemo: Demo; __kbSurvivor?: string };

const TITLE = 'Who keeps reacting with a thumbs up?';

async function openThread(page: Page): Promise<void> {
  await page.goto('/b/general');
  await page.getByRole('link', { name: TITLE, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
  await expect(page.locator('#post-3')).toBeVisible();
}

/*
 * What lands between a thread document's read and its live channels hearing is in neither. A card
 * play, an edit and a reaction take no place in the thread's order, so no summary can say they
 * happened; the screen reads the pages it drew again once its channels are joined. Each case writes
 * on the fake with no listener hearing it, as another player's tab would.
 */
test('Back to a thread drawn from memory shows a card played, a post edited and a reaction made while the reader was away', async ({ page }) => {
  await openThread(page);
  /* A marker only this document holds: a reload would lose it. */
  await page.evaluate(() => { (globalThis as E2eWindow).__kbSurvivor = 'same page'; });
  /* The board's link is a client-side navigation, so the router keeps the thread's Back entry. */
  await page.getByRole('link', { name: 'General', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'General' })).toBeVisible();
  await page.evaluate(async () => {
    const { __kbFake: fake, __kbDemo: demo } = globalThis as E2eWindow;
    const [, two, three, four] = await fake.acts(demo.thread, 1, 4);
    fake.seed.card(demo.characters.spritey, three!.id, 'whoops', { message: 'oops' });
    const edited = await fake.edit(two!.id, demo.characters.pipewrench, 'It was me. Edited while you were away.');
    if (!edited.ok) throw new Error(edited.error);
    fake.seed.react(demo.other, demo.characters.spritey, four!.id, 'fire');
  });
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
  await expect(page.locator('#post-3').getByRole('button', { name: /^Whoops!, 1 play\b/u })).toBeVisible();
  await expect(page.locator('#post-2')).toContainText('Edited while you were away.');
  await expect(page.locator('#post-4').getByText('Fire, 1')).toBeVisible();
  expect(await page.evaluate(() => (globalThis as E2eWindow).__kbSurvivor)).toBe('same page');
});

test('a card played between the page read and the channel joining shows once it joins', async ({ page }) => {
  await page.goto('/b/general');
  await expect(page.getByRole('link', { name: TITLE, exact: true })).toBeVisible();
  await page.evaluate(() => { (globalThis as E2eWindow).__kbFake.broadcast.holdJoins(); });
  await page.getByRole('link', { name: TITLE, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
  await expect(page.locator('#post-3')).toBeVisible();
  await page.evaluate(() => { (globalThis as E2eWindow).__kbSurvivor = 'same page'; });
  await page.evaluate(async () => {
    const { __kbFake: fake, __kbDemo: demo } = globalThis as E2eWindow;
    const [, , three] = await fake.acts(demo.thread, 1, 3);
    fake.seed.card(demo.characters.spritey, three!.id, 'whoops', { message: 'oops' });
  });
  const mark = page.locator('#post-3').getByRole('button', { name: /^Whoops!, 1 play\b/u });
  /* The channel is not joined, so nothing has read the page again. */
  await page.waitForTimeout(300);
  await expect(mark).toHaveCount(0);
  await page.evaluate(() => { (globalThis as E2eWindow).__kbFake.broadcast.join(); });
  await expect(mark).toBeVisible();
  expect(await page.evaluate(() => (globalThis as E2eWindow).__kbSurvivor)).toBe('same page');
});
