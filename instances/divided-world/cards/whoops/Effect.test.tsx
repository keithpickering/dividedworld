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
import { DROPS_SPEED, Effect, MAX_SAVE_RETRIES, RETRY_AFTER_MS, SAVE_AFTER_MS, dropsOf, percentWashed, savedOf } from './Effect.tsx';
import { FIELD_SCALE, buildLayer, layerKey, type BuildInput } from './build.ts';
import type { BuildClient } from './buildClient.ts';
import { viewProblems } from '../../../../engine/ui/cards/lens-words.ts';
import { cursor } from './cursor.ts';
import { paint, paintStandIn, type PaintLayer } from './paint.ts';
import { decodePoints, packStroke } from './points.ts';
import { BRUSH_PX, LayerInk, PEN_PX, ROW_PX, brushOf, coveredLines, fits, fitStroke, minStepOf, type Pt, type Stroke } from './scrub.ts';
import { DESIGN, THRESHOLD, makeSplat, type Box } from './splat.ts';
import * as suds from './suds.ts';
import { createClaims } from '../../../../engine/ui/cards/claims.ts';

/* The suds and the drawn cursor are their own modules' (suds.test.ts, cursor.test.tsx): here the effect is seen to call them. */
vi.mock('./suds.ts', () => ({ register: vi.fn(), unregister: vi.fn(), wash: vi.fn(), puff: vi.fn() }));
vi.mock('./cursor.ts', () => ({ cursor: { over: vi.fn(), press: vi.fn(), leave: vi.fn() } }));

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
const built = vi.hoisted(() => ({ grids: 0 }));
vi.mock('./scrub.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('./scrub.ts')>();
  class Counted extends real.LayerInk {
    constructor(...args: ConstructorParameters<typeof real.LayerInk>) {
      super(...args);
      built.grids++;
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
  function Host() {
    const [held, set] = useState(props.states);
    /* The engine hands an effect a new list of the same plays whenever the post's plays are drawn again (Effects.tsx `PostEffects`). */
    const [list, setList] = useState(props.plays);
    push = set;
    replay = () => setList((was) => [...was]);
    const [view, setView] = useState<CardView | null>(null);
    say = setView;
    const effect = <Effect {...props} plays={list} states={held} />;
    return (
      <>
        {props.place === 'thread' ? <div className="kb-act-main">{effect}{o.beside}</div> : effect}
        <Kit card="whoops" controls={view?.controls ?? []} />
      </>
    );
  }
  const world = renderInWorld(<Host />, { settings: { cardSettings: o.clean === null ? {} : { 'whoops.clean': o.clean ?? 95 } } });
  const root = world.container.querySelector('.kb-whoops') as HTMLElement;
  return { ...world, shown, save: save as ReturnType<typeof vi.fn>, root, frame: world.container.querySelector('.kb-whoops-frame') as HTMLElement, cell: world.container.querySelector('.kb-act-main') as HTMLElement, hear: (next: Record<string, EffectState>) => act(() => push(next)), replay: () => act(() => replay()) };
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
  for (const [x, y] of rest) act(() => { fireEvent.pointerMove(frame, { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse' }); });
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
    for (const width of [MAX_FRAME, PHONE_FRAME]) {
      boxWidth = width;
      const { root, frame, unmount } = mount();
      const layout = root.querySelector('[data-kb-whoops-layout]') as HTMLElement;
      expect(layout.getAttribute('style') ?? '').toBe('');
      expect(frame.style.height).toBe('');
      /* The ink is fitted to the body: a canvas the body's size, reaching out of the frame to the body's corner. */
      const ink = root.querySelector('canvas[data-kb-effect-ink]') as HTMLCanvasElement;
      expect([ink.width, ink.height]).toEqual([width, LINES * LINE_PX]);
      expect([ink.style.left, ink.style.top, ink.style.width, ink.style.height]).toEqual(['0px', '0px', `${width}px`, `${LINES * LINE_PX}px`]);
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
    for (const [x, y] of rest) act(() => { fireEvent.pointerMove(frame, { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse' }); });
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
    /* Every pass takes `WASH_TAKES` of the ink and a core takes several, so it is about 86 seconds at the sweep's pace (it was a minute while one pass cleared): a hand's time, never a moment and never none. */
    /* It measures the sweep's own time to clean one layer in fake time: 86 seconds. The upper bound is 1.25 times that, so a sweep that slows by a quarter is caught. */
    let t = 8000;
    while (states(root)[0] === 'live' && t < 108_000) { frames(1000); t += 1000; }
    expect(states(root)).toEqual(['clean']);
    expect(t).toBeGreaterThan(30_000);
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
    /* Each layer takes a hand's time, as one does alone (about 86 seconds each at the sweep's pace). */
    let t = 0;
    while (states(root)[1] === 'live' && t < 150_000) { frames(1000); t += 1000; }
    expect(states(root)[1]).toBe('clean');
    while (states(root)[0] === 'live' && t < 300_000) { frames(1000); t += 1000; }
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
  /** A recording stand-in for a 2D context: every call and every style set is logged against the context it was made on. */
  function recorder(log: string[], name: string, onStroke: (style: unknown) => void) {
    const state: Record<string, unknown> = {};
    return new Proxy({}, {
      get: (_t, key: string) => (key in state ? state[key] : (...args: unknown[]) => {
        log.push(`${name}.${key}`);
        if (key === 'stroke') onStroke(state.strokeStyle);
        if (key === 'createRadialGradient') return { addColorStop() {} };
        return args.length ? undefined : undefined;
      }),
      set: (_t, key: string, value) => { state[key] = value; return true; },
    }) as unknown as CanvasRenderingContext2D;
  }

  test('each pen stroke is drawn in its layer, under the layers above it, and none over them all', () => {
    const log: string[] = [];
    const penColors: string[] = [];
    const canvases = new Map<HTMLCanvasElement, string>();
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
      if (!canvases.has(this)) canvases.set(this, canvases.size === 0 ? 'main' : 'work');
      return recorder(log, canvases.get(this)!, (style) => penColors.push(`${canvases.get(this)}:${String(style)}`));
    } as unknown as HTMLCanvasElement['getContext'];
    (globalThis as { Path2D?: unknown }).Path2D ??= class {};
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    canvases.set(canvas, 'main');
    const stroke: Stroke = { tool: 'ink', color: '#19e3ff', ...pen(), points: [[0.2, 0.2], [0.4, 0.2]] };
    const painted = document.createElement('canvas');
    const geo = { dpr: 1, box: { w: 64, h: 64 }, left: 0, top: 0 };
    const layers: PaintLayer[] = [
      { picture: paintStandIn({ painted, color: COLORS[0]!, strokes: [stroke] }, geo, 64, 64, 0), alpha: 1 },
      { picture: paintStandIn({ painted, color: COLORS[1]!, strokes: [] }, geo, 64, 64, 1), alpha: 1 },
    ];
    paint(canvas, geo, layers);
    expect(penColors).toEqual(['work:#19e3ff']);
    expect(log.filter((l) => l === 'main.stroke')).toEqual([]);
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
    for (const [x, y] of rest) act(() => { fireEvent.pointerMove(target, { clientX: x, clientY: y, pointerId: 1, pointerType }); });
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
    act(() => { fireEvent.pointerMove(cell, { clientX: b[0], clientY: b[1], pointerId: 1, pointerType: 'mouse' }); });
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
      act(() => { fireEvent.pointerMove(target, { clientX: b[0], clientY: b[1] + dy, pointerId: id, pointerType: 'mouse' }); });
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
    const at = (b: Box, dx = 0) => ({ clientX: (x + dx) * b.w, clientY: y * b.h, pointerId: 1, button: 0, pointerType: 'mouse' as const });
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
    const canvas = root.querySelector('canvas[data-kb-effect-ink]') as HTMLCanvasElement;
    expect(washed(root)[0], 'the frame takes the press where it now lives').toBeGreaterThan(0);
    expect(canvas.width, 'in the frame\'s box, not the cell\'s').toBe(600);
    const expected = new LayerInk(splatFor(0), Array.from({ length: PASSES }, () => ({ tool: 'wash', ...brushOf(BRUSH_PX, moved), points: [[x, y], [x + 0.06, y]] }) as Stroke), moved).washed;
    expect(washed(root)[0]).toBeCloseTo(expected, 1);
    const before = washed(root)[0]!;
    /* Back in the cell by appendChild alone: a press in its gutter, outside the frame, washes again. */
    frameBox = null;
    cell.append(root);
    const [x2, y2] = coreSpot(inkOf(0));
    const gutter = (dx: number) => ({ clientX: (x2 + dx) * boxNow().w, clientY: (y2 + 6 * LINE_PX / boxNow().h) * boxNow().h, pointerId: 2, button: 0, pointerType: 'mouse' as const });
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
    act(() => { fireEvent.pointerMove(frame, { clientX: a[0], clientY: a[1], pointerId: 1, pointerType: 'mouse' }); });
    expect(vi.mocked(cursor.over), 'one move is read once').toHaveBeenCalledTimes(1);
    vi.mocked(cursor.over).mockClear();
    act(() => { fireEvent.pointerDown(frame, { clientX: a[0], clientY: a[1], pointerId: 1, button: 0, pointerType: 'mouse' }); });
    expect(vi.mocked(cursor.press), 'one press is taken once').toHaveBeenCalledTimes(1);
    act(() => { fireEvent.pointerMove(frame, { clientX: b[0], clientY: b[1], pointerId: 1, pointerType: 'mouse' }); });
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

  test('the ink canvas holds at most 4 million pixels: a 390x20000 body gets a density under 1', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    boxWidth = 390;
    boxHeight = 20_000;
    const { root } = mount();
    const canvas = root.querySelector('canvas[data-kb-effect-ink]') as HTMLCanvasElement;
    expect(canvas.width).toBeLessThan(390);
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(4_000_000);
  });

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

  test('the suds canvas is the ink\'s size and place, registered while the post is near with its box and density, and let go when it leaves', () => {
    const watchers: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
    vi.stubGlobal('IntersectionObserver', class {
      constructor(watch: (entries: { isIntersecting: boolean }[]) => void) { watchers.push(watch); }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const see = (isIntersecting: boolean) => act(() => { watchers.forEach((w) => w([{ isIntersecting }])); });
    const { root, unmount } = mount();
    see(true);
    const [ink, sud] = [...root.querySelectorAll<HTMLCanvasElement>('canvas')];
    expect(sud).toHaveAttribute('data-kb-effect-ink');
    expect([sud!.width, sud!.height, sud!.style.left, sud!.style.top]).toEqual([ink!.width, ink!.height, ink!.style.left, ink!.style.top]);
    expect(ink!.compareDocumentPosition(sud!) & Node.DOCUMENT_POSITION_FOLLOWING, 'the suds are over the ink').toBeTruthy();
    const last = vi.mocked(suds.register).mock.calls.at(-1)!;
    expect(last[1]).toBe(sud);
    expect(last[2]).toEqual(boxNow());
    expect(last[3]).toBe(1);
    const host = last[0];
    see(false);
    expect(vi.mocked(suds.unregister)).toHaveBeenCalledWith(host);
    see(true);
    expect(vi.mocked(suds.register).mock.calls.at(-1)![0]).toBe(host);
    unmount();
    expect(vi.mocked(suds.unregister).mock.calls.at(-1)![0]).toBe(host);
  });

  describe('the drawn cursor', () => {
    const over = vi.mocked(cursor.over);
    const move = (target: HTMLElement, at: readonly [number, number], pointerType = 'mouse') => act(() => { fireEvent.pointerMove(target, { clientX: px(...at)[0], clientY: px(...at)[1], pointerId: 1, pointerType }); });
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
      act(() => { fireEvent.pointerMove(frame, { clientX: rest[0]![0], clientY: rest[0]![1], pointerId: 1, pointerType: 'mouse' }); });
      /* A finger taps while the pen is down: the pen's stroke is the one live, and stays so. */
      const tap = px(0.5, 0.5);
      touch(cell, 'touchstart', [{ id: 7, at: tap }], [{ id: 7, at: tap }]);
      touch(cell, 'touchend', [], [{ id: 7, at: tap }]);
      act(() => { fireEvent.pointerMove(frame, { clientX: rest[1]![0], clientY: rest[1]![1], pointerId: 1, pointerType: 'mouse' }); });
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

  test('the pixel density is capped at two', () => {
    vi.stubGlobal('devicePixelRatio', 3);
    expect(mount().root.querySelector('canvas')!.width).toBe(MAX_FRAME * 2);
  });

  test('below the cap the density is the screen\'s own', () => {
    vi.stubGlobal('devicePixelRatio', 1.5);
    expect(mount().root.querySelector('canvas')!.width).toBe(MAX_FRAME * 1.5);
  });

  test('a post not near the viewport draws no canvas, and one that comes near draws it, hidden from a screen reader', () => {
    const see = stubObserver();
    const { root } = mount();
    expect(canvases(root)).toHaveLength(0);
    see(true);
    /* The ink, and the suds over it. */
    expect(canvases(root)).toHaveLength(2);
    for (const canvas of canvases(root)) expect(canvas).toHaveAttribute('aria-hidden', 'true');
    see(false);
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

  test('the ink is drawn at the box\'s origin in its canvas, whatever the frame\'s offset in the cell', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    (globalThis as { Path2D?: unknown }).Path2D ??= class {};
    /* The frame sits 9.875px right and 7.5px down in the cell. */
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const at = this.classList.contains('kb-whoops-frame') ? { left: 9.875, top: 7.5 } : { left: 0, top: 0 };
      return { ...at, right: at.left, bottom: at.top, width: 0, height: 0, x: at.left, y: at.top, toJSON() {} } as DOMRect;
    };
    const drawn: unknown[][] = [];
    const moved: unknown[][] = [];
    const canvases = new Map<HTMLCanvasElement, string>();
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
      if (!canvases.has(this)) canvases.set(this, canvases.size === 0 ? 'main' : 'work');
      const state: Record<string, unknown> = {};
      return new Proxy({}, {
        get: (_t, key: string) => (key in state ? state[key] : (...args: unknown[]) => {
          if (key === 'drawImage' && args.length === 5) drawn.push(args);
          if (key === 'setTransform') moved.push(args);
          if (key === 'createImageData') return { data: new Uint8ClampedArray(Number(args[0]) * Number(args[1]) * 4) };
          if (key === 'createRadialGradient' || key === 'createLinearGradient') return { addColorStop() {} };
          return undefined;
        }),
        set: (_t, key: string, value) => { state[key] = value; return true; },
      });
    } as unknown as HTMLCanvasElement['getContext'];
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(drawn.length).toBeGreaterThan(0);
    for (const [, x, y] of drawn) expect([x, y]).toEqual([0, 0]);
    for (const m of moved) expect([m[4], m[5]]).toEqual([0, 0]);
  });
});

/* ------------------------------------------------------------ the ink field: what is drawn ---- */

describe('the ink field: the picture a layer is drawn from', () => {
  const clock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  const frames = () => act(() => { vi.advanceTimersByTime(60); });

  interface Fake { w: number; h: number; surface: Uint8ClampedArray; puts: { sx: number; sy: number; sw: number; sh: number }[]; draws: HTMLCanvasElement[]; strokes: number }
  /** 2D contexts that keep what is put on them, so a test reads a canvas's pixels (jsdom has none), and log what is drawn onto it. */
  function fakeCanvases() {
    const fakes = new Map<HTMLCanvasElement, Fake>();
    const of = (c: HTMLCanvasElement): Fake => {
      let f = fakes.get(c);
      if (!f) { f = { w: -1, h: -1, surface: new Uint8ClampedArray(0), puts: [], draws: [], strokes: 0 }; fakes.set(c, f); }
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
    const requested: string[] = [], cancelled: string[] = [];
    let hold = holding;
    const client: BuildClient = {
      requestBuild(key, input, onDone) {
        requested.push(key);
        if (hold) asks.set(key, { input, onDone }); else onDone(buildLayer(input));
      },
      cancel(key) { cancelled.push(key); asks.delete(key); },
      active: () => false,
    };
    seam.client = client;
    return {
      requested, cancelled, asks,
      release: () => act(() => { hold = false; for (const [k, a] of [...asks]) { asks.delete(k); a.onDone(buildLayer(a.input)); } }),
    };
  }

  /** A pointer event with a time of its own (jsdom stamps every event within a millisecond of the last). */
  function at(el: HTMLElement, type: 'pointerDown' | 'pointerMove' | 'pointerUp', [x, y]: readonly [number, number], t: number) {
    const [cx, cy] = px(x, y);
    const ev = createEvent[type](el, { clientX: cx, clientY: cy, pointerId: 1, button: 0, pointerType: 'mouse' });
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
  const referenceOf = (strokes: readonly Stroke[], layer = 0) => buildLayer({ seed: SEEDS[layer]!, color: COLORS[layer]!, box: boxNow(), density: 1, strokes }).image.data;
  const inkCanvas = (root: HTMLElement) => root.querySelector<HTMLCanvasElement>('canvas[data-kb-effect-ink]')!;
  /** What `paint` last drew on the ink canvas: the layer's picture, and whether it is a build's (put on) or the stand-in's (drawn). */
  const lastPicture = (fk: ReturnType<typeof fakeCanvases>, root: HTMLElement) => {
    const src = fk.of(inkCanvas(root)).draws.at(-1)!;
    return { src, build: fk.of(src).puts.length > 0 };
  };
  const maxDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!)); return m; };

  test('the premise: the line below is on bare paper on layer 0', () => {
    const ink = inkOf(0);
    for (let x = 0; x <= 0.15; x += 0.01) for (let y = 0.96; y <= 1; y += 0.01) expect(ink.valueAt(x, y), `${x},${y}`).toBe(0);
  });

  test('a pen stroke on a light layer changes the picture inside its rectangle and nowhere else', () => {
    clock();
    const fk = fakeCanvases();
    const { frame, root } = mount({ author: true });
    writeInk();
    frames();
    const first = lastPicture(fk, root);
    expect(first.build, 'a light layer is built before its first frame').toBe(true);
    const picture = fk.of(first.src);
    const before = Uint8ClampedArray.from(picture.surface);
    const puts = picture.puts.length;
    dragTimed(frame, BARE, 100);
    frames();
    expect(lastPicture(fk, root).src, 'the same canvas is updated in place').toBe(first.src);
    /* The stroke's reach: 2r = 16px each side of the line, and a pixel of shading around that. */
    const b = boxNow();
    /* The line's reach is 2r = 16px, and the bulb at its end (1.35r, reaching twice that) a little further: 26 all round. */
    const [x0, x1, y0, y1] = [0.03 * b.w - 26, 0.13 * b.w + 26, 0.985 * b.h - 26, 0.985 * b.h + 26];
    let changed = 0;
    for (let y = 0; y < picture.h; y++) for (let x = 0; x < picture.w; x++) {
      const i = (y * picture.w + x) * 4;
      if (before[i]! === picture.surface[i]! && before[i + 1]! === picture.surface[i + 1]! && before[i + 2]! === picture.surface[i + 2]! && before[i + 3]! === picture.surface[i + 3]!) continue;
      changed++;
      expect(x >= x0 && x <= x1 && y >= y0 && y <= y1, `pixel ${x},${y} changed outside the stroke's rectangle`).toBe(true);
    }
    expect(changed).toBeGreaterThan(500);
    /* Only that rectangle was put on the canvas. */
    const newPuts = picture.puts.slice(puts);
    expect(newPuts.length).toBeGreaterThan(0);
    for (const r of newPuts) expect([r.sx >= x0 - 2, r.sx + r.sw <= x1 + 2, r.sy >= y0 - 2, r.sy + r.sh <= y1 + 2], `put ${JSON.stringify(r)}`).toEqual([true, true, true, true]);
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
    const flat = fk.of(stand.src).strokes;
    dragTimed(frame, BARE, 100);
    frames();
    expect(lastPicture(fk, root).build).toBe(false);
    expect(fk.of(lastPicture(fk, root).src).strokes, 'the stroke is drawn flat by the stand-in').toBeGreaterThan(flat);
    held.release();
    frames();
    const done = lastPicture(fk, root);
    expect(done.build, 'released, the build').toBe(true);
    const line = penOn(BARE, 0);
    const got = fk.of(done.src).surface;
    expect(maxDiff(got, referenceOf([line])), 'the stroke is in the build, as if it had been in it from the first').toBeLessThanOrEqual(4);
    expect(maxDiff(got, referenceOf([line, line])), 'and it is in once: twice would be a wider line').toBeGreaterThan(8);
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
    expect(maxDiff(fk.of(done.src).surface, referenceOf([line]))).toBeLessThanOrEqual(4);
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
    expect(first).toHaveLength(1);
    /* Another device saves a dab: the layer is built again, from its strokes, this one in them. The first request is let go. */
    const dab: Stroke = { tool: 'wash', ...brush(), points: [[0.5, 0.2]] };
    hear({ 'play-1': { state: { strokes: [packStroke(dab)] }, savedAt: SAVED_AT } });
    frames();
    expect(held.cancelled).toContain(first[0]);
    expect(held.asks.size).toBe(1);
    expect([...held.asks.keys()][0]).not.toBe(first[0]);
    /* The new request holds what the other device saved, and the stroke as it is kept (simplified, its drops on it). */
    const asked = [...held.asks.values()][0]!.input.strokes;
    expect(asked.map((s) => s.tool)).toEqual(['wash', 'ink']);
    held.release();
    frames();
    const done = lastPicture(fk, root);
    expect(done.build).toBe(true);
    const kept = asked[1]!;
    expect(maxDiff(fk.of(done.src).surface, referenceOf([dab, kept])), 'the stroke is in it, once').toBeLessThanOrEqual(4);
    expect(maxDiff(fk.of(done.src).surface, referenceOf([dab, kept, kept]))).toBeGreaterThan(8);
  });

  test('a rebuild of the model in the middle of a stroke does not leave the rest of it on a dead model', () => {
    const { frame, root, replay } = mount();
    const [x, y] = inkSpot(inkOf(0));
    const path: Pt[] = [[x, y], [x + 0.01, y], [x + 0.02, y], [x + 0.03, y], [x + 0.04, y], [x + 0.05, y]];
    const px2 = (p: Pt) => px(p[0], p[1]);
    act(() => { fireEvent.pointerDown(frame, { clientX: px2(path[0]!)[0], clientY: px2(path[0]!)[1], pointerId: 1, button: 0, pointerType: 'mouse' }); });
    for (const p of path.slice(1, 3)) act(() => { fireEvent.pointerMove(frame, { clientX: px2(p)[0], clientY: px2(p)[1], pointerId: 1, pointerType: 'mouse' }); });
    replay();
    for (const p of path.slice(3)) act(() => { fireEvent.pointerMove(frame, { clientX: px2(p)[0], clientY: px2(p)[1], pointerId: 1, pointerType: 'mouse' }); });
    act(() => { fireEvent.pointerUp(frame, { clientX: px2(path.at(-1)!)[0], clientY: px2(path.at(-1)!)[1], pointerId: 1, pointerType: 'mouse' }); });
    const whole = inkOf(0, [{ tool: 'wash', ...brush(), points: path }]);
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
    const watchers: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
    vi.stubGlobal('IntersectionObserver', class {
      constructor(watch: (entries: { isIntersecting: boolean }[]) => void) { watchers.push(watch); }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const see = (isIntersecting: boolean) => act(() => { watchers.forEach((w) => w([{ isIntersecting }])); });
    const held = heldClient(false);
    const { root } = mount();
    see(true);
    frames();
    expect(root.dataset.kbPictures, 'built for the post that is near').toBe('1');
    expect(held.requested).toHaveLength(1);
    see(false);
    frames();
    expect(root.dataset.kbPictures, 'the cache is empty').toBe('0');
    see(true);
    frames();
    expect(root.dataset.kbPictures).toBe('1');
    expect(held.requested, 'and built again').toHaveLength(2);
  });

  test('a build still out when the post leaves is dropped, and its answer is not used', () => {
    clock();
    fakeCanvases();
    const watchers: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
    vi.stubGlobal('IntersectionObserver', class {
      constructor(watch: (entries: { isIntersecting: boolean }[]) => void) { watchers.push(watch); }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const see = (isIntersecting: boolean) => act(() => { watchers.forEach((w) => w([{ isIntersecting }])); });
    const held = heldClient();
    const { root } = mount();
    see(true);
    frames();
    const [key] = [...held.asks.keys()];
    expect(key).toBeDefined();
    see(false);
    expect(held.cancelled).toContain(key);
    held.release();
    frames();
    expect(root.dataset.kbPictures).toBe('0');
  });

  /** A post that goes far from the viewport and comes back, and the build client held by the test. */
  function viewport() {
    const watchers: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
    vi.stubGlobal('IntersectionObserver', class {
      constructor(watch: (entries: { isIntersecting: boolean }[]) => void) { watchers.push(watch); }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    return (isIntersecting: boolean) => act(() => { watchers.forEach((w) => w([{ isIntersecting }])); });
  }

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
    expect(held.asks.size, 'only the new size is waited for').toBe(1);
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
    const got = fk.of(done.src).surface;
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
    expect(maxDiff(fk.of(done.src).surface, referenceOf(made)), 'the picture holds them').toBeLessThanOrEqual(4);
    expect(maxDiff(fk.of(done.src).surface, referenceOf([])), 'and is not the untouched layer').toBeGreaterThan(8);
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
    expect(maxDiff(fk.of(picture.src).surface, referenceOf(kept)), 'the picture is the grid the strokes were applied to').toBeLessThanOrEqual(4);
    /* The grid as built from the same strokes, read at the model's cell centers. */
    const box = boxNow();
    const model = inkOf(0, kept);
    const grid = buildLayer({ seed: SEEDS[0]!, color: COLORS[0]!, box, density: 1, strokes: kept });
    const once = buildLayer({ seed: SEEDS[0]!, color: COLORS[0]!, box, density: 1, strokes: [] });
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
    expect(root.dataset.kbPictures, 'drawn from a build').toBe('1');
    scrubTo(frame, root, 0, inkOf(0), 0.96);
    frames();
    expect(states(root)).toEqual(['clean']);
    expect(root.dataset.kbPictures, 'nothing is held for a layer that is gone').toBe('0');
    expect(held.cancelled.length, 'its build slot was let go').toBeGreaterThanOrEqual(1);
  }, 60_000);

  test('a layer is asked for with the key of its strokes, so a stroke changes it', () => {
    clock();
    fakeCanvases();
    const held = heldClient(false);
    mount({ states: { 'play-1': { state: { strokes: [packStroke({ tool: 'wash', ...brush(), points: [[0.5, 0.5], [0.6, 0.5]] })] }, savedAt: SAVED_AT } } });
    frames();
    expect(held.requested).toEqual([layerKey('play-1', boxNow(), 1, [{ tool: 'wash', ...brush(), points: [[0.5, 0.5], [0.6, 0.5]] }])]);
  });
});
