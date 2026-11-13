/**
 * Whoops!'s drawing (cards plan Task 5; design section 11), as a reader and the post's author meet it.
 * jsdom has no layout and no canvas, so the body's box is stubbed (the cell's client size; its rects sit at 0, 0) and the model the component
 * keeps (which layers are live, how much of each is washed, which lines are read) is read from the
 * attributes it publishes; the pure rules behind them are scrub.test.ts's, and the pixels are the board
 * match's and e2e/whoops.spec.ts's.
 */
import { act, createEvent, fireEvent, screen, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CardPlay, CardView, EffectProps, KitControl } from '../../../../engine/ui/cards/types.ts';
import type { Act, EffectState } from '../../../../engine/ui/data/api.ts';
import { sameView } from '../../../../engine/ui/cards/plays.ts';
import { Kit } from '../../../../engine/ui/cards/Kit.tsx';
import { renderInWorld } from '../../../../engine/ui/test-world.tsx';
import { STROKES, whoops } from '../whoops.ts';
import { LOST_ANSWER } from '../../../../engine/ui/data/api.ts';
import { DROPS_SPEED, Effect, MAX_SAVE_RETRIES, RETRY_AFTER_MS, SAVE_AFTER_MS, dropsOf, heldBytes, percentWashed, savedOf } from './Effect.tsx';
import { FIELD_SCALE, buildLayer, layerKey, type BuildInput } from './build.ts';
import type { BuildClient } from './buildClient.ts';
import { viewProblems } from '../../../../engine/ui/cards/lens-words.ts';
import { cursor } from './cursor.ts';
import { paintSplat } from './paint.ts';
import { decodePoints, packStroke } from './points.ts';
import { BRUSH_PX, LayerInk, PEN_PX, ROW_PX, brushOf, coveredLines, fits, fitStroke, minStepOf, type Pt, type Stroke } from './scrub.ts';
import { DESIGN, THRESHOLD, makeSplat, unitPx, type Box } from './splat.ts';
import { bandGrid, strokesInto } from './field.ts';
import * as suds from './suds.ts';
import { createClaims } from '../../../../engine/ui/cards/claims.ts';

/* The suds and the drawn cursor are their own modules' (suds.test.ts, cursor.test.tsx): here the effect is seen to call them. */
vi.mock('./suds.ts', () => ({ register: vi.fn(), unregister: vi.fn(), wash: vi.fn(), puff: vi.fn() }));
vi.mock('./cursor.ts', () => ({ cursor: { over: vi.fn(), press: vi.fn(), leave: vi.fn() } }));
/* The splat's painter is the config form's preview now: nothing in a post's drawing calls it, and a test says so. */
vi.mock('./paint.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('./paint.ts')>();
  return { ...real, paintSplat: vi.fn(real.paintSplat) };
});

/*
 * The page's build client is the test's to hold: by default the real one with no worker (a light layer is built on the spot, as in the
 * game), and a test that sets `seam.client` sees every request and decides when each is answered.
 */
const seam = vi.hoisted(() => ({ client: null as null | BuildClient, real: null as null | BuildClient }));
vi.mock('./buildClient.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('./buildClient.ts')>();
  return { ...real, buildClient: () => seam.client ?? (seam.real ??= real.createBuildClient({ makeWorker: null })) };
});

/* Every ink grid the component builds is counted, so a test can tell a rebuild from a kept grid. Tests that count do not build their own. */
const built = vi.hoisted(() => ({ grids: 0, made: [] as unknown[] }));
vi.mock('./scrub.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('./scrub.ts')>();
  class Counted extends real.LayerInk {
    constructor(...args: ConstructorParameters<typeof real.LayerInk>) {
      super(...args);
      built.grids++;
      built.made.push(this);
    }
  }
  return { ...real, LayerInk: Counted };
});

const LINES = 30;
/** The pen strokes' tests lay the post out this tall, so some lines lie clear of every splat. */
const TEXT_LINES = 40;
const LINE_PX = ROW_PX;
/** Each line of the post's text is exactly this long, so a word's place in the text is its line. */
const LINE_CHARS = 24;
const textOf = (lines: number) => Array.from({ length: lines }, (_, k) => `L${String(k).padStart(2, '0')} alpha beta gamma`.padEnd(LINE_CHARS)).join('');
/** The thread's body at the board's widest, and a phone's: the box the ink is fitted to is the body as it stands. */
const MAX_FRAME = 988;
const PHONE_FRAME = 390;

let boxWidth = MAX_FRAME;
/** How many lines tall the post is laid out; an edit changes it. */
let layoutLines = LINES;
/** A body's height when it is not its lines' (a tall phone body, a short wide one). */
let boxHeight: number | null = null;
/** When set, the frame's own client size, apart from the cell's (words moved out of the cell into a view of another size). */
let frameBox: Box | null = null;
const boxNow = (): Box => ({ w: boxWidth, h: boxHeight ?? layoutLines * LINE_PX });

const isBox = (el: HTMLElement) => el.classList?.contains('kb-act-main') || el.classList?.contains('kb-whoops-frame');

beforeEach(() => {
  boxWidth = MAX_FRAME;
  layoutLines = LINES;
  boxHeight = null;
  frameBox = null;
  vi.clearAllMocks();
  seam.client = null;
  /* The body's box (the cell in the thread, the frame in the ORIGIN box); jsdom lays nothing out, so every rect is at 0, 0 and the frame sits at the cell's corner. */
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get(this: HTMLElement) { return this.classList?.contains('kb-whoops-frame') && frameBox ? frameBox.w : isBox(this) ? boxNow().w : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get(this: HTMLElement) { return this.classList?.contains('kb-whoops-frame') && frameBox ? frameBox.h : isBox(this) ? boxNow().h : 0; } });
  /* A word's box: its line down the layout, at its natural size. */
  Range.prototype.getClientRects = function (this: Range) {
    const top = Math.floor(this.startOffset / LINE_CHARS) * LINE_PX;
    return [{ top, bottom: top + LINE_PX, left: 0, right: 1, width: 1, height: LINE_PX, x: 0, y: top }] as unknown as DOMRectList;
  };
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  document.documentElement.removeAttribute('data-kb-motion');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-kb-motion');
  delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
  delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight;
  delete (Range.prototype as { getClientRects?: unknown }).getClientRects;
});

const POST = { id: 'post-1', character: 'someone', kind: 'post', thread: 't', payload: {}, currentPayload: {}, targetActId: null, seq: 41, createdAt: '2026-10-29T21:14:00.000Z', editedAt: null, shownEditedAt: null } as unknown as Act;

function playOf(n: number, color: string, seed: number): CardPlay {
  return { id: `play-${n}`, card: 'whoops', layer: n, caster: `caster-${n}`, message: '', config: { color, seed }, playedAt: `2026-10-29T21:0${n}:00.000Z`, post: POST.id };
}
const SEEDS = [21, 22, 23];
/** Who played each layer, by its caster: Mrs. Hooligan the first (magenta), Gloomba the second (cyan), Spritey the third (yellow). */
const CASTERS: Readonly<Record<string, string>> = { 'caster-1': 'Mrs. Hooligan', 'caster-2': 'Gloomba', 'caster-3': 'Spritey' };
const COLORS = ['#ff2bd6', '#19e3ff', '#ffd93d'];
const plays = (n: number) => Array.from({ length: n }, (_, i) => playOf(i + 1, COLORS[i]!, SEEDS[i]!));
const splatFor = (i: number) => makeSplat(SEEDS[i]!);

const ok = async (play: string) => ({ ok: true as const, value: { play, savedAt: '2026-10-29T22:00:00.000Z' } });

interface Options {
  readonly layers?: number;
  readonly states?: Record<string, EffectState>;
  readonly author?: boolean;
  readonly save?: EffectProps['save'];
  /** Said whenever the effect publishes its view (`EffectProps.show`); the views the effect has published are also kept in `shown`. */
  readonly met?: EffectProps['met'];
  readonly nameOf?: EffectProps['nameOf'];
  /** The instance's share washed that counts as clean; null is an instance whose settings carry none. */
  readonly clean?: number | null;
  /** Drawn in a play's moment (`EffectProps.still`). */
  readonly still?: boolean;
  /** `thread` (the default) renders inside the post body's cell, `.kb-act-main`, which is then the ink's box; `origin` is the ORIGIN box, where the frame is. */
  readonly place?: 'thread' | 'origin';
  /** What the engine draws beside the effect in the post body, such as the reactions row. */
  readonly beside?: ReactNode;
}

function mount(o: Options = {}) {
  const save = o.save ?? vi.fn(ok as unknown as EffectProps['save']);
  /* The engine draws the card's controls from the view the effect publishes (Kit.tsx); this host does the same beside the effect, so a test presses what a player would. */
  const shown: (CardView | null)[] = [];
  let say: (view: CardView | null) => void = () => {};
  const show: EffectProps['show'] = (view) => { shown.push(view); say(view); };
  const props: EffectProps = {
    post: POST, plays: plays(o.layers ?? 1), states: o.states ?? {}, released: new Set(), written: new Map(), reader: { author: o.author ?? false, caster: false },
    place: o.place ?? 'thread', reach: 'post', still: o.still ?? false, save, release: async (play) => ({ ok: true, value: { play, releasedAt: '' } }), show, met: o.met ?? (() => {}), ink: createClaims().at('post:whoops', 0), holdScreen: () => {}, marks: null, nameOf: o.nameOf ?? ((c) => CASTERS[c ?? ''] ?? 'A character'), give: async () => ({ ok: false, error: 'no' }), moreGifts: async () => {}, wallet: null, children: <p>{textOf(layoutLines)}</p>,
  };
  /* The saved states arrive from outside, as another device's save is heard: the host holds them and lets a test push a new set. */
  let push: (next: Record<string, EffectState>) => void = () => {};
  let replay: () => void = () => {};
  let edit: () => void = () => {};
  function Host() {
    const [held, set] = useState(props.states);
    /* The engine hands an effect a new list of the same plays whenever the post's plays are drawn again (Effects.tsx `PostEffects`). */
    const [list, setList] = useState(props.plays);
    push = set;
    replay = () => setList((was) => [...was]);
    /* The post is edited: its payload is a new one, and the layers are built again from the saved states (nothing in them changes). */
    const [payload, setPayload] = useState(props.post.currentPayload);
    edit = () => setPayload({});
    const [view, setView] = useState<CardView | null>(null);
    say = setView;
    const effect = <Effect {...props} post={{ ...props.post, currentPayload: payload }} plays={list} states={held} />;
    return (
      <>
        {props.place === 'thread' ? <div className="kb-act-main">{effect}{o.beside}</div> : effect}
        <Kit card="whoops" controls={view?.controls ?? []} />
      </>
    );
  }
  const world = renderInWorld(<Host />, { settings: { cardSettings: o.clean === null ? {} : { 'whoops.clean': o.clean ?? 95 } } });
  const root = world.container.querySelector('.kb-whoops') as HTMLElement;
  return { ...world, shown, save: save as ReturnType<typeof vi.fn>, root, frame: world.container.querySelector('.kb-whoops-frame') as HTMLElement, cell: world.container.querySelector('.kb-act-main') as HTMLElement, hear: (next: Record<string, EffectState>) => act(() => push(next)), replay: () => act(() => replay()), edit: () => act(() => edit()) };
}

/**
 * IntersectionObserver faked for the post (the frame, watched at '100% 0px') and for the bands (`.kb-band` elements at '50% 0px', which
 * `watchBands` places): each element is told it is in view or not as it is first watched, and again when a test says. `bands` says which
 * bands the viewport holds; the post is in view unless said otherwise. Observers made are let go with the effects that made them.
 */
function sight(start: { post?: boolean; bands?: (band: number) => boolean } = {}) {
  interface Obs { cb: IntersectionObserverCallback; opts?: IntersectionObserverInit; seen: Set<Element> }
  const made: Obs[] = [];
  let postIn = start.post ?? true;
  let bandIn: (band: number) => boolean = start.bands ?? (() => true);
  const isBand = (o: Obs) => o.opts?.rootMargin === '50% 0px';
  const entry = (target: Element, on: boolean) => ({ target, isIntersecting: on, intersectionRatio: on ? 1 : 0 }) as unknown as IntersectionObserverEntry;
  const verdict = (o: Obs, el: Element) => (isBand(o) ? bandIn([...(el.parentElement?.querySelectorAll(':scope > .kb-band') ?? [])].indexOf(el)) : postIn);
  class Fake {
    private readonly mine: Obs;
    constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) { this.mine = { cb, opts, seen: new Set() }; made.push(this.mine); }
    observe(el: Element) { this.mine.seen.add(el); this.mine.cb([entry(el, verdict(this.mine, el))], this as unknown as IntersectionObserver); }
    unobserve(el: Element) { this.mine.seen.delete(el); }
    disconnect() { this.mine.seen.clear(); }
    takeRecords() { return []; }
  }
  vi.stubGlobal('IntersectionObserver', Fake);
  const tell = (only?: (o: Obs) => boolean) => act(() => { for (const o of made) if (!only || only(o)) for (const el of [...o.seen]) o.cb([entry(el, verdict(o, el))], {} as IntersectionObserver); });
  return {
    /** The post comes near the viewport, or goes far from it. */
    see(on: boolean) { postIn = on; tell((o) => !isBand(o)); },
    /** The viewport holds the bands `f` says it does. */
    bands(f: (band: number) => boolean) { bandIn = f; tell(isBand); },
  };
}


/** The washed share of each layer, as the component publishes it. */
const washed = (root: HTMLElement) => root.dataset.kbWashed!.split(' ').map(Number);
const states = (root: HTMLElement) => root.dataset.kbLayers!.split(' ');
const readout = (root: HTMLElement) => root.querySelector('[data-kb-readout]')?.textContent ?? '';

/** The brush a reader's 30px drag makes on this screen's box, as the model keeps it. */
const brush = () => brushOf(BRUSH_PX, boxNow());
const pen = () => brushOf(PEN_PX, boxNow());
/** A layer's model on this screen's box, built as the component builds its own. */
const inkOf = (i: number, strokes: readonly Stroke[] = []) => new LayerInk(splatFor(i), strokes, boxNow());
const washStroke = (points: readonly Pt[]): Stroke => ({ tool: 'wash', ...brush(), points });

/** Screen coordinates, for a point in shares of the box (jsdom's rects sit at 0, 0). */
const px = (x: number, y: number): [number, number] => [x * boxNow().w, y * boxNow().h];

