/**
 * Steel Chair's effect (docs/plans/2026-11-15-steel-chair-plan.md, Task 5, as amended: the world is the post's content area). Read here: which
 * plays are drawn, what a run is and when it starts and ends, where the chairs come to rest, the sounds, reduced motion, a play's moment, the
 * filter's two branches, what the Lens is told, and that nothing depends on who is reading. jsdom has no layout, so the boxes are stubbed: the
 * content area (`.kb-act-main`) is 300 by `size.h`, the effect's host sits 10 px in from its left and 8 px down, and the words are the host's box
 * less the room (chair.ts ROOM_HEIGHT). Frames are the test's own (`requestAnimationFrame` is a queue it drains with a clock it advances), and the
 * observers are fakes it fires.
 */
import { act, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CardPlay, CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { viewProblems } from '../../../../engine/ui/cards/lens-words.ts';
import { NO_INK } from '../../../../engine/ui/cards/claims.ts';
import type { Act } from '../../../../engine/ui/data/api.ts';
import { renderInWorld } from '../../../../engine/ui/test-world.tsx';
import { bodies, DEPTH, HALF } from './body.ts';
import { depthOf, FLOOR_DEPTH, GIVE, INSET, K, ROOM_HEIGHT, Z_FRONT } from './chair.ts';
import { DENT_SCALE, dentShape, dentsOverlap } from './dent.ts';
import { SteelChairEffect } from './Effect.tsx';

const hub = vi.hoisted(() => ({
  trusted: true,
  gameOn: false,
  set: undefined as unknown as (on: boolean) => void,
  sound: { play: undefined as unknown as ReturnType<typeof import('vitest').vi.fn>, loop: undefined as unknown, caption: undefined as unknown },
  setPlays: (() => {}) as (plays: CardPlay[]) => void,
  /* What the mocked body.ts saw: the steps run, and the world the last run built. */
  steps: 0,
  world: null as import('./body.ts').World | null,
}));
vi.mock('./body.ts', async (original) => {
  const actual = await original<typeof import('./body.ts')>();
  return {
    ...actual,
    step: (...a: Parameters<typeof actual.step>) => { hub.steps++; return actual.step(...a); },
    createWorld: (...a: Parameters<typeof actual.createWorld>) => { hub.world = actual.createWorld(...a); return hub.world; },
  };
});
vi.mock('../../../../engine/ui/audio/useGameSound.ts', () => ({ useGameSound: () => ({ on: hub.gameOn, set: hub.set }) }));
vi.mock('../../../../engine/ui/audio/sound.ts', async (original) => {
  const actual = await original<typeof import('../../../../engine/ui/audio/sound.ts')>();
  return { ...actual, useSound: () => hub.sound };
});
vi.mock('./dent.ts', async (original) => {
  const actual = await original<typeof import('./dent.ts')>();
  return { ...actual, filterTrusted: () => hub.trusted, dentMapUrl: () => 'data:image/png;base64,AAAA' };
});

const post = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: '2026-10-29T12:00:00Z', payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null } as unknown as Act;
const FAR = '2099-01-01T00:00:00Z';
const play = (n: number, ends: string | undefined = FAR): CardPlay => ({ id: `sc${n}`, card: 'steel-chair', layer: n, caster: 'c2', message: '', config: {}, playedAt: '2026-10-29T12:00:00Z', post: 'p1', ...(ends !== undefined ? { ends } : {}) });

/* The page, as the test drives it. */
let queue = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
let requested = 0;
let clock = 0;
const drain = () => { const run = [...queue.values()]; queue.clear(); clock += 16; for (const cb of run) cb(clock); };
/** One frame's time: the timers' 16 ms and the frames the page asked for. */
const frame = () => act(() => { vi.advanceTimersByTime(16); drain(); });
/** Frames until the page asks for none and at least `least` ms have passed (the throws are 350 ms apart), at most `most` frames. */
const rest = (least = 1200, most = 1500) => { const from = clock; for (let i = 0; i < most && (queue.size > 0 || clock - from < least); i++) frame(); };
const settled = () => { act(() => { vi.advanceTimersByTime(0); }); rest(); };

const watching: { cb: IntersectionObserverCallback; seen: Set<Element>; opts?: IntersectionObserverInit }[] = [];
class FakeIntersection {
  readonly entry = { cb: undefined as unknown as IntersectionObserverCallback, seen: new Set<Element>(), opts: undefined as IntersectionObserverInit | undefined };
  constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) { this.entry.cb = cb; this.entry.opts = opts; watching.push(this.entry); }
  observe(el: Element) { this.entry.seen.add(el); }
  unobserve(el: Element) { this.entry.seen.delete(el); }
  disconnect() { this.entry.seen.clear(); }
  takeRecords() { return []; }
}
const tell = (o: (typeof watching)[number], on: boolean) => { for (const el of o.seen) o.cb([{ target: el, isIntersecting: on, intersectionRatio: on ? 1 : 0 } as IntersectionObserverEntry], o as unknown as IntersectionObserver); };
/** The post's middle comes into the view (or leaves it): the arming observer, the one with the margin. */
const aim = (on: boolean) => act(() => { for (const o of watching) if (o.opts?.rootMargin) tell(o, on); });
/** The post is in the view at all (or wholly gone): the observer without a margin. */
const see = (on: boolean) => act(() => { for (const o of watching) if (!o.opts?.rootMargin) tell(o, on); });
const watched = () => watching.filter((o) => o.seen.size > 0).length;
const sized: { cb: () => void; watching: Set<Element> }[] = [];
class FakeResize {
  readonly entry = { cb: undefined as unknown as () => void, watching: new Set<Element>() };
  constructor(cb: () => void) { this.entry.cb = cb; sized.push(this.entry); }
  observe(el: Element) { this.entry.watching.add(el); }
  unobserve(el: Element) { this.entry.watching.delete(el); }
  disconnect() { this.entry.watching.clear(); }
}
let size = { h: 200 };
/** The content area's width: 300 unless a test narrows the post. */
let areaWidth = 300;
/** Whether the words wrapper's client rect is moved 4 px by the hit's shake (a transform moves `getBoundingClientRect` and not `offsetLeft`). */
let shaking = false;
/** Whether the content area is `size.h` tall plus the room while the effect's host is in it (what the CSS does), or `size.h` always. */
let roomAdds = false;
/** The boxes a `Range` over a text node reports (jsdom has no `getClientRects`), in the window's px, or none. A range over an element reports that element's border box too, as a browser does (the wrapper's, 280 wide), which is not where the text is. */
let textRects: { left: number; top: number; width: number; height: number }[] | null = null;
/** The post comes into the middle of the view and stays for the arming wait: a run starts. */
const arm = () => { aim(true); act(() => { vi.advanceTimersByTime(300); }); };
/** The post's middle comes into view; a run begins and the world goes on to rest. */
const run = () => { see(true); arm(); settled(); };

