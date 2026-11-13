/**
 * Graffiti's wall on a post (plan Task 9; design sections 4, 5, 7 and 8), as a reader and the post's author meet it. jsdom has no layout and
 * no canvas, so the body's box is stubbed (the cell's client size; rects sit at 0, 0), `paintWall` is watched where it is called (the painter's
 * own pixels are spray.test.tsx's), and what the component keeps (how many strokes this screen has scrubbed, whether draw mode is open) is read
 * from the attributes it publishes. The hit test is the real one.
 */
import { readFileSync } from 'node:fs';
import { act, fireEvent, screen } from '@testing-library/react';
import { useMemo, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClaims } from '../../../../engine/ui/cards/claims.ts';
import type { CardPlay, CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import type { Act, SurfaceAct } from '../../../../engine/ui/data/api.ts';
import { LOST_ANSWER } from '../../../../engine/ui/data/api.ts';
import { renderInWorld } from '../../../../engine/ui/test-world.tsx';
import { Effect as WhoopsEffect } from '../whoops/Effect.tsx';
import { LayerInk } from '../whoops/scrub.ts';
import { DESIGN, makeSplat } from '../whoops/splat.ts';
import { Effect, MAX_SAVE_RETRIES, RETRY_AFTER_MS, WASH_AFTER_MS } from './Effect.tsx';
import * as spray from './spray.ts';
import { HOLD_MS } from '../wiping.ts';

vi.mock('../whoops/suds.ts', () => ({ register: vi.fn(), unregister: vi.fn(), wash: vi.fn(), puff: vi.fn() }));
vi.mock('../whoops/cursor.ts', () => ({ cursor: { over: vi.fn(), press: vi.fn(), leave: vi.fn() } }));
vi.mock('./spray.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('./spray.ts')>();
  return { ...real, paintWall: vi.fn(), hitAt: vi.fn(real.hitAt) };
});

/** The player the effect reads (the engine's own provider is real; only who is signed in is fixed here). */
const player = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../../../../engine/ui/player.tsx', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../../engine/ui/player.tsx')>()), usePlayer: () => player.value }));
const signedIn = () => { player.value = { session: { signedIn: true, account: 'acct-1' }, hudCharacter: { id: 'c1' }, actingCharacters: [{ id: 'c1' }] }; };

const BOX = { w: 600, h: 400 };
const POST = { id: 'post-1', character: 'someone', kind: 'post', thread: 't', payload: {}, currentPayload: {}, targetActId: null, seq: 41, createdAt: '2026-10-29T21:14:00.000Z', editedAt: null, shownEditedAt: null } as unknown as Act;
const PLAY: CardPlay = { id: 'play-g', card: 'graffiti', layer: 1, caster: 'caster-1', message: '', config: {}, playedAt: '2026-10-29T21:05:00.000Z', post: POST.id };

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get(this: HTMLElement) { return this.classList?.contains('kb-act-main') ? BOX.w : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get(this: HTMLElement) { return this.classList?.contains('kb-act-main') ? BOX.h : 0; } });
  Range.prototype.getClientRects = function (this: Range) {
    const top = Math.floor(this.startOffset / 24) * 22.5;
    return [{ top, bottom: top + 22.5, left: 0, right: 1, width: 1, height: 22.5, x: 0, y: top }] as unknown as DOMRectList;
  };
  HTMLCanvasElement.prototype.getContext = (() => ({})) as unknown as HTMLCanvasElement['getContext'];
  try { localStorage.clear(); } catch { /* none here */ }
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
  delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight;
  delete (Range.prototype as { getClientRects?: unknown }).getClientRects;
});

const draw = (id: string, ...rows: number[]): SurfaceAct => ({
  id, kind: 'draw', character: 'drawer', createdAt: '2026-10-29T21:06:00.000Z',
  payload: { strokes: rows.map((y) => ({ can: 'red', cap: 'fat', aspect: BOX.w / BOX.h, points: [[0.02, y], [0.98, y]] })) },
} as unknown as SurfaceAct);
/** A wall with one broad stripe across the middle of the body. */
const MIDDLE = [draw('a1', 0.5)];

const answered = (id = 'w1') => async () => ({ ok: true as const, value: { id, kind: 'wash' } as unknown as SurfaceAct });

function surfaceOf(acts: readonly SurfaceAct[] | null, over: Partial<NonNullable<EffectProps['surface']>> = {}): NonNullable<EffectProps['surface']> {
  return { covered: 3100, most: 4000, acts, near: vi.fn(), draw: vi.fn(answered('d')), wash: vi.fn(answered()), ...over } as NonNullable<EffectProps['surface']>;
}