function drag(frame: HTMLElement, points: readonly (readonly [number, number])[]) {
  const [first, ...rest] = points.map(([x, y]) => px(x, y));
  act(() => { fireEvent.pointerDown(frame, { clientX: first![0], clientY: first![1], pointerId: 1, button: 0, pointerType: 'mouse' }); });
  for (const [x, y] of rest) act(() => { fireEvent.pointerMove(frame, { buttons: 1, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse' }); });
  const [lx, ly] = rest[rest.length - 1] ?? first!;
  act(() => { fireEvent.pointerUp(frame, { clientX: lx, clientY: ly, pointerId: 1, pointerType: 'mouse' }); });
}

/**
 * A point on the splat's ink, in shares, where ONE wash pass shows. A wash takes `WASH_TAKES` (1.5) of the field a pass and a splat's
 * core is 2 to 8 deep, so a single drag from the core's center leaves it inked (the old rule, one pass clears what is under the brush,
 * no longer holds): the spot is the thin ink nearest the core, where a short drag to the right of it does wash some cells.
 */
const spots = new Map<string, [number, number]>();
function inkSpot(ink: LayerInk): [number, number] {
  const b = ink.box;
  const key = `${ink.splat.placement.cx},${ink.splat.placement.cy},${b.w}x${b.h}`;
  const kept = spots.get(key);
  if (kept) return kept;
  const { cx, cy } = ink.splat.placement;
  const x0 = cx / DESIGN.w;
  const candidates: [number, number][] = [];
  for (let y = 0; y <= 1; y += 6 / b.h) for (let x = 0; x <= 1; x += 6 / b.w) if (ink.has(x, y) && ink.valueAt(x, y) < 1) candidates.push([x, y]);
  candidates.sort((p, q) => Math.hypot(p[0] - x0, p[1] - cy) - Math.hypot(q[0] - x0, q[1] - cy));
  for (const [x, y] of candidates.slice(0, 60)) {
    const fresh = new LayerInk(ink.splat, [{ tool: 'wash', ...brushOf(BRUSH_PX, b), points: [[x, y], [x + 0.05, y]] }], b);
    if (fresh.washed > 0) { spots.set(key, [x, y]); return [x, y]; }
  }
  throw new Error('no thin ink on this splat');
}

/** A point on the splat's ink, in shares: its core's center, which takes several passes to wash. */
function coreSpot(ink: LayerInk): [number, number] {
  const { cx, cy } = ink.splat.placement;
  const x = cx / DESIGN.w;
  return ink.has(x, cy) ? [x, cy] : [x, cy + 0.05];
}

/** A wash through `points` on the model, as the Effect makes one: a line begun, moved along and lifted. */
function washOn(ink: LayerInk, points: readonly Pt[], b: { width: number; aspect: number }): void {
  const line = ink.begin({ tool: 'wash', ...b, points: [] });
  for (const p of points) line.to(p);
  line.end();
}

/** The points of a drag along y across the ink there: from its first inked point to its last. */
function rowAcross(ink: LayerInk, y: number): [number, number][] {
  const row: [number, number][] = [];
  for (let x = 0; x <= 1; x += 0.01) if (ink.has(x, y)) row.push([x, y]);
  return row.filter((_, i) => i === 0 || i % 5 === 0 || i === row.length - 1);
}

/** The most passes over the whole layer a test scrubs: a pass takes `WASH_TAKES` (1.5) of the field and a core is up to about 8.5 deep, so cleaning takes several. */
const MOST_PASSES = 14;

/** Drag rows across a layer's ink, pass after pass over it, until it is washed to `share`, as a hand would. Each row is found again on the model, which keeps up with what was washed. */
function scrubTo(frame: HTMLElement, root: HTMLElement, layer: number, ink: LayerInk, share: number) {
  const b = brush();
  for (let pass = 0; pass < MOST_PASSES && washed(root)[layer]! < share; pass++) {
    for (let y = 0; y <= 1 && washed(root)[layer]! < share; y += (BRUSH_PX * 0.7) / boxNow().h) {
      const row = rowAcross(ink, y);
      if (row.length >= 2) {
        drag(frame, row);
        washOn(ink, row, b);
      }
    }
  }
}

/** One unbroken path across a layer's ink, row after row as a hand scrubs back and forth, ending once the model says it is washed to `share`. */
function scrubPath(ink: LayerInk, share: number): [number, number][] {
  const b = brush();
  const path: [number, number][] = [];
  let back = false;
  for (let pass = 0; pass < MOST_PASSES && ink.washed < share; pass++) {
    for (let y = 0; y <= 1 && ink.washed < share; y += (BRUSH_PX * 0.7) / boxNow().h) {
      const row = rowAcross(ink, y);
      if (row.length < 2) continue;
      if (back) row.reverse();
      back = !back;
      washOn(ink, path.length > 0 ? [path[path.length - 1]!, ...row] : row, b);
      path.push(...row);
    }
  }
  return path;
}

/** The line of the post's text that lies under a layer's ink (the first such, nearest the splat's core), and where its middle is, in shares down the box. */
function coveredLine(ink: LayerInk): { line: number; y: number } {
  const lines = boxNow().h / LINE_PX;
  const mid = Math.floor(ink.splat.placement.cy * lines);
  for (let d = 0; d < lines; d++) {
    for (const k of [mid + d, mid - d]) {
      if (k < 0 || k >= lines) continue;
      const y = ((k + 0.5) * LINE_PX) / boxNow().h;
      if (coveredLines([{ top: y - 0.001, bottom: y + 0.001, text: '' }], [ink])[0]) return { line: k, y };
    }
  }
  throw new Error('no line lies under this splat');
}
const nameOfLine = (line: number) => `L${String(line).padStart(2, '0')} alpha beta gamma`;

describe('a saved state, read defensively', () => {
  const ink = (points: Pt[], extra: object = {}) => ({ tool: 'ink', color: 'red', width: 0.1, aspect: 2, points: packStroke({ tool: 'ink', color: 'red', width: 0.1, aspect: 2, points }).points, ...extra });
  test('a piece that carries drops is a line\'s last: a continued piece after it is not joined (the card refuses a line that goes on past its drops)', () => {
    const last = ink([[0.1, 0.1], [0.2, 0.2]], { drops: 1 });
    const after = ink([[0.2, 0.2], [0.3, 0.3]], { continues: true });
    const read = savedOf({ strokes: [last, after] }).strokes;
    expect(read).toHaveLength(2);
    expect(read[0]!.tool === 'ink' && read[0]!.drops).toBe(1);
    expect(read[1]!.continues).toBeUndefined();
    /* Drops of 0 are drops all the same, and a piece before them with none is joined as ever. */
    expect(savedOf({ strokes: [ink([[0.1, 0.1], [0.2, 0.2]], { drops: 0 }), after] }).strokes[1]!.continues).toBeUndefined();
    expect(savedOf({ strokes: [ink([[0.1, 0.1], [0.2, 0.2]]), after] }).strokes[1]!.continues).toBe(true);
  });

  test('a continued stroke after a dropped one is not joined to whatever now precedes it', () => {
    const good = ink([[0.1, 0.1], [0.2, 0.2]]);
    const bad = ink([[0.2, 0.2], [0.3, 0.3]], { points: 'not+base64url' });
    const orphan = ink([[0.3, 0.3], [0.4, 0.4]], { continues: true });
    const read = savedOf({ strokes: [good, bad, orphan] }).strokes;
    expect(read).toHaveLength(2);
    expect(read[1]!.continues).toBeUndefined();
    /* A continued piece that does follow its kept predecessor stays joined. */
    const joined = savedOf({ strokes: [good, ink([[0.2, 0.2], [0.4, 0.4]], { continues: true })] }).strokes;
    expect(joined[1]!.continues).toBe(true);
    /* A different color, or a first point that is not the last one, is not a continuation. */
    expect(savedOf({ strokes: [good, ink([[0.2, 0.2], [0.4, 0.4]], { continues: true, color: 'blue' })] }).strokes[1]!.continues).toBeUndefined();
    expect(savedOf({ strokes: [good, ink([[0.25, 0.2], [0.4, 0.4]], { continues: true })] }).strokes[1]!.continues).toBeUndefined();
    expect(savedOf({ strokes: [ink([[0.1, 0.1]], { continues: true })] }).strokes[0]!.continues).toBeUndefined();
  });
});

describe('the layers', () => {
  test('a post with three plays draws three layers, the latest on top, and still draws its words', () => {
    const { root } = mount({ layers: 3 });
    expect(states(root)).toEqual(['live', 'live', 'live']);
    expect(washed(root)).toEqual([0, 0, 0]);
    expect(root).toHaveTextContent('L00 alpha beta gamma');
  });

  test('the post\'s words are laid out like any other post\'s: no fixed width, no transform and no padding, at 988px and at 390px', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    for (const width of [MAX_FRAME, PHONE_FRAME]) {
      boxWidth = width;
      const { root, frame, unmount } = mount();
      const layout = root.querySelector('[data-kb-whoops-layout]') as HTMLElement;
      expect(layout.getAttribute('style') ?? '').toBe('');
      expect(frame.style.height).toBe('');
      /* The ink is fitted to the body: canvases laid down the body's box (a band of it each), reaching out of the frame to the body's corner. */
      for (let k = 0; k < 4; k++) act(() => { vi.advanceTimersByTime(60); });
      const [first, last] = [...root.querySelectorAll<HTMLCanvasElement>('canvas.kb-whoops-ink')];
      expect([first!.width, first!.height]).toEqual([width, 512]);
      expect([first!.style.left, first!.style.top, first!.style.width, first!.style.height]).toEqual(['0px', '0px', `${width}px`, '512px']);
      expect([last!.width, last!.height]).toEqual([width, LINES * LINE_PX - 512]);
      expect([last!.style.left, last!.style.top, last!.style.width, last!.style.height]).toEqual(['0px', '512px', `${width}px`, `${LINES * LINE_PX - 512}px`]);
      unmount();
    }
  });

  test('a layer whose saved state says it is clean is not drawn, and the post is plain again', () => {
    const { root } = mount({ layers: 2, states: { 'play-2': { state: { strokes: [], clean: true }, savedAt: '2026-10-29T22:00:00.000Z' } } });
    expect(states(root)).toEqual(['live', 'clean']);
    const all = mount({ layers: 1, states: { 'play-1': { state: { strokes: [], clean: true }, savedAt: '2026-10-29T22:00:00.000Z' } } });
    /* The one live post has its hold control; the plain one publishes none. */
    expect(screen.getAllByRole('button', { name: 'Hold to scrub' })).toHaveLength(1);
    expect(all.shown.at(-1)?.controls).toEqual([]);
  });
});

describe('an edit', () => {
  test('leaves the splat where it is: the same play draws the same splat at two post heights', () => {
    const short = mount({ layers: 2 });
    const was = short.root.dataset.kbSplat;
    expect(was).toBeTruthy();
    short.unmount();
    layoutLines = LINES * 2;
    const tall = mount({ layers: 2 });
    expect(tall.root.dataset.kbSplat).toBe(was);
  });
});

describe('scrubbing', () => {
  test('a stroke scrubs the top layer where it starts', () => {
    const { frame, root } = mount({ layers: 2 });
    const top = inkOf(1);
    const [x, y] = inkSpot(top);
    drag(frame, [[x, y], [x + 0.05, y], [x + 0.1, y]]);
    expect(washed(root)[1]).toBeGreaterThan(0);
    expect(washed(root)[0]).toBe(0);
  });

  test('a stroke started where the top layer is gone scrubs the one under it', () => {
    const { frame, root } = mount({ layers: 2 });
    const top = inkOf(1);
    const under = inkOf(0);
    let spot: [number, number] | null = null;
    for (let y = 0.05; y < 0.95 && !spot; y += 0.04) for (let x = 0.1; x < 0.9; x += 0.04) if (top.has(x, y) && under.has(x, y)) { spot = [x, y]; break; }
    expect(spot, 'two splats on one post overlap somewhere').not.toBeNull();
    /* Wash the top layer away around the spot, then start there again. */
    const around: [number, number][] = [[spot![0], spot![1]], [spot![0] + 0.06, spot![1]], [spot![0] + 0.12, spot![1]], [spot![0], spot![1]], [spot![0] - 0.06, spot![1]], [spot![0] - 0.12, spot![1]]];
    for (let pass = 0; pass < MOST_PASSES && top.has(spot![0], spot![1]); pass++) {
      drag(frame, around);
      washOn(top, around, brush());
    }
    const before = washed(root);
    expect(before[1]).toBeGreaterThan(0);
    expect(before[0]).toBe(0);
    /* The layer under may be deep there: its first pass takes some of it, and a few more open a hole. */
    for (let pass = 0; pass < MOST_PASSES && washed(root)[0] === 0; pass++) drag(frame, [[spot![0], spot![1]], [spot![0] + 0.03, spot![1]], [spot![0] + 0.06, spot![1]]]);
    expect(washed(root)[0]).toBeGreaterThan(0);
  });

  test('a stroke that starts where there is no ink is left to the page: it is not caught and scrubs nothing', () => {
    const { frame, root } = mount();
    const prevented = vi.fn();
    /* React listens on its root, so the document sees an event after the page's handlers have had it. */
    const watch = (e: Event) => { if (e.defaultPrevented) prevented(); };
    document.addEventListener('pointerdown', watch);
    /* A corner of the box no splat reaches: its flecks are small and its core is at the middle. */
    const corner = [0.001, 0.001] as const;
    expect(inkOf(0).has(...corner)).toBe(false);
    drag(frame, [corner, [0.02, 0.001]]);
    document.removeEventListener('pointerdown', watch);
    expect(washed(root)).toEqual([0]);
    expect(prevented).not.toHaveBeenCalled();
  });

  test('a reader\'s scrubbing is theirs alone: nothing is saved, and it is gone after a reload', () => {
    const first = mount();
    const [x, y] = inkSpot(inkOf(0));
    drag(first.frame, [[x, y], [x + 0.06, y], [x + 0.12, y]]);
    expect(washed(first.root)[0]).toBeGreaterThan(0);
    expect(first.save).not.toHaveBeenCalled();
    first.unmount();
    const reloaded = mount();
    expect(washed(reloaded.root)).toEqual([0]);
  });

  test('the author\'s scrubbing is saved to the layer\'s play, within the card\'s bounds, and is there after a reload', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const first = mount({ author: true });
    const [x, y] = inkSpot(inkOf(0));
    drag(first.frame, [[x, y], [x + 0.06, y], [x + 0.12, y]]);
    drag(first.frame, [[x, y + 0.05], [x + 0.06, y + 0.05]]);
    expect(first.save).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(first.save).toHaveBeenCalledTimes(1);
    const [play, state] = first.save.mock.calls[0]!;
    expect(play).toBe('play-1');
    expect(whoops.validateState!(state).ok).toBe(true);
    expect((state as { strokes: unknown[] }).strokes).toHaveLength(2);
    const was = washed(first.root)[0]!;
    expect(was).toBeGreaterThan(0);
    first.unmount();
    const reloaded = mount({ states: { 'play-1': { state: state as Record<string, unknown>, savedAt: '2026-10-29T22:00:00.000Z' } } });
    expect(washed(reloaded.root)[0]).toBeCloseTo(was, 2);
  });

  test('a stroke saved on a 988x330 box lands at the same shares on a 390x1100 box, and a dab there is an ellipse by the formula', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    boxHeight = 330;
    const wide = mount({ author: true });
    const [x, y] = coreSpot(inkOf(0));
    /* Passes take some each: six over the same places leave a hole on the phone's box too, whatever is there. */
    for (let pass = 0; pass < 6; pass++) drag(wide.frame, [[x, y], [x + 0.05, y], [x + 0.1, y]]);
    act(() => { vi.advanceTimersByTime(2000); });
    const saved = wide.save.mock.calls[0]![1] as { strokes: { width: number; aspect: number; points: string }[] };
    expect(saved.strokes).toHaveLength(6);
    /* The brush is 30px on its drawer's screen: a share of the width, with the box's proportions beside it. */
    expect(saved.strokes[0]!.width).toBeCloseTo(30 / 988, 4);
    expect(saved.strokes[0]!.aspect).toBeCloseTo(988 / 330, 2);
    expect(decodePoints(saved.strokes[0]!.points)![0]).toEqual([Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
    wide.unmount();
    boxWidth = PHONE_FRAME;
    boxHeight = 1100;
    const tall = mount({ states: { 'play-1': { state: saved, savedAt: '2026-10-29T22:00:00.000Z' } } });
    /* The same points on the phone's box, as ellipses: across 30/988 of 390px, down that and the aspect of 1100px. */
    const model = inkOf(0, saved.strokes.map((s) => ({ tool: 'wash', ...s, points: decodePoints(s.points)! }) as Stroke));
    expect(model.washed).toBeGreaterThan(0);
    expect(washed(tall.root)[0]).toBeCloseTo(model.washed, 3);
    /* A dab on the phone is that screen's own round 30px brush. */
    tall.unmount();
    const dabbed = mount({ author: true });
    const [dx, dy] = inkSpot(inkOf(0));
    drag(dabbed.frame, [[dx, dy]]);
    act(() => { vi.advanceTimersByTime(2000); });
    const dab = (dabbed.save.mock.calls[0]![1] as { strokes: { width: number; aspect: number }[] }).strokes[0]!;
    expect(dab.width).toBeCloseTo(30 / 390, 4);
    expect(dab.aspect).toBeCloseTo(390 / 1100, 3);
    expect(washed(dabbed.root)[0]).toBeCloseTo(inkOf(0, [{ tool: 'wash', width: dab.width, aspect: dab.aspect, points: [[dx, dy]] }]).washed, 3);
  });

  test('a layer washed clean at the instance\'s share fades on a reader\'s own screen, and nothing is saved', () => {
    const { frame, root, save } = mount({ clean: 40 });
    const ink = inkOf(0);
    scrubTo(frame, root, 0, ink, 0.5);
    expect(states(root)).toEqual(['clean']);
    expect(save).not.toHaveBeenCalled();
  });

  test('the author reaching it marks the layer clean in the save, for everyone', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { frame, root, save } = mount({ author: true, clean: 40 });
    scrubTo(frame, root, 0, inkOf(0), 0.5);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(states(root)).toEqual(['clean']);
    const state = save.mock.calls.at(-1)![1] as { clean?: boolean; strokes: unknown[] };
    expect(state.clean).toBe(true);
    expect(whoops.validateState!(state).ok).toBe(true);
  });

  test('a layer reaching the share clears while the stroke is still held, without waiting for the mouse to lift', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { frame, root, save } = mount({ author: true, clean: 40 });
    const [first, ...rest] = scrubPath(inkOf(0), 0.5).map(([x, y]) => px(x, y));
    act(() => { fireEvent.pointerDown(frame, { clientX: first![0], clientY: first![1], pointerId: 1, button: 0, pointerType: 'mouse' }); });
    for (const [x, y] of rest) act(() => { fireEvent.pointerMove(frame, { buttons: 1, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse' }); });
    expect(states(root), 'clean before the button is let go').toEqual(['clean']);
    const [lx, ly] = rest[rest.length - 1]!;
    act(() => { fireEvent.pointerUp(frame, { clientX: lx, clientY: ly, pointerId: 1, pointerType: 'mouse' }); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(states(root)).toEqual(['clean']);
    const state = save.mock.calls.at(-1)![1] as { clean?: boolean; strokes: unknown[] };
    expect(state.clean).toBe(true);
    expect(state.strokes.length, 'the stroke that cleared it is saved with the mark').toBeGreaterThan(0);
  });

  test('an author whose layer has no room left for strokes still marks it clean for everyone on reaching the share', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    /* The card's whole bound in strokes, each a dab in the post's top corner, clear of the splat. */
    const full: Stroke[] = Array.from({ length: STROKES.most }, () => ({ tool: 'wash', ...brush(), points: [[0.01, 0.01], [0.02, 0.01]] }));
    expect(whoops.validateState!({ strokes: full.map(packStroke) }).ok).toBe(true);
    const first = mount({ author: true, clean: 40, states: { 'play-1': { state: { strokes: full.map(packStroke) }, savedAt: '2026-10-29T22:00:00.000Z' } } });
    const ink = inkOf(0, full);
    /* Short of the share, a stroke with no room is not saved, and the author is told so. */
    const [x, y] = inkSpot(ink);
    drag(first.frame, [[x, y], [x + 0.06, y]]);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(first.save).not.toHaveBeenCalled();
    /* True words (#86): what is washed past the bound is this screen's, but washing on to the share still clears it for everyone. */
    expect(first.root.ownerDocument.body).toHaveTextContent('This layer has no room for more strokes to save. What you wash from here shows on your screen only, but washing it clean still clears it for everyone.');
    scrubTo(first.frame, first.root, 0, ink, 0.5);
    /* Time runs on with each answer let in, so a save that would follow the first has its chance. */
    for (let k = 0; k < 6; k++) await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    /* The mark goes once, with the strokes already saved, and is not sent again. */
    expect(first.save).toHaveBeenCalledTimes(1);
    const state = first.save.mock.calls.at(-1)![1] as { clean?: boolean; strokes: unknown[] };
    expect(state.clean).toBe(true);
    expect(state.strokes).toHaveLength(STROKES.most);
    expect(whoops.validateState!(state).ok).toBe(true);
    first.unmount();
    const reloaded = mount({ states: { 'play-1': { state: state as Record<string, unknown>, savedAt: '2026-10-29T22:00:00.000Z' } } });
    expect(states(reloaded.root)).toEqual(['clean']);
  });

  test('a saved state that arrives clean fades the layer for a reader who is looking', () => {
    const { root, hear } = mount();
    expect(states(root)).toEqual(['live']);
    hear({ 'play-1': { state: { strokes: [], clean: true }, savedAt: '2026-10-29T22:00:00.000Z' } });
    expect(states(root)).toEqual(['clean']);
    expect(root).toHaveAttribute('data-kb-fading', 'true');
  });
});

describe('the view the effect publishes (marks-and-the-lens design, sections 3 and 6)', () => {
  const clean = (savedAt = '2026-10-29T22:00:00.000Z'): EffectState => ({ state: { strokes: [], clean: true }, savedAt });
  const last = (shown: readonly (CardView | null)[]) => shown.at(-1)!;

  test('draws no plate and no controls of its own: nothing glass is inside the post', () => {
    const { root, container } = mount({ author: true });
    expect(root.querySelector('button')).toBeNull();
    expect(container.querySelector('.kb-act-slot, .kb-effect-strip, .kb-plate-tile, .kb-whoops-meter, .kb-whoops-hint, .kb-whoops-status')).toBeNull();
    expect(root.textContent).not.toMatch(/splatted|Yours to wash/u);
  });
  test('one layer, nothing washed: the state names the layer and its ink, the edge is at nothing, and the reader has nothing of their own to do', () => {
    const { shown } = mount({ layers: 1 });
    expect(last(shown)).toMatchObject({
      progress: 0, state: '0% washed for you', yours: false,
      ends: 'Ends on your screen when you scrub every layer off. The author can wash it for everyone.',
      notes: { 'play-1': 'Layer 1 of 1, on top · 0% washed' },
    });
    expect(last(shown).report).toBeUndefined();
    expect(viewProblems(last(shown), { holds: false, covers: false })).toEqual([]);
  });
  test('two layers and three read the same way: the top layer that holds ink, with every layer counted', () => {
    expect(last(mount({ layers: 2 }).shown).state).toBe('0% washed for you');
    const three = last(mount({ layers: 3 }).shown);
    expect(three.state).toBe('0% washed for you');
    expect(three.notes).toEqual({ 'play-3': 'Layer 3 of 3, on top · 0% washed', 'play-2': 'Layer 2 of 3 · 0% washed', 'play-1': 'Layer 1 of 3 · 0% washed' });
  });
  test('a layer washed clean: the next one is on top, the notes say Washed clean, and progress is the mean share of the layers that still hold ink', () => {
    const { shown, frame, root } = mount({ layers: 3, states: { 'play-3': { state: { strokes: [], clean: true }, savedAt: '2026-10-29T22:00:00.000Z' } } });
    expect(last(shown).state).toBe('0% washed for you');
    expect(last(shown).notes).toEqual({ 'play-3': 'Washed clean', 'play-2': 'Layer 2 of 3, on top · 0% washed', 'play-1': 'Layer 1 of 3 · 0% washed' });
    const ink = inkOf(1);
    scrubTo(frame, root, 1, ink, 0.4);
    const second = Math.min(1, washed(root)[1]!);
    const first = Math.min(1, washed(root)[0]!);
    expect(second).toBeGreaterThan(0);
    expect(last(shown).progress).toBeCloseTo((first + second) / 2, 2);
    expect(last(shown).state).toBe(`${percentWashed((first + second) / 2, false)}% washed for you`);
    expect(viewProblems(last(shown), { holds: false, covers: false })).toEqual([]);
  });
  test('every layer washed clean: no edge, no controls, nothing to end, and each note reads Washed clean', () => {
    const { shown } = mount({ layers: 2, states: { 'play-1': clean(), 'play-2': clean() } });
    expect(last(shown)).toMatchObject({ progress: null, state: 'Washed clean', yours: false, controls: [], notes: { 'play-1': 'Washed clean', 'play-2': 'Washed clean' } });
    expect(last(shown).ends).toBeUndefined();
  });
  test("the author's line says they can wash it for everyone, as its author", () => {
    expect(last(mount({ layers: 1, author: true }).shown).ends).toBe('Ends on your screen when you scrub every layer off. As its author, you can wash it for everyone.');
  });
  test('a layer that still holds ink never reads 100% washed, and one washed clean always does', () => {
    expect(percentWashed(0.996, false)).toBe(99);
    expect(percentWashed(0.4, false)).toBe(40);
    expect(percentWashed(Number.NaN, false)).toBe(0);
    expect(percentWashed(0.2, true)).toBe(100);
  });
  test('the author has something to do while a layer holds ink, and not once it is all clean', () => {
    expect(last(mount({ author: true }).shown).yours).toBe(true);
    expect(last(mount({ author: true, states: { 'play-1': clean() } }).shown).yours).toBe(false);
  });
  test('the reader has one control, the hold, with the help sentence as its description; the author has two, the hold and a "Your tools, as the author" choice of Wash and Write in ink; no view has more', () => {
    const reader = mount({ layers: 3 });
    const author = mount({ layers: 3, author: true });
    const [hold] = last(reader.shown).controls;
    expect(last(reader.shown).controls).toHaveLength(1);
    expect(hold).toMatchObject({ kind: 'hold', label: 'Hold to scrub' });
    expect((hold as { describe?: string }).describe).toMatch(/hold Space or Enter.*never clears the ink all at once/iu);
    expect(last(author.shown).controls.map((c) => c.kind)).toEqual(['hold', 'choose']);
    expect(last(author.shown).controls[1]).toMatchObject({ label: 'Your tools, as the author', options: [{ value: 'wash', label: 'Wash' }, { value: 'ink', label: 'Write in ink' }], value: 'wash' });
    for (const view of [...reader.shown, ...author.shown]) expect(view?.controls.length ?? 0).toBeLessThanOrEqual(2);
  });
  test('choosing a tool is the effect\'s tool state: the published choice follows it, and the next stroke is written in the layer\'s ink, not washed', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { shown, frame, save } = mount({ author: true });
    const choose = () => last(shown).controls[1] as Extract<KitControl, { kind: 'choose' }>;
    act(() => choose().choose('ink'));
    expect(choose().value).toBe('ink');
    expect(screen.getByRole('button', { name: 'Write in ink' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Wash' })).toHaveAttribute('aria-pressed', 'false');
    drag(frame, [[0.2, 0.3], [0.3, 0.3], [0.4, 0.35]]);
    act(() => { vi.advanceTimersByTime(2000); });
    const stroke = (save.mock.calls[0]![1] as { strokes: { tool: string; color: string }[] }).strokes[0]!;
    expect([stroke.tool, stroke.color]).toEqual(['ink', COLORS[0]]);
    act(() => choose().choose('wash'));
    expect(choose().value).toBe('wash');
  });
  test('an unchanged view is equal: the controls are the same functions after a refresh, so the engine\'s comparison sees no change', () => {
    const { shown, hear } = mount({ layers: 2, author: true });
    const before = last(shown);
    hear({});
    const after = last(shown);
    expect(after.controls.map((c) => c.kind)).toEqual(before.controls.map((c) => c.kind));
    const [h1, h2] = [before.controls[0], after.controls[0]] as Extract<KitControl, { kind: 'hold' }>[];
    expect([h2!.start, h2!.stop]).toEqual([h1!.start, h1!.stop]);
    expect(sameView(before, after)).toBe(true);
  });
  test('the save\'s report is in the view and in the status region once, and no line of it is drawn on a plate', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const full: Stroke[] = Array.from({ length: STROKES.most }, () => ({ tool: 'wash', ...brush(), points: [[0.01, 0.01], [0.02, 0.01]] }));
    const { shown, frame, root } = mount({ author: true, clean: 40, states: { 'play-1': { state: { strokes: full.map(packStroke) }, savedAt: '2026-10-29T22:00:00.000Z' } } });
    expect(last(shown).report).toBeUndefined();
    const [x, y] = inkSpot(inkOf(0, full));
    drag(frame, [[x, y], [x + 0.06, y]]);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(last(shown).report).toMatch(/^This layer has no room for more strokes to save\./u);
    expect(root.querySelector('[data-kb-report]')).toHaveTextContent('This layer has no room for more strokes to save.');
    expect(document.querySelector('.kb-whoops-status')).toBeNull();
  });
});

describe('met', () => {
  test('is called on the first stroke on any layer, once, and not before', () => {
    const met = vi.fn();
    const { frame, root } = mount({ layers: 2, met });
    expect(met).not.toHaveBeenCalled();
    const ink = inkOf(1);
    scrubTo(frame, root, 1, ink, 0.1);
    expect(met).toHaveBeenCalledTimes(1);
    scrubTo(frame, root, 0, inkOf(0), 0.1);
    expect(met).toHaveBeenCalledTimes(1);
  });
  test('the keyboard path\'s first sweep calls it too', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const met = vi.fn();
    mount({ met });
    const button = screen.getByRole('button', { name: 'Hold to scrub' });
    expect(met).not.toHaveBeenCalled();
    act(() => { fireEvent.keyDown(button, { key: ' ' }); });
    act(() => { vi.advanceTimersByTime(100); });
    act(() => { fireEvent.keyUp(button, { key: ' ' }); });
    expect(met).toHaveBeenCalledTimes(1);
  });
});

describe('the keyboard path', () => {
  const hold = (button: HTMLElement) => act(() => { fireEvent.keyDown(button, { key: ' ' }); });
  const release = (button: HTMLElement) => act(() => { fireEvent.keyUp(button, { key: ' ' }); });
  const frames = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
  const clock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });

  test('"Hold to scrub" is a button, and says how to use it', () => {
    mount();
    const button = screen.getByRole('button', { name: 'Hold to scrub' });
    expect(button).toHaveAccessibleDescription(/hold Space or Enter/i);
  });

  test('held, it sweeps line by line at a hand\'s pace, never all at once, and stops when let go', () => {
    clock();
    const { root } = mount({ layers: 1 });
    const button = screen.getByRole('button', { name: 'Hold to scrub' });
    hold(button);
    frames(2000);
    const early = washed(root)[0]!;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(0.15);
    release(button);
    const stopped = washed(root)[0];
    frames(3000);
    expect(washed(root)[0]).toBe(stopped);
  });

  test('held on, it clears a layer in about the time a hand takes: not in a moment, and not never', () => {
    clock();
    const { root } = mount({ layers: 1 });
    const button = screen.getByRole('button', { name: 'Hold to scrub' });
    hold(button);
    frames(8000);
    expect(states(root)).toEqual(['live']);
    /* Every pass takes `WASH_TAKES` of the ink and a core takes several, so at a hand's 400px a second it is about 114 seconds of fake time on this 988px box (it was 86 seconds at 0.55 of the width a second): a hand's time, never a moment and never none. */
    /* SWEEP_MS is the sweep's own time to clean one layer here, measured (114 seconds). The upper bound is 1.25 times that, so a sweep that slows by a quarter is caught, and the lower is 0.8 times, so one that quickens is. */
    const SWEEP_MS = 114_000;
    let t = 8000;
    while (states(root)[0] === 'live' && t < SWEEP_MS * 1.25) { frames(1000); t += 1000; }
    expect(states(root)).toEqual(['clean']);
    expect(t).toBeGreaterThan(10_000);
    expect(t).toBeGreaterThan(SWEEP_MS * 0.8);
  }, 60_000);

  test('a line read through thinned ink is said', () => {
    clock();
    const from = built.made.length;
    const { root } = mount({ layers: 1 });
    const ink = built.made.slice(from).at(-1) as LayerInk;
    const region = root.querySelector<HTMLElement>('[data-kb-uncovered]')!;
    const button = screen.getByRole('button', { name: 'Hold to scrub' });
    hold(button);
    for (let k = 0; k < 120 && region.textContent === ''; k++) frames(500);
    release(button);
    const said = /L(\d\d) alpha beta gamma/u.exec(region.textContent ?? '');
    expect(said).not.toBeNull();
    /* Said while the layer is live, and while ink still lies over most of the line: the eye reads through what is thin. */
    expect(states(root)).toEqual(['live']);
    const y = ((Number(said![1]) + 0.5) * LINE_PX) / boxNow().h;
    const inked = Array.from({ length: 51 }, (_, k) => ink.has(k / 50, y)).filter(Boolean).length;
    expect(inked).toBeGreaterThanOrEqual(26);
  }, 60_000);

  test('a line it uncovers is said, in the polite region on the page from the start', () => {
    clock();
    const { root } = mount({ layers: 1 });
    const region = root.querySelector<HTMLElement>('[data-kb-uncovered]')!;
    expect(region).toBeEmptyDOMElement();
    const button = screen.getByRole('button', { name: 'Hold to scrub' });
    hold(button);
    for (let k = 0; k < 60 && region.textContent === ''; k++) frames(500);
    release(button);
    expect(region.textContent).toMatch(/L\d\d alpha beta gamma/u);
  }, 30_000);

  test('it scrubs the top layer, and the layer under it once the top one is gone', () => {
    clock();
    const { root } = mount({ layers: 2 });
    const button = screen.getByRole('button', { name: 'Hold to scrub' });
    hold(button);
    /* Each layer takes a hand's time, as one does alone (measured at the sweep's pace: the top one is clean at about 162 seconds and both at about 205, the bounds 1.25 times those). */
    let t = 0;
    while (states(root)[1] === 'live' && t < 202_500) { frames(1000); t += 1000; }
    expect(states(root)[1]).toBe('clean');
    while (states(root)[0] === 'live' && t < 256_000) { frames(1000); t += 1000; }
    expect(states(root)).toEqual(['clean', 'clean']);
  }, 60_000);
});

describe('what a screen reader is given', () => {
  test('a line under ink is hidden from a screen reader as it is from the eye, and the lines clear of it are read', () => {
    layoutLines = TEXT_LINES;
    const { root } = mount();
    const layout = root.querySelector('[data-kb-whoops-layout]') as HTMLElement;
    expect(layout).toHaveAttribute('inert');
    const covered = coveredLine(inkOf(0)).line;
    const text = readout(root);
    expect(text).not.toContain(nameOfLine(covered));
    /* The splat covers the whole body, so some lines are clear and some are not. */
    expect(text).toContain('alpha beta gamma');
    expect(text.length).toBeLessThan(textOf(TEXT_LINES).length);
  });

  test('a line is read out once it is uncovered', () => {
    const { frame, root } = mount();
    const ink = inkOf(0);
    const { line, y } = coveredLine(ink);
    expect(readout(root)).not.toContain(nameOfLine(line));
    drag(frame, rowAcross(ink, y));
    expect(readout(root)).toContain(nameOfLine(line));
  });

  test('with no ink left, the post is plain: nothing hidden, nothing read twice', () => {
    const { root } = mount({ states: { 'play-1': { state: { strokes: [], clean: true }, savedAt: '2026-10-29T22:00:00.000Z' } } });
    expect(root.querySelector('[data-kb-whoops-layout]')).not.toHaveAttribute('inert');
    expect(root.querySelector('[data-kb-readout]')).toBeNull();
  });
});

describe('motion', () => {
  const scrubOnce = () => {
    const { frame, root, unmount } = mount();
    const [x, y] = inkSpot(inkOf(0));
    drag(frame, [[x, y], [x + 0.05, y], [x + 0.1, y], [x + 0.15, y]]);
    return { root, unmount };
  };

  test('the brush throws soap suds: each move of a stroke is washed on the post\'s suds, in px of its box', () => {
    const { root } = scrubOnce();
    expect(vi.mocked(suds.wash)).toHaveBeenCalled();
    const [host, from, to, overInk] = vi.mocked(suds.wash).mock.calls[0]!;
    expect(host).toBeTruthy();
    expect(from.x).toBeGreaterThan(0);
    expect(to.x).toBeGreaterThan(from.x);
    expect(to.y).toBeCloseTo(from.y, 5);
    expect(overInk).toBe(true);
    expect(washed(root)[0]).toBeGreaterThan(0);
  });

  test('under reduced motion there are none, and the scrubbing still works', () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    const { root } = scrubOnce();
    expect(vi.mocked(suds.wash)).not.toHaveBeenCalled();
    expect(washed(root)[0]).toBeGreaterThan(0);
  });

  test('a fade still running when the post leaves the page leaves no timer behind', () => {
    vi.useFakeTimers();
    try {
      const fading = mount({ clean: 40 });
      scrubTo(fading.frame, fading.root, 0, inkOf(0), 0.5);
      expect(fading.root).toHaveAttribute('data-kb-fading', 'true');
      fading.unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  test('a layer washed clean fades; under reduced motion it is gone at once', () => {
    const fading = mount({ clean: 40 });
    scrubTo(fading.frame, fading.root, 0, inkOf(0), 0.5);
    expect(fading.root).toHaveAttribute('data-kb-fading', 'true');
    fading.unmount();
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    const instant = mount({ clean: 40 });
    scrubTo(instant.frame, instant.root, 0, inkOf(0), 0.5);
    expect(states(instant.root)).toEqual(['clean']);
    expect(instant.root).not.toHaveAttribute('data-kb-fading');
  });
});

describe('the author', () => {
  test('writes back in the top layer\'s ink with a thinner pen, and it is saved as an ink stroke the card accepts', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { frame, save } = mount({ author: true, layers: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Write in ink' }));
    expect(screen.getByRole('button', { name: 'Write in ink' })).toHaveAttribute('aria-pressed', 'true');
    drag(frame, [[0.2, 0.3], [0.3, 0.3], [0.4, 0.35]]);
    act(() => { vi.advanceTimersByTime(2000); });
    const [play, state] = save.mock.calls[0]!;
    expect(play).toBe('play-2');
    const stroke = (state as { strokes: { tool: string; color: string; width: number }[] }).strokes[0]!;
    expect([stroke.tool, stroke.color]).toEqual(['ink', '#19e3ff']);
    expect(stroke.width).toBeLessThan(brush().width);
    expect(whoops.validateState!(state).ok).toBe(true);
  });

  test('a reader is not offered the author\'s tools', () => {
    mount();
    expect(screen.queryByRole('button', { name: 'Write in ink' })).toBeNull();
  });

  test('a save the card refuses is told in the server\'s words, and the strokes stay on the author\'s screen', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const save = vi.fn(async () => ({ ok: false as const, error: 'at most 200 strokes' }));
    const { frame, root } = mount({ author: true, save: save as unknown as EffectProps['save'] });
    const [x, y] = inkSpot(inkOf(0));
    drag(frame, [[x, y], [x + 0.06, y]]);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByRole('status')).toHaveTextContent('at most 200 strokes');
    expect(washed(root)[0]).toBeGreaterThan(0);
  });
});

describe('the author\'s pen strokes belong to their layer', () => {
  beforeEach(() => { layoutLines = TEXT_LINES; });
  /** A line no splat of the test's seeds covers, and a pen stroke along it, so only the pen covers it. */
  const penLine = (() => {
    const lines = TEXT_LINES;
    const box = { w: MAX_FRAME, h: TEXT_LINES * LINE_PX };
    const inks = SEEDS.map((seed) => new LayerInk(makeSplat(seed), [], box));
    for (let k = 0; k < lines - 3; k++) {
      const y = ((k + 0.5) * LINE_PX) / box.h;
      const y3 = ((k + 3.5) * LINE_PX) / box.h;
      const covered = (at: number) => coveredLines([{ top: at - 0.001, bottom: at + 0.001, text: '' }], inks)[0];
      if (!covered(y) && !covered(y3)) return k;
    }
    throw new Error('every line lies under some splat');
  })();
  const lineY = (line: number) => ((line + 0.5) * LINE_PX) / (TEXT_LINES * LINE_PX);
  const penAt = (line: number): Stroke => ({ tool: 'ink', color: COLORS[0]!, ...pen(), points: [[0, lineY(line)], [0.5, lineY(line)], [1, lineY(line)]] });
  const saved = (id: string, strokes: Stroke[]): Record<string, EffectState> => ({ [id]: { state: { strokes: strokes.map(packStroke) }, savedAt: '2026-10-29T22:00:00.000Z' } });
  const name = nameOfLine;

  test('a line under a pen stroke is hidden from a screen reader as from the eye, and one clear of it is read', () => {
    const plain = mount();
    expect(readout(plain.root)).toContain(name(penLine));
    plain.unmount();
    const { root } = mount({ states: saved('play-1', [penAt(penLine)]) });
    expect(readout(root)).not.toContain(name(penLine));
    expect(readout(root)).toContain(name(penLine + 3));
  });

  test('a reader\'s stroke over a pen stroke removes it on their screen, and the line is read', () => {
    const { frame, root, save } = mount({ states: saved('play-1', [penAt(penLine)]) });
    expect(readout(root)).not.toContain(name(penLine));
    /* A pass takes 1.5 of a field that is 1 under a pen line, so one clears the pen, but a splat's core on the same line takes several: the whole width, a few times over. */
    for (let pass = 0; pass < 6; pass++) drag(frame, [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1].map((x): [number, number] => [x, lineY(penLine)]));
    expect(readout(root)).toContain(name(penLine));
    expect(save).not.toHaveBeenCalled();
  });

  test('a pen stroke on layer 2 is under layer 3\'s ink: a stroke where both are scrubs layer 3', () => {
    const top = inkOf(2);
    const [x, y] = inkSpot(top);
    const written: Stroke = { tool: 'ink', color: COLORS[1]!, ...pen(), points: [[x - 0.05, y], [x + 0.05, y]] };
    const { frame, root } = mount({ layers: 3, states: saved('play-2', [written]) });
    const before = washed(root);
    drag(frame, [[x, y], [x + 0.02, y]]);
    expect(washed(root)[2]).toBeGreaterThan(before[2]!);
    expect(washed(root)[1]).toBe(before[1]);
  });

  test('"Hold to scrub" clears a pen stroke past the splat, and the line under it is read once it has', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    /* Washed to the whole, so the layer is not clean while any ink, the pen's included, is left. */
    const { root } = mount({ clean: 100, states: saved('play-1', [penAt(penLine)]) });
    expect(readout(root)).not.toContain(name(penLine));
    const button = screen.getByRole('button', { name: 'Hold to scrub' });
    act(() => { fireEvent.keyDown(button, { key: ' ' }); });
    act(() => { vi.advanceTimersByTime(120_000); });
    act(() => { fireEvent.keyUp(button, { key: ' ' }); });
    /* Nothing is under ink: the words are plain on the page for a screen reader, with no hidden copy. */
    expect(root.querySelector('[data-kb-whoops-layout]')).not.toHaveAttribute('inert');
    expect(root.querySelector('[data-kb-whoops-layout]')).toHaveTextContent(name(penLine));
    expect(readout(root)).toBe('');
  }, 60_000);

  test('a reader\'s scrub of the author\'s pen is not saved, and the author\'s own is', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { frame, save } = mount({ author: true, states: saved('play-1', [penAt(penLine)]) });
    const y = lineY(penLine);
    drag(frame, [[0.1, y], [0.5, y], [0.9, y]]);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    const [play, state] = save.mock.calls[0]!;
    expect(play).toBe('play-1');
    expect((state as { strokes: Stroke[] }).strokes.map((s) => s.tool)).toEqual(['ink', 'wash']);
  });
});

describe('the canvas', () => {
  test('a pen stroke is drawn on its own layer\'s canvases only: the layers are canvases of their own, so the ones above cover it and none lies over them all', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    (globalThis as { Path2D?: unknown }).Path2D ??= class {};
    const strokes = new Map<HTMLCanvasElement, string[]>();
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
      const state: Record<string, unknown> = {};
      return new Proxy({}, {
        get: (_t, key: string) => (key in state ? state[key] : (...args: unknown[]) => {
          if (key === 'stroke') strokes.set(this, [...(strokes.get(this) ?? []), String(state.strokeStyle)]);
          if (key === 'createImageData') return { width: args[0], height: args[1], data: new Uint8ClampedArray(Number(args[0]) * Number(args[1]) * 4) };
          return undefined;
        }),
        set: (_t, key: string, value) => { state[key] = value; return true; },
      });
    } as unknown as HTMLCanvasElement['getContext'];
    /* Builds are held, so the stand-in is what is drawn. */
    seam.client = { requestBuild: () => {}, cancel: () => {}, active: () => false, requester: () => 1, pace: () => 1 };
    const { root, frame } = mount({ layers: 2, author: true });
    fireEvent.click(screen.getByRole('button', { name: 'Write in ink' }));
    for (let k = 0; k < 4; k++) act(() => { vi.advanceTimersByTime(60); });
    const line: [number, number][] = [[0.03, 0.985], [0.08, 0.985], [0.13, 0.985]];
    act(() => { fireEvent.pointerDown(frame, { clientX: px(...line[0]!)[0], clientY: px(...line[0]!)[1], pointerId: 1, button: 0, pointerType: 'mouse' }); });
    act(() => { fireEvent.pointerMove(frame, { buttons: 1, clientX: px(...line[1]!)[0], clientY: px(...line[1]!)[1], pointerId: 1, pointerType: 'mouse' }); });
    act(() => { fireEvent.pointerUp(frame, { clientX: px(...line[1]!)[0], clientY: px(...line[1]!)[1], pointerId: 1, pointerType: 'mouse' }); });
    for (let k = 0; k < 4; k++) act(() => { vi.advanceTimersByTime(60); });
    const drawn = (layer: string) => [...root.querySelectorAll<HTMLCanvasElement>(`canvas.kb-whoops-ink[data-kb-layer="${layer}"]`)].flatMap((c) => strokes.get(c) ?? []);
    expect(new Set(drawn('1')), 'the top layer holds the pen, in its ink').toEqual(new Set([COLORS[1]]));
    expect(drawn('0'), 'the layer under it is not drawn on').toEqual([]);
  });
});

describe('the body\'s box', () => {
  const BESIDE = (onChip: () => void) => (
    <div data-kb-over-ink style={{ width: 'fit-content' }}><button type="button" onClick={onChip}>React</button></div>
  );
  /** Press, drag and lift on `target`, at shares of the box. */
  function press(target: HTMLElement, points: readonly (readonly [number, number])[], pointerType = 'mouse') {
    const [first, ...rest] = points.map(([x, y]) => px(x, y));
    const down = fireEvent.pointerDown(target, { clientX: first![0], clientY: first![1], pointerId: 1, button: 0, pointerType });
    for (const [x, y] of rest) act(() => { fireEvent.pointerMove(target, { buttons: 1, clientX: x, clientY: y, pointerId: 1, pointerType }); });
    const [lx, ly] = rest[rest.length - 1] ?? first!;
    act(() => { fireEvent.pointerUp(target, { clientX: lx, clientY: ly, pointerId: 1, pointerType }); });
    return down;
  }

  test('a press beside the reactions row, on ink, starts a stroke', () => {
    const { cell, root } = mount({ beside: BESIDE(() => {}) });
    const [x, y] = inkSpot(inkOf(0));
    press(cell, [[x, y], [x + 0.05, y], [x + 0.1, y]]);
    expect(washed(root)[0]).toBeGreaterThan(0);
  });

  test('a press on a chip inside [data-kb-over-ink] starts nothing, and the chip\'s click goes through', () => {
    const onChip = vi.fn();
    const { root } = mount({ beside: BESIDE(onChip) });
    const chip = screen.getByRole('button', { name: 'React' });
    const [x, y] = inkSpot(inkOf(0));
    expect(press(chip, [[x, y], [x + 0.05, y], [x + 0.1, y]]), 'the press is not prevented').toBe(true);
    expect(washed(root)[0]).toBe(0);
    fireEvent.click(chip);
    expect(onChip).toHaveBeenCalledTimes(1);
  });

  test('a stroke swallows the click that follows it, on the same element it was taken on', () => {
    const onChip = vi.fn();
    const { cell } = mount({ beside: BESIDE(onChip) });
    const [x, y] = inkSpot(inkOf(0));
    press(cell, [[x, y], [x + 0.05, y], [x + 0.1, y]]);
    const swallowed = fireEvent.click(screen.getByRole('button', { name: 'React' }));
    expect(swallowed, 'the click after a stroke is swallowed').toBe(false);
    expect(onChip).not.toHaveBeenCalled();
  });

  test('the cell\'s listeners are all taken off when the effect goes, and a press on the cell then washes nothing', () => {
    const { cell, unmount } = mount();
    const off = vi.spyOn(EventTarget.prototype, 'removeEventListener');
    unmount();
    const removedFromCell = new Set(off.mock.calls.filter((_, i) => off.mock.contexts[i] === cell).map((c) => c[0]));
    off.mockRestore();
    for (const kind of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'click']) {
      expect(removedFromCell.has(kind), kind).toBe(true);
    }
    const [x, y] = inkSpot(inkOf(0));
    expect(fireEvent.pointerDown(cell, { clientX: px(x, y)[0], clientY: px(x, y)[1], pointerId: 1, button: 0, pointerType: 'mouse' }), 'nothing takes the press').toBe(true);
  });

  test('a stroke under way when the effect goes is kept and saved, not lost', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { cell, save, unmount } = mount({ author: true });
    const [x, y] = inkSpot(inkOf(0));
    const [a, b] = [px(x, y), px(x + 0.06, y)];
    act(() => { fireEvent.pointerDown(cell, { clientX: a[0], clientY: a[1], pointerId: 1, button: 0, pointerType: 'mouse' }); });
    act(() => { fireEvent.pointerMove(cell, { buttons: 1, clientX: b[0], clientY: b[1], pointerId: 1, pointerType: 'mouse' }); });
    unmount();
    act(() => { vi.advanceTimersByTime(SAVE_AFTER_MS * 2); });
    expect(save).toHaveBeenCalledTimes(1);
    expect((save.mock.calls[0]![1] as { strokes: unknown[] }).strokes).toHaveLength(1);
  });

  test('when the words are moved out of the cell (Stick Around\'s view), the next render finds the frame\'s own surface; moved back, the cell again', () => {
    const { cell, frame, root, replay } = mount();
    const away = document.createElement('div');
    document.body.append(away);
    away.append(root);
    replay();
    const [x, y] = inkSpot(inkOf(0));
    const [a, b] = [px(x, y), px(x + 0.06, y)];
    const stroke = (target: HTMLElement, id: number, dy = 0) => {
      act(() => { fireEvent.pointerDown(target, { clientX: a[0], clientY: a[1] + dy, pointerId: id, button: 0, pointerType: 'mouse' }); });
      act(() => { fireEvent.pointerMove(target, { buttons: 1, clientX: b[0], clientY: b[1] + dy, pointerId: id, pointerType: 'mouse' }); });
      act(() => { fireEvent.pointerUp(target, { clientX: b[0], clientY: b[1] + dy, pointerId: id, pointerType: 'mouse' }); });
    };
    stroke(frame, 1);
    expect(washed(root)[0], 'the frame takes the press where it now lives').toBeGreaterThan(0);
    expect(cell.style.touchAction, 'the cell it left is let go').toBe('');
    cell.append(root);
    replay();
    const before = washed(root)[0]!;
    stroke(cell, 2, 6 * LINE_PX);
    expect(washed(root)[0], 'the cell takes it again').toBeGreaterThan(before);
    away.remove();
  });

  test('words moved out of the cell by a plain appendChild, with no render: the frame takes the press in its own box, and the cell it left takes nothing; moved back, the cell\'s gutter washes again', () => {
    const { cell, frame, root } = mount();
    const away = document.createElement('div');
    document.body.append(away);
    const moved: Box = { w: 600, h: 300 };
    frameBox = moved;
    away.append(root);
    /* The core is ink on the screen's old box as well as on the moved one: the press that finds the words moved is taken on the model as it stood. */
    const [x, y] = coreSpot(new LayerInk(splatFor(0), [], moved));
    const at = (b: Box, dx = 0) => ({ buttons: 1, clientX: (x + dx) * b.w, clientY: y * b.h, pointerId: 1, button: 0, pointerType: 'mouse' as const });
    /* The old cell is told nothing and does nothing. */
    expect(fireEvent.pointerDown(cell, at(moved)), 'the cell it left takes nothing').toBe(true);
    expect(washed(root)[0]).toBe(0);
    /* A pass takes some, and a core takes several. */
    const PASSES = 6;
    for (let pass = 0; pass < PASSES; pass++) {
      act(() => { fireEvent.pointerDown(frame, at(moved)); });
      act(() => { fireEvent.pointerMove(frame, at(moved, 0.06)); });
      act(() => { fireEvent.pointerUp(frame, at(moved, 0.06)); });
    }
    const canvas = root.querySelector('canvas.kb-whoops-suds') as HTMLCanvasElement;
    expect(washed(root)[0], 'the frame takes the press where it now lives').toBeGreaterThan(0);
    expect(canvas.width, 'in the frame\'s box, not the cell\'s').toBe(600);
    const expected = new LayerInk(splatFor(0), Array.from({ length: PASSES }, () => ({ tool: 'wash', ...brushOf(BRUSH_PX, moved), points: [[x, y], [x + 0.06, y]] }) as Stroke), moved).washed;
    expect(washed(root)[0]).toBeCloseTo(expected, 1);
    const before = washed(root)[0]!;
    /* Back in the cell by appendChild alone: a press in its gutter, outside the frame, washes again. */
    frameBox = null;
    cell.append(root);
    const [x2, y2] = coreSpot(inkOf(0));
    const gutter = (dx: number) => ({ buttons: 1, clientX: (x2 + dx) * boxNow().w, clientY: (y2 + 6 * LINE_PX / boxNow().h) * boxNow().h, pointerId: 2, button: 0, pointerType: 'mouse' as const });
    for (let pass = 0; pass < PASSES; pass++) {
      act(() => { fireEvent.pointerDown(cell, gutter(0)); });
      act(() => { fireEvent.pointerMove(cell, gutter(0.06)); });
      act(() => { fireEvent.pointerUp(cell, gutter(0.06)); });
    }
    expect(washed(root)[0], 'the cell takes it again').toBeGreaterThan(before);
    away.remove();
  });

  test('a press inside the frame while it is in the cell is taken once, not by the frame and the cell both', () => {
    const { frame, root } = mount();
    const [x, y] = inkSpot(inkOf(0));
    const [a, b] = [px(x, y), px(x + 0.06, y)];
    act(() => { fireEvent.pointerMove(frame, { buttons: 1, clientX: a[0], clientY: a[1], pointerId: 1, pointerType: 'mouse' }); });
    expect(vi.mocked(cursor.over), 'one move is read once').toHaveBeenCalledTimes(1);
    vi.mocked(cursor.over).mockClear();
    act(() => { fireEvent.pointerDown(frame, { clientX: a[0], clientY: a[1], pointerId: 1, button: 0, pointerType: 'mouse' }); });
    expect(vi.mocked(cursor.press), 'one press is taken once').toHaveBeenCalledTimes(1);
    act(() => { fireEvent.pointerMove(frame, { buttons: 1, clientX: b[0], clientY: b[1], pointerId: 1, pointerType: 'mouse' }); });
    expect(vi.mocked(suds.wash), 'one move throws its suds once').toHaveBeenCalledTimes(1);
    act(() => { fireEvent.pointerUp(frame, { clientX: b[0], clientY: b[1], pointerId: 1, pointerType: 'mouse' }); });
    expect(washed(root)[0]).toBeGreaterThan(0);
  });

  test('in the ORIGIN box the frame is the surface and the box', () => {
    const { frame, root } = mount({ place: 'origin' });
    const [x, y] = inkSpot(inkOf(0));
    press(frame, [[x, y], [x + 0.05, y]]);
    expect(washed(root)[0]).toBeGreaterThan(0);
  });

  test('pointer events of type touch are ignored, so a finger is never read twice', () => {
    const { cell, root } = mount();
    const [x, y] = inkSpot(inkOf(0));
    press(cell, [[x, y], [x + 0.05, y]], 'touch');
    expect(washed(root)[0]).toBe(0);
  });

  test('the cell keeps touch-action pan-y pinch-zoom while the effect is there (the frame\'s is its sheet\'s), and gets it back as it was when the effect goes', () => {
    const { cell, unmount } = mount();
    expect(cell.style.touchAction).toBe('pan-y pinch-zoom');
    unmount();
    expect(cell.style.touchAction).toBe('');
  });

  test('a tall body is drawn as softly as a short one: its ink canvases are a band tall at a point a pixel, never lowered to fit a whole-post canvas', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    vi.stubGlobal('devicePixelRatio', 2);
    seam.client = { requestBuild: () => {}, cancel: () => {}, active: () => false, requester: () => 1, pace: () => 1 };
    boxWidth = 390;
    boxHeight = 20_000;
    const { root } = mount();
    for (let k = 0; k < 4; k++) act(() => { vi.advanceTimersByTime(60); });
    const inks = [...root.querySelectorAll<HTMLCanvasElement>('canvas.kb-whoops-ink')];
    expect(inks.length, 'a band each of the 40 (no observer here: every band counts as near)').toBe(40);
    for (const canvas of inks.slice(0, 39)) expect([canvas.width, canvas.height]).toEqual([390, 512]);
    expect(inks.reduce((n, c) => n + c.width * c.height, 0), 'a point to the pixel, however tall').toBe(390 * 20_000);
  }, 60_000);

  test('the suds stay registered when the top ink changes mid-wash (a layer going clean): they are re-registered with the new ink, and let go only when the post goes', () => {
    const { frame, root, unmount } = mount({ layers: 2 });
    const before = vi.mocked(suds.register).mock.calls.at(-1)!;
    expect(before[4]).toBe(COLORS[1]);
    scrubTo(frame, root, 1, inkOf(1), 0.97);
    expect(states(root)[1]).toBe('clean');
    expect(vi.mocked(suds.register).mock.calls.at(-1)![4], 'the new top ink').toBe(COLORS[0]);
    expect(vi.mocked(suds.unregister)).not.toHaveBeenCalled();
    unmount();
    expect(vi.mocked(suds.unregister)).toHaveBeenCalledTimes(1);
  });

  test('the suds canvas is the box\'s size and place, over the ink, registered while the post is near with its box and density, and let go when it leaves', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const eyes = sight();
    const { root, unmount } = mount();
    for (let k = 0; k < 4; k++) act(() => { vi.advanceTimersByTime(60); });
    const inks = [...root.querySelectorAll<HTMLCanvasElement>('canvas.kb-whoops-ink')];
    const sud = root.querySelector<HTMLCanvasElement>('canvas.kb-whoops-suds')!;
    expect(inks.length).toBeGreaterThan(0);
    expect(sud).toHaveAttribute('data-kb-effect-ink');
    expect([sud.width, sud.height, sud.style.left, sud.style.top]).toEqual([boxNow().w, boxNow().h, inks[0]!.style.left, inks[0]!.style.top]);
    for (const ink of inks) expect(ink.compareDocumentPosition(sud) & Node.DOCUMENT_POSITION_FOLLOWING, 'the suds are over the ink').toBeTruthy();
    const last = vi.mocked(suds.register).mock.calls.at(-1)!;
    expect(last[1]).toBe(sud);
    expect(last[2]).toEqual(boxNow());
    expect(last[3]).toBe(1);
    const host = last[0];
    eyes.see(false);
    expect(vi.mocked(suds.unregister)).toHaveBeenCalledWith(host);
    eyes.see(true);
    expect(vi.mocked(suds.register).mock.calls.at(-1)![0]).toBe(host);
    unmount();
    expect(vi.mocked(suds.unregister).mock.calls.at(-1)![0]).toBe(host);
  });

  describe('the drawn cursor', () => {
    const over = vi.mocked(cursor.over);
    const move = (target: HTMLElement, at: readonly [number, number], pointerType = 'mouse') => act(() => { fireEvent.pointerMove(target, { buttons: 1, clientX: px(...at)[0], clientY: px(...at)[1], pointerId: 1, pointerType }); });
    const modes = () => over.mock.calls.map((c) => c[2]);

    test('is a sponge over ink a stroke would take, and nothing over bare margin', () => {
      const { cell } = mount();
      move(cell, inkSpot(inkOf(0)));
      expect(modes().at(-1)).toBe('sponge');
      expect(over.mock.calls.at(-1)![0]).toBe(cell);
      move(cell, [0.001, 0.001]);
      expect(modes().at(-1)).toBeNull();
    });

    test('is nothing inside [data-kb-over-ink], over ink or not', () => {
      mount({ beside: BESIDE(() => {}) });
      move(screen.getByRole('button', { name: 'React' }), inkSpot(inkOf(0)));
      expect(modes().at(-1)).toBeNull();
    });

    test('is the pen, in the top layer\'s ink, for the author writing in ink, and the sponge for their wash', () => {
      const { cell, shown } = mount({ author: true, layers: 2 });
      move(cell, inkSpot(inkOf(1)));
      expect(modes().at(-1)).toBe('sponge');
      act(() => (shown.at(-1)!.controls[1] as Extract<KitControl, { kind: 'choose' }>).choose('ink'));
      move(cell, [0.001, 0.001]);
      expect(over.mock.calls.at(-1)!.slice(2)).toEqual(['pen', COLORS[1]]);
    });

    test('is kept while a stroke is under way, and pressed and released with the pointer', () => {
      const { cell } = mount();
      const [x, y] = inkSpot(inkOf(0));
      act(() => { fireEvent.pointerDown(cell, { clientX: px(x, y)[0], clientY: px(x, y)[1], pointerId: 1, button: 0, pointerType: 'mouse' }); });
      expect(vi.mocked(cursor.press)).toHaveBeenLastCalledWith(true);
      move(cell, [0.001, 0.001]);
      expect(modes().at(-1), 'a stroke carried off the ink keeps the sponge').toBe('sponge');
      act(() => { fireEvent.pointerUp(cell, { clientX: 0, clientY: 0, pointerId: 1, pointerType: 'mouse' }); });
      expect(vi.mocked(cursor.press)).toHaveBeenLastCalledWith(false);
    });

    test('is given back when the pointer leaves, and when the effect goes', () => {
      const { cell, unmount } = mount();
      act(() => { fireEvent.pointerLeave(cell, { pointerType: 'mouse' }); });
      expect(vi.mocked(cursor.leave)).toHaveBeenCalledWith(cell);
      vi.mocked(cursor.leave).mockClear();
      unmount();
      expect(vi.mocked(cursor.leave)).toHaveBeenCalledWith(cell);
    });
  });
});