interface Options { plays?: CardPlay[]; still?: boolean; place?: 'thread' | 'origin'; reader?: EffectProps['reader']; wrapped?: boolean }
const made = { show: vi.fn<(view: CardView | null) => void>(), met: vi.fn(), save: vi.fn(), release: vi.fn() };
function Host({ o }: { o: Options }) {
  const [plays, setPlays] = useState(o.plays ?? [play(1)]);
  hub.setPlays = setPlays;
  const props: EffectProps = {
    post, plays, states: {}, released: new Set(), written: new Map(), reader: o.reader ?? { author: false, caster: false }, place: o.place ?? 'thread', reach: 'post', still: o.still ?? false,
    show: made.show, met: made.met, ink: NO_INK, holdScreen: () => {}, marks: null, save: made.save, release: made.release, nameOf: () => 'Spritey', give: async () => ({ ok: false, error: 'no' }), moreGifts: async () => {}, wallet: null,
    children: <p data-kb-words>The words of the post.</p>,
  };
  const inner = <SteelChairEffect {...props} />;
  return o.wrapped === false ? inner : <div className="kb-act-main">{inner}</div>;
}
const mount = (o: Options = {}) => renderInWorld(<Host o={o} />);
const lastView = (): CardView => made.show.mock.calls.filter((c) => c[0] !== null).at(-1)![0]!;
const sheet = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'steel-chair.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
/** The text inside the braces of the first at-rule that starts with `head`, or null (braces matched, so nested rules are inside it), and the sheet with that at-rule taken out. */
function atRule(source: string, head: string): { inner: string | null; rest: string } {
  const at = source.indexOf(head);
  if (at < 0) return { inner: null, rest: source };
  const open = source.indexOf('{', at);
  let depth = 0, end = open;
  for (; end < source.length; end++) { if (source[end] === '{') depth++; else if (source[end] === '}' && --depth === 0) break; }
  return { inner: source.slice(open + 1, end), rest: source.slice(0, at) + source.slice(end + 1) };
}
const SUPPORTS_HAS = '@supports selector(:has(a))';
const guarded = atRule(sheet, SUPPORTS_HAS);
const rulesOf = (source: string, selector: string) => [...source.matchAll(/([^{}]+)\{([^}]*)\}/gu)].filter(([, sel]) => sel!.split(',').some((x) => x.trim() === selector)).map(([, , body]) => body).join(';');
/** The rules outside the `@supports` block. */
const ruleOf = (selector: string) => rulesOf(guarded.rest, selector);
/** The rules that only apply where `:has()` does. */
const ruleWithHas = (selector: string) => rulesOf(guarded.inner ?? '', selector);

const rect = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) });
const areaHeight = (el: Element) => size.h + (roomAdds && el.querySelector('.dw-chair') ? ROOM_HEIGHT : 0);

const host = () => document.querySelector<HTMLElement>('.dw-chair');
const wordsEl = () => document.querySelector<HTMLElement>('.dw-chair-words')!;
const groups = () => [...document.querySelectorAll<HTMLElement>('.dw-chair-group')];
const dents = () => [...document.querySelectorAll<HTMLElement>('.dw-chair-dent')];
const dentAt = () => dents().map((d) => [d.style.left, d.style.top]);
/**
 * Where a chair's eight corners are drawn, in the content area's px: the group's transform string (translate3d, perspective, matrix3d, scale3d,
 * left to right, as chair.ts `transformOf` writes it) carried out on each corner of the folded box, perspective divide included.
 */
function corners(group: HTMLElement): { x: number; y: number }[] {
  const mulM = (a: number[], b: number[]) => { const o = new Array<number>(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] = o[c * 4 + r]! + a[k * 4 + r]! * b[c * 4 + k]!; return o; };
  let m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const [, fn, args] of group.style.transform.matchAll(/([a-z0-9]+)\(([^)]*)\)/gu)) {
    const n = args!.split(',').map(parseFloat);
    m = mulM(m, fn === 'translate3d' ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, n[0]!, n[1]!, n[2]!, 1]
      : fn === 'perspective' ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1 / n[0]!, 0, 0, 0, 1]
      : fn === 'scale3d' ? [n[0]!, 0, 0, 0, 0, n[1]!, 0, 0, 0, 0, n[2]!, 0, 0, 0, 0, 1]
      : n);
  }
  const out: { x: number; y: number }[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const v = [sx * HALF[0], sy * HALF[1], sz * HALF[2]] as const;
    const w = m[3]! * v[0] + m[7]! * v[1] + m[11]! * v[2] + m[15]!;
    out.push({ x: (m[0]! * v[0] + m[4]! * v[1] + m[8]! * v[2] + m[12]!) / w, y: (m[1]! * v[0] + m[5]! * v[1] + m[9]! * v[2] + m[13]!) / w });
  }
  return out;
}
/** How far past a border a resting chair's corner may be drawn: none (the world is inset by chair.ts `INSET` so the chair's own perspective cannot take it past), to a hundredth of a px. */
const SLACK = 0.01;
/**
 * The highest a resting chair's lowest drawn point can be above the bottom border: the floor recedes up the screen, so a chair standing on a
 * narrow face at the very back (its contact points at most 4 px in front of its middle, which is at -(DEPTH + GIVE)) is lifted by this much; a chair
 * lying flat is lifted by at most FLOOR_DEPTH, 28.
 */
const HIGHEST = K * (Z_FRONT + DEPTH + GIVE + HALF[2]);
/** A resting chair is drawn on or above the content area's bottom border (within `SLACK`), and no more than `HIGHEST` above it. */
function expectOnFloor(group: HTMLElement, floor: number): void {
  const low = Math.max(...corners(group).map((c) => c.y));
  expect(low, 'lowest drawn point against the bottom border').toBeLessThanOrEqual(floor + SLACK);
  expect(low, "lowest drawn point is within the floor's depth of the border").toBeGreaterThan(floor - HIGHEST - 0.5);
}

/*
 * Every run draws its throws from a generator seeded from `crypto.getRandomValues`. So that the file does not depend on luck, each test has
 * the same sequence of seeds (every run a test makes gets the next one, so two runs still differ), and a test that needs one throw pins it.
 */
/** A seed for which sc1 and sc3 lie on the floor and not on sc2 (seed 4, for one, lands a chair on sc2: it falls when sc2 goes). */
const PINNED_SEED = 2;
let seeds = 0;
/** The seed the nth unpinned run gets. */
const seedAt = (n: number) => Math.imul(n, 2654435761) >>> 0;
let pinned: number | null = null;
const pin = (seed: number | null) => { pinned = seed; };

