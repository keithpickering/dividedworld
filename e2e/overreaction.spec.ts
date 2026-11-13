import { expect, test, type Page } from '@playwright/test';
import { pageViolations } from './axe.ts';
import { settled } from './settled.ts';

/**
 * Overreaction's play form in a browser (docs/plans/2026-11-11-card-notes-part-3-plan.md, Task 12), on `Boards/01 Reaction card form` (engine/ui/cards/ReactionForm.board.stories.tsx),
 * which arms the card and presses the ghost on the reader's own post as a player does: the form is reached and operated by the keyboard alone (the emoji field, the four quadrants,
 * the button that plays it), says in words what it refuses, and axe finds nothing on it, on the Main board's window and the Phone board's.
 */
test.use({ bypassCSP: true });

const FORM = '/?fixture=boards&story=boards-01-reaction-card-form--form';
const form = (page: Page) => page.locator('form.kb-play').first();

async function open(page: Page) {
  await page.goto(FORM);
  await expect(form(page)).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  await settled(page, { loops: true });
}

/** Tab from the top of the page until `ok` says the focus is where it should be. */
async function tabTo(page: Page, ok: () => Promise<boolean>, what: string) {
  for (let i = 0; i < 60; i++) {
    if (await ok()) return;
    await page.keyboard.press('Tab');
  }
  expect(await ok(), what).toBe(true);
}

test('the form is reached by the keyboard alone: the emoji, then a quadrant by the arrows, then the button that plays it', async ({ page }) => {
  await open(page);
  const f = form(page);
  const emoji = f.getByLabel('Emoji');
  const pick = f.locator('fieldset.kb-choice-pick').first();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await tabTo(page, () => emoji.evaluate((el) => el === document.activeElement), 'Tab reaches the emoji field');
  await page.keyboard.type('\u{1F480}');
  await expect(emoji).toHaveValue('\u{1F480}');
  /* The quadrants are radios under "Scores as", and none is chosen until one is. */
  await expect(pick.getByRole('radio', { checked: true })).toHaveCount(0);
  await tabTo(page, () => pick.evaluate((el) => el.contains(document.activeElement)), 'Tab reaches the quadrants');
  await page.keyboard.press('ArrowDown');
  await expect(pick.getByRole('radio', { checked: true })).toHaveCount(1);
  /* Chosen, the form says what it will do, in the quadrant's own word. */
  await expect(f.getByText(/^\u{1F480} will score as \w+ on this post\.$/u)).toBeVisible();
  const submit = f.locator('button[type="submit"]');
  await tabTo(page, () => submit.evaluate((el) => el === document.activeElement), 'Tab reaches the button that plays the card');
});

test('what the rules refuse is said under the field, in words, once something is typed', async ({ page }) => {
  await open(page);
  const f = form(page);
  const emoji = f.getByLabel('Emoji');
  await emoji.fill('\u{1F525}');
  await expect(f.getByRole('alert')).toHaveText('This forum already has that reaction.');
  await expect(emoji).toHaveAttribute('aria-invalid', 'true');
  await emoji.fill('\u{1F600}\u{1F600}');
  await expect(f.getByRole('alert')).toHaveText(/emoji/u);
  await emoji.fill('\u{1F480}');
  await expect(f.getByRole('alert')).toHaveCount(0);
});

for (const [board, size] of [['Main board', { width: 1440, height: 1120 }], ['Phone board', { width: 390, height: 844 }]] as const) {
  test(`axe finds nothing on the form, empty, refused and filled in, on the ${board}`, async ({ page }) => {
    await page.setViewportSize(size);
    await open(page);
    expect(await pageViolations(page)).toEqual([]);
    const f = form(page);
    await f.getByLabel('Emoji').fill('\u{1F525}');
    await expect(f.getByRole('alert')).toBeVisible();
    expect(await pageViolations(page)).toEqual([]);
    await f.getByLabel('Emoji').fill('\u{1F480}');
    await f.getByRole('radio').first().check();
    await settled(page, { loops: true });
    expect(await pageViolations(page)).toEqual([]);
  });
}
