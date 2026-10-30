/**
 * The smoke's behavior (docs/plans/2026-10-29-screens-web-plan.md, Task 1; the glass plan's
 * section 6): none drawn under `off`; a third of each layer's opacity under `low`; still under
 * reduced motion; and the ground opaque under it before it draws and when it never does. jsdom
 * paints nothing, so these read the elements and their attributes: what the page looks like is
 * tools/check-glass-contrast.mjs's model and e2e/glass-text.spec.ts's measurement (Part 2, not yet written).
 */
import { act, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import type { GlassTheme, SmokeLayer } from '../types.ts';
import { Smoke } from './Smoke.tsx';

const layer = (color: string, opacity: number, seed: number): SmokeLayer => ({
  color, opacity, alpha: [0, 0, 0, 1.8, -0.74], frequency: [0.01, 0.02], octaves: 3, seed, blur: 9,
});

/** A glass of two recipes: one drifting with a narrow variant, one plain. */
const glass = {
  keys: { standard: {}, high: {} },
  smoke: {
    recipes: {
      deep: { layers: [layer('#8040ff', 1, 3), layer('#00e0ff', 0.55, 7)], drift: { width: 1560, seconds: 28, travel: 120 }, narrow: [layer('#8040ff', 0.6, 3)] },
      calm: { layers: [layer('#8040ff', 0.6, 5)] },
    },
    surfaces: { hud: 'deep', hand: 'calm', play: 'calm', react: 'calm', turn: 'calm', effect: 'calm', vending: 'calm', characters: 'calm', rankings: 'calm', log: 'calm', settings: 'calm', account: 'calm', settlement: 'calm' },
  },
  calm: { opacity: 0.85, feather: 32 },
  sizes: {}, fonts: [], classes: {}, orbs: { gradients: [], body: { core: '', edge: '' } },
} as unknown as GlassTheme;

const world = { ui: { glass } } as unknown as Kayfa;
const inWorld = (node: ReactNode) => <KayfaProvider value={world}>{node}</KayfaProvider>;

const rects = (c: HTMLElement, narrow = false) => [...c.querySelectorAll(narrow ? '[data-kb-smoke-narrow] rect' : '[data-kb-smoke-wide] rect')];
const opacities = (c: HTMLElement, narrow = false) => rects(c, narrow).map((r) => Number(r.getAttribute('opacity')));

afterEach(() => {
  document.documentElement.removeAttribute('data-kb-motion');
  document.documentElement.removeAttribute('data-kb-smoke');
});

describe('Smoke', () => {
  it('draws one rect per layer of the surface\'s recipe at the layer\'s own opacity under full', () => {
    const { container } = render(inWorld(<Smoke surface="hud" />));
    expect(opacities(container)).toEqual([1, 0.55]);
    expect(container.querySelectorAll('feTurbulence')).toHaveLength(3);
  });

  it('chooses the recipe by the surface', () => {
    const { container } = render(inWorld(<Smoke surface="log" />));
    expect(opacities(container)).toEqual([0.6]);
  });

  it('draws no smoke element under off, and keeps the ground', () => {
    const { container } = render(inWorld(<Smoke surface="hud" level="off" />));
    expect(container.querySelector('[data-kb-smoke]')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('[data-kb-ground]')).not.toBeNull();
  });

  it('draws a third of each layer\'s opacity under low', () => {
    const { container } = render(inWorld(<Smoke surface="hud" level="low" />));
    const got = opacities(container);
    expect(got).toHaveLength(2);
    expect(got[0]).toBeCloseTo(1 / 3, 6);
    expect(got[1]).toBeCloseTo(0.55 / 3, 6);
    expect(opacities(container, true)[0]).toBeCloseTo(0.6 / 3, 6);
  });

  it('takes the player\'s preference from the root when no level is given, and follows it when it changes', async () => {
    const root = document.documentElement;
    root.setAttribute('data-kb-smoke', 'off');
    const { container } = render(inWorld(<Smoke surface="hud" />));
    expect(container.querySelector('[data-kb-smoke]')).toBeNull();
    expect(container.querySelector('[data-kb-ground]')).not.toBeNull();
    await act(async () => { root.setAttribute('data-kb-smoke', 'low'); await Promise.resolve(); });
    expect(opacities(container)[0]).toBeCloseTo(1 / 3, 6);
    await act(async () => { root.removeAttribute('data-kb-smoke'); await Promise.resolve(); });
    expect(opacities(container)).toEqual([1, 0.55]);
  });

  it('draws the narrow layers too, for the stylesheet to choose between below 600px', () => {
    const { container } = render(inWorld(<Smoke surface="hud" />));
    expect(opacities(container, true)).toEqual([0.6]);
  });

  it('drifts under full motion: a strip wider than its frame, moving by the recipe\'s travel', () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    const { container } = render(inWorld(<Smoke surface="hud" />));
    const strip = container.querySelector<HTMLElement>('[data-kb-drift]');
    expect(strip).not.toBeNull();
    expect(strip!.style.width).toBe('1560px');
    expect(strip!.style.getPropertyValue('--kb-smoke-seconds')).toBe('28s');
    expect(strip!.style.getPropertyValue('--kb-smoke-travel')).toBe('120px');
  });

  it('draws the same strip under reduced motion, so the still frame is the same crop; the stylesheet stops it', () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    const full = render(inWorld(<Smoke surface="hud" />)).container;
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    const still = render(inWorld(<Smoke surface="hud" />)).container;
    const strip = still.querySelector<HTMLElement>('[data-kb-drift]');
    expect(strip).not.toBeNull();
    expect(strip!.style.width).toBe('1560px');
    expect(opacities(still)).toEqual([1, 0.55]);
    /* Reduced motion is decided in one place, base.css: the render does not branch on it. */
    expect(still.querySelector('[data-kb-drift]')!.outerHTML.length).toBe(full.querySelector('[data-kb-drift]')!.outerHTML.length);
  });

  it('gives two Smokes on one page filter ids that do not meet', () => {
    const { container } = render(inWorld(<><Smoke surface="hud" /><Smoke surface="hud" /></>));
    const ids = [...container.querySelectorAll('filter')].map((f) => f.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    for (const rect of container.querySelectorAll('rect')) {
      const ref = rect.getAttribute('filter')!.match(/url\(#(.+)\)/)![1]!;
      expect(ids, 'every rect points at a filter that exists').toContain(ref);
    }
  });

  it('does not drift a recipe that has no drift', () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    const { container } = render(inWorld(<Smoke surface="log" />));
    expect(container.querySelector('[data-kb-drift]')).toBeNull();
  });

  it('puts an opaque ground under the smoke, before the smoke in the document', () => {
    const { container } = render(inWorld(<Smoke surface="hud" />));
    const ground = container.querySelector<HTMLElement>('[data-kb-ground]');
    const smoke = container.querySelector('[data-kb-smoke]');
    expect(ground).not.toBeNull();
    expect(smoke).not.toBeNull();
    expect(ground!.style.background).toBe('var(--kb-glass-ground)');
    expect(ground!.compareDocumentPosition(smoke!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is hidden from the accessibility tree: it says nothing', () => {
    const { container } = render(inWorld(<Smoke surface="hud" />));
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws each layer\'s color as the matrix\'s constant color, from the data', () => {
    const { container } = render(inWorld(<Smoke surface="log" />));
    const matrix = container.querySelector('feColorMatrix')!;
    const values = matrix.getAttribute('values')!.split(/\s+/).map(Number);
    expect(values).toHaveLength(20);
    expect(values.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(values[4]).toBeCloseTo(0x80 / 255, 3);
    expect(values[9]).toBeCloseTo(0x40 / 255, 3);
    expect(values[14]).toBeCloseTo(1, 3);
    expect(values.slice(15)).toEqual([0, 0, 0, 1.8, -0.74]);
  });

  it('works in sRGB: the boards were drawn there', () => {
    const { container } = render(inWorld(<Smoke surface="log" />));
    expect(container.querySelector('filter')?.getAttribute('color-interpolation-filters')).toBe('sRGB');
  });
});
