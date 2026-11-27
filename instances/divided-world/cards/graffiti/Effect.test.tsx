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
import { BbCode } from '../../../../engine/ui/bbcode/render.tsx';
import { Effect as WhoopsEffect } from '../whoops/Effect.tsx';
import { LayerInk } from '../whoops/scrub.ts';
import { DESIGN, makeSplat } from '../whoops/splat.ts';
import { Effect, MAX_SAVE_RETRIES, RETRY_AFTER_MS, WASH_AFTER_MS } from './Effect.tsx';
import * as spray from './spray.ts';
import { COATS } from '../graffiti.ts';
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
/** The ORIGIN box's content area, a smaller box than the post body the thread tests use. */
const AREA = { w: 480, h: 260 };
const POST = { id: 'post-1', character: 'someone', kind: 'post', thread: 't', payload: {}, currentPayload: {}, targetActId: null, seq: 41, createdAt: '2026-10-29T21:14:00.000Z', editedAt: null, shownEditedAt: null } as unknown as Act;
const PLAY: CardPlay = { id: 'play-g', card: 'graffiti', layer: 1, caster: 'caster-1', message: '', config: {}, playedAt: '2026-10-29T21:05:00.000Z', post: POST.id };

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get(this: HTMLElement) { return this.classList?.contains('kb-act-main') ? BOX.w : this.classList?.contains('kb-origin-area') ? AREA.w : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get(this: HTMLElement) { return this.classList?.contains('kb-act-main') ? BOX.h : this.classList?.contains('kb-origin-area') ? AREA.h : 0; } });
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
    covered: false,
    post: POST, plays: [PLAY], states: {}, released: new Set(), written: new Map(), reader: { author: o.author ?? false, caster: false }, place: 'thread', reach: 'post', still: false, moment: null,
    save: async () => ({ ok: false, error: 'no' }), release: async (play) => ({ ok: true, value: { play, releasedAt: '' } }), show: () => {}, met: () => {}, holdScreen: () => {}, marks: null,
    nameOf: () => 'A character', give: async () => ({ ok: false, error: 'no' }), moreGifts: async () => {}, wallet: null,
    ink: o.ink ?? createClaims().at('post:graffiti', 0), ...(o.surface ? { surface: o.surface } : {}),
    children: o.children ?? <p>The post&apos;s words.</p>,
  };
}

function mount(o: { readonly children?: ReactNode; readonly acts?: readonly SurfaceAct[] | null; readonly author?: boolean; readonly surface?: NonNullable<EffectProps['surface']>; readonly place?: 'thread' | 'origin' } = {}) {
  const surface = o.surface ?? surfaceOf(o.acts === undefined ? MIDDLE : o.acts);
  const shown: CardView[] = [];
  const props = { ...propsOf({ surface, author: o.author ?? false, ...(o.children ? { children: o.children } : {}) }), show: (v: CardView | null) => { if (v) shown.push(v); } };
  const effect = <Effect {...props} place={o.place ?? 'thread'} />;
  /* The ORIGIN box as the engine draws it: the opening post's body, the box (lifted over its ink) and the box's own area. */
  const world = renderInWorld(o.place === 'origin'
    ? <div className="kb-act-main" data-kb-content-area><div className="kb-origin" data-kb-over-ink><div className="kb-origin-area" data-kb-content-area>{effect}</div></div></div>
    : <div className="kb-act-main" data-kb-content-area>{effect}</div>);
  const root = world.container.querySelector('.kb-graffiti') as HTMLElement;
  return { ...world, area: world.container.querySelector('.kb-origin-area') as HTMLElement, surface, shown, root, frame: world.container.querySelector('.kb-graffiti-frame') as HTMLElement, cell: world.container.querySelector('.kb-act-main') as HTMLElement };
}

