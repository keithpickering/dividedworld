import { expect, test, type Page } from '@playwright/test';
import { loadFaces } from './fonts.ts';
import { standInFaces } from './board-snapshot.ts';
import { START } from '../engine/ui/data/fake.ts';

/**
 * The index's and a board's rows in a browser (docs/plans/2026-11-12-list-rows-design.md, sections 2.1 to 2.3; the plan's Task 3).
 *
 * On a desktop every cell of a row stands on the title's baseline, not its top (2.3): a count and the last post's first line share the title's
 * baseline within half a pixel, and a spun thread's "↳ spun from" has a line of its own under the title (2.2). On a phone the counts share a line
 * and the last post is on the next (2.1), whole, with no line ending on a "·" or a comma. The baseline of an element is read by putting a
 * zero-size inline-block at the end of its text and taking its bottom (`baselines` below, written once): an inline-block with no height sits on the
 * baseline of its line. The two poisons each inject the CSS that undoes one rule and expect its measure to name it.
 *
 * The stories: `Boards/02 Board` (the thread list), `Boards/02 Board/Spun` (a spun thread with one reply from a long name, and a newest thread
 * with a long title) and `Boards/01 Index`, `LongTitle` (a board whose latest thread has a long title and whose last poster has a long name).
 */
test.use({ reducedMotion: 'reduce', bypassCSP: true });

const BOARD = 'boards-02-board--board';
const SPUN = 'boards-02-board--spun';
const INDEX = 'boards-01-index--index';
const LONG = 'boards-01-index--long-title';

async function open(page: Page, story: string, ready: string, size: { width: number; height: number }) {
  await standInFaces(page.context());
  await page.context().clock.setFixedTime(START);
  await page.setViewportSize(size);
  await page.goto(`/?fixture=boards&story=${story}`);
  await expect(page.locator(ready).first()).toBeVisible();
  await loadFaces(page);
}

/**
 * The baseline of the first text inside each part of each row, for the rows `row` selects (null where a part is missing or has no text). The
 * text is wrapped in a span (a flex item stays one) holding the probe, so the probe is inline in the text's own line, and put back after.
 */
const baselines = (page: Page, row: string, parts: readonly string[]) => page.evaluate(([rowSel, sels]) => {
  const probe = (el: Element): number | null => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim()) continue;
      const parent = node.parentNode!;
      const wrap = document.createElement('span');
      const dot = document.createElement('span');
      dot.style.cssText = 'display:inline-block;width:0;height:0';
      parent.insertBefore(wrap, node);
      wrap.append(node, dot);
      const y = dot.getBoundingClientRect().bottom;
      parent.insertBefore(node, wrap);
      wrap.remove();
      return y;
    }
    return null;
  };
  return [...document.querySelectorAll(rowSel!)].map((r) => (sels as string[]).map((s) => { const e = r.querySelector(s); return e ? probe(e) : null; }));
}, [row, parts] as const);

/** How far a thread row is past the case-1 tolerance: its title, replies, views and last post's name within half a pixel of one baseline. */
const pastCase1 = (rows: (number | null)[][]) => rows.map(([title, replies, views, name]) => Math.max(title!, replies!, views!, name!) - Math.min(title!, replies!, views!, name!) - 0.5);

const spreads = (rows: (number | null)[][]) => rows.map((ys) => Math.max(...(ys as number[])) - Math.min(...(ys as number[])));
const complete = (rows: (number | null)[][]) => rows.every((ys) => ys.every((y) => y !== null));

type Rect = { top: number; bottom: number; left: number; right: number };
const rectOf = (page: Page, row: string, part: string): Promise<(Rect | null)[]> => page.evaluate(([rowSel, sel]) => [...document.querySelectorAll(rowSel!)].map((r) => {
  const e = r.querySelector(sel!);
  if (!e) return null;
  const b = e.getBoundingClientRect();
  return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
}), [row, part] as const);

