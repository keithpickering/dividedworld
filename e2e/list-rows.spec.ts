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
  /* The name may be wider than the row and wrap in its box: the "·" shares the line of the name's first line, whatever the name's box (its last line is where the date may stand). */
  const nameFirstLine = () => { const range = document.createRange(); range.selectNodeContents(by.querySelector('.kb-who a')!); return range.getClientRects()[0]!; };
  /* The title is cut to the words that leave the unit's line no room for the whole of it, but room for its "·": the unit must move whole, where an inline one would break after the "·". */
  const unit = partsOf().reduce((sum, r) => sum + r.width, 0);
  title.textContent = 'w';
  for (let i = 0; i < 60 && cell.right - title.getBoundingClientRect().right > unit - 40; i++) title.textContent += ' word';
  const tr = [...title.getClientRects()];
  const parts = partsOf();
  const first = nameFirstLine();
  const middles = [parts[0]!, first].map((r) => r.top + r.height / 2);
  const list = document.querySelector('.kb-board-list')!;
  return { parts: parts.length, dateTop: parts[2]!.top, nameFirstTop: first.top, room: cell.right - title.getBoundingClientRect().right, unit, spread: Math.max(...middles) - Math.min(...middles), firstTop: Math.min(...parts.map((r) => r.top)), titleBottom: tr[tr.length - 1]!.bottom, listScroll: list.scrollWidth - list.clientWidth, pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth };
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

  test(`7: a title that leaves the byline part of a line moves it whole to the next, its "·" with the name's first line, and the list stays inside the window ${at}`, async ({ page }) => {
    await open(page, LONG, '.kb-board-last-title', size);
    const m = await byline(page);
    expect(m.parts, 'the "·", the name and the date').toBe(3);
    expect(m.spread, 'the "·" and the first line of the name on one line').toBeLessThanOrEqual(12);
    expect(m.dateTop, 'the date no higher than the name\'s first line').toBeGreaterThanOrEqual(m.nameFirstTop - 0.5);
    expect(m.firstTop, 'the unit starts under the title\'s last line').toBeGreaterThanOrEqual(m.titleBottom - 0.5);
    expect(m.listScroll).toBeLessThanOrEqual(0);
    expect(m.pageScroll).toBeLessThanOrEqual(0);
  });
}

/*
 * A thread row's last post as one unit (docs/plans/2026-11-13-last-post-unit-and-instant-clear-plan.md, Task 1; #554). On a phone the unit is "[avatar] name, date":
 * where the name and the date share a line the comma is painted between them; where the date has a line of its own the comma is not painted (it is hung left of the
 * unit, outside its clip), so no line ends on a comma or starts with one. Where the unit's parts fit the row it moves whole, name and date on one line. The rows are
 * read at 390 and 360 wide and at text sizes 100, 125 and 200, on the board and on the spun story (whose long name wraps in its box at 100%).
 */
const SIZES = ['100', '125', '200'] as const;
const PHONES = [{ width: 390, height: 844 }, { width: 360, height: 800 }] as const;

async function setTextSize(page: Page, size: string) {
  await page.evaluate((sz) => document.documentElement.setAttribute('data-kb-text-size', sz), size);
  await page.evaluate(() => document.fonts.ready.then(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))));
}

type Box = { top: number; bottom: number; left: number; right: number };
type LastRow = { title: string; unit: Box; name: Box; sep: Box | null; date: Box; label: Box; sharesLine: boolean };

/**
 * The selectors of a list's last post, so the thread list's and the index's are read by one set of measures: a row, its title, the cell, the unit, the name's box, the comma and the date's link.
 * `sep` may match more than one element (the index's cell has the "·" and the comma): the last one is the comma.
 */
