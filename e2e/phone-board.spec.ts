import { expect, test, type Page } from '@playwright/test';
import { loadFaces } from './fonts.ts';
import { standInFaces } from './board-snapshot.ts';
import { START } from '../engine/ui/data/fake.ts';

/**
 * The board look's phone (the plan's Task 8, docs/research/2026-11-06-board-look/03-phone.html): at 390 a thread row's counts, and the
 * index's, fold into one line ("169 replies · 4 views · last: Pipewrench, Oct 5"), where each took a line before, and a date never breaks
 * across two. The poison puts the counts back on a line each.
 */
test.use({ reducedMotion: 'reduce', bypassCSP: true, viewport: { width: 390, height: 844 } });

/** The browser's clock is the fixture's own moment (engine/ui/data/fake.ts START), so "this year" is 2026 whatever day the suite runs. */
async function open(page: Page, story: string, ready: string, now: number = START, query = 'story') {
  await standInFaces(page.context());
  await page.context().clock.setFixedTime(now);
  await page.goto(`/?fixture=boards&${query}=${story}`);
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

/** The record's six kinds are small Chrome buttons: each a 24px target (WCAG 2.5.8) on one line of words, the six on one row at 390 (two rows at 320, where they cannot fit one) and the page does not scroll sideways. */
for (const width of [320, 390]) {
  test(`the record's six kinds are 24px targets on one row without sideways scroll at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await open(page, 'boards-10-record--record', '.kb-record-kind');
    const kinds = await page.evaluate(() => [...document.querySelectorAll('.kb-record-kind')].map((k) => { const b = k.getBoundingClientRect(); return { y: Math.round(b.y), width: b.width, height: b.height, right: b.right }; }));
    expect(kinds).toHaveLength(6);
    expect(new Set(kinds.map((k) => k.y)).size, width === 390 ? 'one row' : 'at most two rows').toBeLessThanOrEqual(width === 390 ? 1 : 2);
    for (const k of kinds) {
      expect(k.height, 'a target at least 24px tall').toBeGreaterThanOrEqual(24);
      expect(k.height, `one line of words, not two (${Math.round(k.height)}px)`).toBeLessThan(32);
      expect(k.width, 'a target at least 24px wide').toBeGreaterThanOrEqual(24);
      expect(k.right, 'inside the window').toBeLessThanOrEqual(width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test('the record table carries its roles as attributes under the phone layout at 390', async ({ page }) => {
  await open(page, 'boards-10-record--record', '.kb-record-table td');
  /* Chromium keeps table semantics under display:grid, so the accessibility tree cannot tell; the role attributes are what the phone layout needs. */
  const layout = await page.evaluate(() => {
    const t = document.querySelector('.kb-record-table')!;
    return { table: getComputedStyle(t).display, tr: getComputedStyle(t.querySelector('tbody tr')!).display };
  });
  expect(layout, 'the phone layout is active').toEqual({ table: 'grid', tr: 'block' });
  const pairs = [['table', 'table[role=table]'], ['thead', 'thead[role=rowgroup]'], ['tbody', 'tbody[role=rowgroup]'], ['tr', 'tr[role=row]'], ['th', 'th[role=columnheader]'], ['td', 'td[role=cell]']] as const;
  const counts = await page.evaluate((ps) => ps.map(([bare, withRole]) => [bare, document.querySelectorAll(`.kb-record-table ${bare}`).length + (bare === 'table' ? document.querySelectorAll('table.kb-record-table').length : 0), document.querySelectorAll(withRole === 'table[role=table]' ? 'table.kb-record-table[role=table]' : `.kb-record-table ${withRole}`).length]), pairs);
  for (const [bare, n, withRole] of counts) {
    expect(n, `${bare} elements in the record table`).toBeGreaterThan(0);
    expect(withRole, `${bare} elements carrying their role`).toBe(n);
  }
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

/** The reply box's pieces at 390: the thread, the 01-main moment, whose last post stands over the box. */
const openReply = async (page: Page) => {
  await open(page, '01-main', '.kb-toolbar', START, 'moment');
  await page.locator('.kb-toolbar').scrollIntoViewIfNeeded();
};
const toolbarYs = (page: Page) => page.locator('.kb-toolbar .kb-toolbar-button').evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().y)));

test('the formatting toolbar\'s nine buttons share one row and the page does not scroll sideways at 390', async ({ page }) => {
  await openReply(page);
  const ys = await toolbarYs(page);
  expect(ys).toHaveLength(9);
  expect(new Set(ys).size, `the buttons stand at ${ys.join(', ')}`).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('the keyboard hint is dropped on a phone and still describes the box', async ({ page }) => {
  await openReply(page);
  const hint = page.locator('.kb-editor-hint').first();
  await expect(hint).toHaveCSS('display', 'none');
  const id = await hint.getAttribute('id');
  expect(id).toBeTruthy();
  expect((await page.locator('textarea[aria-describedby]').first().getAttribute('aria-describedby'))!.split(' ')).toContain(id);
});

test('poison: buttons that wrap, and a hint that shows, are named', async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '.kb-toolbar { flex-wrap: wrap !important } .kb-toolbar .kb-toolbar-button { min-width: 80px !important } .kb-editor-hint { display: block !important }';
      document.head.append(style);
    });
  });
  await openReply(page);
  expect(new Set(await toolbarYs(page)).size).toBeGreaterThan(1);
  await expect(page.locator('.kb-editor-hint').first()).toHaveCSS('display', 'block');
});

/* The year-dropping reads the clock, so the suite pins it (the fixture's own moment); with the clock in 2027 the same date reads with its year. */
const POST_41_WHEN = (page: Page) => page.getByText(/^Oct 29, (2026, )?9:14 PM$/).first();

test('with the clock pinned to the fixture\'s moment, post 41\'s date drops its year', async ({ page }) => {
  await open(page, '01-main', '.kb-postbit', START, 'moment');
  await expect(POST_41_WHEN(page)).toHaveText('Oct 29, 9:14 PM');
});

test('with the clock in 2027, post 41\'s date reads with its year (the pin is what holds the board match)', async ({ page }) => {
  await open(page, '01-main', '.kb-postbit', Date.UTC(2027, 0, 5, 12), 'moment');
  await expect(POST_41_WHEN(page)).toHaveText('Oct 29, 2026, 9:14 PM');
});

test('the move notice\'s Way out keeps a 24px target, clear of the band\'s words and with no divider of its own, at 390', async ({ page }) => {
  await open(page, 'boards-11-move-notice--move-notice', '.kb-move-way');
  const m = await page.evaluate(() => {
    const way = document.querySelector('.kb-move-way')!;
    const w = way.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('.kb-move-notice .kb-bar')!);
    const text = range.getBoundingClientRect();
    return { w: w.width, h: w.height, wayBottom: w.bottom, textTop: text.top, border: getComputedStyle(way).borderLeftWidth };
  });
  expect(m.w).toBeGreaterThanOrEqual(24);
  expect(m.h).toBeGreaterThanOrEqual(24);
  expect(m.wayBottom).toBeLessThanOrEqual(m.textTop);
  /* Way out can wrap under the label here, where a rule at its start would divide nothing from nothing: the phone draws none. */
  expect(m.border).toBe('0px');
});
