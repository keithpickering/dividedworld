/**
 * The feels and the choreography's presets (glass polish design, section 9): Off makes every preset
 * empty, the stagger is capped by the feel's screen duration, Snappy clips along the skew and Smooth
 * does not, and an instance's tokens override the defaults one by one.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beat, deal, lift, toHand, turn, wipe, wipeMask, backdrop, crossing, crossingPinned, currentFeel, feelTokens, modal, overlay, screen, stagger, staggerItem, swap, useFeel, type ActiveFeel } from './motion.ts';

const rect = { x: 10, y: 20, width: 100, height: 40 };
const within = { width: 1000, height: 700 };
const smooth: ActiveFeel = { name: 'smooth', ...feelTokens('smooth') };
const snappy: ActiveFeel = { name: 'snappy', ...feelTokens('snappy') };

function presets(f: ActiveFeel) {
  const delays = stagger(f, 5);
  return {
    crossing: crossing(f, { tab: rect, within }), screen: screen(f),
    overlay: overlay(f, { x: 4, y: 8 }), overlayCentered: overlay(f), modal: modal(f), backdrop: backdrop(f),
    item: staggerItem(f, delays, 2), swap: swap(f),
  };
}

describe('the presets', () => {
  it('are empty under Off, and so are a stagger\'s delays', () => {
    for (const p of Object.values(presets(null))) expect(p).toEqual({});
    expect(stagger(null, 20)).toEqual([]);
  });

  it('carry a clip-path under Snappy, and under Smooth only the crossing does (a window opening from the HUD tab)', () => {
    const { backdrop: _b, item: _i, overlay: _o, overlayCentered: _oc, modal: _m, ...shapes } = presets(snappy);
    for (const [name, p] of Object.entries(shapes)) expect(JSON.stringify(p), name).toContain('clipPath');
    const { crossing: _c, ...rest } = presets(smooth);
    for (const [name, p] of Object.entries(rest)) expect(JSON.stringify(p), name).not.toContain('clipPath');
    expect(JSON.stringify(_c)).toContain('clipPath');
  });

  it('wipe Snappy\'s dialogs by a mask, never a clip-path (the box\'s chamfer is its own clip-path), slanted along the skew', () => {
    for (const p of [overlay(snappy, { x: 4, y: 8 }), overlay(snappy), modal(snappy)]) {
      const json = JSON.stringify(p);
      expect(json).not.toContain('clipPath');
      expect(json).toContain('maskImage');
      expect(json).toContain('WebkitMaskImage');
      expect(json).toContain('var(--kb-glass-skew)');
      const from = (p.initial as { maskImage: string }).maskImage;
      const to = (p.animate as { maskImage: string }).maskImage;
      expect(from).toBe(wipeMask(-1));
      expect(to).toBe(wipeMask(101));
      /* The exit starts from the shown keyframe, so it plays from rest (where the mask is none). */
      expect((p.exit as { maskImage: string[] }).maskImage).toEqual([to, from]);
      expect((p.exit as { WebkitMaskImage: string[] }).WebkitMaskImage).toEqual([to, from]);
      expect((p.animate as { transitionEnd: Record<string, string> }).transitionEnd).toMatchObject({ maskImage: 'none', WebkitMaskImage: 'none' });
    }
    for (const p of [overlay(smooth), modal(smooth)]) expect(JSON.stringify(p)).not.toContain('Mask');
  });

  it('slant Snappy\'s clip along the glass\'s skew', () => {
    expect(JSON.stringify(screen(snappy))).toContain('var(--kb-glass-skew)');
  });

  it('spring where the feel has a spring, and ease where it has none', () => {
    const t = (f: ActiveFeel) => (screen(f).variants as Record<string, { transition?: unknown }>).center!.transition;
    expect(t(snappy)).toMatchObject({ type: 'spring', stiffness: 520, damping: 32 });
    expect(t(smooth)).toMatchObject({ duration: 0.42, ease: [0.22, 1, 0.36, 1] });
  });

  for (const [name, make, axis] of [['screen', screen, 'x'], ['swap', swap, 'y']] as const) {
    for (const f of [smooth, snappy]) {
      it(`${name} (${f!.name}) resolves its direction at exit time: the old content leaves toward the side it came from and the new enters from the other`, () => {
        const p = make(f);
        expect(p.initial).toBe('enter');
        expect(p.exit).toBe('exit');
        const v = p.variants as Record<string, (d: 1 | -1) => Record<string, number>>;
        expect(v.enter!(1)[axis]).toBeGreaterThan(0);
        expect(v.exit!(1)[axis]).toBeLessThan(0);
        /* The same element, rendered for a right change then asked to exit for a left one, leaves the other way. */
        expect(v.exit!(-1)[axis]).toBeGreaterThan(0);
        expect(v.enter!(-1)[axis]).toBeLessThan(0);
      });
    }
  }

  /* Each point of a polygon as [x, y] percents; the slant is worst-case 9% of the width either way (tan 10deg times 50). */
  const points = (poly: string, lean: number) => poly.replace(/^polygon\(|\)$/g, '').replaceAll('calc(tan(var(--kb-glass-skew)) * 50%)', 'LEAN').split(/, (?![^(]*\))/).map((pt) => {
    const [xs, ys] = pt.split(/ (?=-?[\d.]+%$)/) as [string, string];
    const m = /^calc\(([-\d.]+)% ([+-]) LEAN\)$/.exec(xs);
    const x = m ? parseFloat(m[1]!) + (m[2] === '+' ? lean : -lean) : parseFloat(xs);
    return [x, parseFloat(ys)] as const;
  });

  it('wipe: shown clips nothing around the box and hidden shows none of it, for an element of any size', () => {
    for (const lean of [-9, 9]) {
      const shown = points(wipe(150), lean);
      expect(shown).toHaveLength(4);
      for (const [x, y] of shown) {
        expect(x <= 0 || x >= 100).toBe(true);
        expect(y <= 0 || y >= 100).toBe(true);
      }
      const hidden = points(wipe(-25), lean);
      expect(hidden).toHaveLength(4);
      for (const [x] of hidden) expect(x).toBeLessThanOrEqual(0);
    }
  });

  it('crossing (Smooth) is a window: a clip from the rect, inset in px from the screen\'s edges, to inset(0), with no scale', () => {
    const p = crossing(smooth, { tab: rect, within });
    const clip = (t: unknown) => (t as { clipPath: string }).clipPath;
    /* top 20, right 1000-110, bottom (the box's own foot less the rect's foot), left 10 */
    expect(clip(p.initial)).toBe('inset(20px 890px calc(100% - 60px) 10px)');
    expect(clip(p.exit)).toBe(clip(p.initial));
    expect(clip(p.animate)).toBe('inset(0px 0px calc(100% - 700px) 0px)');
    expect(JSON.stringify(p)).not.toContain('scale');
  });

  it('crossing (Snappy) starts its clip at the given rect and ends at the full screen', () => {
    const p = crossing(snappy, { tab: rect, within });
    const clip = (t: unknown) => (t as { clipPath: string }).clipPath;
    expect(clip(p.initial)).toContain('10px');
    expect(clip(p.initial)).toContain('110px');
    expect(clip(p.initial)).toContain('60px');
    /* Open reaches past the screen on every side, so the slant clips none of it. */
    const nums = [...clip(p.animate).matchAll(/calc\((-?[\d.]+)px/g)].map((m) => Number(m[1]));
    expect(Math.min(...nums)).toBeLessThan(0);
    expect(Math.max(...nums)).toBeGreaterThan(1000);
    expect(clip(p.exit)).toBe(clip(p.initial));
  });
})

