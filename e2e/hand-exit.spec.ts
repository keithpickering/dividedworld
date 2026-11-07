import { expect, test } from '@playwright/test';

/**
 * The hand drawer's exit (engine/ui/frame/Hud.tsx; glass polish design, section 9): it leaves from the hand button, so the close is measured while the
 * drawer is still shown, and the transform-origin it plays from is the button's side of the drawer, not the default center.
 */
test.use({ bypassCSP: true, reducedMotion: 'no-preference' });

test('closing the hand drawer plays its exit from the hand button', async ({ page }) => {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'Who keeps reacting with a thumbs up?', exact: true }).click();
  await page.evaluate(() => { document.documentElement.setAttribute('data-kb-motion', 'full'); document.documentElement.setAttribute('data-kb-motion-feel', 'smooth'); });
  const button = page.getByRole('button', { name: /^Hand, \d+ postcards?/ });
  await button.click();
  const hand = page.getByRole('region', { name: 'Your hand' });
  await expect(hand).toBeFocused();
  await page.waitForTimeout(800);
  const geo = await page.evaluate(() => {
    const a = document.querySelector<HTMLElement>('.kb-hand-drawer')!.getBoundingClientRect();
    const b = Array.from(document.querySelectorAll('button')).find((e) => /^Hand, \d+ postcard/.test(e.getAttribute('aria-label') ?? e.textContent ?? ''))!.getBoundingClientRect();
    return { drawer: a.toJSON(), button: b.toJSON() };
  });
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.kb-hand-drawer')!;
    const seen: string[] = [];
    (globalThis as unknown as { __o: string[] }).__o = seen;
    const tick = () => { seen.push(el.style.transformOrigin); if (seen.length < 40) requestAnimationFrame(tick); };
    new MutationObserver(() => {}).observe(el, { attributes: true });
    requestAnimationFrame(tick);
  });
  await button.click();
  await page.waitForTimeout(600);
  const origins = await page.evaluate(() => (globalThis as unknown as { __o: string[] }).__o.filter((o) => o !== ''));
  expect(origins.length).toBeGreaterThan(0);
  const [x, y] = origins[0]!.split(' ').map(parseFloat) as [number, number];
  /* The origin is a point in the drawer's own frame: not its center, and on the hand button's side of it. */
  expect(`${x}px ${y}px`).not.toBe(`${geo.drawer.width / 2}px ${geo.drawer.height / 2}px`);
  const buttonX = geo.button.left + geo.button.width / 2 - geo.drawer.left;
  const buttonY = geo.button.top + geo.button.height / 2 - geo.drawer.top;
  expect(Math.abs(x - buttonX)).toBeLessThan(2);
  expect(Math.abs(y - buttonY)).toBeLessThan(2);
  await expect(hand).toBeHidden();
});
