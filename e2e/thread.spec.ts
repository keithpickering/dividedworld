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

/*
 * The Phone board's moment (docs/research/2026-10-29-two-worlds/02-phone.html): #41 wears a Whoops! mark. The mark
 * stands in the post's date row, at its right and clear of its permalink, inside the post's width, with no words on it
 * (the marks-and-the-lens design, section 1).
 */
for (const [label, viewport, moment] of [['a narrow post', { width: 390, height: 844 }, '02-phone'], ['a wide post', { width: 1440, height: 1120 }, '01-main']] as const) {
  test.describe(`a card mark on ${label}`, () => {
    test.use({ viewport });

    test('stands in the date row clear of the permalink, stays inside the post\'s width, and has no words on it', async ({ page }) => {
      await page.goto(`/?fixture=boards&moment=${moment}`);
      const post = page.locator('#post-41');
      const mark = post.locator('.kb-mark[data-kb-card]').first();
      await expect(mark).toBeVisible();
      const [m, number, row, article] = await Promise.all([
        mark.boundingBox(),
        post.locator('.kb-act-number').boundingBox(),
        post.locator('header.kb-act-meta').boundingBox(),
        post.boundingBox(),
      ]);
      /* In the row, and clear of the permalink to its right. */
      expect(m!.y, 'the mark starts within the date row').toBeLessThan(row!.y + row!.height);
      expect(m!.x + m!.width, 'the mark ends before the permalink').toBeLessThanOrEqual(number!.x + 1);
      expect(m!.x).toBeGreaterThanOrEqual(article!.x - 1);
      /* No words on it: the name is for a screen reader. */
      expect(((await mark.textContent()) ?? '').replace(/\s|×\d+/gu, '')).toBe('');
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  });
}
