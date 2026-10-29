import { expect, test } from '@playwright/test';

test('the app loads on the demo world, with the HUD docked at the bottom', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible();
  const hud = page.getByRole('region', { name: 'HUD' });
  await expect(hud.getByRole('combobox', { name: 'Posting as' })).toBeVisible();
  const box = await hud.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && Math.round(box.y + box.height)).toBe(viewport?.height);
});