const wallOf = (call: readonly unknown[]) => call[3] as spray.Wall;
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
    expect(wallOf(vi.mocked(spray.paintWall).mock.calls.at(-1)!).groups).toHaveLength(1);
    see(false);
    expect(root.querySelector('canvas[data-kb-effect-ink]')).toBeNull();
  });

  test('the post\'s words stay drawn, and a wall not yet read draws no strokes', () => {
    const { root } = mount({ acts: null });
    expect(root).toHaveTextContent('The post\'s words.');
    expect(vi.mocked(spray.paintWall).mock.calls.every((c) => wallOf(c).groups.length === 0)).toBe(true);
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
    /* The scrub thins the wall's own paint, on this screen. */
    const field = wallOf(vi.mocked(spray.paintWall).mock.calls.at(-1)!).groups[0]!;
    expect(field.coatsAt(0.4 * BOX.w, 0.5 * BOX.h)).toBeLessThan(COATS.line);
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
    const cuts = (input as { cuts: { draw: string; group: number; presses: [number, number][] }[] }).cuts;
    expect(Object.keys(input as object)).toEqual(['cuts']);
    /* Both drags are the one draw's one group: one cut, its presses in the group's units (a draw from before groups is in shares of the box). */
    expect(cuts).toHaveLength(1);
    expect(Object.keys(cuts[0]!).sort()).toEqual(['draw', 'group', 'presses']);
    expect([cuts[0]!.draw, cuts[0]!.group]).toEqual(['a1', 0]);
    expect(cuts[0]!.presses.length).toBeGreaterThanOrEqual(4);
    for (const [u, v] of cuts[0]!.presses) { expect(u).toBeGreaterThan(0.25); expect(u).toBeLessThan(0.95); expect(v).toBeCloseTo(0.5, 1); }
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
      <div className="kb-act-main" data-kb-content-area><WhoopsEffect {...outer}><Effect {...base} /></WhoopsEffect></div>,
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

describe('in the ORIGIN box', () => {
  /** The frame sits 12px right and 8px down in the area. */
  const realRect = Element.prototype.getBoundingClientRect;
  afterEach(() => { Element.prototype.getBoundingClientRect = realRect; });
  const frameAt = () => {
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const at = this.classList.contains('kb-graffiti-frame') ? { left: 12, top: 8 } : { left: 0, top: 0 };
      return { ...at, right: at.left, bottom: at.top, width: 0, height: 0, x: at.left, y: at.top, toJSON() {} } as DOMRect;
    };
  };

  test("the wall is the content area's size and the Draw tile stands at the area's top right", () => {
    frameAt();
    const see = stubViewport();
    const { root } = mount({ place: 'origin' });
    see(true);
    const canvas = root.querySelector('canvas[data-kb-effect-ink]') as HTMLCanvasElement;
    expect(canvas, 'the wall is drawn, the area measuring something').not.toBeNull();
    expect([canvas.width, canvas.height], "the area's box").toEqual([AREA.w, AREA.h]);
    expect([canvas.style.left, canvas.style.top], "from the area's corner").toEqual(['-12px', '-8px']);
    expect(vi.mocked(spray.paintWall).mock.calls.at(-1)![1], "painted at the area's box").toEqual(AREA);
    const tile = screen.getByRole('button', { name: 'Draw' });
    expect([tile.style.left, tile.style.top], "at the area's top right").toEqual([`${AREA.w - 12}px`, '-8px']);
  });

  test('a press at a share of the body in the thread and at the same share of the area is the same point of the wall: the hit test is asked for the same share of each measured box, and both scrub', () => {
    /* What is drawn is paintWall's (spray.test.tsx owns its pixels); what a mount decides is the box it measures and the share a press is read at. */
    const asked = (place: 'thread' | 'origin', share: readonly [number, number]) => {
      const { area, cell, root, unmount } = mount({ place });
      const [target, box] = place === 'origin' ? [area, AREA] : [cell, BOX];
      vi.mocked(spray.hitAt).mockClear();
      const at = [share[0] * box.w, share[1] * box.h] as const;
      act(() => { fireEvent.pointerDown(target, { clientX: at[0], clientY: at[1], pointerId: 1, button: 0, pointerType: 'mouse' }); });
      act(() => { fireEvent.pointerMove(target, { clientX: at[0] + 20, clientY: at[1], pointerId: 1, pointerType: 'mouse', buttons: 1 }); });
      act(() => { fireEvent.pointerUp(target, { clientX: at[0] + 20, clientY: at[1], pointerId: 1, pointerType: 'mouse' }); });
      const call = vi.mocked(spray.hitAt).mock.calls[0]!;
      const result = { box: call[1], share: [call[2] / call[1].w, call[3] / call[1].h], scrubbed: scrubbed(root) };
      unmount();
      return result;
    };
    const inThread = asked('thread', [0.5, 0.5]);
    const inArea = asked('origin', [0.5, 0.5]);
    expect(inThread.box, 'the thread measures the body').toEqual(BOX);
    expect(inArea.box, "the origin box measures the area, not the post's body").toEqual(AREA);
    expect(inArea.share, 'the same share of each box is asked').toEqual(inThread.share);
    expect(inThread.share[0]).toBeCloseTo(0.5, 5);
    expect(inThread.share[1]).toBeCloseTo(0.5, 5);
    expect([inThread.scrubbed, inArea.scrubbed], 'a press on the middle stripe scrubs in both').toEqual([1, 1]);
    const offStripe = [asked('thread', [0.5, 0.1]), asked('origin', [0.5, 0.1])];
    expect(offStripe.map((r) => r.scrubbed), 'and a press off the stripe, at the same share, scrubs in neither').toEqual([0, 0]);
  });

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
    const last = vi.mocked(spray.paintWall).mock.calls.at(-1)!;
    expect(wallOf(last).groups).toHaveLength(1);
    const draft = last[4] as spray.WallAct;
    expect(draft.kind).toBe('draw');
    expect((draft.payload as { groups: { strokes: unknown[] }[] }).groups[0]!.strokes).toHaveLength(1);
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
    expect(input).toMatchObject({ box: { w: BOX.w / 16, h: BOX.h / 16 }, groups: [{ at: [0.5, 0.2], unit: 'em', strokes: [{ can: 'pink', cap: 'stock', points: [[-7.5, 0], [0, 0], [7.5, 0]] }] }] });
    expect((input as { groups: unknown[] }).groups).toHaveLength(1);
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
    expect(vi.mocked(spray.paintWall).mock.calls.at(-1)![4]).toBeNull();
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

  let latest: NonNullable<EffectProps['surface']> | null = null;
  const lastSurface = () => latest;
  function hosted(o: { author?: boolean } = {}) {
    const ink = createClaims().at('post:graffiti', 0);
    let set: (acts: readonly SurfaceAct[]) => void = () => {};
    let bump: () => void = () => {};
    const wash = vi.fn(answered('w1'));
    function Host() {
      const [acts, setActs] = useState<readonly SurfaceAct[]>(MIDDLE);
      const [n, setN] = useState(0);
      set = setActs;
      bump = () => setN((v) => v + 1);
      const surface = useMemo(() => { latest = surfaceOf(acts, { wash }); return latest; }, [acts]);
      return <div className="kb-act-main" data-kb-content-area><Effect {...propsOf({ surface, ink, ...(o.author ? { author: true } : {}) })}><p data-n={n}>The post&apos;s words.</p></Effect></div>;
    }
    const world = renderInWorld(<Host />);
    return { ...world, setActs: (a: readonly SurfaceAct[]) => act(() => set(a)), bump: () => act(() => bump()), frame: world.container.querySelector('.kb-graffiti-frame') as HTMLElement };
  }
  const lastWall = () => wallOf(vi.mocked(spray.paintWall).mock.calls.at(-1)!);

  test('a scrub is kept for the visit: a new tag arriving rebuilds the wall and the thinned paint stays thinned, and the tag is whole', () => {
    const { frame, setActs } = hosted();
    drag(frame, [[0.3, 0.5], [0.5, 0.5]]);
    const thinned = lastWall().groups[0]!.coatsAt(0.4 * BOX.w, 0.5 * BOX.h);
    expect(thinned).toBeLessThan(COATS.line);
    setActs([...MIDDLE, draw('a2', 0.2)]);
    const wall = lastWall();
    expect(wall.groups).toHaveLength(2);
    expect(wall.groups[0]!.coatsAt(0.4 * BOX.w, 0.5 * BOX.h)).toBeCloseTo(thinned, 1);
    expect(wall.groups[1]!.coatsAt(0.4 * BOX.w, 0.2 * BOX.h)).toBe(COATS.line);
  });

  test('a scrub is not made twice once the wall holds the wash that saved it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { frame, setActs } = hosted({ author: true });
    drag(frame, [[0.3, 0.5], [0.5, 0.5]]);
    await act(async () => { await vi.advanceTimersByTimeAsync(WASH_AFTER_MS + 10); });
    const cuts = (vi.mocked(lastSurface()!.wash).mock.calls[0]![1] as { cuts: unknown[] }).cuts;
    const saved: SurfaceAct = { id: 'w1', kind: 'wash', character: 'c', createdAt: '2026-10-29T21:09:00.000Z', payload: { cuts } } as unknown as SurfaceAct;
    const before = lastWall().groups[0]!.coatsAt(0.4 * BOX.w, 0.5 * BOX.h);
    setActs([...MIDDLE, saved]);
    expect(lastWall().groups[0]!.coatsAt(0.4 * BOX.w, 0.5 * BOX.h)).toBeCloseTo(before, 1);
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
      return <div className="kb-act-main" data-kb-content-area><Effect {...propsOf({ surface, ink })} plays={has ? [PLAY] : []} /></div>;
    }
    const world = renderInWorld(<Host />);
    return { ...world, root: world.container.querySelector('.kb-graffiti') as HTMLElement, setActs: (a: readonly SurfaceAct[]) => act(() => setActs(a)), setHas: (h: boolean) => act(() => setHas(h)) };
  }
  const open = () => { act(() => { fireEvent.click(screen.getByRole('button', { name: 'Draw' })); }); };
  const lastCall = () => vi.mocked(spray.paintWall).mock.calls.at(-1)!;

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
    expect(wallOf(lastCall()).groups).toHaveLength(1);
    expect((lastCall()[4] as spray.WallAct).kind).toBe('draw');
    const tagged = draw('d', 0.2);
    setActs([...MIDDLE, tagged]);
    expect(wallOf(lastCall()).groups).toHaveLength(2);
    expect(lastCall()[4]).toBeNull();
  });

  test('a wall that changes some other way drops the held drawing too', async () => {
    const { root, setActs } = hosted();
    open();
    drag(root.querySelector('[data-kb-draw-surface]') as HTMLElement, [[0.3, 0.2], [0.5, 0.2], [0.7, 0.2]]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tag it' })); });
    setActs([...MIDDLE, draw('other', 0.8)]);
    expect(wallOf(lastCall()).groups).toHaveLength(2);
    expect(lastCall()[4]).toBeNull();
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

  /* The ORIGIN box breaks its words anywhere (spin.css), and the tile, absolute at the area's right edge, shrinks to its narrowest: a letter a row. */
  test('the Draw tile keeps its word on one line wherever it is drawn', () => {
    const css = readFileSync('instances/divided-world/cards/graffiti/graffiti.css', 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
    const rule = /\.kb-graffiti-draw\.kb-graffiti-draw\s*\{([^}]*)\}/u.exec(css)?.[1] ?? '';
    expect(rule, 'the tile does not wrap').toMatch(/white-space:\s*nowrap/u);
    expect(rule, "the tile does not take the box's break-anywhere").toMatch(/overflow-wrap:\s*normal/u);
  });
});

/** A draw in the groups' shape: one group of one stroke, a box attachment at the middle unless told. */
const grouped = (id: string, points: [number, number][], over: Record<string, unknown> = {}): SurfaceAct => ({
  id, kind: 'draw', character: 'drawer', createdAt: '2026-10-29T21:06:00.000Z',
  payload: { box: { w: 37.5, h: 25 }, groups: [{ at: [0.5, 0.5], anchor: { kind: 'box' }, unit: 'em', strokes: [{ can: 'red', cap: 'stock', points }], ...over }] },
} as unknown as SurfaceAct);
const EM_PX = 16;

describe('the wash is sent in the groups\' own units', () => {
  test('a group scaled to half sends its presses at twice the px distance, keyed by draw and group', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const wide = grouped('wide', [[-40, 0], [40, 0]]);
    const { frame, surface } = mount({ author: true, acts: [wide] });
    const field = () => wallOf(vi.mocked(spray.paintWall).mock.calls.at(-1)!).groups[0]!;
    const scale = field().scale;
    expect(scale).toBeGreaterThan(0.4);
    expect(scale).toBeLessThan(0.5);
    drag(frame, [[0.3, 0.5], [0.4, 0.5], [0.5, 0.5], [0.6, 0.5]]);
    await act(async () => { await vi.advanceTimersByTimeAsync(WASH_AFTER_MS); });
    expect(surface.wash).toHaveBeenCalledTimes(1);
    const { cuts } = vi.mocked(surface.wash).mock.calls[0]![1] as { cuts: { draw: string; group: number; presses: [number, number][] }[] };
    expect(cuts).toHaveLength(1);
    expect([cuts[0]!.draw, cuts[0]!.group]).toEqual(['wide', 0]);
    const presses = cuts[0]!.presses;
    expect(presses.length).toBeGreaterThan(10);
    /* A press every third of the sponge's radius (2 ems), px apart on the screen, and so px / (em * scale) in the group's units. */
    const stepPx = (2 * EM_PX) / 3;
    const du = presses[1]![0] - presses[0]![0];
    expect(du).toBeCloseTo(stepPx / (EM_PX * scale), 1);
    expect(du).toBeGreaterThan((stepPx / EM_PX) * 1.9);
    expect(presses[0]![0]).toBeCloseTo((0.3 * BOX.w - 0.5 * BOX.w) / (EM_PX * scale), 1);
    expect(presses[0]![1]).toBeCloseTo(0, 1);
  });

  test('a reader\'s scrub sends nothing, and still thins the group on their screen', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { frame, surface } = mount({ acts: [grouped('wide', [[-10, 0], [10, 0]])] });
    drag(frame, [[0.3, 0.5], [0.4, 0.5], [0.5, 0.5], [0.6, 0.5]]);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(surface.wash).not.toHaveBeenCalled();
    expect(wallOf(vi.mocked(spray.paintWall).mock.calls.at(-1)!).groups[0]!.coatsAt(0.5 * BOX.w, 0.5 * BOX.h)).toBeLessThan(COATS.line);
  });
});

