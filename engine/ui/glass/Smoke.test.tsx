/**
 * The smoke's behavior (docs/plans/2026-10-29-screens-web-plan.md, Task 1; the glass polish design,
 * section 6): the smoke is one field of layers, and a surface draws each layer as a masked element
 * in its recipe's color. None is drawn under `off`; a third of each layer's opacity under `low`;
 * the ground is there before the rasters are, and when they never are. jsdom paints nothing and has
 * no canvas, so these read the elements and their styles with a stand-in rasterizer: what the page
 * looks like is tools/check-glass-contrast.mjs's model and e2e/glass-text.spec.ts's measurement.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import { renderInWorld, testGlass } from '../test-world.tsx';
import type { FieldLayer, GlassTheme, LayerColor } from '../types.ts';
import { fieldRasters, GRACE_MS, type Rasterize } from './field.ts';
import { Page } from './Page.tsx';
import { Smoke } from './Smoke.tsx';

const shape = (seed: number, seconds = 28, travel = 120): FieldLayer => ({
  alpha: [0, 0, 0, 1.8, -0.74], frequency: [0.01, 0.02], octaves: 3, seed, blur: 9, drift: { seconds, travel },
});
const color = (c: string, opacity: number): LayerColor => ({ color: c, opacity });

/* A field of three layers and one narrow, and two recipes: one with narrow colors of its own, one plain. */
const glass = {
  keys: { standard: {}, high: {} },
  smoke: {
    field: { layers: [shape(3, 28, 120), shape(7, 40, 90), shape(9, 60, 60)], narrow: [shape(11, 90, 40)] },
    recipes: {
      deep: { colors: [color('#8040ff', 1), color('#00e0ff', 0.55), color('#000000', 0)], narrowColors: [color('#8040ff', 0.6)] },
      calm: { colors: [color('#00e0ff', 0.6), color('#8040ff', 0.4), color('#ff0000', 0.2)] },
    },
    surfaces: { hud: 'deep', hand: 'calm', play: 'calm', react: 'calm', turn: 'calm', effect: 'calm', vending: 'calm', characters: 'calm', rankings: 'calm', log: 'deep', settings: 'calm', account: 'calm', settlement: 'calm' },
  },
  calm: { opacity: 0.85, feather: 32 },
  sizes: {}, fonts: [], classes: {}, orbs: { gradients: [], body: { core: '', edge: '' } },
} as unknown as GlassTheme;

const world = { ui: { glass } } as unknown as Kayfa;
const inWorld = (node: ReactNode) => <KayfaProvider value={world}>{node}</KayfaProvider>;

let made = 0;
/** A rasterizer that answers at once, naming each URL by the layer's seed. */
const instant: Rasterize = async (layer) => `blob:layer/${layer.seed}/${made++}`;
let narrow = false;
let mediaCalls = 0;
let narrowListeners: ((e: { matches: boolean }) => void)[] = [];
let revoked: string[] = [];
const realRevoke = URL.revokeObjectURL;

beforeEach(() => {
  revoked = [];
  URL.revokeObjectURL = (u: string) => { revoked.push(u); };
  made = 0; narrow = false; narrowListeners = [];
  fieldRasters.reset();
  fieldRasters.setRasterizer(instant);
  mediaCalls = 0;
  vi.stubGlobal('matchMedia', (q: string) => (mediaCalls++, {
    get matches() { return /max-width/.test(q) && narrow; }, media: q,
    addEventListener: (_: string, f: (e: { matches: boolean }) => void) => { narrowListeners.push(f); },
    removeEventListener: (_: string, f: (e: { matches: boolean }) => void) => { narrowListeners = narrowListeners.filter((x) => x !== f); },
  }));
});
afterEach(() => {
  fieldRasters.reset();
  URL.revokeObjectURL = realRevoke;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-kb-motion');
  document.documentElement.removeAttribute('data-kb-smoke-level');
});

