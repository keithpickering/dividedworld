import { expect, test, type Page } from '@playwright/test';
import { settled } from './settled.ts';

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
  await page.getByRole('tablist', { name: /^Roster, /u }).getByRole('tab', { name: /^Pipewrench/u }).click();
  const row = page.getByRole('tabpanel', { name: 'Pipewrench' });
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
  await page.getByRole('tablist', { name: /^Roster, /u }).getByRole('tab', { name: /^Pipewrench/u }).click();
  await expect(page.getByRole('button', { name: 'Turn Pipewrench' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.goto('/characters/new');
  await expect(page.getByRole('heading', { level: 1, name: 'New character' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

/*
 * The selected character's panel keeps a readable measure on a wide layout: its buttons and its label/value
 * rows do not stretch across the whole content width. At 1440 it is the column beside the grid (the board's 500px);
 * under the carousel it is capped in em (52em); on the phone it stays full width.
 */
test('at 1440 the roster panel keeps a readable measure; at 390 it fills the width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/characters');
  await page.getByRole('tablist', { name: /^Roster, /u }).getByRole('tab', { name: /^Pipewrench/u }).click();
  const panel = page.getByRole('tabpanel', { name: 'Pipewrench' });
  const wide = await panel.evaluate((el) => ({ width: el.getBoundingClientRect().width, cap: parseFloat(getComputedStyle(el).fontSize) * 56 }));
  expect(wide.width).toBeLessThanOrEqual(wide.cap);
  await page.setViewportSize({ width: 390, height: 844 });
  const narrow = await panel.evaluate((el) => ({ width: el.getBoundingClientRect().width, parent: el.parentElement!.getBoundingClientRect().width }));
  expect(narrow.width).toBeGreaterThanOrEqual(narrow.parent - 1);
});

/*
 * The Turn modal from My characters leaves the menu bar in view, dimmed and inert (the web plan's
 * 2026-10-30 amendment to Task 9), as the Turn board draws it: the overlay starts at the bar's foot,
 * so nothing covers the bar, and the bar is drawn at brightness 0.6. Close puts the page back as it was.
 */
for (const width of [1440, 1280]) {
  test(`at ${width}px the Turn modal leaves the menu bar in view, dimmed and inert, and Close lights it again`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/characters');
    await page.getByRole('tablist', { name: /^Roster, /u }).getByRole('tab', { name: /^Pipewrench/u }).click();
    await page.getByRole('button', { name: 'Turn Pipewrench' }).click();
    await expect(page.getByRole('dialog', { name: 'Turn Pipewrench' })).toBeVisible();
    const bar = page.locator('nav.kb-glass-menu');
    const got = await bar.evaluate((nav) => {
      const box = nav.getBoundingClientRect();
      const overlay = document.querySelector('.kb-glass-overlay')!.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      /* An inert element is passed over by hit testing, so what is under the bar's middle is the page's root, never the overlay. */
      return { dim: getComputedStyle(nav).filter, opacity: getComputedStyle(nav).opacity, inert: nav.closest('[inert]') !== null, uncovered: !hit?.closest('.kb-glass-overlay'), gap: Math.round(overlay.top - box.bottom) };
    });
    /* The dim is a filter, never opacity (shell.css): the sticky bar stays opaque over the page that scrolls under it. */
    expect(got).toEqual({ dim: 'brightness(0.6)', opacity: '1', inert: true, uncovered: true, gap: 0 });
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(await bar.evaluate((nav) => ({ dim: getComputedStyle(nav).filter, opacity: getComputedStyle(nav).opacity, inert: nav.closest('[inert]') !== null }))).toEqual({ dim: 'none', opacity: '1', inert: false });
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
  await page.getByRole('tablist', { name: /^Roster, /u }).getByRole('tab', { name: /^Pipewrench/u }).click();
  await page.getByRole('button', { name: 'Turn Pipewrench' }).click();
  const dialog = page.getByRole('dialog', { name: 'Turn Pipewrench' });
  /*
   * Playwright scrolls a target into view and then presses at the point it measured. While the dialog is still entering,
   * that scroll lands on a frame the page has not drawn yet and the press goes to what was under the point a frame
   * before (the dialog's title, never the radio). A player scrolls by looking, so this is the harness's race, not a
   * click a player can miss: wait for the entrance, as the measuring specs do.
   */
  await settled(page, { loops: true });
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
  await expect(page.getByRole('tablist', { name: /^Roster, /u })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const got = await page.evaluate(() => {
    const card = document.querySelector('.kb-roster-card')!.getBoundingClientRect();
    const turn = document.querySelector('.kb-roster-card .kb-roster-turn')!.getBoundingClientRect();
    return { height: card.height, turnFoot: card.bottom - turn.bottom };
  });
  expect(got.height).toBeCloseTo(280, 0);
  expect(got.turnFoot).toBeCloseTo(10, 0);
});

/*
 * Choose a class as a carousel (docs/plans/2026-10-30-technician-design.md, section 3; the plan's
 * Task 4), on Divided World's six classes: Face, Heel (Pipewrench's, marked Now), Jabroni,
 * Technician, Tweener, Lurker. As many full cards as fit, the next peeking, a count and arrows; one
 * radiogroup the arrow keys move through, the row following the choice.
 */
async function openTurnAt(page: Page, width: number, height = 1000) {
  await page.setViewportSize({ width, height });
  await page.goto('/characters');
  await page.getByRole('tablist', { name: /^Roster, /u }).getByRole('tab', { name: /^Pipewrench/u }).click();
  await page.getByRole('tabpanel', { name: 'Pipewrench' }).getByRole('button', { name: 'Turn Pipewrench' }).click();
  const dialog = page.getByRole('dialog', { name: 'Turn Pipewrench' });
  await expect(dialog).toBeVisible();
  return dialog;
}
const classGroup = (dialog: ReturnType<Page['locator']>) => dialog.getByRole('group', { name: 'Turn to' });
/** Which of the row's cards lie whole inside it, and which only partly, by their class key. */
async function inView(dialog: ReturnType<Page['locator']>, group = classGroup(dialog)) {
  return group.locator('.kb-class-grid').evaluate((row) => {
    /* Whole is inside the column the cards are counted in: the row's box, less the glow's room at each end. */
    const box = row.getBoundingClientRect();
    const s = getComputedStyle(row);
    const r = { left: box.left + parseFloat(s.paddingLeft), right: box.right - parseFloat(s.paddingRight) };
    const whole: string[] = [];
    const part: string[] = [];
    for (const card of row.querySelectorAll<HTMLElement>('.kb-class-card')) {
      const c = card.getBoundingClientRect();
      if (c.left >= r.left - 1 && c.right <= r.right + 1) whole.push(card.dataset.kbClass!);
      else if (c.right > r.left && c.left < r.right) part.push(card.dataset.kbClass!);
    }
    return { whole, part };
  });
}

test('at 1440 the Turn shows four whole class cards and a peek, counted 1–4 of 6', async ({ page }) => {
  const dialog = await openTurnAt(page, 1440);
  await expect(classGroup(dialog).getByText('1–4 of 6')).toBeVisible();
  expect(await inView(dialog)).toEqual({ whole: ['face', 'heel', 'jabroni', 'technician'], part: ['tweener'] });
  /* The accessibility tree holds every class, the peeking Tweener's and the unseen Lurker's among them: role queries leave out what it leaves out. */
  const snapshot = await classGroup(dialog).ariaSnapshot();
  for (const name of ['Face', 'Jabroni', 'Technician', 'Tweener', 'Lurker']) expect(snapshot).toContain(`radio "${name}"`);
  await expect(classGroup(dialog).getByRole('radio')).toHaveCount(5);
  await expect(classGroup(dialog).getByRole('button', { name: 'Earlier classes' })).toBeDisabled();
  await expect(classGroup(dialog).getByRole('button', { name: 'More classes' })).toBeEnabled();
});

test('the arrow keys move the choice through every class, and the row follows it to the last', async ({ page }) => {
  const dialog = await openTurnAt(page, 1440);
  const group = classGroup(dialog);
  await group.getByRole('radio', { name: 'Jabroni' }).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: 'Technician' })).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: 'Tweener' })).toBeChecked();
  await expect.poll(async () => (await inView(dialog)).whole).toContain('tweener');
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: 'Lurker' })).toBeChecked();
  await expect.poll(async () => (await inView(dialog)).whole).toContain('lurker');
  await expect(group.getByText('3–6 of 6')).toBeVisible();
  await expect(group.getByRole('button', { name: 'More classes' })).toBeDisabled();
  await expect(group.getByRole('button', { name: 'Earlier classes' })).toBeEnabled();
});