beforeEach(() => {
  vi.useFakeTimers();
  queue = new Map(); nextFrame = 1; requested = 0; clock = 0; watching.length = 0; sized.length = 0; size = { h: 200 }; areaWidth = 300; shaking = false; roomAdds = false; textRects = null; seeds = 0; pinned = null; hub.steps = 0; hub.world = null;
  const realRandom = crypto.getRandomValues.bind(crypto);
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(((a: ArrayBufferView) => {
    if (a instanceof Uint32Array && a.length === 1) { a[0] = pinned ?? seedAt(++seeds); return a; }
    return realRandom(a as Uint8Array);
  }) as typeof crypto.getRandomValues);
  (Range.prototype as unknown as { getClientRects: (this: Range) => unknown }).getClientRects = function (this: Range) {
    if (textRects === null) return [];
    return this.startContainer.nodeType === Node.TEXT_NODE ? textRects.map((r) => rect(r.left, r.top, r.width, r.height)) : [rect(10, 8, 280, size.h - 16 - ROOM_HEIGHT)];
  };
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { const id = nextFrame++; requested++; queue.set(id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { queue.delete(id); });
  vi.stubGlobal('IntersectionObserver', FakeIntersection);
  vi.stubGlobal('ResizeObserver', FakeResize);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.classList.contains('kb-act-main')) return rect(0, 0, areaWidth, areaHeight(this));
    if (this.classList.contains('dw-chair')) return rect(10, 8, 280, size.h - 16);
    if (this.classList.contains('dw-chair-words')) return shaking ? rect(14, 7, 280, size.h - 16 - ROOM_HEIGHT) : rect(10, 8, 280, size.h - 16 - ROOM_HEIGHT);
    return rect(0, 0, 0, 0);
  });
  /* The words wrapper's layout box inside its offset parent (the host), which a transform does not move: where the host's box is 10 and 8 in from the content area. */
  const layoutBox = (el: HTMLElement) => (el.classList.contains('dw-chair-words') ? { left: 0, top: 0, width: 280, height: size.h - 16 - ROOM_HEIGHT } : { left: 0, top: 0, width: 0, height: 0 });
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) { return layoutBox(this).left; });
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) { return layoutBox(this).top; });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return layoutBox(this).width; });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return layoutBox(this).height; });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('kb-act-main') ? areaWidth : 0; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('kb-act-main') ? areaHeight(this) : 0; });
  document.documentElement.setAttribute('data-kb-motion', 'full');
  hub.trusted = true;
  hub.gameOn = false;
  hub.set = vi.fn();
  hub.sound = { play: vi.fn(async () => null), loop: vi.fn(), caption: vi.fn() };
  made.show.mockClear(); made.met.mockClear(); made.save.mockClear(); made.release.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
  document.documentElement.removeAttribute('data-kb-motion');
});

describe('which plays, and what is drawn', () => {
  test('with no live play it draws the words alone and shows nothing: no host, no room, no chairs', () => {
    mount({ plays: [play(1, '2000-01-01T00:00:00Z')] });
    expect(document.querySelector('[data-kb-words]')).toHaveTextContent('The words of the post.');
    expect(host()).toBeNull();
    expect(document.querySelector('.dw-chair-room')).toBeNull();
    expect(made.show).toHaveBeenLastCalledWith(null);
    expect(made.show.mock.calls.every((c) => c[0] === null)).toBe(true);
  });

  test.each([1, 2, 3])('with %i live plays a run draws that many chairs and dents', (n) => {
    mount({ plays: Array.from({ length: n }, (_, i) => play(i + 1)) });
    expect(groups()).toHaveLength(0);
    run();
    expect(groups()).toHaveLength(n);
    expect(dents()).toHaveLength(n);
  });

  /* The room is "room inside the content area above its bottom border": the reactions row, the signature and the spun line come after the
     effect's host in `.kb-act-main`, so a strip under the words is nowhere near the floor. The room is the content area's own last ROOM_HEIGHT px. */
  test('inside a content area the room is its last ROOM_HEIGHT px, added by a static rule while the effect has a live play', () => {
    /* Both rules sit inside `@supports selector(:has(a))`: a browser without `:has()` never applies the `::after`, so it must not hide the strip in the host either. */
    expect(guarded.inner, 'the :has() rules are inside an @supports block').not.toBeNull();
    expect(ruleOf('.kb-act-main:has(.dw-chair)::after'), 'the ::after is not outside the @supports block').toBe('');
    expect(ruleOf('.kb-act-main .dw-chair-room'), 'hiding the strip is not outside the @supports block').toBe('');
    expect(ruleWithHas('.kb-act-main:has(.dw-chair)::after')).toMatch(/content:\s*''/u);
    expect(ruleWithHas('.kb-act-main:has(.dw-chair)::after')).toMatch(/display:\s*block/u);
    expect(ruleWithHas('.kb-act-main:has(.dw-chair)::after')).toMatch(new RegExp(`height:\\s*${ROOM_HEIGHT}px`, 'u'));
    mount();
    /* `.dw-chair` is in the page only while a play is live: the rule's condition. The strip inside the host is hidden where there is a content area. */
    expect(host()).not.toBeNull();
    expect(ruleWithHas('.kb-act-main .dw-chair-room')).toMatch(/display:\s*none/u);
    /* The strip itself is a plain rule, so without `:has()` it stays, ROOM_HEIGHT px, in the host. */
    expect(ruleOf('.dw-chair-room')).toMatch(new RegExp(`height:\\s*${ROOM_HEIGHT}px`, 'u'));
    cleanup();
    mount({ plays: [play(1, '2000-01-01T00:00:00Z')] });
    expect(host()).toBeNull();
  });

  test('outside a content area the room stays in the host, after the words: ROOM_HEIGHT px', () => {
    mount({ place: 'origin', wrapped: false });
    const room = document.querySelector('.dw-chair-room')!;
    expect(ruleOf('.dw-chair-room')).toMatch(new RegExp(`height:\\s*${ROOM_HEIGHT}px`, 'u'));
    expect(wordsEl().nextElementSibling).toBe(room);
    expect(host()).toContainElement(room as HTMLElement);
  });

  test('the host carries no data-kb-chair mark: nothing reads it', () => {
    mount();
    expect(host()).not.toHaveAttribute('data-kb-chair');
  });

  test('the world is sized after the room: the first run starts with the content area as tall as it is with the room in it', () => {
    roomAdds = true;
    mount();
    run();
    /* The world is the content area less the inset (chair.ts `INSET`) at the sides and the floor. */
    expect(hub.world!.width).toBeCloseTo(300 - 2 * INSET, 6);
    expect(hub.world!.height).toBeCloseTo(200 + ROOM_HEIGHT - INSET, 6);
    expect(hub.world!.floorY).toBeCloseTo(200 + ROOM_HEIGHT - INSET, 6);
    const layer = document.querySelector<HTMLElement>('.dw-chair-layer')!;
    expect(layer.style.height).toBe(`${200 + ROOM_HEIGHT}px`);
  });

  test('a fourth play handed over with one ended draws three', () => {
    mount({ plays: [play(1), play(2, '2000-01-01T00:00:00Z'), play(3), play(4), play(5)] });
    run();
    expect(groups()).toHaveLength(3);
    expect(dents()).toHaveLength(3);
  });

  test('a play whose end passes on an open page loses its chair and dent, and the others stay where they lie', () => {
    /* Removing a body wakes the ones left, so a chair that lay on the removed one must fall; the run is seeded from `crypto`, so the seed is
       pinned to a throw in which neither remaining chair rests on sc2 (both lie on the floor), and the others then stay exactly where they lie. */
    pin(PINNED_SEED);
    const w = mount({ plays: [play(1), play(2, '2026-10-29T12:00:30Z'), play(3)] });
    run();
    expect(groups()).toHaveLength(3);
    const heldAt = new Map(groups().filter((g) => g.dataset.play !== 'sc2').map((g) => [g.dataset.play, g.style.transform]));
    act(() => { w.fake.clock.advance(31_000); vi.advanceTimersByTime(31_000); });
    rest(400);
    expect(groups().map((g) => g.dataset.play).sort()).toEqual(['sc1', 'sc3']);
    expect(dents()).toHaveLength(2);
    expect(groups().every((g) => g.hasAttribute('data-rest'))).toBe(true);
    for (const [id, was] of heldAt) expect(groups().find((g) => g.dataset.play === id)!.style.transform, `chair ${id}`).toBe(was);
  });

  test('a play that lands while the post is in view throws that chair alone into the standing world', () => {
    mount({ plays: [play(1)] });
    run();
    const first = groups()[0]!.style.transform;
    const dent = dentAt();
    act(() => { hub.setPlays([play(1), play(2)]); });
    expect(groups()).toHaveLength(2);
    rest(900);
    expect(groups()).toHaveLength(2);
    expect(dents()).toHaveLength(2);
    expect(dentAt()[0]).toEqual(dent[0]);
    expect(groups()[0]!.hasAttribute('data-rest')).toBe(true);
    expect(first).toBeTruthy();
  });
});

