import { expect, test } from '@playwright/test';

test('the app loads on the demo world, with the HUD docked at the bottom', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible();
  const hud = page.getByRole('region', { name: 'Game HUD' });
  /* Playwright's 1280px window is above the switch (engine/ui/glass/board.ts): the Main board's HUD, scaled, whose swap is Swap mask. */
  await expect(hud.getByRole('combobox', { name: 'Swap mask' })).toBeVisible();
  const box = await hud.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && Math.round(box.y + box.height)).toBe(viewport?.height);
});