/** The index's last post with a title cut to leave the unit part of a line (see below): where the byline's "·", name and date stand against the title's last line, and whether the list scrolls sideways. An inline byline lets them flow on after the title and break apart; an inline-block one moves whole. */
const byline = (page: Page) => page.evaluate(() => {
  const by = document.querySelector('.kb-board-last-by')!;
  const title = document.querySelector('.kb-board-last-title') as HTMLElement;
  const cell = by.closest('td')!.getBoundingClientRect();
  const partsOf = () => [by.querySelector('.kb-board-sep'), by.querySelector('.kb-who'), by.querySelector('a:not(.kb-who a)')].map((e) => e!.getBoundingClientRect());
  /* The title is cut to the words that leave the unit's line no room for the whole of it, but room for its "·": the unit must move whole, where an inline one would break after the "·". */
  const unit = partsOf().reduce((sum, r) => sum + r.width, 0);
  title.textContent = 'w';
  for (let i = 0; i < 60 && cell.right - title.getBoundingClientRect().right > unit - 40; i++) title.textContent += ' word';
  const tr = [...title.getClientRects()];
  const parts = partsOf();
  const middles = parts.map((r) => r.top + r.height / 2);
  const list = document.querySelector('.kb-board-list')!;
  return { parts: parts.length, room: cell.right - title.getBoundingClientRect().right, unit, spread: Math.max(...middles) - Math.min(...middles), firstTop: Math.min(...parts.map((r) => r.top)), titleBottom: tr[tr.length - 1]!.bottom, listScroll: list.scrollWidth - list.clientWidth, pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});

const DESK = { width: 1440, height: 1000 };
const THREAD_PARTS = ['.kb-thread-title b', '.kb-thread-replies > .kb-num', '.kb-thread-views > .kb-num', '.kb-thread-last .kb-who a'] as const;
const BOARD_PARTS = ['.kb-board-link b', '.kb-board-threads > .kb-num', '.kb-board-last-title'] as const;

test('1: a thread row\'s title, replies, views and last post share a baseline at 1440', async ({ page }) => {
  await open(page, BOARD, '.kb-thread-row', DESK);
  const rows = await baselines(page, '.kb-thread-row', THREAD_PARTS);
  expect(rows.length).toBeGreaterThan(2);
  expect(complete(rows)).toBe(true);
  for (const past of pastCase1(rows)) expect(past, `the baselines of one row: ${JSON.stringify(rows)}`).toBeLessThanOrEqual(0);
});

test('2: a board row\'s name, threads and last post\'s first line share a baseline at 1440', async ({ page }) => {
  await open(page, INDEX, '.kb-board-row', DESK);
  const rows = (await baselines(page, '.kb-board-row', BOARD_PARTS)).filter((ys) => ys[2] !== null);
  expect(rows.length).toBeGreaterThan(0);
  expect(complete(rows)).toBe(true);
  for (const spread of spreads(rows)) expect(spread, `the baselines of one row: ${JSON.stringify(rows)}`).toBeLessThanOrEqual(0.5);
});

test('3: a spun thread\'s origin has a line of its own under its title, at its left, at 1440', async ({ page }) => {
  await open(page, SPUN, '.kb-thread-spun', DESK);
  const spun = await rectOf(page, '.kb-thread-row:has(.kb-thread-spun)', '.kb-thread-spun');
  const title = await rectOf(page, '.kb-thread-row:has(.kb-thread-spun)', '.kb-thread-title');
  expect(spun.length).toBeGreaterThan(0);
  spun.forEach((s, i) => {
    expect(s!.top, 'under the title').toBeGreaterThanOrEqual(title[i]!.bottom - 0.5);
    expect(Math.abs(s!.left - title[i]!.left), 'at the title\'s left edge').toBeLessThanOrEqual(1);
  });
});

/** A thread row's phone measures: the units' baselines, and where the last post stands against the counts. */
const threadPhone = async (page: Page) => {
  const units = await baselines(page, '.kb-thread-row', ['.kb-thread-replies .kb-thread-unit', '.kb-thread-views .kb-thread-unit']);
  const replies = await rectOf(page, '.kb-thread-row', '.kb-thread-replies');
  const views = await rectOf(page, '.kb-thread-row', '.kb-thread-views');
  const last = await rectOf(page, '.kb-thread-row', '.kb-thread-last');
  const lines = await page.evaluate(() => [...document.querySelectorAll('.kb-thread-row')].map((r) => ['.kb-thread-last-label', '.kb-thread-last .kb-who', '.kb-thread-last-link'].map((s) => {
    const b = r.querySelector(s)?.getBoundingClientRect();
    return b ? b.top + b.height / 2 : null;
  })));
  return { units, replies, views, last, lines };
};
/** The first gap of each case-4 assertion, so a poison names the same measure the case holds. */
const belowCounts = (m: Awaited<ReturnType<typeof threadPhone>>) => m.last.map((l, i) => l!.top - Math.max(m.replies[i]!.bottom, m.views[i]!.bottom));

for (const size of [{ width: 390, height: 844 }, { width: 360, height: 800 }]) {
  const at = `at ${size.width}`;

  test(`4: a thread row's units share a baseline, its last post is on the next line, whole, ${at}`, async ({ page }) => {
    await open(page, BOARD, '.kb-thread-row', size);
    const m = await threadPhone(page);
    expect(m.units.length).toBeGreaterThan(2);
    expect(complete(m.units)).toBe(true);
    for (const s of spreads(m.units)) expect(s, 'replies and views on one baseline').toBeLessThanOrEqual(0.5);
    for (const gap of belowCounts(m)) expect(gap, 'the last post at or below the counts').toBeGreaterThanOrEqual(-0.5);
    for (const ys of m.lines) {
      expect(ys.every((y) => y !== null)).toBe(true);
      expect(Math.max(...(ys as number[])) - Math.min(...(ys as number[])), '"last:", the name and the date on one line').toBeLessThanOrEqual(12);
    }
  });

  test(`5: a board row's last post is under its threads, at the row's left edge, starting "last:" ${at}`, async ({ page }) => {
    await open(page, INDEX, '.kb-board-row', size);
    const threads = await rectOf(page, '.kb-board-row:not([data-kb-system])', '.kb-board-threads');
    const last = await rectOf(page, '.kb-board-row:not([data-kb-system])', '.kb-board-last');
    const name = await rectOf(page, '.kb-board-row:not([data-kb-system])', '.kb-board-link');
    const label = await page.evaluate(() => [...document.querySelectorAll('.kb-board-row:not([data-kb-system])')].map((r) => {
      const l = r.querySelector('.kb-board-last-label')!;
      return { text: l.textContent, left: l.getBoundingClientRect().left, first: r.querySelector('.kb-board-last')!.textContent!.trimStart().startsWith('last:') };
    }));
    expect(last.length).toBeGreaterThan(0);
    last.forEach((l, i) => {
      expect(l!.top, 'under the threads').toBeGreaterThanOrEqual(threads[i]!.bottom - 0.5);
      expect(Math.abs(label[i]!.left - name[i]!.left), 'the words start at the row\'s left edge').toBeLessThanOrEqual(1);
      expect(label[i]!.first, 'the cell starts with "last:"').toBe(true);
    });
  });

  /* A visible separator ends no line: the next visible thing after it begins on the separator's own line. */
  for (const [story, ready, label] of [[BOARD, '.kb-thread-row', 'a thread list'], [SPUN, '.kb-thread-spun', 'the spun list'], [INDEX, '.kb-board-row', 'the index'], [LONG, '.kb-board-last-title', 'the long-titled index']] as const) {
    test(`6: no line of ${label} ends in "·" or "," ${at}`, async ({ page }) => {
      await open(page, story, ready, size);
      const stray = await page.evaluate(() => {
        const out: string[] = [];
        for (const sep of document.querySelectorAll('.kb-thread-sep, .kb-board-sep')) {
          const rects = sep.getClientRects();
          if (rects.length === 0) continue;
          let next: Element | null = sep.nextElementSibling;
          while (next && getComputedStyle(next).display === 'none') next = next.nextElementSibling;
          if (!next) { out.push(`${sep.textContent} has nothing after it`); continue; }
          const a = rects[rects.length - 1]!;
          const b = next.getClientRects()[0]!;
          if (b.top > a.bottom - 1) out.push(`"${sep.textContent!.trim()}" ends a line, before ${next.className || next.tagName}`);
        }
        return out;
      });
      expect(stray).toEqual([]);
    });
  }

  test(`7: a title that leaves the byline part of a line moves it whole to the next, and the list stays inside the window ${at}`, async ({ page }) => {
    await open(page, LONG, '.kb-board-last-title', size);
    const m = await byline(page);
    expect(m.parts, 'the "·", the name and the date').toBe(3);
    expect(m.spread, 'the "·", the name and the date on one line').toBeLessThanOrEqual(12);
    expect(m.firstTop, 'the unit starts under the title\'s last line').toBeGreaterThanOrEqual(m.titleBottom - 0.5);
    expect(m.listScroll).toBeLessThanOrEqual(0);
    expect(m.pageScroll).toBeLessThanOrEqual(0);
  });
}

test('poison: top-aligned cells are named as off the title\'s baseline (case 1)', async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '.kb-thread-row > td { vertical-align: top !important }';
      document.head.append(style);
    });
  });
  await open(page, BOARD, '.kb-thread-row', DESK);
  const rows = await baselines(page, '.kb-thread-row', THREAD_PARTS);
  expect(pastCase1(rows).some((past) => past > 0)).toBe(true);
});

test('poison: a byline that flows on after the title is named as breaking apart (case 7)', async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '.kb-board-last-by { display: inline !important }';
      document.head.append(style);
    });
  });
  await open(page, LONG, '.kb-board-last-title', { width: 390, height: 844 });
  const m = await byline(page);
  expect(m.spread > 12 || m.firstTop < m.titleBottom - 0.5).toBe(true);
});

test('poison: a last post that goes back inline is named as not below the counts (case 4)', async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '.kb-thread-last { display: inline !important }';
      document.head.append(style);
    });
  });
  await open(page, BOARD, '.kb-thread-row', { width: 390, height: 844 });
  expect(belowCounts(await threadPhone(page)).some((gap) => gap < -0.5)).toBe(true);
});