/*
 * A finger, by touch events (refinements design, section 6): a quick swipe up or down scrolls and washes nothing, a sideways swipe
 * wipes, a press held 180ms wipes in any direction, a tap washes a dab, and a second finger is the page's.
 */
describe('a finger', () => {
  const clock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  type Finger = { id: number; at: readonly [number, number] };
  /** A touch event as a browser sends it: the fingers down, and the ones that changed. Positions are px from the box's corner. */
  function touch(target: HTMLElement, type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel', down: readonly Finger[], changed: readonly Finger[]): boolean {
    const list = (fingers: readonly Finger[]) => fingers.map((f) => ({ identifier: f.id, clientX: f.at[0], clientY: f.at[1], target }));
    const event = new TouchEvent(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { touches: { value: list(down) }, targetTouches: { value: list(down) }, changedTouches: { value: list(changed) } });
    act(() => { target.dispatchEvent(event); });
    return event.defaultPrevented;
  }
  const at = (x: number, y: number): readonly [number, number] => px(x, y);
  const vibrate = vi.fn();
  beforeEach(() => { vibrate.mockClear(); Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate }); });
  afterEach(() => { delete (navigator as { vibrate?: unknown }).vibrate; });
  /** A finger on the splat's ink, and the same shifted by px. */
  const spot = () => px(...inkSpot(inkOf(0)));
  const shifted = (p: readonly [number, number], dx: number, dy: number): readonly [number, number] => [p[0] + dx, p[1] + dy];

  test('a finger tapping while a pen stroke is live is refused, as a second mouse press is: nothing throws and the pen stroke completes and saves', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => { errors.push(e.error ?? e.message); e.preventDefault(); };
    window.addEventListener('error', onError);
    try {
      const { frame, cell, save } = mount({ author: true });
      fireEvent.click(screen.getByRole('button', { name: 'Write in ink' }));
      const line: [number, number][] = [[0.03, 0.985], [0.08, 0.985], [0.13, 0.985]];
      const [first, ...rest] = line.map(([x, y]) => px(x, y));
      act(() => { fireEvent.pointerDown(frame, { clientX: first![0], clientY: first![1], pointerId: 1, button: 0, pointerType: 'mouse' }); });
      act(() => { fireEvent.pointerMove(frame, { buttons: 1, clientX: rest[0]![0], clientY: rest[0]![1], pointerId: 1, pointerType: 'mouse' }); });
      /* A finger taps while the pen is down: the pen's stroke is the one live, and stays so. */
      const tap = px(0.5, 0.5);
      touch(cell, 'touchstart', [{ id: 7, at: tap }], [{ id: 7, at: tap }]);
      touch(cell, 'touchend', [], [{ id: 7, at: tap }]);
      act(() => { fireEvent.pointerMove(frame, { buttons: 1, clientX: rest[1]![0], clientY: rest[1]![1], pointerId: 1, pointerType: 'mouse' }); });
      act(() => { fireEvent.pointerUp(frame, { clientX: rest[1]![0], clientY: rest[1]![1], pointerId: 1, pointerType: 'mouse' }); });
      expect(errors, 'no handler threw').toEqual([]);
      await settle(SAVE_AFTER_MS);
      expect(save).toHaveBeenCalledTimes(1);
      const strokes = savedOf(save.mock.calls[0]![1]).strokes;
      expect(strokes.map((s) => s.tool), 'the pen stroke, and no wash from the tap').toEqual(['ink']);
      expect(strokes[0]!.points.length, 'the pen stroke carried on to its end').toBeGreaterThanOrEqual(2);
    } finally {
      window.removeEventListener('error', onError);
    }
  });

  test('a quick vertical swipe from ink washes nothing, and its touchmove is not prevented', () => {
    clock();
    const { cell, root } = mount();
    const p0 = spot();
    touch(cell, 'touchstart', [{ id: 1, at: p0 }], [{ id: 1, at: p0 }]);
    const p1 = shifted(p0, 2, 24);
    expect(touch(cell, 'touchmove', [{ id: 1, at: p1 }], [{ id: 1, at: p1 }]), 'the page keeps its scroll').toBe(false);
    const p2 = shifted(p0, 3, 60);
    expect(touch(cell, 'touchmove', [{ id: 1, at: p2 }], [{ id: 1, at: p2 }])).toBe(false);
    act(() => { vi.advanceTimersByTime(400); });
    touch(cell, 'touchend', [], [{ id: 1, at: p2 }]);
    expect(washed(root)[0], 'no dab is left where the swipe began').toBe(0);
    expect(vi.mocked(suds.puff)).not.toHaveBeenCalled();
  });

  test('a sideways swipe washes, and its later touchmoves are prevented', () => {
    clock();
    const { cell, root } = mount();
    const p0 = spot();
    touch(cell, 'touchstart', [{ id: 1, at: p0 }], [{ id: 1, at: p0 }]);
    for (const dx of [20, 40, 60]) {
      const p = shifted(p0, dx, 3);
      expect(touch(cell, 'touchmove', [{ id: 1, at: p }], [{ id: 1, at: p }]), `a move ${dx}px along`).toBe(true);
    }
    /* Once wiping, any direction: a vertical move is prevented too. */
    const down = shifted(p0, 60, 70);
    expect(touch(cell, 'touchmove', [{ id: 1, at: down }], [{ id: 1, at: down }])).toBe(true);
    touch(cell, 'touchend', [], [{ id: 1, at: down }]);
    expect(washed(root)[0]).toBeGreaterThan(0);
    expect(vi.mocked(suds.wash)).toHaveBeenCalled();
  });

  test('a wipe reaching the share clears while the finger is still down, without waiting for it to lift', () => {
    clock();
    const { cell, root } = mount({ clean: 40 });
    const path = scrubPath(inkOf(0), 0.5).map(([x, y]) => px(x, y));
    const p0 = path[0]!;
    touch(cell, 'touchstart', [{ id: 1, at: p0 }], [{ id: 1, at: p0 }]);
    act(() => { vi.advanceTimersByTime(200); });
    for (const p of path.slice(1)) touch(cell, 'touchmove', [{ id: 1, at: p }], [{ id: 1, at: p }]);
    expect(states(root), 'clean before the finger lifts').toEqual(['clean']);
    touch(cell, 'touchend', [], [{ id: 1, at: path[path.length - 1]! }]);
    expect(states(root)).toEqual(['clean']);
  });

  test('a hold of 180ms, then a vertical drag, washes, its touchmoves are prevented, and the puff is thrown', () => {
    clock();
    const { cell, root } = mount();
    const p0 = spot();
    touch(cell, 'touchstart', [{ id: 1, at: p0 }], [{ id: 1, at: p0 }]);
    act(() => { vi.advanceTimersByTime(179); });
    expect(vi.mocked(suds.puff)).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(vi.mocked(suds.puff)).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(8);
    for (const dy of [10, 30, 50]) {
      const p = shifted(p0, 0, dy);
      expect(touch(cell, 'touchmove', [{ id: 1, at: p }], [{ id: 1, at: p }]), `a move ${dy}px down`).toBe(true);
    }
    touch(cell, 'touchend', [], [{ id: 1, at: shifted(p0, 0, 50) }]);
    expect(washed(root)[0]).toBeGreaterThan(0);
  });

  test('a device that refuses to vibrate does not stop the hold', () => {
    clock();
    vibrate.mockImplementation(() => { throw new Error('not allowed'); });
    const { cell, root } = mount();
    const p0 = spot();
    touch(cell, 'touchstart', [{ id: 1, at: p0 }], [{ id: 1, at: p0 }]);
    act(() => { vi.advanceTimersByTime(180); });
    const p = shifted(p0, 0, 30);
    expect(touch(cell, 'touchmove', [{ id: 1, at: p }], [{ id: 1, at: p }])).toBe(true);
    touch(cell, 'touchend', [], [{ id: 1, at: p }]);
    expect(washed(root)[0]).toBeGreaterThan(0);
  });

  test('a tap washes one dab, and the click that follows is swallowed', () => {
    clock();
    const { cell, root } = mount({ beside: <button type="button">React</button> });
    const p0 = spot();
    touch(cell, 'touchstart', [{ id: 1, at: p0 }], [{ id: 1, at: p0 }]);
    act(() => { vi.advanceTimersByTime(60); });
    touch(cell, 'touchend', [], [{ id: 1, at: p0 }]);
    const [x, y] = inkSpot(inkOf(0));
    expect(washed(root)[0]).toBeCloseTo(inkOf(0, [washStroke([[x, y]])]).washed, 3);
    expect(washed(root)[0]).toBeGreaterThan(0);
    expect(fireEvent.click(cell)).toBe(false);
  });

  test('a touch the browser cancels leaves no click to swallow: the next click on the cell goes through', () => {
    clock();
    const { cell } = mount({ beside: <button type="button">React</button> });
    const chip = screen.getByRole('button', { name: 'React' });
    const p0 = spot();
    touch(cell, 'touchstart', [{ id: 1, at: p0 }], [{ id: 1, at: p0 }]);
    touch(cell, 'touchcancel', [], [{ id: 1, at: p0 }]);
    expect(fireEvent.click(chip), 'a cancel while waiting').toBe(true);
    touch(cell, 'touchstart', [{ id: 1, at: p0 }], [{ id: 1, at: p0 }]);
    act(() => { vi.advanceTimersByTime(180); });
    const p1 = shifted(p0, 0, 40);
    touch(cell, 'touchmove', [{ id: 1, at: p1 }], [{ id: 1, at: p1 }]);
    touch(cell, 'touchcancel', [], [{ id: 1, at: p1 }]);
    expect(fireEvent.click(chip), 'a cancel mid-wipe').toBe(true);
  });

  test('the click a touch end asks to swallow does not linger: a click long after goes through', () => {
    clock();
    const { cell } = mount({ beside: <button type="button">React</button> });
    const p0 = spot();
    touch(cell, 'touchstart', [{ id: 1, at: p0 }], [{ id: 1, at: p0 }]);
    touch(cell, 'touchend', [], [{ id: 1, at: p0 }]);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(fireEvent.click(screen.getByRole('button', { name: 'React' }))).toBe(true);
  });

  test('the hold timer is cleared by a touch end: no puff or buzz follows a quick tap', () => {
    clock();
    const { cell } = mount();
    const p0 = spot();
    touch(cell, 'touchstart', [{ id: 1, at: p0 }], [{ id: 1, at: p0 }]);
    touch(cell, 'touchend', [], [{ id: 1, at: p0 }]);
    act(() => { vi.advanceTimersByTime(200); });
    expect(vi.mocked(suds.puff)).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
  });

  test('a second finger is the page\'s: it stops the wipe where it got to', () => {
    clock();
    const { cell, root } = mount();
    const p0 = spot();
    touch(cell, 'touchstart', [{ id: 1, at: p0 }], [{ id: 1, at: p0 }]);
    const p1 = shifted(p0, 30, 0);
    expect(touch(cell, 'touchmove', [{ id: 1, at: p1 }], [{ id: 1, at: p1 }])).toBe(true);
    const second = shifted(p0, 0, 200);
    touch(cell, 'touchstart', [{ id: 1, at: p1 }, { id: 2, at: second }], [{ id: 2, at: second }]);
    const gotTo = washed(root)[0]!;
    expect(gotTo, 'the stroke so far is kept').toBeGreaterThan(0);
    const p2 = shifted(p0, 90, 0);
    expect(touch(cell, 'touchmove', [{ id: 1, at: p2 }, { id: 2, at: second }], [{ id: 1, at: p2 }]), 'the scroll or pinch is the page\'s').toBe(false);
    expect(washed(root)[0]).toBe(gotTo);
    touch(cell, 'touchend', [{ id: 2, at: second }], [{ id: 1, at: p2 }]);
    touch(cell, 'touchend', [], [{ id: 2, at: second }]);
    expect(washed(root)[0]).toBe(gotTo);
  });

  test('a press that starts where there is no ink is the page\'s, held or not', () => {
    clock();
    const { cell, root } = mount();
    const p0 = at(0.001, 0.001);
    touch(cell, 'touchstart', [{ id: 1, at: p0 }], [{ id: 1, at: p0 }]);
    act(() => { vi.advanceTimersByTime(300); });
    const p1 = shifted(p0, 40, 0);
    expect(touch(cell, 'touchmove', [{ id: 1, at: p1 }], [{ id: 1, at: p1 }])).toBe(false);
    expect(washed(root)[0]).toBe(0);
    expect(vi.mocked(suds.puff)).not.toHaveBeenCalled();
  });

  test('a press on a chip inside [data-kb-over-ink] is the chip\'s', () => {
    clock();
    const { root } = mount({ beside: <div data-kb-over-ink><button type="button">React</button></div> });
    const chip = screen.getByRole('button', { name: 'React' });
    const p0 = spot();
    touch(chip, 'touchstart', [{ id: 1, at: p0 }], [{ id: 1, at: p0 }]);
    act(() => { vi.advanceTimersByTime(300); });
    const p1 = shifted(p0, 0, 40);
    expect(touch(chip, 'touchmove', [{ id: 1, at: p1 }], [{ id: 1, at: p1 }])).toBe(false);
    touch(chip, 'touchend', [], [{ id: 1, at: p1 }]);
    expect(washed(root)[0]).toBe(0);
  });

  test('under reduced motion the hold still grabs, with no puff', () => {
    clock();
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    const { cell, root } = mount();
    const p0 = spot();
    touch(cell, 'touchstart', [{ id: 1, at: p0 }], [{ id: 1, at: p0 }]);
    act(() => { vi.advanceTimersByTime(180); });
    expect(vi.mocked(suds.puff)).not.toHaveBeenCalled();
    const p1 = shifted(p0, 0, 40);
    expect(touch(cell, 'touchmove', [{ id: 1, at: p1 }], [{ id: 1, at: p1 }])).toBe(true);
    touch(cell, 'touchend', [], [{ id: 1, at: p1 }]);
    expect(washed(root)[0]).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ the quality review ---- */

const SAVED_AT = '2026-10-29T22:00:00.000Z';
const settle = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const authorClock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
/** The three strokes a test makes, each on a row of its own, so none is a duplicate of another. */
const rows = () => {
  const [x, y] = inkSpot(inkOf(0));
  return [0, 1, 2].map((k): [number, number][] => [[x, y + k * 0.05], [x + 0.06, y + k * 0.05], [x + 0.12, y + k * 0.05]]);
};

/** A save the test answers by hand: the calls that are on their way, and the most that were on their way at once. */
function gated() {
  const calls: { play: string; state: Record<string, unknown>; answer: (a: unknown) => void }[] = [];
  const flight = { now: 0, most: 0 };
  const heard: { current: (next: Record<string, EffectState>) => void } = { current: () => {} };
  const save = vi.fn((play: string, state: Record<string, unknown>) => new Promise((resolve) => {
    flight.now++;
    flight.most = Math.max(flight.most, flight.now);
    calls.push({ play, state, answer: (a) => { flight.now--; resolve(a); } });
  }));
  /* The answer the server gives, and the state it then holds for everyone, this screen's own included. */
  const accept = async (k: number) => {
    const call = calls[k]!;
    await act(async () => {
      call.answer({ ok: true, value: { play: call.play, savedAt: SAVED_AT } });
      heard.current({ [call.play]: { state: call.state, savedAt: SAVED_AT } });
    });
  };
  return { save: save as unknown as EffectProps['save'], calls, flight, heard, accept };
}

describe('saving, one at a time', () => {
  test('a save slower than the debounce is not overlapped: every stroke is saved, and the last state saved is the newest', async () => {
    authorClock();
    const net = gated();
    const [a, b, c] = rows();
    const { frame, hear } = mount({ author: true, save: net.save });
    net.heard.current = hear;
    drag(frame, a!);
    await settle(SAVE_AFTER_MS);
    expect(net.calls).toHaveLength(1);
    /* The first save is still on its way when the author strokes again, and the debounce runs out twice over. */
    drag(frame, b!);
    await settle(SAVE_AFTER_MS * 2);
    drag(frame, c!);
    await settle(SAVE_AFTER_MS * 2);
    expect(net.calls, 'nothing more is sent while a save is on its way').toHaveLength(1);
    await net.accept(0);
    await settle(SAVE_AFTER_MS * 2);
    expect(net.calls).toHaveLength(2);
    await net.accept(1);
    await settle(SAVE_AFTER_MS * 4);
    expect(net.flight.most).toBe(1);
    expect(net.calls, 'and nothing is left to save').toHaveLength(2);
    const last = net.calls.at(-1)!.state as { strokes: { points: string }[] };
    expect(last.strokes).toHaveLength(3);
    expect(last.strokes.map((s) => decodePoints(s.points)![0]![1])).toEqual([a, b, c].map((r) => Math.round(r![0]![1] * 10_000) / 10_000));
  });

  test('the saved state heard before the save is answered holds the stroke the save carried: the layer is built with it once, not twice', async () => {
    authorClock();
    const net = gated();
    const [x, y] = inkSpot(inkOf(0));
    const line: [number, number][] = [[x, y], [x + 0.03, y], [x + 0.05, y]];
    const { frame, root, hear, edit } = mount({ author: true, save: net.save });
    drag(frame, line);
    const once = inkOf(0, [washStroke(line)]).washed;
    const twice = inkOf(0, [washStroke(line), washStroke(line)]).washed;
    expect(twice, 'the premise: a second wash over the same line takes more').toBeGreaterThan(once + 0.001);
    expect(washed(root)[0]).toBeCloseTo(once, 3);
    await settle(SAVE_AFTER_MS);
    expect(net.calls).toHaveLength(1);
    /* The server's state reaches this screen (another channel than the answer) before the answer does; the page may also have settled a little, so the layer is built again, not taken as the echo (the engine draws the post's plays again with the news). */
    await act(async () => { edit(); hear({ [net.calls[0]!.play]: { state: net.calls[0]!.state, savedAt: SAVED_AT } }); });
    expect(washed(root)[0], 'the stroke the save carried is in the saved state and is not added again from the ones kept').toBeCloseTo(once, 3);
    await net.accept(0);
    expect(washed(root)[0]).toBeCloseTo(once, 3);
  });

  test('a scrub back and forth in one drag is saved pass for pass: the saved state washes the layer as far as the author\'s own screen did', async () => {
    authorClock();
    const { frame, root, save } = mount({ author: true });
    const [x, y] = coreSpot(inkOf(0));
    /* Three times there and back along one row, with points between the turns, as a hand scrubbing a stubborn core does. */
    const leg = (from: number, to: number): [number, number][] => Array.from({ length: 7 }, (_, k): [number, number] => [from + ((to - from) * (k + 1)) / 7, y]);
    const path: [number, number][] = [[x, y]];
    for (let trip = 0; trip < 3; trip++) path.push(...leg(x, x + 0.12), ...leg(x + 0.12, x));
    drag(frame, path);
    const onScreen = washed(root)[0]!;
    const onePass = inkOf(0, [washStroke([[x, y], [x + 0.12, y]])]).washed;
    expect(onScreen, 'the premise: six passes wash cells that one does not').toBeGreaterThan(onePass + 0.002);
    await settle(SAVE_AFTER_MS);
    expect(save).toHaveBeenCalledTimes(1);
    const sent = savedOf(save.mock.calls[0]![1]).strokes;
    /* The saved points are simplified within a quarter of the brush, so the share they wash is the screen's to within a tenth of it. */
    expect(Math.abs(inkOf(0, sent).washed - onScreen), 'every pass is in what was saved, not one pass for the six').toBeLessThan(onScreen * 0.1);
  });

  test('strokes made while a save is on its way are sent after it, not lost with the ones it carried', async () => {
    authorClock();
    const net = gated();
    const [a, b, c] = rows();
    const { frame, hear } = mount({ author: true, save: net.save });
    net.heard.current = hear;
    drag(frame, a!);
    await settle(SAVE_AFTER_MS);
    drag(frame, b!);
    await settle(SAVE_AFTER_MS);
    await net.accept(0);
    drag(frame, c!);
    await settle(SAVE_AFTER_MS * 2);
    await net.accept(1);
    await settle(SAVE_AFTER_MS * 4);
    expect(net.calls).toHaveLength(2);
    expect((net.calls.at(-1)!.state as { strokes: unknown[] }).strokes).toHaveLength(3);
  });
});

/* #86: the author leaves the post while a save is on its way; the strokes made since are sent once it answers, never dropped. */
describe('leaving the post mid-save', () => {
  test('the strokes made while a save was on its way are sent after it answers, though the post has gone', async () => {
    authorClock();
    const net = gated();
    const [a, b] = rows();
    const { frame, unmount } = mount({ author: true, save: net.save });
    drag(frame, a!);
    await settle(SAVE_AFTER_MS);
    expect(net.calls).toHaveLength(1);
    drag(frame, b!);
    unmount();
    await act(async () => { net.calls[0]!.answer({ ok: true, value: { play: net.calls[0]!.play, savedAt: SAVED_AT } }); });
    await settle(SAVE_AFTER_MS * 4);
    expect(net.calls).toHaveLength(2);
    expect((net.calls[1]!.state as { strokes: unknown[] }).strokes).toHaveLength(2);
    await act(async () => { net.calls[1]!.answer({ ok: true, value: { play: net.calls[1]!.play, savedAt: SAVED_AT } }); });
    await settle(SAVE_AFTER_MS * 4);
    expect(net.calls, 'and nothing is sent twice').toHaveLength(2);
  });
});

describe('a save that did not get through', () => {
  const lost = { ok: false as const, error: LOST_ANSWER, uncertain: true as const };

  test('is sent again after a backoff, so a clean mark that failed reaches everyone, with no stroke after it', async () => {
    authorClock();
    const answers = [lost, lost];
    const save = vi.fn(async (play: string) => answers.shift() ?? { ok: true as const, value: { play, savedAt: SAVED_AT } });
    const { frame, root } = mount({ author: true, clean: 40, save: save as unknown as EffectProps['save'] });
    scrubTo(frame, root, 0, inkOf(0), 0.5);
    await settle(SAVE_AFTER_MS);
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(LOST_ANSWER);
    await settle(RETRY_AFTER_MS - 1);
    expect(save).toHaveBeenCalledTimes(1);
    await settle(1);
    expect(save).toHaveBeenCalledTimes(2);
    /* The backoff doubles. */
    await settle(RETRY_AFTER_MS);
    expect(save).toHaveBeenCalledTimes(2);
    await settle(RETRY_AFTER_MS);
    expect(save).toHaveBeenCalledTimes(3);
    expect((save.mock.calls.at(-1) as unknown as [string, { clean?: boolean }])[1].clean).toBe(true);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    await settle(RETRY_AFTER_MS * 100);
    expect(save).toHaveBeenCalledTimes(3);
  });

  test('is sent again when the call itself threw', async () => {
    authorClock();
    const save = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementation(async (play: string) => ({ ok: true as const, value: { play, savedAt: SAVED_AT } }));
    const { frame } = mount({ author: true, save: save as unknown as EffectProps['save'] });
    drag(frame, rows()[0]!);
    await settle(SAVE_AFTER_MS + RETRY_AFTER_MS);
    expect(save).toHaveBeenCalledTimes(2);
  });

  test('is retried a bounded number of times, then left to the next stroke', async () => {
    authorClock();
    const save = vi.fn(async () => lost);
    const { frame } = mount({ author: true, save: save as unknown as EffectProps['save'] });
    drag(frame, rows()[0]!);
    await settle(SAVE_AFTER_MS + RETRY_AFTER_MS * 2 ** (MAX_SAVE_RETRIES + 2));
    expect(save).toHaveBeenCalledTimes(1 + MAX_SAVE_RETRIES);
    drag(frame, rows()[1]!);
    await settle(SAVE_AFTER_MS);
    expect(save).toHaveBeenCalledTimes(2 + MAX_SAVE_RETRIES);
  });

  test('is not sent again when the card refused it: the refusal is shown, and a retry would only be refused again', async () => {
    authorClock();
    const save = vi.fn(async () => ({ ok: false as const, error: 'at most 200 strokes' }));
    const { frame } = mount({ author: true, save: save as unknown as EffectProps['save'] });
    drag(frame, rows()[0]!);
    await settle(SAVE_AFTER_MS + RETRY_AFTER_MS * 100);
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('at most 200 strokes');
  });
});

describe('the debounce', () => {
  test('two strokes 700ms apart are one save', async () => {
    authorClock();
    const [a, b] = rows();
    const { frame, save } = mount({ author: true });
    drag(frame, a!);
    await settle(700);
    drag(frame, b!);
    await settle(SAVE_AFTER_MS * 3);
    expect(save).toHaveBeenCalledTimes(1);
    expect((save.mock.calls[0]![1] as { strokes: unknown[] }).strokes).toHaveLength(2);
  });

  test('two strokes 900ms apart are two', async () => {
    authorClock();
    const [a, b] = rows();
    const { frame, save } = mount({ author: true });
    drag(frame, a!);
    await settle(900);
    drag(frame, b!);
    await settle(SAVE_AFTER_MS * 3);
    expect(save).toHaveBeenCalledTimes(2);
  });
});

describe('what stays on a reader\'s screen', () => {
  test('a reader\'s strokes, and a reader reaching clean, send nothing, however long they wait', async () => {
    authorClock();
    const [a] = rows();
    const stroked = mount();
    drag(stroked.frame, a!);
    await settle(10_000);
    expect(stroked.save).not.toHaveBeenCalled();
    stroked.unmount();
    const reaching = mount({ clean: 40 });
    scrubTo(reaching.frame, reaching.root, 0, inkOf(0), 0.5);
    expect(states(reaching.root)).toEqual(['clean']);
    await settle(10_000);
    expect(reaching.save).not.toHaveBeenCalled();
    reaching.unmount();
  });
});

describe('the share that counts as clean', () => {
  /** Scrub one row at a time, noting the share washed and whether the layer was clean after each. */
  function scrubWatching(o: { clean?: number | null }) {
    const { frame, root, save } = mount({ ...o, author: false });
    const ink = inkOf(0);
    const seen: { share: number; clean: boolean }[] = [];
    const b = brush();
    for (let y = 0; y <= 1 && states(root)[0] === 'live'; y += (BRUSH_PX * 0.2) / boxNow().h) {
      const row = rowAcross(ink, y);
      if (row.length < 2) continue;
      drag(frame, row);
      washOn(ink, row, b);
      seen.push({ share: washed(root)[0]!, clean: states(root)[0] === 'clean' });
    }
    return { seen, save };
  }

  test('with no setting the layer is clean at 95 percent washed, and not before', () => {
    const { seen } = scrubWatching({ clean: null });
    const before = seen.filter((s) => s.share < 0.949);
    expect(before.length).toBeGreaterThan(3);
    expect(before.every((s) => !s.clean)).toBe(true);
    const last = seen.at(-1)!;
    expect(last.clean).toBe(true);
    expect(last.share).toBeGreaterThanOrEqual(0.95);
  });

  test('a layer just under the share stays live, and one at it goes clean', () => {
    /* The same strokes, three times: the share they reach, then the share a hair above it, then the share itself. */
    const reach = (clean: number) => {
      const { frame, root } = mount({ clean });
      const ink = inkOf(0);
      let share = 0;
      /* A pass takes some, so the rows are gone over again until the share is reached (the model's rows follow what is left). */
      for (let pass = 0; pass < MOST_PASSES && share < 0.5 && states(root)[0] === 'live'; pass++) {
        for (let y = 0; y <= 1 && share < 0.5 && states(root)[0] === 'live'; y += (BRUSH_PX * 0.7) / boxNow().h) {
          const row = rowAcross(ink, y);
          if (row.length >= 2) { drag(frame, row); washOn(ink, row, brush()); share = washed(root)[0]!; }
        }
      }
      return { state: states(root)[0], root };
    };
    const probe = reach(100);
    expect(probe.state).toBe('live');
    /* The unrounded share, as the ink holds it: read it back from a rebuild of the same strokes. */
    const mirror = inkOf(0);
    let share = 0;
    for (let pass = 0; pass < MOST_PASSES && share < 0.5; pass++) {
      for (let y = 0; y <= 1 && share < 0.5; y += (BRUSH_PX * 0.7) / boxNow().h) {
        const row = rowAcross(mirror, y);
        if (row.length >= 2) { washOn(mirror, row, brush()); share = mirror.washed; }
      }
    }
    expect(reach(share * 100 * (1 + 1e-6)).state, 'a hair under the share').toBe('live');
    expect(reach(share * 100).state, 'at the share').toBe('clean');
  });
});

describe('what a post costs a page', () => {
  const stubObserver = () => {
    const watchers: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
    vi.stubGlobal('IntersectionObserver', class {
      constructor(watch: (entries: { isIntersecting: boolean }[]) => void) { watchers.push(watch); }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    return (isIntersecting: boolean) => act(() => { watchers.forEach((w) => w([{ isIntersecting }])); });
  };
  const canvases = (root: HTMLElement) => root.querySelectorAll('canvas');

  test('the suds\' pixel density is capped at two, and the ink\'s at one', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    vi.stubGlobal('devicePixelRatio', 3);
    const { root } = mount();
    for (let k = 0; k < 4; k++) act(() => { vi.advanceTimersByTime(60); });
    expect((root.querySelector<HTMLCanvasElement>("canvas.kb-whoops-suds"))!.width).toBe(MAX_FRAME * 2);
    expect(root.querySelector<HTMLCanvasElement>('canvas.kb-whoops-ink')!.width, 'the ink is a point to the CSS px at most').toBe(MAX_FRAME);
  });

  test('below the cap the suds\' density is the screen\'s own, and the ink\'s too, below one', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    vi.stubGlobal('devicePixelRatio', 1.5);
    expect(mount().root.querySelector<HTMLCanvasElement>('canvas.kb-whoops-suds')!.width).toBe(MAX_FRAME * 1.5);
    vi.stubGlobal('devicePixelRatio', 0.5);
    const { root } = mount();
    for (let k = 0; k < 4; k++) act(() => { vi.advanceTimersByTime(60); });
    const first = root.querySelector<HTMLCanvasElement>('canvas.kb-whoops-ink')!;
    expect([first.width, first.height], 'a band of 256 points is 512 CSS px').toEqual([MAX_FRAME / 2, 256]);
    expect(parseFloat(first.style.height), 'stretched to fill the box, as the lattice has 338 rows for 675 px').toBeCloseTo((256 * 675) / 338, 5);
  });

  test('a post not near the viewport draws no canvas, and one that comes near draws them, hidden from a screen reader', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const eyes = sight({ post: false });
    const { root } = mount();
    expect(canvases(root)).toHaveLength(0);
    eyes.see(true);
    for (let k = 0; k < 4; k++) act(() => { vi.advanceTimersByTime(60); });
    /* The ink, a canvas for each of the two bands, and the suds over it. */
    expect(canvases(root)).toHaveLength(3);
    for (const canvas of canvases(root)) expect(canvas).toHaveAttribute('aria-hidden', 'true');
    eyes.see(false);
    expect(canvases(root)).toHaveLength(0);
  });

  test('a post that leaves the viewport lets go of its ink grids, keeps the author\'s unsaved strokes, and builds the grids again on its return', () => {
    authorClock();
    const see = stubObserver();
    const { root, frame } = mount({ author: true });
    see(true);
    expect(root.dataset.kbHeld).toBe('1');
    drag(frame, rows()[0]!);
    const kept = washed(root)[0]!;
    expect(kept).toBeGreaterThan(0);
    see(false);
    expect(root.dataset.kbHeld, 'the grids are let go').toBe('0');
    const before = built.grids;
    see(true);
    expect(root.dataset.kbHeld).toBe('1');
    expect(built.grids).toBe(before + 1);
    expect(washed(root)[0]).toBe(kept);
  });

  test('a saved state that is the echo of the author\'s own save does not rebuild the grids, and another device\'s does', async () => {
    authorClock();
    const net = gated();
    const { frame, hear } = mount({ author: true, save: net.save });
    net.heard.current = hear;
    drag(frame, rows()[0]!);
    await settle(SAVE_AFTER_MS);
    const before = built.grids;
    await net.accept(0);
    expect(built.grids, 'the echo of what was just sent').toBe(before);
    hear({ 'play-1': { state: { strokes: [packStroke({ tool: 'wash', ...brush(), points: [[0.5, 0.5]] })] }, savedAt: SAVED_AT } });
    expect(built.grids, 'a state from somewhere else').toBe(before + 1);
  });
});

/* #89 P2-1: what the effect says (the save's report, a line uncovered) is written into a polite region already on the page. */
describe('what the effect says to a screen reader', () => {
  test('the report is written into a region that was on the page, empty, before it spoke', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const full: Stroke[] = Array.from({ length: STROKES.most }, () => ({ tool: 'wash', ...brush(), points: [[0.01, 0.01], [0.02, 0.01]] }));
    const { frame, root } = mount({ author: true, clean: 40, states: { 'play-1': { state: { strokes: full.map(packStroke) }, savedAt: '2026-10-29T22:00:00.000Z' } } });
    const region = root.querySelector<HTMLElement>('[data-kb-report]');
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveTextContent('');
    const [x, y] = inkSpot(inkOf(0, full));
    drag(frame, [[x, y], [x + 0.06, y]]);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(region).toHaveTextContent('This layer has no room for more strokes to save.');
    expect(root.querySelector('[data-kb-report]')).toBe(region);
  });

  test('a line uncovered is said in a polite region that was on the page, empty, before it; the lines readable before are not said', () => {
    const { frame, root } = mount();
    const region = root.querySelector<HTMLElement>('[data-kb-uncovered]');
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
    expect(root.querySelector('[data-kb-readout][aria-live]')).toBeNull();
    const ink = inkOf(0);
    const { line, y } = coveredLine(ink);
    const name = nameOfLine(line);
    drag(frame, rowAcross(ink, y));
    expect(region).toHaveTextContent(name);
    expect(region).not.toHaveTextContent('L00 alpha beta gamma');
    expect(root.querySelector('[data-kb-uncovered]')).toBe(region);
  });
});

