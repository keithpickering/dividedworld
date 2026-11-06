import { expect, test } from '@playwright/test';
import { PAGES, open } from './glass-screens.ts';

/**
 * A screen is never measured in a fallback face. glass-layout.spec.ts's "no page title breaks inside a word" failed in CI with `character` in the
 * New character title: the display face (Anton) was not in when the title was measured, and its fallback is wider. Opening a screen
 * (e2e/glass-screens.ts, `open`) therefore asks for every face and fails by name when one does not come (e2e/fonts.ts), so a layout finding is
 * never a font that failed to load.
 */
test.use({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });

test('opening a screen fails by name when a face does not load', async ({ page }) => {
  await page.route('**/*.woff2', (route) => route.abort());
  await expect(open(page, PAGES.find((s) => s.name === 'New character')!)).rejects.toThrow(/did not load.*Anton/s);
});