/* The Tweener, the fifth card, is reached by the arrows too (the Tweener plan's Task 6): one step brings it whole, the next the Lurker. */
test('the More classes arrow brings the Tweener whole, then the Lurker', async ({ page }) => {
  const dialog = await openTurnAt(page, 1440);
  const group = classGroup(dialog);
  await group.getByRole('button', { name: 'More classes' }).click();
  await expect.poll(async () => (await inView(dialog)).whole).toContain('tweener');
  await expect(group.getByText('2–5 of 6')).toBeVisible();
  await group.getByRole('button', { name: 'More classes' }).click();
  await expect.poll(async () => (await inView(dialog)).whole).toContain('lurker');
  await expect(group.getByRole('button', { name: 'More classes' })).toBeDisabled();
  await group.getByRole('radio', { name: 'Tweener' }).check();
  await expect(group.getByRole('radio', { name: 'Tweener' })).toBeChecked();
});

/** Presses "More classes" and says whether the row has moved its whole card's step on the very next frame. */
async function stepNextFrame(dialog: ReturnType<Page['locator']>) {
  const group = classGroup(dialog);
  const row = group.locator('.kb-class-grid');
  const before = await row.evaluate((el) => el.scrollLeft);
  await group.getByRole('button', { name: 'More classes' }).click();
  const after = await row.evaluate((el) => new Promise<number>((resolve) => requestAnimationFrame(() => resolve(el.scrollLeft))));
  return after - before;
}

