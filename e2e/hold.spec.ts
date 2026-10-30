/**
 * Stick Around's full-screen view in the built app (cards plan, Task 4 as amended 2026-10-30): a long post is read to its
 * end in the view with the bar still empty, a sustained push past the end releases the reader just beyond the post, the
 * checkbox at the end of it is reached by the keyboard, and what a release or a breaking free keeps is what it should.
 *
 * Two things are staged. The long post is the Hold board's `LiveLongPost` story (the board fixture's #44 is short, and a
 * post that fits the view is at both its ends at once); the rest is the app itself at the Hold board's moment, the reader
 * Thwompson on page 3 of the thread, where #44 holds them.
 *
 * What this backend cannot show is a release outliving a reload: the end-to-end build's backend is in memory and a reload
 * starts it again. That the server keeps a release, the reader's own and only ever once, is supabase/tests/0023-cards-screens.sql
 * (`release_effect`), and that a screen asks it of the backend and reads it back is hold.test.tsx; here a release is shown to
 * hold when the reader leaves the thread and comes back to it inside the one session, which asks the backend again.
 */
import { expect, test, type Page } from '@playwright/test';

const STORY = '/?fixture=boards&story=boards-08-hold--live-long-post';
const MOMENT = '/?fixture=boards&moment=08-hold';

const view = (page: Page) => page.getByRole('dialog', { name: 'Stick Around' });
const bar = (page: Page) => view(page).getByRole('progressbar', { name: 'Break free' });
const scroller = (page: Page) => view(page).getByRole('region', { name: 'The held post, and how to be released from it' });
const level = async (page: Page) => Number(await bar(page).getAttribute('aria-valuenow'));
const ready = async (page: Page) => { await page.evaluate(() => document.fonts.ready); };

/** How far the view's post has still to scroll to its end, in px. */
const toEnd = (page: Page) => scroller(page).evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);

/** The reader stops with the story's long post in the window: the page scrolls to it and settles, and the view takes them over. */
async function intoView(page: Page) {
  await page.goto(STORY);
  await ready(page);
  /* The story reads its post before it draws it: scrolling an empty page would scroll nothing. */
  await expect(page.getByText('Part 1', { exact: true })).toBeVisible();
  await page.mouse.move(720, 500);
  await page.mouse.wheel(0, 500);
  await expect(view(page)).toBeVisible({ timeout: 10_000 });
}

test('a long post is read to its end in the view with the bar empty, and a push past the end releases the reader just past it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 980 });
  await intoView(page);
  expect(await toEnd(page), 'the post is longer than the view').toBeGreaterThan(300);
  expect(await level(page)).toBe(0);

  /* Reading: the wheel scrolls the post, and the bar does not move until its end is reached. */
  await page.mouse.move(720, 400);
  let guard = 0;
  while ((await toEnd(page)) > 100 && guard++ < 80) {
    await page.mouse.wheel(0, 100);
    /* Let the browser's own smooth scroll land, so the distance left that the next step reads is true. */
    await page.waitForTimeout(160);
    expect(await level(page), 'reading fills nothing').toBe(0);
  }
  expect(await toEnd(page)).toBeLessThanOrEqual(100);
  /* The last stretch, as the keyboard's End would take it: the end is reached, and nothing has been pushed past it yet. */
  await scroller(page).evaluate((el) => { el.scrollTop = el.scrollHeight; });
  expect(await level(page)).toBe(0);
  await expect(view(page).getByRole('checkbox')).toBeInViewport();

  /* Pushing past the end, hard and for a while, as a trackpad's flick does: a stream of small wheel events, one every 8 ms, in
   * the page itself so its pace is the page's and not the test's round trips. The bar fills against its drain, and the view
   * lets go. */
  await scroller(page).evaluate((el) => new Promise<void>((done) => {
    const began = performance.now();
    const timer = setInterval(() => {
      if (!el.isConnected || performance.now() - began > 6000) { clearInterval(timer); done(); return; }
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true }));
    }, 8);
  }));
  await expect(view(page)).toBeHidden();
  /* Released past the post: its end is just above the top of the window, a sliver of it left in view. */
  const post = page.getByRole('article').filter({ hasText: 'Level editor 2.3' });
  const box = (await post.boundingBox())!;
  expect(box.y + box.height).toBeGreaterThan(0);
  expect(box.y + box.height).toBeLessThan(80);
});

