import { expect, test, type Page } from '@playwright/test';

/**
 * The board's current-page band (a small band in the column head's gradient, engine/ui/board/board.css) is the board's: the glass Rankings pager shares the
 * `kb-pager-here` class and must not take it (board-look plan, Task 6, spec review). The poison puts the board's band on the glass pager's current page and
 * expects it named.
 */
test.use({ reducedMotion: 'reduce', bypassCSP: true });

const NONE = { image: 'none', color: 'rgba(0, 0, 0, 0)', shadow: 'none' };

const read = (page: Page) => page.evaluate(() => {
  const here = document.querySelector('.kb-rankings-pages .kb-pager-here');
  if (!here) return null;
  const css = getComputedStyle(here);
  return { image: css.backgroundImage, color: css.backgroundColor, shadow: css.textShadow };
});

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/?fixture=boards&moment=13-rankings');
  await expect(page.locator('.kb-rankings-table')).toBeVisible();
  /* The fixture's table is one page, so no pager is drawn: the pager's own markup (PageLinks, engine/ui/mini.tsx) is planted in the container Rankings.tsx puts it in, and the CSS is what is read. */
  await page.evaluate(() => {
    const region = document.createElement('div');
    region.className = 'kb-rankings-pages';
    region.innerHTML = '<nav class="kb-pager kb-small" aria-label="Pages of the rankings"><span class="kb-pager-where">Page 1 of 2</span><span class="kb-pager-here" aria-current="page">1</span><a href="#2">2</a></nav>';
    document.querySelector('.kb-rankings-table')!.after(region);
  });
  await expect(page.locator('.kb-rankings-pages .kb-pager-here')).toBeVisible();
}

test('the glass Rankings pager\'s current page has no head-band background or text shadow', async ({ page }) => {
  await open(page);
  expect(await read(page)).toEqual(NONE);
});

test('poison: the board\'s band on the glass pager\'s current page is named', async ({ page }) => {
  await open(page);
  await page.addStyleTag({ content: '.kb-rankings-pages .kb-pager-here { background: var(--kb-head-bg) !important; text-shadow: 1px 1px 0 red !important }' });
  expect(await read(page)).not.toEqual(NONE);
});
