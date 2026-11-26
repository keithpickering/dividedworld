import { expect, test, type Page } from '@playwright/test';
import { pageViolations } from './axe.ts';

/* The page's axe check injects a script and a style; the site's policy (e2e/csp.spec.ts holds it) would block them. */
test.use({ bypassCSP: true });

/* An announced Turn is posted at once, in a thread the player picks, and then stands (docs/plans/2026-11-24-staff-board-threads-plan.md, Tasks 1 and 3). The dialog says so before
   the player commits, names the thread it will be posted in, and will not commit until one is chosen. All of it is reached and read from the keyboard, on a page axe finds nothing wrong with. */

/** Tab forward until `target` has focus (a keyboard reaching a control the way a player would). */
async function tabTo(page: Page, target: ReturnType<Page['locator']>) {
  for (let i = 0; i < 200; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

const THREAD = 'Who keeps reacting with a thumbs up?';

test('the Turn dialog asks for a thread before it commits, says it commits, and names the thread, by keyboard and with no axe violation', async ({ page }) => {
  await page.goto('/characters');
  await page.getByRole('tablist', { name: /^Roster, /u }).getByRole('tab', { name: /^Pipewrench/u }).click();
  const turn = page.getByRole('tabpanel', { name: 'Pipewrench' }).getByRole('button', { name: 'Turn Pipewrench' });
  await page.getByRole('link', { name: 'Back to the board' }).focus();
  await tabTo(page, turn);
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Turn Pipewrench' });
  await expect(dialog).toBeVisible();
  /* A class is chosen with the keyboard: focus starts on the first class card. */
  await expect(dialog.getByRole('radio').first()).toBeFocused();
  await page.keyboard.press('Space');
  await expect(dialog.getByRole('radio').first()).toBeChecked();

  /* Announced is the default, so the picker is there, and the foot says what committing means. */
  await expect(dialog.getByRole('radio', { name: /^Announced/u })).toBeChecked();
  const board = dialog.getByRole('combobox', { name: 'Board (optional)' });
  const thread = dialog.getByRole('combobox', { name: 'Thread' });
  await expect(board).toBeVisible();
  await expect(thread).toBeVisible();
  await expect(dialog.getByText("Once announced, this Turn can't be changed or withdrawn. It takes effect at the next settlement.")).toBeVisible();

  /* Nothing is posted anywhere yet, so the Turn cannot be confirmed, and the preview asks for the thread. */
  const confirm = dialog.getByRole('button', { name: 'Confirm Turn' });
  await expect(confirm).toBeDisabled();
  await expect(dialog.getByText('At once, in the thread you choose')).toBeVisible();

  /* The thread is searched and chosen with the keyboard alone: the board filter, then the thread box. */
  await tabTo(page, thread);
  await page.keyboard.type('Who keeps');
  const option = page.getByRole('option', { name: new RegExp(THREAD, 'u') });
  await expect(option).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(thread).toHaveValue(THREAD);

  /* The warning is there beside the choice, the preview now names the thread, and Confirm is open. */
  await expect(dialog.getByText('Once announced, this Turn can', { exact: false })).toBeVisible();
  await expect(dialog.getByText(`At once, in ${THREAD}`)).toBeVisible();
  await expect(confirm).toBeEnabled();
  expect(await pageViolations(page)).toEqual([]);

  /* Escape closes the dialog and gives focus back to the Turn button. */
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(turn).toBeFocused();
});

test('confirming an announced Turn by keyboard says where it was announced, and the Turn then has no Change or Withdraw', async ({ page }) => {
  await page.goto('/characters');
  await page.getByRole('tablist', { name: /^Roster, /u }).getByRole('tab', { name: /^Pipewrench/u }).click();
  const row = page.getByRole('tabpanel', { name: 'Pipewrench' });
  await row.getByRole('button', { name: 'Turn Pipewrench' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Turn Pipewrench' });
  await expect(dialog.getByRole('radio').first()).toBeFocused();
  await page.keyboard.press('Space');
  await tabTo(page, dialog.getByRole('combobox', { name: 'Thread' }));
  await page.keyboard.type('Who keeps');
  await expect(page.getByRole('option', { name: new RegExp(THREAD, 'u') })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await tabTo(page, dialog.getByRole('button', { name: 'Confirm Turn' }));
  await page.keyboard.press('Enter');

  await expect(dialog).toBeHidden();
  /* It stands: announced in the thread, with no way to change or withdraw it. */
  await expect(row.getByText(new RegExp(`Announced in ${THREAD}`, 'u'))).toBeVisible();
  await expect(row.getByRole('button', { name: /^Change Pipewrench/u })).toHaveCount(0);
  await expect(row.getByRole('button', { name: /^Withdraw Pipewrench/u })).toHaveCount(0);
  expect(await pageViolations(page)).toEqual([]);
});