type Last = { row: string; title: string; cell: string; unit: string; name: string; sep: string; date: string; label: string; list: string };
const THREAD_LAST: Last = { row: '.kb-thread-row', title: '.kb-thread-title', cell: '.kb-thread-last', unit: '.kb-thread-last-by', name: '.kb-thread-last .kb-who', sep: '.kb-thread-last .kb-thread-sep', date: '.kb-thread-last-link', label: '.kb-thread-last-label', list: '.kb-thread-list' };
const INDEX_LAST: Last = { row: '.kb-board-row:has(.kb-board-last-by)', title: '.kb-board-link', cell: '.kb-board-last', unit: '.kb-board-last-by', name: '.kb-board-last .kb-who', sep: '.kb-board-last .kb-board-sep', date: '.kb-board-last-when a', label: '.kb-board-last-label', list: '.kb-board-list' };

/** Each row's last post: the unit (the cell, where a build has no unit), the name's box, the comma's last box, the date's link, and whether the name and the date share a line. */
const lastPosts = (page: Page, l: Last = THREAD_LAST): Promise<LastRow[]> => page.evaluate((sel) => {
  const box = (e: Element | null | undefined) => { if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
  return [...document.querySelectorAll(sel.row)].map((r) => {
    const cell = r.querySelector(sel.cell)!;
    const sepRects = [...([...r.querySelectorAll(sel.sep)].pop()?.getClientRects() ?? [])];
    const sep = sepRects.length ? sepRects[sepRects.length - 1]! : null;
    const name = box(r.querySelector(sel.name))!;
    const date = box(r.querySelector(sel.date))!;
    return {
      title: r.querySelector(sel.title)?.textContent ?? '',
      unit: box(r.querySelector(sel.unit) ?? cell)!,
      name, date, label: box(r.querySelector(sel.label))!,
      sep: sep && { top: sep.top, bottom: sep.bottom, left: sep.left, right: sep.right },
      sharesLine: date.top < name.bottom - 2,
    };
  });
}, l);

/** The ring's room (2px outline and 2px offset): the comma's box ends at least this far left of the date; the clip itself is at the box's own gap (0.5em, 6px at the least), clear of the ring. */
const RING = 4;

/** What a row's comma does against case 6b: painted between the name and the date on their line, or not painted (wholly left of the unit's clip) where the date has a line of its own. */
const commaFaults = (rows: LastRow[]): string[] => rows.flatMap((r) => {
  if (r.sharesLine) {
    const between = r.sep !== null && r.sep.left >= r.name.right - 0.5 && r.sep.right <= r.date.left + 0.5 && r.sep.left >= r.unit.left - 0.5 && Math.abs((r.sep.top + r.sep.bottom) / 2 - (r.date.top + r.date.bottom) / 2) <= 12;
    return between ? [] : [`${r.title}: name and date share a line, the comma is not painted between them`];
  }
  const out: string[] = [];
  if (r.sep !== null && r.sep.right > r.unit.left - RING + 0.5) out.push(`${r.title}: the date has a line of its own and the comma is painted (ends a line or starts one)`);
  if (Math.abs(r.date.left - r.unit.left) > 1) out.push(`${r.title}: the date's link starts ${r.date.left - r.unit.left}px from the unit's left edge`);
  return out;
});

/**
 * What is painted where the comma's box is, for the rows where the date has a line of its own: the strip the comma's last box occupies is screenshotted as it is and again with the
 * comma made invisible (layout unchanged); a comma that paints there makes the two differ. Whatever else legitimately paints in the strip (a cell's border) is in both.
 */
const paintedCommas = async (page: Page, l: Last = THREAD_LAST): Promise<string[]> => {
  const rows = await lastPosts(page, l);
  const out: string[] = [];
  for (const [i, r] of rows.entries()) {
    if (r.sharesLine || r.sep === null) continue;
    const row = page.locator(l.row).nth(i);
    await row.locator(l.date).first().evaluate((e) => e.scrollIntoView({ block: 'center' }));
    const strip = await row.evaluate((rowEl, sepSel) => {
      const rects = [...[...rowEl.querySelectorAll(sepSel)].pop()!.getClientRects()];
      const b = rects[rects.length - 1]!;
      return { x: Math.floor(b.left), y: Math.floor(b.top), width: Math.ceil(b.right) - Math.floor(b.left), height: Math.ceil(b.bottom) - Math.floor(b.top) };
    }, l.sep);
    const clip = { x: Math.max(0, strip.x), y: strip.y, width: strip.width + Math.min(0, strip.x), height: strip.height };
    /* A strip with no size, or below the window, would be shot the same twice and pass for the wrong reason. */
    const view = page.viewportSize()!;
    if (clip.width <= 0 || clip.height <= 0 || clip.y < 0 || clip.y + clip.height > view.height || clip.x + clip.width > view.width) { out.push(`${r.title}: the comma's strip is not in the window (${JSON.stringify(clip)})`); continue; }
    const shown = await page.screenshot({ clip });
    await row.locator(l.sep).last().evaluate((e) => { (e as HTMLElement).style.visibility = 'hidden'; });
    const hidden = await page.screenshot({ clip });
    await row.locator(l.sep).last().evaluate((e) => { (e as HTMLElement).style.visibility = ''; });
    if (!shown.equals(hidden)) out.push(`${r.title}: the comma paints left of the date, which starts a line`);
  }
  return out;
};

/** Case 6c: the name and the date on one line (middles within 12px), where the unit's parts fit the row's width. */
const wholeFaults = (rows: LastRow[]): string[] => rows.flatMap((r) => (
  Math.abs((r.name.top + r.name.bottom) / 2 - (r.date.top + r.date.bottom) / 2) <= 12 ? [] : [`${r.title}: the date is not on the name's line`]));

const scrolls = (page: Page, l: Last = THREAD_LAST) => page.evaluate((listSel) => {
  const list = document.querySelector(listSel)!;
  return { list: list.scrollWidth - list.clientWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
}, l.list);

for (const [story, label] of [[BOARD, 'the thread list'], [SPUN, 'the spun list']] as const) {
  for (const size of PHONES) {
    for (const text of SIZES) {
      test(`6b: no comma ends or starts a line in ${label}, and the list stays inside the window, at ${size.width}, text ${text}%`, async ({ page }) => {
        await open(page, story, '.kb-thread-row', size);
        await setTextSize(page, text);
        const rows = await lastPosts(page);
        expect(rows.length).toBeGreaterThan(2);
        expect(commaFaults(rows)).toEqual([]);
        expect(await paintedCommas(page)).toEqual([]);
        const s = await scrolls(page);
        expect(s.list).toBeLessThanOrEqual(0);
        expect(s.page).toBeLessThanOrEqual(0);
      });
    }
  }
}

/* The board's names are short: at 125% on 360 the unit is narrower than the row, so it moves whole to the line after "last:", name and date together. */
test('6c: where the unit fits the row, the name and the date are on one line, at 360, text 125%', async ({ page }) => {
  await open(page, BOARD, '.kb-thread-row', { width: 360, height: 800 });
  await setTextSize(page, '125');
  const rows = await lastPosts(page);
  expect(rows.length).toBeGreaterThan(2);
  expect(wholeFaults(rows)).toEqual([]);
  for (const r of rows) expect((r.name.top + r.name.bottom) / 2, 'the unit at or below the "last:" line').toBeGreaterThanOrEqual((r.label.top + r.label.bottom) / 2 - 0.5);
});

/** The ring of the focused element is the color `--kb-focus` on every side: some pixel in the 2px band, 2 to 4px outside the box, is that color at the middle of each side. */
const ringSides = async (page: Page, link: ReturnType<Page['locator']>) => {
  /* Centered, clear of the dock at the window's foot. */
  await link.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await page.keyboard.press('Shift');
  await link.focus();
  const b = (await link.boundingBox())!;
  const color = await link.evaluate((e) => getComputedStyle(e).outlineColor);
  const pad = 8;
  const clip = { x: Math.max(0, Math.floor(b.x) - pad), y: Math.max(0, Math.floor(b.y) - pad), width: Math.ceil(b.width) + 2 * pad, height: Math.ceil(b.height) + 2 * pad };
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(async ([data, want, box, c]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const rgb = want!.match(/\d+/gu)!.map(Number);
    const at = (x: number, y: number) => { const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data; return Math.max(Math.abs(d[0]! - rgb[0]!), Math.abs(d[1]! - rgb[1]!), Math.abs(d[2]! - rgb[2]!)) <= 24; };
    const bx = box!.x - c!.x, by = box!.y - c!.y, cx = bx + box!.width / 2, cy = by + box!.height / 2;
    const band = [2.5, 3, 3.5];
    return {
      left: band.some((o) => at(bx - o, cy)), right: band.some((o) => at(bx + box!.width + o - 1, cy)),
      top: band.some((o) => at(cx, by - o)), bottom: band.some((o) => at(cx, by + box!.height + o - 1)),
    };
  }, [png, color, b, clip] as const);
};

for (const text of ['125', '200'] as const) {
  test(`6d: the focus ring of the last post's links is whole on four sides, at 360, text ${text}%`, async ({ page }) => {
    await open(page, SPUN, '.kb-thread-row', { width: 360, height: 800 });
    await setTextSize(page, text);
    const rows = await lastPosts(page);
    const starts = rows.map((r, i) => (r.sharesLine ? -1 : i)).filter((i) => i >= 0);
    const chosen = [...new Set([0, ...starts.slice(0, 3)])];
    expect(starts.length, `a row whose date starts a line at ${text}%, tested`).toBeGreaterThan(0);
    expect(chosen.length).toBeGreaterThan(0);
    for (const i of chosen) {
      const row = page.locator('.kb-thread-row').nth(i);
      for (const [what, link] of [['the date', row.locator('.kb-thread-last-link')], ['the name', row.locator('.kb-thread-last .kb-who a')]] as const) {
        const sides = await ringSides(page, link);
        expect(sides, `${what}'s ring in row ${i}`).toEqual({ left: true, right: true, top: true, bottom: true });
      }
    }
  });
}

/**
 * The index's last post (#550, docs/plans/2026-11-13-index-last-post-hung-separators-plan.md, Task 1): the same unit as a thread row's, with its "·" kept at the head of the name's first line.
 * 8a: no visible "·" is alone, the first line of the name's link shares its line. 8b: the comma is painted between the name and the date where they share a line, and not painted where the
 * date starts a line (the 6b measures, read with the index's selectors). 8c: the focus ring of the date where it starts a line, and of the name's link, is whole. The long-titled story's name
 * is wider than the row ("Sir Reginald Featherstonehaugh-Wetherby the Third"), so the rule is held for a name that does not fit.
 */
const INDEX_STORIES = [[INDEX, '.kb-board-row', 'the index'], [LONG, '.kb-board-last-title', 'the long-titled index']] as const;

/** Each visible "·" of a unit with the first line of the name's link: a "·" whose line the name's first line does not share is alone on its line. */
const dotFaults = (page: Page): Promise<string[]> => page.evaluate(() => {
  const out: string[] = [];
  for (const unit of document.querySelectorAll('.kb-board-last-by')) {
    const dot = unit.querySelector('.kb-board-last-who > .kb-board-sep');
    const alone = unit.querySelector('.kb-board-sep');
    const link = unit.querySelector('.kb-who a');
    if (!alone || alone.textContent!.trim() !== '·' || alone.getClientRects().length === 0) continue;
    const range = document.createRange();
    range.selectNodeContents(link!);
    const first = range.getClientRects()[0]!;
    const d = alone.getClientRects()[0]!;
    const name = link!.textContent;
    if (!(d.top < first.bottom - 2 && d.bottom > first.top + 2)) out.push(`the "·" is alone on a line before "${name}"${dot ? '' : ' (outside the first item)'}`);
  }
  return out;
});

for (const [story, ready, label] of INDEX_STORIES) {
  for (const size of PHONES) {
    for (const text of SIZES) {
      test(`8a: no "·" of ${label} is alone on a line, at ${size.width}, text ${text}%`, async ({ page }) => {
        await open(page, story, ready, size);
        await setTextSize(page, text);
        expect(await page.locator('.kb-board-last-by .kb-board-sep').count()).toBeGreaterThan(0);
        expect(await dotFaults(page)).toEqual([]);
      });

      test(`8b: no comma of ${label} ends or starts a line, and the list stays inside the window, at ${size.width}, text ${text}%`, async ({ page }) => {
        await open(page, story, ready, size);
        await setTextSize(page, text);
        const rows = await lastPosts(page, INDEX_LAST);
        expect(rows.length).toBeGreaterThan(0);
        expect(commaFaults(rows)).toEqual([]);
        expect(await paintedCommas(page, INDEX_LAST)).toEqual([]);
        const s = await scrolls(page, INDEX_LAST);
        expect(s.list).toBeLessThanOrEqual(0);
        expect(s.page).toBeLessThanOrEqual(0);
      });
    }
  }
}

for (const size of PHONES) {
  test(`8c: the focus ring of the index's last-post links is whole on four sides, at ${size.width}, text 200%`, async ({ page }) => {
    await open(page, LONG, '.kb-board-last-title', size);
    await setTextSize(page, '200');
    const rows = await lastPosts(page, INDEX_LAST);
    expect(rows.some((r) => !r.sharesLine), 'a row whose date starts a line at 200%, tested').toBe(true);
    for (const [i] of rows.entries()) {
      const row = page.locator(INDEX_LAST.row).nth(i);
      for (const [what, link] of [['the date', row.locator(INDEX_LAST.date)], ['the name', row.locator('.kb-board-last .kb-who a')]] as const) {
        const sides = await ringSides(page, link);
        expect(sides, `${what}'s ring in row ${i}`).toEqual({ left: true, right: true, top: true, bottom: true });
      }
    }
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
      style.textContent = '.kb-board-last-by { display: inline !important } .kb-board-last-who { display: inline !important } .kb-board-last-who > .kb-board-sep { white-space: normal !important }';
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

test('poison: a last-post unit that goes back inline is named as a comma ending a line or the date off the name\'s line (cases 6b, 6c)', async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '.kb-thread-last-by { display: inline !important }';
      document.head.append(style);
    });
  });
  await open(page, BOARD, '.kb-thread-row', { width: 360, height: 800 });
  await setTextSize(page, '125');
  const at125 = await lastPosts(page);
  await setTextSize(page, '200');
  const at200 = await lastPosts(page);
  expect(wholeFaults(at125).length + commaFaults(at125).length + commaFaults(at200).length).toBeGreaterThan(0);
});