/*
 * The arrows move the row by a card and its gap (216 + 14): gliding, or at once under reduced
 * motion. Chromium already makes a smooth scroll instant under the device's reduced motion, so
 * what this proves is the glass's own Motion override (Settings, `data-kb-motion`) on a device with
 * full motion. A choice made with the arrow keys moves focus, and the browser brings a focused
 * card into view at once in either case.
 */
test('under reduced motion the row jumps a card at once; otherwise it glides', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const gliding = await openTurnAt(page, 1440);
  expect(await stepNextFrame(gliding)).toBeLessThan(200);
  await page.keyboard.press('Escape');
  const dialog = await openTurnAt(page, 1440);
  await page.evaluate(() => document.documentElement.setAttribute('data-kb-motion', 'reduce'));
  expect(await stepNextFrame(dialog)).toBeGreaterThanOrEqual(164);
});

/* The name's element fills its title, which runs under the radio's corner by design; what must keep clear is the name's text. */
test('the Technician\'s name, the longest, keeps clear of its radio', async ({ page }) => {
  const dialog = await openTurnAt(page, 1440);
  const card = classGroup(dialog).locator('[data-kb-class="technician"]');
  const name = await card.locator('.kb-class-name').evaluate((el) => { const range = document.createRange(); range.selectNodeContents(el); return range.getBoundingClientRect().toJSON() as DOMRect; });
  const radio = (await card.getByRole('radio').boundingBox())!;
  const meets = name.x < radio.x + radio.width && radio.x < name.x + name.width && name.y < radio.y + radio.height && radio.y < name.y + name.height;
  expect(meets).toBe(false);
});