function propsOf(o: { readonly surface?: EffectProps['surface']; readonly author?: boolean; readonly ink?: EffectProps['ink']; readonly children?: ReactNode } = {}): EffectProps {
  return {
    post: POST, plays: [PLAY], states: {}, released: new Set(), written: new Map(), reader: { author: o.author ?? false, caster: false }, place: 'thread', reach: 'post', still: false,
    save: async () => ({ ok: false, error: 'no' }), release: async (play) => ({ ok: true, value: { play, releasedAt: '' } }), show: () => {}, met: () => {}, holdScreen: () => {}, marks: null,
    nameOf: () => 'A character', give: async () => ({ ok: false, error: 'no' }), moreGifts: async () => {}, wallet: null,
    ink: o.ink ?? createClaims().at('post:graffiti', 0), ...(o.surface ? { surface: o.surface } : {}),
    children: o.children ?? <p>The post&apos;s words.</p>,
  };
}

function mount(o: { readonly children?: ReactNode; readonly acts?: readonly SurfaceAct[] | null; readonly author?: boolean; readonly surface?: NonNullable<EffectProps['surface']> } = {}) {
  const surface = o.surface ?? surfaceOf(o.acts === undefined ? MIDDLE : o.acts);
  const shown: CardView[] = [];
  const props = { ...propsOf({ surface, author: o.author ?? false, ...(o.children ? { children: o.children } : {}) }), show: (v: CardView | null) => { if (v) shown.push(v); } };
  const world = renderInWorld(<div className="kb-act-main"><Effect {...props} /></div>);
  const root = world.container.querySelector('.kb-graffiti') as HTMLElement;
  return { ...world, surface, shown, root, frame: world.container.querySelector('.kb-graffiti-frame') as HTMLElement, cell: world.container.querySelector('.kb-act-main') as HTMLElement };
}

const px = (x: number, y: number): [number, number] => [x * BOX.w, y * BOX.h];
const scrubbed = (root: HTMLElement) => Number(root.dataset.kbScrubbed);

