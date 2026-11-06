/**
 * The feels and the choreography's presets (glass polish design, section 9): Off makes every preset
 * empty, the stagger is capped by the feel's screen duration, Snappy clips along the skew and Smooth
 * does not, and an instance's tokens override the defaults one by one.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backdrop, crossing, currentFeel, feelTokens, modal, overlay, screen, stagger, staggerItem, swap, useFeel, type ActiveFeel } from './motion.ts';

const rect = { x: 10, y: 20, width: 100, height: 40 };
const within = { width: 1000, height: 700 };
const smooth: ActiveFeel = { name: 'smooth', ...feelTokens('smooth') };
const snappy: ActiveFeel = { name: 'snappy', ...feelTokens('snappy') };

function presets(f: ActiveFeel) {
  const delays = stagger(f, 5);
  return {
    crossing: crossing(f, { from: rect, within }), screen: screen(f, 1), screenBack: screen(f, -1),
    overlay: overlay(f, { x: 4, y: 8 }), overlayCentered: overlay(f), modal: modal(f), backdrop: backdrop(f),
    item: staggerItem(f, delays, 2), swap: swap(f, 1),
  };
}

describe('the presets', () => {
  it('are empty under Off, and so are a stagger\'s delays', () => {
    for (const p of Object.values(presets(null))) expect(p).toEqual({});
    expect(stagger(null, 20)).toEqual([]);
  });

  it('carry a clip-path under Snappy and none under Smooth', () => {
    const { backdrop: _b, item: _i, ...shapes } = presets(snappy);
    for (const [name, p] of Object.entries(shapes)) expect(JSON.stringify(p), name).toContain('clipPath');
    for (const [name, p] of Object.entries(presets(smooth))) expect(JSON.stringify(p), name).not.toContain('clipPath');
  });

  it('slant Snappy\'s clip along the glass\'s skew', () => {
    expect(JSON.stringify(screen(snappy, 1))).toContain('var(--kb-glass-skew)');
  });

  it('spring where the feel has a spring, and ease where it has none', () => {
    expect(screen(snappy, 1).animate?.transition).toMatchObject({ type: 'spring', stiffness: 520, damping: 32 });
    expect(screen(smooth, 1).animate?.transition).toMatchObject({ duration: 0.42, ease: [0.22, 1, 0.36, 1] });
  });

  it('send a screen\'s content out the side it came toward and in from the other', () => {
    const p = screen(smooth, 1);
    expect(p.initial?.x).toBe(16);
    expect(p.exit?.x).toBe(-16);
  });
});

describe('stagger', () => {
  for (const count of [1, 2, 20, 200]) {
    for (const f of [smooth, snappy]) {
      it(`starts the last of ${count} within the ${f!.name} screen duration`, () => {
        const d = stagger(f, count);
        expect(d).toHaveLength(count);
        expect(d[0]).toBe(0);
        expect(d[count - 1]! * 1000).toBeLessThanOrEqual(f!.screen + 1e-9);
      });
    }
  }
  it('keeps the feel\'s own step where it fits', () => {
    expect(stagger(smooth, 4)[1]).toBeCloseTo(0.03);
  });
});

describe('an instance\'s tokens', () => {
  it('override that feel\'s token and leave the others standing', () => {
    const t = feelTokens('smooth', { smooth: { enter: 500 } });
    expect(t.enter).toBe(500);
    expect(t).toEqual({ ...feelTokens('smooth'), enter: 500 });
    expect(feelTokens('snappy', { smooth: { enter: 500 } }).enter).toBe(180);
  });
  it('reach the presets through useFeel', () => {
    const { result } = renderHook(() => useFeel({ smooth: { enter: 500 } }));
    expect(result.current?.enter).toBe(500);
    expect(result.current?.screen).toBe(420);
  });
});

describe('useFeel', () => {
  const root = document.documentElement;
  let reduces = false;
  let listeners: Array<() => void> = [];
  beforeEach(() => {
    reduces = false;
    listeners = [];
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: reduces && q.includes('reduce'), media: q,
      addEventListener: (_: string, l: () => void) => listeners.push(l),
      removeEventListener: (_: string, l: () => void) => { listeners = listeners.filter((x) => x !== l); },
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    root.removeAttribute('data-kb-motion');
    root.removeAttribute('data-kb-motion-feel');
  });

  it('is null under Off', () => {
    root.setAttribute('data-kb-motion', 'reduce');
    expect(renderHook(() => useFeel()).result.current).toBeNull();
  });
  it('is Snappy\'s tokens under full and snappy', () => {
    root.setAttribute('data-kb-motion', 'full');
    root.setAttribute('data-kb-motion-feel', 'snappy');
    expect(renderHook(() => useFeel()).result.current).toMatchObject({ name: 'snappy', enter: 180, mask: 'skew' });
  });
  it('is Smooth where the player left it to the device and the device does not reduce', () => {
    expect(renderHook(() => useFeel()).result.current).toMatchObject({ name: 'smooth', enter: 380 });
  });
  it('is null where the player left it to the device and the device reduces', () => {
    reduces = true;
    expect(currentFeel()).toBe('off');
    expect(renderHook(() => useFeel()).result.current).toBeNull();
  });
  it('lets a player\'s full override the device\'s reduce', () => {
    reduces = true;
    root.setAttribute('data-kb-motion', 'full');
    expect(renderHook(() => useFeel()).result.current?.name).toBe('smooth');
  });
  it('follows the root as it changes', async () => {
    const { result } = renderHook(() => useFeel());
    expect(result.current?.name).toBe('smooth');
    await act(async () => { root.setAttribute('data-kb-motion', 'full'); root.setAttribute('data-kb-motion-feel', 'snappy'); await Promise.resolve(); });
    expect(result.current?.name).toBe('snappy');
    await act(async () => { root.setAttribute('data-kb-motion', 'reduce'); root.removeAttribute('data-kb-motion-feel'); await Promise.resolve(); });
    expect(result.current).toBeNull();
  });
  it('follows the device\'s setting as it changes', () => {
    const { result } = renderHook(() => useFeel());
    expect(result.current?.name).toBe('smooth');
    act(() => { reduces = true; listeners.forEach((l) => l()); });
    expect(result.current).toBeNull();
  });
});
