/**
 * The calm (engine/ui/glass/Calm.tsx): a region of a page registers its box with the smoke it
 * stands on, and the smoke takes itself away there, one blurred rect for each region
 * (docs/plans/2026-11-05-backfill-boards-design.md, section 3). jsdom lays nothing out and loads no
 * stylesheet, so these stand a box in for each region (the browser's getBoundingClientRect is the
 * one thing replaced) and read the rect the smoke draws and the stylesheets as text, as
 * base.test.tsx does; what the page looks like is e2e/glass-text.spec.ts's measurement.
 *
 * The calm drawn on a surface is also the calm the contrast guard reads it at
 * (tools/check-glass-contrast.mjs, `calmOf`): a recipe's own calm where it has one, the theme's
 * otherwise, set on the surface's own element, which the rect inherits from.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { calmOf } from '../../../tools/check-glass-contrast.mjs';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import type { Fake } from '../data/fake.ts';
import { Frame } from '../frame/Frame.tsx';
import { renderInWorld, testGlass } from '../test-world.tsx';
import type { GlassSurface, GlassTheme } from '../types.ts';
import { surfaceCalm } from './apply.ts';
import { CalmRegion, MAX_WATCHED } from './Calm.tsx';
import { Overlay } from './Overlay.tsx';
import { Page } from './Page.tsx';
import { Smoke } from './Smoke.tsx';

/** testGlass with a recipe of its own calm, 0.6 against the theme's 0.85, on some surfaces and not others. */
const glass = {
  ...testGlass,
  smoke: {
    field: { layers: [] },
    recipes: { plain: { colors: [] }, own: { colors: [], calm: 0.6 } },
    surfaces: { ...testGlass.smoke.surfaces, characters: 'own', react: 'own', hud: 'own', hand: 'own' },
  },
} as unknown as GlassTheme;

const recipeOf = (surface: GlassSurface) => glass.smoke.recipes[glass.smoke.surfaces[surface]]!;
/** What the guard reads the surface's text at. */
const guarded = (surface: GlassSurface): number => calmOf(glass, recipeOf(surface));

/** The calm's opacity the rects drawn under `el` take: the nearest that sets it, else the theme's on the root. */
function drawn(el: Element): number {
  for (let at: Element | null = el; at; at = at.parentElement) {
    const v = (at as HTMLElement).style?.getPropertyValue('--kb-glass-calm-opacity');
    if (v) return Number(v);
  }
  return glass.calm.opacity;
}

const signedIn = (fake: Fake) => fake.signInAs(fake.seed.account('me'));

describe('the calm drawn on a surface is the calm the guard reads it at', { timeout: 15_000 }, () => {
  test('a recipe with its own calm sets it on its surface; one without leaves the theme\'s', () => {
    expect(surfaceCalm(glass, 'characters')).toEqual({ '--kb-glass-calm-opacity': '0.6' });
    expect(surfaceCalm(glass, 'settings')).toBeUndefined();
  });
  for (const surface of ['characters', 'settings'] as const) {
    test(`a glass page on the ${surface} surface`, async () => {
      const { container } = renderInWorld(<Page surface={surface}><CalmRegion><p>words</p></CalmRegion></Page>, { path: '/settings', seed: signedIn, glass });
      expect(guarded(surface)).toBe(surface === 'characters' ? 0.6 : 0.85);
      await screen.findByText('words');
      const rect = container.querySelector<HTMLElement>('.kb-smoke-calm')!;
      expect(rect).not.toBeNull();
      expect(drawn(rect)).toBe(guarded(surface));
    });
  }
  test('an overlay on its own surface, though it is drawn outside the page that opened it', async () => {
    renderInWorld(
      <Page surface="settings"><Overlay title="React" surface="react" onClose={() => {}}><CalmRegion><p>in the overlay</p></CalmRegion></Overlay></Page>,
      { path: '/settings', seed: signedIn, glass },
    );
    await screen.findByText('in the overlay');
    const rect = screen.getByRole('dialog').querySelector<HTMLElement>('.kb-smoke-calm')!;
    expect(drawn(rect)).toBe(guarded('react'));
  });
  test('the Game HUD and the hand, each on its own', async () => {
    const { container } = renderInWorld(<Frame><p>page</p></Frame>, { path: '/', seed: signedIn, glass });
    await waitFor(() => expect(document.querySelector('.kb-hand-bar')).not.toBeNull());
    expect(drawn(container.querySelector('.kb-hud-bar')!)).toBe(guarded('hud'));
    expect(drawn(document.querySelector('.kb-hand-bar')!)).toBe(guarded('hand'));
    /* The board's page is no glass surface: its calm, if it draws one, is the theme's. */
    expect(drawn(screen.getByText('page'))).toBe(glass.calm.opacity);
  });
});

