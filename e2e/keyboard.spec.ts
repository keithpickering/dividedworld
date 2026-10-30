import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The core flows by keyboard alone. Already covered, and not repeated here:
 *   reply  - e2e/compose.spec.ts "replies with the keyboard only"
 *   Turn   - e2e/characters.spec.ts "asks for a Turn, sees it pending, and withdraws it, with the keyboard alone"
 * The gaps this file fills: read a thread from the index, react, and spin.
 */

/** Tab forward until `target` has focus, the way a player would reach it. */
async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 300; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

test('reads a thread: from the index to a board, to a thread, and on to the next page, with keys only', async ({ page }) => {
  await page.goto('/');
  const board = page.getByRole('link', { name: /general/iu }).first();
  await tabTo(page, board);
  await page.keyboard.press('Enter');
  const thread = page.getByRole('link', { name: 'The long one', exact: true });
  await tabTo(page, thread);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'The long one' })).toBeVisible();
  await expect(page.locator('#post-1')).toBeVisible();
  const more = page.getByRole('link', { name: 'Continue to page 2' }).first();
  await tabTo(page, more);
  await page.keyboard.press('Enter');
  await expect(page.locator('#post-40')).toHaveCount(1);
  await expect(page).toHaveURL(/\?page=2$/u);
  /* A post's permalink is a link: the keyboard can reach it and it lands on that post. */
  const link = page.locator('#post-23').getByRole('link', { name: 'Permalink to post #23' });
  await tabTo(page, link);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\?page=2#post-23$/u);
});

test('reacts: opens the picker from the keyboard, moves with arrows, chooses with Enter, and focus comes back', async ({ page }) => {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'Who keeps reacting with tea?', exact: true }).click();
  const post = page.locator('#post-3'); // Spritey's reply to nobody: another player's character, so it has a React button
  const react = post.getByRole('button', { name: 'React' });
  await expect(react).toBeVisible();
  await tabTo(page, react);
  await page.keyboard.press('Enter');
  const picker = page.getByRole('dialog', { name: /^React to / });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('status')).toContainText('3 of 3 left');
  /* Focus is already on a kind; the arrows move it, Enter leaves the reaction. */
  const kinds = picker.locator('.kb-picker-kind');
  await expect(kinds.first()).toBeFocused();
  const first = await page.evaluate(() => document.activeElement?.getAttribute('data-kb-reaction'));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  const moved = await page.evaluate(() => document.activeElement?.getAttribute('data-kb-reaction'));
  expect(moved).not.toBe(first);
  await page.keyboard.press('Enter');
  await expect(picker).toBeHidden();
  await expect(react).toBeFocused();
  /* One reaction is spent: the picker says so when it is opened again, and Esc closes it. */
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: /^React to / }).getByRole('status')).toContainText('2 of 3 left');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /^React to / })).toBeHidden();
  await expect(react).toBeFocused();
});

test('spins: opens the form from a post, types a title, sends with Enter, and lands on ORIGIN', async ({ page }) => {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'Who keeps reacting with tea?', exact: true }).click();
  const post = page.locator('#post-1');
  const open = post.getByRole('button', { name: 'Spin thread' });
  await tabTo(page, open);
  await page.keyboard.press('Enter');
  const title = post.getByLabel('Thread title');
  await expect(title).toBeFocused();
  await page.keyboard.type('Spun by keyboard');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Spun by keyboard' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Origin' })).toBeFocused();
});
