import { expect, test, type Page } from '@playwright/test';

/**
 * The hand arc on the Main board's moment (docs/plans/2026-11-12-hand-arc-design.md, sections 2 to 4), at 1440 by 900: the hand opens as a modal dialog
 * that holds Tab to its cards and gives focus back to the hand button on Esc; a press on the board outside the cards closes it and acts on nothing under
 * it; a hovered card is the topmost thing at its own center; armed and closed, the peek over the hand button takes no press; under reduced motion the
 * lift is at once. The last test holds the arc's x to the hand button at a narrower window (a card measured from the fifth column, not from 944px).
 */
test.use({ bypassCSP: true, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

const BUTTON = /^Hand, \d+ postcards?/;
const MOMENT = '/?fixture=boards&moment=01-main';

async function open(page: Page) {
  await page.goto(MOMENT);
  const button = page.getByRole('button', { name: BUTTON });
  await expect(button).toBeVisible({ timeout: 10_000 });
  await button.click();
  await expect(page.getByRole('dialog', { name: 'Your hand' })).toBeVisible();
  return button;
}

/** Arms Whoops! from the open hand, which closes the arc and leaves the peek standing over the hand button. */
async function arm(page: Page) {
  const button = await open(page);
  await page.getByRole('button', { name: /^Whoops!, Salty\b/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'Your hand' })).toBeHidden();
  return button;
}

test('the hand opens as a dialog, Tab cycles through its cards only, and Esc closes it and focuses the hand button', async ({ page }) => {
  const button = await open(page);
  const hand = page.getByRole('dialog', { name: 'Your hand' });
  const cards = await hand.locator('li.kb-hand-card > button').count();
  expect(cards).toBeGreaterThan(1);
  const seen = new Set<string>();
  for (let i = 0; i < cards * 3 + 2; i++) {
    const where = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      const drawer = document.querySelector('.kb-hand-drawer');
      return { inside: !!a && !!drawer?.contains(a), card: a?.closest('li.kb-hand-card')?.getAttribute('data-kb-card') ?? null };
    });
    expect(where.inside, `focus after ${i} Tab presses is inside the hand`).toBe(true);
    if (where.card) seen.add(where.card);
    await page.keyboard.press('Tab');
  }
  expect(seen.size, 'Tab reaches every card').toBe(cards);
  await page.keyboard.press('Escape');
  await expect(hand).toBeHidden();
  await expect(button).toBeFocused();
});

test('a press on the board outside the cards closes the hand and does not follow a link under it', async ({ page }) => {
  await open(page);
  const link = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'General', exact: true });
  const box = (await link.boundingBox())!;
  const before = page.url();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('dialog', { name: 'Your hand' })).toBeHidden();
  /* A navigation that did not happen has no event to wait for, so the check gives one a moment to start. */
  await page.waitForTimeout(300);
  expect(page.url()).toBe(before);
  /* The link under the press is live: pressed with the hand closed, it goes where it says. */
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).not.toHaveURL(before);
});

test('hovering a card makes it the topmost element at its own center', async ({ page }) => {
  await open(page);
  await page.mouse.move(5, 5);
  const card = page.locator('li.kb-hand-card').first();
  await card.hover({ force: true });
  const top = await card.evaluate((li) => {
    const r = li.getBoundingClientRect();
    return li.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  });
  expect(top).toBe(true);
});

test('armed and closed, the peek takes no press', async ({ page }) => {
  await arm(page);
  const peek = page.locator('.kb-hand-peek-card');
  await expect(peek).toBeVisible();
  const inside = await page.evaluate(() => {
    const p = document.querySelector('.kb-hand-peek-card')!;
    const r = p.getBoundingClientRect();
    return p.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  });
  expect(inside, 'the peek is the topmost element at its own center').toBe(false);
});

test('under reduced motion a hovered card is in its lifted pose at once, with no transition', async ({ page }) => {
  await open(page);
  await page.mouse.move(5, 5);
  const card = page.locator('li.kb-hand-card').last();
  await card.hover({ force: true });
  const style = await card.evaluate((li) => {
    const c = getComputedStyle(li);
    return { transform: c.transform, duration: c.transitionDuration };
  });
  /* The lifted pose is upright at scale 1.25: matrix(1.25, 0, 0, 1.25, 0, -110) before the card's own offset, so no rotation term remains. */
  const m = style.transform.match(/matrix\(([^)]+)\)/)![1]!.split(',').map(Number);
  expect(m[0]).toBeCloseTo(1.25, 2);
  expect(Math.abs(m[1]!)).toBeLessThan(0.001);
  expect(m[5]).toBeCloseTo(-110, 0);
  expect(style.duration).toMatch(/^0s(, 0s)*$/);
});

