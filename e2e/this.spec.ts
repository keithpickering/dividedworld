import { expect, test, type Page } from '@playwright/test';
import { loadFaces } from './fonts.ts';
import { settled } from './settled.ts';
import type { E2eWindow } from './glass-screens.ts';
import { sideways } from './sideways.ts';

/**
 * THIS in a browser (docs/plans/2026-11-13-this-plan.md, Task 9): what jsdom cannot read, the note's place against the lines of the post's words.
 * The app (the e2e build's in-memory backend, `__kbFake`) is seeded with a post of one player's and THIS cast on it by another's; each test
 * then measures boxes the browser laid out, at 390 by 844 and at the desktop.
 */
test.use({ bypassCSP: true });

const SIZES = [{ name: 'a phone', width: 390, height: 844 }, { name: 'the desktop', width: 1280, height: 800 }] as const;

const BODY = [
  'Okay, hot take time. The physics in the original engine were never the problem. People blame the engine because it\'s easier than admitting their levels were bad.',
  'I played forty of the contest entries last weekend. The ones that felt good all used the default settings. Every single one.',
  'Anyway the new level editor is fine. Stop asking for slopes. That is all I have to say about it, and I will not be taking questions from the back.',
].join('\n\n');
const FIRST = 'People blame the engine because it\'s easier than admitting their levels were bad.';
const SECOND = 'Stop asking for slopes.';

interface Note { readonly phrase: string; readonly words?: string; readonly by?: 'spritey' | 'pipewrench' }
interface Card { readonly card: string; readonly config?: Record<string, unknown>; readonly by?: 'spritey' | 'pipewrench'; readonly layer?: number }
interface Seed { readonly filler?: number; readonly body?: string; readonly notes?: readonly Note[]; readonly cards?: readonly Card[]; readonly author?: 'hooligan' | 'other' }

/** Collects what must stay silent: a ResizeObserver complaint on the console or on the window, and any uncaught error. */
function listen(page: Page): { readonly problems: string[]; readonly origins: Set<string> } {
  const problems: string[] = [];
  const origins = new Set<string>();
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && /ResizeObserver/iu.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('request', (r) => { const u = new URL(r.url()); if (u.protocol === 'http:' || u.protocol === 'https:') origins.add(u.origin); });
  return { problems, origins };
}

async function open(page: Page, size: { width: number; height: number }, seed: Seed = {}): Promise<string> {
  await page.setViewportSize(size);
  await page.addInitScript(() => {
    const w = window as unknown as { __errs: string[] };
    w.__errs = [];
    window.addEventListener('error', (e) => w.__errs.push(e.message));
  });
  await page.goto('/b/general');
  await page.waitForFunction(() => '__kbFake' in globalThis);
  const thread = await page.evaluate((s) => {
    const w = globalThis as E2eWindow;
    const { characters } = w.__kbDemo;
    const fake = w.__kbFake;
    const who = (k: 'spritey' | 'pipewrench') => characters[k];
    const owner = fake.seed.account('someone-else', { seasoned: true });
    const other = fake.seed.character(owner, 'Gloomba', 'face');
    const author = s.author === 'other' ? other : characters.hooligan;
    const made = fake.seed.thread('general', author, 'The engine was never the problem', 'Okay, hot take time.');
    for (let i = 0; i < (s.filler ?? 0); i++) fake.seed.post(made.thread, author, Array.from({ length: 4 }, (_, k) => `Filler ${i}.${k}: ordinary words that take up a line or two of the page and no more than that.`).join('\n\n'));
    const post = fake.seed.post(made.thread, author, s.body ?? s.bodyDefault);
    (s.notes ?? []).forEach((n: Note, i: number) => fake.seed.card(who(n.by ?? 'spritey'), post, 'this', { layer: i + 1, live: true, config: { phrase: n.phrase, words: n.words ?? '' }, message: 'THIS' }));
    (s.cards ?? []).forEach((c: Card) => fake.seed.card(who(c.by ?? 'pipewrench'), post, c.card, { layer: c.layer ?? 1, live: true, config: c.config ?? {}, message: '' }));
    return made.thread;
  }, { ...seed, bodyDefault: BODY });
  await page.evaluate((t) => { history.pushState(null, '', `/t/${t}`); window.dispatchEvent(new PopStateEvent('popstate')); }, thread);
  await expect(page.locator('.dw-this-note').first()).toBeAttached();
  await loadFaces(page);
  return thread;
}