function drag(el: HTMLElement, points: readonly (readonly [number, number])[]) {
  const [first, ...rest] = points.map(([x, y]) => px(x, y));
  act(() => { fireEvent.pointerDown(el, { clientX: first![0], clientY: first![1], pointerId: 1, button: 0, pointerType: 'mouse' }); });
  for (const [x, y] of rest) act(() => { fireEvent.pointerMove(el, { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', buttons: 1 }); });
  const [lx, ly] = rest[rest.length - 1] ?? first!;
  act(() => { fireEvent.pointerUp(el, { clientX: lx, clientY: ly, pointerId: 1, pointerType: 'mouse' }); });
}

const watchers: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
function stubViewport() {
  watchers.length = 0;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(watch: (entries: { isIntersecting: boolean }[]) => void) { watchers.push(watch); }
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  return (isIntersecting: boolean) => act(() => { watchers.forEach((w) => w([{ isIntersecting }])); });
}

describe('the ink layer', () => {
  test('the canvas is drawn only while the post is near the viewport, and asks for the wall\'s strokes then', () => {
    const see = stubViewport();
    const { root, surface } = mount();
    expect(root.querySelector('canvas[data-kb-effect-ink]')).toBeNull();
    expect(spray.paintWall).not.toHaveBeenCalled();
    expect(surface.near).not.toHaveBeenCalled();
    see(true);
    const canvas = root.querySelector('canvas[data-kb-effect-ink]') as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    expect([canvas.width, canvas.height]).toEqual([BOX.w, BOX.h]);
    expect(surface.near).toHaveBeenCalled();
    expect(spray.paintWall).toHaveBeenCalled();
    expect(vi.mocked(spray.paintWall).mock.calls.at(-1)![3]).toEqual(MIDDLE);
    see(false);
    expect(root.querySelector('canvas[data-kb-effect-ink]')).toBeNull();
  });

  test('the post\'s words stay drawn, and a wall not yet read draws no strokes', () => {
    const { root } = mount({ acts: null });
    expect(root).toHaveTextContent('The post\'s words.');
    expect(vi.mocked(spray.paintWall).mock.calls.every((c) => c[3].length === 0)).toBe(true);
  });
});

describe('a reader\'s scrub', () => {
  test('scrubs on their own screen and sends nothing, however long they wait', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { frame, root, surface } = mount();
    drag(frame, [[0.3, 0.5], [0.4, 0.5], [0.5, 0.5]]);
    expect(scrubbed(root)).toBe(1);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(surface.wash).not.toHaveBeenCalled();
    await act(async () => { await new Promise((done) => requestAnimationFrame(() => done(null))); });
    /* The scrub is a wash over the wall's own, drawn on this screen. */
    const last = vi.mocked(spray.paintWall).mock.calls.at(-1)![3];
    expect(last).toHaveLength(MIDDLE.length + 1);
    expect(last.at(-1)!.kind).toBe('wash');
  });

  test('a press where there is no ink is left to the page: it is not caught and scrubs nothing', () => {
    const { frame, root } = mount();
    const prevented = vi.fn();
    const watch = (e: Event) => { if (e.defaultPrevented) prevented(); };
    document.addEventListener('pointerdown', watch);
    drag(frame, [[0.3, 0.1], [0.4, 0.1]]);
    document.removeEventListener('pointerdown', watch);
    expect(scrubbed(root)).toBe(0);
    expect(prevented).not.toHaveBeenCalled();
  });

  test('is gone with the page: a new visit draws the wall as it is', () => {
    const first = mount();
    drag(first.frame, [[0.3, 0.5], [0.5, 0.5]]);
    expect(scrubbed(first.root)).toBe(1);
    first.unmount();
    expect(scrubbed(mount().root)).toBe(0);
  });
});

describe('the author\'s wash', () => {
  test('is sent once, as one wash, after 1.5 seconds without a stroke', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { frame, surface } = mount({ author: true });
    drag(frame, [[0.3, 0.5], [0.4, 0.5], [0.5, 0.5]]);
    await act(async () => { await vi.advanceTimersByTimeAsync(WASH_AFTER_MS - 200); });
    drag(frame, [[0.7, 0.5], [0.8, 0.5], [0.9, 0.5]]);
    await act(async () => { await vi.advanceTimersByTimeAsync(WASH_AFTER_MS - 1); });
    expect(surface.wash).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(surface.wash).toHaveBeenCalledTimes(1);
    const [play, input] = vi.mocked(surface.wash).mock.calls[0]!;
    expect(play).toBe(PLAY.id);
    const strokes = (input as { strokes: { aspect: number; points: [number, number][] }[] }).strokes;
    expect(strokes).toHaveLength(2);
    expect(strokes[0]!.aspect).toBeCloseTo(1.5);
    expect(Object.keys(strokes[0]!).sort()).toEqual(['aspect', 'points']);
    expect(strokes[0]!.points.length).toBeGreaterThanOrEqual(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(surface.wash).toHaveBeenCalledTimes(1);
  });

  test('is sent as the post is left, without waiting out the pause', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { frame, surface, unmount } = mount({ author: true });
    drag(frame, [[0.3, 0.5], [0.5, 0.5]]);
    expect(surface.wash).not.toHaveBeenCalled();
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(surface.wash).toHaveBeenCalledTimes(1);
  });

  test('a refusal is shown in the view and not sent again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const wash = vi.fn(async () => ({ ok: false as const, error: 'This post is not yours to wash.' }));
    const { frame, shown } = mount({ author: true, surface: surfaceOf(MIDDLE, { wash }) });
    drag(frame, [[0.3, 0.5], [0.5, 0.5]]);
    await act(async () => { await vi.advanceTimersByTimeAsync(WASH_AFTER_MS + 100); });
    expect(shown.at(-1)?.report).toBe('This post is not yours to wash.');
    await act(async () => { await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS * 2 ** MAX_SAVE_RETRIES); });
    expect(wash).toHaveBeenCalledTimes(1);
  });

  test('an answer that never came is sent again, a little later each time, and given up on after a few', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const wash = vi.fn(async () => ({ ok: false as const, error: LOST_ANSWER, uncertain: true as const }));
    const { frame } = mount({ author: true, surface: surfaceOf(MIDDLE, { wash }) });
    drag(frame, [[0.3, 0.5], [0.5, 0.5]]);
    await act(async () => { await vi.advanceTimersByTimeAsync(WASH_AFTER_MS); });
    expect(wash).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS - 1); });
    expect(wash).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(wash).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS * 2 ** (MAX_SAVE_RETRIES + 2)); });
    expect(wash).toHaveBeenCalledTimes(1 + MAX_SAVE_RETRIES);
  });

  test('is sent again after the post has left when the answer to the send on leaving never came', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const wash = vi.fn(async () => ({ ok: false as const, error: LOST_ANSWER, uncertain: true as const }));
    const { frame, unmount } = mount({ author: true, surface: surfaceOf(MIDDLE, { wash }) });
    drag(frame, [[0.3, 0.5], [0.5, 0.5]]);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(wash).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS * 2 ** (MAX_SAVE_RETRIES + 2)); });
    expect(wash).toHaveBeenCalledTimes(1 + MAX_SAVE_RETRIES);
  });

  test('a refusal is announced once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const words = 'This post is not yours to wash.';
    const wash = vi.fn(async () => ({ ok: false as const, error: words }));
    const { frame } = mount({ author: true, surface: surfaceOf(MIDDLE, { wash }) });
    drag(frame, [[0.3, 0.5], [0.5, 0.5]]);
    await act(async () => { await vi.advanceTimersByTimeAsync(WASH_AFTER_MS + 100); });
    expect(screen.getAllByRole('status').filter((n) => n.textContent === words)).toHaveLength(1);
  });

  test('a reader\'s Lens has Hold to scrub alone, and the author\'s also has Wash', () => {
    const reader = mount();
    expect(reader.shown.at(-1)?.controls.map((c) => c.label)).toEqual(['Hold to scrub']);
    reader.unmount();
    const author = mount({ author: true });
    expect(author.shown.at(-1)?.controls.map((c) => c.label)).toEqual(['Hold to scrub', 'Wash']);
  });
});