/*
 * Drawn in a play's moment (`EffectProps.still`; docs/plans/2026-11-03-effect-history-plan.md, Task 7): each layer as its saved state
 * says, nothing the reader does changing it, nothing saved, met or faded, and its words given to the moment's frame.
 */
describe('in a moment, still', () => {
  /** A saved state washing a layer about `share` of the way, as the author's strokes would. */
  function savedWash(layer: number, share: number): { state: { strokes: ReturnType<typeof packStroke>[] }; washed: number } {
    const ink = inkOf(layer);
    const strokes: Stroke[] = [];
    for (let y = 0; y <= 1 && ink.washed < share; y += (BRUSH_PX * 0.7) / boxNow().h) {
      const row = rowAcross(ink, y);
      if (row.length < 2) continue;
      washOn(ink, row, brush());
      strokes.push(washStroke(row));
    }
    return { state: { strokes: strokes.map(packStroke) }, washed: ink.washed };
  }
  const at = '2026-10-29T22:00:00.000Z';
  const lastView = (shown: readonly (CardView | null)[]) => shown.filter((v): v is CardView => v !== null).at(-1)!;

  test('a saved 40% wash draws as it was saved, with no control', () => {
    const wash = savedWash(0, 0.4);
    const { root, shown } = mount({ still: true, states: { 'play-1': { state: wash.state, savedAt: at } } });
    expect(washed(root)[0]).toBeCloseTo(wash.washed, 2);
    expect(lastView(shown).controls).toEqual([]);
  });

  test('a pointer drag changes nothing, and nothing is saved or met', () => {
    vi.useFakeTimers();
    const met = vi.fn();
    const wash = savedWash(0, 0.4);
    const { root, frame, save } = mount({ still: true, author: true, met, states: { 'play-1': { state: wash.state, savedAt: at } } });
    const before = washed(root);
    scrubTo(frame, root, 0, inkOf(0), 0.9);
    act(() => { vi.advanceTimersByTime(SAVE_AFTER_MS * 4); });
    expect(washed(root)).toEqual(before);
    expect(save).not.toHaveBeenCalled();
    expect(met).not.toHaveBeenCalled();
  });

  test('a layer saved clean is not drawn, and nothing fades, even when the clean state arrives after it is drawn', () => {
    const { root } = mount({ still: true, layers: 2, states: { 'play-1': { state: { strokes: [], clean: true }, savedAt: at } } });
    expect(states(root)).toEqual(['clean', 'live']);
    expect(root).not.toHaveAttribute('data-kb-fading');
    const later = mount({ still: true, layers: 2 });
    expect(states(later.root)).toEqual(['live', 'live']);
    later.hear({ 'play-2': { state: { strokes: [], clean: true }, savedAt: at } });
    expect(states(later.root)).toEqual(['live', 'clean']);
    expect(later.root).not.toHaveAttribute('data-kb-fading');
  });

  test('its words: one layer as its caster\'s ink and share washed, three top first, a clean one "washed clean"', () => {
    const wash = savedWash(0, 0.4);
    const one = mount({ still: true, states: { 'play-1': { state: wash.state, savedAt: at } } });
    expect(lastView(one.shown).state).toBe('As it landed');
    expect(lastView(one.shown).notes).toEqual({ 'play-1': `Mrs. Hooligan's magenta, ${percentWashed(wash.washed, false)}% washed` });
    expect(viewProblems(lastView(one.shown), { holds: false, covers: false })).toEqual([]);
    one.unmount();
    const three = mount({ still: true, layers: 3, states: { 'play-2': { state: { strokes: [], clean: true }, savedAt: at } } });
    expect(lastView(three.shown).state).toBe('As it landed');
    expect(lastView(three.shown).notes).toEqual({ 'play-3': "Spritey's yellow, 0% washed", 'play-2': "Gloomba's cyan, washed clean", 'play-1': "Mrs. Hooligan's magenta, 0% washed" });
    expect(viewProblems(lastView(three.shown), { holds: false, covers: false })).toEqual([]);
  });
});