/** What the notes' places are, read in the page: every box the checks compare, in the page's own coordinates. */
interface Reading {
  readonly id: string;
  readonly placed: boolean;
  readonly gapHeight: string;
  readonly piece: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number } | null;
  readonly note: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number; readonly width: number };
  readonly tip: { readonly x: number; readonly y: number } | null;
  /** The top of the first word of the post that lies below the phrase's last line (not on it). */
  readonly nextTop: number | null;
  /** Words of the post whose boxes meet the note's. */
  readonly under: string[];
  readonly gapClosed: boolean;
}

const read = (page: Page, scope = '.dw-this'): Promise<Reading[]> => page.evaluate((sel) => {
  const host = document.querySelector<HTMLElement>(sel)!;
  const words: { text: string; r: DOMRect }[] = [];
  const walker = document.createTreeWalker(host.querySelector('.kb-bb') ?? host, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement!;
    if (el.closest('[data-dw-aside]') || el.closest('.kb-visually-hidden')) continue;
    const text = (n as Text).data;
    for (const m of text.matchAll(/\S+/gu)) {
      const range = document.createRange();
      range.setStart(n, m.index!);
      range.setEnd(n, m.index! + m[0].length);
      for (const r of range.getClientRects()) if (r.width > 0) words.push({ text: m[0], r });
    }
  }
  return [...host.querySelectorAll<HTMLElement>('[data-dw-this-note]')].map((note): Reading => {
    const id = note.dataset['dwThisNote']!;
    const gap = host.querySelector<HTMLElement>(`[data-dw-this-gap="${id}"]`)!;
    let before: Node | null = gap.previousSibling;
    while (before instanceof HTMLElement && before.hasAttribute('data-dw-this-gap')) before = before.previousSibling;
    const rects = before instanceof HTMLElement ? before.getClientRects() : null;
    const last = rects && rects.length ? rects[rects.length - 1]! : null;
    const nb = note.getBoundingClientRect();
    const d = note.querySelector('path')?.getAttribute('d') ?? '';
    const q = /Q\s*(-?[\d.]+),(-?[\d.]+)\s+(-?[\d.]+),(-?[\d.]+)/u.exec(d);
    const svg = note.querySelector('svg')!.getBoundingClientRect();
    const tip = q ? { x: svg.left + Number(q[3]), y: svg.top + Number(q[4]) } : null;
    const below = last ? words.filter((w) => w.r.top > last.bottom - 1).map((w) => w.r.top) : [];
    const under = words.filter((w) => w.r.left < nb.right - 1 && w.r.right > nb.left + 1 && w.r.top < nb.bottom - 1 && w.r.bottom > nb.top + 1).map((w) => w.text);
    return {
      id, placed: note.hasAttribute('data-placed'), gapHeight: gap.style.height,
      piece: last ? { left: last.left, right: last.right, top: last.top, bottom: last.bottom } : null,
      note: { left: nb.left, right: nb.right, top: nb.top, bottom: nb.bottom, width: nb.width },
      tip, nextTop: below.length ? Math.min(...below) : null, under, gapClosed: gap.getClientRects().length === 0,
    };
  });
}, scope);

