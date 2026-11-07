import { expect, test, type Page } from '@playwright/test';
import { loadFaces } from './fonts.ts';
import { standInFaces } from './board-snapshot.ts';

/**
 * The board look's phone (the plan's Task 8, docs/research/2026-11-06-board-look/03-phone.html): at 390 a thread row's counts, and the
 * index's, fold into one line ("169 replies · 4 views · last: Pipewrench, Oct 5"), where each took a line before, and a date never breaks
 * across two. The poison puts the counts back on a line each.
 */
test.use({ reducedMotion: 'reduce', bypassCSP: true, viewport: { width: 390, height: 844 } });

async function open(page: Page, story: string, ready: string) {
  await standInFaces(page.context());
  await page.goto(`/?fixture=boards&story=${story}`);
  await expect(page.locator(ready).first()).toBeVisible();
  await loadFaces(page);
}

/** The vertical middle of each part of a row's counts, for the rows of a list (an index's board or a board's thread). */
const middles = (page: Page, row: string, parts: readonly string[]) => page.evaluate(([rowSel, sels]) => [...document.querySelectorAll(rowSel!)].map((r) => (sels as string[]).map((s) => {
  const b = r.querySelector(s)?.getBoundingClientRect();
  return b ? Math.round(b.y + b.height / 2) : null;
})), [row, parts] as const);

const sameLine = (rows: (number | null)[][]) => rows.map((ys) => Math.max(...(ys as number[])) - Math.min(...(ys as number[])));

test('a thread row\'s replies, views and last post share one line at 390', async ({ page }) => {
  await open(page, 'boards-02-board--board', '.kb-thread-row');
  const rows = await middles(page, '.kb-thread-row', ['.kb-thread-replies', '.kb-thread-views', '.kb-thread-last .kb-who']);
  expect(rows.length).toBeGreaterThan(2);
  for (const ys of rows) expect(ys.every((y) => y !== null)).toBe(true);
  /* Within a line's own height: the counts are 13.75px type, the last post's name a 24px target. */
  for (const spread of sameLine(rows)) expect(spread).toBeLessThanOrEqual(12);
});

test('the date of a thread row\'s last post never breaks across lines', async ({ page }) => {
  await open(page, 'boards-02-board--board', '.kb-thread-row');
  const lines = await page.evaluate(() => [...document.querySelectorAll('.kb-thread-last-link')].map((a) => a.getClientRects().length));
  expect(lines.length).toBeGreaterThan(2);
  expect(lines.every((n) => n === 1)).toBe(true);
});

test('the index\'s threads and last post share one line at 390', async ({ page }) => {
  await open(page, 'boards-01-index--index', '.kb-board-row');
  const rows = await page.evaluate(() => [...document.querySelectorAll('.kb-board-row:not([data-kb-system])')].map((r) => ['.kb-board-threads', '.kb-board-last .kb-who'].map((s) => {
    const b = r.querySelector(s)?.getBoundingClientRect();
    return b ? Math.round(b.y + b.height / 2) : null;
  })));
  expect(rows.length).toBeGreaterThan(0);
  for (const ys of rows) expect(ys.every((y) => y !== null)).toBe(true);
  for (const spread of sameLine(rows)) expect(spread).toBeLessThanOrEqual(12);
});

test('a record row\'s date stacks above its words, and the six kinds fit one row, at 390', async ({ page }) => {
  await open(page, 'boards-10-record--record', '.kb-record-table td');
  const rows = await page.evaluate(() => [...document.querySelectorAll('.kb-record-table tbody tr')].map((r) => {
    const [when, what] = [...r.querySelectorAll('td')].map((c) => c.getBoundingClientRect());
    return { whenBottom: when!.bottom, whatTop: what!.top, whenLeft: when!.left, whatLeft: what!.left };
  }));
  expect(rows.length).toBeGreaterThan(1);
  for (const r of rows) {
    expect(r.whatTop, 'the words start under the date').toBeGreaterThanOrEqual(r.whenBottom - 1);
    expect(Math.abs(r.whenLeft - r.whatLeft)).toBeLessThanOrEqual(1);
  }
  const kinds = await page.evaluate(() => [...document.querySelectorAll('.kb-record-kind')].map((k) => Math.round(k.getBoundingClientRect().y)));
  expect(kinds).toHaveLength(6);
  expect(new Set(kinds).size).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('poison: counts that each take a line are named as not sharing one', async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '.kb-thread-replies, .kb-thread-views, .kb-thread-last { display: block !important }';
      document.head.append(style);
    });
  });
  await open(page, 'boards-02-board--board', '.kb-thread-row');
  const rows = await middles(page, '.kb-thread-row', ['.kb-thread-replies', '.kb-thread-views', '.kb-thread-last .kb-who']);
  expect(sameLine(rows).some((spread) => spread > 12)).toBe(true);
});
