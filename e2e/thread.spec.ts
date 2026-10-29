import { expect, test, type Page } from '@playwright/test';

/* A long thread of the demo world: 170 Acts, twenty to a page, so post 142 is on page 8. */
async function openLongThread(page: Page): Promise<string> {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'The long one', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'The long one' })).toBeVisible();
  return new URL(page.url()).pathname;
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('a phone', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('a permalink opens its page at the post, in view, with no horizontal scroll at 320px wide', async ({ page }) => {
    const path = await openLongThread(page);
    await page.goto(`${path}?page=8#post-142`);
    const post = page.locator('#post-142');
    await expect(post).toBeVisible();
    await expect(post).toBeInViewport();
    await expect(page.locator('#post-140')).toHaveCount(0);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('a post folds to one column: the postbit above the words', async ({ page }) => {
    const path = await openLongThread(page);
    await page.goto(`${path}?page=1`);
    const post = page.locator('#post-2');
    const bit = post.locator('.kb-postbit');
    const words = post.locator('.kb-act-main');
    await expect(words).toBeVisible();
    const [a, b] = [await bit.boundingBox(), await words.boundingBox()];
    expect(b!.y).toBeGreaterThanOrEqual(a!.y + a!.height - 1);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});

test('a permalink without a page opens the page the post is on', async ({ page }) => {
  const path = await openLongThread(page);
  await page.goto(`${path}#post-142`);
  await expect(page.locator('#post-142')).toBeInViewport();
  await expect(page).toHaveURL(/\?page=8#post-142$/u);
});

test('"Continue to page 2" loads the next page below and updates the address, and the page stays where it was', async ({ page }) => {
  const path = await openLongThread(page);
  await page.goto(`${path}?page=1`);
  await expect(page.locator('#post-20')).toHaveCount(1);
  const link = page.getByRole('link', { name: 'Continue to page 2' }).first();
  await link.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  await link.click();
  await expect(page.locator('#post-40')).toHaveCount(1);
  await expect(page).toHaveURL(/\?page=2$/u);
  await expect(page.locator('#post-1')).toHaveCount(1);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThan(50);
});
