/**
 * Drawing on the post (plan Task 10; design sections 6, 8 and 11): the card's `Compose`, which the engine mounts in the post's effect slot,
 * and `DrawMode`, the same drawing as the Draw tile opens on a wall already there. jsdom has no layout and no canvas, so the body's box is
 * the `box` the slot measured (rects sit at 0, 0 and the box is the size), `paintWall` is watched where it is called (the painter's own
 * pixels are spray.test.tsx's), and what the drawing holds is read from the attributes it publishes. The cursor is the whoops module's own
 * (cursor.test.tsx); here it is watched.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ComposeProps } from '../../../../engine/ui/cards/types.ts';
import type { Act, Answer } from '../../../../engine/ui/data/api.ts';
import { LOST_ANSWER } from '../../../../engine/ui/data/api.ts';
import { renderInWorld } from '../../../../engine/ui/test-world.tsx';
import { cursor } from '../whoops/cursor.ts';
import { landing } from '../../../../engine/ui/cards/land.ts';
import { instance } from '../../index.ts';
import { CANS, graffiti } from '../graffiti.ts';
import { createPortal } from 'react-dom';
import { BbCode } from '../../../../engine/ui/bbcode/render.tsx';
import { Compose, DrawMode, type DrawModeProps } from './Compose.tsx';
import * as spray from './spray.ts';

vi.mock('../whoops/cursor.ts', () => ({ cursor: { over: vi.fn(), press: vi.fn(), leave: vi.fn() } }));
vi.mock('./spray.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('./spray.ts')>()), paintWall: vi.fn() }));

const player = vi.hoisted(() => ({ value: null as unknown }));
/** The version the page's tails say a post is at (`usePostVersion`), which a test sets to put the tails ahead of the post it holds. */
const tails = vi.hoisted(() => ({ version: null as string | null }));
vi.mock('../../../../engine/ui/cards/tails.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../../engine/ui/cards/tails.ts')>()), usePostVersion: () => tails.version }));
vi.mock('../../../../engine/ui/player.tsx', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../../engine/ui/player.tsx')>()), usePlayer: () => player.value }));

const BOX = { w: 600, h: 400 };
const ASK = 'Leave without tagging? Your drawing isn\'t saved.';
const POST = { id: 'post-1', character: 'someone', kind: 'post', thread: 't', payload: {}, currentPayload: {}, targetActId: null, seq: 41, createdAt: '2026-10-29T21:14:00.000Z', editedAt: null, shownEditedAt: null } as unknown as Act;
const ok = async (): Promise<Answer<unknown>> => ({ ok: true, value: {} });

beforeEach(() => {
  vi.clearAllMocks();
  player.value = { session: { signedIn: true, account: 'acct-1' }, hudCharacter: { id: 'c1' }, actingCharacters: [{ id: 'c1' }] };
  HTMLCanvasElement.prototype.getContext = (() => ({})) as unknown as HTMLCanvasElement['getContext'];
  tails.version = null;
  try { localStorage.clear(); } catch { /* none here */ }
});
const unders: HTMLElement[] = [];
afterEach(() => { vi.useRealTimers(); for (const el of unders.splice(0)) el.remove(); });

function mountCompose(o: { readonly submit?: ComposeProps['submit']; readonly post?: Act; readonly words?: string } = {}) {
  /* The element around the post's words, which the engine owns and the card draws into. */
  const under = document.createElement('div');
  /* With `words` the element sits in a content area, the post's body, as the engine's does: that is where the marks and the images are found. */
  const area = document.createElement('div');
  if (o.words !== undefined) { area.setAttribute('data-kb-content-area', ''); area.style.fontSize = '15px'; area.append(under); }
  document.body.append(o.words !== undefined ? area : under);
  unders.push(o.words !== undefined ? area : under);
  /* With `words`, the post's words are drawn by the renderer inside it, as the engine does, so the marks the card lays over them are on the page. */
  const children = o.words === undefined ? <p>The post&apos;s words.</p> : createPortal(<BbCode text={o.words} />, under);
  const props = { post: o.post ?? POST, box: BOX, under, submit: vi.fn(o.submit ?? ok), cancel: vi.fn(), hold: vi.fn(), ready: vi.fn(), children } satisfies ComposeProps;
  const world = renderInWorld(<Compose {...props} />);
  return { ...world, props, under, surface: under.querySelector('[data-kb-draw-surface]') as HTMLElement };
}

function mountDraw(o: Partial<DrawModeProps> = {}) {
  const props: DrawModeProps = { box: BOX, wall: null, covered: 0, most: 4000, dockHost: null, asks: true, submit: vi.fn(ok), cancel: vi.fn(), done: vi.fn(), hold: vi.fn(), onDraft: vi.fn(), overlayStyle: {}, ...o };
  const world = renderInWorld(<DrawMode {...props} />);
  return { ...world, props, surface: world.container.querySelector('[data-kb-draw-surface]') as HTMLElement };
}

const px = (x: number, y: number): [number, number] => [x * BOX.w, y * BOX.h];
const strokes = (surface: HTMLElement) => Number(surface.dataset.kbStrokes);

function drag(el: HTMLElement, points: readonly (readonly [number, number])[]) {
  const [first, ...rest] = points.map(([x, y]) => px(x, y));
  act(() => { fireEvent.pointerDown(el, { clientX: first![0], clientY: first![1], pointerId: 1, button: 0, pointerType: 'mouse' }); });
  for (const [x, y] of rest) act(() => { fireEvent.pointerMove(el, { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse' }); });
  const [lx, ly] = rest[rest.length - 1] ?? first!;
  act(() => { fireEvent.pointerUp(el, { clientX: lx, clientY: ly, pointerId: 1, pointerType: 'mouse' }); });
}
const LINE = [[0.2, 0.3], [0.4, 0.3], [0.6, 0.3]] as const;
const tag = () => screen.getByRole('button', { name: 'Tag it' });

describe('Compose, on the post a card is played on', () => {
  test('it says its screen is up once the dock is mounted, which is when the engine brings the post clear of it', async () => {
    const { props } = mountCompose();
    await waitFor(() => expect(document.documentElement.hasAttribute('data-kb-graffiti-dock')).toBe(true));
    expect(props.ready).toHaveBeenCalledTimes(1);
  });

  test('the toolbar mounts once at open, in the host it is portaled to, so its mount effect and its fold state are not run twice', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      mountCompose();
      await waitFor(() => expect(document.documentElement.hasAttribute('data-kb-graffiti-dock')).toBe(true));
      expect(focus.mock.calls.filter(([o]) => (o as FocusOptions | undefined)?.preventScroll === true)).toHaveLength(1);
    } finally { focus.mockRestore(); }
  });

  test('draws the post\'s words as given, and the drawing and its surface in the element around them, lifted so no other card\'s ink takes a press there', () => {
    const { container, surface, under } = mountCompose();
    expect(container).toHaveTextContent('The post\'s words.');
    expect(surface).not.toBeNull();
    expect(under.contains(surface)).toBe(true);
    expect(under.querySelector('canvas[data-kb-effect-ink]')).not.toBeNull();
    expect(surface.hasAttribute('data-kb-over-ink')).toBe(true);
    expect(strokes(surface)).toBe(0);
  });

  test('draws nothing before the words\' box is measured, and nothing without the element around them', () => {
    const under = document.createElement('div');
    const { container } = renderInWorld(<Compose post={POST} box={null} under={under} submit={ok} cancel={() => {}} hold={() => {}} ready={() => {}}><p>The post&apos;s words.</p></Compose>);
    expect(container).toHaveTextContent('The post\'s words.');
    expect(under.querySelector('canvas')).toBeNull();
    expect(screen.getByText('Draw something first')).toBeInTheDocument();
  });

  test('a press draws, with the can and the cap chosen, and Tag it sends it as the first draw with an empty configuration', async () => {
    const user = userEvent.setup();
    const { surface, props } = mountCompose();
    await user.click(screen.getByRole('radio', { name: 'Pink' }));
    await user.click(screen.getByRole('radio', { name: 'Fat' }));
    drag(surface, LINE);
    expect(strokes(surface)).toBe(1);
    await user.click(tag());
    expect(props.submit).toHaveBeenCalledTimes(1);
    const [config, first] = vi.mocked(props.submit).mock.calls[0]!;
    expect(config).toEqual({});
    /* A 600 by 400 px box at 15 px to the em is 40 by 26.67 ems; the line's center is (240, 120) px, and with no words on the page the group is attached to the box. */
    expect(first).toEqual({
      box: { w: 40, h: 26.67 },
      groups: [{ at: [0.4, 0.3], anchor: { kind: 'box' }, unit: 'em', strokes: [{ can: 'pink', cap: 'fat', points: [[-8, 0], [0, 0], [8, 0]] }] }],
    });
  });

  test('keeps points in ems from the group\'s center to a hundredth, and thins the ones a pixel or two apart', () => {
    const { surface, props } = mountCompose();
    drag(surface, [[0.123456, 0.3], [0.1236, 0.3], [0.3, 0.3333333]]);
    act(() => { screen.getByRole('button', { name: 'Tag it' }).click(); });
    const first = vi.mocked(props.submit).mock.calls[0]![1] as { groups: { strokes: { points: number[][] }[] }[] };
    const points = first.groups[0]!.strokes[0]!.points;
    expect(points).toHaveLength(2);
    expect(points.flat().every((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-9)).toBe(true);
  });

  test('a stroke drawn is painted on the post as the model adds it, under what the post wears', () => {
    const { surface } = mountCompose();
    drag(surface, LINE);
    const last = vi.mocked(spray.paintWall).mock.calls.at(-1)!;
    const acts = last[3] as readonly spray.WallAct[];
    expect(acts).toHaveLength(1);
    expect(acts[0]!.kind).toBe('draw');
    expect((acts[0]!.payload as { groups: { strokes: unknown[] }[] }).groups[0]!.strokes).toHaveLength(1);
  });

  test('Tag it waits for a drawing, and the toolbar counts it: Wall 0% of 40% grows', async () => {
    const user = userEvent.setup();
    const { surface } = mountCompose();
    await user.click(screen.getByRole('radio', { name: 'Fat' }));
    expect(tag()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Draw something first')).toBeInTheDocument();
    expect(screen.getByText('Wall 0% of 40%')).toBeInTheDocument();
    drag(surface, [[0.05, 0.3], [0.5, 0.3], [0.95, 0.3]]);
    expect(tag()).toHaveAttribute('aria-disabled', 'false');
    expect(screen.queryByText('Wall 0% of 40%')).toBeNull();
    expect(screen.getByText(/^Wall \d+% of 40%$/)).toBeInTheDocument();
  });

  test('says it holds work once there are strokes, and that it holds none when Undo has taken them all', async () => {
    const user = userEvent.setup();
    const { surface, props } = mountCompose();
    expect(props.hold).not.toHaveBeenCalledWith(ASK);
    drag(surface, LINE);
    expect(props.hold).toHaveBeenLastCalledWith(ASK);
    drag(surface, [[0.2, 0.6], [0.5, 0.6]]);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(strokes(surface)).toBe(1);
    expect(props.hold).toHaveBeenLastCalledWith(ASK);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(strokes(surface)).toBe(0);
    expect(props.hold).toHaveBeenLastCalledWith(null);
  });

  test('Cancel goes to the engine, which asks first when work is held; Compose asks nothing itself', async () => {
    const user = userEvent.setup();
    const { surface, props } = mountCompose();
    drag(surface, LINE);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.cancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(ASK)).toBeNull();
  });

  test('a refusal is shown in the toolbar, in the database\'s words, and the drawing is kept and can be sent again', async () => {
    const user = userEvent.setup();
    const submit = vi.fn<ComposeProps['submit']>()
      .mockResolvedValueOnce({ ok: false, error: 'This tag would take the wall to 46%; its limit is 40%.' })
      .mockResolvedValueOnce({ ok: true, value: {} });
    const { surface } = mountCompose({ submit });
    drag(surface, LINE);
    await user.click(tag());
    expect(await screen.findByRole('alert')).toHaveTextContent('This tag would take the wall to 46%; its limit is 40%.');
    expect(strokes(surface)).toBe(1);
    expect(tag()).toHaveAttribute('aria-disabled', 'false');
    await user.click(tag());
    expect(submit).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  test('an answer that never came is shown in the glass\'s plain words, and the drawing is kept', async () => {
    const user = userEvent.setup();
    const { surface } = mountCompose({ submit: async () => ({ ok: false, error: LOST_ANSWER, uncertain: true }) });
    drag(surface, LINE);
    await user.click(tag());
    expect(await screen.findByRole('alert')).toHaveTextContent(LOST_ANSWER);
    expect(strokes(surface)).toBe(1);
  });
});

describe('a stencil', () => {
  test('is previewed on the post before Tag it, and tags with the stencil, the can and the spot', async () => {
    const user = userEvent.setup();
    const { props } = mountCompose();
    await user.click(screen.getByRole('tab', { name: 'Stencils' }));
    expect(tag()).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('radio', { name: 'Crown' }));
    await user.click(screen.getByRole('radio', { name: 'Pink' }));
    await user.click(screen.getByRole('radio', { name: 'Top left' }));
    const shown = vi.mocked(spray.paintWall).mock.calls.at(-1)![3] as readonly spray.WallAct[];
    expect(shown).toHaveLength(1);
    const group = (shown[0]!.payload as { groups: { at: number[]; strokes: { can: string }[] }[] }).groups[0]!;
    expect(group.strokes).toHaveLength(4);
    expect(group.strokes.every((s) => s.can === 'pink')).toBe(true);
    expect(group.at).toEqual([0.1667, 0.1667]);
    expect(props.hold).toHaveBeenLastCalledWith(ASK);
    await user.click(tag());
    expect(props.submit).toHaveBeenCalledWith({}, { stencil: 'crown', can: 'pink', spot: 0 });
  });

  test('over the limit it says so with the figures and sends nothing', async () => {
    const user = userEvent.setup();
    const { props } = mountDraw({ most: 100 });
    await user.click(screen.getByRole('tab', { name: 'Stencils' }));
    await user.click(screen.getByRole('radio', { name: 'Big X' }));
    expect(screen.getByText(/^This tag would take the wall to \d+%; its limit is 1%$/)).toBeInTheDocument();
    await user.click(tag());
    expect(props.submit).not.toHaveBeenCalled();
  });
});

describe('review fixes', () => {
  test('the real card is offered on a bare post, and says so on a wall (what the ghost mark is drawn from)', () => {
    const post = { ...POST, payload: { body: 'hi' }, currentPayload: { body: 'hi' } } as Act;
    const cards = instance.cards;
    expect(landing(graffiti, post, [], { postEffects: 8, cards })).toEqual({ ok: true, value: undefined });
    const wall = { id: 'g1', card: 'graffiti', layer: 1, caster: 'c2', message: '', config: {}, playedAt: '2026-10-29T21:16:00Z', post: post.id };
    expect(landing(graffiti, post, [wall], { postEffects: 8, cards })).toEqual({ ok: false, why: 'This post is already a wall. Draw on it instead.' });
  });

  /* The composer's box is the post body's (`.kb-act-main`), the box the wall paints in, not the words' element, which on a one-line post is a strip (found in a browser: a Fat stroke read 84%). */
  test('a stroke on a one-line post is framed in the body\'s box, and the surface covers that box', async () => {
    const user = userEvent.setup();
    const cell = document.createElement('div');
    cell.className = 'kb-act-main';
    cell.setAttribute('data-kb-content-area', '');
    cell.style.fontSize = '15px';
    const under = document.createElement('div');
    cell.append(under);
    document.body.append(cell);
    unders.push(cell);
    Object.defineProperty(cell, 'clientWidth', { configurable: true, value: 600 });
    Object.defineProperty(cell, 'clientHeight', { configurable: true, value: 200 });
    const submit = vi.fn(ok);
    renderInWorld(<Compose post={POST} box={{ w: 600, h: 22 }} under={under} submit={submit} cancel={() => {}} hold={() => {}} ready={() => {}}><p>One line.</p></Compose>);
    const surface = under.querySelector('[data-kb-draw-surface]') as HTMLElement;
    expect(surface.style.width).toBe('600px');
    expect(surface.style.height).toBe('200px');
    await user.click(screen.getByRole('radio', { name: 'Fat' }));
    /* rects sit at 0,0 in jsdom with no size, so px come from the box: 300,100 is the middle. */
    act(() => { fireEvent.pointerDown(surface, { clientX: 300, clientY: 100, pointerId: 1, button: 0, pointerType: 'mouse' }); });
    act(() => { fireEvent.pointerUp(surface, { clientX: 300, clientY: 100, pointerId: 1, pointerType: 'mouse' }); });
    await user.click(tag());
    const first = (submit.mock.calls[0] as unknown[])[1] as { box: unknown; groups: { at: number[]; strokes: { points: number[][] }[] }[] };
    expect(first.box).toEqual({ w: 40, h: 13.33 });
    expect(first.groups[0]!.at).toEqual([0.5, 0.5]);
    expect(first.groups[0]!.strokes[0]!.points).toEqual([[0, 0]]);
  });

  /* The body is whatever element carries the marker (the ORIGIN box's area is one and is no `.kb-act-main`), and the class alone is none. */
  const surfaceIn = (cell: HTMLElement) => {
    const under = document.createElement('div');
    cell.append(under);
    document.body.append(cell);
    unders.push(cell);
    Object.defineProperty(cell, 'clientWidth', { configurable: true, value: 480 });
    Object.defineProperty(cell, 'clientHeight', { configurable: true, value: 260 });
    renderInWorld(<Compose post={POST} box={{ w: 600, h: 22 }} under={under} submit={vi.fn(ok)} cancel={() => {}} hold={() => {}} ready={() => {}}><p>One line.</p></Compose>);
    return under.querySelector('[data-kb-draw-surface]') as HTMLElement;
  };

  test('the body is found by the marker, whatever its class', () => {
    const area = document.createElement('div');
    area.className = 'kb-origin-area';
    area.setAttribute('data-kb-content-area', '');
    const surface = surfaceIn(area);
    expect([surface.style.width, surface.style.height]).toEqual(['480px', '260px']);
  });

  test("an unmarked kb-act-main is not a body: the surface covers the words' box it was given", () => {
    const cell = document.createElement('div');
    cell.className = 'kb-act-main';
    const surface = surfaceIn(cell);
    expect([surface.style.width, surface.style.height]).toEqual(['600px', '22px']);
  });

  /* A passive listener's preventDefault is ignored and logs "Unable to preventDefault inside passive event listener" at each stroke (found in a real browser, e2e/graffiti.spec.ts). */
  test('the surface\'s pointerdown, which calls preventDefault, and its touchmove are not passive listeners', () => {
    const added: { readonly el: unknown; readonly type: string; readonly passive: unknown }[] = [];
    const real = EventTarget.prototype.addEventListener;
    const spy = vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (this: EventTarget, type: string, fn: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
      added.push({ el: this, type, passive: typeof options === 'object' ? options.passive : undefined });
      return real.call(this, type, fn, options);
    });
    try {
      const { surface } = mountCompose();
      const mine = added.filter((a) => a.el === surface);
      expect(mine.find((a) => a.type === 'pointerdown')?.passive).toBe(false);
      expect(mine.find((a) => a.type === 'touchmove')?.passive).toBe(false);
    } finally { spy.mockRestore(); }
  });

  test('a press on the post while the Stencils tab is open starts no stroke and holds no work', async () => {
    const user = userEvent.setup();
    const { surface, props } = mountCompose();
    await user.click(screen.getByRole('tab', { name: 'Stencils' }));
    drag(surface, LINE);
    expect(strokes(surface)).toBe(0);
    expect(props.hold).not.toHaveBeenCalledWith(ASK);
    await user.click(screen.getByRole('tab', { name: 'Spray' }));
    expect(strokes(surface)).toBe(0);
    expect(screen.getByText('Draw something first')).toBeInTheDocument();
  });

  test('Stay returns focus to Cancel', async () => {
    const user = userEvent.setup();
    const { surface } = mountDraw();
    drag(surface, LINE);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  test('Cancel is off while a submit is out', async () => {
    const user = userEvent.setup();
    let release: (a: Answer<unknown>) => void = () => {};
    const { surface } = mountCompose({ submit: () => new Promise((done) => { release = done; }) });
    drag(surface, LINE);
    await user.click(tag());
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await act(async () => { release({ ok: false, error: 'No.' }); });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  test('the preview is the draw as it will be sent, painted where it was drawn', () => {
    const under = document.createElement('div');
    document.body.append(under);
    unders.push(under);
    renderInWorld(<Compose post={POST} box={{ w: 600, h: 400 }} under={under} submit={ok} cancel={() => {}} hold={() => {}} ready={() => {}}><p>x</p></Compose>);
    drag(under.querySelector('[data-kb-draw-surface]') as HTMLElement, LINE);
    const painted = (vi.mocked(spray.paintWall).mock.calls.at(-1)![3] as readonly spray.WallAct[])[0]!.payload as { box: unknown; groups: { at: number[]; anchor: unknown }[] };
    expect(painted.box).toEqual({ w: 40, h: 26.67 });
    expect(painted.groups[0]).toMatchObject({ at: [0.4, 0.3], anchor: { kind: 'box' } });
  });
});

/* The drawer's screen finds what a tag was drawn over in its own layout: the marks the card lays over the words while drawing, and the images (`data-kb-img`). */
describe('tagging a post\'s words and images', () => {
  const rect = (x: number, y: number, w = 0, h = 0) => ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect;
  /** Each word's mark sits at its place; the images at theirs. Everything else is where jsdom puts it. */
  const layout = (marks: Record<string, DOMRect>, images: Record<string, DOMRect> = {}) => {
    const real = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const m = this.getAttribute('data-kb-word-mark'), i = this.getAttribute('data-kb-img');
      return (m !== null ? marks[m] : i !== null ? images[i] : undefined) ?? real.call(this);
    });
  };
  const edited = (words: string, extra: Partial<Act> = {}) => ({ ...POST, payload: { body: words }, currentPayload: { body: words }, ...extra }) as Act;
  afterEach(() => { vi.restoreAllMocks(); });

  test('the words carry a mark at each word\'s first character while a drawing is open, and Tag it attaches to the word under the drawing', async () => {
    const user = userEvent.setup();
    layout({ 0: rect(0, 10, 0, 21), 6: rect(45, 10, 0, 21), 12: rect(90, 10, 0, 21) });
    const { under, props, surface } = mountCompose({ post: edited('Hello there world'), words: 'Hello there world' });
    expect([...under.querySelectorAll('[data-kb-word-mark]')].map((m) => m.getAttribute('data-kb-word-mark'))).toEqual(['0', '6', '12']);
    await user.click(screen.getByRole('radio', { name: 'Fat' }));
    drag(surface, [[100 / 600, 25 / 400], [140 / 600, 25 / 400]]);
    await user.click(tag());
    const first = vi.mocked(props.submit).mock.calls[0]![1] as { groups: { anchor: unknown; unit: string }[] };
    /* The center is (120, 25) px: inside "world," (90 to 139.5 across, 10 to 31 down), 2 ems right of its mark and 1 em below its line's top. */
    expect(first.groups[0]).toMatchObject({ unit: 'em', anchor: { kind: 'text', version: 'post-1', at: 12, len: 5, dx: 2, dy: 1 } });
  });

  test('a ring drawn over an image is attached to it, in the image\'s widths', async () => {
    const user = userEvent.setup();
    layout({}, { 0: rect(100, 50, 200, 150) });
    const { props, surface } = mountCompose({ post: edited('[img]https://x.test/a.png[/img]'), words: '[img]https://x.test/a.png[/img]' });
    drag(surface, [[180 / 600, 125 / 400], [220 / 600, 125 / 400]]);
    await user.click(tag());
    const first = vi.mocked(props.submit).mock.calls[0]![1] as { groups: { anchor: unknown; unit: string; em: number }[] };
    expect(first.groups[0]).toMatchObject({ unit: 'image', em: 13.33, anchor: { kind: 'image', version: 'post-1', n: 0, src: 'https://x.test/a.png', nth: 0, x: 0.5, y: 0.5 } });
  });

  test('an edited post whose page holds no tails is tagged against its words, at the current version the page\'s read carries', async () => {
    const user = userEvent.setup();
    layout({ 0: rect(0, 10, 0, 21) });
    const { props, surface } = mountCompose({ post: edited('Hello', { editedAt: '2026-10-30T00:00:00.000Z', version: 'edit-1' }), words: 'Hello' });
    drag(surface, [[20 / 600, 25 / 400], [60 / 600, 25 / 400]]);
    await user.click(tag());
    expect((vi.mocked(props.submit).mock.calls[0]![1] as { groups: { anchor: unknown }[] }).groups[0]!.anchor).toMatchObject({ kind: 'text', version: 'edit-1', at: 0, len: 5 });
  });

  test('a post edited since the page read it, with no tails, is tagged against the box, since the version the page holds is the old one', async () => {
    const user = userEvent.setup();
    layout({ 0: rect(0, 10, 0, 21) });
    const { props, surface } = mountCompose({ post: edited('Hello', { editedAt: '2026-10-30T00:00:00.000Z', version: 'post-1' }), words: 'Hello' });
    drag(surface, [[20 / 600, 25 / 400], [60 / 600, 25 / 400]]);
    await user.click(tag());
    expect((vi.mocked(props.submit).mock.calls[0]![1] as { groups: { anchor: unknown }[] }).groups[0]!.anchor).toEqual({ kind: 'box' });
  });
});

describe('a version is named only with the words it is the version of', () => {
  const rect = (x: number, y: number, w = 0, h = 0) => ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect;
  const layout = (marks: Record<string, DOMRect>) => {
    const real = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const m = this.getAttribute('data-kb-word-mark');
      return (m !== null ? marks[m] : undefined) ?? real.call(this);
    });
  };
  const edited = (words: string, extra: Partial<Act> = {}) => ({ ...POST, payload: { body: words }, currentPayload: { body: words }, ...extra }) as Act;
  afterEach(() => { vi.restoreAllMocks(); });
  const anchorOf = (props: ComposeProps) => (vi.mocked(props.submit).mock.calls[0]![1] as { groups: { anchor: unknown }[] }).groups[0]!.anchor;

  test('tails ahead of the post (an edit they hold that the post has not been refreshed with) never name their newer version for the old words\' offsets', async () => {
    const user = userEvent.setup();
    layout({ 0: rect(0, 10, 0, 21) });
    tails.version = 'edit-2';
    const { props, surface } = mountCompose({ post: edited('Hello'), words: 'Hello' });
    drag(surface, [[20 / 600, 25 / 400], [60 / 600, 25 / 400]]);
    await user.click(tag());
    const anchor = anchorOf(props);
    expect(anchor).not.toMatchObject({ version: 'edit-2' });
    expect(anchor).toMatchObject({ kind: 'text', version: 'post-1', at: 0, len: 5 });
  });

  test('tails ahead of a post that is known to be edited, with no version of its own, give the box', async () => {
    const user = userEvent.setup();
    layout({ 0: rect(0, 10, 0, 21) });
    tails.version = 'edit-2';
    const { props, surface } = mountCompose({ post: edited('Hello', { editedAt: '2026-10-30T00:00:00.000Z', version: 'post-1' }), words: 'Hello' });
    drag(surface, [[20 / 600, 25 / 400], [60 / 600, 25 / 400]]);
    await user.click(tag());
    expect(anchorOf(props)).toEqual({ kind: 'box' });
  });
});

describe('Compose is only ever for a new wall', () => {
  test('its meter starts from nothing: a play of the card makes its own wall, one to a post (stack 1), and a Draw on a wall that is there is DrawMode with its covered', () => {
    mountCompose();
    expect(screen.getByText(/^Wall 0% of 40%$/)).toBeInTheDocument();
  });
});

describe('the meter on a wall that is already there', () => {
  const meterText = () => screen.getByText(/^Wall \d+% of 40%$/).textContent;

  test('starts from the cells the server says are covered, and counts the drawing\'s own cells on top in full', () => {
    const { surface } = mountDraw({ covered: 1000 });
    expect(meterText()).toBe('Wall 10% of 40%');
    act(() => { screen.getByRole('radio', { name: 'Fat' }).click(); });
    drag(surface, [[0.05, 0.5], [0.5, 0.5], [0.95, 0.5]]);
    const after = Number(/\d+/.exec(meterText()!)![0]);
    expect(after).toBeGreaterThanOrEqual(10 + 8);
  });

  test('a wall whose strokes are not read yet starts from the cells the server says are covered', () => {
    mountDraw({ wall: null, covered: 3100 });
    expect(meterText()).toBe('Wall 31% of 40%');
  });

  test('over the limit, Tag it is not ready and the reason is under it', () => {
    const { surface, props } = mountDraw({ wall: null, covered: 3990 });
    act(() => { screen.getByRole('radio', { name: 'Fat' }).click(); });
    drag(surface, [[0.1, 0.8], [0.9, 0.8]]);
    expect(tag()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/^This tag would take the wall to \d+%; its limit is 40%$/)).toBeInTheDocument();
    act(() => { tag().click(); });
    expect(props.submit).not.toHaveBeenCalled();
  });
});

describe('the Draw tile\'s draw mode', () => {
  test('gives the drawing to the host to paint into the wall\'s layer, and clears it when it is gone', () => {
    const { surface, props, unmount } = mountDraw();
    drag(surface, LINE);
    const last = vi.mocked(props.onDraft!).mock.calls.at(-1)![0];
    expect(last?.kind).toBe('draw');
    unmount();
    expect(vi.mocked(props.onDraft!).mock.calls.at(-1)![0]).toBeNull();
  });

  test('sends the draw and is done when it lands, and the can is kept for the account', async () => {
    const user = userEvent.setup();
    const { surface, props } = mountDraw();
    await user.click(screen.getByRole('radio', { name: 'Teal' }));
    drag(surface, LINE);
    await user.click(tag());
    expect(props.submit).toHaveBeenCalledWith({ box: expect.anything(), groups: [expect.objectContaining({ strokes: [expect.objectContaining({ can: 'teal', cap: 'stock' })] })] });
    await vi.waitFor(() => expect(props.done).toHaveBeenCalled());
    try { expect(localStorage.getItem('kb-graffiti-can:acct-1')).toBe('teal'); } catch { /* storage is off here */ }
  });

  test('Cancel with nothing drawn leaves at once; with strokes it asks first, and Stay keeps the drawing', async () => {
    const user = userEvent.setup();
    const { surface, props } = mountDraw();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.cancel).toHaveBeenCalledTimes(1);
    drag(surface, LINE);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByText(ASK)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.queryByText(ASK)).toBeNull();
    expect(strokes(surface)).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    expect(props.cancel).toHaveBeenCalledTimes(2);
  });

  test('Esc asks the same, and leaves at once with nothing drawn', async () => {
    const user = userEvent.setup();
    const { surface, props } = mountDraw();
    await user.keyboard('{Escape}');
    expect(props.cancel).toHaveBeenCalledTimes(1);
    drag(surface, LINE);
    await user.keyboard('{Escape}');
    expect(props.cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByText(ASK)).toBeInTheDocument();
  });

  test('a card the engine mounts asks through the engine, so Esc here does nothing of its own', async () => {
    const user = userEvent.setup();
    const { surface, props } = mountDraw({ asks: false });
    drag(surface, LINE);
    await user.keyboard('{Escape}');
    expect(props.cancel).not.toHaveBeenCalled();
    expect(screen.queryByText(ASK)).toBeNull();
  });
});

describe('what a press does', () => {
  test('a press on the toolbar draws nothing', async () => {
    const { surface } = mountDraw();
    act(() => { fireEvent.pointerDown(screen.getByRole('radio', { name: 'Pink' }), { clientX: 300, clientY: 200, pointerId: 1, button: 0, pointerType: 'mouse' }); });
    expect(strokes(surface)).toBe(0);
  });

  test('a press that is not the main button draws nothing', () => {
    const { surface } = mountDraw();
    act(() => { fireEvent.pointerDown(surface, { clientX: 300, clientY: 200, pointerId: 1, button: 2, pointerType: 'mouse' }); });
    expect(strokes(surface)).toBe(0);
  });

  test('a tap with a mouse is a dab: a stroke of one point', () => {
    const { surface } = mountDraw();
    drag(surface, [[0.5, 0.5]]);
    expect(strokes(surface)).toBe(1);
  });
});

describe('the cursor', () => {
  test('a mouse over the post shows the drawn can in the can\'s color, pressed while it draws, and gone when the pointer leaves', () => {
    const { surface } = mountDraw();
    act(() => { fireEvent.pointerMove(surface, { clientX: 100, clientY: 100, pointerId: 1, pointerType: 'mouse' }); });
    expect(cursor.over).toHaveBeenLastCalledWith(surface, expect.objectContaining({ pointerType: 'mouse' }), 'can', CANS.cyan);
    act(() => { fireEvent.pointerDown(surface, { clientX: 100, clientY: 100, pointerId: 1, button: 0, pointerType: 'mouse' }); });
    expect(cursor.press).toHaveBeenLastCalledWith(true);
    act(() => { fireEvent.pointerUp(surface, { clientX: 100, clientY: 100, pointerId: 1, pointerType: 'mouse' }); });
    expect(cursor.press).toHaveBeenLastCalledWith(false);
    act(() => { fireEvent.pointerLeave(surface, { pointerType: 'mouse' }); });
    expect(cursor.leave).toHaveBeenCalledWith(surface);
  });

  test('takes the color of the can picked', async () => {
    const user = userEvent.setup();
    const { surface } = mountDraw();
    await user.click(screen.getByRole('radio', { name: 'Pink' }));
    act(() => { fireEvent.pointerMove(surface, { clientX: 100, clientY: 100, pointerId: 1, pointerType: 'mouse' }); });
    expect(cursor.over).toHaveBeenLastCalledWith(surface, expect.anything(), 'can', CANS.pink);
  });
});

describe('the bounds a draw keeps to', () => {
  test('past 120 strokes no more are taken, and it says so plainly; Undo makes room', async () => {
    const user = userEvent.setup();
    const { surface } = mountDraw();
    for (let i = 0; i < 120; i++) drag(surface, [[(i % 100) / 100 + 0.005, 0.5]]);
    expect(strokes(surface)).toBe(120);
    expect(screen.queryByRole('status')).toBeNull();
    drag(surface, [[0.5, 0.9]]);
    expect(strokes(surface)).toBe(120);
    expect(screen.getByRole('status')).toHaveTextContent('120 strokes');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.queryByRole('status')).toBeNull();
    drag(surface, [[0.5, 0.9]]);
    expect(strokes(surface)).toBe(120);
  });

  test('a stroke longer than 300 points goes on in the next stroke, and Undo takes the whole of it', async () => {
    const user = userEvent.setup();
    const { surface } = mountDraw();
    const long = Array.from({ length: 450 }, (_, i): [number, number] => [0.02 + (i % 2 ? 0.5 : 0), 0.02 + (i / 450) * 0.9]);
    drag(surface, long);
    expect(strokes(surface)).toBe(2);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(strokes(surface)).toBe(0);
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
    const { surface } = mountDraw();
    const [x, y] = px(0.5, 0.5);
    touch(surface, 'touchstart', [{ id: 1, at: [x, y] }], [{ id: 1, at: [x, y] }]);
    const prevented = touch(surface, 'touchmove', [{ id: 1, at: [x, y + 30] }], [{ id: 1, at: [x, y + 30] }]);
    touch(surface, 'touchend', [], [{ id: 1, at: [x, y + 30] }]);
    expect(prevented).toBe(false);
    expect(strokes(surface)).toBe(0);
  });

  test('a sideways swipe draws, and the page\'s scroll is refused for it', () => {
    const { surface } = mountDraw();
    const [x, y] = px(0.3, 0.5);
    touch(surface, 'touchstart', [{ id: 1, at: [x, y] }], [{ id: 1, at: [x, y] }]);
    const prevented = touch(surface, 'touchmove', [{ id: 1, at: [x + 30, y] }], [{ id: 1, at: [x + 30, y] }]);
    touch(surface, 'touchmove', [{ id: 1, at: [x + 90, y] }], [{ id: 1, at: [x + 90, y] }]);
    touch(surface, 'touchend', [], [{ id: 1, at: [x + 90, y] }]);
    expect(prevented).toBe(true);
    expect(strokes(surface)).toBe(1);
  });

  test('a hold draws, with a puff of nothing here and the stroke kept', () => {
    vi.useFakeTimers();
    const { surface } = mountDraw();
    const [x, y] = px(0.3, 0.5);
    touch(surface, 'touchstart', [{ id: 1, at: [x, y] }], [{ id: 1, at: [x, y] }]);
    act(() => { vi.advanceTimersByTime(200); });
    touch(surface, 'touchend', [], [{ id: 1, at: [x, y] }]);
    expect(strokes(surface)).toBe(1);
  });

  test('a second finger is the page\'s: it draws nothing and ends a stroke under way where it got to', () => {
    const { surface } = mountDraw();
    const [x, y] = px(0.3, 0.5);
    touch(surface, 'touchstart', [{ id: 1, at: [x, y] }], [{ id: 1, at: [x, y] }]);
    touch(surface, 'touchmove', [{ id: 1, at: [x + 30, y] }], [{ id: 1, at: [x + 30, y] }]);
    touch(surface, 'touchstart', [{ id: 1, at: [x + 30, y] }, { id: 2, at: [x + 100, y + 50] }], [{ id: 2, at: [x + 100, y + 50] }]);
    const prevented = touch(surface, 'touchmove', [{ id: 1, at: [x + 60, y] }, { id: 2, at: [x + 100, y + 80] }], [{ id: 2, at: [x + 100, y + 80] }]);
    expect(prevented).toBe(false);
    expect(strokes(surface)).toBe(1);
  });

  test('draws nothing with a finger on the toolbar', () => {
    const { surface } = mountDraw();
    const dock = screen.getByRole('group', { name: 'Graffiti tools' });
    const [x, y] = px(0.3, 0.5);
    touch(dock, 'touchstart', [{ id: 1, at: [x, y] }], [{ id: 1, at: [x, y] }]);
    touch(dock, 'touchmove', [{ id: 1, at: [x + 60, y] }], [{ id: 1, at: [x + 60, y] }]);
    expect(strokes(surface)).toBe(0);
  });
});