test('on a phone the Turn shows one class card and a peek, a swipe snaps to the next, and the page never scrolls sideways', async ({ page }) => {
  const dialog = await openTurnAt(page, 390, 844);
  const group = classGroup(dialog);
  await expect(group.getByText('1–1 of 6')).toBeVisible();
  expect(await inView(dialog)).toEqual({ whole: ['face'], part: ['heel'] });
  const row = group.locator('.kb-class-grid');
  await row.scrollIntoViewIfNeeded();
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // Past half a card, as a swipe carries: mandatory snapping settles on the nearer card.
  await page.mouse.wheel(200, 0);
  await expect.poll(async () => (await inView(dialog)).whole).toEqual(['heel']);
  await expect(group.getByText('2–2 of 6')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('on a phone the arrow keys carry the choice to the Tweener and the row follows it', async ({ page }) => {
  const dialog = await openTurnAt(page, 390, 844);
  const group = classGroup(dialog);
  await group.getByRole('radio', { name: 'Technician' }).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: 'Tweener' })).toBeChecked();
  await expect.poll(async () => (await inView(dialog)).whole).toEqual(['tweener']);
  await expect(group.getByText('5–5 of 6')).toBeVisible();
  await group.getByRole('button', { name: 'Earlier classes' }).click();
  await expect.poll(async () => (await inView(dialog)).whole).toEqual(['technician']);
  await group.getByRole('button', { name: 'More classes' }).click();
  await expect.poll(async () => (await inView(dialog)).whole).toEqual(['tweener']);
  await group.getByRole('button', { name: 'More classes' }).click();
  await expect.poll(async () => (await inView(dialog)).whole).toEqual(['lurker']);
});