test('at 1300 wide the board\'s three cards stand where they do at 1440, and the peek stands over the hand button', async ({ page }) => {
  /** The centers of the arc's cards from the hand button's center, once open. */
  const offsets = async () => {
    await page.goto(MOMENT);
    const button = page.getByRole('button', { name: BUTTON });
    await expect(button).toBeVisible({ timeout: 10_000 });
    await button.click();
    await expect(page.getByRole('dialog', { name: 'Your hand' })).toBeVisible();
    await page.mouse.move(5, 5);
    return page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((e) => /^Hand, \d+ postcard/.test(e.getAttribute('aria-label') ?? ''))!.getBoundingClientRect();
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      /* Below 1440 the board is scaled down (--kb-board-scale), so offsets are read in the board's own pixels. */
      const k = Number(getComputedStyle(document.documentElement).getPropertyValue('--kb-board-scale')) || 1;
      return [...document.querySelectorAll<HTMLElement>('li.kb-hand-card')].map((li) => {
        const fan = parseFloat(li.style.getPropertyValue('--kb-fan-x'));
        const r = li.getBoundingClientRect();
        return { key: li.dataset.kbCard!, fan, x: (r.left + r.width / 2 - bx) / k, y: (r.top + r.height / 2 - by) / k };
      });
    });
  };
  const wide = await offsets();
  await page.setViewportSize({ width: 1300, height: 900 });
  const narrow = await offsets();
  expect(narrow.length).toBe(wide.length);
  for (const w of wide) {
    const n = narrow.find((c) => c.key === w.key)!;
    expect(Math.abs(n.x - w.x), `${w.key}'s x offset from the hand button`).toBeLessThanOrEqual(1);
    /* Under the zoom the board is 1440 wide at every window, so the two widths agree even where a card is measured from the wrong column; its place from the hand button is held too: a card at x 0 stands 10px left of the button's center (a card further right than that is held inside the window, so only the cards at x 0 and left of it are held to it; 150px wide, its left 170px short of the list's right edge, the button's center 105px short of it). */
    if (n.fan <= 0) expect(Math.abs(n.x - n.fan + 10), `${w.key} stands where an x-${-n.fan} card does from the hand button`).toBeLessThanOrEqual(4);
    expect(Math.abs(n.y - w.y), `${w.key}'s y offset from the hand button`).toBeLessThanOrEqual(1);
  }
  /* Armed and closed, the peek stands where a card at x 0 would, over the hand button. */
  await arm(page);
  const gap = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((e) => /^Hand, \d+ postcard/.test(e.getAttribute('aria-label') ?? ''))!.getBoundingClientRect();
    const p = document.querySelector('.kb-hand-peek-card')!.getBoundingClientRect();
    const k = Number(getComputedStyle(document.documentElement).getPropertyValue('--kb-board-scale')) || 1;
    return ((p.left + p.width / 2) - (b.left + b.width / 2)) / k;
  });
  expect(Math.abs(gap + 10), 'the peek\'s center from where a card at x 0 stands over the hand button').toBeLessThan(4);
});

/**
 * The hand opens calmly (the phone-hand design, section 1), with motion on: a card lifts for a keyboard's focus, a hover that has moved, or the arming, and
 * never for the focus the script gives the first card after a mouse press, nor for a card that lands under a still pointer, and the deal's end is not
 * followed by a second movement.
 */