/** The boxes the stand-in lays out, by what the element is. The smoke's frame is at (10, 5); a region's box is what its data says. */
const FRAME = { left: 10, top: 5, width: 800, height: 600 };
const boxes = new Map<Element, { left: number; top: number; width: number; height: number }>();

function box(r: { left: number; top: number; width: number; height: number }): DOMRect {
  return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => ({}) } as DOMRect;
}

let frames: FrameRequestCallback[] = [];
const nextFrame = () => act(() => { const run = frames; frames = []; for (const f of run) f(0); });

beforeEach(() => {
  frames = [];
  boxes.clear();
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { frames.push(f); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('kb-smoke')) return box(FRAME);
    return box(boxes.get(this) ?? { left: 0, top: 0, width: 0, height: 0 });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const world = { ui: { glass } } as unknown as Kayfa;
const inWorld = (node: React.ReactNode) => <KayfaProvider value={world}>{node}</KayfaProvider>;
const rects = (c: ParentNode = document) => [...c.querySelectorAll<HTMLElement>('.kb-smoke-calm')];
/** Stands a box in for the element a region draws. */
const stand = (el: Element, r: { left: number; top: number; width: number; height: number }) => boxes.set(el, r);

function Toggle({ withSecond }: { readonly withSecond: boolean }) {
  return (
    <Smoke surface="characters">
      <CalmRegion data-testid="column"><p>column</p></CalmRegion>
      {withSecond && <CalmRegion as="aside" data-testid="aside"><p>aside</p></CalmRegion>}
    </Smoke>
  );
}

describe('a region puts one rect in the smoke it stands on', () => {
  test('a CalmRegion inside a Smoke draws one rect at its box, in the smoke\'s own coordinates, and removing the region removes the rect', async () => {
    const { rerender } = render(inWorld(<Toggle withSecond />));
    expect(rects()).toHaveLength(2);
    const column = screen.getByTestId('column');
    stand(column, { left: 110, top: 105, width: 300, height: 200 });
    await nextFrame();
    window.dispatchEvent(new Event('resize'));
    await nextFrame();
    const r = rects()[0]!;
    expect(r.style.getPropertyValue('--kb-calm-x')).toBe('100px');
    expect(r.style.getPropertyValue('--kb-calm-y')).toBe('100px');
    expect(r.style.width).toBe('300px');
    expect(r.style.height).toBe('200px');
    rerender(inWorld(<Toggle withSecond={false} />));
    expect(rects()).toHaveLength(1);
  });

  test('a region renders the element it is asked for, with its own props, and a region with no smoke draws only that', () => {
    render(<CalmRegion as="section" aria-label="alone" className="mine"><p>x</p></CalmRegion>);
    const el = screen.getByRole('region', { name: 'alone' });
    expect(el.tagName).toBe('SECTION');
    expect(el).toHaveClass('mine');
    expect(el).toHaveAttribute('data-kb-calm-region');
    expect(rects()).toHaveLength(0);
  });

  test('the box follows the page: a scroll, gathered into one frame, measures each region once', async () => {
    render(inWorld(<Toggle withSecond={false} />));
    const column = screen.getByTestId('column');
    stand(column, { left: 110, top: 105, width: 300, height: 200 });
    const spy = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
    await nextFrame();
    spy.mockClear();
    stand(column, { left: 110, top: 55, width: 300, height: 200 });
    for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('scroll'));
    expect(frames).toHaveLength(1);
    await nextFrame();
    expect(rects()[0]!.style.getPropertyValue('--kb-calm-y')).toBe('50px');
    expect(spy.mock.contexts.filter((c) => c === column)).toHaveLength(1);
  });

  test('a region that resizes is measured again', async () => {
    let resized: () => void = () => {};
    vi.stubGlobal('ResizeObserver', class { constructor(f: () => void) { resized = f; } observe() {} disconnect() {} unobserve() {} });
    render(inWorld(<Toggle withSecond={false} />));
    const column = screen.getByTestId('column');
    stand(column, { left: 110, top: 105, width: 300, height: 200 });
    resized();
    await nextFrame();
    expect(rects()[0]!.style.height).toBe('200px');
    stand(column, { left: 110, top: 105, width: 300, height: 260 });
    resized();
    await nextFrame();
    expect(rects()[0]!.style.height).toBe('260px');
  });

  test('a region whose element changes under it (a placeholder becoming the section it stands for) calms the new element, not the one that went', async () => {
    function Swap({ as }: { readonly as: 'div' | 'section' }) {
      return <Smoke surface="characters"><CalmRegion as={as} data-testid="region"><p>x</p></CalmRegion></Smoke>;
    }
    const { rerender } = render(inWorld(<Swap as="div" />));
    rerender(inWorld(<Swap as="section" />));
    const now = screen.getByTestId('region');
    expect(now.tagName).toBe('SECTION');
    stand(now, { left: 110, top: 105, width: 300, height: 200 });
    window.dispatchEvent(new Event('resize'));
    await nextFrame();
    expect(rects()).toHaveLength(1);
    expect((rects()[0] as HTMLElement & { kbRegion?: Element }).kbRegion).toBe(now);
    expect(rects()[0]!.style.width).toBe('300px');
  });

  test('a region is watched with the boxes whose size can move it: its ancestors and the siblings before it and before them', () => {
    const watched = new Set<Element>();
    vi.stubGlobal('ResizeObserver', class { constructor(_f: () => void) {} observe(el: Element) { watched.add(el); } disconnect() {} unobserve() {} });
    render(inWorld(<Smoke surface="characters"><main><h1 data-testid="title">Title</h1><div data-testid="wrap"><p data-testid="before">b</p><CalmRegion data-testid="column"><p>c</p></CalmRegion></div></main></Smoke>));
    for (const id of ['column', 'before', 'wrap', 'title']) expect(watched.has(screen.getByTestId(id)), id).toBe(true);
  });

  test('a block inserted above a region moves its rect: the boxes watched are found again as the page changes, not once', async () => {
    render(inWorld(<Smoke surface="characters"><main data-testid="page"><CalmRegion data-testid="column"><p>c</p></CalmRegion></main></Smoke>));
    const column = screen.getByTestId('column');
    stand(column, { left: 110, top: 105, width: 300, height: 200 });
    window.dispatchEvent(new Event('resize'));
    await nextFrame();
    expect(rects()[0]!.style.getPropertyValue('--kb-calm-y')).toBe('100px');
    /* A banner arrives above the column, in a parent nothing was watching for size, and pushes the column down. */
    const banner = document.createElement('div');
    stand(column, { left: 110, top: 165, width: 300, height: 200 });
    await act(async () => { screen.getByTestId('page').prepend(banner); await Promise.resolve(); });
    await nextFrame();
    expect(rects()[0]!.style.getPropertyValue('--kb-calm-y')).toBe('160px');
  });

  test('a scroll that changes only the position writes only the position', async () => {
    render(inWorld(<Toggle withSecond={false} />));
    const column = screen.getByTestId('column');
    stand(column, { left: 110, top: 105, width: 300, height: 200 });
    window.dispatchEvent(new Event('resize'));
    await nextFrame();
    const written: string[] = [];
    const set = CSSStyleDeclaration.prototype.setProperty;
    vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty').mockImplementation(function (this: CSSStyleDeclaration, name: string, value: string | null) { written.push(name); return set.call(this, name, value); });
    stand(column, { left: 110, top: 55, width: 300, height: 200 });
    window.dispatchEvent(new Event('scroll'));
    await nextFrame();
    expect(written.sort()).toEqual(['--kb-calm-y']);
    expect(rects()[0]!.style.width).toBe('300px');
  });

  test('every box is read before any is written: a frame is one layout, not one for each region', async () => {
    render(inWorld(<Toggle withSecond />));
    stand(screen.getByTestId('column'), { left: 110, top: 105, width: 300, height: 200 });
    stand(screen.getByTestId('aside'), { left: 410, top: 105, width: 200, height: 200 });
    const order: string[] = [];
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      order.push('read');
      if (this.classList.contains('kb-smoke')) return box(FRAME);
      return box(boxes.get(this) ?? { left: 0, top: 0, width: 0, height: 0 });
    });
    const set = CSSStyleDeclaration.prototype.setProperty;
    vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty').mockImplementation(function (this: CSSStyleDeclaration, name: string, value: string | null) { order.push('write'); return set.call(this, name, value); });
    window.dispatchEvent(new Event('resize'));
    await nextFrame();
    expect(order.lastIndexOf('read')).toBeLessThan(order.indexOf('write'));
  });

  test('what is watched is bounded by the budget, not by the sibling limit: many regions, none with fifty siblings, still watch no more than MAX_WATCHED', () => {
    const watched = new Set<Element>();
    vi.stubGlobal('ResizeObserver', class { constructor(_f: () => void) {} observe(el: Element) { watched.add(el); } unobserve(el: Element) { watched.delete(el); } disconnect() {} });
    /* 40 sections of 20 paragraphs and a region: about 880 boxes the regions could watch, no box with more than 50 siblings before it. */
    const sections = Array.from({ length: 40 }, (_, i) => <section key={i}>{Array.from({ length: 20 }, (_, j) => <p key={j}>{j}</p>)}<CalmRegion><p>c</p></CalmRegion></section>);
    render(inWorld(<Smoke surface="characters"><main>{sections}</main></Smoke>));
    /* The smoke's own frame is watched besides the budget. */
    expect(watched.size).toBeGreaterThanOrEqual(MAX_WATCHED);
    expect(watched.size).toBeLessThanOrEqual(MAX_WATCHED + 1);
  });

  test('unmounting disconnects every observer and cancels a pending frame, and a smoke that is off listens to nothing', async () => {
    let disconnected = 0;
    vi.stubGlobal('ResizeObserver', class { constructor(_f: () => void) {} observe() {} unobserve() {} disconnect() { disconnected += 1; } });
    const mutations = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const cancelled = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancelled);
    const { unmount } = render(inWorld(<Toggle withSecond={false} />));
    window.dispatchEvent(new Event('scroll'));
    mutations.mockClear();
    unmount();
    expect(disconnected).toBeGreaterThanOrEqual(1);
    expect(mutations).toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalled();
    /* The smoke's own field listens to the window (rasters); a region adds nothing of its own to that while nothing is drawn. */
    const add = vi.spyOn(window, 'addEventListener');
    const heard = (node: React.ReactNode) => { add.mockClear(); const r = render(inWorld(node)); const n = add.mock.calls.map(([t]) => String(t)).sort(); r.unmount(); return n; };
    expect(heard(<Smoke surface="characters" level="off"><CalmRegion><p>x</p></CalmRegion></Smoke>)).toEqual(heard(<Smoke surface="characters" level="off"><p>x</p></Smoke>));
  });

  test('a rect is drawn only where the smoke is: none under off, and the ground is never one', () => {
    const { container } = render(inWorld(<Smoke surface="characters" level="off"><CalmRegion><p>x</p></CalmRegion></Smoke>));
    expect(rects(container)).toHaveLength(0);
    expect(container.querySelector('[data-kb-ground]')).not.toBeNull();
    expect(container.querySelector('[data-kb-ground] .kb-smoke-calm')).toBeNull();
  });

  test('the rect is drawn between the smoke\'s layers and the page: after the layers, inside the smoke\'s own frame', () => {
    const { container } = render(inWorld(<Smoke surface="characters"><CalmRegion><p>x</p></CalmRegion></Smoke>));
    const frame = container.querySelector('.kb-smoke')!;
    const kids = [...frame.children].map((c) => c.className);
    expect(kids.indexOf('kb-smoke-calm')).toBeGreaterThan(kids.indexOf('kb-smoke-layers'));
    expect(frame.contains(rects(container)[0]!)).toBe(true);
    /* A region's own element is outside the smoke: the smoke says nothing to a screen reader and the region does. */
    expect(frame.querySelector('[data-kb-calm-region]')).toBeNull();
  });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const sheet = (name: string) => fs.readFileSync(path.join(here, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The declarations of the rules whose selector list contains exactly `selector`, whitespace squashed. */
function declsOf(css: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1]!.split(',').map(squash).includes(selector)) continue;
    for (const d of m[2]!.split(';')) {
      const i = d.indexOf(':');
      if (i > 0) out[d.slice(0, i).trim()] = squash(d.slice(i + 1));
    }
  }
  return out;
}