/** The note is under the phrase's last line, above the next line's words, over none of them, with its arrow's tip under the last piece. */
function expectPlaced(readings: readonly Reading[], count: number, label: string) {
  expect(readings, `${label}: notes`).toHaveLength(count);
  for (const r of readings) {
    expect(r.placed, `${label}: ${r.id} placed`).toBe(true);
    expect(r.piece, `${label}: the phrase has a last piece`).not.toBeNull();
    expect(r.note.top, `${label}: note top ${r.note.top} at or below the phrase's bottom ${r.piece!.bottom}`).toBeGreaterThanOrEqual(r.piece!.bottom - 0.5);
    if (r.nextTop !== null) expect(r.note.bottom, `${label}: note bottom ${r.note.bottom} above the next line's top ${r.nextTop}`).toBeLessThanOrEqual(r.nextTop + 0.5);
    expect(r.under, `${label}: words under the note`).toEqual([]);
    expect(r.tip, `${label}: an arrow with a tip`).not.toBeNull();
    expect(r.tip!.x, `${label}: tip x ${r.tip!.x} under the last piece ${r.piece!.left}..${r.piece!.right}`).toBeGreaterThanOrEqual(r.piece!.left - 0.5);
    expect(r.tip!.x).toBeLessThanOrEqual(r.piece!.right + 0.5);
    expect(r.tip!.y, `${label}: tip y ${r.tip!.y} just under the last piece's bottom ${r.piece!.bottom}`).toBeGreaterThanOrEqual(r.piece!.bottom - 4);
    expect(r.tip!.y).toBeLessThanOrEqual(r.piece!.bottom + 14);
  }
}

const settle = (page: Page) => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => done())))));
const NOTES: Note[] = [{ phrase: FIRST, words: 'finally somebody said it' }, { phrase: SECOND, words: 'is how you lose the whole board' }];

