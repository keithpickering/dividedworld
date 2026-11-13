import { expect, test, type Page } from '@playwright/test';

/**
 * The hand on the phone's moment (docs/plans/2026-11-13-phone-hand-design.md, sections 3 and 4), at 390 by 844: the hand is a modal dialog that holds Tab to its
 * cards, the close button and the Vending Machine button and gives focus back to the hand button on Esc; a press above the sheet closes it and goes nowhere;
 * a tap on a side card only brings it to the middle, a tap on the middle card arms it and closes the hand; the arrow keys move the middle; under reduced motion
 * an opening with a card armed shows it in the middle on the first frame; the first card is in the window and no card is clipped at the row's bottom; and a
 * deal stopped by a close leaves no inline transform on any card.
 */
test.use({ bypassCSP: true, viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', hasTouch: true });

const BUTTON = /^Hand, \d+ postcards?/;
const MOMENT = '/?fixture=boards&moment=02-phone';
const CARDS = 'ul.kb-hand-cards > li.kb-hand-card';

async function open(page: Page, motion: 'reduce' | 'full' = 'reduce') {
  /* Under reduced motion a card brought to the middle is there at once, under the pointer; under full motion it eases, and the click arrives while it is still moving. */
  await page.emulateMedia({ reducedMotion: motion === 'full' ? 'no-preference' : 'reduce' });
  await page.goto(MOMENT);
  if (motion === 'full') await page.evaluate(() => { document.documentElement.setAttribute('data-kb-motion', 'full'); document.documentElement.setAttribute('data-kb-motion-feel', 'smooth'); });
  const button = page.getByRole('button', { name: BUTTON });
  await expect(button).toBeVisible({ timeout: 10_000 });
  /* The moment may already show the hand open (the board's own state); the player's way is the button. */
  const hand = page.getByRole('dialog', { name: 'Your hand' });
  if (!(await hand.isVisible())) await button.click();
  await expect(hand).toBeVisible();
  /* The deal is over before a card is pressed. */
  await expect(hand).not.toHaveAttribute('data-kb-dealing', '', { timeout: 10_000 });
  return { button, hand };
}

/** The key of the card that carries `data-kb-middle`, and how many do. */
const middle = (page: Page) => page.locator(CARDS).evaluateAll((items) => {
  const m = items.filter((li) => li.hasAttribute('data-kb-middle'));
  return { n: m.length, key: m[0]?.getAttribute('data-kb-card') ?? null };
});

const centerOf = async (page: Page, nth: number) => {
  const box = (await page.locator(`${CARDS} > button`).nth(nth).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test('the hand opens as a dialog, Tab cycles through the cards, the close button and the Vending Machine button only, and Esc focuses the hand button', async ({ page }) => {
  const { button, hand } = await open(page);
  const cards = await page.locator(CARDS).count();
  expect(cards).toBeGreaterThan(1);
  const stops = new Set<string>();
  for (let i = 0; i < cards + 6; i++) {
    const where = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      const drawer = document.querySelector('.kb-hand-drawer');
      return { inside: !!a && !!drawer?.contains(a), label: a?.getAttribute('aria-label') ?? a?.textContent?.trim() ?? '' };
    });
    expect(where.inside, `focus after ${i} Tab presses is inside the hand`).toBe(true);
    stops.add(where.label);
    await page.keyboard.press('Tab');
  }
  /* Every card, the ×, and the Vending Machine button: nothing else. */
  expect(stops.size, `stops ${[...stops].join(' | ')}`).toBe(cards + 2);
  expect(stops).toContain('Close the hand');
  expect(stops).toContain('Vending Machine');
  await page.keyboard.press('Escape');
  await expect(hand).toBeHidden();
  await expect(button).toBeFocused();
});

test('a tap above the sheet closes the hand and the address is unchanged', async ({ page }) => {
  const { hand } = await open(page);
  const before = page.url();
  const sheet = (await hand.boundingBox())!;
  expect(sheet.y).toBeGreaterThan(60);
  await page.mouse.click(195, sheet.y / 2);
  await expect(hand).toBeHidden();
  await page.waitForTimeout(300);
  expect(page.url()).toBe(before);
});

test('a tap on a side card brings it to the middle and arms nothing; a tap on the middle card arms it and closes the hand', async ({ page }) => {
  const { hand } = await open(page, 'full');
  const first = await middle(page);
  expect(first.n).toBe(1);
  const side = page.locator(CARDS).nth(1);
  expect(await side.getAttribute('data-kb-middle')).toBeNull();
  const sideKey = (await side.getAttribute('data-kb-card'))!;
  /* A touch tap: the press, then the click on the card the finger came down on, even though focus has moved the row under it by then. */
  const at = await centerOf(page, 1);
  await page.touchscreen.tap(at.x, at.y);
  /* Nothing is armed and the hand stays open, whether or not the card has reached the middle yet. */
  await page.waitForTimeout(300);
  await expect(hand, 'the hand after a tap on a side card').toBeVisible();
  expect(await page.locator(`${CARDS}[data-armed]`).count(), 'cards armed by the side tap').toBe(0);
  await expect(page.getByRole('button', { name: /^Armed · / })).toHaveCount(0);
  await expect.poll(async () => (await middle(page)).key, 'the card in the middle').toBe(sideKey);
  /* The same card, now in the middle, armed by a tap. */
  const now = await centerOf(page, 1);
  await page.touchscreen.tap(now.x, now.y);
  await expect(hand).toBeHidden();
  await expect(page.getByRole('button', { name: /^Armed · / })).toBeVisible();
});

test('Right Arrow moves focus to the next card, which becomes the middle', async ({ page }) => {
  await open(page);
  const keys = await page.locator(CARDS).evaluateAll((items) => items.map((li) => li.getAttribute('data-kb-card')));
  await expect(page.locator(`${CARDS} > button`).first()).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator(`${CARDS} > button`).nth(1)).toBeFocused();
  await expect.poll(async () => (await middle(page)).key).toBe(keys[1]);
  await page.keyboard.press('Home');
  await expect.poll(async () => (await middle(page)).key).toBe(keys[0]);
});

test('under reduced motion an opening with a card armed shows that card in the middle on the first frame', async ({ page }) => {
  /* On the phone the hand button puts an armed card back, so the one way to a hand that opens with a card armed is the Main board's: arm a card in the wide hand, open the hand again, and narrow the window to the phone's. */
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?fixture=boards&moment=01-main');
  const button = page.getByRole('button', { name: BUTTON });
  await expect(button).toBeVisible({ timeout: 10_000 });
  await button.click();
  const hand = page.getByRole('dialog', { name: 'Your hand' });
  await expect(hand).toBeVisible();
  await page.getByRole('button', { name: /^Whoops!, Salty\b/ }).first().click();
  await expect(hand).toBeHidden();
  await page.getByRole('button', { name: BUTTON }).click();
  await expect(hand).toBeVisible();
  const second = await page.locator(CARDS).nth(1).getAttribute('data-kb-card');
  expect(await page.locator(`${CARDS}[data-armed]`).getAttribute('data-kb-card'), 'the armed card is the second').toBe(second);
  /* The window narrows to the phone's: the row is read on the first frame it can be, and again after the hand has rested. */
  await page.setViewportSize({ width: 390, height: 844 });
  const read = () => page.evaluate(() => {
    const ul = document.querySelector<HTMLElement>('ul.kb-hand-cards')!;
    return { left: ul.scrollLeft, key: ul.querySelector('li[data-kb-middle]')?.getAttribute('data-kb-card') ?? null };
  });
  const first = await read();
  await page.waitForTimeout(600);
  const later = await read();
  expect(later.key, 'the armed card is the middle').toBe(second);
  expect(first.left, 'the row\'s scrollLeft on the first read is its final one').toBe(later.left);
  expect(later.left, 'the row has moved to the second card').toBeGreaterThan(0);
});

test('on opening the first card is the middle and inside the window, and no visible card is clipped at the row\'s bottom', async ({ page }) => {
  await open(page);
  await expect.poll(async () => (await middle(page)).key).toBe(await page.locator(CARDS).first().getAttribute('data-kb-card'));
  const read = await page.evaluate(() => {
    const ul = document.querySelector<HTMLElement>('ul.kb-hand-cards')!;
    const row = ul.getBoundingClientRect();
    const items = [...ul.querySelectorAll<HTMLElement>(':scope > li')];
    const first = items[0]!.getBoundingClientRect();
    const clipped = items.filter((li) => { const r = li.getBoundingClientRect(); return r.right > row.left && r.left < row.right && r.bottom > row.bottom + 0.5; }).map((li) => `${li.dataset.kbCard}: ${li.getBoundingClientRect().bottom.toFixed(1)} > ${row.bottom.toFixed(1)}`);
    return { firstMiddle: items[0]!.hasAttribute('data-kb-middle'), left: first.left, right: first.right, win: window.innerWidth, clipped };
  });
  expect(read.firstMiddle).toBe(true);
  expect(read.left, 'first card inside the window, left').toBeGreaterThanOrEqual(0);
  expect(read.right, 'first card inside the window, right').toBeLessThanOrEqual(read.win);
  expect(read.clipped, 'cards past the row\'s bottom').toEqual([]);
});

test('a mouse click on a side card brings it to the middle and arms nothing', async ({ page }) => {
  const { hand } = await open(page, 'full');
  const sideKey = (await page.locator(CARDS).nth(1).getAttribute('data-kb-card'))!;
  const at = await centerOf(page, 1);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y, { delay: 150 });
  await page.waitForTimeout(300);
  await expect(hand, 'the hand after a click on a side card').toBeVisible();
  expect(await page.locator(`${CARDS}[data-armed]`).count(), 'cards armed by the side click').toBe(0);
  await expect.poll(async () => (await middle(page)).key, 'the card in the middle').toBe(sideKey);
});

test('a deal stopped by a close leaves no inline transform on any card once things rest', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(MOMENT);
  await page.evaluate(() => { document.documentElement.setAttribute('data-kb-motion', 'full'); document.documentElement.setAttribute('data-kb-motion-feel', 'smooth'); });
  const button = page.getByRole('button', { name: BUTTON });
  await expect(button).toBeVisible({ timeout: 10_000 });
  const hand = page.getByRole('dialog', { name: 'Your hand' });
  if (await hand.isVisible()) { await page.keyboard.press('Escape'); await expect(hand).toBeHidden(); }
  await button.click();
  await expect(hand).toBeVisible();
  /* Close while the cards are still dealing. */
  await page.keyboard.press('Escape');
  await expect(hand).toBeHidden();
  await button.click();
  await expect(hand).toBeVisible();
  await expect(hand).not.toHaveAttribute('data-kb-dealing', '', { timeout: 10_000 });
  const left = await page.locator(CARDS).evaluateAll((items) => items.map((li) => (li as HTMLElement).style.transform).filter(Boolean));
  expect(left, 'inline transforms left on cards').toEqual([]);
});
