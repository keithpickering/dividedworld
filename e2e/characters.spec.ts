import { expect, test, type Page } from '@playwright/test';

/** Tab forward until `target` has focus (a keyboard reaching a control the way a player would). */
async function tabTo(page: Page, target: ReturnType<Page['locator']>) {
  for (let i = 0; i < 200; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

/* The Turn, by keyboard only: open the modal, choose, confirm, see it pending, change it, withdraw it. */
test('asks for a Turn, sees it pending, and withdraws it, with the keyboard alone', async ({ page }) => {
  await page.goto('/characters');
  const row = page.getByRole('row', { name: /^Pipewrench/u });
  const turn = row.getByRole('button', { name: 'Turn Pipewrench' });
  await expect(turn).toBeVisible();
  await page.getByRole('link', { name: 'Index' }).first().focus();
  await tabTo(page, turn);
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Turn Pipewrench' });
  await expect(dialog).toBeVisible();
  /* Focus is inside, on the first class card; Space chooses it. */
  await expect(dialog.getByRole('radio').first()).toBeFocused();
  await page.keyboard.press('Space');
  await expect(dialog.getByRole('radio').first()).toBeChecked();
  /* Esc closes and gives focus back to the Turn button; open it again. */
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(turn).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Space');

  /* Tab stays inside the dialog all the way round. */
  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  const confirm = dialog.getByRole('button', { name: 'Turn Pipewrench' });
  await tabTo(page, confirm);
  await page.keyboard.press('Enter');

  await expect(dialog).toBeHidden();
  await expect(row.getByText(/Turn waiting/u)).toBeVisible();
  await expect(row.getByText(/Takes effect at the next settlement/u)).toBeVisible();
  /* Focus stays in the row: on Change, where the Turn button was. */
  await expect(row.getByRole('button', { name: /Change Pipewrench/u })).toBeFocused();

  /* Change it to silent. */
  await page.keyboard.press('Enter');
  const change = page.getByRole('dialog', { name: /Change Pipewrench/u });
  await expect(change).toBeVisible();
  /* Tab reaches a radio group at its chosen option (Announced); the arrow keys move within it. */
  const announced = change.getByRole('radio', { name: /^Announced/u });
  await tabTo(page, announced);
  await page.keyboard.press('ArrowUp');
  await expect(change.getByRole('radio', { name: /^Silent/u })).toBeChecked();
  await tabTo(page, change.getByRole('button', { name: 'Change the Turn' }));
  await page.keyboard.press('Enter');
  await expect(change).toBeHidden();
  await expect(row.getByText(/silent/u)).toBeVisible();

  /* Withdraw it. */
  await tabTo(page, row.getByRole('button', { name: /Withdraw Pipewrench/u }));
  await page.keyboard.press('Enter');
  await expect(row.getByText(/Turn waiting/u)).toBeHidden();
  await expect(row.getByRole('button', { name: 'Turn Pipewrench' })).toBeFocused();
});

test('a phone shows My characters without scrolling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/characters');
  await expect(page.getByRole('heading', { level: 1, name: /Your characters/u })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn Pipewrench' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.goto('/characters/new');
  await expect(page.getByRole('heading', { level: 1, name: 'New character' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