test('a Turn reopened on a pending Lurker opens with the Lurker in view', async ({ page }) => {
  const dialog = await openTurnAt(page, 1440);
  await classGroup(dialog).getByRole('radio', { name: 'Lurker' }).check();
  await dialog.getByRole('button', { name: 'Confirm Turn' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('tabpanel', { name: 'Pipewrench' }).getByRole('button', { name: /Change Pipewrench/u }).click();
  const change = page.getByRole('dialog', { name: /Change Pipewrench/u });
  await expect(change).toBeVisible();
  await expect(classGroup(change).getByRole('radio', { name: 'Lurker' })).toBeChecked();
  /* Focus opens on the chosen class too (a radio group's one Tab stop), so nothing scrolls the row back to the start. */
  await expect(classGroup(change).getByRole('radio', { name: 'Lurker' })).toBeFocused();
  expect((await inView(change)).whole).toContain('lurker');
});

test('an arrow that reaches its end hands focus to the other arrow, never dropping it out of the dialog', async ({ page }) => {
  const dialog = await openTurnAt(page, 1440);
  const group = classGroup(dialog);
  const more = group.getByRole('button', { name: 'More classes' });
  await more.focus();
  await page.keyboard.press('Enter');
  /* Six classes take two steps to the end; the second waits for the first's glide to land. */
  await expect.poll(async () => (await inView(dialog)).whole).toContain('tweener');
  await page.keyboard.press('Enter');
  await expect(more).toBeDisabled();
  await expect(group.getByRole('button', { name: 'Earlier classes' })).toBeFocused();
});

/* The fade is drawn over a card that only peeks, as wide as its peek: never over a card shown whole. */
async function fades(dialog: ReturnType<Page['locator']>) {
  return classGroup(dialog).locator('.kb-class-grid').evaluate((row) => {
    const s = getComputedStyle(row);
    const px = (name: string) => (row.hasAttribute(`data-kb-peek-${name}`) ? Math.round(parseFloat(s.getPropertyValue(`--kb-class-peek-${name}`))) : 0);
    return { before: px('before'), after: px('after') };
  });
}
/** How much of a card shows inside the row, in whole px, measured from the boxes. */
async function showing(dialog: ReturnType<Page['locator']>, key: string) {
  return classGroup(dialog).locator('.kb-class-grid').evaluate((row, k) => {
    const r = row.getBoundingClientRect();
    const c = row.querySelector(`[data-kb-class="${k}"]`)!.getBoundingClientRect();
    return Math.max(0, Math.round(Math.min(r.right, c.right) - Math.max(r.left, c.left)));
  }, key);
}

test('the fade covers only a peeking card, at its start and its end, and never a card snapped whole on a phone', async ({ page }) => {
  const dialog = await openTurnAt(page, 1440);
  // At the start the Tweener peeks: the fade is as wide as it shows. At the end the Heel does (the Face is two cards back, out of view).
  const peek = await showing(dialog, 'tweener');
  expect(peek).toBeGreaterThan(20);
  expect(await fades(dialog)).toEqual({ before: 0, after: peek });
  await classGroup(dialog).getByRole('radio', { name: 'Lurker' }).check();
  await expect.poll(async () => (await fades(dialog)).after).toBe(0);
  expect((await fades(dialog)).before).toBe(await showing(dialog, 'heel'));

  const phone = await openTurnAt(page, 390, 844);
  const group = classGroup(phone);
  await expect(group.getByText('1–1 of 6')).toBeVisible();
  const row = group.locator('.kb-class-grid');
  await row.scrollIntoViewIfNeeded();
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(200, 0);
  await expect(group.getByText('2–2 of 6')).toBeVisible();
  // Snapped to the Heel, the Face shows only in the glow's room before it, and the fade at the start covers that and no more; the Jabroni peeks at its end.
  await expect.poll(async () => { const face = await showing(phone, 'face'); return face < 32 && (await fades(phone)).before === face; }).toBe(true);
  // The status text and `before` settle the moment the Heel is the first card shown, while the snap is still gliding;
  // the Jabroni's peek grows with the scroll, so wait for the glide to land before reading how much of it shows.
  await expect.poll(async () => (await fades(phone)).after).toBeGreaterThan(40);
});

/*
 * New character's phone row has a card of calc(100% - 64px) of a 355px row, 291.375px: not a whole number of pixels,
 * where the Turn's card happens to be a whole number. The count and the fade must read the real boxes, not a rounded width.
 */
test('on a phone, choosing the Tweener on New character counts 5–5 of 6 and fades none of it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/characters/new');
  await expect(page.getByRole('heading', { level: 1, name: 'New character' })).toBeVisible();
  const group = page.getByRole('group', { name: 'Class' });
  await group.getByRole('radio', { name: 'Tweener' }).check({ force: true });
  await expect(group.getByText('5–5 of 6')).toBeVisible();
  const row = group.locator('.kb-class-grid');
  await expect.poll(async () => (await inView(group, group)).whole).toEqual(['tweener']);
  // The glide has landed; the fade at the row's start covers only what of the Technician shows in the glow's room, and none of the Tweener.
  await expect.poll(async () => row.evaluate((el) => {
    const before = el.hasAttribute('data-kb-peek-before') ? parseFloat(getComputedStyle(el).getPropertyValue('--kb-class-peek-before')) : 0;
    const tweener = el.querySelector('[data-kb-class="tweener"]')!.getBoundingClientRect().left - el.getBoundingClientRect().left;
    return before < 32 && before <= tweener;
  })).toBe(true);
  await expect(group.getByText('5–5 of 6')).toBeVisible();
});

/*
 * The row keeps room for a glow at its ends (docs/plans/2026-11-07-carousel-edges-design.md, section 1): the chosen card
 * at the start has its glow inside the row's box, which reaches past the column its cards stand in, and the card still
 * stands at the column's edge, under the legend.
 */