describe('the layers and the world fill the content area', () => {
  test('both layers are marked as ink and placed over the content area border to border, and a resize places them again', () => {
    mount();
    run();
    const layers = [document.querySelector<HTMLElement>('.dw-chair-layer')!, document.querySelector<HTMLElement>('.dw-chair-dents')!];
    for (const l of layers) {
      expect(l).toHaveAttribute('data-kb-effect-ink');
      expect(l).toHaveAttribute('aria-hidden', 'true');
      expect(l.parentElement).toBe(host());
      /* The content area starts 10 px left of and 8 px above the host, and is 300 wide and `size.h` tall. */
      expect([l.style.left, l.style.top, l.style.width, l.style.height]).toEqual(['-10px', '-8px', '300px', '200px']);
    }
    size = { h: 260 };
    act(() => { for (const r of sized) r.cb(); });
    for (const l of layers) expect([l.style.left, l.style.top, l.style.width, l.style.height]).toEqual(['-10px', '-8px', '300px', '260px']);
  });

  test('the content area is found with the body and watched, so a resize wakes the chairs and they come to rest on the new floor', () => {
    mount();
    run();
    const body = document.querySelector('.kb-act-main')!;
    expect(sized.some((r) => r.watching.has(body) && r.watching.has(host()!))).toBe(true);
    expectOnFloor(groups()[0]!, 200);
    size = { h: 260 };
    act(() => { for (const r of sized) r.cb(); });
    expect(queue.size).toBeGreaterThan(0);
    rest(600);
    expectOnFloor(groups()[0]!, 260);
    expect(queue.size).toBe(0);
  });

  test('outside a thread there is no body, and the effect\'s own box is the world', () => {
    mount({ place: 'origin', wrapped: false });
    run();
    const layer = document.querySelector<HTMLElement>('.dw-chair-layer')!;
    expect([layer.style.left, layer.style.top, layer.style.width, layer.style.height]).toEqual(['0px', '0px', '280px', '184px']);
    expect(groups()).toHaveLength(1);
    expectOnFloor(groups()[0]!, 184);
  });

  test('every chair ends inside the content area, on its bottom border or on another chair, asleep, and the frame loop stops', () => {
    mount();
    run();
    expect(queue.size).toBe(0);
    const [g] = groups();
    expect(g).toHaveAttribute('data-rest');
    const cs = corners(g!);
    expectOnFloor(g!, 200);
    for (const c of cs) { expect(c.x).toBeGreaterThan(-SLACK); expect(c.x).toBeLessThan(300 + SLACK); }
    const asked = requested;
    act(() => { vi.advanceTimersByTime(2000); });
    expect(requested).toBe(asked);
  });

  test('three chairs all come to rest inside the content area', () => {
    mount({ plays: [play(1), play(2), play(3)] });
    run();
    expect(queue.size).toBe(0);
    for (const g of groups()) {
      expect(g).toHaveAttribute('data-rest');
      expectOnFloor(g, 200);
      for (const c of corners(g)) { expect(c.x).toBeGreaterThan(-SLACK); expect(c.x).toBeLessThan(300 + SLACK); }
    }
  });

  /* The words' wrapper is as wide as the content area, so on a one-line post a throw aimed at its box lands right of the text and bends nothing.
     The aim is the box the text really takes: the union of the client rects of a Range over the words (stubbed: jsdom has none). Where that box
     is shorter than a dent it is grown (dent.ts `hitZone`, and its own tests): the dent's center may be a dent's width beside the text, or below it, so the dent may land off the text. */
  test("the throw aims at the box the text really occupies, not the words wrapper's: the dent's center is within a dent's reach of it, inside the content area", () => {
    textRects = [{ left: 40, top: 30, width: 60, height: 18 }, { left: 40, top: 48, width: 30, height: 18 }];
    for (let k = 0; k < 6; k++) {
      pin(1000 + k);
      const w = mount();
      run();
      const [d] = dents();
      const x = parseFloat(d!.style.left), y = parseFloat(d!.style.top), dw = parseFloat(d!.style.width), dh = parseFloat(d!.style.height);
      /* The text's union is x 40 to 100, y 30 to 66 in the content area's px (it starts at the window's origin); the dent's center is no more than
         a dent's width beside it and a dent's height below it, and no more than half a dent's height above its top. */
      const cx = x + dw / 2, cy = y + dh / 2;
      expect(cx >= 40 - dw - 0.5 && cx <= 100 + dw + 0.5 && cy >= 30 - dh / 2 - 0.5 && cy <= 66 + dh + 0.5, `dent box ${x},${y} ${dw}x${dh} is within reach of the text (40 to 100, 30 to 66)`).toBe(true);
      /* The area (300 by 200) holds a dent, so the dent lies inside it. */
      expect(x).toBeGreaterThanOrEqual(-0.5); expect(y).toBeGreaterThanOrEqual(-0.5);
      expect(x + dw).toBeLessThanOrEqual(300.5); expect(y + dh).toBeLessThanOrEqual(200.5);
      w.unmount();
    }
  });

  test('where a Range reports nothing (no layout), the aim falls back to the words wrapper\'s box', () => {
    textRects = null;
    pin(7);
    mount();
    run();
    const [d] = dents();
    const x = parseFloat(d!.style.left) + parseFloat(d!.style.width) / 2;
    /* The wrapper is 280 wide, 10 in from the content area's edge: the aim is anywhere across it. */
    expect(x).toBeGreaterThanOrEqual(10 + 0.15 * 280 - 0.01);
    expect(x).toBeLessThanOrEqual(10 + 0.85 * 280 + 0.01);
  });

  test('a chair nearer the reader paints over one farther back: each group has the z-index of its depth', () => {
    mount({ plays: [play(1), play(2), play(3)] });
    run();
    const z = new Map(bodies(hub.world!).map((b) => [`sc${b.id}`, b.position.z]));
    const index = new Map(groups().map((g) => [g.dataset.play!, Number(g.style.zIndex)]));
    expect(groups().every((g) => /^\d+$/u.test(g.style.zIndex))).toBe(true);
    for (const [a, za] of z) {
      expect(index.get(a)).toBe(depthOf(za));
      for (const [b, zb] of z) if (za > zb + 0.2) expect(index.get(a)!, `${a} (z ${za}) over ${b} (z ${zb})`).toBeGreaterThan(index.get(b)!);
    }
  });

  test('a hit puts a dent at its point and shakes the post once, with no filter attribute left on the words that nothing needs', () => {
    mount();
    see(true); arm();
    expect(wordsEl()).not.toHaveAttribute('data-shake');
    settled();
    expect(wordsEl()).toHaveAttribute('data-shake');
    expect(dents()).toHaveLength(1);
  });
});