describe('the view', () => {
  test('says how much of the wall is covered, and how it ends', () => {
    const { shown } = mount();
    const view = shown.at(-1)!;
    expect(view.state).toBe('31% of the wall');
    expect(view.ends).toBe('Ends on your screen when you scrub it off. The author can wash it off for everyone, and anyone can tag it again.');
  });
});

describe('a wall under a splat', () => {
  const SEED = 21;
  const splatInk = () => new LayerInk(makeSplat(SEED), [], BOX);
  function both() {
    const claims = createClaims();
    const wall = surfaceOf([draw('a1', 0.5, 0.97)]);
    const whoopsPlay: CardPlay = { id: 'play-w', card: 'whoops', layer: 1, caster: 'c', message: '', config: { color: '#ff2bd6', seed: SEED }, playedAt: '2026-10-29T21:07:00.000Z', post: POST.id };
    const base = propsOf({ surface: wall, ink: claims.at('post:graffiti', 0) });
    const outer = { ...base, plays: [whoopsPlay], ink: claims.at('post:whoops', 1), surface: undefined, save: async () => ({ ok: true as const, value: { play: 'play-w', savedAt: '' } }) };
    const world = renderInWorld(
      <div className="kb-act-main"><WhoopsEffect {...outer}><Effect {...base} /></WhoopsEffect></div>,
    );
    return { ...world, wall, whoops: world.container.querySelector('[data-kb-whoops]') as HTMLElement, root: world.container.querySelector('.kb-graffiti') as HTMLElement, cell: world.container.querySelector('.kb-act-main') as HTMLElement };
  }
  const spot = (): [number, number] => {
    const ink = splatInk();
    const { cx, cy } = ink.splat.placement;
    const x = cx / DESIGN.w;
    return ink.has(x, cy) ? [x, cy] : [x, cy + 0.05];
  };

  test('a press on the splat\'s ink over the wall scrubs the splat and not the wall', () => {
    const { cell, root, whoops } = both();
    const [x, y] = spot();
    /* The wall has a stripe where the splat is: put one through the spot's row too. */
    expect(spray.hitAt([draw('t', y)], BOX, x * BOX.w, y * BOX.h)).toBe(true);
    /* A wash takes some of the splat's ink each pass (docs/plans/2026-11-12-whoops-ink-field-design.md, section 2), so
       its core opens only after several. Press until the first hole opens and no further: each of those presses starts
       on the splat's ink, so none reaches the wall (a press that starts where the splat is washed away would). */
    const washed = () => Number(whoops.dataset.kbWashed!.split(' ')[0]);
    for (let pass = 0; pass < 14 && washed() === 0; pass++) drag(cell, [[x, y], [x + 0.05, y], [x + 0.1, y]]);
    expect(Number(whoops.dataset.kbWashed!.split(' ')[0])).toBeGreaterThan(0);
    expect(scrubbed(root)).toBe(0);
  });

  test('in draw mode a press on the splat\'s ink draws, under it, and scrubs neither the splat nor the wall', () => {
    const { root, whoops } = both();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Draw' })); });
    const surface = root.querySelector('[data-kb-draw-surface]') as HTMLElement;
    const [x, y] = spot();
    drag(surface, [[x, y], [x + 0.05, y], [x + 0.1, y]]);
    expect(Number(surface.dataset.kbStrokes)).toBe(1);
    expect(Number(whoops.dataset.kbWashed!.split(' ')[0])).toBe(0);
    expect(scrubbed(root)).toBe(0);
  });

  test('a press beside the splat\'s ink, on the wall, scrubs the wall', () => {
    const { cell, root, whoops } = both();
    const ink = splatInk();
    expect(ink.has(0.3, 0.97)).toBe(false);
    drag(cell, [[0.3, 0.97], [0.4, 0.97], [0.5, 0.97]]);
    expect(scrubbed(root)).toBe(1);
    expect(Number(whoops.dataset.kbWashed!.split(' ')[0])).toBe(0);
  });
});