describe('the rect is blurred by the theme\'s feather, at the calm\'s opacity, in the ground\'s color', () => {
  const calm = sheet('calm.css');
  test('its blur reads --kb-glass-calm-feather (the phone\'s is half of it) and its opacity reads --kb-glass-calm-opacity', () => {
    const body = declsOf(calm, '.kb-smoke-calm::before');
    expect(body.filter).toBe('blur(var(--kb-calm-blur))');
    expect(body.opacity).toBe('var(--kb-glass-calm-opacity)');
    expect(body.background).toBe('var(--kb-glass-ground)');
    expect(declsOf(calm, '.kb-smoke-calm')['--kb-calm-blur']).toBe('var(--kb-glass-calm-feather)');
    expect(declsOf(calm, ":where(:root[data-kb-layout='phone']) .kb-smoke-calm")['--kb-calm-blur']).toBe('calc(var(--kb-glass-calm-feather) / 2)');
  });
  test('the falloff lies outside the region\'s box: the rect is drawn out past it, so every word inside is on the calm in full', () => {
    expect(declsOf(calm, '.kb-smoke-calm::before').inset).toMatch(/^calc\(var\(--kb-calm-blur\) \* var\(--kb-glass-calm-reach\) \* -1\)$/);
  });
  /* The instance's own feather (glass.json) is held in its own test: the engine never reads an instance's files. */
  test('the engine\'s default feather is 60px, so the phone\'s is 30px', () => {
    expect(declsOf(sheet('tokens.css'), ':root')['--kb-glass-calm-feather']).toBe('60px');
  });
  test('the rect only takes smoke away: it lies in the smoke and never takes pointer events', () => {
    expect(declsOf(calm, '.kb-smoke-calm').position).toBe('absolute');
    expect(declsOf(calm, '.kb-smoke-calm')['pointer-events']).toBe('none');
  });
  test('no stylesheet still names a text element\'s calm', () => {
    for (const f of ['calm.css', 'contrast.css', 'parts.css', 'tokens.css']) expect(sheet(f)).not.toMatch(/kb-calm\b(?!-)/);
    expect(calm).not.toContain('--kb-calm-feather');
  });
});

