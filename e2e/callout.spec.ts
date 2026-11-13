import { expect, test, type Page } from '@playwright/test';

/**
 * The first-time callout on a phone (engine/ui/cards/Callout.tsx, marks.css): at 390 wide it takes its own room under the line it hangs from, so it lies
 * over none of the words a reader has to tap (issue #578). Where it hangs from a character's postbit mark, that line is the post's date row, and the room
 * is reserved between the postbit and the row, full width of the post.
 */
const FIRST = '/?fixture=boards&story=boards-01-cards-beyond-a-post--character-first-time-phone';
const PHONE = { width: 390, height: 844 };

/** The panel's rectangle against the post's date row, its body and its other children, as the page lays them out. */
const meets = (page: Page) => page.evaluate(() => {
  const panel = document.querySelector('.kb-callout .kb-callout-panel')!.getBoundingClientRect();
  const post = document.querySelector('.kb-callout')!.closest('article')!;
  const hit = (b: DOMRect) => panel.left < b.right && b.left < panel.right && panel.top < b.bottom && b.top < panel.bottom;
  const of = (sel: string) => Array.from(post.querySelectorAll(sel)).filter((e) => !e.closest('.kb-callout')).map((e) => e.getBoundingClientRect());
  return {
    inPostbit: document.querySelector('.kb-callout')!.closest('.kb-postbit') !== null,
    date: of('.kb-act-meta time, .kb-act-meta .kb-act-number').filter(hit).length,
    body: hit(post.querySelector('.kb-act-main')!.getBoundingClientRect()),
    width: panel.width,
    post: post.getBoundingClientRect().width,
    inside: panel.left >= post.getBoundingClientRect().left - 1 && panel.right <= post.getBoundingClientRect().right + 1,
  };
});

test.describe('on a phone', () => {
  test.use({ viewport: PHONE });

  test('a callout on a postbit mark takes room above the date row and the words, the width of the post', async ({ page }) => {
    await page.goto(FIRST);
    const panel = page.locator('.kb-postbit .kb-callout .kb-callout-panel');
    await expect(panel).toBeVisible({ timeout: 6000 });
    await panel.scrollIntoViewIfNeeded();
    const m = await meets(page);
    expect(m.inPostbit, 'the callout hangs from the postbit mark').toBe(true);
    expect(m.date, 'the callout meets the post\'s date row').toBe(0);
    expect(m.body, 'the callout meets the post\'s body').toBe(false);
    expect(m.inside, 'the callout stays inside the post').toBe(true);
    expect(m.width, 'the callout is the width of the post').toBeGreaterThan(m.post * 0.85);
    /* Reading order, role and the 24px target are kept. */
    await expect(page.locator('.kb-postbit .kb-callout')).toHaveAttribute('role', 'note');
    const got = await page.locator('.kb-postbit .kb-callout-got').boundingBox();
    expect(got!.height, 'Got it is at least 24px tall').toBeGreaterThanOrEqual(24);
    await page.locator('.kb-postbit .kb-callout').getByRole('button', { name: 'Got it' }).click();
    await expect(page.locator('.kb-postbit .kb-callout')).toBeHidden();
    await expect(page.locator('.kb-postbit .kb-mark').first()).toBeFocused();
  });

  test('a callout on a date row keeps its place under the row when the strip gains a mark', async ({ page }) => {
    await page.goto('/?fixture=boards&story=boards-09-glitter-bomb--light');
    const callout = page.locator('.kb-act-meta .kb-callout').first();
    await expect(callout.locator('.kb-callout-panel')).toBeVisible({ timeout: 6000 });
    await page.evaluate(() => {
      const strip = document.querySelector('.kb-act-meta .kb-callout')!.parentElement as HTMLElement;
      const m = document.createElement('span');
      m.style.cssText = 'display:inline-block;width:40px;height:10px';
      strip.insertBefore(m, strip.firstChild);
    });
    await expect.poll(
      () => callout.evaluate((c) => Math.abs(c.getBoundingClientRect().left - c.closest('header')!.getBoundingClientRect().left)),
      { message: 'the callout is at the row\'s left' },
    ).toBeLessThan(2);
  });

  test('a callout on a postbit mark keeps its place when the strip gains a mark', async ({ page }) => {
    await page.goto(FIRST);
    await expect(page.locator('.kb-postbit .kb-callout .kb-callout-panel')).toBeVisible({ timeout: 6000 });
    /* A mark is added to the strip the callout hangs from: the strip's left moves, and neither the callout nor the room resizes. */
    await page.evaluate(() => {
      const strip = document.querySelector('.kb-callout')!.parentElement as HTMLElement;
      const m = document.createElement('span');
      m.style.cssText = 'display:inline-block;width:40px;height:10px';
      strip.insertBefore(m, strip.firstChild);
    });
    await expect.poll(
      () => page.evaluate(() => {
        const c = document.querySelector('.kb-callout') as HTMLElement;
        return Math.abs(c.getBoundingClientRect().left - c.closest('.kb-postbit')!.getBoundingClientRect().left);
      }),
      { message: 'the callout is at the postbit\'s left' },
    ).toBeLessThan(2);
  });
});

