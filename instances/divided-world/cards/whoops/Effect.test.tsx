/**
 * Whoops!'s drawing (cards plan Task 5; design section 11), as a reader and the post's author meet it.
 * jsdom has no layout and no canvas, so the layout's measures are stubbed and the model the component
 * keeps (which layers are live, how much of each is washed, which lines are read) is read from the
 * attributes it publishes; the pure rules behind them are scrub.test.ts's, and the pixels are the board
 * match's and e2e/whoops.spec.ts's.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CardPlay, EffectProps } from '../../../../engine/ui/cards/types.ts';
import type { Act, EffectState } from '../../../../engine/ui/data/api.ts';
import { renderInWorld } from '../../../../engine/ui/test-world.tsx';
import { whoops } from '../whoops.ts';
import { Effect } from './Effect.tsx';
import { BRUSH, LayerInk, ROW, layoutOf } from './scrub.ts';
import { makeSplat } from './splat.ts';

const LINES = 30;
const LINE_PX = 18;
/** Each line of the post's text is exactly this long, so a word's place in the text is its line. */
const LINE_CHARS = 24;
const TEXT = Array.from({ length: LINES }, (_, k) => `L${String(k).padStart(2, '0')} alpha beta gamma`.padEnd(LINE_CHARS)).join('');
const HEIGHT = (LINES * LINE_PX) / 360;

let frameWidth = 620;
/** How many lines tall the post is laid out; an edit changes it. */
let layoutLines = LINES;

beforeEach(() => {
  frameWidth = 620;
  layoutLines = LINES;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get(this: HTMLElement) { return this.classList?.contains('kb-whoops-frame') ? frameWidth : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get(this: HTMLElement) { return this.classList?.contains('kb-whoops-layout') ? layoutLines * LINE_PX : 0; } });
  /* A word's box: its line down the layout, at the scale the frame gives. */
  Range.prototype.getClientRects = function (this: Range) {
    const unit = 360 * layoutOf(frameWidth).scale;
    const top = Math.floor(this.startOffset / LINE_CHARS) * ROW * unit;
    return [{ top, bottom: top + ROW * unit, left: 0, right: 1, width: 1, height: ROW * unit, x: 0, y: top }] as unknown as DOMRectList;
  };
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  document.documentElement.removeAttribute('data-kb-motion');
});

afterEach(() => {
  vi.useRealTimers();
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
  readonly clean?: number;
}

function mount(o: Options = {}) {
  const save = o.save ?? vi.fn(ok as unknown as EffectProps['save']);
  const props: EffectProps = {
    post: POST, plays: plays(o.layers ?? 1), states: o.states ?? {}, released: new Set(), reader: { author: o.author ?? false, caster: false },
    place: 'thread', save, release: async (play) => ({ ok: true, value: { play, releasedAt: '' } }), children: <p>{TEXT}</p>,
  };
  /* The saved states arrive from outside, as another device's save is heard: the host holds them and lets a test push a new set. */
  let push: (next: Record<string, EffectState>) => void = () => {};
  function Host() {
    const [held, set] = useState(props.states);
    push = set;
    return <Effect {...props} states={held} />;
  }
  const world = renderInWorld(<Host />, { settings: { cardSettings: { 'whoops.clean': o.clean ?? 95 } } });
  const root = world.container.querySelector('.kb-whoops') as HTMLElement;
  return { ...world, save: save as ReturnType<typeof vi.fn>, root, frame: world.container.querySelector('.kb-whoops-frame') as HTMLElement, hear: (next: Record<string, EffectState>) => act(() => push(next)) };
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

  test('the post\'s words are laid out at the reference width and scaled as a whole to the frame, centered, at most 1.5 times', () => {
    const wide = mount();
    const layout = wide.root.querySelector('.kb-whoops-layout') as HTMLElement;
    expect(layout.style.width).toBe('360px');
    expect(layout.style.transform).toBe('translateX(40px) scale(1.5)');
    wide.unmount();
    frameWidth = 320;
    const narrow = mount();
    const small = narrow.root.querySelector('.kb-whoops-layout') as HTMLElement;
    expect(small.style.transform).toBe(`translateX(0px) scale(${320 / 360})`);
    expect((narrow.frame as HTMLElement).style.height).toBe(`${LINES * LINE_PX * (320 / 360)}px`);
  });

  test('a layer whose saved state says it is clean is not drawn, and the post is plain again', () => {
    const { root } = mount({ layers: 2, states: { 'play-2': { state: { strokes: [], clean: true }, savedAt: '2026-10-29T22:00:00.000Z' } } });
    expect(states(root)).toEqual(['live', 'clean']);
    const all = mount({ layers: 1, states: { 'play-1': { state: { strokes: [], clean: true }, savedAt: '2026-10-29T22:00:00.000Z' } } });
    expect(all.root.querySelector('[data-kb-scrub]')).toBeNull();
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

  test('a stroke saved at 620px wide uncovers the same words at 320px', () => {
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
    const readAt620 = readout(wide.root);
    expect(readAt620).toContain(`L${String(line).padStart(2, '0')} alpha beta gamma`);
    wide.unmount();
    frameWidth = 320;
    const narrow = mount({ states: { 'play-1': { state: saved, savedAt: '2026-10-29T22:00:00.000Z' } } });
    expect(readout(narrow.root)).toBe(readAt620);
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
    const { root } = mount();
    const layout = root.querySelector('.kb-whoops-layout') as HTMLElement;
    expect(layout).toHaveAttribute('inert');
    const covered = Math.floor(new LayerInk(splatFor(0), []).splat.placement.cy / ROW);
    const text = readout(root);
    expect(text).not.toContain(`L${String(covered).padStart(2, '0')} `);
    expect(text).toContain(`L${LINES - 2} alpha beta gamma`);
    expect(text).toContain(`L${LINES - 1} alpha beta gamma`);
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
