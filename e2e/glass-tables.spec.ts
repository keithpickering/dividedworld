import { expect, test, type Page } from '@playwright/test';
import { open, type Probe } from './glass-screens.ts';

/**
 * The Season's rankings table and the Log's table stand on the page's own left edge, as its text does (engine/ui/tables.test.tsx reads
 * the stylesheets for the rules that do it; this reads where the words are drawn): the first word of the first cell of a row starts where
 * the page's title does, at a phone and at a desktop, within a pixel.
 */
test.use({ bypassCSP: true, reducedMotion: 'reduce', deviceScaleFactor: 1 });

const TABLES: readonly { readonly screen: Probe; readonly table: string }[] = [
  { screen: { name: 'Rankings', path: '/season?tab=rankings' }, table: '.kb-rankings-table' },
  { screen: { name: 'My log, on the Log board\'s moment', path: '/?fixture=boards&moment=12-log' }, table: '.kb-log-table' },
];

/** Where the first drawn word of an element starts, and where the page's title does. */
async function lefts(page: Page, table: string) {
  return page.evaluate((sel) => {
    const startOf = (el: Element) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if ((n.textContent ?? '').trim() === '') continue;
        const r = document.createRange();
        r.selectNodeContents(n);
        const box = [...r.getClientRects()].find((b) => b.width > 0 && b.height > 0);
        if (box) return box.left;
      }
      return null;
    };
    const t = document.querySelector(sel)!;
    const cell = [...t.querySelectorAll('tbody td, tbody th')].find((c) => c.getClientRects().length > 0 && (c.textContent ?? '').trim() !== '')!;
    const title = document.querySelector('main h1, [role="main"] h1')!;
    return { cell: startOf(cell), title: startOf(title) };
  }, table);
}

for (const width of [390, 1440]) {
  for (const { screen, table } of TABLES) {
    test(`${screen.name}: the table's first words start at the page's left edge (${width} wide)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, screen);
      await expect(page.locator(table)).toBeVisible();
      const { cell, title } = await lefts(page, table);
      expect(cell, 'the first cell has a word drawn').not.toBeNull();
      expect(title, 'the page has a title drawn').not.toBeNull();
      expect(Math.abs(cell! - title!), `cell at ${cell}, title at ${title}`).toBeLessThanOrEqual(1.5);
    });
  }
}

/* The poison, planted in a real page: a table whose cells are padded in 24px does not start at the title's edge, and the check says so. */
test('a table padded in from the page\'s edge is caught', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, TABLES[0]!.screen);
  await page.addStyleTag({ content: '.kb-rankings-table th, .kb-rankings-table td { padding-left: 24px !important; }' });
  const { cell, title } = await lefts(page, TABLES[0]!.table);
  expect(Math.abs(cell! - title!)).toBeGreaterThan(1.5);
});