/** Let the rasterizer's promises land and React draw what they gave. */
const ready = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const layers = (c: HTMLElement | Document = document) => [...c.querySelectorAll<HTMLElement>('.kb-smoke-layer')];
/** A layer's drawn color as [r, g, b, a], from the ink and alpha the component hands to base.css (which mixes them). */
function rgba(el: HTMLElement): number[] {
  const ink = el.style.getPropertyValue('--kb-field-ink');
  const n = ink ? Number.parseInt(ink.slice(1), 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, Number(el.style.getPropertyValue('--kb-field-alpha'))];
}

describe('Smoke', () => {
  it('draws one masked element per field layer, in the recipe\'s colors at its opacities, and no svg', async () => {
    const { container } = render(inWorld(<Smoke surface="hud" />));
    await ready();
    const els = layers(container);
    expect(els).toHaveLength(3);
    expect(rgba(els[0]!)).toEqual([0x80, 0x40, 0xff, 1]);
    expect(rgba(els[1]!)).toEqual([0x00, 0xe0, 0xff, 0.55]);
    expect(container.querySelector('svg')).toBeNull();
    /* Each layer's mask is its own raster, by the URL the cache gave it. */
    expect(els.map((e) => e.style.getPropertyValue('--kb-field-mask'))).toEqual([
      'url("blob:layer/3/0")', 'url("blob:layer/7/1")', 'url("blob:layer/9/2")',
    ]);
  });

  it('draws a layer the recipe gives opacity 0 as an element in transparent color, so a crossing can fade it in', async () => {
    const { container } = render(inWorld(<Smoke surface="hud" />));
    await ready();
    expect(rgba(layers(container)[2]!)[3]).toBe(0);
  });

  it('chooses the recipe by the surface', async () => {
    const { container } = render(inWorld(<Smoke surface="hand" />));
    await ready();
    expect(layers(container).map((e) => rgba(e)[3])).toEqual([0.6, 0.4, 0.2]);
  });

  it('shows the ground alone until the rasters are ready, then draws over it', async () => {
    let finish: (u: string) => void = () => {};
    fieldRasters.setRasterizer(() => new Promise<string>((res) => { finish = res; }));
    const { container } = render(inWorld(<Smoke surface="hud" />));
    await ready();
    expect(layers(container)).toHaveLength(0);
    expect(container.querySelector('[data-kb-ground]')).not.toBeNull();
    /* Its data mark is there from the start: the surface says what it will draw. */
    expect(container.querySelector('[data-kb-smoke]')).not.toBeNull();
    fieldRasters.setRasterizer(instant);
    finish('blob:late/0');
    await ready();
    expect(layers(container).length).toBeGreaterThan(0);
  });

  it('draws no smoke element under off, and keeps the ground', async () => {
    const { container } = render(inWorld(<Smoke surface="hud" level="off" />));
    await ready();
    expect(container.querySelector('[data-kb-smoke]')).toBeNull();
    expect(layers(container)).toHaveLength(0);
    expect(container.querySelector('[data-kb-ground]')).not.toBeNull();
    expect(made).toBe(0);
  });

  it('draws a third of each layer\'s opacity under low', async () => {
    const { container } = render(inWorld(<Smoke surface="hud" level="low" />));
    await ready();
    const got = layers(container).map((e) => rgba(e)[3]!);
    expect(got[0]).toBeCloseTo(1 / 3, 3);
    expect(got[1]).toBeCloseTo(0.55 / 3, 3);
    expect(got[2]).toBe(0);
  });

  it('takes the player\'s preference from the root when no level is given, and follows it when it changes', async () => {
    const root = document.documentElement;
    root.setAttribute('data-kb-smoke-level', 'off');
    const { container } = render(inWorld(<Smoke surface="hud" />));
    await ready();
    expect(container.querySelector('[data-kb-smoke]')).toBeNull();
    expect(container.querySelector('[data-kb-ground]')).not.toBeNull();
    await act(async () => { root.setAttribute('data-kb-smoke-level', 'low'); await Promise.resolve(); });
    await ready();
    expect(rgba(layers(container)[0]!)[3]).toBeCloseTo(1 / 3, 3);
    await act(async () => { root.removeAttribute('data-kb-smoke-level'); await Promise.resolve(); });
    expect(rgba(layers(container)[0]!)[3]).toBe(1);
  });

  it('draws the field\'s narrow layers below 600px, in the recipe\'s narrow colors, else its first colors', async () => {
    narrow = true;
    const deep = render(inWorld(<Smoke surface="hud" />));
    await ready();
    expect(layers(deep.container).map((e) => rgba(e))).toEqual([[0x80, 0x40, 0xff, 0.6]]);
    deep.unmount();
    const plain = render(inWorld(<Smoke surface="hand" />));
    await ready();
    expect(layers(plain.container).map((e) => rgba(e))).toEqual([[0x00, 0xe0, 0xff, 0.6]]);
  });

  it('moves to the other set when the width class changes, and gives the old rasters back', async () => {
    const { container } = render(inWorld(<Smoke surface="hud" />));
    await ready();
    expect(layers(container)).toHaveLength(3);
    const first = fieldRasters.get().urls;
    expect(first).toHaveLength(3);
    narrow = true;
    await act(async () => { for (const f of narrowListeners) f({ matches: true }); });
    await ready();
    expect(layers(container)).toHaveLength(1);
    expect(fieldRasters.get().urls).toHaveLength(1);
    expect(fieldRasters.get().urls).not.toEqual(first);
    /* Not only replaced: every one of the old set was revoked, and none of the new. */
    expect(revoked).toEqual(first);
    expect(revoked).not.toContain(fieldRasters.get().urls[0]);
  });

  it('gives every raster back once smoke goes off and the grace has passed', async () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(inWorld(<Smoke surface="hud" />));
      await ready();
      const urls = fieldRasters.get().urls.filter((u): u is string => u !== null);
      expect(urls).toHaveLength(3);
      rerender(inWorld(<Smoke surface="hud" level="off" />));
      await ready();
      expect(layers(container)).toHaveLength(0);
      expect(revoked).toEqual([]);
      await act(async () => { await vi.advanceTimersByTimeAsync(GRACE_MS); });
      expect(revoked.sort()).toEqual([...urls].sort());
    } finally { vi.useRealTimers(); }
  });

  it('draws only the wide layers where the field has no narrow ones, at any width', async () => {
    narrow = true;
    const bare = { ui: { glass: { ...glass, smoke: { ...glass.smoke, field: { layers: glass.smoke.field.layers } } } } } as unknown as Kayfa;
    const { container } = render(<KayfaProvider value={bare}><Smoke surface="hud" /></KayfaProvider>);
    await ready();
    expect(layers(container)).toHaveLength(3);
  });

  it('is hidden from the accessibility tree: it says nothing', () => {
    const { container } = render(inWorld(<Smoke surface="hud" />));
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('puts an opaque ground under the smoke, before the smoke in the document', async () => {
    const { container } = render(inWorld(<Smoke surface="hud" />));
    await ready();
    const ground = container.querySelector<HTMLElement>('[data-kb-ground]');
    const smoke = container.querySelector('[data-kb-smoke]');
    expect(ground!.style.background).toBe('var(--kb-glass-ground)');
    expect(ground!.compareDocumentPosition(smoke!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the data marks the rendered measurement reads: the surface on the window, the recipe on the layers', async () => {
    const { container } = render(inWorld(<Smoke surface="log" />));
    await ready();
    expect(container.querySelector('.kb-smoke')).toHaveAttribute('data-kb-surface', 'log');
    expect(container.querySelector('.kb-smoke-layers')).toHaveAttribute('data-kb-smoke', 'deep');
  });
});

describe('the crossing', () => {
  it('changes each layer\'s color on the same elements when the surface changes, never remounting them', async () => {
    const { container, rerender } = render(inWorld(<Smoke surface="hand" />));
    await ready();
    const before = layers(container);
    const colors = before.map((e) => rgba(e));
    rerender(inWorld(<Smoke surface="hud" />));
    await ready();
    const after = layers(container);
    expect(after).toHaveLength(before.length);
    after.forEach((e, i) => expect(e).toBe(before[i]));
    expect(after.map((e) => rgba(e))).not.toEqual(colors);
    expect(rgba(after[0]!)).toEqual([0x80, 0x40, 0xff, 1]);
  });

  it('does the same on one mounted Page moving from the Vending Machine\'s surface to the log\'s', async () => {
    function Moves() {
      const [surface, set] = useState<'vending' | 'log'>('vending');
      return <><button type="button" onClick={() => set('log')}>Cross</button><Page surface={surface}><p>page</p></Page></>;
    }
    const { container } = renderInWorld(<Moves />, { path: '/vending', glass: { ...testGlass, smoke: glass.smoke } });
    await ready();
    const before = layers(container);
    expect(before).toHaveLength(3);
    const colors = before.map((e) => rgba(e));
    await act(async () => { await userEvent.click(screen.getByRole('button', { name: 'Cross' })); });
    await ready();
    const after = layers(container);
    after.forEach((e, i) => expect(e).toBe(before[i]));
    expect(after.map((e) => rgba(e))).not.toEqual(colors);
    expect(container.querySelector('.kb-smoke')).toHaveAttribute('data-kb-surface', 'log');
  });

  it('shares one set of rasters between windows: two surfaces make three URLs, not six', async () => {
    render(inWorld(<><Smoke surface="hud" /><Smoke surface="hand" /></>));
    await ready();
    expect(made).toBe(3);
  });
});

describe('the windows', () => {
  /** Puts each window's own element where a test says it is, and the viewport as jsdom has it. */
  function place(at: Record<string, { left: number; top: number; width?: number }>, laidOut?: number) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const p = at[this.dataset.kbSurface ?? ''] ?? { left: 0, top: 0 };
      return { left: p.left, top: p.top, right: p.left + (p.width ?? 100), bottom: p.top + 100, width: p.width ?? 100, height: 100, x: p.left, y: p.top, toJSON: () => ({}) } as DOMRect;
    });
    if (laidOut !== undefined) vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(laidOut);
  }
  const translate = (el: HTMLElement) => [el.style.getPropertyValue('--kb-field-x'), el.style.getPropertyValue('--kb-field-y')];

  it('translates each layer by minus its window\'s own place, so two windows differ by exactly their offset', async () => {
    place({ hud: { left: 120, top: 700 }, log: { left: 0, top: 0 } });
    const { container } = render(inWorld(<><div id="a"><Smoke surface="log" /></div><div id="b"><Smoke surface="hud" /></div></>));
    await ready();
    const [a, b] = [container.querySelector<HTMLElement>('#a .kb-smoke-layer')!, container.querySelector<HTMLElement>('#b .kb-smoke-layer')!];
    expect(translate(a)).toEqual(['0px', '0px']);
    expect(translate(b)).toEqual(['-120px', '-700px']);
    expect(Number.parseFloat(translate(a)[0]!) - Number.parseFloat(translate(b)[0]!)).toBe(120);
    expect(Number.parseFloat(translate(a)[1]!) - Number.parseFloat(translate(b)[1]!)).toBe(700);
  });

  it('sizes each layer to the viewport plus its own travel, so the drift never bares an edge', async () => {
    const { container } = render(inWorld(<Smoke surface="hud" />));
    await ready();
    const [w, h] = [document.documentElement.clientWidth || window.innerWidth, window.innerHeight];
    expect(layers(container).map((e) => [e.style.width, e.style.height])).toEqual([
      [`${w + 120}px`, `${h}px`], [`${w + 90}px`, `${h}px`], [`${w + 60}px`, `${h}px`],
    ]);
  });

  it('measures again when the window resizes, and when its own box changes size (a drawer opened)', async () => {
    place({ hud: { left: 0, top: 500 } });
    const { container } = render(inWorld(<Smoke surface="hud" />));
    await ready();
    expect(translate(layers(container)[0]!)).toEqual(['0px', '-500px']);
    place({ hud: { left: 0, top: 640 } });
    await act(async () => { window.dispatchEvent(new Event('resize')); await new Promise((r) => requestAnimationFrame(() => r(null))); });
    expect(translate(layers(container)[0]!)).toEqual(['0px', '-640px']);
  });

  it('measures again when an overlay says it has placed itself', async () => {
    place({ hud: { left: 0, top: 10 } });
    const { container } = render(inWorld(<Smoke surface="hud" />));
    await ready();
    place({ hud: { left: 33, top: 77 } });
    await act(async () => { window.dispatchEvent(new Event('kb-field-placed')); await new Promise((r) => requestAnimationFrame(() => r(null))); });
    expect(translate(layers(container)[0]!)).toEqual(['-33px', '-77px']);
  });

  it('works in its own pixels inside a zoomed window (the HUD below 1440px): sizes and offsets divide by the zoom', async () => {
    /* The window is drawn at half scale: 100px of its box is 50px on screen. */
    place({ hud: { left: 100, top: 400, width: 50 } }, 100);
    const { container } = render(inWorld(<Smoke surface="hud" />));
    await ready();
    const el = layers(container)[0]!;
    const [w, h] = [document.documentElement.clientWidth || window.innerWidth, window.innerHeight];
    expect(translate(el)).toEqual(['-200px', '-800px']);
    expect(el.style.width).toBe(`${(w + 120) * 2}px`);
    expect(el.style.height).toBe(`${h * 2}px`);
    expect(el.style.getPropertyValue('--kb-field-travel')).toBe('240px');
  });
});