describe('the canvas, with the frame offset in the cell', () => {
  const realRect = Element.prototype.getBoundingClientRect;
  afterEach(() => { Element.prototype.getBoundingClientRect = realRect; });

  test('the ink is placed at the box\'s corner whatever the frame\'s offset in the cell, and drawn from the band\'s own first row with no offset of its own', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    (globalThis as { Path2D?: unknown }).Path2D ??= class {};
    /* The frame sits 9.875px right and 7.5px down in the cell. */
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const at = this.classList.contains('kb-whoops-frame') ? { left: 9.875, top: 7.5 } : { left: 0, top: 0 };
      return { ...at, right: at.left, bottom: at.top, width: 0, height: 0, x: at.left, y: at.top, toJSON() {} } as DOMRect;
    };
    const moved: { canvas: HTMLCanvasElement; args: number[] }[] = [];
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
      const state: Record<string, unknown> = {};
      return new Proxy({}, {
        get: (_t, key: string) => (key in state ? state[key] : (...args: unknown[]) => {
          if (key === 'setTransform') moved.push({ canvas: this, args: args as number[] });
          if (key === 'createImageData') return { data: new Uint8ClampedArray(Number(args[0]) * Number(args[1]) * 4) };
          return undefined;
        }),
        set: (_t, key: string, value) => { state[key] = value; return true; },
      });
    } as unknown as HTMLCanvasElement['getContext'];
    /* The builds are held, so the stand-in is what is drawn. */
    seam.client = { requestBuild: () => {}, cancel: () => {}, active: () => false, requester: () => 1, pace: () => 1 };
    const { root } = mount();
    for (let k = 0; k < 4; k++) act(() => { vi.advanceTimersByTime(60); });
    const inks = [...root.querySelectorAll<HTMLCanvasElement>('canvas.kb-whoops-ink')];
    expect(inks).toHaveLength(2);
    expect(inks.map((c) => [c.style.left, c.style.top])).toEqual([['-9.875px', '-7.5px'], ['-9.875px', `${512 - 7.5}px`]]);
    /* Each canvas's own frame starts at its band's first row: the stand-in is moved up by that and by nothing else. */
    for (const [band, c] of inks.entries()) {
      const calls = moved.filter((m) => m.canvas === c);
      expect(calls.length).toBeGreaterThan(0);
      /* The reset to the identity is the only other transform. */
      for (const m of calls) expect([m.args[4], [0, -512 * band].includes(m.args[5]!)], `band ${band}`).toEqual([0, true]);
      expect(calls.some((m) => m.args[5] === -512 * band), `band ${band} is drawn from its first row`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------ the ink field: what is drawn ---- */

describe('the ink field: the picture a layer is drawn from', () => {
  const clock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  /* A frame draws, the bands are heard near, React renders their canvases, and the next frame paints them: a few frames settle it. */
  const frames = () => { for (let k = 0; k < 4; k++) act(() => { vi.advanceTimersByTime(60); }); };

  interface Fake { w: number; h: number; surface: Uint8ClampedArray; puts: { sx: number; sy: number; sw: number; sh: number }[]; draws: HTMLCanvasElement[]; strokes: number; arcs: { x: number; y: number; r: number; fill: unknown }[] }
  /** 2D contexts that keep what is put on them, so a test reads a canvas's pixels (jsdom has none), and log what is drawn onto it. */
  function fakeCanvases() {
    const fakes = new Map<HTMLCanvasElement, Fake>();
    const of = (c: HTMLCanvasElement): Fake => {
      let f = fakes.get(c);
      if (!f) { f = { w: -1, h: -1, surface: new Uint8ClampedArray(0), puts: [], draws: [], strokes: 0, arcs: [] }; fakes.set(c, f); }
      if (f.w !== c.width || f.h !== c.height) { f.w = c.width; f.h = c.height; f.surface = new Uint8ClampedArray(f.w * f.h * 4); }
      return f;
    };
    vi.stubGlobal('ImageData', class { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} });
    (globalThis as { Path2D?: unknown }).Path2D ??= class {};
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
      const f = of(this);
      const state: Record<string, unknown> = {};
      return new Proxy({}, {
        get: (_t, key: string) => {
          if (key in state) return state[key];
          if (key === 'canvas') return this;
          if (key === 'createImageData') return (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
          if (key === 'putImageData') {
            return (img: { width: number; height: number; data: Uint8ClampedArray }, dx: number, dy: number, sx = 0, sy = 0, sw = img.width, sh = img.height) => {
              f.puts.push({ sx: dx + sx, sy: dy + sy, sw, sh });
              for (let y = sy; y < sy + sh; y++) for (let x = sx; x < sx + sw; x++) for (let c = 0; c < 4; c++) f.surface[((dy + y) * f.w + dx + x) * 4 + c] = img.data[(y * img.width + x) * 4 + c]!;
            };
          }
          if (key === 'drawImage') return (src: HTMLCanvasElement) => { f.draws.push(src); };
          if (key === 'stroke') return () => { f.strokes++; };
          if (key === 'arc') return (x: number, y: number, r: number) => { f.arcs.push({ x, y, r, fill: state.fillStyle }); };
          if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => ({ addColorStop() {} });
          return () => undefined;
        },
        set: (_t, key: string, value) => { state[key] = value; return true; },
      });
    } as unknown as HTMLCanvasElement['getContext'];
    return { of };
  }

  /** A client that holds every build until told (or answers at once), and records what was asked and dropped. */
  function heldClient(holding = true) {
    const asks = new Map<string, { input: BuildInput; onDone: (b: ReturnType<typeof buildLayer>) => void }>();
    const requested: string[] = [], cancelled: string[] = [], inputs: BuildInput[] = [];
    let hold = holding, tokens = 0;
    const client: BuildClient = {
      requestBuild(key, input, onDone) {
        requested.push(key);
        inputs.push(input);
        if (hold) asks.set(key, { input, onDone }); else onDone(buildLayer(input));
      },
      cancel(key) { cancelled.push(key); asks.delete(key); },
      active: () => false,
      requester: () => ++tokens,
      pace: () => 1,
    };
    seam.client = client;
    return {
      requested, cancelled, inputs, asks,
      release: () => act(() => { hold = false; for (const [k, a] of [...asks]) { asks.delete(k); a.onDone(buildLayer(a.input)); } }),
    };
  }

  /** A pointer event with a time of its own (jsdom stamps every event within a millisecond of the last). */
  function at(el: HTMLElement, type: 'pointerDown' | 'pointerMove' | 'pointerUp', [x, y]: readonly [number, number], t: number) {
    const [cx, cy] = px(x, y);
    const ev = createEvent[type](el, { buttons: type === 'pointerMove' ? 1 : 0, clientX: cx, clientY: cy, pointerId: 1, button: 0, pointerType: 'mouse' });
    Object.defineProperty(ev, 'timeStamp', { value: t });
    act(() => { fireEvent(el, ev); });
  }
  /** A drag whose moves are `ms` apart and that lifts `rest` ms after the last. */
  function dragTimed(frame: HTMLElement, points: readonly (readonly [number, number])[], ms: number, rest = 1) {
    let t = 1000;
    at(frame, 'pointerDown', points[0]!, t);
    for (const p of points.slice(1)) at(frame, 'pointerMove', p, (t += ms));
    at(frame, 'pointerUp', points.at(-1)!, t + rest);
  }
  const writeInk = () => fireEvent.click(screen.getByRole('button', { name: 'Write in ink' }));
  /** A line along bare paper (no layer-0 splat reaches it), in 49px steps: slow enough at 100ms a move to throw nothing. */
  const BARE: [number, number][] = [[0.03, 0.985], [0.08, 0.985], [0.13, 0.985]];
  const penOn = (points: readonly Pt[], drops?: 0 | 1 | 2 | 3): Stroke => ({ tool: 'ink', color: COLORS[0]!, ...pen(), points, ...(drops !== undefined ? { drops } : null) });
  /** The whole post's picture of a layer, as one band of every row. */
  const referenceOf = (strokes: readonly Stroke[], layer = 0) => buildLayer({ seed: SEEDS[layer]!, color: COLORS[layer]!, box: boxNow(), density: 1, strokes, band: { row0: 0, rows: Math.ceil(boxNow().h) } }).image.data;
  const inkCanvases = (root: HTMLElement) => [...root.querySelectorAll<HTMLCanvasElement>('canvas.kb-whoops-ink')];
  /** The layer's picture on the page: its bands' canvases top to bottom, their pixels laid together, whether every band has had a picture put on it (a build's, where the stand-in is drawn), and the strokes drawn on them. */
  const lastPicture = (fk: ReturnType<typeof fakeCanvases>, root: HTMLElement, layer = 0) => {
    const canvases = inkCanvases(root).filter((c) => c.dataset.kbLayer === String(layer)).sort((a, b) => Number(a.dataset.kbBand) - Number(b.dataset.kbBand));
    const surface = new Uint8ClampedArray(canvases.reduce((n, c) => n + c.width * c.height * 4, 0));
    let at = 0;
    for (const c of canvases) { surface.set(fk.of(c).surface, at); at += c.width * c.height * 4; }
    return { canvases, surface, build: canvases.length > 0 && canvases.every((c) => fk.of(c).puts.length > 0), strokes: canvases.reduce((n, c) => n + fk.of(c).strokes, 0) };
  };
  const maxDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!)); return m; };

  test('the premise: the line below is on bare paper on layer 0', () => {
    const ink = inkOf(0);
    for (let x = 0; x <= 0.15; x += 0.01) for (let y = 0.96; y <= 1; y += 0.01) expect(ink.valueAt(x, y), `${x},${y}`).toBe(0);
  });

  test('a pen stroke on a light layer changes the picture inside its rectangle and nowhere else', () => {
    clock();
    const fk = fakeCanvases();
    sight();
    const { frame, root } = mount({ author: true });
    writeInk();
    frames();
    const first = lastPicture(fk, root);
    expect(first.build, 'a light layer is built before its first frame').toBe(true);
    /* The line is on bare paper in the last band (rows 512 on). */
    const canvas = first.canvases[1]!, picture = fk.of(canvas);
    const before = Uint8ClampedArray.from(picture.surface);
    const puts = picture.puts.length;
    dragTimed(frame, BARE, 100);
    frames();
    expect(lastPicture(fk, root).canvases[1], 'the same canvas is updated in place').toBe(canvas);
    /* The stroke's reach: 2r = 16px each side of the line, and a pixel of shading around that. */
    const b = boxNow();
    /* The line's reach is 2r = 16px, and the bulb at its end (1.35r, reaching twice that) a little further: 26 all round. */
    const [x0, x1, y0, y1] = [0.03 * b.w - 26, 0.13 * b.w + 26, 0.985 * b.h - 26 - 512, 0.985 * b.h + 26 - 512];
    let changed = 0;
    for (let y = 0; y < picture.h; y++) for (let x = 0; x < picture.w; x++) {
      const i = (y * picture.w + x) * 4;
      if (before[i]! === picture.surface[i]! && before[i + 1]! === picture.surface[i + 1]! && before[i + 2]! === picture.surface[i + 2]! && before[i + 3]! === picture.surface[i + 3]!) continue;
      changed++;
      expect(x >= x0 && x <= x1 && y >= y0 && y <= y1, `pixel ${x},${y} changed outside the stroke's rectangle`).toBe(true);
    }
    expect(changed).toBeGreaterThan(500);
    /* Only that rectangle was put on the canvas, and the band above it was not touched. */
    const newPuts = picture.puts.slice(puts);
    expect(newPuts.length).toBeGreaterThan(0);
    for (const r of newPuts) expect([r.sx >= x0 - 2, r.sx + r.sw <= x1 + 2, r.sy >= y0 - 2, r.sy + r.sh <= y1 + 2], `put ${JSON.stringify(r)}`).toEqual([true, true, true, true]);
    expect(fk.of(first.canvases[0]!).puts, 'a band the stroke does not reach is not put on again').toHaveLength(1);
  });

  test('the stand-in, then the build: a stroke made between is in both, once', () => {
    clock();
    const fk = fakeCanvases();
    const held = heldClient();
    const { frame, root } = mount({ author: true });
    writeInk();
    frames();
    const stand = lastPicture(fk, root);
    expect(stand.build, 'held back, the layer is drawn by the stand-in').toBe(false);
    const flat = stand.strokes;
    dragTimed(frame, BARE, 100);
    frames();
    expect(lastPicture(fk, root).build).toBe(false);
    expect(lastPicture(fk, root).strokes, 'the stroke is drawn flat by the stand-in').toBeGreaterThan(flat);
    held.release();
    frames();
    const done = lastPicture(fk, root);
    expect(done.build, 'released, the build').toBe(true);
    const line = penOn(BARE, 0);
    const got = done.surface;
    expect(maxDiff(got, referenceOf([line])), 'the stroke is in the build, as if it had been in it from the first').toBeLessThanOrEqual(4);
    expect(maxDiff(got, referenceOf([line, line])), 'and it is in once: twice would be a wider line').toBeGreaterThan(8);
  });

  test('a wash finished while the build was out is in the grid that arrived once: a wash takes more the second time', () => {
    clock();
    const fk = fakeCanvases();
    const held = heldClient();
    const { frame, root } = mount();
    frames();
    expect(lastPicture(fk, root).build, 'held back, the layer is drawn by the stand-in').toBe(false);
    const [x, y] = inkSpot(inkOf(0));
    const line: [number, number][] = [[x, y], [x + 0.03, y], [x + 0.05, y]];
    drag(frame, line);
    frames();
    held.release();
    frames();
    const done = lastPicture(fk, root);
    expect(done.build, 'released, the build').toBe(true);
    const wash = washStroke(line);
    const once = referenceOf([wash]), twice = referenceOf([wash, wash]);
    expect(maxDiff(once, twice), 'the premise: a second wash over the same line shows').toBeGreaterThan(8);
    const got = done.surface;
    expect(maxDiff(got, once), 'the wash is in the build, as if it had been in it from the first').toBeLessThanOrEqual(4);
    expect(maxDiff(got, twice), 'and it is in once, not twice').toBeGreaterThan(8);
  });

  test('a stroke still open when the build arrives goes on to the grid that arrived, and is in it once', () => {
    clock();
    const fk = fakeCanvases();
    const held = heldClient();
    const { frame, root } = mount({ author: true });
    writeInk();
    frames();
    at(frame, 'pointerDown', BARE[0]!, 1000);
    at(frame, 'pointerMove', BARE[1]!, 1100);
    held.release();
    frames();
    at(frame, 'pointerMove', BARE[2]!, 1200);
    at(frame, 'pointerUp', BARE[2]!, 1201);
    frames();
    const done = lastPicture(fk, root);
    expect(done.build).toBe(true);
    const line = penOn(BARE, 0);
    expect(maxDiff(done.surface, referenceOf([line]))).toBeLessThanOrEqual(4);
  });

  test('a build that already holds the stroke is not given it again, and the one it replaced is dropped', () => {
    clock();
    const fk = fakeCanvases();
    const held = heldClient();
    const { frame, root, hear } = mount({ author: true });
    writeInk();
    frames();
    dragTimed(frame, BARE, 100);
    frames();
    const first = [...held.asks.keys()];
    expect(first, 'a build for each of the two bands').toHaveLength(2);
    /* Another device saves a dab: the layer is built again, from its strokes, this one in them. The first requests are let go. */
    const dab: Stroke = { tool: 'wash', ...brush(), points: [[0.5, 0.2]] };
    hear({ 'play-1': { state: { strokes: [packStroke(dab)] }, savedAt: SAVED_AT } });
    frames();
    expect(held.cancelled).toEqual(expect.arrayContaining(first));
    expect(held.asks.size).toBe(2);
    for (const key of held.asks.keys()) expect(first).not.toContain(key);
    /* The new requests hold what the other device saved, and the stroke as it is kept (simplified, its drops on it). */
    const asked = [...held.asks.values()][0]!.input.strokes;
    expect(asked.map((s) => s.tool)).toEqual(['wash', 'ink']);
    held.release();
    frames();
    const done = lastPicture(fk, root);
    expect(done.build).toBe(true);
    const kept = asked[1]!;
    expect(maxDiff(done.surface, referenceOf([dab, kept])), 'the stroke is in it, once').toBeLessThanOrEqual(4);
    expect(maxDiff(done.surface, referenceOf([dab, kept, kept]))).toBeGreaterThan(8);
  });

  test('a rebuild of the model in the middle of a stroke does not leave the rest of it on a dead model', () => {
    const { frame, root, hear } = mount();
    const [x, y] = inkSpot(inkOf(0));
    const path: Pt[] = [[x, y], [x + 0.01, y], [x + 0.02, y], [x + 0.03, y], [x + 0.04, y], [x + 0.05, y]];
    const px2 = (p: Pt) => px(p[0], p[1]);
    act(() => { fireEvent.pointerDown(frame, { clientX: px2(path[0]!)[0], clientY: px2(path[0]!)[1], pointerId: 1, button: 0, pointerType: 'mouse' }); });
    for (const p of path.slice(1, 3)) act(() => { fireEvent.pointerMove(frame, { buttons: 1, clientX: px2(p)[0], clientY: px2(p)[1], pointerId: 1, pointerType: 'mouse' }); });
    /* Another device's save changes a state: the model is built again from it. */
    const dab: Stroke = { tool: 'wash', ...brush(), points: [[0.02, 0.02]] };
    hear({ 'play-1': { state: { strokes: [packStroke(dab)] }, savedAt: SAVED_AT } });
    for (const p of path.slice(3)) act(() => { fireEvent.pointerMove(frame, { buttons: 1, clientX: px2(p)[0], clientY: px2(p)[1], pointerId: 1, pointerType: 'mouse' }); });
    act(() => { fireEvent.pointerUp(frame, { clientX: px2(path.at(-1)!)[0], clientY: px2(path.at(-1)!)[1], pointerId: 1, pointerType: 'mouse' }); });
    const whole = inkOf(0, [dab, { tool: 'wash', ...brush(), points: path }]);
    expect(whole.washed).toBeGreaterThan(0);
    expect(washed(root)[0], 'the current model washed the whole stroke').toBeCloseTo(whole.washed, 3);
  });

  test('pointer speed over the last 50ms is the drops: floor(speed / DROPS_SPEED), at most 3, none for a tap or a pause', () => {
    expect(DROPS_SPEED).toBe(900);
    const line = (ms: number, step: number, count: number, rest = 0) => {
      const trail = Array.from({ length: count }, (_, i) => ({ x: i * step, y: 0, t: i * ms }));
      return dropsOf(trail, trail.at(-1)!.t + rest);
    };
    expect(line(10, 4, 20), '400 px/s').toBe(0);
    expect(line(10, 9, 20), '900 px/s').toBe(1);
    expect(line(10, 19, 20), '1900 px/s').toBe(2);
    expect(line(10, 28, 20), '2800 px/s').toBe(3);
    expect(line(10, 500, 20), 'far faster is still 3').toBe(3);
    expect(line(10, 28, 20, 60), 'held still for 60ms before lifting').toBe(0);
    expect(dropsOf([{ x: 5, y: 5, t: 100 }], 100), 'a tap').toBe(0);
    expect(dropsOf([], 100)).toBe(0);
    /* A drag that is all inside the window counts its own span: 90px in 50ms is 1800 px/s. */
    expect(dropsOf([{ x: 0, y: 0, t: 0 }, { x: 90, y: 0, t: 50 }], 50)).toBe(2);
    /* A segment half in the window counts half its length. */
    expect(dropsOf([{ x: 0, y: 0, t: 0 }, { x: 180, y: 0, t: 100 }], 100)).toBe(2);
  });

  test('a fast lift saves drops above 0 with the stroke, and a slow one saves 0', async () => {
    authorClock();
    const fast = mount({ author: true });
    writeInk();
    dragTimed(fast.frame, BARE, 5);
    await settle(SAVE_AFTER_MS);
    const saved = (fast.save.mock.calls.at(-1)![1] as { strokes: { tool: string; drops?: number }[] }).strokes.at(-1)!;
    expect(saved.tool).toBe('ink');
    expect(saved.drops).toBe(3);
    fast.unmount();
    const slow = mount({ author: true });
    writeInk();
    dragTimed(slow.frame, BARE, 100);
    await settle(SAVE_AFTER_MS);
    expect((slow.save.mock.calls.at(-1)![1] as { strokes: { drops?: number }[] }).strokes.at(-1)!.drops).toBe(0);
  });

  test('what is saved is encoded, simplified and within fits, and what is kept is the same', async () => {
    authorClock();
    const { frame, save } = mount({ author: true });
    writeInk();
    /* 700 moves along one straight line: a hand reports far more than a line needs. */
    const many = Array.from({ length: 700 }, (_, i): [number, number] => [0.02 + (0.9 * i) / 699, 0.985]);
    dragTimed(frame, many, 100);
    await settle(SAVE_AFTER_MS);
    const state = save.mock.calls.at(-1)![1] as { strokes: { points: unknown; continues?: true; drops?: number }[] };
    expect(state.strokes.every((s) => typeof s.points === 'string'), 'the points are packed').toBe(true);
    const kept = savedOf(state).strokes;
    expect(kept).toHaveLength(state.strokes.length);
    const points = kept.reduce((n, s) => n + s.points.length, 0);
    expect(points, 'simplified: a straight line is its two ends').toBeLessThan(10);
    expect(fits(kept)).toBe(true);
    expect(whoops.validateState!(state).ok).toBe(true);
    expect(state.strokes.slice(1).every((s) => s.continues === true), 'pieces of one line continue it').toBe(true);
  });

  test('a post that leaves lets its pictures go, and builds again when it returns', () => {
    clock();
    fakeCanvases();
    const eyes = sight({ post: false });
    const held = heldClient(false);
    const { root } = mount();
    eyes.see(true);
    frames();
    expect(root.dataset.kbPictures, 'built for each band of the post that is near').toBe('2');
    expect(held.requested).toHaveLength(2);
    eyes.see(false);
    frames();
    expect(root.dataset.kbPictures, 'the cache is empty').toBe('0');
    expect(root.dataset.kbBands, 'and no band is held').toBe('');
    eyes.see(true);
    frames();
    expect(root.dataset.kbPictures).toBe('2');
    expect(held.requested, 'and built again').toHaveLength(4);
  });

  test('a build still out when the post leaves is dropped, and its answer is not used', () => {
    clock();
    fakeCanvases();
    const eyes = sight({ post: false });
    const held = heldClient();
    const { root } = mount();
    eyes.see(true);
    frames();
    const keys = [...held.asks.keys()];
    expect(keys).toHaveLength(2);
    eyes.see(false);
    expect(held.cancelled).toEqual(expect.arrayContaining(keys));
    held.release();
    frames();
    expect(root.dataset.kbPictures).toBe('0');
  });

  /** A post that goes far from the viewport and comes back: `see(true)` and `see(false)`. */
  const viewport = () => sight({ post: false }).see;

  test('a resize while the build is out, with one stroke finished and one still open: after the build arrives both are in the picture once, and in the model', () => {
    clock();
    layoutLines = TEXT_LINES;
    const resizes: (() => void)[] = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { resizes.push(cb); }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const fk = fakeCanvases();
    const held = heldClient();
    const { frame, root } = mount({ author: true });
    writeInk();
    frames();
    /* Two lines no splat covers at either width, so only a pen stroke can hide them. */
    const lineY = (k: number) => (k + 0.5) / TEXT_LINES;
    const clear = (k: number) => [MAX_FRAME, 800].every((w) => !coveredLines([{ top: lineY(k) - 0.001, bottom: lineY(k) + 0.001, text: '' }], [new LayerInk(splatFor(0), [], { w, h: TEXT_LINES * LINE_PX })])[0]);
    const k1 = Array.from({ length: TEXT_LINES - 6 }, (_, k) => k).find((k) => clear(k) && clear(k + 3) && clear(k + 6))!;
    expect(k1, 'a pair of clear lines exists').toBeDefined();
    const y1 = lineY(k1), y2 = lineY(k1 + 3);
    const [first, second]: [number, number][][] = [[[0.02, y1], [0.5, y1], [0.98, y1]], [[0.02, y2], [0.5, y2], [0.98, y2]]];
    const oldPen = pen();
    /* One stroke finished, then one open, with the first request still out. */
    at(frame, 'pointerDown', first![0]!, 1000);
    at(frame, 'pointerMove', first![1]!, 1100);
    at(frame, 'pointerMove', first![2]!, 1200);
    at(frame, 'pointerUp', first![2]!, 1400);
    at(frame, 'pointerDown', second![0]!, 2000);
    at(frame, 'pointerMove', second![1]!, 2100);
    /* The body is resized: the model is built again and the build asked for again at the new size. */
    boxWidth = 800;
    act(() => { resizes.forEach((r) => r()); });
    frames();
    expect(held.asks.size, 'only the new size is waited for, a band each').toBe(2);
    expect([...held.asks.values()].every((a) => a.input.box.w === 800)).toBe(true);
    const asked = [...held.asks.values()][0]!.input;
    expect(asked.box.w).toBe(800);
    expect(asked.strokes.map((s) => s.tool), 'the finished stroke is in what the build is asked for').toEqual(['ink']);
    held.release();
    frames();
    at(frame, 'pointerMove', second![2]!, 2200);
    at(frame, 'pointerUp', second![2]!, 2400);
    frames();
    const done = lastPicture(fk, root);
    expect(done.build).toBe(true);
    const open: Stroke = { tool: 'ink', color: COLORS[0]!, ...oldPen, points: second!, drops: 0 };
    const got = done.surface;
    /* A line of pixels along a stroke's edge sits on the threshold, where the build's stored field (rounded to 1/4096) and the live grid's differ in the last place: so the pictures are compared by how many pixels differ, not by the worst one. */
    const apart = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i]! - b[i]!) > 4 || Math.abs(a[i + 3]! - b[i + 3]!) > 4) n++; return n; };
    expect(apart(got, referenceOf([...asked.strokes, open])), 'both strokes are in the picture').toBeLessThan(boxNow().w);
    expect(apart(got, referenceOf([...asked.strokes, ...asked.strokes, open])), 'the finished one is in once').toBeGreaterThan(5 * boxNow().w);
    expect(apart(got, referenceOf([...asked.strokes, open, open])), 'and so is the open one').toBeGreaterThan(5 * boxNow().w);
    expect(apart(got, referenceOf(asked.strokes)), 'the open one is in').toBeGreaterThan(5 * boxNow().w);
    /* The model has both: the line under each is hidden from a screen reader. */
    expect(readout(root)).not.toContain(nameOfLine(k1));
    expect(readout(root)).not.toContain(nameOfLine(k1 + 3));
    expect(readout(root), 'a line clear of both is still read').toContain(nameOfLine(k1 + 6));
  });

  test('a reader\'s unsaved strokes survive the post leaving and returning, in the model and in the picture', () => {
    clock();
    const fk = fakeCanvases();
    const see = viewport();
    const held = heldClient();
    const { frame, root } = mount();
    see(true);
    frames();
    held.release();
    frames();
    const [x, y] = inkSpot(inkOf(0));
    const rows: [number, number][][] = [0, 0.02, 0.04].map((dy) => [[x, y + dy], [x + 0.05, y + dy], [x + 0.1, y + dy]]);
    for (const row of rows) drag(frame, row);
    const share = washed(root)[0]!;
    expect(share, 'the strokes washed something').toBeGreaterThan(0);
    see(false);
    frames();
    expect(root.dataset.kbPictures).toBe('0');
    see(true);
    frames();
    /* The model came back from the strokes kept on this screen. */
    expect(washed(root)[0], 'the washed share is the same').toBeCloseTo(share, 3);
    frames();
    const done = lastPicture(fk, root);
    expect(done.build).toBe(true);
    /* The strokes come back as this screen kept them: simplified, as a stroke is when it is kept (`fitStroke`). */
    const made = rows.flatMap((row) => fitStroke(washStroke(row), minStepOf(boxNow())));
    expect(maxDiff(done.surface, referenceOf(made)), 'the picture holds them').toBeLessThanOrEqual(4);
    expect(maxDiff(done.surface, referenceOf([])), 'and is not the untouched layer').toBeGreaterThan(8);
  });

  test('after live strokes the picture\'s grid and the model agree: the washed share, and the field at the model\'s cell centers', () => {
    clock();
    const fk = fakeCanvases();
    /* Builds answered at once by a client of the test's own (the page's shared one may hold a key another test left waiting under fake timers). */
    heldClient(false);
    const { frame, root } = mount();
    frames();
    const [x, y] = inkSpot(inkOf(0));
    /* The strokes as the screen made them (a reader's, full resolution: both the model and the grid hold them so until the next rebuild). */
    const kept = [0, 0.02, 0.04, 0.06].map((dy) => washStroke([[x - 0.05, y + dy], [x, y + dy], [x + 0.05, y + dy], [x + 0.1, y + dy]]));
    for (const dy of [0, 0.02, 0.04, 0.06]) drag(frame, [[x - 0.05, y + dy], [x, y + dy], [x + 0.05, y + dy], [x + 0.1, y + dy]]);
    frames();
    const picture = lastPicture(fk, root);
    expect(picture.build).toBe(true);
    expect(maxDiff(picture.surface, referenceOf(kept)), 'the picture is the grid the strokes were applied to').toBeLessThanOrEqual(4);
    /* The grid as built from the same strokes, read at the model's cell centers. */
    const box = boxNow();
    const model = inkOf(0, kept);
    const whole = { row0: 0, rows: Math.ceil(box.h) };
    const grid = buildLayer({ seed: SEEDS[0]!, color: COLORS[0]!, box, density: 1, strokes: kept, band: whole });
    const once = buildLayer({ seed: SEEDS[0]!, color: COLORS[0]!, box, density: 1, strokes: [], band: whole });
    const cols = Math.ceil(box.w);
    const at1 = (field: Uint16Array, cx: number, cy: number) => field[Math.min(Math.ceil(box.h) - 1, Math.floor(cy)) * cols + Math.min(cols - 1, Math.floor(cx))]! / FIELD_SCALE;
    const { cols: mc, rows: mr, step } = model.cells;
    let total = 0, left = 0, apart = 0;
    for (let j = 0; j < mr; j++) for (let i = 0; i < mc; i++) {
      const cx = (i + 0.5) * step, cy = (j + 0.5) * step;
      const was = at1(once.field, cx, cy) >= THRESHOLD, now = at1(grid.field, cx, cy) >= THRESHOLD;
      if (was) { total++; if (now) left++; }
      if (now !== (model.cells.values[j * mc + i]! >= THRESHOLD)) apart++;
    }
    expect(total).toBeGreaterThan(0);
    expect(1 - left / total, 'the grid\'s washed share, at the model\'s cells').toBeCloseTo(model.washed, 1);
    expect(1 - left / total).toBeCloseTo(washed(root)[0]!, 1);
    expect(apart / (mc * mr), 'cells where the grid and the model disagree on ink: a rounding\'s worth').toBeLessThan(0.01);
  });

  test('a layer a reader scrubs clean lets its picture, grid and canvas go while the post stays', () => {
    clock();
    fakeCanvases();
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    const held = heldClient(false);
    const { frame, root } = mount({ layers: 1 });
    frames();
    expect(root.dataset.kbPictures, 'drawn from a build, a band each').toBe('2');
    scrubTo(frame, root, 0, inkOf(0), 0.96);
    frames();
    expect(states(root)).toEqual(['clean']);
    expect(root.dataset.kbPictures, 'nothing is held for a layer that is gone').toBe('0');
    expect(held.cancelled.length, 'its build slot was let go').toBeGreaterThanOrEqual(1);
  }, 60_000);

  /* ------------------------------------------------------------------ bands ---- */

  const inkOfBand = (root: HTMLElement, band: number, layer = 0) => root.querySelector<HTMLCanvasElement>(`canvas.kb-whoops-ink[data-kb-band="${band}"][data-kb-layer="${layer}"]`)!;
  const total = (p: ReturnType<typeof heldBytes>) => p.canvas + p.grids + p.scratch;

  test('a tall post holds only the bands near the viewport', () => {
    clock();
    fakeCanvases();
    sight({ bands: (i) => i >= 3 && i <= 6 });
    const held = heldClient(false);
    boxWidth = 390;
    boxHeight = 20_000;
    const { root } = mount({ layers: 3 });
    frames();
    const inks = inkCanvases(root);
    expect(inks, 'three layers of four bands').toHaveLength(12);
    expect([...new Set(inks.map((c) => c.dataset.kbBand))].sort()).toEqual(['3', '4', '5', '6']);
    expect([...new Set(inks.map((c) => c.dataset.kbLayer))].sort()).toEqual(['0', '1', '2']);
    for (const c of inks) {
      expect(c).toHaveAttribute('aria-hidden', 'true');
      expect(c).toHaveAttribute('data-kb-effect-ink');
      expect([c.width, c.height]).toEqual([390, 512]);
      expect([c.style.top, c.style.height]).toEqual([`${Number(c.dataset.kbBand) * 512}px`, '512px']);
    }
    expect(root.dataset.kbBands).toBe('3 4 5 6');
    expect(root.dataset.kbPictures).toBe('12');
    expect(held.requested, 'a build for each, and for no other band').toHaveLength(12);
    expect([...new Set(held.inputs.map((i) => i.band.row0))].sort((a, b) => a - b)).toEqual([1536, 2048, 2560, 3072]);
    const probe = heldBytes();
    expect(probe.canvas, 'the canvases\' backing').toBe(12 * 390 * 512 * 4);
    expect(probe.grids, 'the grids, with an apron row each side').toBe(12 * 390 * 514 * 5);
    expect(total(probe) / 3, 'the pixels held a layer').toBeLessThan(12_000_000);
  }, 60_000);

  test('a band that leaves lets its picture go, and one that returns is built again with the strokes made meanwhile', () => {
    clock();
    const fk = fakeCanvases();
    const eyes = sight();
    const held = heldClient(false);
    boxWidth = 390;
    boxHeight = 1400;
    const { root, frame } = mount({ author: true });
    writeInk();
    frames();
    expect(root.dataset.kbBands).toBe('0 1 2');
    expect(root.dataset.kbPictures).toBe('3');
    const first = [...held.requested];
    expect(first).toHaveLength(3);
    const all = total(heldBytes());
    eyes.bands((i) => i === 0);
    frames();
    expect(root.dataset.kbBands).toBe('0');
    expect(root.dataset.kbPictures, 'bands 1 and 2 let their pictures go').toBe('1');
    expect(held.cancelled).toEqual(expect.arrayContaining([first[1], first[2]]));
    expect(inkCanvases(root), 'and their canvases').toHaveLength(1);
    expect(total(heldBytes()), 'and what they held').toBeLessThan(all / 2);
    /* A pen line in band 2's rows while it is away. */
    const line: [number, number][] = [[0.1, 0.95], [0.3, 0.95], [0.5, 0.95]];
    dragTimed(frame, line, 100);
    frames();
    eyes.bands(() => true);
    frames();
    expect(root.dataset.kbPictures).toBe('3');
    const asked = held.inputs.filter((i) => i.band.row0 === 1024).at(-1)!;
    expect(held.requested.length, 'band 2 and band 1 were built again, band 0 not').toBe(5);
    expect(asked.strokes.map((s) => s.tool), 'the line made meanwhile is in what the band is asked for').toEqual(['ink']);
    const got = fk.of(inkOfBand(root, 2)).surface;
    const want = buildLayer({ ...asked, band: { row0: 1024, rows: 376 } }).image.data;
    expect(maxDiff(got, want)).toBeLessThanOrEqual(4);
    let inked = 0;
    for (let i = 3; i < got.length; i += 4) if (got[i]! > 0) inked++;
    expect(inked, 'and it shows').toBeGreaterThan(300);
  });

  test('a stroke across a band\'s edge is drawn in both bands, as the whole post draws it at the seam', () => {
    clock();
    const fk = fakeCanvases();
    sight();
    heldClient(false);
    boxWidth = 390;
    boxHeight = 1400;
    const { root, frame } = mount({ author: true });
    writeInk();
    frames();
    const bands = [inkOfBand(root, 0), inkOfBand(root, 1)];
    expect(bands.map((c) => c.height)).toEqual([512, 512]);
    const before = bands.map((c) => Uint8ClampedArray.from(fk.of(c).surface));
    const puts = bands.map((c) => fk.of(c).puts.length);
    /* Two runs along the seam, 8px either side of it, with the pen, at the thin edge of the splat where a line shows: the edge of each run's ink is at the seam, so the shading's gradient at the band's edge rows is steep, and a row of the neighbor is what it reads. */
    const line: [number, number][] = [[0.9, 504 / 1400], [0.96, 504 / 1400], [0.96, 520 / 1400], [0.9, 520 / 1400]];
    dragTimed(frame, line, 100);
    frames();
    const stroke = penOn(line, 0);
    const box = boxNow();
    const whole = buildLayer({ seed: SEEDS[0]!, color: COLORS[0]!, box, density: 1, strokes: [stroke], band: { row0: 0, rows: 1400 } }).image.data;
    const seam = (band: number) => {
      const c = bands[band]!, f = fk.of(c);
      let worst = 0, changed = 0, first = '';
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (before[band]![i + 3] !== f.surface[i + 3] || before[band]![i] !== f.surface[i]) changed++;
        const lattice = band * 512 + y;
        if (Math.abs(lattice - 512) > 40) continue;
        /* A pixel with no ink has no color: the shading leaves what was in its buffer. */
        const clear = f.surface[i + 3] === 0 && whole[(lattice * c.width + x) * 4 + 3] === 0;
        for (let k = 0; k < (clear ? 0 : 4); k++) {
          const d = Math.abs(f.surface[i + k]! - whole[(lattice * c.width + x) * 4 + k]!);
          if (d > worst) { worst = d; first = `band ${band} row ${y} column ${x} channel ${k}: ${f.surface[i + k]} vs ${whole[(lattice * c.width + x) * 4 + k]}`; }
        }
      }
      return { worst, changed, first };
    };
    for (const band of [0, 1]) {
      const { worst, changed, first } = seam(band);
      expect(changed, `band ${band} shows the stroke`).toBeGreaterThan(200);
      expect(worst, `band ${band} at the seam: ${first}`).toBeLessThanOrEqual(4);
    }
    /* The rectangle put on each canvas is the stroke's rectangle on that band's own grid (a band's rows and one of apron each side) grown by one point, kept to the band's own rows: the shading reads a neighbor past it. */
    for (const band of [0, 1]) {
      const row0 = band * 512, top = Math.max(0, row0 - 1), end = Math.min(1400, row0 + 512 + 1), above = row0 - top;
      const rect = strokesInto(bandGrid(box, 1, top, end - top), box, [stroke]);
      const want = [Math.max(0, rect.x0 - 1), Math.min(390, rect.x1 + 1), Math.max(above, rect.y0 - 1) - above, Math.min(above + 512, rect.y1 + 1) - above];
      const put = fk.of(bands[band]!).puts.slice(puts[band]!);
      expect(put.length, `band ${band} was put on`).toBeGreaterThan(0);
      expect([Math.min(...put.map((r) => r.sx)), Math.max(...put.map((r) => r.sx + r.sw)), Math.min(...put.map((r) => r.sy)), Math.max(...put.map((r) => r.sy + r.sh))], `band ${band}'s put rectangle`).toEqual(want);
    }
  });

  test('a stroke open while its band leaves and returns is in the band\'s picture once, and is not lost', () => {
    clock();
    const fk = fakeCanvases();
    const eyes = sight();
    heldClient(false);
    boxWidth = 390;
    boxHeight = 1400;
    const { root, frame } = mount({ author: true });
    writeInk();
    frames();
    const line: [number, number][] = [[0.1, 0.94], [0.2, 0.95], [0.3, 0.94], [0.4, 0.95], [0.5, 0.94], [0.6, 0.95]];
    let t = 1000;
    at(frame, 'pointerDown', line[0]!, t);
    at(frame, 'pointerMove', line[1]!, (t += 100));
    frames();
    eyes.bands((i) => i < 2);
    frames();
    expect(inkOfBand(root, 2), 'band 2 is away').toBeNull();
    at(frame, 'pointerMove', line[2]!, (t += 100));
    at(frame, 'pointerMove', line[3]!, (t += 100));
    eyes.bands(() => true);
    frames();
    at(frame, 'pointerMove', line[4]!, (t += 100));
    at(frame, 'pointerMove', line[5]!, (t += 100));
    at(frame, 'pointerUp', line[5]!, t + 1);
    frames();
    const stroke = penOn(line, 0);
    const band = { row0: 1024, rows: 376 };
    const once = buildLayer({ seed: SEEDS[0]!, color: COLORS[0]!, box: boxNow(), density: 1, strokes: [stroke], band }).image.data;
    const twice = buildLayer({ seed: SEEDS[0]!, color: COLORS[0]!, box: boxNow(), density: 1, strokes: [stroke, stroke], band }).image.data;
    const got = fk.of(inkOfBand(root, 2)).surface;
    expect(maxDiff(got, once), 'the whole line is in the band, from its first point').toBeLessThanOrEqual(4);
    expect(maxDiff(got, twice), 'and once: twice is a wider line').toBeGreaterThan(8);
  });

  test('the stand-in is flat circles and holds no picture', () => {
    clock();
    const fk = fakeCanvases();
    sight();
    const held = heldClient();
    const { root } = mount({ layers: 1 });
    frames();
    expect(held.asks.size, 'both bands are waiting for their build').toBe(2);
    const canvases = inkCanvases(root);
    expect(canvases).toHaveLength(2);
    const unit = unitPx(boxNow());
    const arcs = canvases.flatMap((c) => fk.of(c).arcs);
    const box = boxNow();
    for (const ball of splatFor(0).balls) {
      const x = (ball.x / DESIGN.w) * box.w, y = ball.y * box.h, r = ball.r * unit;
      /* A ball that lies off the box is in no band. */
      if (y + r < 0 || y - r > box.h) continue;
      expect(arcs.some((a) => Math.abs(a.x - x) < 1e-6 && Math.abs(a.y - y) < 1e-6 && Math.abs(a.r - r) < 1e-6), `a flat circle for the ball at ${x.toFixed(1)}, ${y.toFixed(1)}`).toBe(true);
    }
    expect(new Set(arcs.map((a) => a.fill)), 'in the layer\'s ink').toEqual(new Set([COLORS[0]]));
    for (const c of canvases) expect(fk.of(c).puts, 'no picture is put on a canvas').toHaveLength(0);
    expect(root.dataset.kbPictures).toBe('0');
    expect(heldBytes().grids, 'no grid is held').toBe(0);
    expect(vi.mocked(paintSplat), 'the splat is not painted').not.toHaveBeenCalled();
  });

  test('the sweep\'s open band shows in the stand-in', () => {
    clock();
    const fk = fakeCanvases();
    sight();
    heldClient();
    const { root } = mount({ layers: 1 });
    const button = screen.getByRole('button', { name: 'Hold to scrub' });
    frames();
    const stroked = () => inkCanvases(root).reduce((n, c) => n + fk.of(c).strokes, 0);
    expect(stroked()).toBe(0);
    act(() => { fireEvent.keyDown(button, { key: ' ' }); });
    /* Held until the sweep is first on ink, inside its first band: nothing has been finished yet, so only the open stroke can be what is drawn. */
    for (let k = 0; k < 100 && washed(root)[0] === 0; k++) act(() => { vi.advanceTimersByTime(50); });
    expect(washed(root)[0], 'the sweep is washing').toBeGreaterThan(0);
    expect(stroked(), 'and its open stroke is drawn on the stand-in').toBeGreaterThan(0);
    const seen = stroked();
    act(() => { vi.advanceTimersByTime(200); });
    expect(stroked(), 'and again as it goes on').toBeGreaterThan(seen);
    act(() => { fireEvent.keyUp(button, { key: ' ' }); });
  });

  test('a save\'s echo does not rebuild: no build is asked for, and the pictures are never let go', async () => {
    clock();
    fakeCanvases();
    sight();
    const held = heldClient(false);
    const net = gated();
    const { root, frame, hear, replay } = mount({ author: true, save: net.save });
    net.heard.current = hear;
    writeInk();
    frames();
    dragTimed(frame, BARE, 100);
    frames();
    expect(root.dataset.kbPictures).toBe('2');
    await settle(SAVE_AFTER_MS);
    expect(net.calls).toHaveLength(1);
    const asked = held.requested.length;
    const seen: (string | undefined)[] = [];
    await net.accept(0);
    seen.push(root.dataset.kbPictures);
    /* The page draws the post's plays again, as it does whenever they are heard. */
    await act(async () => { replay(); });
    seen.push(root.dataset.kbPictures);
    await settle(100);
    frames();
    seen.push(root.dataset.kbPictures);
    expect(seen, 'never fewer than were held').toEqual(['2', '2', '2']);
    expect(held.requested, 'no build was asked for').toHaveLength(asked);
  });

  test('two posts with the same play do not cancel each other\'s builds', () => {
    clock();
    fakeCanvases();
    sight();
    const held = heldClient();
    const a = mount();
    const b = mount();
    frames();
    expect(held.requested).toHaveLength(4);
    expect(new Set(held.requested).size, 'each post asks with a key of its own').toBe(4);
    a.unmount();
    held.release();
    frames();
    expect(b.root.dataset.kbPictures, 'the other post\'s builds were not let go with it').toBe('2');
  });

  test('a box narrower than a pixel starts no sweep (its pace would be infinite)', () => {
    clock();
    const resizes: (() => void)[] = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { resizes.push(cb); }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const { root } = mount();
    const button = screen.getByRole('button', { name: 'Hold to scrub' });
    frames();
    boxWidth = 0;
    act(() => { resizes.forEach((r) => r()); });
    frames();
    const before = washed(root)[0];
    const asked = vi.spyOn(globalThis, 'requestAnimationFrame');
    act(() => { fireEvent.keyDown(button, { key: ' ' }); });
    expect(asked, 'no frame is asked for by a sweep that never starts').not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(washed(root)[0]).toBe(before);
    act(() => { fireEvent.keyUp(button, { key: ' ' }); });
    asked.mockRestore();
  });

  test('a layer is asked for with the key of its strokes, so a stroke changes it', () => {
    clock();
    fakeCanvases();
    const held = heldClient(false);
    mount({ states: { 'play-1': { state: { strokes: [packStroke({ tool: 'wash', ...brush(), points: [[0.5, 0.5], [0.6, 0.5]] })] }, savedAt: SAVED_AT } } });
    frames();
    const strokes = [{ tool: 'wash' as const, ...brush(), points: [[0.5, 0.5], [0.6, 0.5]] as Pt[] }];
    /* A key for each band (named by its first row) and this effect's requester token. */
    expect(held.requested).toEqual([layerKey('play-1', boxNow(), 1, strokes, 0, 1), layerKey('play-1', boxNow(), 1, strokes, 512, 1)]);
  });
});