test('the chosen card at the row\'s start has room for its glow inside the row, and stands where it stood', async ({ page }) => {
  const dialog = await openTurnAt(page, 1440);
  const group = classGroup(dialog);
  await group.getByRole('radio', { name: 'Face' }).check();
  const got = await group.evaluate((g) => {
    const row = g.querySelector('.kb-class-grid')!.getBoundingClientRect();
    const card = g.querySelector('[data-kb-class="face"]')!.getBoundingClientRect();
    const legend = g.querySelector('legend')!.getBoundingClientRect();
    return { room: card.left - row.left, aligned: card.left - legend.left };
  });
  expect(got.room).toBeGreaterThanOrEqual(30);
  expect(Math.abs(got.aligned)).toBeLessThanOrEqual(1);
});

/* The fade eases (section 2): its two lengths follow the measured peeks over a transition, and at once under reduced motion. */
async function fadeMotion(dialog: ReturnType<Page['locator']>) {
  return classGroup(dialog).locator('.kb-class-grid').evaluate((row) => {
    const s = getComputedStyle(row);
    const props = s.transitionProperty.split(',').map((p) => p.trim());
    const durations = s.transitionDuration.split(',').map((d) => parseFloat(d));
    const of = (name: string) => { const i = props.indexOf(name); return i < 0 ? null : durations[i % durations.length]; };
    return { before: of('--kb-class-fade-before'), after: of('--kb-class-fade-after'), fade: Math.round(parseFloat(s.getPropertyValue('--kb-class-fade-after'))), peek: Math.round(parseFloat(s.getPropertyValue('--kb-class-peek-after'))) };
  });
}

test('the fade eases to the peek it is drawn over, and under reduced motion follows it at once', async ({ page }) => {
  const dialog = await openTurnAt(page, 1440);
  const eased = await fadeMotion(dialog);
  expect(eased.before).toBeGreaterThan(0);
  expect(eased.after).toBeGreaterThan(0);
  await expect.poll(async () => { const m = await fadeMotion(dialog); return m.fade === m.peek && m.peek > 0; }).toBe(true);
  /* The mask is drawn over the eased length, not the measured one, and not some other. */
  const row = classGroup(dialog).locator('.kb-class-grid');
  expect(await row.evaluate((el) => getComputedStyle(el).maskImage)).toContain(`${(await fadeMotion(dialog)).fade}px`);

  /*
   * The peek at the end dropped to none (as when the Tweener comes whole): a transition runs on the fade's length, and
   * halfway through it the length lies between where it was and none. (An unregistered length would not ease at all.)
   */
  const was = (await fadeMotion(dialog)).peek;
  const mid = await row.evaluate((el) => {
    el.style.setProperty('--kb-class-peek-after', '0px');
    getComputedStyle(el).getPropertyValue('--kb-class-fade-after');
    const t = el.getAnimations().find((a) => (a as CSSTransition).transitionProperty === '--kb-class-fade-after') as CSSTransition | undefined;
    if (!t) return null;
    t.pause();
    t.currentTime = 100;
    return parseFloat(getComputedStyle(el).getPropertyValue('--kb-class-fade-after'));
  });
  expect(mid).not.toBeNull();
  expect(mid!).toBeGreaterThan(0);
  expect(mid!).toBeLessThan(was);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await fadeMotion(dialog);
  /* No transition at all (`none`) or one of no length: either way the fade follows at once. */
  expect(reduced.before ?? 0).toBe(0);
  expect(reduced.after ?? 0).toBe(0);
});

/*
 * Where the page has room, the roster is the Roster board's grid of three with its panel beside it (section 3): New
 * character takes the next slot, and a row of three never overflows, so there is no count and no arrows.
 */
