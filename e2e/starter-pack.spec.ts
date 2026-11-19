import { expect, test, type Locator, type Page } from '@playwright/test';
import { signInUnseasoned } from './onboarding.ts';

/**
 * The Starter Pack, end to end (starter pack plan, Task 8): a fresh invited account makes its first character through the form, and its hand
 * holds a sealed pack first, with the Hand button's dot and its name saying so. Opening it turns all six cards into the hand, the log says
 * the gift and the opening in plain words, and the wallet is untouched (0). A second character grants nothing. The account is the fake's own
 * (e2e/onboarding.ts's way in), the form and the hand are the player's own controls.
 */
test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

const CARDS = 6;
const hudButton = (page: Page) => page.getByRole('region', { name: 'Game HUD' }).getByRole('button', { name: /^Hand, / });

async function makeCharacter(page: Page, name: string, way: Locator) {
  await way.click();
  const form = page.getByRole('form', { name: 'New character' });
  await expect(form).toBeVisible();
  await form.getByLabel('Name').fill(name);
  await form.getByRole('group', { name: 'Class' }).getByRole('radio').first().check({ force: true });
  await form.getByRole('button', { name: 'Make the character' }).click();
  await expect(page.getByRole('form', { name: 'New character' })).toHaveCount(0);
}

test('a first character is given a sealed Starter Pack; opening it holds six cards, the log tells it, the wallet is 0, and a second character grants nothing', async ({ page }) => {
  await signInUnseasoned(page);
  await makeCharacter(page, 'Newcomer', page.getByRole('link', { name: 'Make your first character' }));

  /* To the board: the Hand button carries the dot and says one sealed pack. */
  await page.getByRole('navigation', { name: 'Menu' }).getByRole('link', { name: 'Back to the board' }).click();
  const hand = hudButton(page);
  await expect(hand).toHaveAccessibleName(/, 1 sealed pack/u);
  await expect(hand.locator('.kb-hud-hand-dot')).toHaveCount(1);

  /* The pack is first in the hand. */
  await hand.click();
  const drawer = page.getByRole('dialog', { name: 'Your hand' });
  const pack = drawer.getByRole('button', { name: 'Starter Pack, sealed: open it' });
  await expect(pack).toBeVisible();
  await expect(drawer.locator('ul.kb-hand-cards > li.kb-hand-card > button').first()).toHaveAccessibleName('Starter Pack, sealed: open it');

  /* Opened and turned over: six cards, no hit. */
  await pack.click();
  const opening = page.getByRole('dialog', { name: /^Opening a Starter Pack/u });
  await expect(opening).toBeVisible();
  await opening.getByRole('button', { name: 'Turn all' }).click();
  await expect(opening.getByText(`${CARDS} of ${CARDS} · all in your hand`)).toBeVisible();
  await expect(opening.locator('.kb-opening-card')).toHaveCount(CARDS);
  await expect(opening.locator('[data-kb-hit]')).toHaveCount(0);
  await opening.getByRole('button', { name: 'Done' }).click();
  await expect(opening).toHaveCount(0);
  if (await drawer.isVisible()) await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  /* The hand holds the six; the sealed word and dot are gone. */
  await expect(hudButton(page)).not.toHaveAccessibleName(/sealed/u);
  await expect(hudButton(page).locator('.kb-hud-hand-dot')).toHaveCount(0);
  await expect(hudButton(page).locator('.kb-hud-hand-count')).toHaveText(String(CARDS));

  /* The wallet is untouched, and a second character grants nothing. */
  const wallet = () => page.evaluate(async () => (await (globalThis as unknown as { __kbFake: { wallet(): Promise<{ balance: number }> } }).__kbFake.wallet()).balance);
  expect(await wallet()).toBe(0);
  await page.getByRole('region', { name: 'Game HUD' }).getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('navigation', { name: 'Menu' }).getByRole('link', { name: 'My characters' }).click();
  await makeCharacter(page, 'Second Mask', page.locator('.kb-roster-new-link'));
  await page.getByRole('navigation', { name: 'Menu' }).getByRole('link', { name: 'Back to the board' }).click();
  await expect(hudButton(page)).not.toHaveAccessibleName(/sealed/u);
  await expect(hudButton(page).locator('.kb-hud-hand-count')).toHaveText(String(CARDS));
  expect(await wallet()).toBe(0);

  /* The log: the gift and the opening, once each. */
  await page.getByRole('region', { name: 'Game HUD' }).getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('navigation', { name: 'Menu' }).getByRole('link', { name: 'My log' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My log' })).toBeVisible();
  await expect(page.getByText('Welcome gift: a sealed Starter Pack')).toHaveCount(1);
  await expect(page.getByText('You opened your Starter Pack')).toHaveCount(1);
});