/** What the phone layout leaves on the row the callout hangs from: its marker and its reserved room. */
const row = (page: Page) => page.evaluate(() => {
  const r = document.querySelector('.kb-postbit') as HTMLElement;
  return { marked: r.hasAttribute('data-kb-callout-row'), room: r.style.getPropertyValue('--kb-callout-room') };
});
const DESKTOP = { width: 1280, height: 800 };
/* The post's date row sits right under the postbit, so it moves by the room the postbit holds (the page's next callout hangs from the date row itself,
   so the words below would not move on this page). */
const dateRowTop = (page: Page) => page.evaluate(() => document.querySelector('.kb-postbit')!.closest('article')!.querySelector('.kb-act-meta')!.getBoundingClientRect().top + window.scrollY);

test.describe('the room is measured only on a phone', () => {
  test('on a desktop the row carries no marker and no room', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(FIRST);
    await expect(page.locator('.kb-postbit .kb-callout .kb-callout-panel')).toBeVisible({ timeout: 6000 });
    const r = await row(page);
    expect(r.marked, 'the row is not marked above the breakpoint').toBe(false);
    expect(r.room, 'the row holds no room above the breakpoint').toBe('');
  });

  test('resizing between a phone and a desktop removes and gives the room', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(FIRST);
    await expect(page.locator('.kb-postbit .kb-callout .kb-callout-panel')).toBeVisible({ timeout: 6000 });
    await expect.poll(async () => (await row(page)).marked).toBe(true);
    await page.setViewportSize(DESKTOP);
    await expect.poll(() => row(page)).toEqual({ marked: false, room: '' });
    await expect(page.locator('.kb-callout[data-kb-callout-flow]')).toHaveCount(0);
    await page.setViewportSize(PHONE);
    await expect.poll(async () => (await row(page)).marked).toBe(true);
    await page.locator('.kb-postbit .kb-callout-panel').scrollIntoViewIfNeeded();
    await expect.poll(() => meets(page).then((m) => [m.date, m.body])).toEqual([0, false]);
  });

  test('pressing Got it on a phone gives the room back', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(FIRST);
    await expect(page.locator('.kb-postbit .kb-callout .kb-callout-panel')).toBeVisible({ timeout: 6000 });
    await expect.poll(async () => (await row(page)).marked).toBe(true);
    const before = await dateRowTop(page);
    await page.locator('.kb-postbit .kb-callout').getByRole('button', { name: 'Got it' }).click();
    await expect(page.locator('.kb-postbit .kb-callout')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => {
      const r = document.querySelector('.kb-postbit') as HTMLElement;
      return r.hasAttribute('data-kb-callout-row') || r.style.getPropertyValue('--kb-callout-room') !== '';
    })).toBe(false);
    await expect.poll(() => dateRowTop(page), { message: 'the date row moves back up' }).toBeLessThan(before - 50);
  });
});
