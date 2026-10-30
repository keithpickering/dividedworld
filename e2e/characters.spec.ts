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
  /* On the glass a character's controls are in its panel, chosen by its card (the Roster board); before, its table row. */
  await page.getByRole('list', { name: /^Roster, /u }).getByRole('button', { name: /^Pipewrench/u }).click();
  const row = page.getByRole('region', { name: 'Pipewrench' });
  const turn = row.getByRole('button', { name: 'Turn Pipewrench' });
  await expect(turn).toBeVisible();
  /* The glass page has no crumb: the keyboard starts from the menu bar's Back, as a player's does. */
  await page.getByRole('link', { name: 'Back to the board' }).focus();
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
  const confirm = dialog.getByRole('button', { name: 'Confirm Turn' });
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
  await page.getByRole('list', { name: /^Roster, /u }).getByRole('button', { name: /^Pipewrench/u }).click();
  await expect(page.getByRole('button', { name: 'Turn Pipewrench' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.goto('/characters/new');
  await expect(page.getByRole('heading', { level: 1, name: 'New character' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

/*
 * The Turn modal from My characters leaves the menu bar in view, dimmed and inert (the web plan's
 * 2026-10-30 amendment to Task 9), as the Turn board draws it: the overlay starts at the bar's foot,
 * so nothing covers the bar, and the bar is drawn at 0.6. Close puts the page back as it was.
 */
for (const width of [1440, 1280]) {
  test(`at ${width}px the Turn modal leaves the menu bar in view, dimmed and inert, and Close lights it again`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/characters');
    await page.getByRole('list', { name: /^Roster, /u }).getByRole('button', { name: /^Pipewrench/u }).click();
    await page.getByRole('button', { name: 'Turn Pipewrench' }).click();
    await expect(page.getByRole('dialog', { name: 'Turn Pipewrench' })).toBeVisible();
    const bar = page.locator('nav.kb-glass-menu');
    const got = await bar.evaluate((nav) => {
      const box = nav.getBoundingClientRect();
      const overlay = document.querySelector('.kb-glass-overlay')!.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      /* An inert element is passed over by hit testing, so what is under the bar's middle is the page's root, never the overlay. */
      return { opacity: getComputedStyle(nav).opacity, inert: nav.closest('[inert]') !== null, uncovered: !hit?.closest('.kb-glass-overlay'), gap: Math.round(overlay.top - box.bottom) };
    });
    expect(got).toEqual({ opacity: '0.6', inert: true, uncovered: true, gap: 0 });
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(await bar.evaluate((nav) => ({ opacity: getComputedStyle(nav).opacity, inert: nav.closest('[inert]') !== null }))).toEqual({ opacity: '1', inert: false });
    await expect(page.getByRole('button', { name: 'Turn Pipewrench' })).toBeFocused();
  });
}

/*
 * A name in the Turn's How loud is a skewed square drawn by its background and border, which forced
 * colors (Windows High Contrast) override: its own forced-colors rules keep on and off apart there.
 */
test('in forced colors the Turn names still show which is on', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/characters');
  await page.getByRole('list', { name: /^Roster, /u }).getByRole('button', { name: /^Pipewrench/u }).click();
  await page.getByRole('button', { name: 'Turn Pipewrench' }).click();
  const dialog = page.getByRole('dialog', { name: 'Turn Pipewrench' });
  await dialog.getByRole('radio').first().check();
  const on = dialog.getByRole('checkbox', { name: /^Name the old class/u });
  const off = dialog.getByRole('checkbox', { name: /^Name the new class/u });
  await on.check();
  await expect(off).not.toBeChecked();
  /*
   * Forced colors keep a background's alpha and repaint its color, so a fill drawn in a token comes
   * out as a pale wash of the page's own Canvas, the same as no fill: the checked box must be filled
   * with the system's Highlight, and the unchecked one must not be.
   */
  const highlight = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'forced-color-adjust: none; background-color: Highlight';
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  const fill = (box: typeof on) => box.evaluate((el) => getComputedStyle(el).backgroundColor);
  /* Polled: a fill eases in under full motion, and the reading is of the state it settles in. */
  await expect.poll(() => fill(on)).toBe(highlight);
  await expect.poll(() => fill(off)).not.toBe(highlight);
});

/*
 * The phone's roster card at 100% text is where the Phone board's layout put it before its parts
 * moved into the card's flow (PR #49): 280px tall, its Turn line 10px off its foot. The flow keeps
 * the gaps between the parts at a larger text size; at 100% it must not move the card.
 */
test('on a phone at 100% text, a roster card is 280px tall with its Turn line 10px off its foot', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/characters');
  await expect(page.getByRole('list', { name: /^Roster, /u })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const got = await page.evaluate(() => {
    const card = document.querySelector('.kb-roster-card')!.getBoundingClientRect();
    const turn = document.querySelector('.kb-roster-card .kb-roster-turn')!.getBoundingClientRect();
    return { height: card.height, turnFoot: card.bottom - turn.bottom };
  });
  expect(got.height).toBeCloseTo(280, 0);
  expect(got.turnFoot).toBeCloseTo(10, 0);
});
