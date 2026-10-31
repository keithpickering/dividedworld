/**
 * Whoops!'s drawing (cards plan Task 5; design section 11), as a reader and the post's author meet it.
 * jsdom has no layout and no canvas, so the layout's measures are stubbed and the model the component
 * keeps (which layers are live, how much of each is washed, which lines are read) is read from the
 * attributes it publishes; the pure rules behind them are scrub.test.ts's, and the pixels are the board
 * match's and e2e/whoops.spec.ts's.
 */
import { act, fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CardPlay, EffectProps } from '../../../../engine/ui/cards/types.ts';
import type { Act, EffectState } from '../../../../engine/ui/data/api.ts';
import { renderInWorld } from '../../../../engine/ui/test-world.tsx';
import { whoops } from '../whoops.ts';
import { LOST_ANSWER } from '../../../../engine/ui/data/api.ts';
import { Effect, MAX_SAVE_RETRIES, RETRY_AFTER_MS, SAVE_AFTER_MS } from './Effect.tsx';
import { paint, type PaintLayer } from './paint.ts';
import { BRUSH, LayerInk, PEN, REF_WIDTH, ROW, layoutOf, type Stroke } from './scrub.ts';
import { makeSplat } from './splat.ts';

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
/** The pen strokes' tests lie below every splat (at the 790px layout a splat reaches 1.8 widths down, 78 lines of 18px) and lay the post out this tall. */
const TEXT_LINES = 90;
const LINE_PX = 18;
/** Each line of the post's text is exactly this long, so a word's place in the text is its line. */
const LINE_CHARS = 24;
const textOf = (lines: number) => Array.from({ length: lines }, (_, k) => `L${String(k).padStart(2, '0')} alpha beta gamma`.padEnd(LINE_CHARS)).join('');
const HEIGHT = (LINES * LINE_PX) / REF_WIDTH;
/** The thread's body at the board's widest, and a phone's: where a splatted post is laid out, and where it is scaled down to. */
const MAX_FRAME = REF_WIDTH;
const PHONE_FRAME = 390;

const slots: HTMLElement[] = [];
let frameWidth = MAX_FRAME;
/** How many lines tall the post is laid out; an edit changes it. */
let layoutLines = LINES;

beforeEach(() => {
  frameWidth = MAX_FRAME;
  layoutLines = LINES;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get(this: HTMLElement) { return this.classList?.contains('kb-whoops-frame') ? frameWidth : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get(this: HTMLElement) { return this.classList?.contains('kb-whoops-layout') ? layoutLines * LINE_PX : 0; } });
  /* A word's box: its line down the layout, at the scale the frame gives. */
  Range.prototype.getClientRects = function (this: Range) {
    const unit = REF_WIDTH * layoutOf(frameWidth).scale;
    const top = Math.floor(this.startOffset / LINE_CHARS) * ROW * unit;
    return [{ top, bottom: top + ROW * unit, left: 0, right: 1, width: 1, height: ROW * unit, x: 0, y: top }] as unknown as DOMRectList;
  };
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  document.documentElement.removeAttribute('data-kb-motion');
});

afterEach(() => {
  while (slots.length > 0) slots.pop()!.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-kb-motion');
  delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
  delete (HTMLElement.prototype as { offsetHeight?: unknown }).offsetHeight;
  delete (Range.prototype as { getClientRects?: unknown }).getClientRects;
});

const POST = { id: 'post-1', character: 'someone', kind: 'post', thread: 't', payload: {}, currentPayload: {}, targetActId: null, seq: 41, createdAt: '2026-10-29T21:14:00.000Z', editedAt: null, shownEditedAt: null } as unknown as Act;

function playOf(n: number, color: string, seed: number): CardPlay {
  return { id: `play-${n}`, card: 'whoops', layer: n, caster: 'caster', message: '', config: { color, seed }, playedAt: `2026-10-29T21:0${n}:00.000Z`, post: POST.id };
}
const SEEDS = [21, 22, 23];
const COLORS = ['#ff2bd6', '#19e3ff', '#ffd93d'];
const plays = (n: number) => Array.from({ length: n }, (_, i) => playOf(i + 1, COLORS[i]!, SEEDS[i]!));
const splatFor = (i: number) => makeSplat(SEEDS[i]!);

