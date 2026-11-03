/**
 * Feelin' Fab's effect (docs/plans/2026-11-02-onboarding-design.md, sections 5 and 6): a rainbow under the post's words, by the
 * count of Feelin' Fabs up on the post. Level 1 cycles the rainbow's stops slowly, level 2 is an animated linear rainbow, level 3 an
 * animated radial one; twinkles on all of them. Decoration, so its accessible path is reduced motion alone, which holds level 1 on
 * one stop chosen on each load in the reader's own browser, leaves levels 2 and 3 as still gradients and the twinkles where they are.
 * The animation runs only while the post is in view, and every stop holds the theme's post text at 4.5:1.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ratio, tokensOf } from '../../../../engine/ui/contrast.ts';
import type { Act } from '../../../../engine/ui/data/api.ts';
import type { CardPlay, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { FAB_STOPS, FAB_TWINKLE, FeelinFabEffect, stopsAreReadable } from './Effect.tsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => fs.readFileSync(path.resolve(here, p), 'utf8');

const post: Act = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: '2026-11-02T12:00:00Z', payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null, shownEditedAt: null };
const playOf = (n: number): CardPlay => ({ id: `f${n}`, card: 'feelin-fab', layer: n, caster: 'c2', message: '', config: {}, playedAt: '2026-11-02T12:00:00Z', post: 'p1' });
const props = (level: number): EffectProps => ({
  post, plays: Array.from({ length: level }, (_, i) => playOf(i + 1)), states: {}, released: new Set(), reader: { author: false, caster: false }, place: 'thread', reach: 'post', still: false,
  show: () => {}, met: () => {}, holdScreen: () => {}, marks: null, save: async () => ({ ok: false, error: 'no' }), release: async () => ({ ok: false, error: 'no' }), nameOf: () => 'Spritey',
  children: <p data-kb-words>Hello there.</p>,
});
const box = () => document.querySelector('[data-kb-fab]') as HTMLElement;
const twinkles = () => box().querySelectorAll('.dw-fab-twinkle').length;

/** A fake IntersectionObserver the test drives, and counts the observers made. */
let observers: { cb: IntersectionObserverCallback; seen: Set<Element> }[] = [];
class FakeObserver {
  readonly entry = { cb: undefined as unknown as IntersectionObserverCallback, seen: new Set<Element>() };
  constructor(cb: IntersectionObserverCallback) { this.entry.cb = cb; observers.push(this.entry); }
  observe(el: Element) { this.entry.seen.add(el); }
  unobserve(el: Element) { this.entry.seen.delete(el); }
  disconnect() { this.entry.seen.clear(); }
  takeRecords() { return []; }
}
const see = (el: Element, isIntersecting: boolean) => act(() => { for (const o of observers) if (o.seen.has(el)) o.cb([{ target: el, isIntersecting } as IntersectionObserverEntry], o as unknown as IntersectionObserver); });

beforeEach(() => {
  observers = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  document.documentElement.setAttribute('data-kb-motion', 'full');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-kb-motion');
});

