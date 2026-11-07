/**
 * The Season, Rankings and Log tables stand on the page's own left edge, as its text does, and on the phone the column heads
 * they hide for the eye do not lay a table wider than the column (the layout check names each such row: e2e/glass-layout.ts, refusal 2).
 */
import fs from 'node:fs';
import { describe, expect, test } from 'vitest';

const css = (f: string) => fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = (text: string, selector: string): string[] => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1]!.split(',').map((s) => s.replace(/\s+/g, ' ').trim()).includes(selector)).map((m) => m[2]!);
const PHONE = ":where(:root[data-kb-layout='phone'])";

describe('the rankings table', () => {
  const text = css('engine/ui/rankings/rankings.css');
  test('its first column starts at the left edge of the page\'s text, an own row\'s band drawn outside it', () => {
    for (const sel of ['.kb-rankings-table th.kb-rankings-place', '.kb-rankings-table td.kb-rankings-place']) {
      expect(rules(text, sel).join(';')).not.toMatch(/padding-left:\s*[1-9]/);
    }
    expect(rules(text, '.kb-rankings-table tr[data-kb-own] td:first-child').join(';')).not.toMatch(/padding-left/);
    expect(rules(text, '.kb-rankings-table tr[data-kb-own] td:first-child::before').join(';')).toMatch(/left:\s*-\d+px/);
    expect(rules(text, `${PHONE} .kb-rankings-table tbody tr`).join(';')).toMatch(/padding:\s*10px 0;/);
  });
  test('the phone\'s hidden head row is no table row', () => {
    expect(rules(text, `${PHONE} .kb-rankings-table thead tr`).join(';')).toMatch(/display:\s*block/);
    expect(rules(text, `${PHONE} .kb-rankings-table thead th`).join(';')).toMatch(/display:\s*block[^]*position:\s*absolute[^]*width:\s*1px[^]*clip-path:\s*inset\(50%\)/);
  });
});

describe('the log table', () => {
  const text = css('engine/ui/log/log.css');
  test('the phone\'s hidden head row is no table row', () => {
    expect(rules(text, `${PHONE} .kb-log-table thead tr`).join(';')).toMatch(/display:\s*block/);
    expect(rules(text, `${PHONE} .kb-log-table thead th`).join(';')).toMatch(/display:\s*block[^]*position:\s*absolute[^]*width:\s*1px[^]*clip-path:\s*inset\(50%\)/);
  });
  test('on the phone no cell keeps the desk layout\'s column width, which would lay a row wider than the column', () => {
    for (const c of ['td.kb-log-when', 'td.kb-log-what', 'td.kb-log-num', 'td:last-child']) {
      expect(rules(text, `${PHONE} .kb-log-table tbody > tr > ${c}`).join(';'), c).toMatch(/width:\s*auto/);
    }
  });
});

describe('the period table (board-look plan, Task 3)', () => {
  const base = css('engine/ui/base.css');
  const frame = css('engine/ui/frame/frame.css');
  const tokens = css('engine/ui/tokens.css');
  test('a table is drawn as cellspacing="1" was: separate borders, a 1px gap that is the grid, and an edge that is the frame', () => {
    const own = rules(base, '.kb-table').join(';');
    expect(own).toMatch(/border-collapse:\s*separate/);
    expect(own).toMatch(/border-spacing:\s*1px/);
    expect(own).toMatch(/background:\s*var\(--kb-grid\)/);
    expect(own).toMatch(/border:\s*1px solid var\(--kb-frame\)/);
  });
  test('the heads, the alternating rows and the count cell read their tokens, and a cell has no border of its own', () => {
    expect(rules(base, '.kb-table th').join(';')).toMatch(/background:\s*var\(--kb-head-bg\)[^]*color:\s*var\(--kb-head-fg\)[^]*text-shadow:\s*var\(--kb-head-shadow\)/);
    const td = rules(base, '.kb-table td').join(';');
    expect(td).toMatch(/background:\s*var\(--kb-row-1\)/);
    expect(td).not.toMatch(/border:/);
    expect(rules(base, '.kb-table th').join(';')).not.toMatch(/(^|;)\s*border:/);
    expect(rules(base, '.kb-table :where(tbody > tr:nth-child(even)) > td').join(';')).toMatch(/background:\s*var\(--kb-row-2\)/);
    expect(rules(base, '.kb-table td.kb-num').join(';')).toMatch(/background:\s*var\(--kb-row-3\)/);
    expect(rules(base, '.kb-table td.kb-bar').join(';')).toMatch(/background:\s*var\(--kb-bar-bg\)[^]*color:\s*var\(--kb-bar-fg\)[^]*text-shadow:\s*var\(--kb-bar-shadow\)/);
  });
  test('selection, the focus ring and the scrollbar read their tokens', () => {
    expect(rules(base, '::selection').join(';')).toMatch(/--kb-selection-bg/);
    expect(rules(base, ':focus-visible').join(';')).toMatch(/outline:\s*2px solid var\(--kb-focus\)/);
    expect(rules(base, '*').join(';')).toMatch(/scrollbar-color:\s*var\(--kb-scrollbar-thumb\) var\(--kb-scrollbar-track\)/);
  });
  test('the banner and the boards\' bar are one block on their tokens', () => {
    expect(rules(frame, '.kb-banner').join(';')).toMatch(/background:\s*var\(--kb-banner-bg\)/);
    expect(rules(frame, '.kb-logo').join(';')).toMatch(/color:\s*var\(--kb-logo-fg\)[^]*text-shadow:\s*var\(--kb-logo-shadow\)/);
    expect(rules(frame, '.kb-nav').join(';')).toMatch(/background:\s*var\(--kb-nav-bg\)/);
    expect(rules(frame, '.kb-nav a:focus-visible').join(';')).toMatch(/outline-color:\s*var\(--kb-nav-fg\)/);
    expect(rules(frame, '.kb-nav a:visited').join(';')).toMatch(/color:\s*var\(--kb-nav-fg\)/);
  });
  test('the badges are 80 by 15 at 100% text, in rem, on the badge tokens, in the instance\'s own face', () => {
    const badge = rules(frame, '.kb-badge').join(';');
    expect(badge).toMatch(/width:\s*5rem/);
    expect(badge).toMatch(/height:\s*0\.9375rem/);
    expect(badge).toMatch(/font:[^;]*var\(--kb-font-badge\)/);
    expect(rules(frame, '.kb-badge > :first-child').join(';')).toMatch(/background:\s*var\(--kb-badge-a\)[^]*color:\s*var\(--kb-badge-a-fg\)/);
    expect(rules(frame, '.kb-badge > :last-child').join(';')).toMatch(/background:\s*var\(--kb-badge-b\)[^]*color:\s*var\(--kb-badge-b-fg\)/);
    expect(base + frame).not.toMatch(/Silkscreen/);
  });
  test('the tag and the mini avatar have tokens whose defaults keep today\'s look', () => {
    expect(tokens).toMatch(/--kb-tag-bg:\s*var\(--kb-bg\)/);
    expect(tokens).toMatch(/--kb-mini-bg:\s*var\(--kb-bg\)/);
    expect(tokens).toMatch(/--kb-mini-rule:\s*var\(--kb-rule\)/);
    expect(tokens).toMatch(/--kb-font-badge:\s*var\(--kb-font-mono\)/);
    expect(rules(css('engine/ui/mini.css'), '.kb-mini').join(';')).toMatch(/border:\s*1px solid var\(--kb-mini-rule\)/);
  });
});
