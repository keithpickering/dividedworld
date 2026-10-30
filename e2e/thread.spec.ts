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

test.describe('a desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the postbit column is narrow, and a character with no avatar gets a small square, not a tall empty box', async ({ page }) => {
    const path = await openLongThread(page);
    await page.goto(`${path}?page=1`);
    const post = page.locator('#post-2');
    const [bit, row] = [await post.locator('.kb-postbit').boundingBox(), await post.boundingBox()];
    expect(bit!.width / row!.width).toBeLessThan(0.2);
    const slot = await post.locator('.kb-postbit-avatar').boundingBox();
    expect(slot!.height).toBeLessThan(80);
  });
});

/* The Phone board's moment (docs/research/2026-10-29-two-worlds/02-phone.html): #41 wears a Whoops! tag. */
test.describe('a play tag on a narrow post', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('stands above the post\'s words and clears the post\'s line, wrapping inside the post\'s width', async ({ page }) => {
    await page.goto('/?fixture=boards&moment=02-phone');
    const post = page.locator('#post-41');
    const tag = post.locator('.kb-play-tag').first();
    await expect(tag).toBeVisible();
    const [t, line, main, body] = await Promise.all([
      tag.boundingBox(),
      post.locator('header.kb-act-meta').boundingBox(),
      post.locator('.kb-act-main').boundingBox(),
      /* The first thing after the tags is the post's own words. */
      post.locator('.kb-play-tags + *').first().boundingBox(),
    ]);
    /* Not over the post's line (its date and permalink)... */
    expect(t!.y, 'the tag starts below the post\'s line').toBeGreaterThanOrEqual(line!.y + line!.height - 1);
    /* ...nor over the start of its words. */
    expect(body!.y, 'the words start below the tag').toBeGreaterThanOrEqual(t!.y + t!.height - 1);
    /* It takes the post's width and no more. */
    expect(t!.x).toBeGreaterThanOrEqual(main!.x - 1);
    expect(t!.x + t!.width).toBeLessThanOrEqual(main!.x + main!.width + 1);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});
