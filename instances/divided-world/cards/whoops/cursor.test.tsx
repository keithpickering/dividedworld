/**
 * Whoops!'s drawn cursor (refinements design section 8; plan Task 8). It is a `.test.tsx` file, whatever it holds, because
 * `test:engine` runs every `.test.ts` under plain node, which has no DOM and so no `document` to draw a sponge into.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cursor, IDLE_MS } from './cursor.ts';

const FINE = '(hover: hover) and (pointer: fine)';
let fine = true;
let host: HTMLElement;

const mouse = (x = 100, y = 100, pointerType = 'mouse') => ({ clientX: x, clientY: y, pointerType });
const sponge = () => document.querySelector<HTMLElement>('[data-kb-cursor="sponge"]');
const pen = () => document.querySelector<HTMLElement>('[data-kb-cursor="pen"]');
const shown = (el: HTMLElement | null) => el !== null && !el.hidden;

beforeEach(() => {
  vi.useFakeTimers();
  fine = true;
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === FINE ? fine : false, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  document.documentElement.removeAttribute('data-kb-motion');
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  cursor.leave(host);
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  host.remove();
});

/** Frames of 16ms, enough of them that a rate of about two a second would show. */
function frames(count: number, from = 1000): number {
  let t = from;
  for (let i = 0; i < count; i++) { t += 16; cursor.tick(t); }
  return t;
}

describe('the sponge', () => {
  test('a mouse over ink shows the sponge and hides the system cursor on the host', () => {
    cursor.over(host, mouse(), 'sponge');
    expect(shown(sponge())).toBe(true);
    expect(host.style.cursor).toBe('none');
    expect(sponge()?.getAttribute('aria-hidden')).toBe('true');
    expect(sponge()?.style.pointerEvents).toBe('none');
  });

  test('over a lifted element, where the mode is null, it shows neither and leaves the cursor alone', () => {
    cursor.over(host, mouse(), 'sponge');
    cursor.over(host, mouse(), null);
    expect(shown(sponge())).toBe(false);
    expect(shown(pen())).toBe(false);
    expect(host.style.cursor).toBe('');
    const other = document.createElement('div');
    other.style.cursor = 'help';
    document.body.append(other);
    cursor.over(other, mouse(), null);
    expect(other.style.cursor).toBe('help');
    other.remove();
  });

  test('a touch or a pen pointer never shows it', () => {
    for (const type of ['touch', 'pen']) {
      cursor.over(host, mouse(5, 5, type), 'sponge');
      expect(sponge()).toBeNull();
      expect(host.style.cursor).toBe('');
    }
  });

  test('without a fine pointer it never shows', () => {
    fine = false;
    cursor.over(host, mouse(), 'sponge');
    expect(sponge()).toBeNull();
    expect(host.style.cursor).toBe('');
  });

  test('it follows the pointer and squishes while pressed', () => {
    cursor.over(host, mouse(100, 100), 'sponge');
    cursor.over(host, mouse(130, 140), 'sponge');
    expect(sponge()?.style.transform).toBe('translate(100px, 112px)');
    cursor.press(true);
    expect(sponge()?.classList.contains('kb-whoops-pressing')).toBe(true);
    cursor.press(false);
    expect(sponge()?.classList.contains('kb-whoops-pressing')).toBe(false);
  });

  test('leaving the host restores the system cursor it had', () => {
    host.style.cursor = 'crosshair';
    cursor.over(host, mouse(), 'sponge');
    expect(host.style.cursor).toBe('none');
    cursor.leave(host);
    expect(host.style.cursor).toBe('crosshair');
    expect(shown(sponge())).toBe(false);
  });

  test('another host taking the cursor gives the first host its own back', () => {
    const second = document.createElement('div');
    document.body.append(second);
    cursor.over(host, mouse(), 'sponge');
    cursor.over(second, mouse(), 'sponge');
    expect(host.style.cursor).toBe('');
    expect(second.style.cursor).toBe('none');
    cursor.leave(host);
    expect(second.style.cursor).toBe('none');
    cursor.leave(second);
    second.remove();
  });

  test('the drawn elements are removed once no host has used them for a while', () => {
    cursor.over(host, mouse(), 'sponge');
    cursor.leave(host);
    expect(sponge()).not.toBeNull();
    vi.advanceTimersByTime(IDLE_MS + 10);
    expect(sponge()).toBeNull();
    expect(document.querySelector('[data-kb-cursor="drips"]')).toBeNull();
    cursor.over(host, mouse(), 'sponge');
    expect(shown(sponge())).toBe(true);
  });
});

describe('the pen', () => {
  test('shows in the ink\'s color in place of the sponge', () => {
    cursor.over(host, mouse(), 'sponge');
    cursor.over(host, mouse(), 'pen', '#c0392b');
    expect(shown(pen())).toBe(true);
    expect(shown(sponge())).toBe(false);
    expect(pen()?.style.getPropertyValue('--kb-pen-ink')).toBe('#c0392b');
    expect(pen()?.getAttribute('aria-hidden')).toBe('true');
    expect(host.style.cursor).toBe('none');
  });

  test('its tip is at the pointer', () => {
    cursor.over(host, mouse(200, 150), 'pen', '#000');
    const tip = pen()!;
    const dx = Number(tip.dataset.kbTipX), dy = Number(tip.dataset.kbTipY);
    expect(tip.style.transform).toBe(`translate(${200 - dx}px, ${150 - dy}px)`);
  });

  test('sheds no drips', () => {
    cursor.over(host, mouse(), 'pen', '#000');
    frames(300);
    expect(cursor.drips()).toBe(0);
  });
});

describe('the drips', () => {
  test('a sponge at rest sheds drops, more while pressed', () => {
    cursor.over(host, mouse(), 'sponge');
    cursor.tick(1000);
    frames(125); // two seconds of 16ms frames
    const rest = cursor.drips();
    expect(rest).toBeGreaterThan(0);
    cursor.press(true);
    const t = frames(125, 3000);
    expect(cursor.drips()).toBeGreaterThan(rest);
    frames(80, t); // 0.9s and more later, the drops have fallen away
    cursor.press(false);
  });

  test('under reduced motion the sponge shows, squishes not, and no drop is spawned', () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    cursor.over(host, mouse(), 'sponge');
    expect(shown(sponge())).toBe(true);
    cursor.press(true);
    expect(sponge()?.classList.contains('kb-whoops-pressing')).toBe(false);
    cursor.tick(1000);
    frames(300);
    expect(cursor.drips()).toBe(0);
    cursor.press(false);
  });
});