test('a slow push past the end never frees the reader', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 980 });
  await intoView(page);
  await scroller(page).evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.mouse.move(720, 400);
  /* 40 px every 100 ms is 400 px a second, well under the drain's break-even speed. */
  for (let i = 0; i < 40; i += 1) {
    await page.mouse.wheel(0, 40);
    await page.waitForTimeout(100);
  }
  await expect(view(page)).toBeVisible();
  expect(await level(page)).toBeLessThan(30);
});

test.describe('the app at the Hold board\'s moment', () => {
  test.use({ viewport: { width: 1440, height: 980 } });

  test('the reader is held by #44 on arriving, and reaches the checkbox at the end of the post by the keyboard', async ({ page }) => {
    await page.goto(MOMENT);
    await ready(page);
    await expect(view(page)).toBeVisible({ timeout: 10_000 });
    /* No Close, and the post's author is the one named. */
    await expect(view(page).getByRole('button', { name: 'Close' })).toHaveCount(0);
    await expect(view(page).getByRole('article', { name: /^Held post: Spritey/u })).toBeVisible();
    const box = view(page).getByRole('checkbox', { name: /I have read every word of Spritey's changelog and I feel changed\./u });
    for (let i = 0; i < 8 && !(await box.evaluate((el) => el === document.activeElement)); i += 1) await page.keyboard.press('Tab');
    await expect(box).toBeFocused();
    await expect(view(page).getByRole('button', { name: 'Break free' })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(view(page)).toBeHidden();
    /* The release holds when the thread is left and opened again: the screen asks the backend and is told. */
    await page.getByRole('link', { name: 'General', exact: true }).first().click();
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.goBack();
    await expect(page.getByText(/Please read it this time/u)).toBeVisible();
    await page.mouse.wheel(0, 40);
    await page.waitForTimeout(600);
    await expect(view(page)).toBeHidden();
  });

  test('breaking free by the button lasts the visit: the post is not taken again when the thread is left and reopened, and is held again on a new visit', async ({ page }) => {
    await page.goto(MOMENT);
    await ready(page);
    await expect(view(page)).toBeVisible({ timeout: 10_000 });
    const button = view(page).getByRole('button', { name: 'Break free' });
    for (let i = 0; i < 60 && (await view(page).isVisible()); i += 1) {
      await button.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(130);
    }
    await expect(view(page)).toBeHidden();
    await page.getByRole('link', { name: 'General', exact: true }).first().click();
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.goBack();
    await expect(page.getByText(/Please read it this time/u)).toBeVisible();
    await page.mouse.wheel(0, 40);
    await page.waitForTimeout(600);
    await expect(view(page)).toBeHidden();
    /* A new visit: the page's memory is gone, and the post holds the reader again. */
    await page.goto(MOMENT);
    await ready(page);
    await expect(view(page)).toBeVisible({ timeout: 10_000 });
  });

  test('Esc does not close the view; each Esc press is a press of Break free, so pressing it again and again frees the reader', async ({ page }) => {
    await page.goto(MOMENT);
    await ready(page);
    await expect(view(page)).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(view(page).getByRole('status')).toContainText('Esc breaks free, like the Break free button');
    await page.waitForTimeout(300);
    await expect(view(page)).toBeVisible();
    expect(await level(page)).toBeLessThan(15);
    /* Slowly, the drain wins; quickly, it does not. */
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);
    }
    await expect(view(page)).toBeVisible();
    for (let i = 0; i < 60 && (await view(page).isVisible()); i += 1) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(130);
    }
    await expect(view(page)).toBeHidden();
  });

  test.describe('with reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });
    test('the pull still happens, and the view is up', async ({ page }) => {
      await page.goto(MOMENT);
      await ready(page);
      await expect(view(page)).toBeVisible({ timeout: 10_000 });
    });
  });
});