for (const size of SIZES) {
  test.describe(size.name, () => {
    test(`two notes are under their phrases, stay so after a narrow and a wide window, and make no ResizeObserver noise or off-origin request`, async ({ page }) => {
      const heard = listen(page);
      await open(page, size, { notes: NOTES });
      await expect.poll(async () => (await read(page)).every((r) => r.placed)).toBe(true);
      /* A thread page with no THIS on it already gets one "ResizeObserver loop" report as it loads (some other observer of the board; seen on a thread with no note on it), so the count is taken here, once the notes are placed, and what THIS must add while the window is resized is none. A report THIS made as it first mounted would be in this count; the page errors below are held empty over the whole test. */
      await page.waitForTimeout(1500);
      const errors = () => page.evaluate(() => (window as unknown as { __errs: string[] }).__errs.filter((m) => /ResizeObserver/iu.test(m)).length);
      const atLoad = await errors();
      expectPlaced(await read(page), 2, `${size.name}`);
      /* Narrowed and widened again: the lines are other lines, and the notes follow them. */
      await page.setViewportSize({ width: 320, height: size.height });
      await settle(page);
      await expect.poll(async () => { try { expectPlaced(await read(page), 2, 'narrowed'); return true; } catch { return false; } }, { timeout: 5000 }).toBe(true);
      await page.setViewportSize({ width: size.width, height: size.height });
      await settle(page);
      await expect.poll(async () => { try { expectPlaced(await read(page), 2, 'widened'); return true; } catch { return false; } }, { timeout: 5000 }).toBe(true);
      expectPlaced(await read(page), 2, 'widened again');
      expect(await errors(), 'ResizeObserver reports added by THIS while resizing').toBe(atLoad);
      expect(heard.problems).toEqual([]);
      const face = await page.evaluate(() => [...document.fonts].filter((f) => f.family.replace(/"/gu, '') === 'Permanent Marker').map((f) => f.status));
      expect(face, 'Permanent Marker is declared and loaded').toEqual(['loaded']);
      const base = new URL(page.url()).origin;
      expect([...heard.origins].filter((o) => o !== base), 'requests that left the page\'s origin').toEqual([]);
    });

    test('a note on a taped phrase: the tape still covers the words and the note is under their line', async ({ page }) => {
      await open(page, size, { notes: [NOTES[0]!], cards: [{ card: 'autocorrect', config: { phrase: FIRST, replacement: 'Luigi was robbed' } }] });
      await expect.poll(async () => (await read(page)).every((r) => r.placed)).toBe(true);
      await settle(page);
      const readings = await read(page);
      expectPlaced(readings, 1, 'taped');
      /* A strip covers the phrase: some element of the post's words that is not the highlight, with a box over the phrase's last line piece. */
      const covered = await page.evaluate((id) => {
        const host = document.querySelector<HTMLElement>('.dw-this')!;
        const gap = host.querySelector<HTMLElement>(`[data-dw-this-gap="${id}"]`)!;
        let before: Node | null = gap.previousSibling;
        while (before instanceof HTMLElement && before.hasAttribute('data-dw-this-gap')) before = before.previousSibling;
        const el = before as HTMLElement;
        const r = el.getClientRects();
        const last = r[r.length - 1]!;
        const tape = [...host.querySelectorAll<HTMLElement>('[class*="dw-ac"], [data-dw-ac], [data-kb-tape]')];
        return { tag: el.className, tapeFound: tape.length, width: last.width, height: last.height };
      }, readings[0]!.id);
      expect(covered.width, `the last piece before the gap has a box (${covered.tag})`).toBeGreaterThan(8);
      expect(covered.tapeFound, 'the tape is drawn').toBeGreaterThan(0);
    });

    test('a selection across the wedge and the Quote button give the post\'s words, not the note\'s', async ({ page }) => {
      await open(page, size, { notes: NOTES });
      await expect.poll(async () => (await read(page)).every((r) => r.placed)).toBe(true);
      await page.evaluate(() => {
        const body = document.querySelector('.dw-this .kb-bb')!;
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        const nodes: Text[] = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!(n.parentElement!.closest('[data-dw-aside]'))) nodes.push(n as Text);
        const from = nodes.find((n) => n.data.includes('People blame'))!;
        const to = nodes.find((n) => n.data.includes('I played forty'))!;
        const range = document.createRange();
        range.setStart(from, from.data.indexOf('People'));
        range.setEnd(to, to.data.indexOf('I played forty') + 'I played forty'.length);
        const s = window.getSelection()!;
        s.removeAllRanges();
        s.addRange(range);
      });
      const quoteSelected = page.getByRole('button', { name: 'Quote the selected text' });
      await expect(quoteSelected).toBeVisible();
      await quoteSelected.click();
      const box = page.getByRole('textbox').last();
      await expect(box).toHaveValue(/People blame the engine/u);
      const said = await box.inputValue();
      expect(said, 'the selection quotes the words of the post').toContain('I played forty');
      expect(said).not.toMatch(/THIS|finally somebody|Note on these words/u);
      /* The post's own Quote button quotes the post's body. */
      await page.locator('article.kb-act').last().getByRole('button', { name: 'Quote', exact: true }).click();
      const again = await box.inputValue();
      expect(again).not.toMatch(/finally somebody|Note on these words/u);
    });

    test('Below the Fold over the post: once the bar is pressed, the note is placed', async ({ page }) => {
      await open(page, size, { author: 'other', notes: [NOTES[0]!], cards: [{ card: 'below-the-fold' }] });
      const bar = page.getByRole('button', { name: /^Show post #\d+ by /u }).last();
      await expect(bar).toBeVisible();
      expect(await page.locator('.dw-this-note[data-placed]').count(), 'folded: nothing measured').toBe(0);
      await bar.click();
      await expect.poll(async () => (await read(page)).every((r) => r.placed), { timeout: 5000 }).toBe(true);
      await settled(page, { loops: true });
      expectPlaced(await read(page), 1, 'after the bar');
    });

    test('Stick Around\'s held view holds the post with the note under its phrase', async ({ page }) => {
      await open(page, size, { author: 'other', filler: 6, notes: [{ ...NOTES[0]!, by: 'pipewrench' }], cards: [{ card: 'stick-around', by: 'spritey' }] });
      const view = page.getByRole('dialog', { name: 'Stick Around' });
      await page.mouse.move(size.width / 2, size.height / 2);
      await page.evaluate(() => { [...document.querySelectorAll('article.kb-act')].at(-1)!.scrollIntoView({ block: 'center' }); });
      await page.mouse.wheel(0, 1);
      await expect(view).toBeVisible({ timeout: 10_000 });
      await expect.poll(async () => (await read(page, '.kb-hold-view .dw-this')).every((r) => r.placed), { timeout: 5000 }).toBe(true);
      await settle(page);
      expectPlaced(await read(page, '.kb-hold-view .dw-this'), 1, 'held view');
    });

    test('three notes on one phrase stack without overlapping each other or the post\'s words', async ({ page }) => {
      await open(page, size, { notes: [{ phrase: FIRST, words: 'one' }, { phrase: FIRST, words: 'two' }, { phrase: FIRST, words: 'three' }] });
      await expect.poll(async () => (await read(page)).length === 3 && (await read(page)).every((r) => r.placed)).toBe(true);
      await settle(page);
      const rs = await read(page);
      for (const r of rs) expect(r.under, `words under note ${r.id}`).toEqual([]);
      const sorted = [...rs].sort((a, b) => a.note.top - b.note.top);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.note.top, `note ${i} top ${sorted[i]!.note.top} below note ${i - 1} bottom ${sorted[i - 1]!.note.bottom}`).toBeGreaterThanOrEqual(sorted[i - 1]!.note.bottom - 0.5);
      for (const r of rs) if (r.nextTop !== null) expect(r.note.bottom).toBeLessThanOrEqual(r.nextTop + 0.5);
    });

    test('a 60-character unbroken word in the note does not overflow the post', async ({ page }) => {
      const long = 'x'.repeat(60);
      await open(page, size, { notes: [{ phrase: FIRST, words: long }] });
      await expect.poll(async () => (await read(page)).every((r) => r.placed)).toBe(true);
      const over = await page.evaluate(() => {
        const host = document.querySelector<HTMLElement>('.dw-this')!.getBoundingClientRect();
        const words = document.querySelector<HTMLElement>('.dw-this-words')!.getBoundingClientRect();
        return { hostRight: host.right, wordsRight: words.right };
      });
      expect(over.wordsRight, 'the words end inside the post').toBeLessThanOrEqual(over.hostRight + 0.5);
      expect(await sideways(page), 'the page does not scroll sideways').toBeLessThanOrEqual(0);
      expectPlaced(await read(page), 1, 'long word');
    });

    test('a phrase in a block [spoiler]: closed, no note is visible; opened, it is placed; closed again, hidden again', async ({ page }) => {
      const body = 'Before the spoiler.\n\n[spoiler]Hidden words with a phrase that is quite long to point at here and more words after it.[/spoiler]\n\nAfter the spoiler, the next paragraph of the post.';
      await open(page, size, { body, notes: [{ phrase: 'phrase that is quite long', words: 'yes' }] });
      const note = page.locator('.dw-this-note');
      const visible = () => note.evaluate((el) => getComputedStyle(el).visibility === 'visible' && el.getClientRects().length > 0 && el.closest('details')?.open !== false);
      await settle(page);
      expect(await note.evaluate((el) => el.hasAttribute('data-placed')), 'closed: not placed').toBe(false);
      expect(await visible(), 'closed: no note is visible').toBe(false);
      await page.locator('details.kb-bb-spoiler summary').click();
      await expect.poll(async () => (await read(page)).every((r) => r.placed), { timeout: 5000 }).toBe(true);
      await settle(page);
      expectPlaced(await read(page), 1, 'spoiler open');
      await page.locator('details.kb-bb-spoiler summary').click();
      await expect.poll(() => note.evaluate((el) => el.hasAttribute('data-placed')), { timeout: 5000 }).toBe(false);
      expect(await visible(), 'closed again: hidden again').toBe(false);
    });

    test('a phrase in an [ispoiler]: pressing it open leaves the gap its height and the note under the phrase, with no flash over the next line', async ({ page }) => {
      const body = 'Before this the [ispoiler]answer[/ispoiler] is here and there are more words that go on for a good while so that the line wraps at least once around the end.\n\nNext paragraph of the post, which must not be covered by anything at all.';
      await open(page, size, { body, notes: [{ phrase: 'answer', words: 'is that so' }] });
      await expect.poll(async () => (await read(page)).every((r) => r.placed), { timeout: 5000 }).toBe(true);
      const before = await read(page);
      expect(before[0]!.gapHeight, 'shut: the gap has a height').not.toBe('');
      /* Frame by frame from the press: the note over a word of the post in any frame is a flash. */
      const flashes = await page.evaluate(() => new Promise<string[]>((done) => {
        const host = document.querySelector<HTMLElement>('.dw-this')!;
        const bad: string[] = [];
        const check = (n: number) => {
          const note = host.querySelector<HTMLElement>('.dw-this-note')!;
          const gap = host.querySelector<HTMLElement>('[data-dw-this-gap]');
          const nb = note.getBoundingClientRect();
          const visible = getComputedStyle(note).visibility === 'visible';
          const walker = document.createTreeWalker(host.querySelector('.kb-bb')!, NodeFilter.SHOW_TEXT);
          for (let t = walker.nextNode(); t; t = walker.nextNode()) {
            if (t.parentElement!.closest('[data-dw-aside]') || t.parentElement!.closest('.kb-visually-hidden')) continue;
            const range = document.createRange();
            range.selectNodeContents(t);
            for (const r of range.getClientRects()) if (visible && r.width > 0 && r.left < nb.right - 1 && r.right > nb.left + 1 && r.top < nb.bottom - 1 && r.bottom > nb.top + 1) bad.push(`frame ${n}: note over "${(t as Text).data.slice(0, 20)}" gap ${gap?.style.height ?? 'none'}`);
          }
          if (n < 6) requestAnimationFrame(() => check(n + 1)); else done(bad);
        };
        host.querySelector<HTMLButtonElement>('button.kb-bb-ispoiler')!.click();
        requestAnimationFrame(() => check(0));
      }));
      await settle(page);
      const after = await read(page);
      expect(after[0]!.gapHeight, 'open: the gap has its height').not.toBe('');
      expect(after[0]!.gapHeight, 'open: the gap is not 0px').not.toBe('0px');
      expectPlaced(after, 1, 'ispoiler open');
      expect(flashes, 'the note over the post\'s words in a frame after the press').toEqual([]);
    });

    test('a phrase followed directly by punctuation does not let the line break between the phrase and its period', async ({ page }) => {
      const body = 'Anyway the new level editor is fine and I have said so a good many times before now. Stop asking for slopes. That is all.\n\nAnd a second paragraph follows.';
      for (const width of size.width === 390 ? [390, 360, 340, 320] : [1280, 900, 700, 500]) {
        await page.setViewportSize({ width, height: size.height });
        if (width === (size.width === 390 ? 390 : 1280)) await open(page, { width, height: size.height }, { body, notes: [{ phrase: 'asking for slopes', words: 'yes' }] });
        await settle(page);
        await expect.poll(async () => (await read(page)).every((r) => r.placed), { timeout: 5000 }).toBe(true);
        await settle(page);
        const broke = await page.evaluate(() => {
          const gap = document.querySelector<HTMLElement>('[data-dw-this-gap]')!;
          const period = gap.nextSibling;
          if (!period || period.nodeType !== 3 || !(period as Text).data.startsWith('.')) return { checked: false, why: `next is ${period?.nodeType}` };
          const range = document.createRange();
          range.setStart(period, 0);
          range.setEnd(period, 1);
          const dot = range.getClientRects()[0]!;
          const hl = [...document.querySelectorAll<HTMLElement>('.dw-this-hl')].at(-1)!.getClientRects();
          const last = hl[hl.length - 1]!;
          return { checked: true, brokeAfterPhrase: dot.top > last.top + last.height / 2, dotTop: dot.top, lastTop: last.top };
        });
        expect(broke.checked, JSON.stringify(broke)).toBe(true);
        expect(broke, `width ${width}: the period stays with the phrase`).toMatchObject({ brokeAfterPhrase: false });
      }
    });

    test('Whoops! ink over the note takes the presses meant for the ink: the note does not swallow them', async ({ page }) => {
      await open(page, size, { notes: [NOTES[0]!], cards: [{ card: 'whoops', config: { color: '#19e3ff', seed: 202 } }] });
      await expect.poll(async () => (await read(page)).every((r) => r.placed), { timeout: 5000 }).toBe(true);
      /* The ink is a canvas for each band near the window, so the note is brought to the middle of the window first and the bands are given their frames. */
      await page.evaluate(() => { const n = document.querySelector<HTMLElement>('.dw-this-note')!.getBoundingClientRect(); window.scrollBy(0, n.top + n.height / 2 - window.innerHeight / 2); });
      await settle(page);
      await expect(page.locator('canvas.kb-whoops-ink').first()).toBeAttached();
      const hit = await page.evaluate(() => {
        const nb = document.querySelector<HTMLElement>('.dw-this-note')!.getBoundingClientRect();
        const word = document.querySelector<HTMLElement>('.dw-this-word')!.getBoundingClientRect();
        const at = (x: number, y: number) => { const top = document.elementFromPoint(x, y); return { name: top ? `${top.tagName}.${top.className}` : null, ink: !!top?.closest('.kb-whoops-ink, .kb-whoops-frame'), inNote: !!top?.closest('.dw-this-note') }; };
        return { onWord: at(word.left + word.width / 2, word.top + word.height / 2), onNote: at(nb.right - 20, nb.top + nb.height / 2) };
      });
      expect(hit.onWord.inNote, `a press on the note's word reaches ${hit.onWord.name}, not the note`).toBe(false);
      expect(hit.onWord.ink, `a press on the note's word reaches the ink (${hit.onWord.name})`).toBe(true);
      expect(hit.onNote.inNote, `a press in the note's row reaches ${hit.onNote.name}, not the note`).toBe(false);
    });

    test('a press on a link on the phrase\'s own line still follows the link; the arrow does not swallow it', async ({ page }) => {
      const body = 'See https://example.test/a and People blame the engine for it https://example.test/b then more words follow here on the same paragraph, to wrap.\n\nA second paragraph that stays below.';
      await page.route('**://example.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>ok</p>' }));
      await open(page, size, { body, notes: [{ phrase: 'People blame the engine', words: 'is it' }] });
      await expect.poll(async () => (await read(page)).every((r) => r.placed), { timeout: 5000 }).toBe(true);
      await settle(page);
      await page.locator('.dw-this a').first().evaluate((a) => a.scrollIntoView({ block: 'center' }));
      await settle(page);
      const links = await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>('.dw-this a')].map((link) => {
        const rects = [...link.getClientRects()];
        const lr = rects[rects.length - 1]!;
        return [0.1, 0.5, 0.9].map((f) => { const top = document.elementFromPoint(lr.left + lr.width * f, lr.bottom - 2); return top?.closest('a') === link ? true : `${top?.tagName}.${top?.className} y=${lr.bottom - 2} rects=${rects.length}`; });
      }));
      expect(links, 'a press along the bottom of each link reaches the link').toEqual([[true, true, true], [true, true, true]]);
      const request = page.waitForRequest(/example\.test\/b/u);
      await page.locator('.dw-this a').last().click();
      await request;
    });
  });
}