/* A save that got no answer may still have been stored: its strokes are then in the state heard, and must be counted once, here and in the retry. */
describe('a save whose answer was lost', () => {
  const lost = { ok: false as const, error: LOST_ANSWER, uncertain: true as const };
  const lineAt = (): [number, number][] => { const [x, y] = inkSpot(inkOf(0)); return [[x, y], [x + 0.03, y], [x + 0.05, y]]; };

  test('that the server stored: its state heard afterwards holds the stroke, counted once in the model, and the retry sends it once', async () => {
    authorClock();
    const net = gated();
    const line = lineAt();
    const { frame, root, hear, edit } = mount({ author: true, save: net.save });
    drag(frame, line);
    const once = inkOf(0, [washStroke(line)]).washed;
    const twice = inkOf(0, [washStroke(line), washStroke(line)]).washed;
    expect(twice, 'the premise: a second wash over the same line takes more').toBeGreaterThan(once + 0.001);
    await settle(SAVE_AFTER_MS);
    expect(net.calls).toHaveLength(1);
    await act(async () => { net.calls[0]!.answer(lost); });
    /* The server did store it, and the state reaches this screen (the page is also drawn again, so the layer is built from it). */
    await act(async () => { edit(); hear({ [net.calls[0]!.play]: { state: net.calls[0]!.state, savedAt: SAVED_AT } }); });
    expect(washed(root)[0], 'the stroke in the saved state is not added again from the ones kept').toBeCloseTo(once, 3);
    await settle(RETRY_AFTER_MS);
    expect(net.calls).toHaveLength(2);
    expect((net.calls[1]!.state as { strokes: unknown[] }).strokes, 'the retry holds the stroke once').toHaveLength(1);
    await net.accept(1);
    await settle(SAVE_AFTER_MS * 4);
    expect(net.calls, 'and nothing is left to send').toHaveLength(2);
    expect(washed(root)[0]).toBeCloseTo(once, 3);
  });

  test('that the server did not store: the state heard is unchanged, and the retry still carries the stroke', async () => {
    authorClock();
    const net = gated();
    const line = lineAt();
    const { frame, root } = mount({ author: true, save: net.save });
    drag(frame, line);
    await settle(SAVE_AFTER_MS);
    await act(async () => { net.calls[0]!.answer(lost); });
    expect(washed(root)[0]).toBeCloseTo(inkOf(0, [washStroke(line)]).washed, 3);
    await settle(RETRY_AFTER_MS);
    expect(net.calls).toHaveLength(2);
    expect((net.calls[1]!.state as { strokes: unknown[] }).strokes).toHaveLength(1);
  });

  test('two lost answers with only the first stored: the first state heard still holds its stroke, counted once, and the retry has no duplicate', async () => {
    authorClock();
    const net = gated();
    const [a, b] = rows();
    const { frame, root, hear, edit } = mount({ author: true, save: net.save });
    drag(frame, a!);
    await settle(SAVE_AFTER_MS);
    await act(async () => { net.calls[0]!.answer(lost); });
    drag(frame, b!);
    await settle(SAVE_AFTER_MS);
    expect(net.calls, 'the second save carries both').toHaveLength(2);
    await act(async () => { net.calls[1]!.answer(lost); });
    /* Only the first was stored. */
    await act(async () => { edit(); hear({ [net.calls[0]!.play]: { state: net.calls[0]!.state, savedAt: SAVED_AT } }); });
    const once = inkOf(0, [washStroke(a!), washStroke(b!)]).washed;
    expect(washed(root)[0], 'the stroke the first save stored is counted once').toBeCloseTo(once, 3);
    await settle(RETRY_AFTER_MS * 4);
    const last = net.calls[net.calls.length - 1]!;
    expect(net.calls.length).toBeGreaterThan(2);
    expect((last.state as { strokes: unknown[] }).strokes, 'the retry holds each stroke once').toHaveLength(2);
  });

  test('an uncertain save stored, then a later save refused: the refusal does not forget it, so nothing is counted or sent twice', async () => {
    authorClock();
    const net = gated();
    const [a, b, c] = rows();
    const { frame, root, hear, edit } = mount({ author: true, save: net.save });
    drag(frame, a!);
    await settle(SAVE_AFTER_MS);
    await act(async () => { net.calls[0]!.answer(lost); });
    drag(frame, b!);
    await settle(SAVE_AFTER_MS);
    expect(net.calls).toHaveLength(2);
    await act(async () => { net.calls[1]!.answer({ ok: false, error: 'at most 200 strokes' }); });
    await act(async () => { edit(); hear({ [net.calls[0]!.play]: { state: net.calls[0]!.state, savedAt: SAVED_AT } }); });
    expect(washed(root)[0], 'counted once').toBeCloseTo(inkOf(0, [washStroke(a!), washStroke(b!)]).washed, 3);
    drag(frame, c!);
    await settle(SAVE_AFTER_MS);
    const last = net.calls[net.calls.length - 1]!;
    expect(net.calls).toHaveLength(3);
    expect((last.state as { strokes: unknown[] }).strokes, 'a, b and c once each').toHaveLength(3);
  });

  test('refused outright: every stroke is kept, and the next save carries them all', async () => {
    authorClock();
    const net = gated();
    const [a, b] = rows();
    const { frame } = mount({ author: true, save: net.save });
    drag(frame, a!);
    await settle(SAVE_AFTER_MS);
    await act(async () => { net.calls[0]!.answer({ ok: false, error: 'at most 200 strokes' }); });
    drag(frame, b!);
    await settle(SAVE_AFTER_MS);
    expect(net.calls).toHaveLength(2);
    expect((net.calls[1]!.state as { strokes: unknown[] }).strokes).toHaveLength(2);
  });
});

