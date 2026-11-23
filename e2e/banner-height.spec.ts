import { expect, test, type Page } from '@playwright/test';

/**
 * The banner keeps the board's height whether or not it holds the search box (the owner's word of 2026-11-23, on the board-look repair
 * after #1012). The masthead is two lines, the name and the tagline under it, and the right column is the address alone signed out or one
 * row more with the search box signed in; at a desk the banner's own padding gives the extra height back either way, so every page starts
 * at the same y under it. Signed in is board 01 (the index, with the search box); signed out is board 16 (not found, with none).
 */
test.use({ reducedMotion: 'reduce', bypassCSP: true });

const WITH_SEARCH = '/?fixture=boards&story=boards-01-index--index';
const WITHOUT_SEARCH = '/?fixture=boards&story=boards-16-not-found--not-found';

async function bannerHeight(page: Page, url: string): Promise<{ height: number; search: boolean }> {
  await page.goto(url);
  await expect(page.locator('.kb-banner')).toBeVisible();
  return page.evaluate(() => ({
    height: Math.round(document.querySelector('.kb-banner')!.getBoundingClientRect().height),
    search: document.querySelector('.kb-banner-search') !== null,
  }));
}

test('desk: the banner is the same height with the search box and without it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const signedIn = await bannerHeight(page, WITH_SEARCH);
  const signedOut = await bannerHeight(page, WITHOUT_SEARCH);
  expect([signedIn.search, signedOut.search]).toEqual([true, false]);
  expect(signedOut.height).toBe(signedIn.height);
});
