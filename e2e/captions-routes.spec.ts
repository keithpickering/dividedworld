import { expect, test } from '@playwright/test';

/**
 * The caption bar is the page's, not the board's (#496 F1): the glass routes play the sound settings' volume preview under words that promise a caption,
 * so every route, glass and board alike, holds exactly one live region named "Sound captions".
 */
for (const [name, path] of [['the sound settings', '/settings?section=sound'], ['the welcome page', '/welcome'], ['a board', '/b/general']] as const) {
  test(`${name} holds exactly one caption bar`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('main, [role="main"]').first()).toBeVisible();
    await expect(page.getByRole('status', { name: 'Sound captions' })).toHaveCount(1);
  });
}
