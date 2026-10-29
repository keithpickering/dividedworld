import { expect, test } from '@playwright/test';

/* The demo world's short thread: the reply box at its foot, reached and used with the keyboard alone. */
test('replies with the keyboard only: Tab to the box, type, Send with Enter on the button', async ({ page }) => {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'Who keeps reacting with tea?', exact: true }).click();
  const box = page.getByRole('textbox', { name: 'Your reply' });
  await expect(box).toBeVisible();
  /* Start from the last control before the toolbar and Tab forward: the toolbar is one stop, then the box. */
  await page.getByRole('link', { name: 'Index' }).first().focus();
  for (let i = 0; i < 200; i += 1) {
    if (await box.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(box).toBeFocused();
  await page.keyboard.type('Reply from the keyboard.');
  /* Tab past the count and Preview to Send, and press Enter on it. */
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const send = page.getByRole('button', { name: 'Send' });
  await expect(send).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.kb-act', { hasText: 'Reply from the keyboard.' })).toBeVisible();
  await expect(box).toHaveValue('');
});

test('spins a thread from a post and lands on its ORIGIN box', async ({ page }) => {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'Who keeps reacting with tea?', exact: true }).click();
  const post = page.locator('#post-1');
  await post.getByRole('button', { name: 'Spin thread' }).click();
  await post.getByLabel('Thread title').fill('A spin from the tea thread');
  await post.getByRole('button', { name: 'Spin thread' }).last().click();
  await expect(page.getByRole('heading', { level: 1, name: 'A spin from the tea thread' })).toBeVisible();
  const origin = page.getByRole('group', { name: 'Origin' });
  await expect(origin).toBeVisible();
  await expect(origin).toContainText('Every post I make');
  await expect(origin.getByRole('link', { name: /in Who keeps reacting with tea\?/ })).toBeVisible();
});
