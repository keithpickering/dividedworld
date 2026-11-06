/**
 * Whoops!'s drawn cursor (refinements design section 8; plan Task 8). It is a `.test.tsx` file, whatever it holds, because
 * `test:engine` runs every `.test.ts` under plain node, which has no DOM and so no `document` to draw a sponge into.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cursor, IDLE_MS } from './cursor.ts';

const FINE = '(hover: hover) and (pointer: fine)';
let fine = true;
let host: HTMLElement;
/** The frames asked for and not yet run, by id: a stub that hands out increasing ids, as a browser does. */
let pending: Map<number, (t: number) => void>;
let nextId = 1;

const mouse = (x = 100, y = 100, pointerType = 'mouse') => ({ clientX: x, clientY: y, pointerType });
const sponge = () => document.querySelector<HTMLElement>('[data-kb-cursor="sponge"]');
const pen = () => document.querySelector<HTMLElement>('[data-kb-cursor="pen"]');
const shown = (el: Element | null) => el !== null && !el.hasAttribute('hidden');

beforeEach(() => {
  vi.useFakeTimers();
  fine = true;
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === FINE ? fine : false, media: query, addEventListener() {}, removeEventListener() {} }));
  pending = new Map();
  nextId = 1;
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => { const id = nextId++; pending.set(id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { pending.delete(id); });
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

/** Runs the oldest frame asked for, as the browser would, at time t. */
function runFrame(t: number): void {
  const first = pending.entries().next().value;
  if (!first) throw new Error('no frame is waiting');
  pending.delete(first[0]);
  first[1](t);
}

/** A 2D context that records what is drawn and accepts everything else. */
function recordingContext() {
  const calls: string[] = [];
  const ctx: Record<string, unknown> = {};
  for (const m of ['setTransform', 'clearRect', 'drawImage', 'beginPath', 'moveTo', 'bezierCurveTo', 'arc', 'closePath', 'fill', 'stroke', 'ellipse']) {
    ctx[m] = vi.fn(() => { calls.push(m); });
  }
  ctx.createLinearGradient = () => ({ addColorStop() {} });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, fns: ctx as Record<string, ReturnType<typeof vi.fn>> };
}

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

describe('the frame loop', () => {
  test('it stops when nothing is shown and no drop is falling, and starts again when a cursor shows', () => {
    cursor.over(host, mouse(), 'sponge');
    expect(pending.size).toBe(1);
    cursor.leave(host);
    runFrame(1000);
    expect(pending.size).toBe(0);
    cursor.over(host, mouse(), 'sponge');
    expect(pending.size).toBe(1);
  });

  test('it runs on while drops fall after the cursor is gone, then stops', () => {
    cursor.over(host, mouse(), 'sponge');
    let t = 1000;
    runFrame(t);
    for (let i = 0; i < 125; i++) runFrame(t += 16);
    expect(cursor.drips()).toBeGreaterThan(0);
    cursor.leave(host);
    runFrame(t += 16);
    expect(pending.size).toBe(1);
    for (let i = 0; i < 100 && pending.size; i++) runFrame(t += 16);
    expect(cursor.drips()).toBe(0);
    expect(pending.size).toBe(0);
  });

  test('a host removed from the page while it holds the cursor releases it', () => {
    host.style.cursor = 'crosshair';
    cursor.over(host, mouse(), 'sponge');
    host.remove();
    runFrame(1000);
    expect(shown(sponge())).toBe(false);
    expect(host.style.cursor).toBe('crosshair');
    let t = 1000;
    for (let i = 0; i < 100 && pending.size; i++) runFrame(t += 16);
    expect(pending.size).toBe(0);
  });
});

describe('drawing', () => {
  test('drips are drawn, the canvas follows the window and the pixel ratio, and a frame whose draw throws does not stop the loop', () => {
    const { ctx, calls, fns } = recordingContext();
    vi.stubGlobal('devicePixelRatio', 2);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    cursor.over(host, mouse(), 'sponge');
    const drips = document.querySelector<HTMLCanvasElement>('[data-kb-cursor="drips"]')!;
    expect(drips.width).toBe(innerWidth * 2);
    expect(drips.height).toBe(innerHeight * 2);
    let t = 1000;
    runFrame(t);
    for (let i = 0; i < 125; i++) runFrame(t += 16);
    expect(cursor.drips()).toBeGreaterThan(0);
    expect(calls).toContain('drawImage');
    expect(calls).toContain('clearRect');
    vi.stubGlobal('devicePixelRatio', 1);
    runFrame(t += 16);
    expect(drips.width).toBe(innerWidth);
    expect(drips.height).toBe(innerHeight);
    fns.drawImage.mockImplementationOnce(() => { throw new Error('draw failed'); });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    runFrame(t += 16);
    expect(log).toHaveBeenCalledOnce();
    expect(pending.size).toBe(1);
    const before = fns.drawImage.mock.calls.length;
    runFrame(t += 16);
    expect(fns.drawImage.mock.calls.length).toBeGreaterThan(before);
  });
});

describe('without matchMedia', () => {
  test('over() shows nothing and throws nothing', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(() => cursor.over(host, mouse(), 'sponge')).not.toThrow();
    expect(sponge()).toBeNull();
    expect(host.style.cursor).toBe('');
  });
});

describe('rate and cleanup', () => {
  test('a sponge at rest sheds about 1.8 drops a second', () => {
    cursor.over(host, mouse(), 'sponge');
    cursor.tick(1000);
    let t = frames(100, 1000); // one second for the pointer's earlier speed and the first drops to settle
    let live = 0;
    for (let i = 0; i < 625; i++) { t += 16; cursor.tick(t); live += cursor.drips() * 0.016; }
    // Each drop lives 0.9s, so drop-seconds in the air over ten seconds, divided by 0.9, is how many were shed.
    const shed = live / 0.9;
    expect(shed).toBeGreaterThanOrEqual(14);
    expect(shed).toBeLessThanOrEqual(22);
  });

  test('the idle timer is cleared when a host returns before it fires', () => {
    cursor.over(host, mouse(), 'sponge');
    cursor.leave(host);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(IDLE_MS - 100);
    cursor.over(host, mouse(), 'sponge');
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(IDLE_MS * 2);
    expect(shown(sponge())).toBe(true);
  });

  test('disposing removes the resize listener and the pending frame', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    cursor.over(host, mouse(), 'sponge');
    const added = add.mock.calls.find((c) => c[0] === 'resize')?.[1];
    expect(added).toBeTypeOf('function');
    cursor.leave(host);
    vi.advanceTimersByTime(IDLE_MS + 10);
    expect(sponge()).toBeNull();
    expect(remove.mock.calls.some((c) => c[0] === 'resize' && c[1] === added)).toBe(true);
    expect(pending.size).toBe(0);
  });
});
