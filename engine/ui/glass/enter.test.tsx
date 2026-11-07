/**
 * A screen's entrance (enter.ts): head, then panels, then rows, in that order, at most MAX_ROWS rows however long the page, the last of them
 * starting within the feel's screen duration; nothing under Off.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MAX_ROWS, delaysFor, enterScreen, entrants } from './enter.ts';
import { feelTokens, type ActiveFeel } from './motion.ts';

const feel: ActiveFeel = { name: 'smooth', ...feelTokens('smooth') };
let host: HTMLElement;
afterEach(() => host?.remove());

function screenOf(rows: number): HTMLElement {
  host = document.createElement('div');
  host.innerHTML = `<div class="kb-page-head"></div><section class="kb-glass-cut-panel"></section>
    <table><tbody>${'<tr><td>row</td></tr>'.repeat(rows)}</tbody></table><nav><ul><li>menu</li></ul></nav>`;
  document.body.append(host);
  return host;
}

describe('a screen\'s entrance', () => {
  test('the head first, then the panels, then the rows, and a menu\'s items are not rows', () => {
    const got = entrants(screenOf(3));
    expect(got.map((e) => e.className || e.tagName)).toEqual(['kb-page-head', 'kb-glass-cut-panel', 'TR', 'TR', 'TR']);
  });
  test('500 rows: at most MAX_ROWS enter and the last starts within the screen duration', () => {
    const got = entrants(screenOf(500));
    expect(got).toHaveLength(2 + MAX_ROWS);
    const delays = delaysFor(feel, got.length);
    expect(Math.max(...delays) * 1000).toBeLessThanOrEqual(feel.screen);
  });
  test('computed once for the count: the same list for the same count, and none under Off', () => {
    expect(delaysFor(feel, 62)).toEqual(delaysFor(feel, 62));
    expect(delaysFor(null, 62)).toEqual([]);
    const stop = enterScreen(null, screenOf(5));
    expect(host.querySelector<HTMLElement>('tr')!.style.opacity).toBe('');
    stop();
  });
  test('rows below the fold are not measured: a 2000-row log costs a bounded number of reads', () => {
    const screen = screenOf(2000);
    const rows = Array.from(screen.querySelectorAll('tr'));
    const reads = vi.fn();
    rows.forEach((tr, i) => {
      tr.getBoundingClientRect = () => { reads(); const top = i * 40; return { top, bottom: top + 40 } as DOMRect; };
    });
    const got = entrants(screen, 800);
    expect(got.length).toBeLessThanOrEqual(2 + 21);
    expect(reads.mock.calls.length).toBeLessThanOrEqual(25);
  });
  test('a panel with its own inline transform keeps it when its entrance is stopped', () => {
    const screen = screenOf(1);
    const panel = screen.querySelector<HTMLElement>('.kb-glass-cut-panel')!;
    panel.style.transform = 'rotate(3deg)';
    const stop = enterScreen(feel, screen);
    stop();
    expect(panel.style.transform).toBe('rotate(3deg)');
  });
});