describe('Hold to scrub', () => {
  test('goes round only the bands that still have paint and stops once the fields are clean', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const { shown, root } = mount({ acts: [grouped('wide', [[-10, 0], [10, 0]])] });
    const hold = shown.at(-1)!.controls.find((c) => c.label === 'Hold to scrub')!;
    expect(hold.kind).toBe('hold');
    const wall = () => wallOf(vi.mocked(spray.paintWall).mock.calls.at(-1)!);
    expect(wall().anyPaint()).toBe(true);
    act(() => { (hold as { start: () => void }).start(); });
    for (let i = 0; i < 60 * 40 && wall().anyPaint(); i++) act(() => { vi.advanceTimersByTime(16); });
    expect(wall().anyPaint()).toBe(false);
    /* It has gone idle by itself: nothing more is scrubbed, however long the button is held. */
    const strokes = scrubbed(root);
    for (let i = 0; i < 120; i++) act(() => { vi.advanceTimersByTime(16); });
    expect(scrubbed(root)).toBe(strokes);
    act(() => { (hold as { stop: () => void }).stop(); });
    /* A band with no paint was passed over: the stripe is one band's width, so a sweep of a 400 px box began and ended on it. */
    expect(strokes).toBeLessThanOrEqual(6);
  });
});

describe('where a text group is after a resize', () => {
  test('is at its mark\'s new position, found again when the body resizes', () => {
    const marks = { left: 100, top: 60 };
    const real = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.hasAttribute('data-kb-graffiti-mark')) return { left: marks.left, top: marks.top, right: marks.left, bottom: marks.top + 18, width: 0, height: 18, x: marks.left, y: marks.top, toJSON: () => ({}) } as DOMRect;
      return real.call(this);
    };
    const watchers: (() => void)[] = [];
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { watchers.push(cb); } observe() {} unobserve() {} disconnect() {} });
    try {
      const anchor = { kind: 'text', version: 'v', at: 4, len: 4, dx: 2, dy: 1 };
      const act1 = grouped('t', [[0, 0], [4, 0]], { at: [0.9, 0.9], anchor });
      const { surface } = mount({ acts: [act1], children: <p><BbCode text="The post words go here." /></p> });
      void surface;
      const field = () => wallOf(vi.mocked(spray.paintWall).mock.calls.at(-1)!).groups[0]!;
      expect([field().ox, field().oy]).toEqual([100 + 2 * EM_PX, 60 + EM_PX]);
      marks.left = 30; marks.top = 140;
      act(() => { watchers.forEach((w) => w()); });
      expect([field().ox, field().oy]).toEqual([30 + 2 * EM_PX, 140 + EM_PX]);
    } finally {
      Element.prototype.getBoundingClientRect = real;
    }
  });
});