describe('the crossing of a pinned world', () => {
  const exitOf = (p: ReturnType<typeof crossingPinned>, scrollY: number, rested = false) => ((p.variants as Record<string, (n: { scrollY: number; rested: boolean }) => Record<string, unknown>>).leave!)({ scrollY, rested });

  it('closes (Snappy) into the rect as the window sees it, wherever the world was scrolled', () => {
    const p = crossingPinned(snappy, { tab: rect, within });
    /* Pinned 300px up, the world's own y of the rect is 300 lower; at no scroll it is the rect as it is. */
    expect(exitOf(p, 0).clipPath).toBe((crossing(snappy, { tab: rect, within }).exit as { clipPath: string }).clipPath);
    expect(exitOf(p, 300).clipPath).toBe((crossing(snappy, { tab: { ...rect, y: rect.y + 300 }, within }).exit as { clipPath: string }).clipPath);
    expect(exitOf(p, 300).clipPath).not.toBe(exitOf(p, 0).clipPath);
  });

  it('closes (Smooth) into the rect as the window sees it', () => {
    const p = crossingPinned(smooth, { tab: rect, within });
    expect(exitOf(p, 300).clipPath).toBe('inset(320px 890px calc(100% - 360px) 10px)');
  });

  it('exits from rest by keyframes that start at the open shape (Snappy polygon, Smooth inset) and, un-rested, by a plain target from where the enter had got to', () => {
    const open = (f: ActiveFeel) => (crossing(f, { tab: rect, within }).animate as { clipPath: string }).clipPath;
    for (const f of [smooth, snappy]) {
      const p = crossingPinned(f, { tab: rect, within });
      const rested = exitOf(p, 0, true);
      expect((rested.clipPath as string[])[0]).toBe(open(f));
      expect((rested.clipPath as string[])[1]).toBe(exitOf(p, 0, false).clipPath);
      expect(typeof exitOf(p, 0, false).clipPath).toBe('string');
    }
    expect((exitOf(crossingPinned(snappy, { tab: rect, within }), 0, true).clipPath as string[])[0]).toContain('polygon(');
    expect((exitOf(crossingPinned(smooth, { tab: rect, within }), 0, true).clipPath as string[])[0]).toMatch(/^inset\(0px 0px/u);
    expect(exitOf(crossingPinned(smooth, { tab: rect, within }), 0, true).filter).toEqual(['blur(0px)', exitOf(crossingPinned(smooth, { tab: rect, within }), 0, false).filter]);
    expect(typeof exitOf(crossingPinned(smooth, { tab: rect, within }), 0, false).filter).toBe('string');
    /* The scroll offset moves the closed shape of both exits alike. */
    expect((exitOf(crossingPinned(smooth, { tab: rect, within }), 300, true).clipPath as string[])[1]).toBe('inset(320px 890px calc(100% - 360px) 10px)');
  });

  it('enters and exits as the plain crossing does, and is empty under Off', () => {
    const p = crossingPinned(smooth, { tab: rect, within });
    expect((p.variants as Record<string, unknown>).closed).toEqual(crossing(smooth, { tab: rect, within }).initial);
    expect(crossingPinned(null, { tab: rect, within })).toEqual({});
  });
});

describe('the rest state is Motion\'s own', () => {
  const end = (t: unknown) => (t as { transitionEnd?: Record<string, string> }).transitionEnd;
  it('the crossing\'s open carries transitionEnd none for the filter and clip-path it animates', () => {
    expect(end(crossing(smooth, { tab: rect, within }).animate)).toEqual({ filter: 'none', clipPath: 'none' });
    expect(end(crossing(snappy, { tab: rect, within }).animate)).toEqual({ clipPath: 'none' });
  });
  it('every resting target that animates a filter or clip-path carries it', () => {
    const v = (p: { variants?: Record<string, unknown> }) => p.variants!.center;
    expect(end(v(screen(smooth)))).toEqual({ filter: 'none' });
    expect(end(v(screen(snappy)))).toEqual({ clipPath: 'none' });
    expect(end(v(swap(smooth)))).toEqual({ filter: 'none' });
    expect(end(v(swap(snappy)))).toEqual({ clipPath: 'none' });
    expect(end(overlay(smooth).animate)).toEqual({ filter: 'none' });
    expect(end(modal(smooth).animate)).toEqual({ filter: 'none' });
    expect(end(staggerItem(smooth, [0], 0).animate)).toEqual({ filter: 'none' });
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

describe('the stagger at a busy page\'s length', () => {
  it.each(['smooth', 'snappy'] as const)('%s: 500 rows (and 5000) start within the screen duration, the step shortened to fit', (name) => {
    const feel: ActiveFeel = { name, ...feelTokens(name) };
    for (const count of [1, 2, 20, 500, 5000]) {
      const delays = stagger(feel, count);
      expect(delays).toHaveLength(count);
      expect(Math.max(...delays) * 1000).toBeLessThanOrEqual(feel.screen + 1e-6);
    }
    /* A short page keeps the feel's own step. */
    expect(stagger(feel, 3)[1]! * 1000).toBeCloseTo(feel.stagger);
  });
});

/* The machine's motion (booster packs plan, Task 10): the flight to the hand, the lift, the turn, the deal and the hit's beat. */
describe('the machine\'s presets', () => {
  const card = { x: 400, y: 300, width: 150, height: 225 };
  const hand = { x: 40, y: 60, width: 170, height: 52 };
  const last = (t: unknown, axis: string) => { const v = (t as Record<string, number[]>)[axis]!; return v[v.length - 1]!; };

  it('are empty under Off', () => {
    expect(toHand(null, card, hand, 0)).toEqual({});
    expect(lift(null)).toEqual({});
    expect(turn(null)).toEqual({});
    expect(deal(null, 2, [])).toEqual({});
    expect(beat(null)).toEqual({});
  });

  it.each([['smooth', smooth], ['snappy', snappy]] as const)('toHand (%s) ends at the center of the hand link\'s rect, shrunk to 0.12 and faded, eased over the feel\'s screen', (_n, f) => {
    const p = toHand(f, card, hand, 0.06);
    const a = p.animate as Record<string, unknown> & { transition: Record<string, unknown> };
    /* Offsets from where the card stands: the target's center less the card's. */
    expect(last(a, 'x')).toBe(hand.x + hand.width / 2 - (card.x + card.width / 2));
    expect(last(a, 'y')).toBe(hand.y + hand.height / 2 - (card.y + card.height / 2));
    expect(last(a, 'scale')).toBe(0.12);
    expect(last(a, 'opacity')).toBe(0);
    /* Through a point above and between them. */
    const y = a.y as number[];
    expect(y[1]).toBeLessThan(Math.min(0, y[2]!));
    expect(a.transition).toMatchObject({ duration: f!.screen / 1000, delay: 0.06, ease: [0.22, 1, 0.36, 1] });
    expect(a.transition).not.toHaveProperty('type');
  });

  it('toHand ends at the viewport\'s edge toward a link that is outside it', () => {
    const w = window.innerWidth, h = window.innerHeight;
    const above = toHand(smooth, card, { x: 40, y: -900, width: 170, height: 52 }, 0).animate as Record<string, number[]>;
    expect(last(above, 'y')).toBe(0 - (card.y + card.height / 2));
    expect(last(above, 'x')).toBe(40 + 85 - (card.x + card.width / 2));
    const below = toHand(smooth, card, { x: w + 300, y: h + 500, width: 170, height: 52 }, 0).animate as Record<string, number[]>;
    expect(last(below, 'x')).toBe(w - (card.x + card.width / 2));
    expect(last(below, 'y')).toBe(h - (card.y + card.height / 2));
  });

  it('deal starts the fifth card within the feel\'s screen times three, in order, and lands each card at rest', () => {
    for (const f of [smooth, snappy]) {
      const delays = stagger(f, 5);
      const starts = [0, 1, 2, 3, 4].map((i) => ((deal(f, i, delays).animate as { transition: { delay: number } }).transition.delay));
      expect(Math.max(...starts) * 1000).toBeLessThanOrEqual(f!.screen * 3 + 1e-6);
      expect(starts).toEqual([...starts].sort((a, b) => a - b));
      /* Three times the stagger's step. */
      expect(starts[1]! * 1000).toBeCloseTo(delays[1]! * 3000);
      expect(deal(f, 4, delays).animate).toMatchObject({ x: 0, y: 0, rotate: 0, scale: 1 });
    }
  });

  it('turn is rotateY from 0 to 180, landing: Snappy by its spring, Smooth by its ease over enter x 1.2', () => {
    expect(turn(snappy).animate).toMatchObject({ rotateY: 180, transition: { type: 'spring', stiffness: 520, damping: 32 } });
    expect(turn(smooth).animate).toMatchObject({ rotateY: 180, transition: { duration: (380 * 1.2) / 1000, ease: [0.22, 1, 0.36, 1] } });
    expect(turn(smooth).initial).toEqual({ rotateY: 0 });
  });

  it('lift is a shared layout landing over enter (a spring under Snappy), and beat is scale 1, 1.05, 1 eased over screen', () => {
    expect(lift(smooth)).toMatchObject({ layout: true, transition: { duration: 0.38 } });
    expect(lift(snappy)).toMatchObject({ layout: true, transition: { type: 'spring' } });
    expect((beat(smooth).animate as { scale: number[] }).scale).toEqual([1, 1.05, 1]);
    expect((beat(smooth).animate as { transition: unknown }).transition).toMatchObject({ duration: 0.42, ease: [0.22, 1, 0.36, 1] });
  });
});
