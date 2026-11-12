import { expect, test, type Page } from '@playwright/test';

/**
 * The hand's deal and gather on the wide layout (engine/ui/frame/Hud.tsx; hand-arc design, section 2, "It deals from the hand button"): opening deals the
 * cards from the hand button's center to their slots, and closing gathers them back toward it, the first card dealt gathered last. The drawer stays shown
 * until the last card is in, then hides. Under reduced motion the cards are in their slots on the first frame after the press.
 */
test.use({ bypassCSP: true, viewport: { width: 1440, height: 900 } });

const BUTTON = /^Hand, \d+ postcards?/;

async function openThread(page: Page, feel: 'smooth' | 'off') {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'Who keeps reacting with a thumbs up?', exact: true }).click();
  if (feel === 'smooth') await page.evaluate(() => { document.documentElement.setAttribute('data-kb-motion', 'full'); document.documentElement.setAttribute('data-kb-motion-feel', 'smooth'); });
}

/** Samples the center of the first card, and of the hand button, on each frame for `frames` frames, from the press that follows. */
async function sample(page: Page, press: () => Promise<void>, frames: number) {
  await page.evaluate((n) => {
    const out: { x: number; y: number; b: { x: number; y: number } }[] = [];
    (globalThis as unknown as { __s: typeof out }).__s = out;
    const tick = () => {
      const li = document.querySelector('li.kb-hand-card')?.getBoundingClientRect();
      const bt = Array.from(document.querySelectorAll('button')).find((e) => /^Hand, \d+ postcard/.test(e.getAttribute('aria-label') ?? ''))!.getBoundingClientRect();
      if (li && li.width > 0) out.push({ x: li.left + li.width / 2, y: li.top + li.height / 2, b: { x: bt.left + bt.width / 2, y: bt.top + bt.height / 2 } });
      if (out.length < n) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, frames);
  await press();
  await page.waitForTimeout(1500);
  return page.evaluate(() => (globalThis as unknown as { __s: { x: number; y: number; b: { x: number; y: number } }[] }).__s);
}

const dist = (p: { x: number; y: number; b: { x: number; y: number } }) => Math.hypot(p.x - p.b.x, p.y - p.b.y);

test.describe('under Smooth', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('opening deals the first card from the hand button to its slot, and closing gathers it back and hides the drawer', async ({ page }) => {
    await openThread(page, 'smooth');
    const button = page.getByRole('button', { name: BUTTON });
    const hand = page.getByRole('dialog', { name: 'Your hand' });
    const opening = await sample(page, () => button.click(), 90);
    const first = opening[0]!, rest = opening.at(-1)!;
    /* The card starts near the button (its scale is 0.6, so the center is where it begins) and ends far from it, in its slot. */
    expect(dist(first)).toBeLessThan(80);
    expect(dist(rest)).toBeGreaterThan(120);
    const mid = opening.slice(1, -1).some((p) => dist(p) > dist(first) + 20 && dist(p) < dist(rest) - 20);
    expect(mid).toBe(true);
    await expect(hand).toBeVisible();
    await page.waitForTimeout(300);
    const closing = await sample(page, () => button.click(), 120);
    const from = closing[0]!;
    expect(dist(from)).toBeGreaterThan(120);
    /* It moves back toward the button while the drawer is still shown. */
    expect(closing.some((p) => dist(p) < dist(from) - 40)).toBe(true);
    await expect(hand).toBeHidden();
  });
});

test.describe('under reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the cards are in their slots on the first frame after the press', async ({ page }) => {
    await openThread(page, 'off');
    const button = page.getByRole('button', { name: BUTTON });
    const frames = await sample(page, () => button.click(), 3);
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) expect(dist(f)).toBeGreaterThan(120);
  });
});