test.describe('the hand opens calmly with motion on', () => {
  test.use({ reducedMotion: 'no-preference' });

  async function load(page: Page) {
    await page.goto(MOMENT);
    const button = page.getByRole('button', { name: BUTTON });
    await expect(button).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => { document.documentElement.setAttribute('data-kb-motion', 'full'); document.documentElement.setAttribute('data-kb-motion-feel', 'smooth'); });
    return button;
  }

  /** The lift's matrix is upright at 1.25 and 110px up (frame.css); a card at rest, in its fan, is not. */
  const lifted = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('li.kb-hand-card')].map((li) => {
    const m = getComputedStyle(li).transform.match(/matrix\(([^)]+)\)/)?.[1]?.split(',').map(Number);
    return { key: li.dataset.kbCard!, lifted: !!m && Math.abs(m[0]! - 1.25) < 0.01 && Math.abs(m[5]! + 110) < 1 };
  }));
  const cardAt = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => document.elementFromPoint(px!, py!)?.closest<HTMLElement>('li.kb-hand-card')?.dataset.kbCard ?? null, [x, y] as const);

  test('opened with a mouse press that does not move, no card lifts; once the pointer moves onto a card it lifts', async ({ page }) => {
    const button = await load(page);
    await button.click();
    await expect(page.getByRole('dialog', { name: 'Your hand' })).toBeVisible();
    await page.waitForTimeout(2000);
    /* The first card holds the focus the opening gave it, and stands in its slot. */
    expect((await lifted(page)).filter((c) => c.lifted), 'no card is lifted').toEqual([]);
    const at = await page.evaluate(() => {
      const r = document.querySelector<HTMLElement>('li.kb-hand-card:last-child')!.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, key: document.querySelector<HTMLElement>('li.kb-hand-card:last-child')!.dataset.kbCard! };
    });
    await page.mouse.move(at.x, at.y);
    await page.waitForTimeout(1200);
    expect((await lifted(page)).find((c) => c.key === at.key)!.lifted).toBe(true);
  });

  test('a card that lands under a pointer parked there and still does not lift; once the pointer moves it does', async ({ page }) => {
    const button = await load(page);
    /* The board's fixture holds two kinds, so no card lands over the hand button's own press: the pointer is parked where the last card will land, and the hand opened with the keyboard. */
    await page.mouse.move(1400, 700);
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Your hand' })).toBeVisible();
    await page.waitForTimeout(2000);
    const key = await cardAt(page, 1400, 700);
    expect(key, 'a card has landed under the parked pointer').not.toBeNull();
    expect((await lifted(page)).find((c) => c.key === key)!.lifted, 'the card under the still pointer').toBe(false);
    await page.mouse.move(1405, 700);
    await page.waitForTimeout(1200);
    expect((await lifted(page)).find((c) => c.key === key)!.lifted, 'the card once the pointer has moved').toBe(true);
  });

  test('opened with the keyboard, the first card is lifted once the deal ends', async ({ page }) => {
    const button = await load(page);
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Your hand' })).toBeVisible();
    await page.waitForTimeout(2000);
    const cards = await lifted(page);
    expect(cards[0]!.lifted, 'the first card').toBe(true);
    expect(cards.filter((c) => c.lifted)).toHaveLength(1);
  });

  test('no card moves up the screen once its deal has landed: the lift does not play after the deal', async ({ page }) => {
    const button = await load(page);
    /* Every frame, each card's top, and whether a play still holds its transform inline (glass/play.ts clears it when the card lands, which is when it stands at its slot). */
    await page.evaluate(() => {
      const w = window as unknown as { __tops: Record<string, { top: number; playing: boolean }[]>; __go: boolean };
      w.__tops = {};
      w.__go = true;
      const tick = () => {
        for (const li of document.querySelectorAll<HTMLElement>('li.kb-hand-card')) {
          /* A card in the hidden drawer has no box yet. */
          const r = li.getBoundingClientRect();
          if (r.width > 0) (w.__tops[li.dataset.kbCard!] ??= []).push({ top: r.top, playing: li.style.transform !== '' });
        }
        if (w.__go) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await button.click();
    await page.waitForTimeout(2500);
    const tops = await page.evaluate(() => { (window as unknown as { __go: boolean }).__go = false; return (window as unknown as { __tops: Record<string, { top: number; playing: boolean }[]> }).__tops; });
    const keys = Object.keys(tops);
    expect(keys.length).toBeGreaterThan(1);
    for (const key of keys) {
      const t = tops[key]!;
      const played = t.findIndex((f) => f.playing);
      expect(played, `${key} is dealt`).toBeGreaterThanOrEqual(0);
      const landed = t.findIndex((f, i) => i > played && !f.playing);
      expect(landed, `${key} lands`).toBeGreaterThan(played);
      const rest = t[landed]!.top;
      expect(Math.min(...t.slice(landed).map((f) => f.top)), `${key} never moves up past the top ${rest} it landed at`).toBeGreaterThanOrEqual(rest - 2);
    }
  });
});