test('poison: a unit with no clip is named as a comma painted left of the date (case 6b)', async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '.kb-thread-last-by { clip-path: none !important }';
      document.head.append(style);
    });
  });
  await open(page, SPUN, '.kb-thread-row', { width: 360, height: 800 });
  await setTextSize(page, '200');
  expect((await paintedCommas(page)).length).toBeGreaterThan(0);
});

test('poison: an index unit with no clip is named as a comma painted left of the date (case 8b)', async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '.kb-board-last-by { clip-path: none !important }';
      document.head.append(style);
    });
  });
  await open(page, LONG, '.kb-board-last-title', { width: 360, height: 800 });
  await setTextSize(page, '200');
  expect((await paintedCommas(page, INDEX_LAST)).length).toBeGreaterThan(0);
});

test('poison: an index unit back to the form on main (an inline-block, its first item inline, its "·" free to break) is named as a "·" alone on a line (case 8a)', async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '.kb-board-last-by { display: inline-block !important } .kb-board-last-who { display: inline !important } .kb-board-last-who > .kb-board-sep { white-space: normal !important }';
      document.head.append(style);
    });
  });
  await open(page, LONG, '.kb-board-last-title', { width: 390, height: 844 });
  expect((await dotFaults(page)).length).toBeGreaterThan(0);
});