/* No player is ever stuck: a stroke whose pointerup never came ends by the other signs a browser gives, and never washes on hover or refuses a finger for good. */
describe('a stroke whose pointerup was lost', () => {
  /** A finger wipe sideways from `at`: the touch events as a browser sends them. */
  const wipe = (target: HTMLElement, at: readonly [number, number]) => {
    const send = (type: 'touchstart' | 'touchmove' | 'touchend', dx: number) => {
      const list = [{ identifier: 1, clientX: at[0] + dx, clientY: at[1], target }];
      const event = new TouchEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { touches: { value: type === 'touchend' ? [] : list }, targetTouches: { value: type === 'touchend' ? [] : list }, changedTouches: { value: list } });
      act(() => { target.dispatchEvent(event); });
    };
    send('touchstart', 0);
    send('touchmove', 30);
    send('touchmove', 90);
    send('touchmove', 150);
    send('touchend', 150);
  };
  /** A mouse press and a move with the button down, and no lift. */
  function hold() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const m = mount();
    const [x, y] = inkSpot(inkOf(0));
    const [a, b] = [px(x, y), px(x + 0.06, y)];
    act(() => { fireEvent.pointerDown(m.frame, { clientX: a[0], clientY: a[1], pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' }); });
    act(() => { fireEvent.pointerMove(m.frame, { clientX: b[0], clientY: b[1], pointerId: 1, buttons: 1, pointerType: 'mouse' }); });
    return { ...m, a, b };
  }
  const wipesAfter = (m: ReturnType<typeof hold>) => {
    vi.mocked(suds.wash).mockClear();
    wipe(m.cell, px(...coreSpot(inkOf(0))));
    expect(vi.mocked(suds.wash), 'a finger wipes again: no stroke is left live to refuse it').toHaveBeenCalled();
  };

  test('lostpointercapture ends it, and a finger wipes after', () => {
    const m = hold();
    act(() => { fireEvent.lostPointerCapture(m.frame, { pointerId: 1, pointerType: 'mouse' }); });
    wipesAfter(m);
  });

  test('the window losing focus ends it, and a finger wipes after', () => {
    const m = hold();
    act(() => { fireEvent.blur(window); });
    wipesAfter(m);
  });

  test('the page being hidden ends it, and a finger wipes after', () => {
    const m = hold();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    try { act(() => { fireEvent(document, new Event('visibilitychange')); }); } finally { delete (document as { hidden?: unknown }).hidden; }
    wipesAfter(m);
  });

  test('a mouse move with no button down ends it, and washes nothing: the hover after a lost pointerup is only a hover', () => {
    const m = hold();
    vi.mocked(suds.wash).mockClear();
    const [cx, cy] = px(...coreSpot(inkOf(0)));
    act(() => { fireEvent.pointerMove(m.frame, { clientX: cx, clientY: cy, pointerId: 1, buttons: 0, pointerType: 'mouse' }); });
    act(() => { fireEvent.pointerMove(m.frame, { clientX: cx + 20, clientY: cy, pointerId: 1, buttons: 0, pointerType: 'mouse' }); });
    expect(vi.mocked(suds.wash), 'the hover throws no suds: it washes nothing').not.toHaveBeenCalled();
    wipesAfter(m);
  });
});