const ok = async (play: string) => ({ ok: true as const, value: { play, savedAt: '2026-10-29T22:00:00.000Z' } });

interface Options {
  readonly layers?: number;
  readonly states?: Record<string, EffectState>;
  readonly author?: boolean;
  readonly save?: EffectProps['save'];
  /** The instance's share washed that counts as clean; null is an instance whose settings carry none. */
  readonly clean?: number | null;
}

function mount(o: Options = {}) {
  const save = o.save ?? vi.fn(ok as unknown as EffectProps['save']);
  /* The place the engine gives an effect outside the post's 2003 chrome: a strip under the post (engine/ui/cards/Effects.tsx). */
  const slot = document.createElement('div');
  slot.className = 'kb-act-slot';
  document.body.append(slot);
  slots.push(slot);
  const props: EffectProps = {
    slot, post: POST, plays: plays(o.layers ?? 1), states: o.states ?? {}, released: new Set(), reader: { author: o.author ?? false, caster: false },
    place: 'thread', save, release: async (play) => ({ ok: true, value: { play, releasedAt: '' } }), children: <p>{textOf(layoutLines)}</p>,
  };
  /* The saved states arrive from outside, as another device's save is heard: the host holds them and lets a test push a new set. */
  let push: (next: Record<string, EffectState>) => void = () => {};
  function Host() {
    const [held, set] = useState(props.states);
    push = set;
    return <Effect {...props} states={held} />;
  }
  const world = renderInWorld(<Host />, { settings: { cardSettings: o.clean === null ? {} : { 'whoops.clean': o.clean ?? 95 } } });
  const root = world.container.querySelector('.kb-whoops') as HTMLElement;
  return { ...world, slot, save: save as ReturnType<typeof vi.fn>, root, frame: world.container.querySelector('.kb-whoops-frame') as HTMLElement, hear: (next: Record<string, EffectState>) => act(() => push(next)) };
}

/** The washed share of each layer, as the component publishes it. */
const washed = (root: HTMLElement) => root.dataset.kbWashed!.split(' ').map(Number);
const states = (root: HTMLElement) => root.dataset.kbLayers!.split(' ');
const readout = (root: HTMLElement) => root.querySelector('[data-kb-readout]')?.textContent ?? '';

/** Screen coordinates, for a point in widths of the layout. */
const px = (x: number, y: number): [number, number] => {
  const l = layoutOf(frameWidth);
  return [l.offset + x * l.width, y * l.width];
};