describe('what a re-arm and a reflow leave behind', () => {
  /* The run's effect re-arms when reduced motion, the place or the moment changes. Its cleanup used to keep the drawn chairs and dents (clearing
     only the run's own state), and the reduced path skips a play that already has a dent, so the old dent stayed where it was while the new chair
     was aimed elsewhere. */
  test("turning reduced motion on while a run stands re-arms with no ghosts: one dent per live play, at the new run's hit", async () => {
    mount({ plays: [play(1), play(2)] });
    run();
    const before = dentAt();
    expect(before).toHaveLength(2);
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    await act(async () => { await Promise.resolve(); });
    /* The old chairs and dents are gone with the run that drew them, and nothing is drawn until the post's middle is seen again. */
    expect(groups()).toHaveLength(0);
    expect(dents()).toHaveLength(0);
    aim(true);
    expect(groups()).toHaveLength(2);
    expect(dents(), 'exactly one dent per live play').toHaveLength(2);
    const after = dentAt();
    expect(after).not.toEqual(before);
    /* The same seed in a fresh reduced mount draws the same hits: the dents are where this run's chairs were aimed. */
    cleanup();
    pin(seedAt(2));
    mount({ plays: [play(1), play(2)] });
    see(true); aim(true);
    expect(dentAt()).toEqual(after);
  });

  /* A transform (the hit's 4 px shake) moves getBoundingClientRect but not the layout box, so a size callback that fires mid-shake must not
     read the shake as a new place for the words, store it, and wake the world. */
  test("a size callback mid-shake measures the words' layout, not their shaken box: nothing moves and no frame is asked for", () => {
    mount();
    run();
    expect(wordsEl()).toHaveAttribute('data-shake');
    const asked = requested;
    const filterBefore = document.querySelector('filter')!.getAttribute('x');
    shaking = true;
    act(() => { for (const r of sized) r.cb(); });
    expect(requested, 'frames asked for after a callback that changed nothing').toBe(asked);
    expect(queue.size).toBe(0);
    expect(document.querySelector('filter')!.getAttribute('x')).toBe(filterBefore);
  });

  /* A dent keeps its px in the content area; after the post narrows, the shading (an overflow-visible layer) of one that no longer fits would
     poke out of the post. The dent is decoration: it goes, and its play and chair are unchanged. */
  test('a dent that no longer fits the narrowed post is dropped, and its chair and play stay', () => {
    pin(PINNED_SEED);
    mount({ plays: [play(1), play(2)] });
    run();
    expect(dents()).toHaveLength(2);
    const centers = dents().map((d) => parseFloat(d.style.left) + parseFloat(d.style.width) / 2);
    /* Each dent has its own size now; the effect's own check uses the largest a dent can be (the base: 60% of the 280 px wrapper, or 160). */
    const radius = Math.min(160, 0.6 * 280) / 2;
    /* The post narrows until the right edge of the box cuts the farther dent's circle, and not the nearer one's. */
    const farther = Math.max(...centers), nearer = Math.min(...centers);
    expect(farther - nearer, 'the seed puts the two dents apart').toBeGreaterThan(2);
    areaWidth = Math.ceil((farther + nearer) / 2 + radius);
    expect(nearer + radius).toBeLessThanOrEqual(areaWidth);
    expect(farther + radius).toBeGreaterThan(areaWidth);
    const chairsBefore = groups().map((g) => g.dataset.play).sort();
    act(() => { for (const r of sized) r.cb(); });
    rest(400);
    const left = dents().map((d) => [parseFloat(d.style.left), parseFloat(d.style.width)] as const);
    expect(left, 'only the dent that no longer fits is gone').toHaveLength(1);
    for (const [x, w] of left) expect(x + w, 'the remaining dent lies inside the post').toBeLessThanOrEqual(areaWidth + 0.01);
    expect(groups().map((g) => g.dataset.play).sort()).toEqual(chairsBefore);
    expect(lastView().state).toBe('Dented by 2 chairs');
    expect(document.querySelector('filter')!.querySelectorAll('feImage')).toHaveLength(1);
  });
});