test('a spun thread\'s ORIGIN box holds the post with the note under its phrase', async ({ page }) => {
  const heard = listen(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/b/general');
  await page.waitForFunction(() => '__kbFake' in globalThis);
  const spun = await page.evaluate(async (body) => {
    const w = globalThis as E2eWindow;
    const { characters } = w.__kbDemo;
    const fake = w.__kbFake;
    const made = fake.seed.thread('general', characters.hooligan, 'A thread to spin from', 'Start.');
    const post = fake.seed.post(made.thread, characters.hooligan, body);
    fake.seed.card(characters.spritey, post, 'this', { layer: 1, live: true, config: { phrase: 'People blame the engine because it\'s easier', words: 'finally somebody said it' }, message: 'THIS' });
    const play = fake.seed.reach(characters.spritey, 'character', characters.hooligan, 'glitter-bomb', { post, ends: Date.now() + 5 * 86_400_000, message: 'Sparkle.' });
    const answer = await fake.spin(play, characters.pipewrench, 'About the engine', 'Spun from it.', undefined, post);
    if (!answer.ok) throw new Error(`the spin was refused: ${JSON.stringify(answer)}`);
    return answer.value.thread.id;
  }, BODY);
  await page.evaluate((t) => { history.pushState(null, '', `/t/${t}`); window.dispatchEvent(new PopStateEvent('popstate')); }, spun);
  const box = page.getByRole('group', { name: 'Origin' });
  await expect(box).toBeVisible();
  await loadFaces(page);
  await expect(box.locator('.dw-this-note')).toBeAttached();
  await expect.poll(async () => (await read(page, '[role="group"][aria-label="Origin"] .dw-this')).every((r) => r.placed), { timeout: 5000 }).toBe(true);
  await settle(page);
  expectPlaced(await read(page, '[role="group"][aria-label="Origin"] .dw-this'), 1, 'origin box');
  expect(heard.problems).toEqual([]);
});
