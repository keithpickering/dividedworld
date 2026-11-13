import { expect, test } from '@playwright/test';

/**
 * The hand's lift on the wide layout (frame.css, ".kb-hand-card:hover"; hand-arc design, section 2): a card under the pointer stands upright, 110px
 * higher, at scale 1.25. A pointer that enters a card at its lower part must not lose the card as it rises out from under the pointer, so the lifted
 * card keeps the hover over the box it stood in, down to where its slot was: the card stays lifted while the pointer rests there.
 */
test.use({ bypassCSP: true, viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });

test('a pointer resting 20px above the bottom of a card\'s resting box keeps the card lifted', async ({ page }) => {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'Who keeps reacting with a thumbs up?', exact: true }).click();
  await page.evaluate(() => { document.documentElement.setAttribute('data-kb-motion', 'full'); document.documentElement.setAttribute('data-kb-motion-feel', 'smooth'); });
  await page.getByRole('button', { name: /^Hand, \d+ postcards?/ }).click();
  const hand = page.getByRole('dialog', { name: 'Your hand' });
  await expect(hand).toBeVisible();
  /* The press that opened the hand left the pointer where the button is, perhaps over a card: park it clear, and let the lift settle. */
  await page.mouse.move(5, 5);
  await page.waitForTimeout(1500);
  /* A card whose resting box has, 20px above its bottom, a point that is on that card and on no card in front of it. */
  const found = await page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>('li.kb-hand-card')];
    for (const li of cards) {
      /* Opening focuses the first card; opened with a mouse it stays in its slot (a script's focus after a press does not lift it), but it holds the keyboard's place, so a card at rest is the one to find. */
      if (li.contains(document.activeElement)) continue;
      const r = li.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.bottom - 20;
      if (li.contains(document.elementFromPoint(x, y))) return { key: li.dataset.kbCard!, x, y, top: r.top };
    }
    return null;
  });
  expect(found, 'a card with a free point near its foot').not.toBeNull();
  await page.mouse.move(found!.x, found!.y);
  await page.waitForTimeout(1200);
  const after = await page.evaluate(({ key, x, y }) => {
    const li = document.querySelector<HTMLElement>(`li.kb-hand-card[data-kb-card="${key}"]`)!;
    return { hovered: li.matches(':hover'), top: li.getBoundingClientRect().top, under: li.contains(document.elementFromPoint(x, y)) };
  }, found!);
  expect(after.hovered).toBe(true);
  expect(after.top).toBeLessThan(found!.top - 50);
  expect(after.under).toBe(true);
});