describe('a dent: its own shape and turn, its creases, and how its shading combines', () => {
  const dentBox = (d: HTMLElement) => {
    const width = parseFloat(d.style.width), height = parseFloat(d.style.height);
    return { x: parseFloat(d.style.left), y: parseFloat(d.style.top), width, height };
  };
  const creasesOf = (play: string) => document.querySelectorAll(`.dw-chair-creases[data-play="${play}"]`).length;
  const shapeOf = (d: HTMLElement) => [d.style.width, d.style.height, d.style.borderRadius, d.style.getPropertyValue('--dark-x'), d.style.getPropertyValue('--dark-y')].join('|');

  test("three plays' dents carry three different shapes, each the shape its play's id gives", () => {
    mount({ plays: [play(1), play(2), play(3)] });
    run();
    const found = dents();
    expect(found).toHaveLength(3);
    const shapes = found.map(shapeOf);
    expect(new Set(shapes).size, `the three shapes: ${shapes.join(' / ')}`).toBe(3);
    for (const d of found) {
      const s = dentShape(d.dataset.play!);
      const w = parseFloat(d.style.width), h = parseFloat(d.style.height);
      expect(w / h).toBeCloseTo(s.rx / s.ry, 3);
      const a = (s.turn * Math.PI) / 180;
      expect(parseFloat(d.style.getPropertyValue('--dark-x'))).toBeCloseTo(50 + 25 * Math.cos(a), 0);
      expect(parseFloat(d.style.getPropertyValue('--dark-y'))).toBeCloseTo(50 + 25 * Math.sin(a), 0);
      expect(d.style.borderRadius).toContain('/');
    }
    /* The light is the shade turned half way round: the same dent's glow sits opposite. */
    const glow = document.querySelector<HTMLElement>('.dw-chair-glow')!;
    expect(glow.dataset.play).toBe(found[0]!.dataset.play);
    expect(parseFloat(glow.style.getPropertyValue('--glow-x')) + parseFloat(found[0]!.style.getPropertyValue('--dark-x'))).toBeGreaterThan(80);
  });

  test("a play's dent has the same shape and turn on every run and for every reader: only where it lands changes", () => {
    const first = mount({ plays: [play(1), play(2), play(3)], reader: { author: false, caster: false } });
    run();
    const shapes = dents().map(shapeOf);
    const places = dentAt();
    first.unmount();
    pin(9);
    mount({ plays: [play(1), play(2), play(3)], reader: { author: true, caster: true } });
    run();
    expect(dents().map(shapeOf), 'the same shapes').toEqual(shapes);
    expect(dentAt(), 'in other places').not.toEqual(places);
  });

  test('a dent that overlaps another draws no creases, and a lone dent draws its two', () => {
    /* A seed in which, of three dents, some overlap and one stands alone, found among the first few: the check is then made on both kinds. */
    let seen = { overlapping: 0, alone: 0 };
    for (let seed = 1; seed <= 40 && (seen.overlapping === 0 || seen.alone === 0); seed++) {
      pin(seed);
      const w = mount({ plays: [play(1), play(2), play(3)] });
      run();
      const boxes = dents().map((d) => ({ play: d.dataset.play!, box: dentBox(d) }));
      for (const a of boxes) {
        const over = boxes.some((b) => b !== a && dentsOverlap(a.box, b.box));
        expect(creasesOf(a.play), `play ${a.play} (overlapping: ${over}) in seed ${seed}`).toBe(over ? 0 : 1);
        if (over) seen.overlapping++; else seen.alone++;
      }
      w.unmount();
    }
    expect(seen.overlapping, 'a seed with overlapping dents was found').toBeGreaterThan(0);
    expect(seen.alone, 'a seed with a lone dent was found').toBeGreaterThan(0);
  });

  test('one dent alone keeps its creases, turned by its own angle', () => {
    mount();
    run();
    const c = document.querySelector<HTMLElement>('.dw-chair-creases')!;
    expect(c).not.toBeNull();
    expect(c.style.transform).toBe(`rotate(${dentShape('sc1').turn.toFixed(1)}deg)`);
  });

  test('the shading is three layers with their own blends: shade multiplied (dents darkened against each other), light screened (lightened), creases plain, all hidden in forced colors', () => {
    const blend = (selector: string) => /mix-blend-mode:\s*([a-z-]+)/u.exec(ruleOf(selector))?.[1];
    expect(blend('.dw-chair-dents')).toBe('multiply');
    expect(blend('.dw-chair-dent')).toBe('darken');
    expect(blend('.dw-chair-glows')).toBe('screen');
    expect(blend('.dw-chair-glow')).toBe('lighten');
    expect(blend('.dw-chair-creases')).toBeUndefined();
    /* The shade's gray at its darkest is one dent's worth (128, as black at 50% was); nothing in it is darker, so overlap cannot be. */
    expect(ruleOf('.dw-chair-dent')).toMatch(/rgb\(128, 128, 128\) 0%/u);
    expect(ruleOf('.dw-chair-dent')).not.toMatch(/rgba\(/u);
    expect(sheet).toMatch(/forced-colors: active\)\s*\{\s*\.dw-chair-shading,\s*\.dw-chair-layer\s*\{\s*display: none/u);
    mount();
    run();
    for (const cls of ['dw-chair-dents', 'dw-chair-glows', 'dw-chair-crease-layer']) {
      const layer = document.querySelector<HTMLElement>(`.${cls}`)!;
      expect(layer, cls).not.toBeNull();
      expect(layer).toHaveClass('dw-chair-shading');
      expect(layer).toHaveAttribute('data-kb-effect-ink');
      expect(layer).toHaveAttribute('aria-hidden', 'true');
      expect(layer.style.width).toBe('300px');
    }
  });

  test('on a post of little text the dents are spread beyond the line and lie inside the content area', () => {
    textRects = [{ left: 10, top: 9, width: 80, height: 18 }];
    const around: number[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      pin(seed);
      const w = mount({ plays: [play(1), play(2), play(3)] });
      run();
      for (const d of dents()) {
        const b = dentBox(d);
        expect(b.x, `seed ${seed}: dent left`).toBeGreaterThanOrEqual(-0.5);
        expect(b.y).toBeGreaterThanOrEqual(-0.5);
        expect(b.x + b.width).toBeLessThanOrEqual(300.5);
        expect(b.y + b.height).toBeLessThanOrEqual(200.5);
        /* The dent's center is within a dent's width of the line's sides and a dent's height below it (it may land wholly beside the line). */
        const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
        expect(cx >= 10 - b.width - 0.5 && cx <= 90 + b.width + 0.5 && cy >= 9 - b.height / 2 - 0.5 && cy <= 27 + b.height + 0.5, `seed ${seed}: dent ${JSON.stringify(b)} is within reach of the line`).toBe(true);
        around.push(b.x + b.width / 2);
      }
      w.unmount();
    }
    /* Spread: the centers are not all within the line's own x range (10 to 90), as aiming only at the text would have it. */
    expect(around.filter((x) => x > 90).length, 'some dents land to the right of the one short line').toBeGreaterThan(around.length / 4);
  });
});

describe('when a run starts and ends', () => {
  test('a run starts only after the post\'s middle has been in view for 300 ms, and not if it leaves first', () => {
    mount();
    see(true);
    aim(true);
    act(() => { vi.advanceTimersByTime(299); });
    drain();
    expect(groups()).toHaveLength(0);
    aim(false);
    act(() => { vi.advanceTimersByTime(100); });
    expect(groups()).toHaveLength(0);
    aim(true);
    act(() => { vi.advanceTimersByTime(299); });
    expect(groups()).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(1); });
    expect(groups()).toHaveLength(1);
  });

  test('met is said once, when the first run starts', () => {
    mount();
    see(true);
    expect(made.met).not.toHaveBeenCalled();
    arm();
    expect(made.met).toHaveBeenCalledTimes(1);
    settled();
    see(false); aim(false); see(true); arm(); settled();
    expect(made.met).toHaveBeenCalledTimes(1);
  });

  test('leaving the view clears the run, and coming back runs again with a different target', () => {
    mount();
    run();
    const first = dentAt();
    expect(first).toHaveLength(1);
    see(false);
    expect(groups()).toHaveLength(0);
    expect(dents()).toHaveLength(0);
    expect(queue.size).toBe(0);
    aim(false);
    aim(true);
    act(() => { vi.advanceTimersByTime(300); });
    settled();
    expect(dents()).toHaveLength(1);
    expect(dentAt()).not.toEqual(first);
  });

  test('a post out of view holds one arming observer and nothing else: no size observer, no frame', () => {
    mount({ plays: [play(1), play(2)] });
    run();
    expect(sized.some((r) => r.watching.size > 0)).toBe(true);
    see(false);
    expect(sized.every((r) => r.watching.size === 0)).toBe(true);
    expect(queue.size).toBe(0);
    expect(watched()).toBe(1);
    expect(watching.filter((o) => o.seen.size > 0)[0]!.opts?.rootMargin).toBe('-20% 0px -20% 0px');
  });

  /* The second chair's throw waits 350 ms on a timer. Its callback ignores a stopped run, so only the timer count (and not what the page then
     does) tells whether the timer was cleared. */
  test('unmounting stops everything: observers, frames and timers of the run, and nothing is requested or heard afterward', () => {
    const w = mount({ plays: [play(1), play(2), play(3)] });
    see(true); arm();
    frame();
    expect(vi.getTimerCount(), 'the staggered throws are waiting on timers').toBeGreaterThan(0);
    w.unmount();
    expect(watched()).toBe(0);
    expect(sized.every((r) => r.watching.size === 0)).toBe(true);
    expect(queue.size).toBe(0);
    expect(vi.getTimerCount(), 'timers left after unmount').toBe(0);
    const asked = requested;
    hub.sound.play.mockClear();
    act(() => { vi.advanceTimersByTime(5000); drain(); });
    expect(requested, 'frames requested after unmount').toBe(asked);
    expect(hub.sound.play).not.toHaveBeenCalled();
    expect(document.querySelector('.dw-chair')).toBeNull();
  });

  test('under StrictMode (effects run, are cleaned up and run again) there is still one run: one chair, one hit sound, one met', () => {
    pin(PINNED_SEED);
    renderInWorld(<StrictMode><Host o={{ plays: [play(1), play(2), play(3)] }} /></StrictMode>);
    run();
    expect(groups()).toHaveLength(3);
    expect(dents()).toHaveLength(3);
    const keys = (hub.sound.play.mock.calls as unknown as [string][]).map((c) => c[0]);
    expect(keys.filter((k) => k === 'steel-chair.hit'), 'one hit sound per chair').toHaveLength(3);
    expect(keys.filter((k) => k.startsWith('steel-chair.settle-')), 'one settle sound per chair').toHaveLength(3);
    expect(made.met).toHaveBeenCalledTimes(1);
    expect(watched(), 'one arming and one leaving observer, not a pair left by the first effect').toBe(2);
  });

  /* body.ts's step costs from 0.02 ms to 0.12 ms and the caller must cap the steps it runs in a frame: a background tab coming back must
     not owe hundreds of them (which makes the next frame slower still). */
  test('a frame two seconds after the last runs at most 4 steps, and drops the rest', () => {
    mount({ plays: [play(1), play(2), play(3)] });
    see(true); arm();
    for (let i = 0; i < 5; i++) frame();
    expect(queue.size).toBeGreaterThan(0);
    hub.steps = 0;
    act(() => { clock += 2000; drain(); });
    expect(hub.steps).toBeGreaterThan(0);
    expect(hub.steps).toBeLessThanOrEqual(4);
    /* A normal frame still runs its steps: two for 16 ms. */
    hub.steps = 0;
    frame(); frame(); frame();
    expect(hub.steps).toBeGreaterThanOrEqual(5);
  });

  test('throws are 350 ms apart', () => {
    mount({ plays: [play(1), play(2), play(3)] });
    see(true); arm();
    expect(groups()).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(349); });
    expect(groups()).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(1); });
    expect(groups()).toHaveLength(2);
    act(() => { vi.advanceTimersByTime(350); });
    expect(groups()).toHaveLength(3);
  });
});