function drag(frame: HTMLElement, points: readonly (readonly [number, number])[]) {
  const [first, ...rest] = points.map(([x, y]) => px(x, y));
  act(() => { fireEvent.pointerDown(frame, { clientX: first![0], clientY: first![1], pointerId: 1, button: 0, pointerType: 'mouse' }); });
  for (const [x, y] of rest) act(() => { fireEvent.pointerMove(frame, { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse' }); });
  const [lx, ly] = rest[rest.length - 1] ?? first!;
  act(() => { fireEvent.pointerUp(frame, { clientX: lx, clientY: ly, pointerId: 1, pointerType: 'mouse' }); });
}

/** A point on the splat's ink, in widths: the middle of the first row that has any. */
function inkSpot(ink: LayerInk): [number, number] {
  const { cx, cy } = ink.splat.placement;
  return ink.has(cx, cy) ? [cx, cy] : [cx, cy + 0.05];
}

/** The points of a drag along y across the ink there: from its first inked point to its last. */
function rowAcross(ink: LayerInk, y: number): [number, number][] {
  const row: [number, number][] = [];
  for (let x = -0.2; x <= 1.2; x += 0.01) if (ink.has(x, y)) row.push([x, y]);
  return row.filter((_, i) => i === 0 || i % 5 === 0 || i === row.length - 1);
}

/** Drag rows across a layer's ink until it is washed to `share`, as a hand would. */
function scrubTo(frame: HTMLElement, root: HTMLElement, layer: number, ink: LayerInk, share: number) {
  const { minY, maxY } = ink.splat.bounds;
  for (let y = minY; y <= maxY && washed(root)[layer]! < share; y += BRUSH * 0.7) {
    const row = rowAcross(ink, y);
    if (row.length >= 2) {
      drag(frame, row);
      ink.wash(row, BRUSH);
    }
  }
}

describe('the layers', () => {
  test('a post with three plays draws three layers, the latest on top, and still draws its words', () => {
    const { root } = mount({ layers: 3 });
    expect(states(root)).toEqual(['live', 'live', 'live']);
    expect(washed(root)).toEqual([0, 0, 0]);
    expect(root).toHaveTextContent('L00 alpha beta gamma');
  });

  test('the post\'s words are laid out at the body\'s width at the board\'s max and scaled as a whole to a narrower frame, never scaled up', () => {
    const atMax = mount();
    const layout = atMax.root.querySelector('.kb-whoops-layout') as HTMLElement;
    expect(layout.style.width).toBe(`${REF_WIDTH}px`);
    expect(layout.style.transform).toBe('translateX(0px) scale(1)');
    /* The post body's own gutters (1% of it each side) are the layout's padding, so the words break where the post's own would. */
    expect(layout.style.paddingInline).toBe(`${REF_WIDTH * 0.01}px`);
    atMax.unmount();
    frameWidth = 1000;
    const wide = mount();
    expect((wide.root.querySelector('.kb-whoops-layout') as HTMLElement).style.transform).toBe(`translateX(${(1000 - REF_WIDTH) / 2}px) scale(1)`);
    wide.unmount();
    frameWidth = PHONE_FRAME;
    const narrow = mount();
    const small = narrow.root.querySelector('.kb-whoops-layout') as HTMLElement;
    expect(small.style.transform).toBe(`translateX(0px) scale(${PHONE_FRAME / REF_WIDTH})`);
    expect((narrow.frame as HTMLElement).style.height).toBe(`${LINES * LINE_PX * (PHONE_FRAME / REF_WIDTH)}px`);
  });

  test('a layer whose saved state says it is clean is not drawn, and the post is plain again', () => {
    const { root } = mount({ layers: 2, states: { 'play-2': { state: { strokes: [], clean: true }, savedAt: '2026-10-29T22:00:00.000Z' } } });
    expect(states(root)).toEqual(['live', 'clean']);
    const all = mount({ layers: 1, states: { 'play-1': { state: { strokes: [], clean: true }, savedAt: '2026-10-29T22:00:00.000Z' } } });
    expect(all.slot.querySelector('[data-kb-scrub]')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Hold to scrub' })).toHaveLength(1);
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
    const top = new LayerInk(splatFor(1), []);
    const [x, y] = inkSpot(top);
    drag(frame, [[x, y], [x + 0.05, y], [x + 0.1, y]]);
    expect(washed(root)[1]).toBeGreaterThan(0);
    expect(washed(root)[0]).toBe(0);
  });

  test('a stroke started where the top layer is gone scrubs the one under it', () => {
    const { frame, root } = mount({ layers: 2 });
    const top = new LayerInk(splatFor(1), []);
    const under = new LayerInk(splatFor(0), []);
    let spot: [number, number] | null = null;
    for (let y = 0.05; y < HEIGHT && !spot; y += 0.04) for (let x = 0.1; x < 0.9; x += 0.04) if (top.has(x, y) && under.has(x, y)) { spot = [x, y]; break; }
    expect(spot, 'two splats on one post overlap somewhere').not.toBeNull();
    /* Wash the top layer away around the spot, then start there again. */
    const around: [number, number][] = [[spot![0], spot![1]], [spot![0] + 0.06, spot![1]], [spot![0] + 0.12, spot![1]], [spot![0], spot![1]], [spot![0] - 0.06, spot![1]], [spot![0] - 0.12, spot![1]]];
    drag(frame, around);
    top.wash(around, BRUSH);
    const before = washed(root);
    expect(before[1]).toBeGreaterThan(0);
    expect(before[0]).toBe(0);
    drag(frame, [[spot![0], spot![1]], [spot![0] + 0.03, spot![1]], [spot![0] + 0.06, spot![1]]]);
    expect(washed(root)[0]).toBeGreaterThan(0);
  });

  test('a stroke that starts where there is no ink is left to the page: it is not caught and scrubs nothing', () => {
    const { frame, root } = mount();
    const prevented = vi.fn();
    /* React listens on its root, so the document sees an event after the page's handlers have had it. */
    const watch = (e: Event) => { if (e.defaultPrevented) prevented(); };
    document.addEventListener('pointerdown', watch);
    drag(frame, [[-0.2, 40], [0.2, 40]]);
    document.removeEventListener('pointerdown', watch);
    expect(washed(root)).toEqual([0]);
    expect(prevented).not.toHaveBeenCalled();
  });

  test('a reader\'s scrubbing is theirs alone: nothing is saved, and it is gone after a reload', () => {
    const first = mount();
    const [x, y] = inkSpot(new LayerInk(splatFor(0), []));
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
    const [x, y] = inkSpot(new LayerInk(splatFor(0), []));
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

  test('a stroke saved at the board\'s max uncovers the same words read at 390px', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const wide = mount({ author: true });
    const ink = new LayerInk(splatFor(0), []);
    const { cy } = ink.splat.placement;
    const line = Math.floor(cy / ROW);
    expect(readout(wide.root)).not.toContain(`L${String(line).padStart(2, '0')} `);
    const y = (line + 0.5) * ROW;
    drag(wide.frame, rowAcross(ink, y));
    act(() => { vi.advanceTimersByTime(2000); });
    const saved = wide.save.mock.calls[0]![1] as Record<string, unknown>;
    const readAtMax = readout(wide.root);
    expect(readAtMax).toContain(`L${String(line).padStart(2, '0')} alpha beta gamma`);
    wide.unmount();
    frameWidth = PHONE_FRAME;
    const narrow = mount({ states: { 'play-1': { state: saved, savedAt: '2026-10-29T22:00:00.000Z' } } });
    expect(readout(narrow.root)).toBe(readAtMax);
  });

  test('a layer washed clean at the instance\'s share fades on a reader\'s own screen, and nothing is saved', () => {
    const { frame, root, save } = mount({ clean: 40 });
    const ink = new LayerInk(splatFor(0), []);
    scrubTo(frame, root, 0, ink, 0.5);
    expect(states(root)).toEqual(['clean']);
    expect(save).not.toHaveBeenCalled();
  });

  test('the author reaching it marks the layer clean in the save, for everyone', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { frame, root, save } = mount({ author: true, clean: 40 });
    scrubTo(frame, root, 0, new LayerInk(splatFor(0), []), 0.5);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(states(root)).toEqual(['clean']);
    const state = save.mock.calls.at(-1)![1] as { clean?: boolean; strokes: unknown[] };
    expect(state.clean).toBe(true);
    expect(whoops.validateState!(state).ok).toBe(true);
  });

  test('a saved state that arrives clean fades the layer for a reader who is looking', () => {
    const { root, hear } = mount();
    expect(states(root)).toEqual(['live']);
    hear({ 'play-1': { state: { strokes: [], clean: true }, savedAt: '2026-10-29T22:00:00.000Z' } });
    expect(states(root)).toEqual(['clean']);
    expect(root).toHaveAttribute('data-kb-fading', 'true');
  });
});

describe('the words and controls are glass, outside the post (the owner\'s notes on #80)', () => {
  test('the hint, "Hold to scrub" and the author\'s tools are one glass element in the strip under the post, and the post\'s own body holds none of them', () => {
    const { root, slot } = mount({ author: true });
    const strip = slot.querySelector('.kb-effect-strip') as HTMLElement;
    expect(strip).not.toBeNull();
    expect(slot.querySelectorAll('.kb-effect-strip')).toHaveLength(1);
    expect(strip).toHaveClass('kb-glass');
    expect(strip).toHaveTextContent('This post is splatted. Drag across the ink to scrub it on your screen.');
    for (const name of ['Hold to scrub', 'Wash', 'Write in ink']) {
      const button = screen.getByRole('button', { name });
      expect(strip).toContainElement(button);
      expect(root).not.toContainElement(button);
    }
    expect(root.textContent).not.toMatch(/splatted|Yours to wash/u);
    expect(root.querySelector('button')).toBeNull();
  });
  test('the plate\'s readout names the card and counts the layers and the share washed, with one bar of the meter for each layer', () => {
    const { slot } = mount({ layers: 3 });
    const strip = slot.querySelector('.kb-effect-strip') as HTMLElement;
    expect(strip.querySelector('.kb-plate-name')).toHaveTextContent('Whoops!');
    expect(strip.querySelector('.kb-plate-state')).toHaveTextContent(/^3 layers · 0% washed$/u);
    expect(strip.querySelectorAll('.kb-whoops-meter > *')).toHaveLength(3);
  });
  test('one layer reads in the singular, with one bar', () => {
    const { slot } = mount({ layers: 1 });
    expect(slot.querySelector('.kb-plate-state')).toHaveTextContent(/^1 layer · 0% washed$/u);
    expect(slot.querySelectorAll('.kb-whoops-meter > *')).toHaveLength(1);
  });
  test('the tiles are buttons with their names, and the author\'s two tools are toggles of which one is pressed', () => {
    const { slot } = mount({ author: true });
    const strip = slot.querySelector('.kb-effect-strip') as HTMLElement;
    for (const name of ['Hold to scrub', 'Wash', 'Write in ink']) expect(within(strip).getByRole('button', { name })).toHaveClass('kb-plate-tile');
    expect(within(strip).getByRole('button', { name: 'Hold to scrub' })).not.toHaveAttribute('aria-pressed');
    expect(within(strip).getByRole('button', { name: 'Wash' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(strip).getByRole('button', { name: 'Write in ink' })).toHaveAttribute('aria-pressed', 'false');
  });
  test('a strip is drawn only while a layer holds ink, and says nothing of itself to a post that is plain', () => {
    const { slot } = mount({ layers: 1, states: { 'play-1': { state: { strokes: [], clean: true }, savedAt: '2026-10-29T22:00:00.000Z' } } });
    expect(slot.querySelector('.kb-effect-strip')).toBeNull();
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
    frames(55000);
    expect(states(root)).toEqual(['clean']);
  }, 30_000);

  test('it scrubs the top layer, and the layer under it once the top one is gone', () => {
    clock();
    const { root } = mount({ layers: 2 });
    const button = screen.getByRole('button', { name: 'Hold to scrub' });
    hold(button);
    frames(60000);
    expect(states(root)[1]).toBe('clean');
    frames(60000);
    expect(states(root)).toEqual(['clean', 'clean']);
  }, 60_000);
});

describe('what a screen reader is given', () => {
  test('a line under ink is hidden from a screen reader as it is from the eye, and the lines clear of it are read', () => {
    /* A post tall enough that its last lines lie below the splat, which at the 790px layout reaches well down. */
    layoutLines = TEXT_LINES;
    const { root } = mount();
    const layout = root.querySelector('.kb-whoops-layout') as HTMLElement;
    expect(layout).toHaveAttribute('inert');
    const covered = Math.floor(new LayerInk(splatFor(0), []).splat.placement.cy / ROW);
    const text = readout(root);
    expect(text).not.toContain(`L${String(covered).padStart(2, '0')} `);
    expect(text).toContain(`L${TEXT_LINES - 2} alpha beta gamma`);
    expect(text).toContain(`L${TEXT_LINES - 1} alpha beta gamma`);
  });

  test('a line is read out once it is uncovered', () => {
    const { frame, root } = mount();
    const ink = new LayerInk(splatFor(0), []);
    const line = Math.floor(ink.splat.placement.cy / ROW);
    const name = `L${String(line).padStart(2, '0')} alpha beta gamma`;
    expect(readout(root)).not.toContain(name);
    const y = (line + 0.5) * ROW;
    drag(frame, rowAcross(ink, y));
    expect(readout(root)).toContain(name);
  });

  test('with no ink left, the post is plain: nothing hidden, nothing read twice', () => {
    const { root } = mount({ states: { 'play-1': { state: { strokes: [], clean: true }, savedAt: '2026-10-29T22:00:00.000Z' } } });
    expect(root.querySelector('.kb-whoops-layout')).not.toHaveAttribute('inert');
    expect(root.querySelector('[data-kb-readout]')).toBeNull();
  });
});

describe('motion', () => {
  const sudsAfterScrub = () => {
    const { frame, root } = mount();
    const [x, y] = inkSpot(new LayerInk(splatFor(0), []));
    drag(frame, [[x, y], [x + 0.05, y], [x + 0.1, y], [x + 0.15, y]]);
    return root.querySelectorAll('.kb-whoops-sud').length;
  };

  test('the brush throws soap suds', () => {
    expect(sudsAfterScrub()).toBeGreaterThan(0);
  });

  test('under reduced motion there are none, and the scrubbing still works', () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    expect(sudsAfterScrub()).toBe(0);
  });

  test('a layer washed clean fades; under reduced motion it is gone at once', () => {
    const fading = mount({ clean: 40 });
    scrubTo(fading.frame, fading.root, 0, new LayerInk(splatFor(0), []), 0.5);
    expect(fading.root).toHaveAttribute('data-kb-fading', 'true');
    fading.unmount();
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    const instant = mount({ clean: 40 });
    scrubTo(instant.frame, instant.root, 0, new LayerInk(splatFor(0), []), 0.5);
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
    expect(stroke.width).toBeLessThan(BRUSH);
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
    const [x, y] = inkSpot(new LayerInk(splatFor(0), []));
    drag(frame, [[x, y], [x + 0.06, y]]);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByRole('status')).toHaveTextContent('at most 200 strokes');
    expect(washed(root)[0]).toBeGreaterThan(0);
  });
});

describe('the author\'s pen strokes belong to their layer', () => {
  beforeEach(() => { layoutLines = TEXT_LINES; });
  /** The line index and a pen stroke along it, below where any splat of the test's seeds reaches (so only the pen covers it). */
  const penLine = Math.ceil(Math.max(...SEEDS.map((seed) => makeSplat(seed).bounds.maxY)) / ROW) + 2;
  const penAt = (line: number): Stroke => ({ tool: 'ink', color: COLORS[0]!, width: PEN, points: [[0, (line + 0.5) * ROW], [0.5, (line + 0.5) * ROW], [1, (line + 0.5) * ROW]] });
  const saved = (id: string, strokes: Stroke[]): Record<string, EffectState> => ({ [id]: { state: { strokes }, savedAt: '2026-10-29T22:00:00.000Z' } });
  const name = (line: number) => `L${String(line).padStart(2, '0')} alpha beta gamma`;

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
    drag(frame, [[0.1, (penLine + 0.5) * ROW], [0.3, (penLine + 0.5) * ROW], [0.5, (penLine + 0.5) * ROW], [0.7, (penLine + 0.5) * ROW], [0.9, (penLine + 0.5) * ROW]]);
    expect(readout(root)).toContain(name(penLine));
    expect(save).not.toHaveBeenCalled();
  });

  test('a pen stroke on layer 2 is under layer 3\'s ink: a stroke where both are scrubs layer 3', () => {
    const top = new LayerInk(splatFor(2), []);
    const [x, y] = inkSpot(top);
    const pen: Stroke = { tool: 'ink', color: COLORS[1]!, width: PEN, points: [[x - 0.05, y], [x + 0.05, y]] };
    const { frame, root } = mount({ layers: 3, states: saved('play-2', [pen]) });
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
    expect(root.querySelector('.kb-whoops-layout')).not.toHaveAttribute('inert');
    expect(root.querySelector('.kb-whoops-layout')).toHaveTextContent(name(penLine));
    expect(readout(root)).toBe('');
  }, 60_000);

  test('a reader\'s scrub of the author\'s pen is not saved, and the author\'s own is', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { frame, save } = mount({ author: true, states: saved('play-1', [penAt(penLine)]) });
    const y = (penLine + 0.5) * ROW;
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
    const pen: Stroke = { tool: 'ink', color: '#19e3ff', width: PEN, points: [[0.2, 0.2], [0.4, 0.2]] };
    const layers: PaintLayer[] = [
      { splat: splatFor(0), color: COLORS[0]!, strokes: [pen], alpha: 1 },
      { splat: splatFor(1), color: COLORS[1]!, strokes: [], alpha: 1 },
    ];
    paint(canvas, { dpr: 1, width: REF_WIDTH, offset: 0, top: 0, scale: 1 }, layers);
    expect(penColors).toEqual(['work:#19e3ff']);
    expect(log.filter((l) => l === 'main.stroke')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ the quality review ---- */

const SAVED_AT = '2026-10-29T22:00:00.000Z';
const settle = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const authorClock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
/** The three strokes a test makes, each on a row of its own, so none is a duplicate of another. */
const rows = () => {
  const [x, y] = inkSpot(new LayerInk(splatFor(0), []));
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
    const last = net.calls.at(-1)!.state as { strokes: Stroke[] };
    expect(last.strokes).toHaveLength(3);
    expect(last.strokes.map((s) => s.points[0]![1])).toEqual([a, b, c].map((r) => Math.round(r![0]![1] * 1000) / 1000));
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

describe('a save that did not get through', () => {
  const lost = { ok: false as const, error: LOST_ANSWER, uncertain: true as const };

  test('is sent again after a backoff, so a clean mark that failed reaches everyone, with no stroke after it', async () => {
    authorClock();
    const answers = [lost, lost];
    const save = vi.fn(async (play: string) => answers.shift() ?? { ok: true as const, value: { play, savedAt: SAVED_AT } });
    const { frame, root } = mount({ author: true, clean: 40, save: save as unknown as EffectProps['save'] });
    scrubTo(frame, root, 0, new LayerInk(splatFor(0), []), 0.5);
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
    expect(screen.queryByRole('status')).toBeNull();
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
    scrubTo(reaching.frame, reaching.root, 0, new LayerInk(splatFor(0), []), 0.5);
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
    const ink = new LayerInk(splatFor(0), []);
    const seen: { share: number; clean: boolean }[] = [];
    const { minY, maxY } = ink.splat.bounds;
    for (let y = minY; y <= maxY && states(root)[0] === 'live'; y += BRUSH * 0.2) {
      const row = rowAcross(ink, y);
      if (row.length < 2) continue;
      drag(frame, row);
      ink.wash(row, BRUSH);
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
      const ink = new LayerInk(splatFor(0), []);
      const { minY, maxY } = ink.splat.bounds;
      let share = 0;
      for (let y = minY; y <= maxY && share < 0.5 && states(root)[0] === 'live'; y += BRUSH * 0.7) {
        const row = rowAcross(ink, y);
        if (row.length >= 2) { drag(frame, row); share = washed(root)[0]!; }
      }
      return { state: states(root)[0], root };
    };
    const probe = reach(100);
    expect(probe.state).toBe('live');
    /* The unrounded share, as the ink holds it: read it back from a rebuild of the same strokes. */
    const mirror = new LayerInk(splatFor(0), [], { minX: 0, maxX: 1, minY: 0, maxY: HEIGHT });
    const { minY, maxY } = mirror.splat.bounds;
    let share = 0;
    for (let y = minY; y <= maxY && share < 0.5; y += BRUSH * 0.7) {
      const row = rowAcross(mirror, y);
      if (row.length >= 2) { mirror.wash(row, BRUSH); share = mirror.washed; }
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
    expect(canvases(root)).toHaveLength(1);
    expect(canvases(root)[0]).toHaveAttribute('aria-hidden', 'true');
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
    hear({ 'play-1': { state: { strokes: [{ tool: 'wash', width: BRUSH, points: [[0.5, 0.5]] }] }, savedAt: SAVED_AT } });
    expect(built.grids, 'a state from somewhere else').toBe(before + 1);
  });
});
