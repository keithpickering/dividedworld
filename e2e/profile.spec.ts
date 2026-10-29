import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 320, height: 640 } });

test('opens a profile from a postbit, and pages the public record by keyboard', async ({ page }) => {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'Who keeps reacting with tea?', exact: true }).click();
  await page.getByRole('article').first().getByRole('link', { name: 'Spritey' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Spritey' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Public record' })).toBeVisible();

  await page.getByRole('link', { name: 'See the full record' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /public record/u })).toBeVisible();
  await expect(page.getByText(/Page 1 of \d+/u)).toBeVisible();
  const next = page.getByRole('link', { name: 'Next page' });
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Page 2 of \d+/u)).toBeVisible();
  await expect(page).toHaveURL(/record\?page=2/u);
});

for (const path of ['/standings']) {
  test(`${path} has no horizontal scroll at 320px wide`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('a profile and its record have no horizontal scroll at 320px wide', async ({ page }) => {
  await page.goto('/standings');
  await page.getByRole('link', { name: 'Pipewrench' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Pipewrench' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'About Pipewrench' })).toContainText('Posts:');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.getByRole('link', { name: 'See the full record' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
