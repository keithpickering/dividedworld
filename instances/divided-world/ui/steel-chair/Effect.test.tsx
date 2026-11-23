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
import { bodies, cornersOf, DEPTH, HALF } from './body.ts';
import { depthOf, drawn, FLOOR_DEPTH, GIVE, INSET, K, ROOM_HEIGHT, Z_FRONT } from './chair.ts';
import { DENT_SCALE, FULL_DENT } from './dent.ts';
import { LATE_MS, SteelChairEffect, VOICES } from './Effect.tsx';

const hub = vi.hoisted(() => ({
  trusted: true,
  gameOn: false,
  set: undefined as unknown as (on: boolean) => void,
  sound: { play: undefined as unknown as ReturnType<typeof import('vitest').vi.fn>, loop: undefined as unknown, caption: undefined as unknown },
  setPlays: (() => {}) as (plays: CardPlay[]) => void,
  /* What the mocked body.ts saw: the steps run, and the world the last run built. */
  steps: 0,
  world: null as import('./body.ts').World | null,
  /** Puts every body to sleep after each step (a world that is quiet whatever was thrown), for the test that a due throw keeps the loop going. */
  sleepAll: false,
  /** What the mocked `dentImages` calls (a spy made in `beforeEach`, so the effect's arguments can be read): fixed addresses from the play's id. */
  images: undefined as unknown as import('vitest').Mock<(play: string, ...rest: unknown[]) => { bend: string; shade: string; light: string }>,
}));
vi.mock('./body.ts', async (original) => {
  const actual = await original<typeof import('./body.ts')>();
  return {
    ...actual,
    step: (...a: Parameters<typeof actual.step>) => {
      hub.steps++;
      const events = actual.step(...a);
      if (hub.sleepAll) for (const b of a[0].list) b.asleep = true;
      return events;
    },
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
  return { ...actual, filterTrusted: () => hub.trusted, dentImages: (play: string, ...rest: unknown[]) => hub.images(play, ...rest),
  };
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
/** Frames until the page asks for none and at least `least` ms have passed (the throws are 42 steps, 350 ms, apart), at most `most` frames. */
const rest = (least = 1200, most = 1500) => { const from = clock; for (let i = 0; i < most && (queue.size > 0 || clock - from < least); i++) frame(); };
/** One frame of `ms` of the wall clock: the page's frames come as the machine gives them, 16 ms on a fast one and more on a slow one. */
const frameOf = (ms: number) => act(() => { vi.advanceTimersByTime(ms); clock += ms; const run = [...queue.values()]; queue.clear(); for (const cb of run) cb(clock); });
/** Frames of `ms` until the page asks for none. */
const restAt = (ms: number, most = 6000) => { for (let i = 0; i < most && queue.size > 0; i++) frameOf(ms); };
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
/** The ORIGIN box's content area (`.kb-origin-area`), which the stub gives a size of its own, not the post's. */
const originArea = { w: 260, h: 150 };
/** The boxes a `Range` over a text node reports (jsdom has no `getClientRects`), in the window's px, or none. A range over an element reports that element's border box too, as a browser does (the wrapper's, 280 wide), which is not where the text is. */
let textRects: { left: number; top: number; width: number; height: number }[] | null = null;
/** The post comes into the middle of the view and stays for the arming wait: a run starts. */
const arm = () => { aim(true); act(() => { vi.advanceTimersByTime(300); }); };
/** The post's middle comes into view; a run begins and the world goes on to rest. */
const run = () => { see(true); arm(); settled(); };

interface Options { plays?: CardPlay[]; moment?: EffectProps['moment']; still?: boolean; place?: 'thread' | 'origin'; reader?: EffectProps['reader']; wrapped?: boolean | 'area' | 'beside' }
const made = { show: vi.fn<(view: CardView | null) => void>(), met: vi.fn(), save: vi.fn(), release: vi.fn() };
function Host({ o }: { o: Options }) {
  const [plays, setPlays] = useState(o.plays ?? [play(1)]);
  hub.setPlays = setPlays;
  const props: EffectProps = {
    post, plays, states: {}, released: new Set(), written: new Map(), reader: o.reader ?? { author: false, caster: false }, place: o.place ?? 'thread', reach: 'post', still: o.still ?? false, moment: o.moment ?? null,
    show: made.show, met: made.met, ink: NO_INK, holdScreen: () => {}, marks: null, save: made.save, release: made.release, nameOf: () => 'Spritey', give: async () => ({ ok: false, error: 'no' }), moreGifts: async () => {}, wallet: null,
    children: <div data-kb-words-box><p data-kb-words>The words of the post.</p></div>,
  };
  const inner = <SteelChairEffect {...props} />;
  if (o.wrapped === false) return inner;
  /* 'area': the ORIGIN box's place, a marked area inside the opening post's marked `.kb-act-main`. */
  /* 'beside': a post's body that holds the effect and, beside it, an ORIGIN box's own content area. */
  if (o.wrapped === 'beside') return <div className="kb-act-main" data-kb-content-area>{inner}<div className="kb-origin-area" data-kb-content-area /></div>;
  if (o.wrapped === 'area') return <div className="kb-act-main" data-kb-content-area><div className="kb-origin-area" data-kb-content-area>{inner}</div></div>;
  return <div className="kb-act-main" data-kb-content-area>{inner}</div>;
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
const wordsEl = () => document.querySelector<HTMLElement>('[data-kb-words-box]')!;
/** The content area the effect found (the post's body), where the shake and the bend are set. */
const areaEl = () => document.querySelector<HTMLElement>('.kb-act-main')!;
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
/** A seed for which sc1 and sc3 lie on the floor and not on sc2. It was 2 until the dent was sized and aimed in the height it may land in (Task 2) moved every throw: under that aim seed 2 lands sc3 on sc2, so sc3 falls when sc2 goes, and seed 4 is one where both lie on the floor. */
const PINNED_SEED = 4;
/** A seed that puts sc1 and sc3's dents about 35 px apart (overlapping) and sc2's more than 136 px from both (seed 23, found by hand). */
const SEED_TWO_AND_ONE = 23;
/** A seed that lays the three dents on the one-line text over one another (found by hand). */
const OVERLAPPING_SEED = 1;
let seeds = 0;
/** The seed the nth unpinned run gets. */
const seedAt = (n: number) => Math.imul(n, 2654435761) >>> 0;
let pinned: number | null = null;
const pin = (seed: number | null) => { pinned = seed; };

beforeEach(() => {
  vi.useFakeTimers();
  queue = new Map(); nextFrame = 1; requested = 0; clock = 0; watching.length = 0; sized.length = 0; size = { h: 200 }; areaWidth = 300; shaking = false; roomAdds = false; textRects = null; seeds = 0; pinned = null; hub.steps = 0; hub.world = null; hub.sleepAll = false;
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
    /* The hit's shake is a transform on the content area: it moves the area's rect and every rect inside it, by the same 4 px and 1 px. */
    const [dx, dy] = shaking ? [4, -1] : [0, 0];
    if (this.classList.contains('kb-origin-area')) return rect(0, 0, originArea.w, originArea.h);
    if (this.classList.contains('kb-act-main')) return rect(dx, dy, areaWidth, areaHeight(this));
    if (this.classList.contains('dw-chair')) return rect(10 + dx, 8 + dy, 280, size.h - 16);
    if (this.hasAttribute('data-kb-words-box')) return rect(10 + dx, 8 + dy, 280, size.h - 16 - ROOM_HEIGHT);
    return rect(0, 0, 0, 0);
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('kb-origin-area') ? originArea.w : this.classList.contains('kb-act-main') ? areaWidth : 0; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('kb-origin-area') ? originArea.h : this.classList.contains('kb-act-main') ? areaHeight(this) : 0; });
  document.documentElement.setAttribute('data-kb-motion', 'full');
  hub.trusted = true;
  hub.images = vi.fn((play: string) => ({
    bend: `data:image/png;base64,B${play}`, shade: `data:image/png;base64,S${play}`, light: `data:image/png;base64,L${play}`,
  }));
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
     effect's host in `.kb-act-main`, so a strip under the words is nowhere near the floor. The room is the content area's own last ROOM_HEIGHT px,
     which the effect marks (`data-dw-chair-room`) on the body it found; one rule serves a thread post's body and the ORIGIN box's area alike. */
  test('1. the room is the marked body\'s last ROOM_HEIGHT px, by a rule that reads no :has() and sits in no @supports :has block', () => {
    expect(ruleOf('[data-dw-chair-room]::after'), 'the marked body has an ::after').toMatch(/content:\s*''/u);
    expect(ruleOf('[data-dw-chair-room]::after')).toMatch(/display:\s*block/u);
    expect(ruleOf('[data-dw-chair-room]::after'), 'the ::after is ROOM_HEIGHT px tall').toMatch(new RegExp(`height:\\s*${ROOM_HEIGHT}px`, 'u'));
    expect(sheet, 'no rule reads :has(').not.toContain(':has(');
    expect(sheet, 'no @supports block guards :has').not.toContain('@supports selector');
    expect(ruleOf('.dw-chair[data-kb-bleed] .dw-chair-room'), 'the strip in the host is hidden where a body was found').toMatch(/display:\s*none/u);
    /* The strip itself is a plain rule: where there is no body it stays, ROOM_HEIGHT px, in the host. */
    expect(ruleOf('.dw-chair-room')).toMatch(new RegExp(`height:\\s*${ROOM_HEIGHT}px`, 'u'));
  });

  test('2. in a thread the body carries data-dw-chair-room and the host data-kb-bleed, and both come off when the play ends', () => {
    mount();
    run();
    const body = document.querySelector<HTMLElement>('.kb-act-main')!;
    const h = host()!;
    expect(body, "the body found carries the room's mark").toHaveAttribute('data-dw-chair-room');
    expect(h, 'the host is marked as bleeding into a body').toHaveAttribute('data-kb-bleed');
    /* The play ends and the post stays: the body is still in the page, so what it carries is what a reader sees. */
    act(() => { hub.setPlays([]); });
    expect(body.isConnected).toBe(true);
    expect(body, "the room's mark is gone with the effect").not.toHaveAttribute('data-dw-chair-room');
    expect(h, "the host's bleed mark is gone too").not.toHaveAttribute('data-kb-bleed');
  });

  test('2a. chairs live and never run (never in view), then the play ends: the body keeps no mark', () => {
    mount();
    const body = document.querySelector<HTMLElement>('.kb-act-main')!;
    act(() => { hub.setPlays([]); });
    expect(body.isConnected).toBe(true);
    expect(body, 'no empty room is left on the post').not.toHaveAttribute('data-dw-chair-room');
  });

  test('2b. run, then the post leaves the view (the run is cleared), then the play ends: the body keeps no mark', () => {
    mount();
    run();
    const body = document.querySelector<HTMLElement>('.kb-act-main')!;
    see(false);
    act(() => { hub.setPlays([]); });
    expect(body.isConnected).toBe(true);
    expect(body, 'no empty room is left on the post').not.toHaveAttribute('data-dw-chair-room');
  });

  test('2c. the body is marked from the moment the effect mounts, before any run', () => {
    mount();
    expect(document.querySelector('.kb-act-main'), 'the room is there before a run, so the post does not grow when one starts').toHaveAttribute('data-dw-chair-room');
    expect(host()).toHaveAttribute('data-kb-bleed');
  });

  test('2d. the effect moved under another body before its first measure: the old body is unmarked and the new one marked', () => {
    mount();
    const first = document.querySelector<HTMLElement>('.kb-act-main')!;
    expect(first).toHaveAttribute('data-dw-chair-room');
    const other = document.createElement('div');
    other.className = 'kb-act-main';
    other.setAttribute('data-kb-content-area', '');
    document.body.appendChild(other);
    const h = host()!;
    first.removeChild(h);
    other.appendChild(h);
    try {
      run();
      expect(other, 'the new body has the mark').toHaveAttribute('data-dw-chair-room');
      expect(first, 'the old one lost it').not.toHaveAttribute('data-dw-chair-room');
      expect(h).toHaveAttribute('data-kb-bleed');
    } finally {
      other.removeChild(h);
      first.appendChild(h);
      other.remove();
    }
  });

  test('4. with no marked ancestor the host\'s box is the world and the room stays in the host, after the words: ROOM_HEIGHT px', () => {
    mount({ place: 'origin', wrapped: false });
    const room = document.querySelector('.dw-chair-room')!;
    expect(ruleOf('.dw-chair-room')).toMatch(new RegExp(`height:\\s*${ROOM_HEIGHT}px`, 'u'));
    expect(wordsEl().nextElementSibling).toBe(room);
    expect(host()).toContainElement(room as HTMLElement);
    run();
    expect(host(), 'no body, so nothing bleeds').not.toHaveAttribute('data-kb-bleed');
    expect(document.querySelector('[data-dw-chair-room]'), 'no body, so nothing is marked').toBeNull();
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

  test("3. at place origin the world is the marked area's, the room is the area's and not the opening post's body's", () => {
    mount({ place: 'origin', wrapped: 'area' });
    run();
    const area = document.querySelector<HTMLElement>('.kb-origin-area')!;
    const outer = document.querySelector<HTMLElement>('.kb-act-main')!;
    const layer = document.querySelector<HTMLElement>('.dw-chair-layer')!;
    expect([layer.style.left, layer.style.top, layer.style.width, layer.style.height], 'the layer is placed over the area').toEqual(['-10px', '-8px', '260px', '150px']);
    expect(area, "the area carries the room's mark").toHaveAttribute('data-dw-chair-room');
    expect(outer, 'the outer body does not').not.toHaveAttribute('data-dw-chair-room');
    expect(host()).toHaveAttribute('data-kb-bleed');
    expect(hub.world!.width, "the world is the area's width less the inset at both sides").toBeCloseTo(originArea.w - 2 * INSET, 6);
    expect(hub.world!.height, 'and its height less the inset at the floor').toBeCloseTo(originArea.h - INSET, 6);
    expect(groups()).toHaveLength(1);
    expectOnFloor(groups()[0]!, originArea.h);
  });

  test('5. a body that changes: the mark moves with it', () => {
    mount();
    run();
    const first = document.querySelector<HTMLElement>('.kb-act-main')!;
    expect(first).toHaveAttribute('data-dw-chair-room');
    const other = document.createElement('div');
    other.className = 'kb-act-main';
    other.setAttribute('data-kb-content-area', '');
    document.body.appendChild(other);
    const h = host()!;
    first.removeChild(h);
    other.appendChild(h);
    try {
      act(() => { for (const r of sized) r.cb(); });
      expect(other, 'the new body has the mark').toHaveAttribute('data-dw-chair-room');
      expect(first, 'the old one lost it').not.toHaveAttribute('data-dw-chair-room');
      expect(h).toHaveAttribute('data-kb-bleed');
    } finally {
      other.removeChild(h);
      first.appendChild(h);
      other.remove();
    }
  });

  test("outside a thread (no marked ancestor) the effect's own box is the world", () => {
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
     is shorter than a dent it is grown (dent.ts `hitZone`, and its own tests): the dent's center may be a dent's width beside the text, or
     below it, so the dent may land off the text. */
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

  test('a hit puts a dent at its point and shakes the post content area once', () => {
    mount();
    see(true); arm();
    expect(areaEl()).not.toHaveAttribute('data-dw-chair-shake');
    settled();
    expect(areaEl(), "the shake is on the content area, not on the words").toHaveAttribute('data-dw-chair-shake');
    expect(wordsEl()).not.toHaveAttribute('data-dw-chair-shake');
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
  test("a size callback mid-shake measures the words box's place in the post, not the shake: nothing moves and no frame is asked for", () => {
    mount();
    run();
    expect(areaEl()).toHaveAttribute('data-dw-chair-shake');
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
    /* Each dent has its own size now; the effect's own check uses the largest a dent can be (the base: 60% of the 280 px wrapper, 160, or the
       zone a dent may land in: the 200 px area less the room). */
    const radius = Math.min(160, 0.6 * 280, 200 - ROOM_HEIGHT) / 2;
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

describe('a dent: its own images, and how its shading combines', () => {
  const dentBox = (d: HTMLElement) => {
    const width = parseFloat(d.style.width), height = parseFloat(d.style.height);
    return { x: parseFloat(d.style.left), y: parseFloat(d.style.top), width, height };
  };
  const urlOf = (el: HTMLElement, name: string) => el.style.getPropertyValue(name);
  const bends = () => [...document.querySelectorAll('filter[id$="-words"] feImage')].map((e) => e.getAttribute('href'));

  test("three plays' dents each carry their own play's shade and light, and each feImage its own bend", () => {
    mount({ plays: [play(1), play(2), play(3)] });
    run();
    const found = dents();
    expect(found).toHaveLength(3);
    const glows = [...document.querySelectorAll<HTMLElement>('.dw-chair-glow')];
    expect(glows).toHaveLength(3);
    for (const d of found) expect(urlOf(d, '--dw-dent-img'), d.dataset.play).toBe(`url("data:image/png;base64,S${d.dataset.play}")`);
    for (const g of glows) expect(urlOf(g, '--dw-glow-img'), g.dataset.play).toBe(`url("data:image/png;base64,L${g.dataset.play}")`);
    expect(bends()).toEqual(found.map((d) => `data:image/png;base64,B${d.dataset.play}`));
    expect(new Set(bends()).size).toBe(3);
  });

  /* The effect's own call: which play, which box (the very one the dent's shade element is styled with), which density. */
  const callsOf = () => hub.images.mock.calls as unknown as [string, { x: number; y: number; width: number; height: number }, number][];
  const lastCallFor = (id: string) => callsOf().filter((c) => c[0] === id).at(-1)!;

  test("each dent's images are asked for with its own play, its own box and the density", () => {
    mount({ plays: [play(1), play(2), play(3)] });
    run();
    const found = dents();
    expect(found).toHaveLength(3);
    expect(new Set(found.map((d) => d.style.width + d.style.height)).size, 'the dents are not all one size').toBeGreaterThan(1);
    for (const d of found) {
      const [id, box, density] = lastCallFor(d.dataset.play!);
      expect(id).toBe(d.dataset.play);
      const own = dentBox(d);
      expect(box.width).toBeCloseTo(own.width, 6);
      expect(box.height).toBeCloseTo(own.height, 6);
      expect(density).toBe(1);
    }
  });

  test('the density is the device pixel ratio held to 2', () => {
    vi.stubGlobal('devicePixelRatio', 3);
    mount();
    run();
    expect(hub.images.mock.calls.length).toBeGreaterThan(0);
    expect(new Set(callsOf().map((c) => c[2]))).toEqual(new Set([2]));
    hub.images.mockClear();
    vi.stubGlobal('devicePixelRatio', 1.5);
    mount({ plays: [play(7)] });
    run();
    expect(new Set(callsOf().map((c) => c[2]))).toEqual(new Set([1.5]));
  });

  test("a play's dent has the same images on every run and for every reader: only where it lands changes", () => {
    const first = mount({ plays: [play(1), play(2), play(3)], reader: { author: false, caster: false } });
    run();
    const imgs = dents().map((d) => [urlOf(d, '--dw-dent-img'), d.dataset.play]);
    const places = dentAt();
    const filter = bends();
    first.unmount();
    pin(9);
    mount({ plays: [play(1), play(2), play(3)], reader: { author: true, caster: true } });
    run();
    expect(dents().map((d) => [urlOf(d, '--dw-dent-img'), d.dataset.play]), 'the same images').toEqual(imgs);
    expect(bends(), 'the same bends').toEqual(filter);
    expect(dentAt(), 'in other places').not.toEqual(places);
  });

  test('no crease is drawn, with one dent or with three that overlap', () => {
    mount();
    run();
    expect(document.querySelector('.dw-chair-creases')).toBeNull();
    expect(document.querySelector('.dw-chair-crease-layer')).toBeNull();
    cleanup();
    pin(SEED_TWO_AND_ONE);
    mount({ plays: [play(1), play(2), play(3)] });
    run();
    expect(dents()).toHaveLength(3);
    expect(document.querySelector('.dw-chair-creases')).toBeNull();
    expect(document.querySelector('.dw-chair-crease-layer')).toBeNull();
  });

  test('1. no blend: the sheet holds no mix-blend-mode and no @supports, the two layers are shown outside forced colors, and the images come from variables', () => {
    expect(sheet, 'a blend takes its backdrop from the nearest stacking context, which a place that shows a post may leave empty (#768)').not.toMatch(/mix-blend-mode/u);
    expect(sheet, 'nothing is gated on a blend any more').not.toMatch(/@supports/u);
    for (const sel of ['.dw-chair-dents', '.dw-chair-glows']) expect(ruleOf(sel), sel).not.toMatch(/display:\s*none/u);
    expect(ruleOf('.dw-chair-dent')).toMatch(/background:[^;]*var\(--dw-dent-img/u);
    expect(ruleOf('.dw-chair-glow')).toMatch(/background:[^;]*var\(--dw-glow-img/u);
    expect(sheet, 'the images replaced every gradient').not.toMatch(/radial-gradient/u);
    expect(sheet).toMatch(/forced-colors: active\)\s*\{\s*\.dw-chair-shading,\s*\.dw-chair-layer\s*\{\s*display: none/u);
    mount();
    run();
    for (const cls of ['dw-chair-dents', 'dw-chair-glows']) {
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

describe("the dents stay above the floor's room", () => {
  /* A post's content area is at least 22.5em tall (thread.css), so on a short post the hit zone has room below the line: a dent's circle is kept above
     the last ROOM_HEIGHT px, where the chairs lie, and not only inside the area. (250 px: shorter than the real minimum, so that the zone's reach
     below the line, a dent's diameter, would otherwise go into the room.) */
  test('on a short post in a content area taller than its room every dent lies above the room', () => {
    size = { h: 250 };
    textRects = [{ left: 10, top: 9, width: 80, height: 18 }];
    for (let seed = 1; seed <= 12; seed++) {
      pin(seed);
      const w = mount({ plays: [play(1), play(2), play(3)] });
      run();
      expect(dents(), `seed ${seed}`).toHaveLength(3);
      for (const d of dents()) {
        const bottom = parseFloat(d.style.top) + parseFloat(d.style.height);
        expect(bottom, `seed ${seed}: a dent's bottom edge against the room's top (${250 - ROOM_HEIGHT})`).toBeLessThanOrEqual(250 - ROOM_HEIGHT + 0.5);
      }
      w.unmount();
    }
  });
});

describe('a dent fits the room it has', () => {
  const dentBox = (d: HTMLElement) => ({ x: parseFloat(d.style.left), y: parseFloat(d.style.top), width: parseFloat(d.style.width), height: parseFloat(d.style.height) });
  const inside = (b: { x: number; y: number; width: number; height: number }, w: number, h: number, label: string) => {
    expect(b.x, `${label}: left`).toBeGreaterThanOrEqual(-0.5);
    expect(b.y, `${label}: top`).toBeGreaterThanOrEqual(-0.5);
    expect(b.x + b.width, `${label}: right`).toBeLessThanOrEqual(w + 0.5);
    expect(b.y + b.height, `${label}: bottom`).toBeLessThanOrEqual(h + 0.5);
  };

  test('2. a later dent is drawn capped against the dents before it, and the first is drawn as it is alone', () => {
    /* The stub's images are fixed addresses, so here they say what they were asked with: where an earlier dent is handed over the address differs
       (dent.ts `dentImages` does the pixels, dent.test.ts). */
    hub.images = vi.fn((id: string, ...rest: unknown[]) => {
      const earlier = (rest[2] as { play: string }[] | undefined) ?? [];
      const tag = earlier.length > 0 ? `+${earlier.map((e) => e.play).join('+')}` : '';
      return { bend: `data:image/png;base64,B${id}`, shade: `data:image/png;base64,S${id}${tag}`, light: `data:image/png;base64,L${id}${tag}` };
    });
    textRects = [{ left: 10, top: 9, width: 80, height: 18 }];
    pin(OVERLAPPING_SEED);
    mount({ plays: [play(1), play(2), play(3)] });
    run();
    const found = dents();
    expect(found).toHaveLength(3);
    const boxes = found.map(dentBox);
    type Rect = typeof boxes[number];
    const near = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    expect(near(boxes[0]!, boxes[1]!) && (near(boxes[0]!, boxes[2]!) || near(boxes[1]!, boxes[2]!)), 'the seed lays the three dents over one another').toBe(true);
    const calls = hub.images.mock.calls.slice(-3) as unknown as [string, Rect, number, { play: string; box: Rect }[] | undefined][];
    found.forEach((d, i) => {
      const id = d.dataset.play!;
      const alone = `url("data:image/png;base64,S${id}")`;
      const shade = d.style.getPropertyValue('--dw-dent-img');
      if (i === 0) expect(shade, 'the first is its own image').toBe(alone);
      else expect(shade, `dent ${i} is not its image alone`).not.toBe(alone);
      expect(calls[i]![0]).toBe(id);
      expect(calls[i]![1], `dent ${i}'s box, in the area's px`).toMatchObject(boxes[i]!);
      expect(calls[i]![3] ?? [], `dent ${i}: the dents before it, with their boxes in the area's px`)
        .toMatchObject(found.slice(0, i).map((e, j) => ({ play: e.dataset.play, box: boxes[j] })));
    });
  });

  test('3. the dent fits a short area: its box lies inside a 120 px area and is at most 120 tall', () => {
    size = { h: 120 };
    textRects = [{ left: 10, top: 9, width: 80, height: 18 }];
    for (let seed = 1; seed <= 12; seed++) {
      pin(seed);
      const w = mount({ plays: [play(1), play(2), play(3)] });
      run();
      expect(dents(), `seed ${seed}`).toHaveLength(3);
      for (const d of dents()) {
        const b = dentBox(d);
        inside(b, 300, 120, `seed ${seed}`);
        expect(b.height, `seed ${seed}: height`).toBeLessThanOrEqual(120 + 0.01);
      }
      w.unmount();
    }
  });

  test('4. the dent fits above the room where there is room: 200 px less ROOM_HEIGHT', () => {
    size = { h: 200 };
    textRects = [{ left: 10, top: 9, width: 80, height: 18 }];
    for (let seed = 1; seed <= 12; seed++) {
      pin(seed);
      const w = mount({ plays: [play(1), play(2), play(3)] });
      run();
      for (const d of dents()) {
        const b = dentBox(d);
        expect(b.height, `seed ${seed}: height`).toBeLessThanOrEqual(200 - ROOM_HEIGHT + 0.01);
        expect(b.y + b.height, `seed ${seed}: bottom`).toBeLessThanOrEqual(200 - ROOM_HEIGHT + 0.5);
      }
      w.unmount();
    }
  });

  test("5. the tall text's dents are inside: a text as wide as the area and 300 px tall in a 400 px area", () => {
    size = { h: 400 };
    textRects = [{ left: 0, top: 0, width: 300, height: 300 }];
    for (let seed = 1; seed <= 12; seed++) {
      pin(seed);
      const w = mount({ plays: [play(1), play(2), play(3)] });
      run();
      expect(dents(), `seed ${seed}`).toHaveLength(3);
      for (const d of dents()) inside(dentBox(d), 300, 400, `seed ${seed}`);
      w.unmount();
    }
  });

  test('6. the least height of a marked area is the full dent and the room, held equal to the constants', () => {
    expect(FULL_DENT + ROOM_HEIGHT).toBe(237);
    expect(ruleOf('[data-dw-chair-room]')).toMatch(new RegExp(`min-height:\\s*${FULL_DENT + ROOM_HEIGHT}px`, 'u'));
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

  /* The staggered throws wait on the world's step count and not on a timer, so a run adds no timer once it has started. */
  test('unmounting stops everything: observers, frames and timers of the run, and nothing is requested or heard afterward', () => {
    const w = mount({ plays: [play(1), play(2), play(3)] });
    const timers = vi.getTimerCount();
    see(true); arm();
    frame();
    expect(groups(), 'the staggered throws are still due').toHaveLength(1);
    expect(queue.size, 'and the loop is waiting for a frame').toBeGreaterThan(0);
    expect(vi.getTimerCount(), 'a run adds no timer of its own: the throws are on the step count').toBe(timers);
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

  test("throws are 0.35 s of the world's time apart: 42 steps", () => {
    mount({ plays: [play(1), play(2), play(3)] });
    see(true); arm();
    expect(groups()).toHaveLength(1);
    for (let i = 0; i < 200 && hub.steps < 100; i++) {
      frame();
      const expected = hub.steps < 42 ? 1 : hub.steps < 84 ? 2 : 3;
      expect(groups().length, `after ${hub.steps} steps`).toBe(expected);
    }
    expect(hub.steps).toBeGreaterThanOrEqual(100);
  });
});

/*
 * The throws' clock is the world's: chair n enters when n times 42 steps have run, so a run is a pure function of its seed and the box, and the
 * frame rate is not in it (a wall-clock stagger entered the chairs at a step that depended on it, and the 4-step cap drops time on a slow frame).
 */
describe("the throws are staggered in the world's own time", () => {
  const threePlays = () => [play(1), play(2), play(3)];
  /** What a run left: every chair's transform, the dents' places and the bodies' rests. */
  const left = () => ({
    transforms: groups().map((g) => [g.dataset.play, g.style.transform]),
    dents: dentAt(),
    bodies: bodies(hub.world!).map((b) => [b.id, b.position, b.quaternion, b.asleep]),
  });

  test.each([2, 5, 23])('the same seed (%i) ends in the same pile at 16 ms frames and at 50 ms frames, which hit the cap and drop time', (seed) => {
    const ends = [16, 50].map((ms) => {
      pin(seed);
      const w = mount({ plays: threePlays() });
      see(true); arm();
      restAt(ms);
      expect(groups()).toHaveLength(3);
      const out = left();
      w.unmount();
      return out;
    });
    expect(ends[1]).toEqual(ends[0]);
  });

  test('the second chair enters only after 42 steps have run, whatever the wall clock says', () => {
    mount({ plays: threePlays() });
    see(true); arm();
    expect(groups()).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(groups(), 'two seconds of timers and no frame').toHaveLength(1);
    expect(hub.steps).toBe(0);
    for (let i = 0; i < 100 && hub.steps < 42; i++) { frame(); if (hub.steps < 42) expect(groups()).toHaveLength(1); }
    expect(hub.steps).toBeGreaterThanOrEqual(42);
    expect(groups().length).toBeGreaterThanOrEqual(2);
  });

  test('the loop keeps asking for frames while a throw is due, even with every body asleep, and stops once all are thrown and asleep', () => {
    hub.sleepAll = true;
    mount({ plays: threePlays() });
    see(true); arm();
    for (let i = 0; i < 400 && hub.steps < 84; i++) {
      frame();
      if (hub.steps < 84) expect(queue.size, `after ${hub.steps} steps: a throw is still due`).toBeGreaterThan(0);
    }
    expect(groups()).toHaveLength(3);
    for (let i = 0; i < 10; i++) frame();
    expect(queue.size, 'all thrown and asleep').toBe(0);
    expect(bodies(hub.world!).every((b) => b.asleep)).toBe(true);
  });

  test('leaving the view mid-stagger throws nothing more', () => {
    mount({ plays: threePlays() });
    see(true); arm();
    for (let i = 0; i < 5; i++) frame();
    expect(hub.steps).toBeLessThan(42);
    see(false);
    expect(groups()).toHaveLength(0);
    const steps = hub.steps;
    act(() => { vi.advanceTimersByTime(2000); drain(); drain(); });
    expect(groups()).toHaveLength(0);
    expect(hub.steps).toBe(steps);
    expect(queue.size).toBe(0);
  });

  test('Throw again mid-stagger starts over with one chair, and the old run throws nothing more', () => {
    mount({ plays: threePlays() });
    see(true); arm();
    for (let i = 0; i < 20; i++) frame();
    expect(groups().length).toBeLessThan(3);
    const again = lastView().controls.find((c) => c.kind === 'press')! as { run: () => void };
    act(() => { again.run(); });
    expect(groups()).toHaveLength(1);
    hub.steps = 0;
    for (let i = 0; i < 100 && hub.steps < 42; i++) { frame(); if (hub.steps < 42) expect(groups()).toHaveLength(1); }
  });

  test('a play that lands while the run is still staggering is thrown alone, at once, and the run goes on', () => {
    mount({ plays: [play(1), play(2)] });
    see(true); arm();
    for (let i = 0; i < 3; i++) frame();
    expect(groups()).toHaveLength(1);
    act(() => { hub.setPlays([play(1), play(2), play(3)]); });
    expect(groups().map((g) => g.dataset.play).sort(), 'sc2 still waits for its step; sc3 is thrown at once').toEqual(['sc1', 'sc3']);
    restAt(16);
    expect(groups()).toHaveLength(3);
  });

  test('reduced motion places the throws 42 steps apart, so its rest is the one the animated run ends in for the same seed', () => {
    const rests: ReturnType<typeof left>[] = [];
    for (const mode of ['full', 'reduce'] as const) {
      document.documentElement.setAttribute('data-kb-motion', mode);
      pin(2);
      const w = mount({ plays: threePlays() });
      see(true); arm(); restAt(16);
      expect(groups()).toHaveLength(3);
      rests.push(left());
      w.unmount();
    }
    expect(rests[1]!.transforms, 'the chairs lie as the animated run left them').toEqual(rests[0]!.transforms);
    expect(rests[1]!.dents, 'the dents are where the chairs hit').toEqual(rests[0]!.dents);
    expect(rests[1]!.bodies).toEqual(rests[0]!.bodies);
  });
});

describe('sound', () => {
  const heard = () => hub.sound.play.mock.calls as unknown as [string, { group?: string; voices?: number; lateMs?: number }][];
  const counts = () => {
    const keys = heard().map((c) => c[0]);
    return {
      hits: keys.filter((k) => k === 'steel-chair.hit').length,
      settles: keys.filter((k) => /^steel-chair\.settle-[1-4]$/u.test(k)).length,
      all: keys.length,
      carried: heard().every((c) => c[1].group === 'steel-chair' && typeof c[1].voices === 'number' && c[1].voices === VOICES && c[1].lateMs === LATE_MS),
    };
  };

  test('every run plays a hit and one settle sound per chair, in the group and with lateMs LATE_MS: the first, a replay by scroll and one by Throw again', () => {
    /* A chair that lands on another never touches the floor, so it has no floor sound; the seed is pinned to a throw in which all three reach it (seed 6, for one, lands a chair on another). */
    pin(2);
    mount({ plays: [play(1), play(2), play(3)] });
    run();
    const first = counts();
    expect(first.hits).toBe(3);
    expect(first.settles).toBe(3);
    expect(first.all).toBe(6);
    expect(first.carried, 'each play carries the group, its voices and lateMs').toBe(true);
    hub.sound.play.mockClear();
    see(false); aim(false); see(true); arm(); settled();
    expect(groups()).toHaveLength(3);
    expect(counts(), 'a replay by scroll sounds as the first run did').toEqual(first);
    hub.sound.play.mockClear();
    const again = lastView().controls.find((c) => c.kind === 'press')! as { run: () => void };
    act(() => { again.run(); });
    settled();
    expect(groups()).toHaveLength(3);
    expect(counts(), 'Throw again sounds as the first run did').toEqual(first);
  });
});

describe('sound and met across the effect coming and going inside one mount', () => {
  test('after the last play ends and a new one lands, the new run sounds and the card is not met again', () => {
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
    expect(hub.sound.play).toHaveBeenCalled();
    expect((hub.sound.play.mock.calls as unknown as [string, { group?: string; voices?: number; lateMs?: number }][]).every((c) => c[1].group === 'steel-chair' && typeof c[1].voices === 'number' && c[1].voices === VOICES && c[1].lateMs === LATE_MS), 'the new run\'s plays carry the group, its voices and lateMs').toBe(true);
    expect(hub.sound.play).toHaveBeenCalledWith('steel-chair.hit', { group: 'steel-chair', voices: VOICES, lateMs: LATE_MS });
    expect(made.met).toHaveBeenCalledTimes(1);
  });

  test('a run abandoned by the post scrolling out of view before its hit makes no further sound', () => {
    mount({ plays: [play(1)] });
    see(true); arm();
    expect(groups()).toHaveLength(1);
    expect(hub.sound.play, 'the chair is thrown and has not yet hit').not.toHaveBeenCalled();
    see(false);
    expect(groups()).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(3000); drain(); drain(); });
    for (let i = 0; i < 200; i++) frame();
    expect(hub.sound.play, 'nothing sounds for a run that was left').not.toHaveBeenCalled();
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
    expect(document.querySelector('[data-dw-chair-shake]')).toBeNull();
    expect(hub.sound.play).not.toHaveBeenCalled();
    expect(requested).toBe(0);
  });

  test('every chair it draws at once lies low: its top is no higher than the room above the content area bottom border', () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    for (let seed = 1; seed <= 12; seed++) {
      pin(seed);
      const w = mount({ plays: [play(1), play(2), play(3)] });
      see(true); aim(true);
      expect(groups(), `seed ${seed}`).toHaveLength(3);
      /* The world the effect simulates: INSET in from the sides, its floor INSET above the content area's bottom border. */
      const areaHeight = hub.world!.floorY + INSET;
      for (const b of bodies(hub.world!)) {
        expect(b.asleep, `seed ${seed}`).toBe(true);
        const center = { x: b.position.x + INSET, y: b.position.y, z: b.position.z };
        const top = Math.min(...cornersOf(b).map((c) => drawn([c[0] + INSET, c[1], c[2]], center).y));
        expect(areaHeight - top, `seed ${seed}: a chair's top is ${areaHeight - top} above the border, the room ${ROOM_HEIGHT}`).toBeLessThanOrEqual(ROOM_HEIGHT);
      }
      w.unmount();
    }
  });

  test('a chair at rest says how many nudges its body took (data-nudges), so a picture that shows no nudge can still be told from one that had it', () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    const counts: number[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      pin(seed);
      const w = mount({ plays: [play(1), play(2), play(3)] });
      see(true); aim(true);
      /* The bodies are added in the plays' order, so the nth body is the nth chair by play id. */
      const drawn = groups().sort((x, y) => x.dataset.play!.localeCompare(y.dataset.play!));
      const views = [...bodies(hub.world!)].sort((x, y) => x.id - y.id);
      expect(drawn, `seed ${seed}`).toHaveLength(views.length);
      for (const [i, b] of views.entries()) {
        expect(drawn[i]).toHaveAttribute('data-nudges', String(b.nudges));
        counts.push(b.nudges);
      }
      w.unmount();
    }
    expect(counts.some((n) => n >= 1), 'some seed in 30 nudged a chair').toBe(true);
    expect(counts.some((n) => n === 0), 'and some did not').toBe(true);
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

/** A moment's time: before the ended play's end below, and before the plays' far end too. */
const AT = { at: Date.parse('1999-12-31T00:00:00Z') };
const BEHIND = '2000-01-01T00:00:00Z';

describe('a moment', () => {
  test("a play whose end is behind today's clock is thrown in a moment, as the post stood then", () => {
    mount({ plays: [play(1, BEHIND)], moment: AT });
    run();
    expect(groups()).toHaveLength(1);
    expect(dents()).toHaveLength(1);
    cleanup();
    mount({ plays: [play(1, BEHIND)] });
    run();
    expect(groups(), 'a live post drops it').toHaveLength(0);
  });

  test('a single play whose end is after the moment says "Ends" in the way out, though the page\'s clock is past it', () => {
    mount({ plays: [play(1, BEHIND)], moment: AT });
    expect(lastView().ends).toMatch(/^Ends /u);
  });

  test('the run waits for the post to be in view, and does not start before the arming wait', () => {
    mount({ plays: [play(1), play(2)], moment: AT });
    expect(groups(), 'nothing is drawn at mount').toHaveLength(0);
    expect(requested).toBe(0);
    see(true); aim(true);
    act(() => { vi.advanceTimersByTime(299); });
    expect(groups(), 'not before 300 ms in view').toHaveLength(0);
    act(() => { vi.advanceTimersByTime(1); });
    expect(groups(), 'the first chair is thrown').toHaveLength(1);
    settled();
    expect(groups()).toHaveLength(2);
  });

  test('the run is cleared when the post leaves the view, and a new one starts when it comes back', () => {
    mount({ plays: [play(1)], moment: AT });
    run();
    expect(groups()).toHaveLength(1);
    see(false);
    expect(groups()).toHaveLength(0);
    expect(dents()).toHaveLength(0);
    aim(false); aim(true); act(() => { vi.advanceTimersByTime(300); });
    expect(groups()).toHaveLength(1);
  });

  test('the hit sounds are asked of the mixer, in the group and with lateMs', () => {
    mount({ plays: [play(1)], moment: AT });
    run();
    expect(hub.sound.play).toHaveBeenCalledWith('steel-chair.hit', { group: 'steel-chair', voices: VOICES, lateMs: LATE_MS });
  });

  test('under reduced motion it is settled at once and silent, as live', () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    mount({ plays: [play(1), play(2)], moment: AT });
    see(true); aim(true);
    expect(requested, 'no frame').toBe(0);
    expect(groups()).toHaveLength(2);
    expect(dents()).toHaveLength(2);
    expect(groups().every((g) => g.hasAttribute('data-rest'))).toBe(true);
    expect(hub.sound.play).not.toHaveBeenCalled();
    expect(document.querySelector('[data-dw-chair-shake]')).toBeNull();
  });

  test("Throw again is in the view's controls and throws again, with a different target", () => {
    mount({ plays: [play(1)], moment: AT });
    run();
    expect(lastView().controls.map((c) => [c.kind, c.label])).toEqual([['press', 'Throw again'], ['toggle', 'Game sounds']]);
    const first = dentAt();
    act(() => { (lastView().controls[0] as { run: () => void }).run(); });
    settled();
    expect(groups()).toHaveLength(1);
    expect(dentAt()).not.toEqual(first);
  });

  test('a box that measures nothing when the run arms starts the run when it gets a size, while the post stays in view', () => {
    size = { h: 0 };
    mount({ plays: [play(1)], moment: AT });
    see(true); aim(true);
    act(() => { vi.advanceTimersByTime(300); });
    expect(groups(), 'nothing is thrown at zero').toHaveLength(0);
    size = { h: 200 };
    act(() => { for (const r of sized) r.cb(); });
    settled();
    expect(groups(), 'the run starts when the box has a size').toHaveLength(1);
    expect(dents()).toHaveLength(1);
  });

  test('met is never called, and nothing is saved or released', () => {
    mount({ plays: [play(1), play(2)], moment: AT });
    run();
    expect(groups()).toHaveLength(2);
    expect(made.met).not.toHaveBeenCalled();
    expect(made.save).not.toHaveBeenCalled();
    expect(made.release).not.toHaveBeenCalled();
  });
});

describe('a stale still flag is ignored', () => {
  const stale = (plays: CardPlay[]) => mount({ plays, still: true, moment: null });

  test('the run waits for the post to be in view: nothing is thrown at mount', () => {
    stale([play(1)]);
    expect(groups()).toHaveLength(0);
    expect(requested).toBe(0);
    see(true); aim(true);
    act(() => { vi.advanceTimersByTime(300); });
    expect(groups()).toHaveLength(1);
  });

  test('the hit sound is asked of the mixer', () => {
    stale([play(1)]);
    run();
    expect(hub.sound.play).toHaveBeenCalledWith('steel-chair.hit', { group: 'steel-chair', voices: VOICES, lateMs: LATE_MS });
  });

  test("Throw again is in the view's controls and throws again", () => {
    stale([play(1)]);
    run();
    expect(lastView().controls.map((c) => c.label)).toEqual(['Throw again', 'Game sounds']);
    const first = dentAt();
    act(() => { (lastView().controls[0] as { run: () => void }).run(); });
    settled();
    expect(groups()).toHaveLength(1);
    expect(dentAt()).not.toEqual(first);
  });

  test('the run is cleared on leaving view', () => {
    stale([play(1)]);
    run();
    expect(groups()).toHaveLength(1);
    see(false);
    expect(groups()).toHaveLength(0);
  });
});

describe('the filter', () => {
  test('where it is trusted the content area is bent with the filters, once there is a dent, and the filter has the plan\'s parts', () => {
    mount({ plays: [play(1), play(2)] });
    expect(areaEl().style.getPropertyValue('--kb-bend-words')).toBe('');
    run();
    const filter = document.querySelector('filter')!;
    expect(filter).not.toBeNull();
    expect(areaEl().style.getPropertyValue('--kb-bend-words')).toContain(`#${filter.id}`);
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
    expect(areaEl().getAttribute('style') ?? '').not.toContain('--kb-bend');
    expect(document.querySelector('filter')).toBeNull();
    expect(dents()).toHaveLength(1);
  });
});

describe('the filter, where an image cannot be made', () => {
  test("a dent whose bend is '' turns the filter off, and its shade and light are still set", () => {
    hub.images = vi.fn((play: string) => ({ bend: '', shade: `data:image/png;base64,S${play}`, light: `data:image/png;base64,L${play}` }));
    mount();
    run();
    expect(dents()).toHaveLength(1);
    expect(areaEl().getAttribute('style') ?? '').not.toContain('--kb-bend');
    const d = dents()[0]!;
    expect(d.style.getPropertyValue('--dw-dent-img')).toBe(`url("data:image/png;base64,S${d.dataset.play}")`);
    expect(document.querySelector<HTMLElement>('.dw-chair-glow')!.style.getPropertyValue('--dw-glow-img')).toBe(`url("data:image/png;base64,L${d.dataset.play}")`);
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
      pin(PINNED_SEED);
      const w = mount({ plays: [play(1), play(2)], moment: AT, reader });
      run();
      expect(groups(), 'both chairs are thrown').toHaveLength(2);
      expect(dents(), 'and both dents drawn').toHaveLength(2);
      const out = (document.querySelector('.dw-chair') as HTMLElement).outerHTML.replace(/id="[^"]*"/gu, 'id=""').replace(/url\(&quot;#[^)]*\)/gu, 'url()');
      w.unmount();
      return out;
    };
    const a = html({ author: false, caster: false });
    expect(html({ author: true, caster: false })).toBe(a);
    expect(html({ author: false, caster: true })).toBe(a);
  });
});

/*
 * The bend (docs/plans/2026-11-23-dent-bend-design.md, 1 and 2): no element of the effect's carries a filter, which would clip and trap every layer that
 * fills the content area; the effect gives the engine two filters through `setBend`, and the area and the words box wear them by custom properties.
 */
describe('the bend, set on the content area', () => {
  const props = (el: HTMLElement) => [el.style.getPropertyValue('--kb-bend'), el.style.getPropertyValue('--kb-bend-words')];
  const filters = () => ({ area: document.querySelector('filter[id$="-area"]')!, words: document.querySelector('filter[id$="-words"]')! });

  test('no element in the effect carries a filter once a dent lands: there is no wrapper of the effect\'s own', () => {
    mount();
    run();
    expect(dents()).toHaveLength(1);
    expect(document.querySelector('.dw-chair-words'), 'no wrapper').toBeNull();
    for (const el of document.querySelectorAll<HTMLElement>('.dw-chair, .dw-chair *, [data-kb-words-box]')) {
      expect(el.style.filter, `${el.className || el.tagName} has no filter of its own`).toBe('');
    }
  });

  test('the area carries --kb-bend and --kb-bend-words naming the two filters, and loses both on unmount and when the last play ends', () => {
    mount();
    expect(props(areaEl())).toEqual(['', '']);
    run();
    const { area, words } = filters();
    expect(area).not.toBeNull();
    expect(words).not.toBeNull();
    expect(area.id).not.toBe(words.id);
    expect(props(areaEl())).toEqual([`url("#${area.id}")`, `url("#${words.id}")`]);
    /* The last play ends and the post stays: the area is still in the page, and the bend is gone with the effect. */
    act(() => { hub.setPlays([]); });
    expect(areaEl().isConnected).toBe(true);
    expect(props(areaEl())).toEqual(['', '']);
    expect(areaEl().getAttribute('style') ?? '').not.toContain('--kb-bend');
    /* An unmount takes it off too. */
    cleanup();
    mount();
    run();
    const area2 = areaEl();
    expect(props(area2)[0]).not.toBe('');
    cleanup();
    expect(props(area2)).toEqual(['', '']);
  });

  test('the post leaving the view clears the run and the bend with it', () => {
    mount();
    run();
    expect(props(areaEl())[0]).not.toBe('');
    see(false);
    expect(props(areaEl())).toEqual(['', '']);
  });

  test('an ORIGIN box\'s area beside the dented post\'s own carries neither property: only the area the effect found is bent', () => {
    mount({ wrapped: 'beside' });
    run();
    expect(props(areaEl())[0]).not.toBe('');
    const origin = document.querySelector<HTMLElement>('.kb-origin-area')!;
    expect(props(origin)).toEqual(['', '']);
  });

  test('with no content area only the words property is set, on the host, and the shake is on the host', () => {
    mount({ wrapped: false, place: 'origin' });
    run();
    const { words } = filters();
    expect(host()!.style.getPropertyValue('--kb-bend-words')).toBe(`url("#${words.id}")`);
    expect(host()!.style.getPropertyValue('--kb-bend')).toBe('');
    expect(host()).toHaveAttribute('data-dw-chair-shake');
    act(() => { hub.setPlays([]); });
    expect(document.querySelector('[data-dw-chair-shake]')).toBeNull();
  });

  test('the two filters differ in where they stand and their region, and in nothing else', () => {
    mount({ plays: [play(1), play(2)] });
    run();
    const { area, words } = filters();
    /* Words: the words box's px (280 wide, size.h - 16 - ROOM_HEIGHT tall in the stub). Area: the content area's (areaWidth by size.h). */
    expect([area.getAttribute('x'), area.getAttribute('y')].map(Number)).toEqual([-DENT_SCALE, -DENT_SCALE]);
    expect(Number(area.getAttribute('width'))).toBe(areaWidth + 2 * DENT_SCALE);
    expect(Number(area.getAttribute('height'))).toBe(size.h + 2 * DENT_SCALE);
    expect(Number(words.getAttribute('width'))).toBe(280 + 2 * DENT_SCALE);
    const shape = (f: Element) => [...f.children].map((c) => [c.tagName, c.getAttribute('in'), c.getAttribute('in2'), c.getAttribute('result'), c.getAttribute('operator')].join('|'));
    expect(shape(area)).toEqual(shape(words));
    /* The area's feImages stand where the dents do in the content area; the words' are relative to the words box, which stands at (10, 8) in it. */
    const at = (f: Element) => [...f.querySelectorAll('feImage')].map((e) => [Number(e.getAttribute('x')), Number(e.getAttribute('y')), e.getAttribute('width'), e.getAttribute('height')]);
    const [aw, ww] = [at(area), at(words)];
    expect(aw).toHaveLength(2);
    aw.forEach((p, i) => {
      expect(p[0]! as number - (ww[i]![0] as number)).toBeCloseTo(10, 5);
      expect(p[1]! as number - (ww[i]![1] as number)).toBeCloseTo(8, 5);
      expect([p[2], p[3]]).toEqual([ww[i]![2], ww[i]![3]]);
    });
    /* Each dent's box in the area's filter is where its shading lies in the area. */
    const shaded = dents().map((d) => [parseFloat(d.style.left), parseFloat(d.style.top)]);
    expect(aw.map((p) => [p[0], p[1]])).toEqual(shaded);
  });

  test('both filters\' transfer functions are driven by one dent\'s growth', () => {
    mount();
    see(true); arm();
    for (let i = 0; i < 400 && !dents().length; i++) frame();
    const slopes = () => ['area', 'words'].map((w) => Number(document.querySelector(`filter[id$="-${w}"] feFuncR`)!.getAttribute('slope')));
    const intercepts = () => ['area', 'words'].map((w) => Number(document.querySelector(`filter[id$="-${w}"] feFuncG`)!.getAttribute('intercept')));
    expect(slopes()[0]).toBeLessThan(1);
    let mid = false;
    for (let i = 0; i < 12; i++) {
      frame();
      const [a, w] = slopes();
      expect(a, 'the same slope in both').toBe(w);
      expect(intercepts()[0]).toBe(intercepts()[1]);
      if (a! > 0 && a! < 1) mid = true;
    }
    expect(mid, 'caught between nothing and full').toBe(true);
    expect(slopes()).toEqual([1, 1]);
    expect(intercepts()).toEqual([0, 0]);
  });

  test('where the filter is not trusted neither property is set', () => {
    hub.trusted = false;
    mount();
    run();
    expect(areaEl().getAttribute('style') ?? '').not.toContain('--kb-bend');
  });
});