describe('under high contrast every region\'s rect is the ground, whole', () => {
  test('opacity 1, no blur, drawn at the region\'s box', () => {
    const high = sheet('contrast.css');
    const body = declsOf(high, ":root[data-kb-contrast='high'] .kb-smoke-calm::before");
    expect(body.opacity).toBe('1');
    expect(body.filter).toBe('none');
    expect(body.inset).toBe('0');
  });
});

describe('no page caps a feather any more', () => {
  test('the blur is outside the region and costs no space: no sheet states a per-element feather, and the title gap is parts.css\'s alone', () => {
    const root = path.resolve(here, '..');
    const sheets = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sheets(path.join(dir, e.name)) : e.name.endsWith('.css') ? [path.join(dir, e.name)] : []));
    const css = sheets(root).map((f) => [f, fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')] as const);
    expect(css.filter(([, t]) => t.includes('--kb-calm-feather')).map(([f]) => path.basename(f))).toEqual([]);
    const gap = css.filter(([, t]) => t.includes('--kb-glass-title-gap:')).map(([f]) => path.basename(f));
    expect(gap).toEqual(['parts.css']);
    const parts = sheet('parts.css');
    expect(declsOf(parts, ':root')['--kb-glass-title-gap']).toBe('12px');
    expect(declsOf(parts, ":root[data-kb-layout='phone']")['--kb-glass-title-gap']).toBe('8px');
  });
});

describe('what stands under a line is never the frame\'s neon', () => {
  const read = (rel: string) => fs.readFileSync(path.join(here, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  test('a dialog\'s ground follows its own scroll, one border in, so a scrolled line is over the ground and not the border\'s color', () => {
    const d = declsOf(sheet('shell.css'), '.kb-glass-dialog');
    expect(d['background-attachment']).toBe('local');
    expect(d['background-clip']).toBe('padding-box');
    expect(d['background-image']).toBe('linear-gradient(var(--kb-glass-ground), var(--kb-glass-ground))');
  });
  test('the Vending Machine\'s wallet words stand clear of the panel\'s border on the phone', () => {
    expect(declsOf(read('../vending/vending.css'), ":where(:root[data-kb-layout='phone']) .kb-vending-wallet-in")['padding-inline']).toBe('16px');
  });
  test('the picker\'s axis labels have room in the field that grows with the label, so they are never over the grid\'s tiles', () => {
    expect(declsOf(read('../reactions/reactions.css'), '.kb-picker-field').padding).toBe('max(28px, calc(var(--kb-glass-size-label) * 1.4)) 0');
  });
});
