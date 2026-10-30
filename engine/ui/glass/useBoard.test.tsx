/**
 * The root's mark and scale, as useBoard keeps them (engine/ui/glass/useBoard.ts): shared by every
 * caller, so one caller's unmount leaves them for the rest; read from the room the page has; and
 * worked out again at most once a frame however many resizes a frame brings.
 */
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import { testGlass } from '../test-world.tsx';
import { useBoard } from './useBoard.ts';

const kayfa = { ui: { glass: testGlass } } as unknown as Kayfa;

function Probe() {
  const { board, scale } = useBoard();
  return <p>{board} {scale}</p>;
}
const mount = () => render(<KayfaProvider value={kayfa}><Probe /></KayfaProvider>);

/** A window `outer` wide, as matchMedia and innerWidth answer it, whose page has `room` of it (less a classic scrollbar). */
function window_(outer: number, room = outer) {
  vi.stubGlobal('matchMedia', (q: string) => {
    const m = /\(min-width:\s*([\d.]+)px\)/.exec(q);
    return { matches: m ? outer >= Number(m[1]) : false, media: q, addEventListener: () => {}, removeEventListener: () => {} } as unknown as MediaQueryList;
  });
  vi.stubGlobal('innerWidth', outer);
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, get: () => room });
}

/* Frames run only when the test says so. */
function frames() {
  const queued = new Map<number, FrameRequestCallback>();
  let next = 1;
  const cancelled: number[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { queued.set(next, cb); return next++; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { cancelled.push(id); queued.delete(id); });
  return {
    queued,
    cancelled,
    run() { const now = [...queued.values()]; queued.clear(); act(() => { for (const cb of now) cb(0); }); },
  };
}

const root = document.documentElement;
const scale = () => root.style.getPropertyValue('--kb-board-scale');

afterEach(() => {
  vi.unstubAllGlobals();
  delete (root as { clientWidth?: number }).clientWidth;
});

describe('useBoard', () => {
  test('one caller\'s unmount leaves the mark and the scale for the others; the last one\'s takes them off', () => {
    window_(1300);
    const first = mount();
    const second = mount();
    expect(root).toHaveAttribute('data-kb-layout', 'main');
    expect(Number(scale())).toBeCloseTo(1300 / 1440, 9);
    first.unmount();
    expect(root).toHaveAttribute('data-kb-layout', 'main');
    expect(Number(scale())).toBeCloseTo(1300 / 1440, 9);
    second.unmount();
    expect(root).not.toHaveAttribute('data-kb-layout');
    expect(scale()).toBe('');
  });

  test('the scale is read from the room the page has, without a classic scrollbar, not the window\'s outer width', () => {
    window_(1300, 1285);
    const view = mount();
    expect(Number(scale())).toBeCloseTo(1285 / 1440, 9);
    view.unmount();
  });

  test('where the window passes the switch but the page\'s room does not, it is the Phone board\'s', () => {
    /* testGlass's switch is 1152px: a 1160px window less a 15px scrollbar leaves 1145px. */
    window_(1160, 1145);
    const view = mount();
    expect(root).toHaveAttribute('data-kb-layout', 'phone');
    expect(scale()).toBe('1');
    view.unmount();
  });

  test('resizes are worked out once a frame, and a frame still waiting is cancelled on unmount', () => {
    const f = frames();
    window_(1300);
    const view = mount();
    f.run();
    window_(1250);
    for (let i = 0; i < 3; i += 1) globalThis.dispatchEvent(new Event('resize'));
    expect(f.queued.size).toBe(1);
    expect(Number(scale())).toBeCloseTo(1300 / 1440, 9);
    f.run();
    expect(Number(scale())).toBeCloseTo(1250 / 1440, 9);
    globalThis.dispatchEvent(new Event('resize'));
    const waiting = [...f.queued.keys()];
    expect(waiting).toHaveLength(1);
    view.unmount();
    expect(f.cancelled).toContain(waiting[0]);
  });
});