describe("Feelin' Fab", () => {
  test('each level draws its own rainbow under the words, with its stops, and twinkles that grow with the level', () => {
    const seen: number[] = [];
    for (const level of [1, 2, 3]) {
      const { unmount } = render(<FeelinFabEffect {...props(level)} />);
      expect(box()).toHaveAttribute('data-kb-level', String(level));
      expect(box()).toHaveClass(`dw-fab-${['', 'cycle', 'linear', 'radial'][level]}`);
      expect(box().querySelector('[data-kb-words]')).toHaveTextContent('Hello there.');
      expect(box().querySelector('.dw-fab-ground')).toHaveAttribute('aria-hidden', 'true');
      seen.push(twinkles());
      unmount();
    }
    expect(seen[0]).toBeGreaterThanOrEqual(3);
    expect(seen[1]).toBeGreaterThan(seen[0]!);
    expect(seen[2]).toBeGreaterThanOrEqual(seen[1]!);
    expect(FAB_STOPS.light).toHaveLength(FAB_STOPS.dark.length);
    expect(FAB_STOPS.light.length).toBeGreaterThanOrEqual(6);
  });

  test('the palettes are one list in FAB_STOPS, passed as the post\'s style (the CSSOM), and no style element is ever created', () => {
    const before = document.querySelectorAll('style').length;
    render(<><FeelinFabEffect {...props(1)} /><FeelinFabEffect {...props(2)} /></>);
    expect(document.querySelectorAll('style')).toHaveLength(before);
    expect(document.querySelector('style[data-dw-fab-palette]')).toBeNull();
    for (const b of document.querySelectorAll<HTMLElement>('[data-kb-fab]')) {
      for (const [i, stop] of FAB_STOPS.light.entries()) expect(b.style.getPropertyValue(`--dw-fab-light-${i + 1}`)).toBe(stop);
      for (const [i, stop] of FAB_STOPS.dark.entries()) expect(b.style.getPropertyValue(`--dw-fab-dark-${i + 1}`)).toBe(stop);
      expect(b.style.getPropertyValue('--dw-fab-twinkle-light')).toBe(FAB_TWINKLE.light);
      expect(b.style.getPropertyValue('--dw-fab-twinkle-dark')).toBe(FAB_TWINKLE.dark);
    }
  });

  test('the reason is pinned: the site\'s style-src allows no inline style, so the palette cannot be a style element', () => {
    const headers = read('../../../../web/headers.ts');
    const styleSrc = /"(style-src[^"]*)"/u.exec(headers)?.[1] ?? '';
    expect(styleSrc).toMatch(/^style-src 'self'/u);
    expect(styleSrc).not.toContain("'unsafe-inline'");
  });

  test('a level is the number of Feelin\' Fabs up, and never more than three', () => {
    render(<FeelinFabEffect {...props(5)} />);
    expect(box()).toHaveAttribute('data-kb-level', '3');
  });

  test('twinkles are placed from the post\'s plays, so every reader sees the same ones', () => {
    const at = () => [...box().querySelectorAll<HTMLElement>('.dw-fab-twinkle')].map((t) => `${t.style.left}/${t.style.top}`).join();
    const a = render(<FeelinFabEffect {...props(2)} />); const first = at(); a.unmount();
    const b = render(<FeelinFabEffect {...props(2)} />);
    expect(at()).toBe(first);
    b.unmount();
  });

  test('moving: the ground animates, and level 1 is not pinned to one stop', () => {
    render(<FeelinFabEffect {...props(1)} />);
    expect(box()).toHaveAttribute('data-kb-moving', 'true');
    expect(box().style.getPropertyValue('--dw-fab-still')).toBe('');
    for (const t of box().querySelectorAll<HTMLElement>('.dw-fab-twinkle')) expect(t.style.animationName).toBe('');
  });

  test('in a play\'s moment (still) the rainbow still moves, at the level the moment caught: a moment holds its state, not its decoration', () => {
    for (const level of [1, 2, 3]) {
      const { unmount } = render(<FeelinFabEffect {...props(level)} still />);
      expect(box()).toHaveAttribute('data-kb-moving', 'true');
      expect(box()).toHaveAttribute('data-kb-level', String(level));
      expect(box()).not.toHaveAttribute('data-kb-still');
      unmount();
    }
  });

  test('in a play\'s moment, reduced motion holds it still as it does live', () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    render(<FeelinFabEffect {...props(1)} still />);
    expect(box()).toHaveAttribute('data-kb-moving', 'false');
    expect(box()).toHaveAttribute('data-kb-still');
  });

  test('reduced motion holds still: level 1 sits on one of the stops chosen at random on each load, levels 2 and 3 stay gradients, twinkles stay', () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    const picks = new Set<string>();
    for (const roll of [0, 0.3, 0.99]) {
      vi.spyOn(Math, 'random').mockReturnValue(roll);
      const { unmount } = render(<FeelinFabEffect {...props(1)} />);
      expect(box()).toHaveAttribute('data-kb-moving', 'false');
      const still = box().style.getPropertyValue('--dw-fab-still');
      expect(still).toMatch(/^\d+$/u);
      expect(Number(still)).toBeGreaterThanOrEqual(1);
      expect(Number(still)).toBeLessThanOrEqual(FAB_STOPS.light.length);
      picks.add(still);
      unmount();
      vi.restoreAllMocks();
    }
    expect(picks.size).toBeGreaterThan(1);
    for (const level of [2, 3]) {
      const { unmount } = render(<FeelinFabEffect {...props(level)} />);
      expect(box()).toHaveAttribute('data-kb-moving', 'false');
      expect(box().style.getPropertyValue('--dw-fab-still')).toBe('');
      expect(box()).toHaveClass(level === 2 ? 'dw-fab-linear' : 'dw-fab-radial');
      expect(twinkles()).toBeGreaterThan(0);
      unmount();
    }
    const css = read('fab.css').replace(/\/\*[\s\S]*?\*\//gu, '');
    expect(css).toMatch(/\.dw-fab\[data-kb-moving="false"\][^{]*\{[^}]*animation:\s*none/u);
    /* The device's setting is read once, by useMotionReduced (the player's override first); no bare media query may stop the animation past a player's "full". */
    expect(css).not.toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{(?![^{]*:root:not\(\[data-kb-motion=)/u);
  });

  test('a player who chose full motion moves under a device that asks for reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('prefers-reduced-motion'), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    document.documentElement.setAttribute('data-kb-motion', 'full');
    render(<FeelinFabEffect {...props(1)} />);
    expect(box()).toHaveAttribute('data-kb-moving', 'true');
    expect(box().style.getPropertyValue('--dw-fab-still')).toBe('');
    expect(box()).not.toHaveAttribute('data-kb-still');
    for (const t of box().querySelectorAll<HTMLElement>('.dw-fab-twinkle')) expect(t.style.animationName).toBe('');
    const css = read('fab.css').replace(/\/\*[\s\S]*?\*\//gu, '');
    expect(css).not.toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{(?![^{]*:root:not\(\[data-kb-motion=)/u);
  });

  test('with no choice made, the device\'s reduced motion holds the post still', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('prefers-reduced-motion'), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    document.documentElement.removeAttribute('data-kb-motion');
    render(<FeelinFabEffect {...props(1)} />);
    expect(box()).toHaveAttribute('data-kb-moving', 'false');
    expect(box().style.getPropertyValue('--dw-fab-still')).toMatch(/^\d+$/u);
  });

  test('the still stop is picked in the reader\'s own browser: it is never sent, stored or read from the play', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const fetched = vi.fn();
    vi.stubGlobal('fetch', fetched);
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    render(<FeelinFabEffect {...props(1)} />);
    expect(setItem).not.toHaveBeenCalled();
    expect(fetched).not.toHaveBeenCalled();
  });

  test('holds still the moment the player reduces motion, and moves again when they undo it', async () => {
    render(<FeelinFabEffect {...props(1)} />);
    expect(box()).toHaveAttribute('data-kb-moving', 'true');
    await act(async () => { document.documentElement.setAttribute('data-kb-motion', 'reduce'); });
    await waitFor(() => expect(box()).toHaveAttribute('data-kb-moving', 'false'));
    expect(box().style.getPropertyValue('--dw-fab-still')).toMatch(/^\d+$/u);
    await act(async () => { document.documentElement.setAttribute('data-kb-motion', 'full'); });
    await waitFor(() => expect(box()).toHaveAttribute('data-kb-moving', 'true'));
  });

  test('the animation runs only while the post is in view, and one observer serves every post on the page', async () => {
    render(<><FeelinFabEffect {...props(1)} /><FeelinFabEffect {...props(2)} /><FeelinFabEffect {...props(3)} /></>);
    expect(observers).toHaveLength(1);
    const boxes = [...document.querySelectorAll<HTMLElement>('[data-kb-fab]')];
    expect(boxes).toHaveLength(3);
    expect(observers[0]!.seen.size).toBe(3);
    for (const b of boxes) expect(b).toHaveAttribute('data-kb-running', 'false');
    await see(boxes[1]!, true);
    expect(boxes.map((b) => b.getAttribute('data-kb-running'))).toEqual(['false', 'true', 'false']);
    await see(boxes[1]!, false);
    expect(boxes[1]).toHaveAttribute('data-kb-running', 'false');
    const css = read('fab.css').replace(/\/\*[\s\S]*?\*\//gu, '');
    expect(css).toMatch(/\[data-kb-running="false"\][^{]*\{[^}]*animation-play-state:\s*paused/u);
  });

  test('where the browser has no observer the animation runs rather than freezing', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<FeelinFabEffect {...props(1)} />);
    expect(box()).toHaveAttribute('data-kb-running', 'true');
  });

  test('it animates only transform and opacity, so the compositor moves pre-painted layers and nothing is laid out or repainted', () => {
    const css = read('fab.css').replace(/\/\*[\s\S]*?\*\//gu, '');
    const blocks = [...css.matchAll(/@keyframes[^{]+\{([\s\S]*?)\n\}/gu)].map((m) => m[1]!);
    expect(blocks.length).toBeGreaterThan(0);
    const frames = blocks.join('\n');
    const props = new Set([...frames.matchAll(/([a-z-]+)\s*:/gu)].map((m) => m[1]!));
    expect([...props].filter((p) => p !== 'opacity' && p !== 'transform')).toEqual([]);
    expect(props.has('transform')).toBe(true);
    expect(props.has('opacity')).toBe(true);
    /* The gradient sits on a layer the compositor moves, and a twinkle is a drawn shape, not a clipped box. */
    expect(css).not.toMatch(/background-position/u);
    expect(css).not.toMatch(/clip-path/u);
    /* The big layer is promoted only on a post that moves (a held one is a flat color); the twinkles stay promoted (see fab.css). */
    expect(css).not.toMatch(/(^|\n)\.dw-fab-layer\s*\{[^}]*will-change/u);
    expect(css).toMatch(/\.dw-fab\[data-kb-moving="true"\]\s*\.dw-fab-layer\s*\{[^}]*will-change:\s*transform/u);
    expect(css).toMatch(/\.dw-fab-cycle\[data-kb-moving="false"\]\s*\.dw-fab-layer\s*\{[^}]*width:\s*100%/u);
    expect(css).toMatch(/\.dw-fab-twinkle\s*\{[^}]*animation-name:\s*dw-fab-twinkle/u);
    expect(css).not.toMatch(/(^|\n)\.dw-fab-twinkle\s*\{[^}]*will-change/u);
    expect(css).toMatch(/\.dw-fab\[data-kb-moving="true"\]\s*\.dw-fab-twinkle\s*\{[^}]*will-change:\s*transform,\s*opacity/u);
    expect(css).toMatch(/\.dw-fab-ground\s*\{[^}]*overflow:\s*hidden/u);
  });

  test('the rainbow is a layer inside the clipping ground, and the post keeps its own layout', () => {
    render(<FeelinFabEffect {...props(2)} />);
    expect(box().querySelector('.dw-fab-ground > .dw-fab-layer')).not.toBeNull();
    expect(box().querySelectorAll('.dw-fab-ground > .dw-fab-twinkle').length).toBeGreaterThan(0);
  });

  test('the words keep a text shadow, are drawn above the rainbow, and take no pointer from the ground', () => {
    const css = read('fab.css').replace(/\/\*[\s\S]*?\*\//gu, '');
    const rule = (selector: string) => { const at = css.indexOf(`${selector} {`); return at < 0 ? '' : css.slice(at, css.indexOf('}', at)); };
    expect(rule('.dw-fab-words')).toMatch(/text-shadow:\s*[^;]*var\(--kb-bg\)/u);
    expect(rule('.dw-fab-words')).toMatch(/z-index:\s*1/u);
    expect(rule('.dw-fab-ground')).toMatch(/pointer-events:\s*none/u);
    expect(rule('.dw-fab-ground')).toMatch(/z-index:\s*0/u);
  });
});

describe("Feelin' Fab's palettes", () => {
  const tokens = tokensOf(read('../../../../engine/ui/tokens.css'), read('../theme.css'));
  const lightModes = ['light', 'light (chosen)'] as const;
  const darkModes = ['dark', 'dark (device)'] as const;

  test('every stop holds the theme\'s post text at 4.5:1: pastels under black text, deep under white', () => {
    for (const mode of lightModes) for (const stop of FAB_STOPS.light) expect(ratio(tokens[mode]['--kb-fg']!, stop), `${mode}: ${stop}`).toBeGreaterThanOrEqual(4.5);
    for (const mode of darkModes) for (const stop of FAB_STOPS.dark) expect(ratio(tokens[mode]['--kb-fg']!, stop), `${mode}: ${stop}`).toBeGreaterThanOrEqual(4.5);
    for (const mode of lightModes) expect(ratio(tokens[mode]['--kb-fg']!, FAB_TWINKLE.light), `${mode} twinkle`).toBeGreaterThanOrEqual(4.5);
    for (const mode of darkModes) expect(ratio(tokens[mode]['--kb-fg']!, FAB_TWINKLE.dark), `${mode} twinkle`).toBeGreaterThanOrEqual(4.5);
    expect(stopsAreReadable(tokens, FAB_STOPS, FAB_TWINKLE)).toEqual([]);
  });

  test('the post\'s links, visited links and muted words (a quote\'s byline) hold 4.5:1 on every stop and twinkle too, in both themes', () => {
    const words = ['--kb-link', '--kb-link-visited', '--kb-muted'] as const;
    const bad: string[] = [];
    for (const [board, modes] of [['light', lightModes], ['dark', darkModes]] as const) {
      for (const mode of modes) for (const w of words) for (const ink of [...FAB_STOPS[board], FAB_TWINKLE[board]]) {
        const r = ratio(tokens[mode][w]!, ink);
        if (r < 4.5) bad.push(`${mode}: ${w} ${tokens[mode][w]} on ${ink} is ${r.toFixed(2)}:1`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('the check is red on a stop that fails, and names it', () => {
    const poisoned = { light: [...FAB_STOPS.light.slice(0, -1), '#1a237e'], dark: [...FAB_STOPS.dark.slice(0, -1), '#ffff66'] };
    const failures = stopsAreReadable(tokens, poisoned, FAB_TWINKLE);
    expect(failures.join('\n')).toMatch(/light.*#1a237e/u);
    expect(failures.join('\n')).toMatch(/dark.*#ffff66/u);
  });

  test('the stylesheet carries no color of its own: every stop and twinkle comes from the palettes', () => {
    const css = read('fab.css').replace(/\/\*[\s\S]*?\*\//gu, '');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/iu);
  });
});