for (const width of [1440, 1280]) test(`at ${width} the roster is three across with New character in the next slot and the panel beside it`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto('/characters');
  const tablist = page.getByRole('tablist', { name: /^Roster, /u });
  await tablist.getByRole('tab', { name: /^Pipewrench/u }).click();
  const got = await page.evaluate(() => {
    const box = (el: Element | null) => { const b = el!.getBoundingClientRect(); return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), width: Math.round(b.width) }; };
    const tabs = [...document.querySelectorAll('[role="tablist"] [role="tab"]')].map(box);
    return { tabs, add: box(document.querySelector('.kb-roster-new')), panel: box(document.querySelector('[role="tabpanel"]')) };
  });
  expect(got.tabs.length).toBe(2);
  const [a, b] = got.tabs as [typeof got.add, typeof got.add];
  expect(b.top).toBe(a.top);
  expect(Math.abs((b.left - a.left) - (got.add.left - b.left))).toBeLessThanOrEqual(1);
  expect(got.add.top).toBe(a.top);
  /* 32px of the board's, drawn at the board's scale (1280 / 1440 at 1280). */
  expect(got.panel.left - got.add.right).toBeGreaterThanOrEqual(Math.floor(32 * Math.min(1, width / 1440)) - 1);
  expect(Math.abs(got.panel.top - a.top)).toBeLessThanOrEqual(40);
  await expect(page.getByRole('button', { name: 'More characters' })).toHaveCount(0);
});

test('on the Phone board\'s layout at 1024 the roster is still a carousel with its panel under it', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/characters');
  const tablist = page.getByRole('tablist', { name: /^Roster, /u });
  await tablist.getByRole('tab', { name: /^Pipewrench/u }).click();
  const got = await page.evaluate(() => ({
    layout: document.documentElement.dataset.kbLayout,
    row: getComputedStyle(document.querySelector('.kb-roster-carousel .kb-class-grid')!).overflowX,
    rowFoot: document.querySelector('.kb-roster-carousel')!.getBoundingClientRect().bottom,
    panelTop: document.querySelector('[role="tabpanel"]')!.getBoundingClientRect().top,
  }));
  expect(got.layout).toBe('phone');
  expect(got.row).toBe('auto');
  expect(got.panelTop).toBeGreaterThan(got.rowFoot);
});

/*
 * On a phone the row's glow room is no more than the dialog's own padding, so the Turn's overlay never scrolls sideways
 * (the row reaching past what the dialog holds would make the overlay's scrollport wider than the window).
 */
test('on a phone the Turn dialog never scrolls sideways', async ({ page }) => {
  const dialog = await openTurnAt(page, 390, 844);
  await expect(classGroup(dialog).getByText('1–1 of 6')).toBeVisible();
  const over = await page.locator('.kb-glass-overlay').evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
});

/* From 150% text the page is the Phone board's one column at any width, so the roster is the carousel there too, however wide the window. */
test('at 150% text on a wide window the roster stays a carousel with its panel under it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/characters');
  await page.waitForFunction(() => '__kbFake' in globalThis);
  await page.evaluate(async () => { await (globalThis as unknown as { __kbFake: { setPreferences(p: { textSize: number }): Promise<void> } }).__kbFake.setPreferences({ textSize: 150 }); });
  await page.goto('/characters');
  await page.getByRole('tablist', { name: /^Roster, /u }).getByRole('tab', { name: /^Pipewrench/u }).click();
  const got = await page.evaluate(() => ({
    layout: document.documentElement.dataset.kbLayout,
    row: getComputedStyle(document.querySelector('.kb-roster-carousel .kb-class-grid')!).overflowX,
    rowFoot: document.querySelector('.kb-roster-carousel')!.getBoundingClientRect().bottom,
    panelTop: document.querySelector('[role="tabpanel"]')!.getBoundingClientRect().top,
  }));
  expect(got.layout).toBe('phone');
  expect(got.row).toBe('auto');
  expect(got.panelTop).toBeGreaterThan(got.rowFoot);
});