describe('the Draw tile', () => {
  test('opens draw mode, as an addition to the wall', () => {
    const { root } = mount();
    expect(root.dataset.kbDrawing).toBeUndefined();
    const tile = screen.getByRole('button', { name: 'Draw' });
    expect(tile.closest('[data-kb-over-ink]')).not.toBeNull();
    act(() => { fireEvent.click(tile); });
    expect(root.dataset.kbDrawing).toBe('true');
  });

  test('is drawn in the can the reader picked last, kept for their account', () => {
    localStorage.setItem('kb-graffiti-can:acct-1', 'teal');
    const { root } = mount();
    expect((root.querySelector('[data-kb-can]') as HTMLElement).dataset.kbCan).toBe('teal');
  });

  test('where storage throws the tile is drawn in the default can', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      const { root } = mount();
      expect((root.querySelector('[data-kb-can]') as HTMLElement).dataset.kbCan).toBe('cyan');
    } finally { get.mockRestore(); }
  });

  test('a signed-out reader, or one with no character, sees no tile', () => {
    player.value = { session: { signedIn: false, account: null }, hudCharacter: null, actingCharacters: [] };
    expect(mount().root.querySelector('[data-kb-over-ink]')).toBeNull();
    player.value = { session: { signedIn: true, account: 'acct-1' }, hudCharacter: null, actingCharacters: [] };
    expect(mount().root.querySelector('[data-kb-over-ink]')).toBeNull();
  });

  test('a press on the tile starts no stroke, where the same press on the wall would', () => {
    const { root, frame } = mount();
    const tile = screen.getByRole('button', { name: 'Draw' });
    const [x, y] = px(0.5, 0.5);
    expect(spray.hitAt(MIDDLE, BOX, x, y)).toBe(true);
    act(() => { fireEvent.pointerDown(tile, { clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse' }); });
    expect(scrubbed(root)).toBe(0);
    drag(frame, [[0.5, 0.5], [0.55, 0.5]]);
    expect(scrubbed(root)).toBe(1);
  });
});

describe('opening draw mode brings the post clear of the dock', () => {
  const frameOf = () => act(async () => { await new Promise((done) => requestAnimationFrame(() => done(null))); });
  const box = (el: HTMLElement, top: number, height: number) => { el.getBoundingClientRect = () => ({ top, bottom: top + height, left: 0, right: 600, width: 600, height, x: 0, y: top, toJSON: () => ({}) }); };
  beforeEach(() => {
    vi.stubGlobal('innerHeight', 800);
    document.documentElement.style.scrollPaddingTop = '60px';
    document.documentElement.style.scrollPaddingBottom = '400px';
  });
  afterEach(() => {
    document.documentElement.style.removeProperty('scroll-padding-top');
    document.documentElement.style.removeProperty('scroll-padding-bottom');
  });

  test('a post behind where the dock lands is scrolled to the top of the clear area, after the dock has mounted', async () => {
    const { cell } = mount();
    const scroll = vi.fn();
    cell.scrollIntoView = scroll;
    box(cell, 300, 400);
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Draw' })); });
    await frameOf();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' });
  });

  test('a post wholly in the clear area is not scrolled, and nothing scrolls before draw mode opens', async () => {
    const { cell } = mount();
    const scroll = vi.fn();
    cell.scrollIntoView = scroll;
    box(cell, 100, 200);
    await frameOf();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Draw' })); });
    await frameOf();
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe('draw mode on a wall that is there', () => {
  const open = () => { act(() => { fireEvent.click(screen.getByRole('button', { name: 'Draw' })); }); };
  const frameOf = () => act(async () => { await new Promise((done) => requestAnimationFrame(() => done(null))); });
  const surfaceOf2 = (root: HTMLElement) => root.querySelector('[data-kb-draw-surface]') as HTMLElement;
  const strokesOf = (root: HTMLElement) => Number(surfaceOf2(root).dataset.kbStrokes);

  test('opens the toolbar and a surface over the post body, and the tile steps aside', () => {
    const { root } = mount();
    open();
    expect(screen.getByRole('group', { name: 'Graffiti tools' })).toBeInTheDocument();
    expect(surfaceOf2(root)).not.toBeNull();
    expect(surfaceOf2(root).hasAttribute('data-kb-over-ink')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Draw' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Spray' })).toHaveFocus();
  });

  test('the meter starts at the wall as its Acts leave it, of the limit the surface gives', () => {
    mount({ surface: surfaceOf(MIDDLE, { covered: 3100, most: 4000 }) });
    open();
    expect(screen.getByText(/^Wall \d+% of 40%$/)).toBeInTheDocument();
    expect(screen.getByText('Draw something first')).toBeInTheDocument();
  });

  test('a press draws and never scrubs the wall, even on its ink', () => {
    const { root } = mount();
    open();
    drag(surfaceOf2(root), [[0.3, 0.5], [0.5, 0.5], [0.7, 0.5]]);
    expect(strokesOf(root)).toBe(1);
    expect(scrubbed(root)).toBe(0);
  });

  test('what is drawn is painted into the wall\'s own layer after the wall\'s Acts, before it is tagged', async () => {
    const { root } = mount();
    open();
    drag(surfaceOf2(root), [[0.3, 0.2], [0.5, 0.2], [0.7, 0.2]]);
    await frameOf();
    const last = vi.mocked(spray.paintWall).mock.calls.at(-1)![3];
    expect(last).toHaveLength(MIDDLE.length + 1);
    expect(last[0]).toEqual(MIDDLE[0]);
    expect(last.at(-1)!.kind).toBe('draw');
    expect((last.at(-1)!.payload as { strokes: unknown[] }).strokes).toHaveLength(1);
  });

  test('a hit on the wall is not made by a drawing not yet tagged: only the wall\'s Acts are its ink', () => {
    const { frame, root } = mount();
    open();
    drag(surfaceOf2(root), [[0.3, 0.2], [0.5, 0.2], [0.7, 0.2]]);
    drag(frame, [[0.4, 0.2], [0.6, 0.2]]);
    expect(scrubbed(root)).toBe(0);
  });

  test('Tag it sends the draw as the reader\'s character on this play and closes draw mode, keeping the can for the tile', async () => {
    const { root, surface } = mount();
    open();
    act(() => { fireEvent.click(screen.getByRole('radio', { name: 'Pink' })); });
    drag(surfaceOf2(root), [[0.3, 0.2], [0.5, 0.2], [0.7, 0.2]]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tag it' })); });
    expect(surface.draw).toHaveBeenCalledTimes(1);
    const [play, as, input] = vi.mocked(surface.draw).mock.calls[0]!;
    expect([play, as]).toEqual(['play-g', 'c1']);
    expect(input).toEqual({ strokes: [{ can: 'pink', cap: 'stock', aspect: 1.5, points: [[0.3, 0.2], [0.5, 0.2], [0.7, 0.2]] }] });
    expect(root.dataset.kbDrawing).toBeUndefined();
    expect(screen.queryByRole('group', { name: 'Graffiti tools' })).toBeNull();
    expect(root.querySelector('[data-kb-can]')).toHaveAttribute('data-kb-can', 'pink');
    expect(screen.getByRole('button', { name: 'Draw' })).toHaveFocus();
  });

  test('a refusal stays in the toolbar and the drawing is kept, with draw mode open', async () => {
    const surface = surfaceOf(MIDDLE, { draw: vi.fn(async () => ({ ok: false as const, error: 'This tag would take the wall to 46%; its limit is 40%.' })) });
    const { root } = mount({ surface });
    open();
    drag(surfaceOf2(root), [[0.3, 0.2], [0.5, 0.2], [0.7, 0.2]]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tag it' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('This tag would take the wall to 46%; its limit is 40%.');
    expect(root.dataset.kbDrawing).toBe('true');
    expect(strokesOf(root)).toBe(1);
  });

  test('Cancel with nothing drawn closes at once; with strokes it asks first, and Leave drops the drawing and clears it from the wall\'s layer', async () => {
    const { root } = mount();
    open();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
    expect(root.dataset.kbDrawing).toBeUndefined();
    open();
    drag(surfaceOf2(root), [[0.3, 0.2], [0.5, 0.2], [0.7, 0.2]]);
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
    expect(root.dataset.kbDrawing).toBe('true');
    expect(screen.getByText('Leave without tagging? Your drawing isn\'t saved.')).toBeInTheDocument();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Leave' })); });
    expect(root.dataset.kbDrawing).toBeUndefined();
    await frameOf();
    expect(vi.mocked(spray.paintWall).mock.calls.at(-1)![3]).toEqual(MIDDLE);
  });
});

describe('a finger', () => {
  interface Finger { readonly id: number; readonly at: readonly [number, number] }
  function touch(target: HTMLElement, type: 'touchstart' | 'touchmove' | 'touchend', down: readonly Finger[], changed: readonly Finger[]): boolean {
    const list = (fingers: readonly Finger[]) => fingers.map((f) => ({ identifier: f.id, clientX: f.at[0], clientY: f.at[1], target }));
    const event = new TouchEvent(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { touches: { value: list(down) }, targetTouches: { value: list(down) }, changedTouches: { value: list(changed) } });
    act(() => { target.dispatchEvent(event); });
    return event.defaultPrevented;
  }

  test('a quick vertical swipe scrolls the page and draws nothing', () => {
    const { cell, root } = mount();
    const [x, y] = px(0.5, 0.5);
    touch(cell, 'touchstart', [{ id: 1, at: [x, y] }], [{ id: 1, at: [x, y] }]);
    const prevented = touch(cell, 'touchmove', [{ id: 1, at: [x, y + 30] }], [{ id: 1, at: [x, y + 30] }]);
    touch(cell, 'touchend', [], [{ id: 1, at: [x, y + 30] }]);
    expect(prevented).toBe(false);
    expect(scrubbed(root)).toBe(0);
  });

  test('a sideways swipe wipes, and the page\'s scroll is refused for it', () => {
    const { cell, root } = mount();
    const [x, y] = px(0.3, 0.5);
    touch(cell, 'touchstart', [{ id: 1, at: [x, y] }], [{ id: 1, at: [x, y] }]);
    const prevented = touch(cell, 'touchmove', [{ id: 1, at: [x + 30, y] }], [{ id: 1, at: [x + 30, y] }]);
    touch(cell, 'touchend', [], [{ id: 1, at: [x + 30, y] }]);
    expect(prevented).toBe(true);
    expect(scrubbed(root)).toBe(1);
  });
});

describe('a hold, and the order of a scrub', () => {
  function touch(target: HTMLElement, type: 'touchstart' | 'touchend', at: readonly [number, number]) {
    const list = [{ identifier: 1, clientX: at[0], clientY: at[1], target }];
    const event = new TouchEvent(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { touches: { value: type === 'touchend' ? [] : list }, targetTouches: { value: list }, changedTouches: { value: list } });
    act(() => { target.dispatchEvent(event); });
  }

  test('a finger held 180ms on the paint grabs it with no movement, and not before', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { cell, root } = mount();
    touch(cell, 'touchstart', px(0.5, 0.5));
    act(() => { vi.advanceTimersByTime(HOLD_MS - 1); });
    expect(scrubbed(root)).toBe(0);
    act(() => { vi.advanceTimersByTime(1); });
    expect(scrubbed(root)).toBe(1);
  });

  function hosted() {
    const ink = createClaims().at('post:graffiti', 0);
    let set: (acts: readonly SurfaceAct[]) => void = () => {};
    let bump: () => void = () => {};
    function Host() {
      const [acts, setActs] = useState<readonly SurfaceAct[]>(MIDDLE);
      const [n, setN] = useState(0);
      set = setActs;
      bump = () => setN((v) => v + 1);
      const surface = useMemo(() => surfaceOf(acts), [acts]);
      return <div className="kb-act-main"><Effect {...propsOf({ surface, ink })}><p data-n={n}>The post&apos;s words.</p></Effect></div>;
    }
    const world = renderInWorld(<Host />);
    return { ...world, setActs: (a: readonly SurfaceAct[]) => act(() => set(a)), bump: () => act(() => bump()), frame: world.container.querySelector('.kb-graffiti-frame') as HTMLElement };
  }
  const lastPaint = () => vi.mocked(spray.paintWall).mock.calls.at(-1)![3];

  test('a scrub whose Act has left the live list stays before the tags that came after it', () => {
    const { frame, setActs } = hosted();
    drag(frame, [[0.3, 0.5], [0.5, 0.5]]);
    setActs([draw('a2', 0.5)]);
    const kinds = lastPaint().map((a) => a.kind);
    expect(kinds).toEqual(['wash', 'draw']);
  });

  test('a scrub is one Act object for as long as it is unchanged, so the painter\'s cache holds', () => {
    const { frame, setActs } = hosted();
    drag(frame, [[0.3, 0.5], [0.5, 0.5]]);
    setActs([...MIDDLE]);
    const first = lastPaint()[1]!;
    setActs([...MIDDLE]);
    expect(lastPaint()[1]).toBe(first);
  });

});

describe('draw mode and the wall it is drawn on', () => {
  function hosted() {
    const ink = createClaims().at('post:graffiti', 0);
    let setActs: (acts: readonly SurfaceAct[]) => void = () => {};
    let setHas: (has: boolean) => void = () => {};
    function Host() {
      const [acts, sa] = useState<readonly SurfaceAct[]>(MIDDLE);
      const [has, sh] = useState(true);
      setActs = sa;
      setHas = sh;
      const surface = useMemo(() => surfaceOf(acts), [acts]);
      return <div className="kb-act-main"><Effect {...propsOf({ surface, ink })} plays={has ? [PLAY] : []} /></div>;
    }
    const world = renderInWorld(<Host />);
    return { ...world, root: world.container.querySelector('.kb-graffiti') as HTMLElement, setActs: (a: readonly SurfaceAct[]) => act(() => setActs(a)), setHas: (h: boolean) => act(() => setHas(h)) };
  }
  const open = () => { act(() => { fireEvent.click(screen.getByRole('button', { name: 'Draw' })); }); };
  const lastPaint = () => vi.mocked(spray.paintWall).mock.calls.at(-1)![3];

  test('where draw mode can no longer be drawn (the play is gone) it closes, and the tile is there when it can again', () => {
    const { root, setHas } = hosted();
    open();
    expect(root.dataset.kbDrawing).toBe('true');
    setHas(false);
    expect(root.dataset.kbDrawing).toBeUndefined();
    setHas(true);
    expect(screen.getByRole('button', { name: 'Draw' })).toBeInTheDocument();
  });

  test('after Tag it the drawing stays painted until the wall holds the new draw, then is dropped', async () => {
    const { root, setActs } = hosted();
    open();
    drag(root.querySelector('[data-kb-draw-surface]') as HTMLElement, [[0.3, 0.2], [0.5, 0.2], [0.7, 0.2]]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tag it' })); });
    expect(root.dataset.kbDrawing).toBeUndefined();
    await act(async () => { await new Promise((done) => requestAnimationFrame(() => done(null))); });
    expect(lastPaint()).toHaveLength(MIDDLE.length + 1);
    expect(lastPaint().at(-1)!.kind).toBe('draw');
    const tagged = draw('d', 0.2);
    setActs([...MIDDLE, tagged]);
    expect(lastPaint()).toEqual([...MIDDLE, tagged]);
    expect(lastPaint()).toHaveLength(2);
  });

  test('a wall that changes some other way drops the held drawing too', async () => {
    const { root, setActs } = hosted();
    open();
    drag(root.querySelector('[data-kb-draw-surface]') as HTMLElement, [[0.3, 0.2], [0.5, 0.2], [0.7, 0.2]]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tag it' })); });
    setActs([...MIDDLE, draw('other', 0.8)]);
    expect(lastPaint()).toHaveLength(2);
  });
});

describe('the words under the paint', () => {
  const words = <p data-testid="plain"><a href="#under" data-testid="link">a link</a> and plain words under the paint.</p>;

  test('the body is never made inert, and no second copy of the words is read out', () => {
    const { root } = mount({ children: words });
    expect(root.querySelector('[data-kb-graffiti-layout]')!.hasAttribute('inert')).toBe(false);
    expect(root.querySelector('[data-kb-readout]')).toBeNull();
  });

  test('a link under the ink is focusable and a press on it goes to it and starts no scrub', () => {
    const { root } = mount({ children: words });
    const link = screen.getByTestId('link');
    link.focus();
    expect(link).toHaveFocus();
    const [x, y] = px(0.5, 0.5);
    act(() => { fireEvent.pointerDown(link, { clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse' }); });
    act(() => { fireEvent.pointerUp(link, { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse' }); });
    expect(scrubbed(root)).toBe(0);
  });

  test('a press on plain text under the ink still scrubs it', () => {
    const { root } = mount({ children: words });
    drag(screen.getByTestId('plain'), [[0.3, 0.5], [0.4, 0.5], [0.5, 0.5]]);
    expect(scrubbed(root)).toBe(1);
  });

  test('the ink canvases do not take the pointer', () => {
    const css = readFileSync('instances/divided-world/cards/graffiti/graffiti.css', 'utf8');
    expect(/\.kb-graffiti-ink,\s*\.kb-graffiti-suds\s*\{[^}]*pointer-events:\s*none/u.test(css)).toBe(true);
  });
});
