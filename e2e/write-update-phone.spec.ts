import { expect, test } from '@playwright/test';

/**
 * Write an update's "What everyone will see" scales the Updates post down on the Main board's layout (engine/ui/admin/write-update.css). On the Phone
 * board's layout the post is the Updates page's own at the phone's sizes, so the scale-down must not outrank its phone rules: the preview's padding is
 * the page's 16px and its headline sits 18px under the persona, as the open update's do (engine/ui/updates/updates.css). The board's phone drawing has
 * no preview to hold this against (board 39), so it is read here.
 */
test.use({ bypassCSP: true, reducedMotion: 'reduce', deviceScaleFactor: 1, viewport: { width: 390, height: 844 } });

test('on a phone the preview keeps the Updates post\'s phone padding and headline margin', async ({ page }) => {
  await page.goto('/?fixture=boards&story=boards-00-write-update--write-update-phone');
  await page.getByRole('button', { name: 'Write an update' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Whoops! costs less');
  await page.getByRole('textbox', { name: 'Words' }).fill('A long post still costs more.');
  const post = page.getByRole('region', { name: 'What everyone will see' }).getByRole('article');
  await expect(post).toBeVisible();
  const read = await post.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { left: cs.paddingLeft, top: cs.paddingTop, headline: getComputedStyle(el.querySelector('.kb-updates-headline')!).marginTop };
  });
  expect(read).toEqual({ left: '16px', top: '20px', headline: '18px' });
});