describe('sound', () => {
  const heard = () => hub.sound.play.mock.calls as unknown as [string, { group?: string }][];

  test('on the first run a hit and one settle sound play once per chair, in the group; a replay by scroll or by Throw again is silent', () => {
    /* A chair that lands on another never touches the floor, so it has no floor sound; the seed is pinned to a throw in which all three reach it (seed 6, for one, lands a chair on another). */
    pin(2);
    mount({ plays: [play(1), play(2), play(3)] });
    run();
    const keys = heard().map((c) => c[0]);
    expect(keys.filter((k) => k === 'steel-chair.hit')).toHaveLength(3);
    const settles = keys.filter((k) => k.startsWith('steel-chair.settle-'));
    expect(settles).toHaveLength(3);
    for (const k of settles) expect(k).toMatch(/^steel-chair\.settle-[1-4]$/u);
    expect(heard().every((c) => c[1].group === 'steel-chair')).toBe(true);
    hub.sound.play.mockClear();
    see(false); aim(false); see(true); arm(); settled();
    expect(groups()).toHaveLength(3);
    expect(hub.sound.play).not.toHaveBeenCalled();
    const again = lastView().controls.find((c) => c.kind === 'press')! as { run: () => void };
    act(() => { again.run(); });
    settled();
    expect(groups()).toHaveLength(3);
    expect(hub.sound.play).not.toHaveBeenCalled();
  });
});

describe('sound and met across the effect coming and going inside one mount', () => {
  test('after the last play ends and a new one lands, the new run is silent and the card is not met again', () => {
    mount({ plays: [play(1)] });
    run();
    expect(hub.sound.play).toHaveBeenCalled();
    expect(made.met).toHaveBeenCalledTimes(1);
    /* The play goes: the chairs component unmounts, the words are bare. A new play lands: it mounts again, inside the same mount of the effect. */
    act(() => { hub.setPlays([]); });
    expect(host()).toBeNull();
    hub.sound.play.mockClear();
    act(() => { hub.setPlays([play(2)]); });
    see(true); arm(); settled();
    expect(groups()).toHaveLength(1);
    expect(hub.sound.play).not.toHaveBeenCalled();
    expect(made.met).toHaveBeenCalledTimes(1);
  });
});

describe('reduced motion', () => {
  test('no frame is asked for, no flight and no shake: the dents and resting chairs are drawn at once, and no sound plays', () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    mount({ plays: [play(1), play(2)] });
    const timers = vi.getTimerCount();
    see(true); aim(true);
    /* No timer is advanced: reduced motion has no wait, so the picture is there the moment the post's middle is in view. */
    expect(vi.getTimerCount(), 'no arming wait was started').toBe(timers);
    expect(requested).toBe(0);
    expect(groups()).toHaveLength(2);
    expect(dents()).toHaveLength(2);
    expect(groups().every((g) => g.hasAttribute('data-rest'))).toBe(true);
    for (const g of groups()) { expectOnFloor(g, 200); for (const c of corners(g)) { expect(c.x).toBeGreaterThan(-SLACK); expect(c.x).toBeLessThan(300 + SLACK); } }
    expect(wordsEl()).not.toHaveAttribute('data-shake');
    expect(document.querySelector('[data-shake]')).toBeNull();
    expect(hub.sound.play).not.toHaveBeenCalled();
    expect(requested).toBe(0);
  });

  test('it still differs from run to run', () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    mount();
    see(true); aim(true); act(() => { vi.advanceTimersByTime(300); });
    const first = dentAt();
    see(false); aim(false); see(true); aim(true); act(() => { vi.advanceTimersByTime(300); });
    expect(dentAt()).toHaveLength(1);
    expect(dentAt()).not.toEqual(first);
  });
});

describe('a moment (still)', () => {
  const picture = (plays: CardPlay[]) => {
    const w = mount({ plays, still: true });
    const html = (document.querySelector('.dw-chair') as HTMLElement).outerHTML.replace(/id="[^"]*"/gu, 'id=""').replace(/url\(&quot;#[^)]*\)/gu, 'url()');
    const out = { html, groups: groups().length, dents: dents().length };
    w.unmount();
    return out;
  };

  test('it is the same picture for the same plays twice over, drawn at once and at rest', () => {
    const plays = [play(1), play(2), play(3)];
    const one = picture(plays);
    const two = picture(plays);
    expect(one.groups).toBe(3);
    expect(one.dents).toBe(3);
    expect(two.html).toBe(one.html);
    expect(picture([play(7), play(8)]).html).not.toBe(one.html);
  });

  test('it binds no observer, no frame, no sound and nothing is inert, and the Lens gets the state with no controls', () => {
    mount({ plays: [play(1), play(2)], still: true });
    expect(watching).toHaveLength(0);
    expect(sized).toHaveLength(0);
    expect(requested).toBe(0);
    expect(hub.sound.play).not.toHaveBeenCalled();
    expect(made.met).not.toHaveBeenCalled();
    expect(document.querySelector('[inert]')).toBeNull();
    expect(document.querySelector('.dw-chair-words')).not.toHaveAttribute('data-shake');
    expect(groups().every((g) => g.hasAttribute('data-rest'))).toBe(true);
    expect(lastView()).toMatchObject({ state: 'Dented by 2 chairs', controls: [] });
  });

  test('a moment draws its plays as they were, ended ones included', () => {
    mount({ plays: [play(1, '2000-01-01T00:00:00Z')], still: true });
    expect(groups()).toHaveLength(1);
  });
});

