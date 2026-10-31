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
    await expect(view(page).getByRole('button', { name: 'Break free', exact: true })).toBeVisible();
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
    const button = view(page).getByRole('button', { name: 'Break free', exact: true });
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

  test('an Esc that arrives in the task the view is drawn in is the view\'s too: it is a press of Break free, and the thread behind is not left', async ({ page }) => {
    /* React runs a modal layer\'s own listeners after the paint that shows it, and a key can come between the two (a loaded machine
     * lets it). A mutation observer calls back in the very commit, before them, so the Esc is sent there, as the earliest a key can arrive. */
    await page.addInitScript(() => {
      const watch = new MutationObserver(() => {
        if (!document.querySelector('[role="dialog"][aria-label="Stick Around"]')) return;
        watch.disconnect();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      });
      watch.observe(document, { childList: true, subtree: true });
    });
    await page.goto(MOMENT);
    await ready(page);
    await expect(view(page)).toBeVisible({ timeout: 10_000 });
    await expect(view(page).getByRole('status')).toContainText('Esc breaks free, like the Break free button');
    expect(new URL(page.url()).pathname, 'the Esc did not take the reader out of the thread').toMatch(/^\/t\//u);
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

/*
 * Nothing remounts (marks-and-the-lens design, section 4), on a real browser: Stick Around draws the post's words once and moves their
 * element between the thread and its view, so Whoops!'s canvas, its observers and the reader's unsaved scrubbing are the same ones
 * before the lift, in the view and after the release. jsdom cannot draw the ink or move a canvas, so this is the only place it is read.
 */
test('Whoops!\' ink under the hold keeps its canvas and a reader\'s scrubbing across the lift into the view and the release back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto('/?fixture=boards&story=boards-08-hold--live-inked');
  await ready(page);
  const canvas = page.locator('.kb-whoops-ink');
  await expect(canvas).toBeVisible();
  const inked = () => canvas.evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 40) n++;
    return n / (c.width * c.height);
  });
  /* The share of the canvas that is inked, not the pixels: the view's canvas is wider than the thread's. */
  await expect.poll(inked).toBeGreaterThan(0.01);
  const whole = await inked();
  /* The reader scrubs in the thread, before the hold has taken them over. */
  const box = (await canvas.boundingBox())!;
  const y = Math.min(box.y + box.height / 2, 900);
  await page.mouse.move(box.x + box.width * 0.2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, y, { steps: 30 });
  await page.mouse.up();
  await expect.poll(inked).toBeLessThan(whole * 0.97);
  const scrubbed = await inked();
  await canvas.evaluate((c) => { (c as HTMLElement).dataset.kbSame = 'yes'; });

  /* The hold takes the reader over: the same canvas, in the view, with the same ink. */
  await page.mouse.move(720, 500);
  await page.mouse.wheel(0, 20);
  await expect(view(page)).toBeVisible({ timeout: 10_000 });
  await expect(view(page).locator('.kb-whoops-ink[data-kb-same="yes"]')).toHaveCount(1);
  await expect.poll(inked).toBeLessThan(whole * 0.97);
  expect(Math.abs((await inked()) - scrubbed) / whole).toBeLessThan(0.1);

  /* Released back into the thread: still the same canvas and the same scrubbing. */
  const button = view(page).getByRole('button', { name: 'Break free', exact: true });
  for (let i = 0; i < 60 && (await view(page).isVisible()); i += 1) {
    await button.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(130);
  }
  await expect(view(page)).toBeHidden();
  await expect(page.locator('article .kb-whoops-ink[data-kb-same="yes"]')).toHaveCount(1);
  await expect.poll(inked).toBeLessThan(whole * 0.97);
  expect(Math.abs((await inked()) - scrubbed) / whole).toBeLessThan(0.1);
});

/* Input over the post's words in the view counts like input over the scroller: the words are a portal moved into the view, in a real browser too. */
test('a wheel over the post\'s text, pushed past its end, fills the bar and frees the reader', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 980 });
  await intoView(page);
  await scroller(page).evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const text = view(page).locator('.kb-hold-post-body').first();
  const at = (await text.boundingBox())!;
  /* The post's last lines, which are in the window with the scroller at its end. */
  await page.mouse.move(at.x + at.width / 2, at.y + at.height - 20);
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('.kb-hold-post-body') !== null, [at.x + at.width / 2, at.y + at.height - 20])).toBe(true);
  /*
   * The push is a stream of wheel events dispatched on the post's own words, in the page, as the scroller test above does: its
   * pace is the page's and not the test's round trips, which on a busy runner let the bar drain faster than it filled. Dispatched
   * on the words, the events reach the view's listeners only by bubbling through the DOM the words were moved into.
   */
  await text.evaluate((el) => new Promise<void>((done) => {
    const began = performance.now();
    const timer = setInterval(() => {
      if (!el.isConnected || performance.now() - began > 6000) { clearInterval(timer); done(); return; }
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true }));
    }, 8);
  }));
  await expect(view(page)).toBeHidden();
});

/* The Lens a mark opens inside the hold stands in the overlay, outside the dialog box whose chamfer would clip it. */
test('a mark in the hold opens the Lens unclipped, beside the dialog\'s box', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(MOMENT);
  await ready(page);
  await expect(view(page)).toBeVisible({ timeout: 10_000 });
  await view(page).getByRole('button', { name: /^Stick Around, 1 play/u }).click();
  const lens = page.getByRole('dialog', { name: 'Cards on this post' });
  await expect(lens).toBeVisible();
  const read = await lens.evaluate((el) => {
    const clipped: string[] = [];
    for (let n: Element | null = el; n; n = n.parentElement) if (getComputedStyle(n).clipPath !== 'none') clipped.push(n.className);
    const r = el.getBoundingClientRect();
    return { clipped, inBox: el.parentElement!.closest('.kb-glass-dialog') !== null, inert: el.closest('[inert]') !== null, r: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
  });
  /* The Lens's own chamfer clips its box (the dialog inside the wrapper); no ancestor of its wrapper does. */
  expect(read.inBox, 'the Lens is not inside the dialog box').toBe(false);
  expect(read.inert).toBe(false);
  expect(read.r.left).toBeGreaterThanOrEqual(0);
  expect(read.r.top).toBeGreaterThanOrEqual(0);
  expect(read.r.right).toBeLessThanOrEqual(1440);
  expect(read.r.bottom).toBeLessThanOrEqual(980);
  const wrapperClips = await lens.evaluate((el) => { const out: string[] = []; for (let n = el.parentElement; n; n = n.parentElement) if (getComputedStyle(n).clipPath !== 'none') out.push(n.className); return out; });
  expect(wrapperClips).toEqual([]);
  /* Esc closes the Lens, and the view stays up. */
  await page.keyboard.press('Escape');
  await expect(lens).toBeHidden();
  await expect(view(page)).toBeVisible();
});
