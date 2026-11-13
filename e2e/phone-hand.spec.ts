import { expect, test, type Page } from '@playwright/test';

/**
 * The hand on the phone's moment (docs/plans/2026-11-13-phone-hand-design.md, sections 3 and 4), at 390 by 844: the hand is a modal dialog that holds Tab to its
 * cards, the close button and the Vending Machine button and gives focus back to the hand button on Esc; a press above the sheet closes it and goes nowhere;
 * a tap on a side card only brings it to the middle, a tap on the middle card arms it and closes the hand; the arrow keys move the middle; crossing to the phone layout
 * under reduced motion with the hand open and a card armed shows that card in the middle, with no smooth scroll; the first card is in the window and no card is clipped at the row's bottom; and a
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
  /* The close is the positive effect; a link beneath would have been followed by the same click, so the address is read after it. */
  await expect(hand).toBeHidden();
  await expect(page).toHaveURL(before);
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
  /* The tap's positive effect first (the side card becomes the middle), so the negative checks that follow are read after the tap has acted, not after a guess at how long it takes. */
  await expect.poll(async () => (await middle(page)).key, 'the card in the middle').toBe(sideKey);
  await expect(hand, 'the hand after a tap on a side card').toBeVisible();
  expect(await page.locator(`${CARDS}[data-armed]`).count(), 'cards armed by the side tap').toBe(0);
  await expect(page.getByRole('button', { name: /^Armed · / })).toHaveCount(0);
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

/* What this proves: the window crossing to the phone's layout, with the hand already open and a card armed, shows that card in the middle and leaves the row where it is, under reduced motion (no smooth scroll). It reaches the state by the resize path; the opening with a card armed on the phone itself is not reachable, since its hand button puts an armed card back. */
test('crossing to the phone layout with the hand open and a card armed shows that card in the middle, with no smooth scroll under reduced motion', async ({ page }) => {
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
  /* The window narrows to the phone's. The armed card becomes the middle (polled, not waited for), and then the row does not move over the next two animation frames: a smooth scroll would still be travelling. */
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(`${CARDS}[data-armed]`)).toHaveAttribute('data-kb-middle', '');
  expect(await page.locator(CARDS).nth(1).getAttribute('data-kb-middle'), 'the armed card is the middle one').not.toBeNull();
  const frames = await page.evaluate(() => new Promise<number[]>((done) => {
    const ul = document.querySelector<HTMLElement>('ul.kb-hand-cards')!;
    const seen = [ul.scrollLeft];
    requestAnimationFrame(() => { seen.push(ul.scrollLeft); requestAnimationFrame(() => { seen.push(ul.scrollLeft); done(seen); }); });
  }));
  expect(frames[0], 'the row has moved to the second card').toBeGreaterThan(0);
  expect(new Set(frames).size, `scrollLeft across two frames ${frames.join(', ')}`).toBe(1);
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

/* What this proves: a fast mouse click (press and release together) on a side card brings it to the middle, leaves the hand open and arms nothing. */
test('a fast mouse click on a side card brings it to the middle and arms nothing', async ({ page }) => {
  const { hand } = await open(page, 'full');
  const sideKey = (await page.locator(CARDS).nth(1).getAttribute('data-kb-card'))!;
  const at = await centerOf(page, 1);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await middle(page)).key, 'the card in the middle').toBe(sideKey);
  await expect(hand, 'the hand after a click on a side card').toBeVisible();
  expect(await page.locator(`${CARDS}[data-armed]`).count(), 'cards armed by the side click').toBe(0);
});

/* What this proves: a slow mouse press (150 ms between press and release; the press's focus can ease the card away from under the pointer first) on a side card still brings it to the middle, leaves the hand open and arms nothing. */
test('a slow mouse click on a side card brings it to the middle, leaves the hand open and arms nothing', async ({ page }) => {
  const { hand } = await open(page, 'full');
  const sideKey = (await page.locator(CARDS).nth(1).getAttribute('data-kb-card'))!;
  const at = await centerOf(page, 1);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y, { delay: 150 });
  await expect.poll(async () => (await middle(page)).key, 'the card in the middle').toBe(sideKey);
  await expect(hand, 'the hand after a slow click on a side card').toBeVisible();
  expect(await page.locator(`${CARDS}[data-armed]`).count(), 'cards armed by the slow side click').toBe(0);
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

/*
 * A count a player cannot see is a count they cannot read: with a card of every kind standing in the middle in turn, each ×N the row draws is the topmost thing at its own center (its
 * own badge or inside it), on the middle card, on the cards left of it (whose right part the next card covers) and on the cards right of it. The moment's hand holds two kinds, so the
 * check widens it through the page's own Vending Machine, buying one kind twice and another twice so more than one kind carries a count, on both sides of the middle.
 * The badge ignores the pointer, so the hit test looks through it: `elementsFromPoint` is read with the badges' pointer events on.
 */
test('every ×N the row draws is uncovered, whichever card stands in the middle', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(MOMENT);
  const hand = page.getByRole('dialog', { name: 'Your hand' });
  const button = page.getByRole('button', { name: BUTTON });
  if (!(await hand.isVisible())) await button.click();
  await page.getByRole('link', { name: 'Vending Machine' }).click();
  await expect(page).toHaveURL(/vending/u);
  for (const kind of ['Feelin. Fab', 'Feelin. Fab', 'Autocorrect', 'Autocorrect']) {
    await page.getByRole('button', { name: new RegExp(`^Buy ${kind}, `, 'u') }).click();
    await page.locator('.kb-vending-buy').click();
    await expect(page.getByText(new RegExp(`^${kind} is in your hand`, 'u'))).toBeAttached();
  }
  await page.goBack();
  if (!(await hand.isVisible())) await button.click();
  await expect(hand).toBeVisible();
  await expect(hand).not.toHaveAttribute('data-kb-dealing', '', { timeout: 10_000 });
  await page.addStyleTag({ content: '.kb-hand-times { pointer-events: auto !important; }' });
  const total = await page.locator(CARDS).count();
  expect(total, 'kinds in the hand').toBe(4);
  const counted = new Set<string>();
  for (let at = 0; at < total; at++) {
    await page.locator(`${CARDS} > button`).nth(at).focus();
    await expect.poll(async () => (await page.locator(CARDS).nth(at).getAttribute('data-kb-middle')) !== null).toBe(true);
    const seen = await page.locator(CARDS).evaluateAll((items) => items.flatMap((li) => {
      const badge = li.querySelector<HTMLElement>('.kb-hand-times');
      if (!badge) return [];
      const r = badge.getBoundingClientRect();
      /* A badge outside the window is not drawn to anyone. */
      if (r.right > innerWidth || r.left < 0) return [];
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return [{ key: li.getAttribute('data-kb-card'), covered: !(top && badge.contains(top)), by: top?.className ?? null }];
    }));
    for (const s of seen) counted.add(s.key!);
    expect(seen.filter((s) => s.covered), `badges covered with card ${at} in the middle`).toEqual([]);
  }
  expect(counted.size, 'kinds whose count was drawn and checked').toBeGreaterThanOrEqual(3);
});