describe('the drift clock', () => {
  it('starts each layer at a negative delay from the page\'s clock, so a window that mounts later is in phase', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(100_000);
    const { container } = render(inWorld(<Smoke surface="hud" />));
    await ready();
    const els = layers(container);
    /* 100s into the page: a layer of 28s runs back and forth in 56s, so it is 44s in; 40s in 80s: 20s; 60s in 120s: 100s. */
    expect(els.map((e) => e.style.getPropertyValue('--kb-field-delay'))).toEqual(['-44s', '-20s', '-100s']);
    expect(els.map((e) => e.style.getPropertyValue('--kb-field-seconds'))).toEqual(['28s', '40s', '60s']);
    expect(els.map((e) => e.style.getPropertyValue('--kb-field-travel'))).toEqual(['120px', '90px', '60px']);
  });

  it('is the same phase in a window that mounts later: delay and time since the mount add up to the same point of the cycle', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(10_000);
    const first = render(inWorld(<Smoke surface="hud" />));
    await ready();
    now.mockReturnValue(31_000);
    const second = render(inWorld(<Smoke surface="hand" />));
    await ready();
    const delay = (c: HTMLElement) => Number.parseFloat(layers(c)[0]!.style.getPropertyValue('--kb-field-delay'));
    /* At 31s: the first window's layer is 21s into its run on top of its start, the second's has just begun. */
    const cycle = 56;
    const phaseAt31 = (d: number, mountedAt: number) => (((-d + (31 - mountedAt)) % cycle) + cycle) % cycle;
    expect(phaseAt31(delay(first.container), 10)).toBeCloseTo(phaseAt31(delay(second.container), 31), 6);
  });

  it('keeps its delay when the surface changes, so a crossing does not restart the drift', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(5_000);
    const { container, rerender } = render(inWorld(<Smoke surface="hand" />));
    await ready();
    const first = layers(container).map((e) => e.style.getPropertyValue('--kb-field-delay'));
    now.mockReturnValue(9_000);
    rerender(inWorld(<Smoke surface="hud" />));
    await ready();
    expect(layers(container).map((e) => e.style.getPropertyValue('--kb-field-delay'))).toEqual(first);
  });

  /* A layer element is only drawn once its raster is ready, so its phase is the clock then, not at its window's mount. */
  it('takes a layer\'s delay when its element is first drawn, not when its window mounted', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000);
    const answers: ((u: string) => void)[] = [];
    fieldRasters.setRasterizer(() => new Promise<string>((res) => { answers.push(res); }));
    const { container } = render(inWorld(<Smoke surface="hud" />));
    await ready();
    expect(layers(container)).toHaveLength(0);
    now.mockReturnValue(50_000);
    await act(async () => { answers.forEach((r, i) => r(`blob:slow/${i}`)); await Promise.resolve(); });
    await ready();
    /* 50s into the page: the 28s layer's run is 56s, so it is 50s in. */
    expect(layers(container)[0]!.style.getPropertyValue('--kb-field-delay')).toBe('-50s');
  });

  it('gives two windows mounted at different times the same delay for elements drawn on the same tick', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(10_000);
    const answers: ((u: string) => void)[] = [];
    fieldRasters.setRasterizer(() => new Promise<string>((res) => { answers.push(res); }));
    const first = render(inWorld(<Smoke surface="hud" />));
    await ready();
    now.mockReturnValue(20_000);
    const second = render(inWorld(<Smoke surface="hand" />));
    await ready();
    now.mockReturnValue(30_000);
    await act(async () => { answers.forEach((r, i) => r(`blob:slow/${i}`)); await Promise.resolve(); });
    await ready();
    const delays = (c: HTMLElement) => layers(c).map((e) => e.style.getPropertyValue('--kb-field-delay'));
    expect(delays(first.container)).toHaveLength(3);
    expect(delays(second.container)).toEqual(delays(first.container));
    expect(delays(first.container)[0]).toBe('-30s');
  });

  it('draws a layer that comes back (after off) at the clock then, and keeps it through a crossing', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(5_000);
    const { container, rerender } = render(inWorld(<Smoke surface="hand" />));
    await ready();
    expect(layers(container)[0]!.style.getPropertyValue('--kb-field-delay')).toBe('-5s');
    rerender(inWorld(<Smoke surface="hand" level="off" />));
    await ready();
    now.mockReturnValue(40_000);
    rerender(inWorld(<Smoke surface="hand" />));
    await ready();
    expect(layers(container)[0]!.style.getPropertyValue('--kb-field-delay')).toBe('-40s');
    now.mockReturnValue(41_000);
    rerender(inWorld(<Smoke surface="hud" />));
    await ready();
    expect(layers(container)[0]!.style.getPropertyValue('--kb-field-delay')).toBe('-40s');
  });

  it('hears a burst of resizes as one, for every window together, once a frame', async () => {
    render(inWorld(<><Smoke surface="hud" /><Smoke surface="hand" /><Smoke surface="log" /></>));
    await ready();
    const before = mediaCalls;
    await act(async () => {
      for (let i = 0; i < 10; i++) window.dispatchEvent(new Event('resize'));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(mediaCalls - before).toBeLessThanOrEqual(1);
  });
});

describe('what a window listens to', () => {
  const reads = () => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
  const flush = () => act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });

  it('re-measures a window in the page\'s flow when the page scrolls', async () => {
    const spy = reads();
    render(inWorld(<div><Smoke surface="log" /></div>));
    await ready();
    spy.mockClear();
    await act(async () => { window.dispatchEvent(new Event('scroll')); });
    await flush();
    expect(spy).toHaveBeenCalled();
  });

  it('does not re-measure a fixed window when the page scrolls, and does when what it is fixed in scrolls', async () => {
    const spy = reads();
    const { container } = render(inWorld(<div data-testid="fixed" style={{ position: 'fixed' }}><div><Smoke surface="hud" /></div></div>));
    await ready();
    spy.mockClear();
    await act(async () => { window.dispatchEvent(new Event('scroll')); });
    await flush();
    expect(spy).not.toHaveBeenCalled();
    await act(async () => { container.querySelector('[data-testid="fixed"]')!.dispatchEvent(new Event('scroll')); });
    await flush();
    expect(spy).toHaveBeenCalled();
  });
});