describe('the filter', () => {
  test('where it is trusted the words carry the filter, once there is a dent, and the filter has the plan\'s parts', () => {
    mount({ plays: [play(1), play(2)] });
    expect(wordsEl().style.filter).toBe('');
    run();
    const filter = document.querySelector('filter')!;
    expect(filter).not.toBeNull();
    expect(wordsEl().style.filter).toContain(`#${filter.id}`);
    expect(filter.getAttribute('color-interpolation-filters')).toBe('sRGB');
    expect(filter.getAttribute('primitiveUnits')).toBe('userSpaceOnUse');
    const map = filter.querySelector('feDisplacementMap')!;
    expect(map.getAttribute('xChannelSelector')).toBe('R');
    expect(map.getAttribute('yChannelSelector')).toBe('G');
    expect(Number(map.getAttribute('scale'))).toBe(DENT_SCALE);
    expect(filter.querySelector('feFlood')!.getAttribute('flood-color')).toBe('rgb(128,128,128)');
    expect(filter.querySelectorAll('feImage')).toHaveLength(2);
    expect(document.querySelector('svg')!).toHaveAttribute('aria-hidden', 'true');
  });

  /* Without a region the filter gets the default (-10% and 120% of the wrapper's box), and a displacement of up to DENT_SCALE / 2 px moves the
     glyphs of a one-line post outside it, clipping them above and below. The region is the wrapper's box plus DENT_SCALE on every side, in the
     wrapper's own px (the same units the primitives use). */
  test("the filter's region is the words wrapper's box plus DENT_SCALE on every side, in user space, so no displaced glyph is clipped", () => {
    mount({ plays: [play(1)] });
    run();
    const filter = document.querySelector('filter')!;
    expect(filter.getAttribute('filterUnits')).toBe('userSpaceOnUse');
    expect(Number(filter.getAttribute('x'))).toBe(-DENT_SCALE);
    expect(Number(filter.getAttribute('y'))).toBe(-DENT_SCALE);
    /* The wrapper is 280 wide and size.h - 16 - ROOM_HEIGHT tall in the stub. */
    expect(Number(filter.getAttribute('width'))).toBe(280 + 2 * DENT_SCALE);
    expect(Number(filter.getAttribute('height'))).toBe(200 - 16 - ROOM_HEIGHT + 2 * DENT_SCALE);
    /* The region follows the wrapper when it is resized. */
    size = { h: 260 };
    act(() => { for (const r of sized) r.cb(); });
    expect(Number(filter.getAttribute('height'))).toBe(260 - 16 - ROOM_HEIGHT + 2 * DENT_SCALE);
  });

  /* Each dent's map is an opaque square, neutral outside its circle; merged with source-over a later square overwrote the part of an earlier ring
     it overlapped, with a hard straight edge. The offsets are added instead: 0.5 + sum of (d - 0.5), one arithmetic composite per dent. */
  test('overlapping dents add their offsets: one arithmetic composite per dent, chained from the neutral flood, and no merge', () => {
    mount({ plays: [play(1), play(2), play(3)] });
    run();
    const filter = document.querySelector('filter')!;
    expect(filter.querySelector('feMerge')).toBeNull();
    const adds = [...filter.querySelectorAll('feComposite[operator="arithmetic"]')];
    expect(adds).toHaveLength(3);
    for (const a of adds) expect(['k1', 'k2', 'k3', 'k4'].map((k) => Number(a.getAttribute(k)))).toEqual([0, 1, 1, -0.5]);
    expect(adds[0]!.getAttribute('in')).toBe('neutral');
    expect(adds[1]!.getAttribute('in')).toBe(adds[0]!.getAttribute('result'));
    expect(adds[2]!.getAttribute('in')).toBe(adds[1]!.getAttribute('result'));
    expect(filter.querySelector('feDisplacementMap')!.getAttribute('in2')).toBe(adds[2]!.getAttribute('result'));
    /* A dent's own square is laid over neutral first, so that it adds nothing (zero offset) outside its circle. */
    const overs = [...filter.querySelectorAll('feComposite[operator="over"]')];
    expect(overs).toHaveLength(3);
    for (const o of overs) expect(o.getAttribute('in2')).toBe('neutral');
    expect(adds.map((a) => a.getAttribute('in2'))).toEqual(overs.map((o) => o.getAttribute('result')));
  });

  test('a dent grows from nothing to full strength over 90 ms', () => {
    mount();
    see(true); arm();
    let first = 0;
    for (let i = 0; i < 400 && !first; i++) { frame(); if (dents().length) first = i; }
    const slope = () => Number(document.querySelector('feComponentTransfer feFuncR')!.getAttribute('slope'));
    expect(slope()).toBeLessThan(1);
    for (let i = 0; i < 8; i++) frame();
    expect(slope()).toBe(1);
  });

  test('where it is not trusted the words carry no filter and the shading alone is drawn', () => {
    hub.trusted = false;
    mount();
    run();
    expect(wordsEl().style.filter).toBe('');
    expect(wordsEl().getAttribute('style') ?? '').not.toContain('filter');
    expect(document.querySelector('filter')).toBeNull();
    expect(dents()).toHaveLength(1);
  });
});

describe('what it tells the Lens', () => {
  test.each([[1, 'Dented by a chair'], [2, 'Dented by 2 chairs'], [3, 'Dented by 3 chairs']])('with %i live plays: the state words, plain and short', (n, state) => {
    mount({ plays: Array.from({ length: n }, (_, i) => play(i + 1, `2026-11-0${i + 1}T12:00:00Z`)) });
    const view = lastView();
    expect(view.state).toBe(state);
    expect(view.state.split(/\s+/u).length).toBeLessThanOrEqual(6);
    expect(view).toMatchObject({ progress: null, yours: false, notes: {} });
    expect(viewProblems(view, { holds: false, covers: false })).toEqual([]);
    if (n === 1) expect(view.ends).toMatch(/^Ends /u);
    else expect(view.ends).toMatch(/^The first chair is gone .*; each lasts 3 days\.$/u);
    expect(view.controls.map((c) => [c.kind, c.label])).toEqual([['press', 'Throw again'], ['toggle', 'Game sounds']]);
    expect(view.controls[1]).toMatchObject({ on: false, set: hub.set });
  });

  test('the soonest end is the first chair\'s', () => {
    mount({ plays: [play(1, '2026-11-03T12:00:00Z'), play(2, '2026-11-01T12:00:00Z')] });
    expect(lastView().ends).toContain('The first chair is gone');
    mount({ plays: [play(3, '2026-11-01T12:00:00Z')] });
    expect(lastView().ends).toMatch(/^Ends /u);
  });

  test('Throw again clears the run and starts another, with a different target', () => {
    mount();
    run();
    const first = dentAt();
    const again = lastView().controls[0] as { run: () => void };
    act(() => { again.run(); });
    settled();
    expect(groups()).toHaveLength(1);
    expect(dentAt()).not.toEqual(first);
  });

  test('it clears its view when it goes', () => {
    const w = mount();
    w.unmount();
    expect(made.show).toHaveBeenLastCalledWith(null);
  });
});

describe('nobody is special', () => {
  test('it reads neither who wrote the post nor who played the card, and saves and releases nothing', () => {
    const reader = new Proxy({} as EffectProps['reader'], { get() { throw new Error('read the reader'); } });
    mount({ reader });
    run();
    expect(groups()).toHaveLength(1);
    expect(made.save).not.toHaveBeenCalled();
    expect(made.release).not.toHaveBeenCalled();
  });

  test('props that differ only in reader render the same', () => {
    const html = (reader: EffectProps['reader']) => {
      const w = mount({ plays: [play(1), play(2)], still: true, reader });
      const out = (document.querySelector('.dw-chair') as HTMLElement).outerHTML.replace(/id="[^"]*"/gu, 'id=""').replace(/url\(&quot;#[^)]*\)/gu, 'url()');
      w.unmount();
      return out;
    };
    const a = html({ author: false, caster: false });
    expect(html({ author: true, caster: false })).toBe(a);
    expect(html({ author: false, caster: true })).toBe(a);
  });
});
